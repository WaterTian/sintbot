// Minimal cron parser + matcher (zero-dep) for the 定时任务 base skill.
//
// Standard 5-field cron — "minute hour day-of-month month day-of-week" — plus @aliases
// (@daily/@hourly/…) and a few Chinese shorthands ("每天 09:00", "工作日 8:30"). Matching
// uses PRODUCT-TIMEZONE parts (Asia/Shanghai default, see time.js) so a task fires at the
// wall-clock the user meant, regardless of the host's system timezone.
//
// Field syntax per position: `*`, `a`, `a-b`, `*/n`, `a/n`, `a-b/n`, and comma lists thereof.
// day-of-week: 0=Sunday..6=Saturday. dom+dow both restricted ⇒ match EITHER (standard cron quirk).

const { tzParts } = require('./time')

const ALIASES = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
}

const ZH_DOW = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }

// A few human shorthands → a 5-field cron string, or null if it isn't one we recognize.
function zhShorthand(s) {
  const t = String(s).trim()
  let m
  if ((m = t.match(/^每天\s*(\d{1,2})[:：](\d{1,2})$/))) return `${+m[2]} ${+m[1]} * * *`
  if ((m = t.match(/^工作日\s*(\d{1,2})[:：](\d{1,2})$/))) return `${+m[2]} ${+m[1]} * * 1-5`
  if ((m = t.match(/^每周([一二三四五六日天])\s*(\d{1,2})[:：](\d{1,2})$/))) return `${+m[3]} ${+m[2]} * * ${ZH_DOW[m[1]]}`
  if (/^每小时$/.test(t)) return '0 * * * *'
  return null
}

// Normalize any accepted form to a validated 5-field string, or throw with a human message.
function normalizeCron(expr) {
  if (typeof expr !== 'string' || !expr.trim()) throw new Error('cron 表达式为空')
  let s = expr.trim()
  if (ALIASES[s.toLowerCase()]) s = ALIASES[s.toLowerCase()]
  else { const zh = zhShorthand(s); if (zh) s = zh }
  const parts = s.split(/\s+/)
  if (parts.length !== 5) throw new Error(`cron 需要 5 段(分 时 日 月 周),或 @别名/中文简写(如「每天 09:00」),得到:${expr}`)
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]]
  parts.forEach((f, i) => parseField(f, ranges[i][0], ranges[i][1])) // throws on a bad field
  return parts.join(' ')
}

// Parse ONE field into a Set of allowed integers, or null for '*' (matches anything).
function parseField(f, min, max) {
  if (f === '*') return null
  const out = new Set()
  for (const part of String(f).split(',')) {
    const m = part.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/)
    if (!m) throw new Error(`cron 字段无法解析:${part}`)
    const step = m[3] ? +m[3] : 1
    let lo, hi
    if (m[1] === '*') { lo = min; hi = max }
    else { lo = +m[1]; hi = m[2] != null ? +m[2] : (m[3] ? max : +m[1]) } // `a/n` runs a→max
    if (lo < min || hi > max || lo > hi || step < 1) throw new Error(`cron 字段越界/非法:${part}`)
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

// Does the (normalized-or-raw) expr fire at instant `ts` interpreted in timezone `tz`?
function matchCron(expr, ts, tz) {
  const [fMin, fHour, fDom, fMon, fDow] = normalizeCron(expr).split(' ')
  const p = tzParts(ts, tz)
  const has = (field, val, min, max) => { const set = parseField(field, min, max); return set === null || set.has(val) }
  // day-of-week from the tz-local calendar date (weekday is timezone-agnostic once y/m/d fixed)
  const dow = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay() // 0=Sun..6=Sat
  const domOk = has(fDom, +p.day, 1, 31), dowOk = has(fDow, dow, 0, 6)
  const dayOk = (fDom !== '*' && fDow !== '*') ? (domOk || dowOk) : (domOk && dowOk)
  return has(fMin, +p.minute, 0, 59) && has(fHour, +p.hour, 0, 23) && has(fMon, +p.month, 1, 12) && dayOk
}

// Human-readable Chinese summary of a cron expr for the console list ("0 9 * * 1-5" → "工作日
// 09:00"). Covers the common schedules; anything richer falls back to the normalized cron string.
const ZH_DOW_NAME = ['日', '一', '二', '三', '四', '五', '六']
function describeCron(expr) {
  let norm
  try { norm = normalizeCron(expr) } catch { return String(expr) }
  const [mi, h, dom, mon, dow] = norm.split(' ')
  const single = (f) => /^\d+$/.test(f)
  const hhmm = (H, M) => `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`
  if (norm === '0 * * * *') return '每小时整点'
  if (/^\*\/\d+$/.test(mi) && h === '*' && dom === '*' && mon === '*' && dow === '*') return `每 ${mi.slice(2)} 分钟`
  if (single(mi) && single(h) && mon === '*') {
    const t = hhmm(+h, +mi)
    if (dom === '*' && dow === '*') return `每天 ${t}`
    if (dom === '*' && dow === '1-5') return `工作日 ${t}`
    if (dom === '*' && (dow === '0,6' || dow === '6,0')) return `周末 ${t}`
    if (dom === '*' && single(dow)) return `每周${ZH_DOW_NAME[+dow]} ${t}`
    if (dom === '*' && /^[0-6](,[0-6])+$/.test(dow)) return `每周${dow.split(',').map((d) => ZH_DOW_NAME[+d]).join('、')} ${t}`
    if (single(dom) && dow === '*') return `每月 ${+dom} 号 ${t}`
  }
  // Fixed month+day (e.g. "10 13 16 7 *"): standard cron has no year, so this recurs EVERY year.
  if (single(mi) && single(h) && single(mon) && single(dom) && dow === '*') return `每年 ${+mon} 月 ${+dom} 日 ${hhmm(+h, +mi)}`
  return norm // fallback: the normalized cron itself
}

// ── One-shot tasks (一次性): stored as `at: "YYYY-MM-DD HH:mm"`, interpreted in the group's
// timezone. Standard cron has no year, so a true one-off needs an absolute datetime. The scheduler
// fires it in the matching minute; the daemon deletes it right after (fire-once, then gone).
function normalizeAt(s) {
  const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/)
  if (!m) throw new Error('一次性时间格式应为 YYYY-MM-DD HH:mm(如 2026-07-16 13:10)')
  const mo = +m[2], d = +m[3], h = +m[4], mi = +m[5]
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) throw new Error('一次性时间越界:' + s)
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

