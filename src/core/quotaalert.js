// 额度告警(v0.11.8)—— 订阅额度快见底时在群里说一声。
//
// 为什么要做:额度耗尽的现象是「轮次开始失败 / 报容量满」,群成员看到的只是 bot 忽然变笨
// 或报一句看不懂的英文,没人知道那是额度到顶;而 operator 是唯一能处理的人(等窗口重置 /
// 换模型)。与 v0.9.x「禁令必须配正路」同源:**故障要在发生前说,别让人从怪现象倒推**。
//
// 阈值(operator 2026-08-04 拍板,先写死不做配置面):
//   Claude 5h 会话窗口 已用 > 90%   —— 最常卡人的那档
//   codex  7d 周窗口   已用 > 95%   —— codex 的 5h 窗口**不告警**(用户明确只要周额度)
//
// 去重:窗口身份 = resetsAt,同一窗口只播一次(store.wasQuotaAlerted/markQuotaAlerted,
// 按 **provider** 存 —— 额度是账号级事实,多群共用一个订阅不该吵 N 遍)。
//
// 本模块只做判定与文案,不碰 IO —— 拉数据与发消息在 bin 接线(core 不认具体 runner 名)。

const CLAUDE_SESSION_THRESHOLD = 90
const CODEX_WEEKLY_THRESHOLD = 95

// 距重置的人话(告警文案用,比控制台那个更口语:「约 1.8 小时后」)
function humanReset(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const h = ms / 3600e3
  if (h >= 24) { const d = h / 24; return `约 ${d < 10 ? Number(d.toFixed(1)) : Math.round(d)} 天后` }
  if (h >= 1) return `约 ${h < 10 ? Number(h.toFixed(1)) : Math.round(h)} 小时后`
  return `约 ${Math.max(1, Math.round(ms / 60e3))} 分钟后`
}

// Claude 额度 → 待告警项 | null。limits 来自 claudeusage.parseLimits(percent 是**已用**)。
// 只认 kind==='session'(5h 窗口);其余档不告警(周窗口耗尽极罕见,且它到顶时 5h 早就先炸了)。
function claudeAlert(limits, now = Date.now()) {
  if (!Array.isArray(limits)) return null
  const l = limits.find((x) => x && x.kind === 'session')
  if (!l || typeof l.percent !== 'number' || l.percent <= CLAUDE_SESSION_THRESHOLD) return null
  return {
    kind: 'claude-session',
    percent: Math.min(100, Math.round(l.percent)),
    resetsAt: typeof l.resetsAt === 'number' ? l.resetsAt : null,
    resetIn: typeof l.resetsAt === 'number' && l.resetsAt > now ? l.resetsAt - now : null,
    window: '5 小时',
  }
}

// codex 额度 → 待告警项 | null。usage 来自 codexstatus.mapRateLimits。
// ⚠ 周窗口按 **windowMins >= 1440** 判,**不能按 primary/secondary 位置** —— 官方把周窗口
// 挪到过 primary(v0.3.3 真机踩过:按位置写死会把周窗口误标成 5h)。
// resetsAt 兼容两种口径:>1e9 视作绝对 epoch 秒,否则视作「距重置的秒数」(与控制台同源)。
function codexAlert(usage, now = Date.now()) {
  if (!usage) return null
  const wins = [usage.primary, usage.secondary].filter((w) => w && typeof w.usedPercent === 'number')
  const w = wins.find((x) => Number(x.windowMins) >= 1440)
  if (!w || w.usedPercent <= CODEX_WEEKLY_THRESHOLD) return null
  let resetIn = null
  let resetsAt = null
  if (w.resetsAt != null && Number.isFinite(Number(w.resetsAt))) {
    const raw = Number(w.resetsAt)
    const ms = raw > 1e9 ? raw * 1000 - now : raw * 1000
    if (ms > 0 && ms < 30 * 864e5) { resetIn = ms; resetsAt = now + ms }
  }
  return {
    kind: 'codex-weekly',
    percent: Math.min(100, Math.round(w.usedPercent)),
    // codex 不给绝对重置时刻(只有相对秒数)⇒ 用算出的绝对时刻当窗口身份。**取整到分钟**:
    // 每轮算出的毫秒值都略有不同,不取整则每次都是「新窗口」,去重直接失效(这是本模块最容易
    // 写错的一处 —— Claude 那侧给的是绝对时刻,天然稳定,codex 这侧必须自己稳住)。
    resetsAt: resetsAt == null ? null : Math.round(resetsAt / 60e3) * 60e3,
    resetIn,
    window: '一周',
  }
}

// 告警文案(群里发的那一条)。零工具名:只说「本群使用的模型」,不出现 provider 名/命令名
// —— 群成员看到的产品只有一个身份(`brand`)。
function alertText(a) {
  if (!a) return null
  const when = a.resetIn ? humanReset(a.resetIn) : ''
  return `⚠ 本群模型的 ${a.window}额度已用掉 ${a.percent}%${when ? `,${when}重置` : ''} —— 用完前可能变慢或失败,需要的话可以先缓一缓。`
}

module.exports = { claudeAlert, codexAlert, alertText, humanReset, CLAUDE_SESSION_THRESHOLD, CODEX_WEEKLY_THRESHOLD }
