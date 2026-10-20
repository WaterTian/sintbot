// 额度自动切换(v0.11.107,engine._failoverAfterError / noteQuota / _settleFailover / _probeHomeLater)。
// 用 mock store(带 failover / exhausted 两组接口)+ 可编程 runner 驱动引擎,不碰真 CLI。
// 场景全部取自真机:09-25 OAuth 过期 6 轮 · 09-28 codex 用量上限 · 09-30 / 10-05 claude 周上限、人工切 codex 顶着。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Engine } = require('../../src/core/engine')
const { parseResetAt } = require('../../src/core/quotaerr')
const { tzParts } = require('../../src/core/time')

const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms))
// 等某群把这一批(含插回队首的重做)全跑完:按条件轮询,不猜毫秒 —— 失败轮 → finally 切换 → release → 重做,两轮串行,
// 固定 tick 在 CI 慢机上会偶发红。上限 3 秒,超时让断言自己去红。
async function drain(eng, chatId = 'G') {
  const t0 = Date.now()
  for (;;) {
    await tick(10)
    const rt = eng._rt(chatId)
    if (!rt.busy && rt.queue.length === 0) { await tick(10); if (!eng._rt(chatId).busy && eng._rt(chatId).queue.length === 0) return }
    if (Date.now() - t0 > 3000) return
  }
}

function mkStore() {
  const g = new Map()
  const G = (c) => g.get(c) || (g.set(c, {}), g.get(c))
  const exhausted = new Map()
  return {
    getSession: (c) => G(c).sessionId || null,
    setSession: (c, v) => { G(c).sessionId = v },
    clearSession: (c) => { delete G(c).sessionId; delete G(c).tainted },
    markTainted: (c) => { G(c).tainted = true }, clearTainted: (c) => { delete G(c).tainted }, isTainted: (c) => !!G(c).tainted,
    getProvider: (c) => G(c).provider || null,
    setProvider: (c, v) => { G(c).provider = v; delete G(c).failover },
    clearProvider: (c) => { delete G(c).provider; delete G(c).failover },
    getWatermark: (c) => G(c).wm || 0, setWatermark: (c, t) => { G(c).wm = t },
    getSessionStats: (c) => G(c).stats || null, putSessionStats: (c, s) => { G(c).stats = s }, clearSessionStats: (c) => { delete G(c).stats },
    getFailover: (c) => G(c).failover || null,
    setFailover: (c, rec) => { G(c).provider = rec.to; G(c).failover = rec },
    clearFailover: (c) => { delete G(c).failover; delete G(c).provider },
    touchFailover: (c, p) => { if (G(c).failover) Object.assign(G(c).failover, p) },
    markExhausted: (n, { until = null, kind = 'quota' } = {}, now = Date.now()) => { exhausted.set(n, { until, kind, at: now }) },
    getExhausted: (n, now = Date.now()) => { const e = exhausted.get(n); return e && !(typeof e.until === 'number' && e.until <= now) ? e : null },
    isExhausted: (n, now = Date.now()) => { const e = exhausted.get(n); return !!e && !(typeof e.until === 'number' && e.until <= now) },
    clearExhausted: (n) => exhausted.delete(n), // 与真 store 同契约:返回之前有没有(运维告警「已恢复」靠它)
    _exhausted: exhausted,
  }
}

function mkPlatform() {
  const replies = [], sent = []
  return { replies, sent, reply: (_ctx, text) => { replies.push(text); return Promise.resolve() }, send: (_c, text) => { sent.push(text); return Promise.resolve() } }
}

function cfg(extra = {}) {
  return {
    providers: { claude: { fallback: 'codex' }, codex: { runner: 'codex', fallback: 'claude' }, glm: { baseUrl: 'https://x', apiKey: 'k', hidden: true } },
    defaultProvider: 'claude',
    agent: { bin: 'claude', permissionMode: 'dontAsk', maxConcurrent: 2, maxTurnTimeMins: 0 },
    groups: { G: { workdir: '/proj', provider: 'claude', allowedTools: ['Read'] }, H: { workdir: '/h', provider: 'claude' }, K: { workdir: '/k', provider: 'codex' } },
    ...extra,
  }
}

let _n = 0
function mkMsg(text, chatId = 'G', extra = {}) {
  _n++
  return { chatId, text, msgId: 'm-' + _n, createTimeMs: Date.now() + _n, senderName: 'u', userId: 'u1', replyCtx: {}, ...extra }
}

// 真机原话;日期按「明天 9 点(北京)」现算 —— 写死「Oct 1」在别的日子跑会被 8 天上界判成解不出(那正是要的行为,但不是这里要测的)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const tmr = tzParts(Date.now() + 864e5, 'Asia/Shanghai')
const WEEKLY = `You've hit your weekly limit · resets ${MON[+tmr.month - 1]} ${+tmr.day} at 9am (Asia/Shanghai)`
const WEEKLY_AT = parseResetAt(WEEKLY, { now: Date.now() })
const CODEX_LIMIT = "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again at 2:30 PM."
const ON_HOLD = "Your account is on hold and can't use Claude Code. View details or appeal: https://claude.ai/restricted"

