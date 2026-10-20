// Cron scheduler — injected now/tz/tasks/fire/timers (no real clock). Covers firing, per-minute
// dedup, disabled/non-match/invalid handling, cross-group isolation, and minute-aligned start.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createScheduler } = require('../../src/core/scheduler')

const TZ = 'Asia/Shanghai'
const BEIJING_0900 = Date.UTC(2026, 6, 15, 1, 0, 0) // 北京 09:00, on the minute

test('scheduler: fires a due task once per minute; repeat ticks dedup', () => {
  const fired = []
  const sch = createScheduler({ tasks: () => [{ id: 't1', chatId: 'oc_a', expr: '0 9 * * *', text: 'x' }], fire: (t) => fired.push(t.id), tz: () => TZ, now: () => BEIJING_0900 })
  sch.tick(); sch.tick(); sch.tick()
  assert.deepEqual(fired, ['t1'])
})

test('scheduler: skips disabled/non-matching; an invalid expr is logged, not thrown', () => {
  const fired = [], logs = []
  const tasks = () => [
    { id: 'on', chatId: 'a', expr: '0 9 * * *', text: 'x' },
    { id: 'off', chatId: 'a', expr: '0 9 * * *', text: 'x', enabled: false },
    { id: 'nomatch', chatId: 'a', expr: '0 10 * * *', text: 'x' },
    { id: 'bad', chatId: 'a', expr: 'not-a-cron', text: 'x' },
  ]
  const sch = createScheduler({ tasks, fire: (t) => fired.push(t.id), tz: () => TZ, now: () => BEIJING_0900, log: (m) => logs.push(m) })
  assert.doesNotThrow(() => sch.tick())
  assert.deepEqual(fired, ['on'])
  assert.ok(logs.some((l) => /bad/.test(l)))
})

test('scheduler: two GROUPS with a same-id task both fire — no cross-group dedup collision', () => {
  const fired = []
  const tasks = () => [
    { id: 'daily', chatId: 'oc_a', expr: '0 9 * * *', kind: 'do', text: 'A' },
    { id: 'daily', chatId: 'oc_b', expr: '0 9 * * *', kind: 'say', text: 'B' },
  ]
  const sch = createScheduler({ tasks, fire: (t) => fired.push(t.chatId), tz: () => TZ, now: () => BEIJING_0900 })
  sch.tick()
  assert.deepEqual(fired.slice().sort(), ['oc_a', 'oc_b']) // both groups fired despite identical id
  sch.tick()
  assert.deepEqual(fired.slice().sort(), ['oc_a', 'oc_b']) // still deduped per (group,id) that minute
})

test('scheduler: one group firing does not consume another group with a distinct schedule', () => {
  const fired = []
  const tasks = () => [
    { id: 'x', chatId: 'oc_a', expr: '0 9 * * *', text: 'A' }, // due at 09:00
    { id: 'y', chatId: 'oc_b', expr: '0 10 * * *', text: 'B' }, // due at 10:00
  ]
  const sch = createScheduler({ tasks, fire: (t) => fired.push(t.chatId), tz: () => TZ, now: () => BEIJING_0900 })
  sch.tick()
  assert.deepEqual(fired, ['oc_a']) // only the 09:00 group; oc_b untouched
})

test('scheduler: fires a one-off (at) in its exact minute; a non-matching recurring task is untouched', () => {
  const fired = []
  const AT = Date.UTC(2026, 6, 16, 5, 10, 0) // 北京 2026-07-16 13:10
  const tasks = () => [
    { id: 'once', chatId: 'a', at: '2026-07-16 13:10', kind: 'do', text: 'x', once: true },
    { id: 'daily', chatId: 'a', expr: '0 9 * * *', kind: 'do', text: 'y' }, // 09:00 ≠ 13:10
  ]
  const sch = createScheduler({ tasks, fire: (t) => fired.push(t.id), tz: () => TZ, now: () => AT })
  sch.tick()
  assert.deepEqual(fired, ['once'])
})

test('scheduler: start() aligns to the next minute and does NOT tick immediately (no restart back-fire)', () => {
  let scheduledMs = null
  const fired = []
  const sch = createScheduler({
    tasks: () => [{ id: 't', chatId: 'a', expr: '* * * * *', text: 'x' }],
    fire: (t) => fired.push(t.id), tz: () => TZ,
    now: () => BEIJING_0900 + 15000, // 15s into the minute
    setTimer: (fn, ms) => { scheduledMs = ms; return { unref() {} } }, clearTimer: () => {},
  })
  sch.start()
  assert.equal(fired.length, 0)
  assert.equal(scheduledMs, 60000 - 15000 + 500) // next minute boundary + 0.5s
})
