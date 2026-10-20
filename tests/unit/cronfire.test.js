'use strict'
// 定时任务到点做什么(src/core/cronfire.js,v0.11.103):三种任务各走各的路,依赖全注入。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createCronFire } = require('../../src/core/cronfire')

// send 可注入:默认回 undefined(桩平台 = 已送到);回 null = 平台确认没送到;抛错同义。
// timers:假定时器,calls.timers 里攒着 {fn, ms},tick() 逐个触发 —— 补发间隔按分钟计,真等不现实。
function harness({ groups = { G: { workdir: '/proj' } }, script = { code: 0, stdout: '', stderr: '', ms: 5 }, send, retryDelaysMs } = {}) {
  const calls = { msgs: [], sent: [], logs: [], rows: [], removed: [], runs: [], timers: [], cleared: 0 }
  let pending = []
  let clock = 1700000000000
  const fire = createCronFire({
    getGroup: (c) => groups[c],
    tz: () => 'Asia/Shanghai',
    handleMessage: (m) => { calls.msgs.push(m) },
    send: (c, t) => { calls.sent.push([c, t]); return send ? send(c, t) : undefined },
    retryDelaysMs,
    setTimer: (fn, ms) => { const t = { fn, ms, unref() {} }; calls.timers.push(t); return t },
    clearTimer: (t) => { calls.cleared++; calls.timers = calls.timers.filter((x) => x !== t) },
    redact: (s) => String(s).replace(/sk-[a-z0-9]+/g, '[redacted]'),
    log: (s) => calls.logs.push(s),
    ledger: { append: (r) => calls.rows.push(r) },
    removeTask: (c, id) => calls.removed.push(`${c}:${id}`),
    // script 是函数 ⇒ 同步调用(可同步抛,模拟 spawn 本身炸掉);否则挂起到 finishScripts 才回结果
    runScript: (opts) => { calls.runs.push(opts); if (typeof script === 'function') return script(opts); return new Promise((resolve) => pending.push(() => resolve(script))) },
    now: () => clock,
    env: { PATH: '/bin' },
    cwdFallback: '/fallback',
  })
  const finishScripts = () => { const p = pending; pending = []; p.forEach((f) => f()) }
  // 触发最早挂上的那个定时器(模拟到点),并把钟拨过去;等一个宏任务让补发的 promise 链走完
  const tick = async () => { const t = calls.timers.shift(); if (!t) throw new Error('没有待触发的定时器'); clock += t.ms; t.fn(); await new Promise((r) => setImmediate(r)) }
  return { fire, calls, finishScripts, tick }
}

test('cronfire: do ⇒ 合成消息喂 engine,带 cron 标与 resetSessionAfter', async () => {
  const h = harness()
  await h.fire({ chatId: 'G', id: 'a1', kind: 'do', text: '整理文档', resetSession: true })
  assert.equal(h.calls.msgs.length, 1)
  const m = h.calls.msgs[0]
  assert.equal(m.text, '整理文档'); assert.equal(m.synthetic, true); assert.equal(m.cron, true); assert.equal(m.resetSessionAfter, true)
  assert.equal(m.senderName, '定时任务'); assert.equal(m.msgId, 'cron:G:a1:1700000000000')
  assert.deepEqual(h.calls.sent, []); assert.deepEqual(h.calls.runs, [])
})

test('cronfire: say ⇒ 直发一条(过 redact),不喂 engine', async () => {
  const h = harness()
  await h.fire({ chatId: 'G', id: 'b1', kind: 'say', text: '提醒 sk-abc123' })
  assert.deepEqual(h.calls.sent, [['G', '提醒 [redacted]']])
  assert.equal(h.calls.msgs.length, 0)
})

test('cronfire: 暂停群到点三种任务都跳过', async () => {
  const h = harness({ groups: { G: { paused: true, workdir: '/p' } } })
  for (const kind of ['do', 'say', 'run']) await h.fire({ chatId: 'G', id: kind, kind, text: 'x' })
  assert.equal(h.calls.msgs.length + h.calls.sent.length + h.calls.runs.length, 0)
  assert.equal(h.calls.logs.filter((l) => /已暂停/.test(l)).length, 3)
})