// runner:按 provider 名决定成功还是报额度错;记录每轮用的 provider 与续接的会话
function mkRunner(fail = { claude: WEEKLY }) {
  const calls = []
  return {
    calls,
    runTurn: async (o) => {
      const name = o.provider && o.provider.__name
      calls.push({ name, resume: o.sessionId || null })
      const err = fail[name]
      if (err) return { sessionId: 'sid-' + name + '-' + calls.length, result: { text: err, isError: true, subtype: 'error', quota: require('../../src/agent/quotaerr').classifyQuota(err) } }
      return { sessionId: 'sid-' + name + '-' + calls.length, result: { text: 'ok from ' + name } }
    },
  }
}

// 引擎把 provider **对象**传给 runner;给对象打上名字,runner 才报得出「这轮用的是谁」
function mkEngine(runner, store, opts = {}, c = cfg()) {
  for (const [n, p] of Object.entries(c.providers)) p.__name = n
  return new Engine(c, { runner, store, ...opts })
}

test('failover: 额度用尽的出错轮 ⇒ 切到备用、清会话、这条在备用上重做、群里说一句;重置时刻从原话解出', async () => {
  const store = mkStore(), p = mkPlatform(), runner = mkRunner()
  const eng = mkEngine(runner, store)
  await eng.handleMessage(mkMsg('做点事'), p); await drain(eng)
  assert.equal(runner.calls.length, 2, '失败一次 + 在备用上重做一次')
  assert.equal(runner.calls[0].name, 'claude'); assert.equal(runner.calls[1].name, 'codex')
  assert.equal(runner.calls[1].resume, null, '换后端必须新开会话(claude 的会话 id 不能喂给 codex)')
  const rec = store.getFailover('G')
  assert.ok(rec && rec.home === 'claude' && rec.to === 'codex' && rec.kind === 'quota')
  assert.equal(rec.until, WEEKLY_AT, '切回时刻 = 原话里的 resets')
  assert.ok(rec.until - Date.now() < 8 * 864e5, '不会落下「约 358 天后」这种荒谬值')
  assert.equal(store.getProvider('G'), 'codex', '运行时覆盖到备用')
  assert.ok(store.isExhausted('claude'))
  const said = p.replies.join('\n')
  assert.match(said, /一周额度用完了/); assert.match(said, /已自动切到 codex/); assert.match(said, /重做/)
  assert.match(said, /ok from codex/, '重做的那轮答案进群')
  assert.doesNotMatch(said, /sbot|\/Users|resets |hit your/, '群面零工具名、零机器路径、不回显英文原话')
})

test('failover: 备用模型也标了没额度 ⇒ 不切、不重做,说清只能等;两边都坏不来回切', async () => {
  const store = mkStore(), p = mkPlatform(), runner = mkRunner({ claude: WEEKLY, codex: CODEX_LIMIT })
  store.markExhausted('codex', { until: Date.now() + 3600e3 })
  const eng = mkEngine(runner, store)
  await eng.handleMessage(mkMsg('x'), p); await drain(eng)
  assert.equal(runner.calls.length, 1, '不重做')
  assert.equal(store.getFailover('G'), null); assert.equal(store.getProvider('G'), null)
  assert.match(p.replies.join('\n'), /备用模型眼下也用不了/)
})

test('failover: 没配备用 ⇒ 什么都不发生(只有原来的出错卡,且出错卡上是人话不是英文)', async () => {
  const c = cfg(); delete c.providers.claude.fallback
  const store = mkStore(), p = mkPlatform(), runner = mkRunner()
  const eng = mkEngine(runner, store, {}, c)
  await eng.handleMessage(mkMsg('x'), p); await drain(eng)
  assert.equal(runner.calls.length, 1)
  assert.equal(store.getFailover('G'), null)
  const said = p.replies.join('\n')
  assert.doesNotMatch(said, /切到|备用/)
  assert.match(said, /❌ 出错:本群模型的一周额度用完了/); assert.doesNotMatch(said, /hit your/)
})

