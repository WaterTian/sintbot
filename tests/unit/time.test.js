// 时间/时区口径助手(src/core/time.js)— 群内时间默认北京的根基:
// 格式化必须只认传入的 IANA 时区,与跑测试的主机时区无关。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_TZ, isValidTz, normalizeTz, tzOffsetMin, fmtStamp } = require('../../src/core/time')

test('time: default timezone is Beijing (Asia/Shanghai)', () => {
  assert.equal(DEFAULT_TZ, 'Asia/Shanghai')
})

test('time: isValidTz accepts IANA names, rejects garbage', () => {
  assert.equal(isValidTz('Asia/Shanghai'), true)
  assert.equal(isValidTz('UTC'), true)
  assert.equal(isValidTz('America/New_York'), true)
  assert.equal(isValidTz('Beijing/Time'), false)
  assert.equal(isValidTz(''), false)
  assert.equal(isValidTz(null), false)
  assert.equal(isValidTz(123), false)
})

test('time: normalizeTz falls back to Beijing on anything invalid (fail-safe)', () => {
  assert.equal(normalizeTz('Asia/Tokyo'), 'Asia/Tokyo')
  assert.equal(normalizeTz('nonsense'), 'Asia/Shanghai')
  assert.equal(normalizeTz(undefined), 'Asia/Shanghai')
})

test('time: tzOffsetMin — Beijing is a constant +480 (no DST); UTC is 0', () => {
  const at = Date.parse('2026-07-15T02:58:00Z')
  assert.equal(tzOffsetMin('Asia/Shanghai', at), 480)
  assert.equal(tzOffsetMin('Asia/Shanghai', Date.parse('2026-01-15T02:58:00Z')), 480)
  assert.equal(tzOffsetMin('UTC', at), 0)
  assert.equal(tzOffsetMin('bogus', at), 480) // invalid ⇒ normalized to Beijing
})

test('time: tzOffsetMin handles DST zones per-instant', () => {
  assert.equal(tzOffsetMin('America/New_York', Date.parse('2026-07-15T12:00:00Z')), -240) // EDT
  assert.equal(tzOffsetMin('America/New_York', Date.parse('2026-01-15T12:00:00Z')), -300) // EST
})

test('time: fmtStamp formats YYYY-MM-DD HH:mm in the given zone, host-independent', () => {
  const at = Date.parse('2026-01-02T03:04:00Z')
  assert.equal(fmtStamp(at, 'Asia/Shanghai'), '2026-01-02 11:04')
  assert.equal(fmtStamp(at, 'UTC'), '2026-01-02 03:04')
  assert.equal(fmtStamp(at, 'garbage'), '2026-01-02 11:04') // invalid ⇒ Beijing
  // 跨日:北京 +8 把 UTC 深夜推到次日
  assert.equal(fmtStamp(Date.parse('2026-01-02T22:30:00Z'), 'Asia/Shanghai'), '2026-01-03 06:30')
})