test('cronfire: 一次性任务触发后即删(三种都一样)', async () => {
  const h = harness()
  await h.fire({ chatId: 'G', id: 'o1', kind: 'do', text: 'x', at: '2026-09-17 10:00', once: true })
  await h.fire({ chatId: 'G', id: 'o2', kind: 'say', text: 'x', once: true })
  const p = h.fire({ chatId: 'G', id: 'o3', kind: 'run', text: 'true', at: '2026-09-17 10:00' }); h.finishScripts(); await p
  assert.deepEqual(h.calls.removed, ['G:o1', 'G:o2', 'G:o3'])
  await h.fire({ chatId: 'G', id: 'r1', kind: 'do', text: 'x', expr: '@daily' })
  assert.equal(h.calls.removed.length, 3, '周期任务不删')
})

test('cronfire: run 成功 ⇒ 在项目根跑、TZ 带上、账本一行 script:true、群里一个字不出、不喂 engine', async () => {
  const h = harness({ script: { code: 0, stdout: 'report sent', stderr: '', ms: 1234 } })
  const p = h.fire({ chatId: 'G', id: 'r1', kind: 'run', text: 'node scripts/report.js' }); h.finishScripts(); await p
  assert.equal(h.calls.runs.length, 1)
  const o = h.calls.runs[0]
  assert.equal(o.command, 'node scripts/report.js'); assert.equal(o.cwd, '/proj'); assert.equal(o.env.TZ, 'Asia/Shanghai'); assert.equal(o.env.PATH, '/bin')
  assert.equal(o.timeoutMs, 15 * 60_000, '默认 15 分钟')
  assert.deepEqual(h.calls.sent, []); assert.deepEqual(h.calls.msgs, [])
  assert.equal(h.calls.rows.length, 1)
  const row = h.calls.rows[0]
  assert.equal(row.status, 'ok'); assert.equal(row.script, true); assert.equal(row.tokens, null); assert.equal(row.provider, null); assert.equal(row.ms, 1234); assert.equal(row.sender, '定时任务')
  assert.ok(!('err' in row))
})

test('cronfire: run 失败 ⇒ 群里一句人话附输出末尾(过 redact),账本 error 带原因', async () => {
  const h = harness({ script: { code: 2, stdout: '', stderr: 'boom sk-zzz9\nfatal', ms: 50 } })
  const p = h.fire({ chatId: 'G', id: 'r2', kind: 'run', text: 'node scripts/x.js', note: '数据日报' }); h.finishScripts(); await p
  assert.equal(h.calls.sent.length, 1)
  assert.match(h.calls.sent[0][1], /^❌ 定时脚本没跑成功\(退出码 2\)· 数据日报\n/)
  assert.match(h.calls.sent[0][1], /\[redacted\]/); assert.match(h.calls.sent[0][1], /fatal/)
  assert.equal(h.calls.msgs.length, 0, '默认不叫 agent')
  assert.equal(h.calls.rows[0].status, 'error'); assert.equal(h.calls.rows[0].err, '退出码 2')
})

test('cronfire: run 失败 + escalate ⇒ 把输出交给 agent(合成 do 消息),群里不另发提示', async () => {
  const h = harness({ script: { code: 1, stdout: 'last line', stderr: '', ms: 50 } })
  const p = h.fire({ chatId: 'G', id: 'r3', kind: 'run', text: 'node scripts/x.js', escalate: true }); h.finishScripts(); await p
  assert.equal(h.calls.sent.length, 0)
  assert.equal(h.calls.msgs.length, 1)
  assert.match(h.calls.msgs[0].text, /退出码 1/); assert.match(h.calls.msgs[0].text, /node scripts\/x\.js/); assert.match(h.calls.msgs[0].text, /last line/)
  assert.equal(h.calls.msgs[0].cron, true)
})

test('cronfire: 同一脚本任务上一次还没跑完 ⇒ 这次跳过;跑完后再到点照跑', async () => {
  const h = harness()
  const t = { chatId: 'G', id: 'r4', kind: 'run', text: 'sleep' }
  const p1 = h.fire(t)
  await h.fire(t)
  assert.equal(h.calls.runs.length, 1, '第二次不该再起一个')
  assert.ok(h.calls.logs.some((l) => /还没跑完/.test(l)))
  h.finishScripts(); await p1
  const p3 = h.fire(t); h.finishScripts(); await p3
  assert.equal(h.calls.runs.length, 2)
  assert.equal(h.calls.rows.length, 2)
})