test('failover: 这轮已经动过手(调过工具 / 流出过正文)⇒ 切模型但不重做,提示真人再发一次;定时任务不给这句;只有报错文本不算动过手', async () => {
  const mkR = (events) => ({ calls: [], runTurn: async function (o) { this.calls.push(o); for (const ev of events) if (o.onEvent) o.onEvent(ev); return { sessionId: 's', result: { text: WEEKLY, isError: true, quota: { kind: 'quota', window: 'weekly' } } } } })
  // 调过工具
  { const store = mkStore(), p = mkPlatform(), runner = mkR([{ type: 'assistant', tools: [{ name: 'Bash', input: { command: 'ls' } }] }])
    const eng = mkEngine(runner, store)
    await eng.handleMessage(mkMsg('x'), p); await drain(eng)
    assert.equal(runner.calls.length, 1, '不重做'); assert.equal(store.getProvider('G'), 'codex', '但模型切了')
    assert.match(p.replies.join('\n'), /请再发一次/) }
  // 流出过真正文
  { const store = mkStore(), p = mkPlatform(), runner = mkR([{ type: 'assistant', text: '我先看一下代码。' }])
    const eng = mkEngine(runner, store)
    await eng.handleMessage(mkMsg('x'), p); await drain(eng)
    assert.equal(runner.calls.length, 1) }
  // CLI 把「API Error: …」当 assistant 文本流出来(2.1.260 真实行为)⇒ 不算动过手,照样重做
  { const store = mkStore(), p = mkPlatform(), runner = mkR([{ type: 'assistant', text: 'API Error: 429 ' + WEEKLY }])
    const eng = mkEngine(runner, store)
    await eng.handleMessage(mkMsg('x'), p); await drain(eng)
    assert.equal(runner.calls.length, 2, '报错文本不是产出,要重做') }
  // 合成消息(定时任务)不给「再发一次」
  { const store = mkStore(), p = mkPlatform(), runner = mkR([{ type: 'assistant', tools: [{ name: 'Bash', input: { command: 'ls' } }] }])
    const eng = mkEngine(runner, store)
    await eng.handleMessage(mkMsg('cron', 'G', { synthetic: true, cron: true, userId: 'cron' }), p); await drain(eng)
    assert.doesNotMatch(p.replies.join('\n'), /请再发一次/); assert.equal(store.getProvider('G'), 'codex') }
})

test('failover: 账号不可用(on hold / 登录态过期)也切,但没有重置时刻;/status 与 /hud 各多一行', async () => {
  const store = mkStore(), p = mkPlatform(), runner = mkRunner({ claude: ON_HOLD })
  const eng = mkEngine(runner, store, { usageProbe: async () => ({ supported: true, value: '5h:1%' }) })
  await eng.handleMessage(mkMsg('x'), p); await drain(eng)
  const rec = store.getFailover('G')
  assert.ok(rec && rec.kind === 'account' && rec.until === null)
  assert.match(p.replies.join('\n'), /账号暂时不可用/)
  assert.ok(store.isExhausted('claude', Date.now() + 365 * 864e5), '账号类常驻,直到探到恢复 / 成功跑过一轮 / 人来切')
  p.replies.length = 0
  await eng.handleMessage(mkMsg('/status'), p); await tick()
  assert.match(p.replies[0], /临时切换:因账号原因已切到 codex,原模型 claude 恢复后切回/)
  await eng.handleMessage(mkMsg('/hud'), p); await tick()
  assert.match(p.replies[1], /临时切换/)
})

test('failover: noteQuota 用到 95% ⇒ 正用该模型的群在下一轮开始前切备用(不等撞上限);没到不切;退下去了清标;没窗口数据不动', async () => {
  const store = mkStore(), p = mkPlatform(), runner = mkRunner({})
  const eng = mkEngine(runner, store)
  const resetsAt = Date.now() + 2 * 3600e3
  eng.noteQuota('claude', { ok: true, windows: [{ kind: 'session', percent: 40, resetsAt: Date.now() + 3600e3 }, { kind: 'weekly', percent: 96, resetsAt }] })
  assert.ok(store.isExhausted('claude'))
  assert.equal(store.getFailover('G'), null, '不在两轮之间不动会话')
  await eng.handleMessage(mkMsg('下一条'), p); await drain(eng)
  assert.equal(runner.calls.length, 1); assert.equal(runner.calls[0].name, 'codex', '这一轮就已经在备用上跑')
  assert.equal(store.getFailover('G').until, resetsAt, '切回时刻取窗口的重置时刻')
  assert.match(p.replies[0], /一周额度用完了,已自动切到 codex/)
  // K 群本来就用 codex,不受影响;H 群也排了切换(到它下一轮才落实)
  assert.equal(store.getFailover('K'), null)
  assert.equal(store.getFailover('H'), null); assert.ok(eng._rt('H').pendingFailover)
  // 没到阈值 ⇒ 不排;退下去 ⇒ 清标;空窗口 ⇒ 不动(那是没探到,不是退下去了)
  const store2 = mkStore(); const eng2 = mkEngine(mkRunner({}), store2)
  eng2.noteQuota('claude', { ok: true, windows: [{ kind: 'weekly', percent: 94, resetsAt }] })
  assert.equal(store2.isExhausted('claude'), false); assert.equal(eng2._rt('G').pendingFailover, undefined)
  store2.markExhausted('claude', { until: resetsAt })
  eng2.noteQuota('claude', { ok: true, windows: [] })
  assert.equal(store2.isExhausted('claude'), true, '空窗口不清标')
  eng2.noteQuota('claude', { ok: true, windows: [{ kind: 'weekly', percent: 10, resetsAt }] })
  assert.equal(store2.isExhausted('claude'), false)
})

