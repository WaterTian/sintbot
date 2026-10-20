// Claude 订阅额度(v0.11.3,cc-hud 同源通道)—— 纯函数网:凭据解析(过期即弃、绝不代刷)、
// limits[] 防御式解析、口径对齐 codex 的「剩 x% ↺重置」措辞、curl 兜底的 token 字符集门。
// 样本 = 2026-08-03 本机对 api/oauth/usage 的真实响应形状。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const cu = require('../../src/agent/claudeusage')
const { parseCredentials, parseLimits, formatClaudeUsage, fetchCurl, readCurlResult, fetchRaw, usageLine, clearCache } = cu

const NOW = Date.parse('2026-08-03T06:00:00Z')

// ── parseCredentials:过期即弃(纪律:token 轮换是 Claude Code 的事,绝不代刷) ──

test('claudeusage: parseCredentials 有效 token 带出、过期返回 null', () => {
  const raw = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-xyz', expiresAt: NOW + 3600_000 } })
  assert.equal(parseCredentials(raw, NOW), 'sk-ant-oat-xyz')
  const expired = JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat-xyz', expiresAt: NOW - 1 } })
  assert.equal(parseCredentials(expired, NOW), null, '过期 ⇒ null(显示未验证,不代刷)')
})

test('claudeusage: parseCredentials 坏 JSON / 缺字段不抛', () => {
  assert.equal(parseCredentials('not json'), null)
  assert.equal(parseCredentials('{}'), null)
  assert.equal(parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: '' } })), null)
  assert.equal(parseCredentials(null), null)
})

test('claudeusage: parseCredentials 无 expiresAt 视为有效(形状演进防御)', () => {
  assert.equal(parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: 't' } }), NOW), 't')
})

// ── parseLimits:真实形状 ──

const REAL = {
  five_hour: { utilization: 79 }, // 旧版字段,应被忽略(只认 limits[])
  limits: [
    { kind: 'session', percent: 79, resets_at: '2026-08-03T12:09:59.631174+00:00', is_active: true, scope: null },
    { kind: 'weekly_all', percent: 72, resets_at: '2026-08-03T09:59:59.631195+00:00', is_active: false, scope: null },
    { kind: 'weekly_scoped', percent: 59, resets_at: '2026-08-03T09:59:59.631495+00:00', is_active: false, scope: { model: { display_name: 'Fable' } } },
  ],
}

test('claudeusage: parseLimits 真实样本三档全解析(scope 名带出)', () => {
  const l = parseLimits(REAL)
  assert.equal(l.length, 3)
  assert.deepEqual(l.map((x) => x.kind), ['session', 'weekly_all', 'weekly_scoped'])
  assert.equal(l[2].scopeName, 'Fable')
  assert.ok(l[0].resetsAt > 0)
})

test('claudeusage: parseLimits 形状不对给空数组不抛', () => {
  assert.deepEqual(parseLimits(null), [])
  assert.deepEqual(parseLimits({}), [])
  assert.deepEqual(parseLimits({ limits: 'nope' }), [])
  assert.deepEqual(parseLimits({ limits: [{ kind: 'session' }, null, { percent: 5 }] }), []) // 缺 percent/kind 的都滤掉
})

test('claudeusage: parseLimits 坏 resets_at ⇒ resetsAt null(仍保留该档)', () => {
  const l = parseLimits({ limits: [{ kind: 'session', percent: 10, resets_at: 'garbage' }] })
  assert.equal(l.length, 1)
  assert.equal(l[0].resetsAt, null)
})

// ── formatClaudeUsage:紧凑「已用」口径(v0.11.8)`5h:79% (6.2h) │ 7d:72% (4h) │ Fable:59% (4h)` ──

test('claudeusage: formatClaudeUsage 真实样本 → 紧凑已用口径', () => {
  const s = formatClaudeUsage(parseLimits(REAL), NOW)
  assert.equal(s, '5h:79% (6.2h) │ 7d:72% (4h) │ Fable:59% (4h)')
  // ⚠ 口径不是「剩余」—— 钉死防回退(v0.11.3~0.11.7 显示的是剩余,同屏两种口径会读反)
  assert.doesNotMatch(s, /剩/)
  assert.equal(s.split(' │ ').length, 3)
})