test('cronfire: timeoutMin 与群没配 workdir 时的 cwd 兜底', async () => {
  const h = harness({ groups: { G: {} } })
  const p = h.fire({ chatId: 'G', id: 'r5', kind: 'run', text: 'x', timeoutMin: 3 }); h.finishScripts(); await p
  assert.equal(h.calls.runs[0].timeoutMs, 180_000); assert.equal(h.calls.runs[0].cwd, '/fallback')
})

test('cronfire: 脚本执行本身抛异常 ⇒ 只记日志,不炸调度器,锁位释放', async () => {
  const h = harness({ script: () => { throw new Error('spawn exploded') } })
  await h.fire({ chatId: 'G', id: 'r6', kind: 'run', text: 'x' })
  assert.ok(h.calls.logs.some((l) => /执行异常.*spawn exploded/.test(l)), '同步抛也要走同一条异常路')
  await h.fire({ chatId: 'G', id: 'r6', kind: 'run', text: 'x' })
  assert.equal(h.calls.runs.length, 2, '异常后同一任务下次还能跑')
})

test('cronfire: inFlight 数在跑的脚本;abortAll 杀掉并清占位', async () => {
  const killed = []
  const h = (() => {
    const calls = { logs: [] }; let pending = []
    const fire = createCronFire({
      getGroup: () => ({ workdir: '/p' }), tz: () => 'UTC', handleMessage: () => {}, send: () => {}, log: (s) => calls.logs.push(s), ledger: null,
      runScript: ({ onChild }) => { onChild({ pid: 424242, kill: (sig) => killed.push(sig) }); return new Promise((resolve) => pending.push(resolve)) },
    })
    return { fire, calls, finish: () => { pending.forEach((r) => r({ code: 0, stdout: '', stderr: '', ms: 1 })); pending = [] } }
  })()
  const p = h.fire({ chatId: 'G', id: 'x', kind: 'run', text: 'sleep' })
  assert.equal(h.fire.inFlight(), 1)
  const n = h.fire.abortAll()
  assert.equal(n, 1); assert.equal(h.fire.inFlight(), 0)
  assert.ok(killed.includes('SIGKILL') || h.calls.logs.some((l) => /杀掉在跑的定时脚本/.test(l)), '假 pid 上 process.kill 会失败并退回 child.kill,两条路总得走一条')
  h.finish(); await p
})

test('cronfire: env 可以是按任务算的函数 —— 脚本拿到本群的 SBOT_CHAT_ID(09-17 18:00 那个洞)', async () => {
  let got
  const fire = createCronFire({
    getGroup: () => ({ workdir: '/p' }), tz: () => 'Asia/Shanghai', handleMessage: () => {}, send: () => {}, log: () => {},
    env: (task) => ({ PATH: '/bin', SBOT_CHAT_ID: task.chatId, SBOT_CONFIG: '/cfg.json' }),
    runScript: (o) => { got = o.env; return { code: 0, stdout: '', stderr: '', ms: 1 } },
  })
  await fire({ chatId: 'oc_x', id: 'e1', kind: 'run', text: 'sbot feishu send-msg hi' })
  assert.equal(got.SBOT_CHAT_ID, 'oc_x'); assert.equal(got.SBOT_CONFIG, '/cfg.json'); assert.equal(got.TZ, 'Asia/Shanghai'); assert.equal(got.PATH, '/bin')
})


// ---- 直发消息发不出去时补发(09-17 21:00 断网那次:失败提示随断网一起丢了,群里对失败一无所知)----

test('cronfire: 失败提示发不出去(send 回 null)⇒ 挂 1 分钟补发;补发正文带「补发 · 原定几点」;成功后清空', async () => {
  let fail = true
  const h = harness({ script: { code: 1, stdout: '', stderr: 'boom', ms: 50 }, send: () => (fail ? null : 'om_1') })
  const p = h.fire({ chatId: 'G', id: 'r9', kind: 'run', text: 'node x.js', note: '看板刷新' }); h.finishScripts(); await p
  assert.equal(h.calls.sent.length, 1, '第一次照发')
  assert.equal(h.fire.undelivered(), 1)
  assert.equal(h.calls.timers.length, 1); assert.equal(h.calls.timers[0].ms, 60_000, '第一次补发 1 分钟后')
  assert.ok(h.calls.logs.some((l) => /发不出去.*1 分钟后补发\(第 1 次\)/.test(l)), h.calls.logs.join('|'))
  fail = false
  await h.tick()
  assert.equal(h.calls.sent.length, 2)
  assert.match(h.calls.sent[1][1], /^\(补发 · 原定 2023-11-15 06:13 发出,当时发不出去\)\n❌ 定时脚本没跑成功\(退出码 1\)· 看板刷新/)
  assert.equal(h.fire.undelivered(), 0); assert.equal(h.calls.timers.length, 0)
  assert.ok(h.calls.logs.some((l) => /补发成功\(第 1 次\)/.test(l)))
})

