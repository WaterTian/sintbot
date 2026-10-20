// bot 侧画布写操作留痕(ops journal)—— 轮询自动感知的自编辑抑制数据面(docs/BOARD.md)。
// 事件版有 operator_ids 可辨「谁改的」;轮询版只看得到节点集,故 CLI 的写动作(add-image /
// del-node / create 使用说明便签)成功后把服务端返回的**持久 id** 记在这里,daemon 轮询先
// 重放到基线再 diff ⇒ bot 自己放的图不当「新增」播报;del-node 的 overwrite 会让全部节点
// id 变化,rewrite 留痕带的是重写后全量新 id ⇒ 基线直接重置,不把整板当新内容重放。
// 纯 fs 零依赖;withFileLock 串行化并发写(锁语义同 config 写回);写失败由调用方忽略 ——
// 留痕丢失的最坏后果 = 多播一次 bot 自己的编辑,好过让主动作失败。
const fs = require('fs')
const path = require('path')
const { atomicWriteJSON, withFileLock } = require('../core/store')

const MAX_OPS = 50 // 每画板只留末 N 条 —— daemon 按 ts 游标消费,陈旧条目无用

function opsFile(dir, whiteboardId) {
  return path.join(dir, String(whiteboardId).replace(/[^A-Za-z0-9_-]/g, '_') + '.json')
}

// op: { op:'add'|'rewrite', ids:[…] };ts 由本函数补(留痕时刻,同文件内保证单调递增 ——
// daemon 的消费游标是「ts > cursor」,同毫秒两条会丢后一条)。
function appendBoardOp(dir, whiteboardId, op) {
  fs.mkdirSync(dir, { recursive: true })
  const file = opsFile(dir, whiteboardId)
  withFileLock(file, () => {
    let ops = []
    try { ops = JSON.parse(fs.readFileSync(file, 'utf8')).ops || [] } catch {} // 首次/损坏 → 重建
    const last = ops.length ? Number(ops[ops.length - 1].ts) || 0 : 0
    ops.push({ ts: Math.max(Date.now(), last + 1), op: op.op, ids: Array.isArray(op.ids) ? op.ids : [] })
    atomicWriteJSON(file, { ops: ops.slice(-MAX_OPS) })
  })
}

function readBoardOps(dir, whiteboardId) {
  try { return JSON.parse(fs.readFileSync(opsFile(dir, whiteboardId), 'utf8')).ops || [] } catch { return [] }
}

module.exports = { appendBoardOp, readBoardOps, opsFile, MAX_OPS }
