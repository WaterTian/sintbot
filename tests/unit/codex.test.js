// codexcode runner — pure-function coverage (event mapping, sandbox tiers, argv,
// context injection). The spawn/parse loop is exercised end-to-end on Windows
// (docs/CODEX-RUNNER.md); the event fixtures below are the real samples captured
// there on 2026-07-07 (codex 0.142.5).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { normalizeEvent, sandboxMode, buildArgs, buildPrompt, runTurn, parseCodexError, isEffortRejection } = require('../../src/agent/codexcode')

// A stand-in for a spawned `codex exec` child: EventEmitter with stdout/stderr streams,
// a no-op stdin, and a kill() that records the reap. `emitLine` feeds one JSONL event.
function fakeChild() {
  const child = new EventEmitter()
  child.pid = 4242
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { on() {}, end() {} }
  child.killed = false
  child.kill = () => { child.killed = true; return true }
  child.emitLine = (obj) => child.stdout.emit('data', Buffer.from(JSON.stringify(obj) + '\n'))
  return child
}

test('normalizeEvent: thread.started -> system/init with sessionId', () => {
  const ev = normalizeEvent({ type: 'thread.started', thread_id: '019f3b80-e149-7333-9d3c-19d1321f426e' })
  assert.deepEqual(ev, { type: 'system', subtype: 'init', sessionId: '019f3b80-e149-7333-9d3c-19d1321f426e' })
})

test('normalizeEvent: turn.started and other bookkeeping -> null', () => {
  assert.equal(normalizeEvent({ type: 'turn.started' }), null)
  assert.equal(normalizeEvent({ type: 'something.else' }), null)
})

test('normalizeEvent: agent_message text only on item.completed', () => {
  const started = normalizeEvent({ type: 'item.started', item: { id: 'i0', type: 'agent_message', text: 'x' } })
  assert.equal(started, null)
  const done = normalizeEvent({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: '已创建 a.txt' } })
  assert.deepEqual(done, { type: 'assistant', text: '已创建 a.txt' })
})

test('normalizeEvent: file_change -> Write/Delete tool_use on item.started', () => {
  const add = normalizeEvent({ type: 'item.started', item: { id: 'i1', type: 'file_change', changes: [{ path: 'C:\\tmp\\a.txt', kind: 'add' }], status: 'in_progress' } })
  assert.deepEqual(add, { type: 'assistant', tools: [{ name: 'Write', input: { path: 'C:\\tmp\\a.txt' } }] })
  const del = normalizeEvent({ type: 'item.started', item: { type: 'file_change', changes: [{ path: 'x', kind: 'delete' }] } })
  assert.equal(del.tools[0].name, 'Delete')
  // completed file_change is bookkeeping — ignore (the started already logged the tool)
  assert.equal(normalizeEvent({ type: 'item.completed', item: { type: 'file_change', changes: [], status: 'completed' } }), null)
})

test('normalizeEvent: command_execution -> Bash tool_use, then tool_result with error flag', () => {
  const started = normalizeEvent({ type: 'item.started', item: { type: 'command_execution', command: 'ls -la' } })
  assert.deepEqual(started, { type: 'assistant', tools: [{ name: 'Bash', input: { command: 'ls -la' } }] })
  const ok = normalizeEvent({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'out', exit_code: 0, status: 'completed' } })
  assert.equal(ok.type, 'tool_result')
  assert.equal(ok.results[0].is_error, false)
  const bad = normalizeEvent({ type: 'item.completed', item: { type: 'command_execution', aggregated_output: 'boom', exit_code: 1, status: 'completed' } })
  assert.equal(bad.results[0].is_error, true)
})

test('normalizeEvent: turn.completed carries usage marked CUMULATIVE, no text (caller fills)', () => {
  const usage = { input_tokens: 31071, output_tokens: 82 }
  const ev = normalizeEvent({ type: 'turn.completed', usage })
  // usageCumulative 是口径生命线:codex 报的是会话累计,engine 靠这面旗才知道要按基线求增量
  // (v0.11.17;缺了它 ledger 会把累计当单轮记,一句「好了吗」录出 322 万)。
  assert.deepEqual(ev, { type: 'result', subtype: 'success', usage, usageCumulative: true })
})