test('cronfire: 第一次就送到的(send 回 undefined / message_id)不挂补发;send 抛错与回 null 同路', async () => {
  const ok = harness({ script: { code: 1, stdout: '', stderr: '', ms: 1 } })
  let p = ok.fire({ chatId: 'G', id: 'a', kind: 'run', text: 'x' }); ok.finishScripts(); await p
  assert.equal(ok.fire.undelivered(), 0); assert.equal(ok.calls.timers.length, 0)
  const thrown = harness({ send: () => { throw new Error('socket hang up') } })
  await thrown.fire({ chatId: 'G', id: 's1', kind: 'say', text: '早安' })
  assert.equal(thrown.fire.undelivered(), 1); assert.equal(thrown.calls.timers.length, 1)
  assert.ok(thrown.calls.logs.some((l) => /socket hang up/.test(l)))
})

test('cronfire: 间隔表 1/5/15/30 分钟,四次都不成 ⇒ 放弃并记日志,占位清零', async () => {
  const h = harness({ send: () => null })
  await h.fire({ chatId: 'G', id: 's2', kind: 'say', text: '晚安' })
  const seen = [h.calls.timers[0].ms]
  for (let i = 0; i < 3; i++) { await h.tick(); seen.push(h.calls.timers[0].ms) }
  assert.deepEqual(seen, [60_000, 300_000, 900_000, 1_800_000])
  await h.tick()
  assert.equal(h.calls.sent.length, 5, '首发 + 四次补发')
  assert.equal(h.fire.undelivered(), 0); assert.equal(h.calls.timers.length, 0)
  assert.ok(h.calls.logs.some((l) => /放弃补发\(4 次都发不出去\)/.test(l)), h.calls.logs.join('|'))
})

test('cronfire: 同一任务再次失败时只换正文不叠加(旧定时器清掉),原定时间保留第一次的', async () => {
  const h = harness({ script: { code: 1, stdout: '', stderr: 'first', ms: 1 }, send: () => null, retryDelaysMs: [1000, 1000] })
  let p = h.fire({ chatId: 'G', id: 'r1', kind: 'run', text: 'x', note: '任务甲' }); h.finishScripts(); await p
  assert.equal(h.fire.undelivered(), 1); assert.equal(h.calls.timers.length, 1)
  p = h.fire({ chatId: 'G', id: 'r1', kind: 'run', text: 'x', note: '任务甲' }); h.finishScripts(); await p
  assert.equal(h.fire.undelivered(), 1, '还是一条'); assert.equal(h.calls.timers.length, 1, '旧定时器被清、只剩新的'); assert.ok(h.calls.cleared >= 1)
  const h2 = harness({ send: () => null, retryDelaysMs: [1000] })
  await h2.fire({ chatId: 'G', id: 's', kind: 'say', text: '一' })
  await h2.fire({ chatId: 'G', id: 's', kind: 'say', text: '二' })
  await h2.tick()
  assert.match(h2.calls.sent.at(-1)[1], /原定 2023-11-15 06:13 发出/); assert.match(h2.calls.sent.at(-1)[1], /\n二$/)
  // 换过正文的那条补发只发一次:「一」永远不会再出现在群里
  assert.equal(h2.calls.sent.filter(([, t]) => /^\(补发/.test(t)).length, 1)
})

test('cronfire: abortAll 连待补发的定时器一起清掉并记日志', async () => {
  const h = harness({ send: () => null })
  await h.fire({ chatId: 'G', id: 's3', kind: 'say', text: '嗨' })
  assert.equal(h.fire.undelivered(), 1)
  h.fire.abortAll()
  assert.equal(h.fire.undelivered(), 0); assert.equal(h.calls.timers.length, 0)
  assert.ok(h.calls.logs.some((l) => /关停:放弃补发 G:s3:say/.test(l)))
})
