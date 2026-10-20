// 画布播报卡回填通道(daemon ↔ CLI 文件桥,2026-07-23)。
//
// 单卡回填(产品决定):点「按标注改图」按钮时 daemon 把这张播报卡的实体 cardId 入队;agent 改完调
// `board-add-image --deliver` 出队 → cardkit card.update 把结果图回填进原卡(处理中 → 结果卡,始终
// 一张卡);agent 没 --deliver 时,轮次结束 daemon 兜底出队把卡收尾(不卡处理中)。
//
// **FIFO 队列而非单槽**(审查修正 M6):第 1 轮进行中用户又点了第 2 张播报卡 ⇒ 两条各自入队;群锁
// 保证轮次线性执行 ⇒ 交付顺序 = 触发顺序,shift 出的恰是本轮的卡,不串。单轮多次 --deliver 时第二次
// 起队列已空 ⇒ 新发结果卡(可接受)。条目带 ts,出队时丢弃超龄陈旧条目(审查修正 L13:防隔天残留
// 被无关交付误用;上限取轮次墙钟的宽余量)。
//
// 单写(daemon 确认入口)单读(CLI --deliver / daemon 收尾),原子写;不上锁(与 boardops 同款纪律)。
const fs = require('fs')
const os = require('os')
const path = require('path')
const { atomicWriteJSON } = require('../core/store')

const NOTICE_MAX_AGE_MS = 6 * 60 * 60_000 // 陈旧上限 6h(轮次墙钟 2h 的宽余量)
const NOTICE_MAX_QUEUE = 5 // 队列上限(防异常堆积;超出丢最旧)

function boardNoticeDir() {
  return path.join(os.homedir(), '.sbot', 'board-notice')
}

// chatId 形如 oc_xxx(文件名安全),仍 encodeURIComponent 兜底非常规字符
const noticeFile = (dir, chatId) => path.join(dir, encodeURIComponent(chatId) + '.json')

function _readQueue(dir, chatId, now) {
  let q
  try { q = JSON.parse(fs.readFileSync(noticeFile(dir, chatId), 'utf8')).queue } catch { return [] }
  if (!Array.isArray(q)) return []
  return q.filter((n) => n && typeof n === 'object' && (now - (Number(n.ts) || 0)) <= NOTICE_MAX_AGE_MS)
}

function _writeQueue(dir, chatId, queue) {
  if (!queue.length) { try { fs.unlinkSync(noticeFile(dir, chatId)) } catch {} ; return }
  fs.mkdirSync(dir, { recursive: true })
  atomicWriteJSON(noticeFile(dir, chatId), { queue })
}

// 确认入口调用:一条待回填锚点入队(FIFO 尾部;超上限丢最旧)。
function pushNotice(dir, chatId, item, now = Date.now()) {
  const q = _readQueue(dir, chatId, now)
  q.push({ ...(item || {}), ts: now })
  while (q.length > NOTICE_MAX_QUEUE) q.shift()
  _writeQueue(dir, chatId, q)
}

// --deliver / 轮次收尾调用:出队最旧一条(= 当前正交付的轮次;过期条目已滤)。空队返回 null。
function shiftNotice(dir, chatId, now = Date.now()) {
  const q = _readQueue(dir, chatId, now)
  if (!q.length) { _writeQueue(dir, chatId, q); return null } // 顺带清掉全过期的文件
  const head = q.shift()
  _writeQueue(dir, chatId, q)
  return head
}

// 只看队头不消费(是否有待回填锚点)。
function peekNotice(dir, chatId, now = Date.now()) {
  const q = _readQueue(dir, chatId, now)
  return q.length ? q[0] : null
}

// 按本轮 goId(触发的合成消息 msgId,boardgo:chatId:ts)精确取该轮的锚点 —— **不靠 FIFO 头**。
// detached imagen worker 交付顺序与轮次 done 顺序会错位,靠头出队会张冠李戴/卡死;done 兜底用它
// 精确摘自己这轮的卡(审查 M2)。opts.peek=true 只查不消费。goIds 传本轮全批 msgIds(排队合并)。
function takeNoticeByGo(dir, chatId, goIds, opts = {}, now = Date.now()) {
  const q = _readQueue(dir, chatId, now)
  const set = new Set(Array.isArray(goIds) ? goIds : [goIds])
  const i = q.findIndex((n) => n && n.goId != null && set.has(n.goId))
  if (i < 0) { _writeQueue(dir, chatId, q); return null } // 顺带清过期
  const hit = q[i]
  if (!opts.peek) { q.splice(i, 1); _writeQueue(dir, chatId, q) } else { _writeQueue(dir, chatId, q) }
  return hit
}

module.exports = { boardNoticeDir, pushNotice, shiftNotice, peekNotice, takeNoticeByGo, NOTICE_MAX_AGE_MS, NOTICE_MAX_QUEUE }