test('normalizeEvent: turn.failed / error -> error result', () => {
  const failed = normalizeEvent({ type: 'turn.failed', error: { message: 'nope' } })
  assert.equal(failed.type, 'result'); assert.equal(failed.subtype, 'error'); assert.equal(failed.isError, true); assert.equal(failed.text, 'nope')
  const err = normalizeEvent({ type: 'error', message: 'boom' })
  assert.equal(err.isError, true); assert.equal(err.text, 'boom')
})

test('sandboxMode: bypassPermissions -> full access; else read-only (fail-closed)', () => {
  assert.equal(sandboxMode('bypassPermissions'), 'danger-full-access')
  assert.equal(sandboxMode('dontAsk'), 'read-only')
  assert.equal(sandboxMode('default'), 'read-only')
  assert.equal(sandboxMode(undefined), 'read-only')
})

test('buildArgs: fresh turn uses --sandbox + --cd, ends on stdin', () => {
  const a = buildArgs({ model: 'gpt-5.5', workdir: '/proj', permissionMode: 'dontAsk' })
  assert.equal(a[0], 'exec')
  assert.ok(!a.includes('resume'))
  assert.ok(a.includes('--skip-git-repo-check'))
  // fresh: flag form, verified working
  assert.equal(a[a.indexOf('--sandbox') + 1], 'read-only')
  assert.ok(!a.some((x) => x.startsWith('sandbox_mode=')))
  assert.equal(a[a.indexOf('--model') + 1], 'gpt-5.5')
  assert.ok(a.includes('--json'))
  assert.equal(a[a.indexOf('--cd') + 1], '/proj')
  assert.equal(a[a.length - 1], '-')
})

test('buildArgs: resume uses `resume <id>` + `-c sandbox_mode=`, NO --sandbox/--cd', () => {
  const a = buildArgs({ sessionId: 'tid-1', model: 'gpt-5.5', workdir: '/proj', permissionMode: 'bypassPermissions' })
  assert.equal(a[a.indexOf('resume') + 1], 'tid-1')
  assert.ok(a.includes('-c'))
  assert.ok(a.includes('sandbox_mode=danger-full-access')) // resume rejects --sandbox (verified)
  assert.ok(!a.includes('--sandbox'))
  assert.ok(!a.includes('--cd')) // resume rejects --cd; relies on process cwd
  assert.ok(a.includes('approval_policy=never'))
  assert.equal(a[a.length - 1], '-')
})

test('buildArgs: autocompactTokens adds `-c model_auto_compact_token_limit=`(fresh + resume);0/缺省 ⇒ 无', () => {
  const fresh = buildArgs({ model: 'gpt-5.5', workdir: '/proj', permissionMode: 'dontAsk', autocompactTokens: 400000 })
  assert.ok(fresh.includes('model_auto_compact_token_limit=400000'))
  const resume = buildArgs({ sessionId: 't1', model: 'gpt-5.5', permissionMode: 'dontAsk', autocompactTokens: 400000 })
  assert.ok(resume.includes('model_auto_compact_token_limit=400000'))
  for (const a of [buildArgs({ model: 'gpt-5.5', workdir: '/proj', permissionMode: 'dontAsk', autocompactTokens: 0 }),
                   buildArgs({ model: 'gpt-5.5', workdir: '/proj', permissionMode: 'dontAsk' })]) {
    assert.ok(!a.some((x) => String(x).includes('auto_compact')))
  }
})

test('buildArgs: reasoningEffort adds `-c model_reasoning_effort=`; omitted ⇒ absent (fresh + resume)', () => {
  const fresh = buildArgs({ model: 'gpt-5.5', workdir: '/proj', permissionMode: 'dontAsk', reasoningEffort: 'high' })
  assert.ok(fresh.includes('model_reasoning_effort=high'))
  const resume = buildArgs({ sessionId: 'tid-1', model: 'gpt-5.5', permissionMode: 'dontAsk', reasoningEffort: 'minimal' })
  assert.ok(resume.includes('model_reasoning_effort=minimal')) // valid on resume too (a `-c` override)
  const none = buildArgs({ model: 'gpt-5.5', workdir: '/proj', permissionMode: 'dontAsk' })
  assert.ok(!none.some((x) => x.startsWith('model_reasoning_effort=')))
})

