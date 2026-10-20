// 企业微信「不 @ 也回复」的第二道门:**便宜模型门控**(纯逻辑,依赖全注入,可单测)。
//
// 第一道门是规则(wecompoll.js:点名 / 跟进窗口),零 token 但只认死规矩 —— 「刚才那个报表再发一份」这种明显在对机器人
// 说话却没点名、也过了跟进窗口的消息,规则只能放过。这里补第二道:规则判不了的消息,拿最近几句群聊 + 这一句去问一个
// **便宜的模型**「机器人该不该接这句」,它说 YES 才喂真正的 agent。问一次只花十几到一百多 token、不带会话、不起 CLI
// (走 provider 的 HTTP 端点,见 src/agent/askonce.js),与喂一轮 agent(几万到几十万 token 上下文)差三个数量级。
//
// 边界与保险:
//   · 宁漏不误:问不通(超时 / 网络 / 回包看不懂)一律当 NO —— 漏答一句不要紧(人再 @ 一次就行),误答是打扰。
//   · 不值一问的不问:太短(≤ 1 个字)、只有表情 / 标点、纯链接,直接 NO,省掉子请求。
//   · 限速:每个群每分钟最多问 maxPerMin 次(默认 6),超出的当 NO 并记一次日志 —— 群里刷屏时别把门控自己刷成一笔开销。
//   · 判定模型看到的是**去身份的文字**(昵称 + 正文),不给 userid、不给机器路径;正文截断到 MAX_TEXT 字。
// 操作者没配 gatekeeper 时整个模块不参与(wecompoll 的 gate 为 null),行为与 v0.11.110 完全一致。

const MAX_TEXT = 400       // 候选正文 / 每条上下文最多保留的字数(门控只看大意,长文截了不影响判定)
const MAX_RECENT = 8       // 给判定模型看的最近几句
const DEFAULT_PER_MIN = 6

// 「不值一问」:太短 / 只有表情标点 / 只有链接 ⇒ 不问直接 NO
function trivial(text) {
  const t = String(text || '').trim()
  if (t.length <= 1) return true
  if (/^https?:\/\/\S+$/i.test(t)) return true
  // 剥掉所有字母数字与 CJK 后若什么都不剩 ⇒ 只有表情 / 标点
  const core = t.replace(/[\p{L}\p{N}]/gu, '')
  return core.length === t.length
}

const clip = (s) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + '…' : t }

// 判定提示词:system 定规则,user 给上下文与候选句。只要求输出 YES / NO,方便任何模型、任何语言习惯都能答对。
function buildGatePrompt({ botName = '', recent = [], candidate = {} } = {}) {
  const name = botName || '机器人'
  const system = [
    `你是群聊里一个助手机器人「${name}」的「要不要接话」判定器。群成员刚发了一条消息,没有 @ 机器人、也没叫它的名字。`,
    `只有当这条消息明显是在对机器人说话、或在请求机器人能做的事(查资料、看代码改代码、生成图片、读文件、回答问题、继续刚才机器人在做的任务)时,回答 YES。`,
    `消息末尾的「[附图片]」「[附文件 …]」表示这条消息带着附件:带附件并在问「这是什么 / 看看这个 / 帮我处理」之类的,是在让机器人看,回答 YES。`,
    `成员之间的闲聊、对某个人说的话、表情、简短的附和(「好」「收到」「哈哈」)、与机器人无关的通知,一律回答 NO。拿不准就 NO。`,
    `只输出 YES 或 NO,不要解释。`,
  ].join('\n')
  const ctx = (recent || []).slice(-MAX_RECENT).map((m) => `- ${m.sender || '成员'}${m.bot ? '(机器人)' : ''}:${clip(m.text)}`)
  const user = [
    ctx.length ? '最近的群消息(旧→新):' : '(这个群最近没有别的消息)',
    ...ctx,
    `候选消息 —— ${candidate.sender || '成员'}:「${clip(candidate.text)}」`,
    '机器人要不要接这一句?',
  ].join('\n')
  return { system, user }
}

// 回包 → true / false / null(看不懂)。只认开头:YES / NO / 是 / 否;前面允许少量空白与标点
function parseVerdict(text) {
  const t = String(text || '').trim().replace(/^[\s"'`*「」【】()()\[\]]+/, '')
  if (/^yes\b/i.test(t) || /^是/.test(t) || /^要/.test(t)) return true
  if (/^no\b/i.test(t) || /^否/.test(t) || /^不/.test(t)) return false
  return null
}

/**
 * @param {object} o
 *   ask        — async ({system, user}) => string  问一次便宜模型(由接线层按 provider 配置实现;抛 = 问不通)
 *   botName    — 机器人名(提示词里用;可给函数,现读配置)
 *   maxPerMin  — 每群每分钟最多问几次(默认 6;0 = 不限)
 *   now / log  — 注入时钟 / 日志
 * 返回 gate(chatId, { text, sender, recent }) => Promise<boolean>
 */
function createGatekeeper({ ask, botName = '', maxPerMin = DEFAULT_PER_MIN, now = () => Date.now(), log = () => {} } = {}) {
  if (typeof ask !== 'function') throw new Error('gatekeeper: ask required')
  const asked = new Map()   // chatId → [时刻…](最近一分钟)
  const stats = { asked: 0, yes: 0, no: 0, failed: 0, skipped: 0, throttled: 0 }
  let failStreak = 0

  const underLimit = (chatId) => {
    if (!(maxPerMin > 0)) return true
    const t = now()
    const arr = (asked.get(chatId) || []).filter((x) => t - x < 60_000)
    if (arr.length >= maxPerMin) { asked.set(chatId, arr); return false }
    arr.push(t); asked.set(chatId, arr)
    return true
  }

  async function gate(chatId, { text, sender, recent } = {}) {
    if (trivial(text)) { stats.skipped++; return false }
    if (!underLimit(chatId)) {
      stats.throttled++
      if (stats.throttled === 1 || stats.throttled % 50 === 0) log(`企业微信门控限速(…${String(chatId).slice(-8)}):一分钟内超过 ${maxPerMin} 条,多出的不问直接不答(累计 ${stats.throttled})`)
      return false
    }
    stats.asked++
    let raw
    try { raw = await ask(buildGatePrompt({ botName: typeof botName === 'function' ? botName() : botName, recent, candidate: { text, sender } })) } catch (e) {
      stats.failed++; failStreak++
      if (failStreak <= 3 || failStreak % 30 === 0) log(`企业微信门控问不通(第 ${failStreak} 次,当作不答): ` + String((e && e.message) || e).slice(0, 160))
      return false
    }
    failStreak = 0
    const v = parseVerdict(raw)
    if (v === null) { stats.failed++; log('企业微信门控回答看不懂(当作不答): ' + String(raw).slice(0, 60)); return false }
    if (v) stats.yes++; else stats.no++
    // 每次判定一行日志:NO 路径不然看不见(真机 11:44 一条带图的问句被判 NO,翻日志只看到「门控生效」,查不出判了什么);问过的才记,已经限速
    log(`企业微信门控 ${v ? 'YES' : 'NO'}(…${String(chatId).slice(-8)}):${String(text).replace(/\s+/g, ' ').slice(0, 40)}`)
    return v
  }

  return Object.assign(gate, { stats: () => ({ ...stats }) })
}

module.exports = { createGatekeeper, buildGatePrompt, parseVerdict, trivial, MAX_RECENT, DEFAULT_PER_MIN }
