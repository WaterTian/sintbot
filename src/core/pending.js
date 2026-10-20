// 被打断的轮次:发版关停掐断的请求,重启后自动重做一遍。
//
// v1 只治**发版掐断**这一个来源(额度耗尽那条搁置到第二次事故)。两台生产机 25 天
// 549 轮里非 ok 共 35 条,但真正「欠着没做」的只有约 5 条 —— 其余是用户自己 /stop
// (「发错地方了吧」「只按照最终版」)或 agent 真做不到(模型不支持识图)。⇒ **事后扫
// ledger 判「该不该续」必然大面积误伤**,成因只能在失败当场打标。
//
// 为什么不从 ledger 回捞正文:ledger 的 text 是 `slice(0, 60)` 的摘要(549 行里 51 行
// 正好 60 字 = 已被截断),且不存 msgId ⇒ 拿它当续做输入会把请求截半。
//
// ⭐ 为什么**只在优雅关停路径记账**:`engine.shutdown()` 是 daemon 自己调的,那一刻确知
// 「这轮不是用户想停的」;崩溃/SIGKILL 根本走不到那行代码 ⇒ **能触发续做的只有 operator
// 亲手敲的 kickstart,而那是白天敲的、人就在旁边**。「防半夜自己开工」的闸门在这条路上
// 没有靶子,故 v1 不做闸门、不给旋钮。反悔阀 = 现成的 /stop(重投前群里先说一句)。
//
// 不记的两类:①`settled` 的轮(答案已发进群、只差子进程没退干净,控制台显示 finalizing)
// —— 掐它不丢答案,续做等于把同一个答案再算一遍钱;②合成消息(定时任务 / 画布按钮)——
// 它们各有自己的触发源(下次到点还会跑、按钮可以再点),且这天然免掉「续做的轮又被掐断
// ⇒ 前缀层层嵌套」。⚠ 已知缺口:一次性 `--at` 定时任务被掐断就真丢了,v1 接受。

const fs = require('node:fs')
const path = require('node:path')

const FILE = 'pending-turns.json'
const DEFAULT_TTL_MINUTES = 120 // 「帮我看下现在的状态」隔一晚再跑就是噪音,不是补做
const MAX_TEXT = 4000   // 群消息本就有上限;截断只为挡畸形/被塞大文件的记录
const MAX_RECORDS = 20  // 并发上限远小于此;超出必是异常,别在启动时刷屏

const pendingFile = (dir) => path.join(dir, FILE)

// 记录合法性:这个文件躺在 agent 够得着的目录里,读回来的东西一律不可信(通则见
// project memory 的「内部入口不存在」那条)。⚠ 残余风险如实记:有 shell 的 agent 能
// 自造一条记录让 bot 重启后往某个群发一句话 —— 但它本就能直接往自己群里发消息,
// 这不是新增暴露面;真正的围栏在消费侧(只对**已绑定且未暂停**的群续做)。
function normalizeRecord(r) {
  if (!r || typeof r !== 'object') return null
  const chatId = typeof r.chatId === 'string' ? r.chatId.trim() : ''
  const text = typeof r.text === 'string' ? r.text.trim().slice(0, MAX_TEXT) : ''
  if (!chatId || !text) return null
  const ts = Number(r.ts)
  return {
    chatId,
    text,
    msgId: typeof r.msgId === 'string' ? r.msgId : null,
    sender: typeof r.sender === 'string' ? r.sender.slice(0, 80) : '',
    ts: Number.isFinite(ts) && ts > 0 ? ts : 0,
  }
}

// 关停路径落盘:**必须同步** —— 调用方紧接着 process.exit,异步写会连文件都留不下。
// 先写临时文件再 rename(与 store 同款原子写):半截 JSON 比没有更糟,它会让下次启动
// 拿着残缺正文去重做。空数组不落文件。
function writePending(file, records, log = () => {}) {
  const list = (Array.isArray(records) ? records : []).map(normalizeRecord).filter(Boolean).slice(0, MAX_RECORDS)
  if (!list.length) return 0
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 }) // 存的是请求原文
    fs.renameSync(tmp, file)
    return list.length
  } catch (e) {
    log('被打断的请求落盘失败: ' + (e && e.message))
    return 0
  }
}

// 读取即消费(读完就删):启动路径只此一次调用,删在前、用在后 —— 续做本身再崩也不会
// 让同一笔在每次重启时反复重投(「每笔只续一次」这条不变量落在这儿)。
function takePending(file, log = () => {}) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch { return [] } // 没有文件 = 上次是干净退出,正常路径
  try { fs.unlinkSync(file) } catch (e) { log('被打断的请求记录删除失败: ' + (e && e.message)) }
  try {
    const parsed = JSON.parse(raw)
    return (Array.isArray(parsed) ? parsed : []).map(normalizeRecord).filter(Boolean).slice(0, MAX_RECORDS)
  } catch (e) {
    log('被打断的请求记录读取失败(格式错误,已丢弃): ' + (e && e.message))
    return []
  }
}

// 按时效分两堆:due 重做,expired 只记一行日志。ts 缺失(0)当过期处理 —— 判不了新旧
// 就别重做,fail-safe 必须往「不动手」倒。
function resumable(records, { now = 0, ttlMinutes = DEFAULT_TTL_MINUTES } = {}) {
  const ttlMs = Math.max(0, Number(ttlMinutes) || 0) * 60_000
  const due = []
  const expired = []
  for (const r of Array.isArray(records) ? records : []) {
    const rec = normalizeRecord(r)
    if (!rec) continue
    if (!rec.ts || now - rec.ts > ttlMs) expired.push(rec)
    else due.push(rec)
  }
  return { due, expired }
}

// 重投给 agent 的正文。前缀不是客套 —— **被掐断的轮多半没留下会话记录**(codex 只在
// 干净退出才落盘 rollout,claude 侧 setSession 也只在 runner resolve 时才调)⇒ agent
// 对自己做了一半的活儿是失忆的。不明说,它就会把「改完提交」原样再做一遍。
function resumePrompt(rec) {
  return '(这条是上次运行时被打断的请求 —— 当时正在处理它,重启把进程掐断了,现在重做一遍。\n' +
    '⚠ 你可能已经做过一部分,而被掐断的那轮通常没有留下会话记录,你对它是失忆的 ⇒ 动手前先确认\n' +
    '当前状态(文件改了没、提交了没、消息发了没),别重复执行有副作用的操作。只读的查询直接重做。)\n\n' +
    String((rec && rec.text) || '')
}

// 重投前的群内告知。**不是问询、不等确认** —— 等确认要一整套回复匹配状态机,而反悔用
// 现成的 /stop 就够。发它的唯一理由:bot 无端开工比不开工更吓人。
// ⚠ 纯文本消息不渲染 markdown ⇒ 层次只能用【】与「· 」(群消息体裁,v0.11.11)。
function resumeNotice(rec, { maxQuote = 60 } = {}) {
  const t = String((rec && rec.text) || '').replace(/\s+/g, ' ').trim()
  const quote = t.length > maxQuote ? t.slice(0, maxQuote) + '…' : t
  const L = ['【继续上次被打断的任务】', '上次运行时我正在处理这条,重启把它打断了 —— 现在重做一遍。']
  if (rec && rec.sender) L.push(`· 提问人:${rec.sender}`)
  L.push(`· 原文:${quote}`)
  L.push('· 不需要就发 /stop 停掉')
  return L.join('\n')
}

module.exports = { pendingFile, writePending, takePending, resumable, resumePrompt, resumeNotice, DEFAULT_TTL_MINUTES }
