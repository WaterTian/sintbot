// 额度告警(v0.11.8)判定 + 文案。纯函数,注入 now ⇒ 全可测。
// 覆盖:阈值边界(> 而非 >=)· codex 周窗口按 windowMins 判而非位置 · codex resetsAt
// 取整到分钟(去重的地基)· 文案零工具名。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { claudeAlert, codexAlert, alertText, humanReset, CLAUDE_SESSION_THRESHOLD, CODEX_WEEKLY_THRESHOLD } = require('../../src/core/quotaalert')

const NOW = Date.parse('2026-08-04T06:00:00Z')
const lim = (kind, percent, resetsAt = null, scopeName = '') => ({ kind, percent, resetsAt, scopeName })

// ── Claude:5h 会话窗口 > 90% ──────────────────────────────────────────────

test('claudeAlert: session 已用 91% ⇒ 告警;90% 恰好不告警(阈值是 >)', () => {
  const a = claudeAlert([lim('session', 91, NOW + 1.8 * 3600e3)], NOW)
  assert.ok(a)
  assert.equal(a.kind, 'claude-session')
  assert.equal(a.percent, 91)
  assert.equal(a.window, '5 小时')
  assert.equal(a.resetsAt, NOW + 1.8 * 3600e3)
  assert.equal(claudeAlert([lim('session', CLAUDE_SESSION_THRESHOLD, NOW + 1e6)], NOW), null)
})

test('claudeAlert: 只认 session —— 周档再满也不告警(5h 会先炸)', () => {
  assert.equal(claudeAlert([lim('weekly_all', 99, NOW + 1e6)], NOW), null)
  assert.equal(claudeAlert([lim('weekly_scoped', 99, NOW + 1e6, 'Fable')], NOW), null)
  // 混合:只挑 session 那档
  const a = claudeAlert([lim('weekly_all', 99), lim('session', 95, NOW + 3600e3)], NOW)
  assert.equal(a.percent, 95)
})

test('claudeAlert: 空/坏输入一律 null(best-effort,绝不抛)', () => {
  assert.equal(claudeAlert([], NOW), null)
  assert.equal(claudeAlert(null, NOW), null)
  assert.equal(claudeAlert([{ kind: 'session' }], NOW), null) // 无 percent
})

test('claudeAlert: 重置时刻已过 ⇒ resetIn 为 null(文案不写重置)', () => {
  const a = claudeAlert([lim('session', 95, NOW - 1000)], NOW)
  assert.equal(a.resetIn, null)
  assert.doesNotMatch(alertText(a), /重置/)
})

// ── codex:周窗口 > 95%,5h 窗口不告警 ─────────────────────────────────────

test('codexAlert: 周窗口(windowMins=10080)已用 96% ⇒ 告警', () => {
  const a = codexAlert({ primary: { usedPercent: 96, windowMins: 10080, resetsAt: 3 * 86400 } }, NOW)
  assert.ok(a)
  assert.equal(a.kind, 'codex-weekly')
  assert.equal(a.percent, 96)
  assert.equal(a.window, '一周')
})

test('codexAlert: ⚠ 按 windowMins 判窗口而非 primary/secondary 位置(官方挪过位置)', () => {
  // 周窗口在 secondary:照样命中
  const a = codexAlert({ primary: { usedPercent: 99, windowMins: 300 }, secondary: { usedPercent: 97, windowMins: 10080 } }, NOW)
  assert.equal(a.percent, 97, '该取周窗口的 97,不是 5h 窗口的 99')
  // 5h 窗口爆表但周窗口没到 ⇒ 不告警(用户明确只要周额度)
  assert.equal(codexAlert({ primary: { usedPercent: 100, windowMins: 300 }, secondary: { usedPercent: 10, windowMins: 10080 } }, NOW), null)
  assert.equal(codexAlert({ primary: { usedPercent: 99, windowMins: 300 } }, NOW), null)
})

test('codexAlert: 95% 恰好不告警;空输入 null', () => {
  assert.equal(codexAlert({ primary: { usedPercent: CODEX_WEEKLY_THRESHOLD, windowMins: 10080 } }, NOW), null)
  assert.equal(codexAlert(null, NOW), null)
  assert.equal(codexAlert({}, NOW), null)
})

test('codexAlert: ⚠ resetsAt 取整到分钟 —— 去重的地基', () => {
  // codex 只给相对秒数 ⇒ 绝对时刻由 now 算出。两次调用相隔几百毫秒时,不取整就会算出
  // 两个不同的 resetsAt ⇒ 每轮都被判成「新窗口」,去重完全失效。
  const u = { primary: { usedPercent: 97, windowMins: 10080, resetsAt: 3 * 86400 } }
  const a1 = codexAlert(u, NOW)
  const a2 = codexAlert(u, NOW + 800) // 800ms 后的下一轮
  assert.equal(a1.resetsAt, a2.resetsAt, '同一窗口在相邻两轮必须算出同一个身份')
  assert.equal(a1.resetsAt % 60000, 0)
})

test('codexAlert: resetsAt 兼容绝对 epoch 秒与相对秒数;脏值丢弃只是不显示重置', () => {
  const abs = codexAlert({ primary: { usedPercent: 97, windowMins: 10080, resetsAt: Math.floor((NOW + 2 * 86400e3) / 1000) } }, NOW)
  assert.ok(abs.resetIn > 1.9 * 86400e3 && abs.resetIn < 2.1 * 86400e3)
  const bad = codexAlert({ primary: { usedPercent: 97, windowMins: 10080, resetsAt: -5 } }, NOW)
  assert.equal(bad.resetIn, null)
  assert.equal(bad.resetsAt, null)
  assert.ok(alertText(bad)) // 仍出文案,只是不写重置时间
})

// ── 文案 ────────────────────────────────────────────────────────────────

test('alertText: 说清窗口/已用/重置,且零工具名(不出现 provider 名与命令名)', () => {
  const t = alertText(claudeAlert([lim('session', 92, NOW + 1.8 * 3600e3)], NOW))
  assert.match(t, /5 小时/)
  assert.match(t, /92%/)
  assert.match(t, /约 1\.8 小时后重置/)
  // 用户面零工具名(2026-07-30 拍板):群里只有 SintBot 一个身份
  assert.doesNotMatch(t, /sbot|claude|codex|provider|Claude|Codex/)
  assert.equal(alertText(null), null)
})

test('humanReset: 天/小时/分钟三档,整数不留尾零', () => {
  assert.equal(humanReset(1.8 * 3600e3), '约 1.8 小时后')
  assert.equal(humanReset(4 * 3600e3), '约 4 小时后')
  assert.equal(humanReset(6.1 * 864e5), '约 6.1 天后')
  assert.equal(humanReset(25 * 60e3), '约 25 分钟后')
  assert.equal(humanReset(-1), '')
  assert.equal(humanReset(NaN), '')
})
