// 测试共用:读审计本、等异步追加落盘(不是测试文件 —— 文件名不带 test,node --test 不会把它当用例跑)。
//
// 审计本是 fs.appendFile 异步追加(src/core/ledger.js):接口响应回来时那一行可能还没落盘 ——
// 请求一回来就同步读,条数会少(CI Node 20 实见:期望 2 条 via:feishu,读到 1 条)。
// 全量并行跑时落盘能拖好几秒(1 秒、3 秒都偶发不够,2026-09-10 两次)⇒ 默认等到 8 秒;
// 到点仍不成立就返回当时读到的,交给调用方的断言去报红(报错信息比在这里抛更具体)。
// ⚠ 对审计本下断言的用例一律经 waitAudit,别再现场同步读 —— 同形的三处曾各写各的,两处的等待预算还不一样。
const fs = require('node:fs')

// 只解析已经写完整的行(最后一个换行之前):追加写到一半时读到的半行不算
function readAudit(file) {
  if (!fs.existsSync(file)) return []
  const t = fs.readFileSync(file, 'utf8')
  return t.slice(0, t.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

// until:数字 = 至少这么多条;函数 = 对全部记录的判断
async function waitAudit(file, until, { timeoutMs = 8000 } = {}) {
  const ok = typeof until === 'number' ? (rs) => rs.length >= until : until
  const end = Date.now() + timeoutMs
  let rs = readAudit(file)
  while (!ok(rs) && Date.now() < end) { await new Promise((r) => setTimeout(r, 25)); rs = readAudit(file) }
  return rs
}

module.exports = { readAudit, waitAudit }