test('claudeusage: formatClaudeUsage 空/未知档如实收敛', () => {
  assert.equal(formatClaudeUsage([], 0), null)
  assert.equal(formatClaudeUsage(null, 0), null)
  // 未知窗口类型不猜(官方加新档时宁缺毋滥)
  assert.equal(formatClaudeUsage([{ kind: 'monthly_mystery', percent: 5, resetsAt: null, scopeName: '' }], 0), null)
})

test('claudeusage: formatClaudeUsage 重置已过期/超 9 天不显示括号', () => {
  const s = formatClaudeUsage([{ kind: 'session', percent: 50, resetsAt: NOW - 1000, scopeName: '' }], NOW)
  assert.equal(s, '5h:50%')
  const far = formatClaudeUsage([{ kind: 'session', percent: 50, resetsAt: NOW + 10 * 864e5, scopeName: '' }], NOW)
  assert.equal(far, '5h:50%')
})

test('claudeusage: 百分比夹在 [0,100](脏值不越界)', () => {
  assert.equal(formatClaudeUsage([{ kind: 'session', percent: 143, resetsAt: null, scopeName: '' }], NOW), '5h:100%')
  assert.equal(formatClaudeUsage([{ kind: 'session', percent: -5, resetsAt: null, scopeName: '' }], NOW), '5h:0%')
})

test('claudeusage: fmtDurDecimal 一位小数且不留尾零', () => {
  const { fmtDurDecimal } = require('../../src/agent/claudeusage')
  assert.equal(fmtDurDecimal(4 * 3600e3), '4h')      // 整数不写 4.0h
  assert.equal(fmtDurDecimal(6.2 * 3600e3), '6.2h')
  assert.equal(fmtDurDecimal(6.1 * 864e5), '6.1d')
  assert.equal(fmtDurDecimal(30 * 60e3), '30m')      // 不足 1 小时走分钟
  assert.equal(fmtDurDecimal(25 * 3600e3), '1d')
})

// ── curl 兜底的 token 字符集门(防 config 注入;坏 token 直接 null,零 spawn) ──

test('claudeusage: fetchCurl 拒绝带引号/换行/空格的 token', async () => {
  assert.equal(await fetchCurl('bad token'), null)
  assert.equal(await fetchCurl('inj"\nurl = "http://evil"'), null)
  assert.equal(await fetchCurl(''), null)
})

// ── readCurlResult:失败要留痕(此前 --fail 把状态码连 body 一起吞了,日志里什么都没有) ──

const BODY = JSON.stringify({ limits: [{ kind: 'session', percent: 10 }] })

test('claudeusage: readCurlResult 200 → 解析出数据且**不打日志**(成功不吵)', () => {
  const r = readCurlResult(null, BODY + '\n200')
  assert.deepEqual(r.data, JSON.parse(BODY))
  assert.equal(r.note, null)
})

test('claudeusage: readCurlResult 各类失败各留一行人话(状态码可辨)', () => {
  const cases = [
    [readCurlResult(null, '{"error":"rate"}\n429'), /限流|429/],
    [readCurlResult(null, 'oops\n500'), /500/],
    [readCurlResult(null, '\n403'), /403/],
    [readCurlResult(null, 'not json\n200'), /不是 JSON|解析/],
    [readCurlResult(null, ''), /状态码/],                                   // 连状态码都没写出来
    [readCurlResult(Object.assign(new Error('killed'), { killed: true }), ''), /超时/],
    [readCurlResult(Object.assign(new Error('t'), { code: 28 }), ''), /超时/], // 取数命令自己的 max-time
    [readCurlResult(Object.assign(new Error('x'), { code: 7 }), ''), /失败|退出码/],
  ]
  for (const [r, re] of cases) {
    assert.equal(r.data, null)
    assert.ok(r.note && re.test(r.note), `期望日志匹配 ${re},实际 ${r.note}`)
  }
})

test('claudeusage: readCurlResult 的日志行不带 token/授权头', () => {
  const err = new Error('Command failed: curl --config -\nAuthorization: Bearer sk-ant-oat-SECRET')
  const r = readCurlResult(err, '')
  assert.equal(r.data, null)
  assert.doesNotMatch(r.note, /sk-ant|Bearer|Authorization/i)
})

// ── fetchRaw:只走 curl · 失败重试一次 · 只缓存成功 ──