test('failover: 到点切回 —— 后台探一次,主模型退下去了 ⇒ 下一轮前切回(清记录、跟随配置、新会话、群里说一句)', async () => {
  const store = mkStore(), p = mkPlatform(), runner = mkRunner({})
  let probed = 0
  const eng = mkEngine(runner, store, { quotaStatus: async () => { probed++; return { ok: true, windows: [{ kind: 'weekly', percent: 12, resetsAt: Date.now() + 7 * 864e5 }] } } })
  store.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: Date.now() - 1000, at: Date.now() - 3600e3 })
  store.setSession('G', 'sid-codex-old')
  await eng.handleMessage(mkMsg('x'), p); await drain(eng)
  assert.equal(probed, 1)
  assert.equal(runner.calls[0].name, 'codex', '这一轮还在备用上(探针在后台,派发层不等它)')
  assert.ok(eng._rt('G').pendingFailover && eng._rt('G').pendingFailover.back, '探针结果 = 排一次「下一轮前切回」')
  await eng.handleMessage(mkMsg('y'), p); await drain(eng)
  assert.equal(store.getFailover('G'), null); assert.equal(store.getProvider('G'), null)
  assert.equal(runner.calls[1].name, 'claude', '这一轮回到主模型')
  assert.equal(runner.calls[1].resume, null, '切回也是新会话')
  assert.match(p.replies.join('\n'), /原模型已恢复,本群切回 claude/)
  assert.equal(store.isExhausted('claude'), false)
})

test('failover: 到点但探针说还满着 ⇒ 不切回,把下次再看的时刻挪到探针给的重置时刻;探针说登录态没了 ⇒ 不切回;半小时内不重复探', async () => {
  const store = mkStore(), p = mkPlatform(), runner = mkRunner({})
  const later = Date.now() + 5 * 3600e3
  const eng = mkEngine(runner, store, { quotaStatus: async () => ({ ok: true, windows: [{ kind: 'weekly', percent: 99, resetsAt: later }] }) })
  store.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: Date.now() - 1000, at: 1 })
  await eng.handleMessage(mkMsg('x'), p); await drain(eng); await tick(30)
  assert.ok(store.getFailover('G')); assert.equal(store.getFailover('G').until, later)
  assert.equal(runner.calls[0].name, 'codex')
  assert.equal(eng._rt('G').pendingFailover, undefined)
  assert.doesNotMatch(p.replies.join('\n'), /切回/)
  // 账号类:探针 ok:false ⇒ 不切回,记一下探过了;半小时内不再探
  const store2 = mkStore(), p2 = mkPlatform(), runner2 = mkRunner({})
  let n = 0
  const eng2 = mkEngine(runner2, store2, { quotaStatus: async () => { n++; return { ok: false, windows: [] } } })
  store2.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'account', until: null, at: Date.now() - 3600e3 })
  await eng2.handleMessage(mkMsg('a'), p2); await drain(eng2); await tick(30)
  await eng2.handleMessage(mkMsg('b'), p2); await drain(eng2); await tick(30)
  assert.equal(n, 1, '第二轮在半小时节流内,不再探')
  assert.ok(store2.getFailover('G') && store2.getFailover('G').checkedAt)
  assert.equal(runner2.calls[1].name, 'codex')
  // 探针返回 null(没探到):额度类按时间切回,账号类不切
  const store3 = mkStore(), p3 = mkPlatform(), runner3 = mkRunner({})
  const eng3 = mkEngine(runner3, store3, { quotaStatus: async () => null })
  store3.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: Date.now() - 1, at: 1 })
  store3.setFailover('H', { home: 'claude', from: 'claude', to: 'codex', kind: 'account', until: null, at: Date.now() - 3600e3 })
  await eng3.handleMessage(mkMsg('g', 'G'), p3); await drain(eng3, 'G'); await tick(30)
  await eng3.handleMessage(mkMsg('h', 'H'), p3); await drain(eng3, 'H'); await tick(30)
  assert.ok(eng3._rt('G').pendingFailover && eng3._rt('G').pendingFailover.back, '额度类:没探到按时间信')
  assert.equal(eng3._rt('H').pendingFailover, undefined, '账号类:没探到只能再等')
  // 探针 ok:true 但一个窗口都没有(接口形状变了)= 同样是没探到,不是「全退下去了」:账号类不切回
  const store4 = mkStore(), p4 = mkPlatform(), runner4 = mkRunner({})
  const eng4 = mkEngine(runner4, store4, { quotaStatus: async () => ({ ok: true, windows: [] }) })
  store4.setFailover('H', { home: 'claude', from: 'claude', to: 'codex', kind: 'account', until: null, at: Date.now() - 3600e3 })
  await eng4.handleMessage(mkMsg('h', 'H'), p4); await drain(eng4, 'H'); await tick(30)
  assert.equal(eng4._rt('H').pendingFailover, undefined, '空窗口不算恢复')
})

