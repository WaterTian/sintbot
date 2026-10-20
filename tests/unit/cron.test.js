// Cron parser/matcher — field syntax, aliases, Chinese shorthands, timezone matching,
// the dom/dow OR quirk, and per-group task collection. Pure logic, deterministic instants.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeCron, parseField, matchCron, zhShorthand, describeCron, normalizeAt, matchAt, describeAt, describeTask, expandAt, collectCrons } = require('../../src/core/cron')

const TZ = 'Asia/Shanghai'
// A fixed instant: 2026-07-15 09:00 Beijing == 2026-07-15 01:00 UTC. (2026-07-15 is a Wednesday.)
const AT = (utcH, utcM = 0, y = 2026, mo = 6, d = 15) => Date.UTC(y, mo, d, utcH, utcM, 0)
const BEIJING_0900 = AT(1, 0)   // 北京 09:00
const BEIJING_0830 = AT(0, 30)  // 北京 08:30
const BEIJING_MIDNIGHT_16 = AT(16, 0) // 2026-07-15 16:00 UTC = 北京 2026-07-16 00:00

test('normalizeCron: passes valid 5-field; expands @aliases; rejects wrong arity/out-of-range', () => {
  assert.equal(normalizeCron('0 9 * * 1-5'), '0 9 * * 1-5')
  assert.equal(normalizeCron('@daily'), '0 0 * * *')
  assert.equal(normalizeCron('@hourly'), '0 * * * *')
  assert.throws(() => normalizeCron('0 9 * *'), /5 段/)
  assert.throws(() => normalizeCron('99 9 * * *'), /越界|无法解析/)
  assert.throws(() => normalizeCron(''), /为空/)
})

test('zhShorthand: 每天/工作日/每周X/每小时', () => {
  assert.equal(zhShorthand('每天 09:00'), '0 9 * * *')
  assert.equal(zhShorthand('工作日 8:30'), '30 8 * * 1-5')
  assert.equal(zhShorthand('每周一 09:00'), '0 9 * * 1')
  assert.equal(zhShorthand('每周日 22:15'), '15 22 * * 0')
  assert.equal(zhShorthand('每小时'), '0 * * * *')
  assert.equal(zhShorthand('random'), null)
})

test('parseField: star/single/range/step/list', () => {
  assert.equal(parseField('*', 0, 59), null)
  assert.deepEqual([...parseField('5', 0, 59)], [5])
  assert.deepEqual([...parseField('1-3', 0, 59)], [1, 2, 3])
  assert.deepEqual([...parseField('*/15', 0, 59)], [0, 15, 30, 45])
  assert.deepEqual([...parseField('0-10/5', 0, 59)], [0, 5, 10])
  assert.deepEqual([...parseField('1,3,5', 0, 59)], [1, 3, 5])
  assert.deepEqual([...parseField('20/10', 0, 59)], [20, 30, 40, 50]) // a/n runs a→max
  assert.throws(() => parseField('60', 0, 59), /越界/)
})

test('matchCron: fires at the intended Beijing wall-clock, decoupled from host TZ', () => {
  assert.equal(matchCron('0 9 * * *', BEIJING_0900, TZ), true)
  assert.equal(matchCron('0 10 * * *', BEIJING_0900, TZ), false)
  assert.equal(matchCron('30 8 * * *', BEIJING_0830, TZ), true)
  assert.equal(matchCron('0 9 * * 1-5', BEIJING_0900, TZ), true)  // 2026-07-15 is Wed → workday
  assert.equal(matchCron('0 9 * * 0', BEIJING_0900, TZ), false)   // not Sunday
  assert.equal(matchCron('@daily', BEIJING_MIDNIGHT_16, TZ), true) // rolls to 北京 00:00 next day
})

test('matchCron: dom+dow both set ⇒ OR (standard cron quirk)', () => {
  // 15th OR Monday, at 09:00. 2026-07-15 is the 15th (and a Wednesday) → matches via dom.
  assert.equal(matchCron('0 9 15 * 1', BEIJING_0900, TZ), true)
  // 14th OR Monday — neither holds on Wed the 15th → no match.
  assert.equal(matchCron('0 9 14 * 1', BEIJING_0900, TZ), false)
})

test('describeCron: humanizes common schedules; falls back to cron for complex', () => {
  assert.equal(describeCron('0 9 * * *'), '每天 09:00')
  assert.equal(describeCron('0 9 * * 1-5'), '工作日 09:00')
  assert.equal(describeCron('30 8 * * 1'), '每周一 08:30')
  assert.equal(describeCron('每天 09:00'), '每天 09:00') // shorthand normalized then described
  assert.equal(describeCron('@daily'), '每天 00:00')
  assert.equal(describeCron('0 * * * *'), '每小时整点')
  assert.equal(describeCron('*/15 * * * *'), '每 15 分钟')
  assert.equal(describeCron('0 9 1 * *'), '每月 1 号 09:00')
  assert.equal(describeCron('0 9,18 * * *'), '0 9,18 * * *') // multi-hour → falls back to raw cron
  assert.equal(describeCron('bad'), 'bad') // unparseable → returned as-is
  assert.equal(describeCron('10 13 16 7 *'), '每年 7 月 16 日 13:10') // fixed month+day (cron has no year)
})

