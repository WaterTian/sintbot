// 额度用尽原话里的「几点重置」按产品时区解析 —— 额度自动切换「到点切回」的依据。
// 判据本体(classifyQuota:哪句原话算额度用尽 / 账号不可用)在 src/agent/quotaerr.js,两个 runner 共用;
// 这里只留依赖产品时区的那一半 —— runner 不知道时区,core 不认原话形状,各管一摊。

const { tzOffsetMin, tzParts, isValidTz, DEFAULT_TZ } = require('./time')

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 }

// 某时区的墙上时间 → epoch 毫秒。先按 UTC 猜一个,再用该时刻的时区偏移校正两次(跨夏令时边界时
// 第一次偏移可能取错,第二次按校正后的时刻重取即收敛)。
function wallToEpoch(y, mo, d, h, mi, tz) {
  let ts = Date.UTC(y, mo, d, h, mi)
  for (let i = 0; i < 2; i++) ts = Date.UTC(y, mo, d, h, mi) - tzOffsetMin(tz, ts) * 60e3
  return ts
}

/**
 * 从原话里解出「什么时候重置」。认两种形状:
 *   · 「resets Oct 1 at 9am (Asia/Shanghai)」—— 带月日、可带时区
 *   · 「try again at 2:30 PM」/「resets 9am」—— 只有时刻 ⇒ 按产品时区取**下一次**到达该时刻
 * 解不出返回 null(调用方退回额度探针给的绝对时刻,或不设)。
 * ⚠ 没写年份:取当前年;算出来早于 now 一天以上 ⇒ 说的是明年(跨年边界)。
 */
function parseResetAt(text, { now = Date.now(), tz = DEFAULT_TZ } = {}) {
  const s = String(text || '')
  if (!s) return null
  const m = /(?:resets?|try again|available(?: again)?|retry)(?:\s+(?:at|on))?\s+(?:([a-z]{3,4})\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i.exec(s)
  if (!m) return null
  const [, mon, day, hh, mm, ampm, tzIn] = m
  let h = Number(hh)
  if (!Number.isFinite(h) || h > 23) return null
  if (ampm) { const pm = ampm.toLowerCase() === 'pm'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12 }
  else if (!mon) return null // 「resets 9」这种没 am/pm 也没日期的,信息不够,不猜
  const mi = mm ? Number(mm) : 0
  const zone = (tzIn && isValidTz(tzIn)) ? tzIn : tz
  const p = tzParts(now, zone)
  const Y = +p.year, M = +p.month - 1, D = +p.day
  if (mon) {
    const mo = MONTHS[mon.toLowerCase()]
    if (mo == null) return null
    let ts = wallToEpoch(Y, mo, Number(day), h, mi, zone)
    if (ts < now - 864e5) ts = wallToEpoch(Y + 1, mo, Number(day), h, mi, zone)
    return plausible(ts, now)
  }
  let ts = wallToEpoch(Y, M, D, h, mi, zone)
  if (ts <= now) ts += 864e5
  return plausible(ts, now)
}

// 订阅额度窗口最长一周 ⇒ 解出的重置时刻距今超过 8 天就是解错了(典型:原话里的「Oct 1」其实是去年的,被推到了明年),
// 宁可说「不知道」交给探针,也不能把「约 358 天后切回」落进记录。
const MAX_AHEAD_MS = 8 * 864e5
function plausible(ts, now) { return ts - now > MAX_AHEAD_MS ? null : ts }

module.exports = { parseResetAt, MAX_AHEAD_MS }
