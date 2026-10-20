// codexstatus — pure parsing/mapping for the console's codex 「验证登录」action.
// The spawn side (codex login status / app-server) is exercised on the target machine.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseLoginStatus, mapRateLimits, formatUsage, windowLabel } = require('../../src/agent/codexstatus')

test('parseLoginStatus: ChatGPT subscription login (exit 0)', () => {
  const r = parseLoginStatus('Logged in using ChatGPT', 0)
  assert.equal(r.loggedIn, true)
  assert.equal(r.mode, 'chatgpt')
})

test('parseLoginStatus: API-key mode', () => {
  const r = parseLoginStatus('Logged in using an API key', 0)
  assert.equal(r.loggedIn, true)
  assert.equal(r.mode, 'apikey')
})

test('parseLoginStatus: not logged in (non-zero exit)', () => {
  const r = parseLoginStatus('Not logged in', 1)
  assert.equal(r.loggedIn, false)
})

test('mapRateLimits: primary + secondary windows mapped', () => {
  const resp = { rateLimits: {
    planType: 'plus',
    primary: { usedPercent: 63, windowDurationMins: 299, resetsAt: 1751880000 },
    secondary: { usedPercent: 6, windowDurationMins: 10079, resetsAt: 1752480000 },
    credits: { balance: null, hasCredits: false, unlimited: false },
  } }
  const m = mapRateLimits(resp)
  assert.equal(m.primary.usedPercent, 63)
  assert.equal(m.primary.windowMins, 299)
  assert.equal(m.secondary.usedPercent, 6)
  assert.equal(m.planType, 'plus')
  assert.equal(m.credits.hasCredits, false)
})

test('mapRateLimits: missing / empty → null (never a bogus row)', () => {
  assert.equal(mapRateLimits(null), null)
  assert.equal(mapRateLimits({}), null)
  assert.equal(mapRateLimits({ rateLimits: {} }), null)
  assert.equal(mapRateLimits({ rateLimits: { primary: null, secondary: null } }), null)
})

test('mapRateLimits: only primary present still maps', () => {
  const m = mapRateLimits({ rateLimits: { primary: { usedPercent: 10, windowDurationMins: 299, resetsAt: 1 } } })
  assert.equal(m.primary.usedPercent, 10)
  assert.equal(m.secondary, null)
})

test('windowLabel: derived from duration, not position (5h vs 7d)', () => {
  assert.equal(windowLabel(299), '5h')   // ≈5h window
  assert.equal(windowLabel(300), '5h')
  assert.equal(windowLabel(60), '1h')
  assert.equal(windowLabel(10080), '7d') // 7d = weekly(v0.11.8 紧凑格式:标 7d 不标「周」)
  assert.equal(windowLabel(10079), '7d') // old secondary duration still reads weekly
  assert.equal(windowLabel(1440), '1d')  // a plain day window
  assert.equal(windowLabel(0), '窗口')     // missing → generic, never a wrong label
  assert.equal(windowLabel(undefined), '窗口')
})

test('formatUsage: label follows windowMins (old 5h+weekly shape)', () => {
  assert.equal(formatUsage(null), null)
  const now = Math.floor(Date.now() / 1000)
  const s = formatUsage({
    primary: { usedPercent: 1, windowMins: 299, resetsAt: now + 2 * 3600 },
    secondary: { usedPercent: 10, windowMins: 10080, resetsAt: now + 3 * 86400 },
  })
  // v0.11.8 口径:百分比是**已用**、括号是距重置、分隔 │(与 Claude 卡同款)
  assert.match(s, /5h:1%/)
  assert.match(s, /7d:10%/)
  assert.match(s, /\(\d/) // 括号里的距重置
  assert.doesNotMatch(s, /剩/) // 钉死不回退到「剩余」口径
  // credits only shown when actually held
  assert.doesNotMatch(formatUsage({ primary: { usedPercent: 5, windowMins: 299 }, credits: { balance: '0', hasCredits: false } }), /credits/)
})

// Regression for the口径 change (2026-07 真机): codex now reports a SINGLE weekly window in
// `primary` (windowDurationMins 10080) with `secondary: null`. The old positional label
// hardcoded primary='5h' → it mislabeled the weekly window as "5h". Must read the duration.
test('formatUsage: weekly-only shape labels 7d, never 5h', () => {
  const now = Math.floor(Date.now() / 1000)
  const u = mapRateLimits({ rateLimits: {
    planType: 'plus',
    primary: { usedPercent: 6, windowDurationMins: 10080, resetsAt: now + 6 * 86400 },
    secondary: null,
  } })
  const s = formatUsage(u)
  assert.match(s, /7d:6%/) // 已用 6%
  assert.doesNotMatch(s, /5h/) // the exact bug: weekly window must NOT read as 5h
})

// ── model/list 映射(codex 面板「模型」下拉数据源;协议 v2,0.144.3 真机采样) ──
test('mapModels: maps id/name/desc/efforts, filters hidden, tolerates effort objects', () => {
  const { mapModels } = require('../../src/agent/codexstatus')
  const out = mapModels({ data: [
    { id: 'gpt-5.6-sol', model: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', description: 'Latest frontier.', isDefault: true, hidden: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: ['low', 'medium', { reasoningEffort: 'ultra' }] },
    { id: 'codex-auto-review', model: 'codex-auto-review', displayName: 'Auto Review', hidden: true, isDefault: false, supportedReasoningEfforts: [] },
  ] })
  assert.equal(out.length, 1) // hidden 被滤掉
  assert.deepEqual(out[0], { model: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', desc: 'Latest frontier.', isDefault: true, efforts: ['low', 'medium', 'ultra'], defEffort: 'low' })
})

test('mapModels: empty / malformed → null (upstream falls back to presets)', () => {
  const { mapModels } = require('../../src/agent/codexstatus')
  assert.equal(mapModels(null), null)
  assert.equal(mapModels({}), null)
  assert.equal(mapModels({ data: [{ hidden: true, model: 'x' }] }), null)
})

test('PRESET_MODELS: fallback list is well-formed (model/name/efforts per entry, one default)', () => {
  const { PRESET_MODELS } = require('../../src/agent/codexstatus')
  assert.ok(PRESET_MODELS.length >= 4)
  for (const m of PRESET_MODELS) { assert.ok(m.model && m.name); assert.ok(Array.isArray(m.efforts) && m.efforts.length) }
  assert.equal(PRESET_MODELS.filter((m) => m.isDefault).length, 1)
})