test('buildPrompt: preamble only on first turn, never on resume', () => {
  const first = buildPrompt('fix the bug', 'NO_REPLY convention here', false)
  assert.ok(first.includes('NO_REPLY convention here'))
  assert.ok(first.includes('User message:\nfix the bug'))
  assert.equal(buildPrompt('fix the bug', 'NO_REPLY convention here', true), 'fix the bug') // resume: unchanged
  assert.equal(buildPrompt('fix the bug', undefined, false), 'fix the bug') // no appendix: unchanged
})

// Resume safety (regression guard): the turn must resolve on the process 'close', NOT on
// `turn.completed` — codex finalizes its resumable rollout on CLEAN EXIT, so we must never
// hard-kill a still-running codex on the happy path (an earlier "settle at turn.completed then
// reap the clinging process" attempt destroyed the rollout → next resume: "no rollout found").
test('runTurn: does NOT settle on turn.completed nor kill the child — waits for clean close', async () => {
  const child = fakeChild()
  const p = runTurn({ prompt: 'hi', provider: { runner: 'codex' }, permissionMode: 'dontAsk', softStopGraceMs: 10_000, spawnFn: () => child })
  let state = 'pending'
  p.then(() => (state = 'resolved'), () => (state = 'rejected'))
  child.emitLine({ type: 'thread.started', thread_id: 'tid-xyz' })
  child.emitLine({ type: 'item.completed', item: { type: 'agent_message', text: '你好' } })
  child.emitLine({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } })
  await new Promise((r) => setTimeout(r, 30)) // give any errant early-settle/reap a chance to fire
  assert.equal(state, 'pending', 'must NOT resolve on turn.completed — codex finalizes rollout on clean exit')
  assert.equal(child.killed, false, 'must NOT kill a still-running codex — would destroy the resumable rollout')
  child.emit('close', 0) // clean exit → rollout finalized → now settle
  const { sessionId, result } = await p
  assert.equal(sessionId, 'tid-xyz')
  assert.equal(result.subtype, 'success')
  assert.equal(result.text, '你好') // caller fills result.text from the last agent_message
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 2 })
})

test('runTurn: no terminal event -> still resolves on close (crash path unchanged)', async () => {
  const child = fakeChild()
  const p = runTurn({ prompt: 'hi', provider: { runner: 'codex' }, permissionMode: 'dontAsk', spawnFn: () => child })
  let state = 'pending'
  p.then(() => (state = 'resolved'), () => (state = 'rejected'))
  child.emitLine({ type: 'thread.started', thread_id: 'tid-1' })
  await new Promise((r) => setImmediate(r))
  assert.equal(state, 'pending') // no turn.completed -> must keep waiting on close
  child.emit('close', 1) // codex died without a result -> non-zero close rejects
  await assert.rejects(p, /codex exited 1/)
})

// ③ codex 收尾时序: real-machine data confirmed close-lag ~2–3s, so the runner stays SILENT
// on healthy closes and only warns on a regression (>CLOSE_LAG_WARN_MS), well before the
// engine's 20s hardRelease backstop would force-release + forfeit the rollout.
test('runTurn: healthy (fast) close stays quiet; a slow close warns', async () => {
  // healthy: near-instant close → no warning
  {
    const child = fakeChild(); const logs = []
    const p = runTurn({ prompt: 'hi', provider: { runner: 'codex' }, permissionMode: 'dontAsk', log: (m) => logs.push(m), spawnFn: () => child })
    child.emitLine({ type: 'thread.started', thread_id: 'tid-ok' })
    child.emitLine({ type: 'item.completed', item: { type: 'agent_message', text: '你好' } })
    child.emitLine({ type: 'turn.completed', usage: {} })
    child.emit('close', 0)
    await p
    assert.equal(logs.some((m) => /答案→close/.test(m)), false)
  }
  // regression: 9s answer→close (injected clock) → warns
  {
    const child = fakeChild(); const logs = []; let t = 1000; const now = () => t
    const p = runTurn({ prompt: 'hi', provider: { runner: 'codex' }, permissionMode: 'dontAsk', log: (m) => logs.push(m), now, spawnFn: () => child })
    child.emitLine({ type: 'thread.started', thread_id: 'tid-slow' })
    child.emitLine({ type: 'item.completed', item: { type: 'agent_message', text: '你好' } })
    child.emitLine({ type: 'turn.completed', usage: {} }) // answerAtMs = now() = 1000
    t = 1000 + 9000 // 9s later
    child.emit('close', 0)
    await p
    const line = logs.find((m) => /答案→close/.test(m))
    assert.ok(line, 'a 9s close should warn')
    assert.match(line, /codex 收尾偏慢: 答案→close 9000ms/)
  }
})