test('failover: 没有探针 ⇒ 额度类到点当场按时间切回;账号类只能等人', async () => {
  const store = mkStore(), p = mkPlatform(), runner = mkRunner({})
  const eng = mkEngine(runner, store)
  store.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: Date.now() - 1, at: 1 })
  store.setFailover('H', { home: 'claude', from: 'claude', to: 'codex', kind: 'account', until: null, at: 1 })
  await eng.handleMessage(mkMsg('x', 'G'), p); await drain(eng, 'G')
  await eng.handleMessage(mkMsg('y', 'H'), p); await drain(eng, 'H')
  assert.equal(store.getFailover('G'), null); assert.ok(store.getFailover('H'))
  assert.equal(runner.calls[0].name, 'claude'); assert.equal(runner.calls[1].name, 'codex')
})

test('failover: 备用在失败、主模型的标恰好过期 ⇒ 过期 ≠ 恢复:有探针先探(不当场切回去重做),探到恢复才在下一轮前切回', async () => {
  const store = mkStore(), p = mkPlatform(), runner = mkRunner({ codex: CODEX_LIMIT })
  let probed = 0
  const eng = mkEngine(runner, store, { quotaStatus: async () => { probed++; return { ok: true, windows: [{ kind: 'weekly', percent: 3, resetsAt: Date.now() + 864e5 }] } } })
  store.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: Date.now() + 3600e3, at: Date.now() - 60e3 })
  // claude 的标已过期(但没人证明它恢复了)
  store.markExhausted('claude', { until: Date.now() - 1 })
  await eng.handleMessage(mkMsg('x'), p); await drain(eng); await tick(30)
  assert.equal(runner.calls.length, 1, '不在 claude 上重做'); assert.equal(store.getProvider('G'), 'codex', '还留在 codex 上')
  assert.match(p.replies.join('\n'), /备用模型眼下也用不了/)
  assert.equal(probed, 1, '起了一次后台探针')
  assert.ok(eng._rt('G').pendingFailover && eng._rt('G').pendingFailover.back)
  await eng.handleMessage(mkMsg('y'), p); await drain(eng)
  assert.equal(runner.calls[1].name, 'claude'); assert.equal(store.getFailover('G'), null)
})

test('failover: 人用 /model 切模型 ⇒ 记录作废、排着的切换作废;钉住当前备用走写入器但不清会话;之后引擎不再自作主张切回', async () => {
  const store = mkStore(), p = mkPlatform(), runner = mkRunner({})
  const writes = []
  const eng = mkEngine(runner, store, { setProvider: async (c, n, o) => { writes.push([c, n, !!(o && o.keepSession)]); store.setProvider(c, n) } })
  store.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: Date.now() - 1, at: 1 })
  eng._rt('G').pendingFailover = { from: 'codex', to: 'claude', home: 'claude', kind: 'quota', until: null, back: true }
  await eng.handleMessage(mkMsg('/model codex'), p); await tick()
  assert.deepEqual(writes, [['G', 'codex', true]], '钉住的是当前这个 ⇒ keepSession')
  assert.equal(store.getFailover('G'), null); assert.equal(eng._rt('G').pendingFailover, null)
  await eng.handleMessage(mkMsg('x'), p); await drain(eng)
  assert.equal(runner.calls[0].name, 'codex', '到点也不切回:人说了算')
  // 不在临时切换中、点名当前模型 ⇒ 仍是「没有变化」
  const store2 = mkStore(), p2 = mkPlatform(), w2 = []
  const eng2 = mkEngine(mkRunner({}), store2, { setProvider: async (c, n) => { w2.push([c, n]) } })
  await eng2.handleMessage(mkMsg('/model claude'), p2); await tick()
  assert.deepEqual(w2, []); assert.match(p2.replies[0], /没有变化/)
})