test('one-off: normalizeAt / matchAt / describeAt / describeTask', () => {
  assert.equal(normalizeAt('2026-7-16 13:10'), '2026-07-16 13:10') // zero-pads
  assert.throws(() => normalizeAt('bad'), /YYYY-MM-DD/)
  assert.throws(() => normalizeAt('2026-13-16 13:10'), /越界/)
  const AT = Date.UTC(2026, 6, 16, 5, 10, 0) // 北京 2026-07-16 13:10 == UTC 05:10
  assert.equal(matchAt('2026-07-16 13:10', AT, TZ), true)
  assert.equal(matchAt('2026-07-16 13:11', AT, TZ), false)
  assert.equal(describeAt('2026-07-16 13:10'), '2026年7月16日 13:10') // 无 now → 完整绝对(向后兼容)
  assert.equal(describeTask({ at: '2026-07-16 13:10' }), '2026年7月16日 13:10')
  assert.equal(describeTask({ expr: '0 9 * * 1-5' }), '工作日 09:00')
})

test('describeAt: relative to now — 今天省日期、今年省年份、跨年完整', () => {
  const NOW = '2026-07-16 09:00'
  assert.equal(describeAt('2026-07-16 13:10', NOW), '13:10')        // 今天 → 只时间
  assert.equal(describeAt('2026-07-16 09:00', NOW), '09:00')        // 今天(同分钟)
  assert.equal(describeAt('2026-07-20 08:05', NOW), '7月20日 08:05') // 今年异日 → 省年份
  assert.equal(describeAt('2026-12-31 23:59', NOW), '12月31日 23:59')
  assert.equal(describeAt('2027-01-01 00:00', NOW), '2027年1月1日 00:00') // 跨年 → 完整
  assert.equal(describeAt('2025-07-16 13:10', NOW), '2025年7月16日 13:10') // 去年 → 完整
  // describeTask 透传 now
  assert.equal(describeTask({ at: '2026-07-16 13:10' }, NOW), '13:10')
  assert.equal(describeTask({ expr: '0 9 * * *' }, NOW), '每天 09:00') // 循环不受 now 影响
})

test('expandAt: 简写补全成绝对时间(存绝对,显示再相对化)', () => {
  // 北京 2026-07-16 09:00
  const NOW = Date.UTC(2026, 6, 16, 1, 0, 0)
  // 只填时间,未过 → 今天
  assert.equal(expandAt('13:10', NOW, TZ), '2026-07-16 13:10')
  // 只填时间,已过当前分钟 → 明天
  assert.equal(expandAt('08:30', NOW, TZ), '2026-07-17 08:30')
  assert.equal(expandAt('09:00', NOW, TZ), '2026-07-17 09:00') // 同分钟算已过 → 明天
  // 月-日 + 时间 → 今年
  assert.equal(expandAt('07-20 08:05', NOW, TZ), '2026-07-20 08:05')
  assert.equal(expandAt('7月20日 08:05', NOW, TZ), '2026-07-20 08:05') // 中文月日
  // 完整照旧
  assert.equal(expandAt('2027-01-01 00:00', NOW, TZ), '2027-01-01 00:00')
  assert.equal(expandAt('2026年8月1日 09:00', NOW, TZ), '2026-08-01 09:00') // 中文完整
  // 跨月/跨年顺延(月末/年末只填已过的时间)
  assert.equal(expandAt('08:00', Date.UTC(2026, 6, 31, 5, 0, 0), TZ), '2026-08-01 08:00') // 北京 7-31 13:00,08:00 已过 → 明天 8-1
  assert.equal(expandAt('08:00', Date.UTC(2026, 11, 31, 12, 0, 0), TZ), '2027-01-01 08:00') // 北京 12-31 20:00,08:00 已过 → 明天跨年
  // 无法识别 → 抛
  assert.throws(() => expandAt('每天 09:00', NOW, TZ), /无法识别/)
  assert.throws(() => expandAt('25:00', NOW, TZ), /越界/)
})

test('collectCrons: flattens per-group crons, tags chatId, skips id-less', () => {
  const cfg = { groups: {
    oc_a: { crons: [{ id: 'c1', expr: '0 9 * * *', kind: 'do', text: 'x' }, { expr: 'bad-no-id' }] },
    oc_b: { crons: [{ id: 'c2', expr: '@daily', kind: 'say', text: 'hi' }] },
    oc_c: {},
  } }
  const all = collectCrons(cfg)
  assert.equal(all.length, 2)
  assert.deepEqual(all.map((c) => [c.id, c.chatId]), [['c1', 'oc_a'], ['c2', 'oc_b']])
})