const mkCurl = (seq) => { // seq = 每次调用依次返回什么(用完停在最后一项);calls() 照实计数
  let n = 0
  const f = async () => { const v = seq[Math.min(n, seq.length - 1)]; n++; return v }
  f.calls = () => n
  return f
}
const noSleep = async () => {}
const io = (curl) => ({ curl, sleep: noSleep, log: () => {} })

test('claudeusage: fetchRaw 只走 curl —— 恒 403 的那条腿一次都不打(省一次限流计数)', async () => {
  clearCache()
  const real = globalThis.fetch
  let fetches = 0
  globalThis.fetch = async () => { fetches++; throw new Error('不该被调用') }
  try {
    const curl = mkCurl([{ limits: [] }])
    assert.deepEqual(await fetchRaw('tok', { now: () => 1, ...io(curl) }), { limits: [] })
    assert.equal(curl.calls(), 1, '对照组:curl 这条腿确实走了')
    assert.equal(fetches, 0)
  } finally { globalThis.fetch = real; clearCache() }
})

test('claudeusage: fetchRaw 失败隔一下重试一次,再不行才认', async () => {
  clearCache()
  const curl = mkCurl([null, { limits: [] }])
  let slept = 0
  assert.deepEqual(await fetchRaw('tok', { now: () => 1, curl, log: () => {}, sleep: async (ms) => { slept += ms } }), { limits: [] })
  assert.equal(curl.calls(), 2)
  assert.ok(slept > 0, '重试前有等待(接上就打第二发等于白重试)')
  clearCache()
  const dead = mkCurl([null])
  assert.equal(await fetchRaw('tok', { now: () => 1, ...io(dead) }), null)
  assert.equal(dead.calls(), 2, '重试一次为限,不无限打')
  clearCache()
})

test('claudeusage: fetchRaw 成功压 60s、失败只压 10s —— 一次超时不该封住整整一分钟', async () => {
  clearCache()
  const T0 = 1_000_000
  const clock = { t: T0 }
  const curl = mkCurl([null, null, { limits: [{ kind: 'session', percent: 1 }] }])
  assert.equal(await fetchRaw('tok', { now: () => clock.t, ...io(curl) }), null)
  assert.equal(curl.calls(), 2) // 一次 + 重试
  clock.t = T0 + 5_000          // 失败窗口内:挡住连点(端点限流阈值低)
  assert.equal(await fetchRaw('tok', { now: () => clock.t, ...io(curl) }), null)
  assert.equal(curl.calls(), 2)
  clock.t = T0 + 11_000         // 过了 10s:真的重试,这次拿到了
  assert.ok(await fetchRaw('tok', { now: () => clock.t, ...io(curl) }))
  assert.equal(curl.calls(), 3)
  clock.t = T0 + 41_000         // 成功后 60s 内不再打
  assert.ok(await fetchRaw('tok', { now: () => clock.t, ...io(curl) }))
  assert.equal(curl.calls(), 3)
  clock.t = T0 + 80_000
  assert.ok(await fetchRaw('tok', { now: () => clock.t, ...io(curl) }))
  assert.equal(curl.calls(), 4)
  clearCache()
})

test('claudeusage: usageLine 同样只缓存成功(失败被压一分钟 = 群里一分钟查不到额度)', async () => {
  clearCache()
  const T0 = 1_000_000
  const clock = { t: T0 }
  const curl = mkCurl([null, null, REAL])
  const opts = () => ({ now: () => clock.t, readToken: () => 'tok', ...io(curl) })
  assert.equal(await usageLine(opts()), null)
  clock.t = T0 + 11_000
  const line = await usageLine(opts())
  assert.match(line || '', /5h:79%/)
  clock.t = T0 + 30_000
  assert.equal(await usageLine(opts()), line, '成功后走缓存(值一致)')
  assert.equal(curl.calls(), 3, '两次失败 + 一次成功;失败没被当成 60s 的结论')
  clearCache()
})

test('claudeusage: 没登录(取不到凭据)⇒ null 且零 spawn', async () => {
  clearCache()
  const curl = mkCurl([REAL])
  assert.equal(await usageLine({ now: () => 0, readToken: () => null, ...io(curl) }), null)
  assert.equal(curl.calls(), 0)
  clearCache()
})