test('failover: /stop 落在结果与关锁之间 / 锁已被强制释放 ⇒ 额度错既不切也不重做(直接钉派发层那两道早返);两处落实点都是同步的', async () => {
  const mk = () => { const store = mkStore(), p = mkPlatform(), eng = mkEngine(mkRunner({}), store); const rt = eng._rt('G'); const job = { msg: mkMsg('x'), platform: p }; return { store, p, eng, rt, job } }
  const outcome = { status: 'error', provider: 'claude', quota: { kind: 'quota', window: 'weekly' }, errText: WEEKLY, sideEffects: false }
  // /stop:stopRequested 置位、锁还没松(release 才清它)
  { const { store, p, eng, rt, job } = mk(); rt.stopRequested = true; const r = eng._failoverAfterError(rt, job, outcome, false)
    assert.equal(r, undefined, '同步:不返回 Promise')
    assert.equal(store.getFailover('G'), null); assert.equal(rt.queue.length, 0, '不重做'); assert.equal(p.replies.length, 0, '不出声')
    assert.ok(store.isExhausted('claude'), '但主模型的「没额度」照记 —— 这是账号级事实,与这轮停没停无关') }
  // 锁已被 forceRelease:runner 迟到 resolve
  { const { store, eng, rt, job } = mk(); eng._failoverAfterError(rt, job, outcome, true)
    assert.equal(store.getFailover('G'), null); assert.equal(rt.queue.length, 0) }
  // 对照:两道都不成立 ⇒ 真切 + 真重做
  { const { store, eng, rt, job } = mk(); eng._failoverAfterError(rt, job, outcome, false)
    assert.equal(store.getProvider('G'), 'codex'); assert.equal(rt.queue.length, 1) }
  // _settleFailover 同样同步 —— 拿到锁到 controller 建好之间不能有 await(/stop · 中断 · 关停都默认这段原子)
  { const { store, eng, rt, job } = mk()
    store.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: Date.now() - 1, at: 1 })
    eng.quotaStatus = async () => ({ ok: true, windows: [] })
    assert.equal(eng._settleFailover(rt, job), undefined) }
})

test('failover: 群暂停不切;老 store(没有 failover 接口)整条路静默跳过', async () => {
  const old = mkStore(); delete old.getFailover; delete old.setFailover
  const p = mkPlatform(), runner = mkRunner()
  const eng = mkEngine(runner, old)
  await eng.handleMessage(mkMsg('x'), p); await drain(eng)
  assert.equal(runner.calls.length, 1); assert.equal(old.getProvider('G'), null)
  const c = cfg(); c.groups.G.paused = true
  const store2 = mkStore(), p2 = mkPlatform(), runner2 = mkRunner()
  const eng2 = mkEngine(runner2, store2, {}, c)
  await eng2.handleMessage(mkMsg('x'), p2); await drain(eng2)
  assert.equal(store2.getFailover('G'), null)
})

test('failover: 备用上重做仍是额度错 ⇒ 只切一次、不再重做(最多一跳,不来回);合批不会洗掉重做标', async () => {
  const store = mkStore(), p = mkPlatform()
  const runner = mkRunner({ claude: WEEKLY, codex: CODEX_LIMIT })
  const eng = mkEngine(runner, store)
  await eng.handleMessage(mkMsg('x'), p); await drain(eng)
  assert.equal(runner.calls.length, 2, 'claude 失败 → codex 重做失败 → 停')
  assert.ok(store.isExhausted('codex'))
  assert.equal(store.getProvider('G'), 'codex', 'codex 的备用是 claude,但 claude 标着没额度 ⇒ 不再切回去')
  // 合批:重做作业在队首、期间又来了新消息 ⇒ 代表是新消息,failedOver 必须「批内任一为真」
  const merged = eng._coalesce([{ msg: mkMsg('重做的'), failedOver: true, platform: p }, { msg: mkMsg('新来的'), platform: p }])
  assert.equal(merged.failedOver, true)
})

test('failover: quiet 插话触发的切换也要让群知道(走 send,不挂在那条无痕消息上);成功跑完一轮清掉该模型的不可用标', async () => {
  const store = mkStore(), p = mkPlatform(), runner = mkRunner()
  const eng = mkEngine(runner, store)
  await eng.handleMessage(mkMsg('x', 'G', { quiet: true, synthetic: true }), p); await drain(eng)
  assert.equal(store.getProvider('G'), 'codex')
  assert.equal(p.replies.length, 0, 'quiet:回复一条都没有')
  assert.match(p.sent.join('\n'), /已自动切到 codex/, '但切换本身是群级状态,走 send 说出来')
  // 成功轮清标:codex 刚跑成功 ⇒ 若之前被标过不可用,现在清掉
  store.markExhausted('codex', { until: null, kind: 'account' })
  await eng.handleMessage(mkMsg('y'), p); await drain(eng)
  assert.equal(store.isExhausted('codex'), false)
})