test('runTurn: does NOT log a rollout lag when aborted (rollout forfeited)', async () => {
  const child = fakeChild()
  const logs = []
  const ac = new AbortController()
  const p = runTurn({ prompt: 'hi', provider: { runner: 'codex' }, permissionMode: 'dontAsk', softStopGraceMs: 5, log: (m) => logs.push(m), signal: ac.signal, spawnFn: () => child })
  child.emitLine({ type: 'thread.started', thread_id: 'tid-ab' })
  child.emitLine({ type: 'item.completed', item: { type: 'agent_message', text: '部分' } })
  child.emitLine({ type: 'turn.completed', usage: {} })
  ac.abort() // /stop before close → hard-kill, forfeit the rollout
  await p
  child.emit('close', null) // a late close must not emit a rollout-lag line
  assert.equal(logs.some((m) => /答案→close/.test(m)), false)
})

// ── codex API error parsing + reasoning-effort graceful downgrade ─────────────────────
// The runtime rejects an effort the plan can't use (model/list over-reports the catalog:
// a Plus account's gpt-5.6-terra rejects max/ultra though model/list lists them). Rather
// than a dead group turn, the runner retries once WITHOUT the effort (model default).

test('parseCodexError: JSON blob → readable message + param; plain text passthrough', () => {
  const j = JSON.stringify({ error: { message: "Unsupported value: 'max' is not supported with the 'gpt-5.6-terra' model.", param: 'reasoning.effort', code: 'unsupported_value' } })
  const r = parseCodexError(j)
  assert.match(r.text, /Unsupported value: 'max'/)
  assert.equal(r.param, 'reasoning.effort')
  assert.equal(r.text.includes('{'), false) // never leak raw JSON to a group
  const plain = parseCodexError('boom')
  assert.equal(plain.text, 'boom')
  assert.equal(plain.param, '')
})

test('normalizeEvent: effort-rejection error → readable text + effortRejected flag', () => {
  const msg = JSON.stringify({ error: { message: "Unsupported value: 'ultra' ...", param: 'reasoning.effort', code: 'unsupported_value' } })
  const failed = normalizeEvent({ type: 'turn.failed', error: { message: msg } })
  assert.equal(failed.isError, true)
  assert.equal(failed.effortRejected, true)
  assert.match(failed.text, /Unsupported value: 'ultra'/)
  assert.equal(isEffortRejection(failed), true)
  const err = normalizeEvent({ type: 'error', message: msg })
  assert.equal(err.effortRejected, true)
  // a non-effort error carries no flag and isn't treated as an effort rejection
  const other = normalizeEvent({ type: 'turn.failed', error: { message: JSON.stringify({ error: { message: 'server overloaded', param: 'model' } }) } })
  assert.equal(other.effortRejected, undefined)
  assert.equal(isEffortRejection(other), false)
})

test('runTurn: rejected reasoning effort → retry once WITHOUT the effort (graceful downgrade)', async () => {
  const children = [fakeChild(), fakeChild()]
  const spawned = [] // argv per spawn
  let i = 0
  const spawnFn = (file, args) => { spawned.push(args); return children[i++] }
  const events = []
  const logs = []
  const p = runTurn({
    prompt: 'hi', provider: { runner: 'codex', reasoningEffort: 'max' }, permissionMode: 'dontAsk',
    softStopGraceMs: 10_000, onEvent: (ev) => events.push(ev), log: (m) => logs.push(m), spawnFn,
  })
  // attempt 1: the API rejects the effort
  children[0].emitLine({ type: 'thread.started', thread_id: 'tid-1' })
  children[0].emitLine({ type: 'turn.failed', error: { message: JSON.stringify({ error: { message: "Unsupported value: 'max' ...", param: 'reasoning.effort', code: 'unsupported_value' } }) } })
  children[0].emit('close', 1)
  await new Promise((r) => setTimeout(r, 20)) // let the retry spawn
  // attempt 2: no effort → succeeds
  children[1].emitLine({ type: 'thread.started', thread_id: 'tid-2' })
  children[1].emitLine({ type: 'item.completed', item: { type: 'agent_message', text: '答案' } })
  children[1].emitLine({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 3 } })
  children[1].emit('close', 0)
  const res = await p
  assert.equal(i, 2, 'must spawn exactly twice (original + one retry)')
  assert.equal(res.result.subtype, 'success')
  assert.equal(res.result.text, '答案')
  assert.equal(res.effortFellBack, 'max')
  assert.equal(res.sessionId, 'tid-2')
  assert.ok(spawned[0].includes('model_reasoning_effort=max'), 'attempt 1 carried the effort')
  assert.ok(!spawned[1].some((x) => String(x).startsWith('model_reasoning_effort=')), 'retry dropped the effort')
  assert.ok(!events.some((e) => e.type === 'result' && e.isError), 'the raw effort-error result is held back, never shown to the group')
  assert.ok(events.some((e) => e.type === 'result' && e.subtype === 'success'), 'the group gets the recovered answer')
  assert.ok(logs.some((m) => /回退模型默认/.test(m)), 'the downgrade is logged for the operator')
})

