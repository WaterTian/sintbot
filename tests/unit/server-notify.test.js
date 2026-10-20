// Config-change → group notice: when the operator changes a group's model / permission /
// plugins in the console, the daemon posts a concise notice into that group (via
// control.notifyGroup). This drives the real HTTP endpoints against a temp config + a
// mock control, asserting the right message reaches the group. Only fires when a daemon
// wired a control; `sbot ui` standalone (no control) is a no-op (not exercised here).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createUiServer } = require('../../src/ui/server')

async function withServer(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-notify-'))
  const cfgPath = path.join(dir, 'sbot.config.json')
  // ⚠ workdir 必须与配置所在目录**分开** —— 混成同一个目录的话,「探的是群 workdir」与
  // 「探的是配置目录」两种实现都能让测试变绿(判据没有分辨力)。
  const workdir = path.join(dir, 'proj'); fs.mkdirSync(workdir)
  fs.writeFileSync(cfgPath, JSON.stringify({
    providers: { volcano: { model: 'glm-5.2[1m]' }, claude: {} },
    defaultProvider: 'claude',
    groups: { G: { workdir, provider: 'claude', plugins: { mcp: ['old'], skills: [] } } },
  }))
  const notices = []
  const control = { setProvider() {}, clearSession() {}, stop() {}, interrupt() {}, notifyGroup: (chatId, text) => notices.push({ chatId, text }) }
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, control })
  await new Promise((r) => ui.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${ui.server.address().port}`
  // 锚点抠不到就先关服务器再抛:否则心跳定时器让 node --test 永不退出,CI 静默挂死而不是变红(2026-09-07 踩过)
  const tokenMatch = (await (await fetch(base + '/')).text()).match(/let TOKEN='([a-f0-9]{32})'/)
  if (!tokenMatch) { ui.close(); throw new Error('页面里抠不到注入的令牌锚点') }
  const token = tokenMatch[1]
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'x-sbot-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try { await run({ post, notices, cfgPath, workdir }) } finally { ui.close() }
}

test('server: switching model posts a concise "模型已切到" notice with session-reset', async () => {
  await withServer(async ({ post, notices }) => {
    const r = await post('/api/groups/provider', { chatId: 'G', provider: 'volcano' })
    assert.equal(r.status, 200)
    assert.equal(notices.length, 1)
    assert.equal(notices[0].chatId, 'G')
    assert.match(notices[0].text, /模型已切到 volcano · glm-5\.2\[1m\]/)
    assert.match(notices[0].text, /会话已重置/)
  })
})

// 换脑 = 会话清空,群成员当场最担心的是「之前交代过的都白说了」。项目里确实有沉淀才补这句 ——
// ⚠ 没有沉淀的项目说了就是假话(承诺它会读、其实无处可读)。
test('server: 切模型 — 项目有长期沉淀时补一句「不必从头交代」', async () => {
  await withServer(async ({ post, notices, workdir, cfgPath }) => {
    fs.writeFileSync(path.join(workdir, 'CLAUDE.md'), '# 项目约定')
    await post('/api/groups/provider', { chatId: 'G', provider: 'volcano' })
    assert.match(notices[0].text, /会话已重置/)                    // 对照组:原有内容没被挤掉
    assert.match(notices[0].text, /不必从头交代/)
    // ⚠ 只陈述事实,**不承诺行为** —— 读不读是半可信 agent 的事,编排层保证不了
    assert.doesNotMatch(notices[0].text, /会先读|会自动读/)
    // 用户面零工具名 / 零机器路径。⚠ 判据要用**本用例真会出现的东西**:断言不含 workdir 与
    // 配置目录这两条真实路径,以及约定文件名 —— 而不是断言不含一个本来就不可能出现的字面量。
    assert.doesNotMatch(notices[0].text, new RegExp(workdir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(notices[0].text, new RegExp(path.dirname(cfgPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(notices[0].text, /CLAUDE\.md|AGENTS\.md|MEMORY\.md|sbot/)
  })
})

// ⭐ 判据必须与自知清单**同一个函数**,且按**切换之后**那个大脑算 —— 它才是接下来读东西的那个。
// 这两处曾经分叉:server 只问「有没有东西」,而清单另有一层「够不够得着」的门控 ⇒ 出现过
// 「群里说都还在,而清单一个字都没给、那个目录 agent 还够不着」。
test('server: 切模型 — 调的是清单同一个判据,并按切换后的大脑算 {full,isCodex}', async () => {
  const pm = require('../../src/projectmemory')
  const orig = pm.probeHandover
  const calls = []
  pm.probeHandover = (wd, o) => { calls.push({ wd, o }); return orig(wd, o) }
  try {
    await withServer(async ({ post, cfgPath, workdir }) => {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
      raw.providers.gpt = { runner: 'codex', model: 'm' }
      fs.writeFileSync(cfgPath, JSON.stringify(raw))
      // ① 非完全访问 + 切到 claude 系 ⇒ {full:false, isCodex:false}
      await post('/api/groups/provider', { chatId: 'G', provider: 'volcano' })
      assert.equal(calls.length, 1, '必须真的调到了那个共用判据')
      assert.equal(calls[0].wd, workdir)
      assert.deepEqual(calls[0].o, { full: false, isCodex: false })
      // ② 切到 codex 系 ⇒ isCodex 跟着**目标** provider 变(不是切换前那个)
      await post('/api/groups/provider', { chatId: 'G', provider: 'gpt' })
      assert.deepEqual(calls[1].o, { full: false, isCodex: true })
      // ③ 放开权限后再切 ⇒ full 为真(对照组:证明 full 不是恒 false)
      await post('/api/groups/policy', { chatId: 'G', permissionMode: 'bypassPermissions' })
      await post('/api/groups/provider', { chatId: 'G', provider: 'volcano' })
      assert.deepEqual(calls[2].o, { full: true, isCodex: false })
    })
  } finally { pm.probeHandover = orig }
})

// ⚠ 那句话**群内 /model 也要说**(engine 侧同款断言)。两处各写一份必然漂移 ⇒ 文案只有一处,
// 由读取器返回。这条钉的就是「server 没有自己另写一份」——它若写死同样的字,上面那条照样绿。
test('server: 切模型 — 那句交接文案取自读取器,不是本地又写了一份', async () => {
  const pm = require('../../src/projectmemory')
  const orig = pm.probeHandover
  pm.probeHandover = () => ({ convention: ['CLAUDE.md'], memory: null, landing: 'CLAUDE.md', note: '独一无二的交接文案占位' })
  try {
    await withServer(async ({ post, notices }) => {
      await post('/api/groups/provider', { chatId: 'G', provider: 'volcano' })
      assert.match(notices[0].text, /独一无二的交接文案占位/)
    })
  } finally { pm.probeHandover = orig }
  // 对照组:真实读取器给的是那句真文案(证明上面不是把探测整个短路了)
  assert.match(pm.HANDOVER_NOTE, /不必从头交代/)
})

test('server: 切模型 — 项目没有任何沉淀时不说那句(说了就是假话)', async () => {
  await withServer(async ({ post, notices }) => {
    await post('/api/groups/provider', { chatId: 'G', provider: 'volcano' })
    assert.match(notices[0].text, /会话已重置/)                    // 对照组:通知本身照发
    assert.doesNotMatch(notices[0].text, /不必从头交代/)
  })
})

test('server: switching to full-access posts a warning notice', async () => {
  await withServer(async ({ post, notices }) => {
    await post('/api/groups/policy', { chatId: 'G', permissionMode: 'bypassPermissions' })
    assert.equal(notices.length, 1)
    assert.match(notices[0].text, /完全访问/)
  })
})

test('server: updating plugins posts an "插件已更新" notice listing them', async () => {
  await withServer(async ({ post, notices }) => {
    await post('/api/groups/plugins', { chatId: 'G', mcp: ['chrome-devtools', 'foo'], skills: [] })
    assert.equal(notices.length, 1)
    assert.match(notices[0].text, /插件已更新:chrome-devtools、foo/)
  })
})

test('server: 暂停群不再收到配置变更通知(模型/权限/插件全静默);暂停/恢复告知本身 force 送达', async () => {
  await withServer(async ({ post, notices }) => {
    // 暂停:告知本身必须送达(暂停后群唯一还会收到的一条)
    await post('/api/groups/pause', { chatId: 'G', paused: true })
    assert.equal(notices.length, 1)
    assert.match(notices[0].text, /⏸.*已暂停/)
    // 暂停期间改模型/权限/插件 —— 一条都不发(2026-07-22 真机踩过:暂停群仍收到「模型已更新」)
    await post('/api/groups/provider', { chatId: 'G', provider: 'volcano' })
    await post('/api/groups/policy', { chatId: 'G', permissionMode: 'bypassPermissions' })
    await post('/api/groups/plugins', { chatId: 'G', mcp: ['x'], skills: [] })
    assert.equal(notices.length, 1, '暂停群的配置变更通知必须静默')
    // 恢复:告知送达;此后配置变更通知恢复正常
    await post('/api/groups/pause', { chatId: 'G', paused: false })
    assert.equal(notices.length, 2)
    assert.match(notices[1].text, /▶.*已恢复/)
    await post('/api/groups/provider', { chatId: 'G', provider: 'claude' })
    assert.equal(notices.length, 3)
  })
})

// ── 群预览策略(常驻开关)——  operator 的正规入口 ──────────────────────────────
// 真机由来(2026-07-30 反向诱导测试):群里要「随时都能打开」,agent 自己造了份配置用 --config
// 把回收全关。禁掉那条绕法后,合理需求必须有正规出口,否则它还会再找别的绕法。

test('server: 勾常驻写 groups[chatId].preview 并发群通知;取消则回默认策略', async () => {
  await withServer(async ({ post, notices, cfgPath }) => {
    let r = await post('/api/groups/preview', { chatId: 'G', persist: true })
    assert.equal(r.status, 200)
    let raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.deepEqual(raw.groups.G.preview, { idleMin: 0, maxHours: 0 })
    assert.match(notices.at(-1).text, /常驻/)
    assert.match(notices.at(-1).text, /不再按闲置或时长自动停止/)

    r = await post('/api/groups/preview', { chatId: 'G', persist: false })
    assert.equal(r.status, 200)
    raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.equal(raw.groups.G.preview, undefined, '取消常驻后该块应删掉(回顶层/默认策略)')
    assert.match(notices.at(-1).text, /默认回收策略/)
  })
})

test('server: 常驻开关**合并**而非整块替换 —— 不抹掉 operator 手配的其它预览字段', async () => {
  await withServer(async ({ post, cfgPath }) => {
    // operator 手配了该群的绑定地址(只给本机看)
    const raw0 = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    raw0.groups.G.preview = { host: '127.0.0.1' }
    fs.writeFileSync(cfgPath, JSON.stringify(raw0))

    await post('/api/groups/preview', { chatId: 'G', persist: true })
    let raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.equal(raw.groups.G.preview.host, '127.0.0.1', 'host 不该被整块替换抹掉')
    assert.equal(raw.groups.G.preview.idleMin, 0)

    await post('/api/groups/preview', { chatId: 'G', persist: false })
    raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.deepEqual(raw.groups.G.preview, { host: '127.0.0.1' }, '取消常驻只摘这两个键,块里还有别的就保留')
  })
})

test('server: 不存在的群 ⇒ 404,不写配置', async () => {
  await withServer(async ({ post, notices }) => {
    const r = await post('/api/groups/preview', { chatId: 'NOPE', persist: true })
    assert.equal(r.status, 404)
    assert.equal(notices.length, 0)
  })
})

// ── 数据明文开关(v0.11.6):/api/groups/redact —— PII 按群放行,落盘只写 false、关掉删字段 ──

test('server: 数据明文开关写 redactPii:false、关掉删字段;两向都通知群;未知群 404', async () => {
  await withServer(async ({ post, cfgPath, notices }) => {
    let r = await post('/api/groups/redact', { chatId: 'G', showPii: true })
    assert.equal(r.status, 200)
    let raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.equal(raw.groups.G.redactPii, false)
    assert.match(notices.at(-1).text, /明文/)
    assert.match(notices.at(-1).text, /密钥类信息仍会自动遮盖/) // 通知里把边界说全,别让群成员以为密钥也见光

    r = await post('/api/groups/redact', { chatId: 'G', showPii: false })
    assert.equal(r.status, 200)
    raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    assert.equal(raw.groups.G.redactPii, undefined, '恢复遮盖后字段应删掉(完全可逆惯例)')
    assert.match(notices.at(-1).text, /恢复.*遮盖|遮盖/)

    r = await post('/api/groups/redact', { chatId: 'oc_zzz', showPii: true })
    assert.equal(r.status, 404)
  })
})
