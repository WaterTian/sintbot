// boardops(bot 侧画布写留痕)—— append/read 往返 / ts 单调 / trim / 容错 / 文件名清洗
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { appendBoardOp, readBoardOps, opsFile, MAX_OPS } = require('../../src/platform/boardops')

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-boardops-'))

test('boardops: append→read 往返一致,ts 严格单调递增', () => {
  const dir = tmpDir()
  appendBoardOp(dir, 'wb1', { op: 'add', ids: ['a1', 'a2'] })
  appendBoardOp(dir, 'wb1', { op: 'rewrite', ids: ['b1'] })
  const ops = readBoardOps(dir, 'wb1')
  assert.equal(ops.length, 2)
  assert.equal(ops[0].op, 'add')
  assert.deepEqual(ops[0].ids, ['a1', 'a2'])
  assert.equal(ops[1].op, 'rewrite')
  assert.ok(ops[1].ts > ops[0].ts) // 同毫秒也保证 +1(daemon 游标是 > 语义,相等会丢)
})

test('boardops: 超过 MAX_OPS 只留末 N 条', () => {
  const dir = tmpDir()
  for (let i = 0; i < MAX_OPS + 7; i++) appendBoardOp(dir, 'wb1', { op: 'add', ids: ['n' + i] })
  const ops = readBoardOps(dir, 'wb1')
  assert.equal(ops.length, MAX_OPS)
  assert.deepEqual(ops[ops.length - 1].ids, ['n' + (MAX_OPS + 6)]) // 最新的在,最老的被裁
})

test('boardops: 损坏文件不抛 —— append 重建,read 返回空', () => {
  const dir = tmpDir()
  fs.writeFileSync(opsFile(dir, 'wb1'), '{broken json')
  assert.deepEqual(readBoardOps(dir, 'wb1'), [])
  appendBoardOp(dir, 'wb1', { op: 'add', ids: ['x'] }) // 不抛,重建
  assert.equal(readBoardOps(dir, 'wb1').length, 1)
})

test('boardops: 不存在的画板 read 返回 []', () => {
  assert.deepEqual(readBoardOps(tmpDir(), 'wb_none'), [])
})

test('boardops: 画板 id 里的路径危险字符被清洗出文件名', () => {
  const f = opsFile('/base', '../evil/../../etc')
  assert.equal(path.dirname(f), '/base') // 逃不出目录
  assert.doesNotMatch(path.basename(f, '.json'), /[/\\.]/)
})

test('boardops: ids 非数组时落盘为空数组(不落 undefined)', () => {
  const dir = tmpDir()
  appendBoardOp(dir, 'wb1', { op: 'add', ids: 'oops' })
  assert.deepEqual(readBoardOps(dir, 'wb1')[0].ids, [])
})