test('failover: 跨群预判 —— 别的群已标主模型不可用 ⇒ 这群下一轮直接在备用上起,不白跑一轮;备用也标了 / 没标则照旧', async () => {
  // 账号类(10-27 那种登录态到期):群 G 撞过一次后 claude 被标 exhausted(until null);群 H 第一次开口不该再去撞
  const store = mkStore(), p = mkPlatform(), runner = mkRunner({ claude: ON_HOLD })
  store.markExhausted('claude', { until: null, kind: 'account' })
  const eng = mkEngine(runner, store)
  await eng.handleMessage(mkMsg('h1', 'H'), p); await drain(eng, 'H')
  assert.equal(runner.calls.length, 1, '只跑一轮')
  assert.equal(runner.calls[0].name, 'codex', '一上来就在备用上')
  const rec = store.getFailover('H')
  assert.ok(rec && rec.home === 'claude' && rec.to === 'codex' && rec.kind === 'account' && rec.until === null)
  const said = p.replies.join('\n')
  assert.match(said, /账号暂时不可用/); assert.match(said, /已自动切到 codex/); assert.match(said, /ok from codex/)
  assert.doesNotMatch(said, /重做/, '没有失败轮,自然没有重做')
  // 额度类带 until:记录带着同一个 until,文案带「到点切回」
  const until = Date.now() + 3 * 3600e3
  const store2 = mkStore(), p2 = mkPlatform(), runner2 = mkRunner({ claude: WEEKLY })
  store2.markExhausted('claude', { until, kind: 'quota' })
  const eng2 = mkEngine(runner2, store2)
  await eng2.handleMessage(mkMsg('h2', 'H'), p2); await drain(eng2, 'H')
  assert.equal(runner2.calls.map((c) => c.name).join(','), 'codex')
  assert.equal(store2.getFailover('H').until, until)
  assert.match(p2.replies.join('\n'), /到点切回/)
  // 对照组 ①:没标 ⇒ 照常在 claude 上起(这里 claude 会报错再切,那是另一条路;只钉第一轮用的是 claude)
  const store3 = mkStore(), p3 = mkPlatform(), runner3 = mkRunner({ claude: WEEKLY })
  const eng3 = mkEngine(runner3, store3)
  await eng3.handleMessage(mkMsg('h3', 'H'), p3); await drain(eng3, 'H')
  assert.equal(runner3.calls[0].name, 'claude')
  // 对照组 ②:备用也标了 ⇒ 不预判(照旧在主模型上起,让出错路去说「只能等」)
  const store4 = mkStore(), p4 = mkPlatform(), runner4 = mkRunner({ claude: WEEKLY, codex: CODEX_LIMIT })
  store4.markExhausted('claude', { until: null, kind: 'account' }); store4.markExhausted('codex', { until: Date.now() + 3600e3 })
  const eng4 = mkEngine(runner4, store4)
  await eng4.handleMessage(mkMsg('h4', 'H'), p4); await drain(eng4, 'H')
  assert.equal(runner4.calls[0].name, 'claude')
  assert.equal(store4.getFailover('H'), null)
  // 对照组 ③:标已过期 ⇒ 不预判
  const store5 = mkStore(), p5 = mkPlatform(), runner5 = mkRunner({})
  store5.markExhausted('claude', { until: Date.now() - 1, kind: 'quota' })
  const eng5 = mkEngine(runner5, store5)
  await eng5.handleMessage(mkMsg('h5', 'H'), p5); await drain(eng5, 'H')
  assert.equal(runner5.calls[0].name, 'claude'); assert.equal(store5.getFailover('H'), null)
})

test('failover: 额度类但原话里解不出重置时刻(until null)⇒ 探针探到窗口的 resetsAt 就吸收进记录,之后按时间等;探针抛错不炸 daemon', async () => {
  const store = mkStore(), p = mkPlatform(), runner = mkRunner({})
  const later = Date.now() + 4 * 3600e3
  const eng = mkEngine(runner, store, { quotaStatus: async () => ({ ok: true, windows: [{ kind: 'session', percent: 100, resetsAt: later }] }) })
  store.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: null, at: Date.now() - 3600e3 })
  await eng.handleMessage(mkMsg('x'), p); await drain(eng); await tick(30)
  assert.equal(store.getFailover('G').until, later, '吸收探针给的重置时刻')
  assert.equal(eng._rt('G').pendingFailover, undefined)
  // 账号类不吸收(它没有重置时刻这回事)
  const store2 = mkStore(), p2 = mkPlatform(), runner2 = mkRunner({})
  const eng2 = mkEngine(runner2, store2, { quotaStatus: async () => ({ ok: true, windows: [{ kind: 'session', percent: 100, resetsAt: later }] }) })
  store2.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'account', until: null, at: Date.now() - 3600e3 })
  await eng2.handleMessage(mkMsg('x'), p2); await drain(eng2); await tick(30)
  assert.equal(store2.getFailover('G').until, null)
  // 探针结果落地时 store 抛错(落盘失败那类)⇒ 吞掉并记日志,不是 unhandled rejection
  const store3 = mkStore(), p3 = mkPlatform(), runner3 = mkRunner({})
  store3.touchFailover = () => { throw new Error('disk full') }
  const logs = []
  const eng3 = mkEngine(runner3, store3, { log: (l) => logs.push(l), quotaStatus: async () => ({ ok: true, windows: [{ kind: 'session', percent: 100, resetsAt: later }] }) })
  store3.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: null, at: Date.now() - 3600e3 })
  let unhandled = null
  const onUr = (e) => { unhandled = e }
  process.on('unhandledRejection', onUr)
  try {
    await eng3.handleMessage(mkMsg('x'), p3); await drain(eng3); await tick(50)
  } finally { process.off('unhandledRejection', onUr) }
  assert.equal(unhandled, null, '探针链尾必须有 catch')
  assert.ok(logs.some((l) => /failover probe settle failed/.test(l)), '要留一行日志')
  assert.equal(eng3._rt('G').failoverProbing, false, '探针标要复位,不然这群永远不再探')
})