test('runTurn: a non-effort error does NOT retry (single spawn, readable error surfaces)', async () => {
  const children = [fakeChild()]
  let i = 0
  const spawnFn = () => children[i++]
  const p = runTurn({ prompt: 'hi', provider: { reasoningEffort: 'high' }, permissionMode: 'dontAsk', onEvent: () => {}, spawnFn })
  children[0].emitLine({ type: 'thread.started', thread_id: 't' })
  children[0].emitLine({ type: 'turn.failed', error: { message: JSON.stringify({ error: { message: 'server overloaded', param: 'model', code: 'server_error' } }) } })
  children[0].emit('close', 1)
  const res = await p
  assert.equal(i, 1, 'a non-effort error must not trigger a second spawn')
  assert.equal(res.result.isError, true)
  assert.match(res.result.text, /server overloaded/) // readable, not raw JSON
  assert.equal(res.effortFellBack, undefined)
})

test('runTurn: no configured effort → no wrapper retry path (single spawn on error)', async () => {
  const children = [fakeChild()]
  let i = 0
  const spawnFn = () => children[i++]
  const p = runTurn({ prompt: 'hi', provider: {}, permissionMode: 'dontAsk', onEvent: () => {}, spawnFn })
  children[0].emitLine({ type: 'thread.started', thread_id: 't' })
  children[0].emitLine({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } })
  children[0].emitLine({ type: 'turn.completed', usage: {} })
  children[0].emit('close', 0)
  const res = await p
  assert.equal(i, 1)
  assert.equal(res.result.subtype, 'success')
})

// ── 瞬时错(服务端过载)标人话,原话留给账本(2026-09-08 测试群现场)────────────────
test('normalizeEvent: at-capacity 这类瞬时错 → transient 人话 + text 仍是服务端原话', () => {
  const RAW = 'Selected model is at capacity. Please try a different model.'
  for (const ev of [
    { type: 'turn.failed', error: { message: RAW } },
    { type: 'turn.failed', error: { message: JSON.stringify({ error: { message: RAW, code: 'server_error' } }) } },
    { type: 'error', message: RAW },
  ]) {
    const r = normalizeEvent(ev)
    assert.equal(r.isError, true)
    assert.ok(r.transient && r.transient !== RAW, '应标一句人话(措辞由 transienterr.test 钉,这里不钉)')
    assert.equal(r.text, RAW, '账本要的是原话,不能被人话顶掉')
  }
  // 对照:普通错误不标(否则群里人人都被劝「稍后继续」)
  const other = normalizeEvent({ type: 'turn.failed', error: { message: 'nope' } })
  assert.equal(other.transient, undefined)
  assert.equal(other.text, 'nope')
})

// 额度 / 账号类出错结果标 quota(v0.11.107):turn.failed 与 error 两条路都标;其它错不标
test('normalizeEvent: codex 用量上限 ⇒ quota;普通失败不标', () => {
  const limit = "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:30 PM."
  const a = normalizeEvent({ type: 'turn.failed', error: { message: limit } })
  assert.ok(a.isError); assert.deepEqual(a.quota, { kind: 'quota', window: null }); assert.equal(a.transient, undefined)
  const b = normalizeEvent({ type: 'error', message: limit })
  assert.deepEqual(b.quota, { kind: 'quota', window: null })
  assert.equal(normalizeEvent({ type: 'turn.failed', error: { message: 'something broke' } }).quota, undefined)
})