// Fires when the tz-local wall-clock minute equals `at`.
function matchAt(at, ts, tz) {
  const p = tzParts(ts, tz)
  return normalizeAt(at) === `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

// Human string for a one-off. Relative to `nowStr` (the group-tz present as "YYYY-MM-DD HH:mm"):
// same day ⇒ just "13:10"; same year ⇒ "7月16日 13:10"; else full "2026年7月16日 13:10". Omit
// `nowStr` ⇒ always full absolute (keeps the fn pure/testable; callers that know "now" pass it).
// The "一次" tag is added by the UI badge to avoid duplication.
function describeAt(at, nowStr) {
  let m
  try { m = normalizeAt(at).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/) } catch { return String(at) }
  const [, y, mo, d, hm] = m
  const n = /^(\d{4})-(\d{2})-(\d{2}) /.exec(nowStr || '')
  if (n) {
    if (n[1] === y && n[2] === mo && n[3] === d) return hm          // 今天 → 只留时间
    if (n[1] === y) return `${+mo}月${+d}日 ${hm}`                   // 今年 → 省年份
  }
  return `${y}年${+mo}月${+d}日 ${hm}`                               // 跨年 / 无 now → 完整
}

// Unified label: one-off (`at`, relative to nowStr) or recurring (`expr`, already relative-free).
function describeTask(task, nowStr) {
  if (!task) return ''
  return task.at ? describeAt(task.at, nowStr) : describeCron(task.expr)
}

// Expand a one-off shorthand into an absolute "YYYY-MM-DD HH:mm", filling the missing leading
// parts from the group-tz present (the mirror of describeAt's omission). Accepts:
//   "HH:mm"                          → today (rolls to tomorrow if that minute already passed,
//                                       so a one-off is never born already-expired)
//   "MM-DD HH:mm" / "M月D日 HH:mm"    → this year, that month/day
//   full "YYYY-MM-DD HH:mm" / "YYYY年M月D日 HH:mm" → taken as given
// `nowMs`/`tz` locate today/tomorrow in the group timezone. Throws on unparseable input. The
// STORED value is always absolute, so matchAt / expiry / scheduler stay unchanged.
function expandAt(input, nowMs, tz) {
  const s = String(input || '').trim()
  if (/^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}$/.test(s)) return normalizeAt(s)
  const full = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})$/)
  if (full) return normalizeAt(`${full[1]}-${full[2]}-${full[3]} ${full[4]}:${full[5]}`)
  const now = tzParts(nowMs, tz)
  const timeOnly = s.match(/^(\d{1,2}):(\d{2})$/)
  if (timeOnly) {
    const h = +timeOnly[1], mi = +timeOnly[2]
    if (h > 23 || mi > 59) throw new Error('时间越界:' + s)
    const hm = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
    let { year, month, day } = now
    // 已过当前分钟 ⇒ 顺延到明天(+24h 后重取 tz 日期,跨月/跨年由 tzParts 正确处理)
    if (hm <= `${now.hour}:${now.minute}`) { const t = tzParts(nowMs + 864e5, tz); year = t.year; month = t.month; day = t.day }
    return normalizeAt(`${year}-${month}-${day} ${hm}`)
  }
  const md = s.match(/^(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/) || s.match(/^(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})$/)
  if (md) return normalizeAt(`${now.year}-${md[1]}-${md[2]} ${md[3]}:${md[4]}`)
  throw new Error('时间无法识别:' + s + '(可填 10:20 / 07-16 10:20 / 2026-07-16 10:20)')
}

// Flatten per-group crons into a scheduler work-list, tagging each with its chatId. Shape on disk:
// groups[chatId].crons = [{ id, expr|at, kind:'do'|'say'|'run', text, enabled, once?, note?, resetSession?, timeoutMin?, escalate? }].
// kind:'run'(v0.11.103):text 是一条 shell 命令,到点由 daemon 在项目根直接跑,不起 agent(src/core/cronrun.js);
//   timeoutMin 超时上限(默认 15 分钟)· escalate 失败时把输出交给 agent 排查(默认只在群里提示一句)。
// resetSession(v0.11.19,operator 配置层字段):该任务的轮**成功结算后**开新会话 —— 给「整理
// 落盘」类任务用,交接文书就是任务刚写完的文档;失败/被叫停不翻篇。engine 侧消费,这里只透传。
function collectCrons(cfg) {
  const out = []
  for (const [chatId, g] of Object.entries((cfg && cfg.groups) || {})) {
    const list = g && Array.isArray(g.crons) ? g.crons : []
    for (const c of list) if (c && c.id) out.push({ ...c, chatId })
  }
  return out
}

module.exports = { normalizeCron, parseField, matchCron, zhShorthand, describeCron, normalizeAt, matchAt, describeAt, describeTask, expandAt, collectCrons, ALIASES }