// 运维告警钩子(onAlert,src/core/opsalert.js 写了事件形状):故障在事发点吐事件,**没配备用的群也吐**(生产机形状 —— 那是它唯一的出声渠道)。
test('failover: onAlert —— 账号类出错轮即使没配备用也吐 provider-down;配了备用再多吐一条 failover;钩子抛了不影响轮次', async () => {
  // 没配备用(生产机形状)
  { const c = cfg(); delete c.providers.claude.fallback
    const events = []
    const store = mkStore(), p = mkPlatform(), runner = mkRunner({ claude: ON_HOLD })
    const eng = mkEngine(runner, store, { onAlert: (ev) => events.push(ev) }, c)
    await eng.handleMessage(mkMsg('x'), p); await drain(eng)
    assert.equal(events.length, 1)
    const ev = events[0]
    assert.equal(ev.kind, 'provider-down'); assert.equal(ev.provider, 'claude'); assert.equal(ev.cause, 'account')
    assert.equal(ev.chatId, 'G'); assert.equal(ev.source, 'turn'); assert.equal(ev.until, null)
    assert.match(ev.detail, /account is on hold/, '原话随事件给接线层写日志(已过 turnErrText 脱敏;opsalert 不把它贴进群)') }
  // 配了备用:down + failover 两条,顺序固定
  { const events = []
    const store = mkStore(), p = mkPlatform(), runner = mkRunner()
    const eng = mkEngine(runner, store, { onAlert: (ev) => events.push(ev) })
    await eng.handleMessage(mkMsg('x'), p); await drain(eng)
    assert.deepEqual(events.map((e) => e.kind), ['provider-down', 'failover'])
    assert.equal(events[0].cause, 'quota'); assert.equal(events[0].window, 'weekly'); assert.equal(events[0].until, WEEKLY_AT)
    assert.deepEqual({ ...events[1], until: undefined }, { kind: 'failover', chatId: 'G', from: 'claude', to: 'codex', home: 'claude', cause: 'quota', until: undefined, back: false })
    assert.equal(events[1].until, WEEKLY_AT) }
  // 钩子抛错:轮次照常结算、照常切换
  { const store = mkStore(), p = mkPlatform(), runner = mkRunner()
    const eng = mkEngine(runner, store, { onAlert: () => { throw new Error('boom') } })
    await eng.handleMessage(mkMsg('x'), p); await drain(eng)
    assert.equal(store.getProvider('G'), 'codex'); assert.match(p.replies.join('\n'), /ok from codex/) }
})

test('failover: onAlert —— noteQuota 探到 95% 吐 provider-down(source=probe);退下去且之前标过才吐 provider-up(含标已过期的);没标过不吐', async () => {
  const events = []
  const store = mkStore(), runner = mkRunner({})
  const eng = mkEngine(runner, store, { onAlert: (ev) => events.push(ev) })
  const resetsAt = Date.now() + 3600e3
  eng.noteQuota('claude', { ok: true, windows: [{ kind: 'session', percent: 40, resetsAt }] })
  assert.equal(events.length, 0, '平时的探针不吐')
  eng.noteQuota('claude', { ok: true, windows: [{ kind: 'weekly', percent: 96, resetsAt }] })
  assert.deepEqual(events.pop(), { kind: 'provider-down', provider: 'claude', cause: 'quota', window: 'weekly', until: resetsAt, source: 'probe' })
  eng.noteQuota('claude', { ok: false })
  assert.deepEqual(events.pop(), { kind: 'provider-down', provider: 'claude', cause: 'account', window: null, until: null, source: 'probe' })
  eng.noteQuota('claude', { ok: true, windows: [{ kind: 'weekly', percent: 10, resetsAt }] })
  assert.deepEqual(events.pop(), { kind: 'provider-up', provider: 'claude' })
  assert.equal(store.isExhausted('claude'), false)
  eng.noteQuota('claude', { ok: true, windows: [{ kind: 'weekly', percent: 10, resetsAt }] })
  assert.equal(events.length, 0, '已经干净了再探到干净,不吐')
  // 额度类的标带 until:窗口过了 getExhausted 已查不到,但「探到干净」仍是恢复的证据,必须吐 provider-up(审查逮到的死代码)
  eng.noteQuota('claude', { ok: true, windows: [{ kind: 'weekly', percent: 97, resetsAt: Date.now() + 50 }] })
  assert.equal(events.pop().kind, 'provider-down')
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(store.getExhausted('claude'), null, '标已过期')
  eng.noteQuota('claude', { ok: true, windows: [{ kind: 'weekly', percent: 5, resetsAt: Date.now() + 3600e3 }] })
  assert.deepEqual(events.pop(), { kind: 'provider-up', provider: 'claude' })
})
