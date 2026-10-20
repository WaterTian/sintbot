// boardnotice(单卡回填文件桥,FIFO 队列)—— push/shift/peek 往返、时效过滤、多群隔离、上限
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const bn = require('../../src/platform/boardnotice')

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-notice-')) }

test('boardnotice: push → peek(不消费)→ shift(消费)→ 空;FIFO 顺序 = 轮次顺序', () => {
  const dir = tmpDir()
  assert.equal(bn.shiftNotice(dir, 'oc_x'), null) // 空队
  bn.pushNotice(dir, 'oc_x', { msgId: 'om_1', cardId: 'crd_1', url: 'https://f/x' })
  bn.pushNotice(dir, 'oc_x', { msgId: 'om_2', cardId: 'crd_2' })
  const p = bn.peekNotice(dir, 'oc_x')
  assert.equal(p.cardId, 'crd_1', 'peek 看队头')
  assert.equal(bn.peekNotice(dir, 'oc_x').cardId, 'crd_1', 'peek 不消费')
  assert.equal(bn.shiftNotice(dir, 'oc_x').cardId, 'crd_1', '第 1 轮先交付拿第 1 卡')
  assert.equal(bn.shiftNotice(dir, 'oc_x').cardId, 'crd_2', '第 2 轮拿第 2 卡 — 多轮不串')
  assert.equal(bn.shiftNotice(dir, 'oc_x'), null)
})

test('boardnotice: 每群独立(chatId 隔离)', () => {
  const dir = tmpDir()
  bn.pushNotice(dir, 'oc_a', { cardId: 'a1' })
  bn.pushNotice(dir, 'oc_b', { cardId: 'b1' })
  assert.equal(bn.shiftNotice(dir, 'oc_a').cardId, 'a1')
  assert.equal(bn.shiftNotice(dir, 'oc_b').cardId, 'b1')
})

test('boardnotice: 超龄条目出队时被丢弃(陈旧 notice 不被无关交付误用)', () => {
  const dir = tmpDir()
  const past = Date.now() - bn.NOTICE_MAX_AGE_MS - 60_000
  bn.pushNotice(dir, 'oc_x', { cardId: 'old' }, past) // 注入过期时刻
  bn.pushNotice(dir, 'oc_x', { cardId: 'new' })
  assert.equal(bn.shiftNotice(dir, 'oc_x').cardId, 'new', '过期条目被滤,直接拿到新条目')
  assert.equal(bn.shiftNotice(dir, 'oc_x'), null)
})

// 审查 M2:done 兜底按本轮 goId 精确摘卡(不靠 FIFO 头)—— detached imagen worker 交付会错位
test('boardnotice: takeNoticeByGo 按 goId 精确摘中间条目,不动其它;peek 不消费', () => {
  const dir = tmpDir()
  bn.pushNotice(dir, 'oc_x', { cardId: 'A', goId: 'boardgo:oc_x:1', kind: 'apply' })
  bn.pushNotice(dir, 'oc_x', { cardId: 'B', goId: 'boardgo:oc_x:2', kind: 'sync' })
  bn.pushNotice(dir, 'oc_x', { cardId: 'C', goId: 'boardgo:oc_x:3', kind: 'apply' })
  // peek 中间那张(sync 轮)不消费
  assert.equal(bn.takeNoticeByGo(dir, 'oc_x', ['boardgo:oc_x:2'], { peek: true }).cardId, 'B')
  // 精确摘 B(队列中段),A/C 原样保留
  assert.equal(bn.takeNoticeByGo(dir, 'oc_x', ['boardgo:oc_x:2']).cardId, 'B')
  assert.equal(bn.peekNotice(dir, 'oc_x').cardId, 'A', 'A 仍在队头')
  // 传全批 msgIds(含无关 id)也能命中;未命中返回 null
  assert.equal(bn.takeNoticeByGo(dir, 'oc_x', ['x', 'boardgo:oc_x:3']).cardId, 'C')
  assert.equal(bn.takeNoticeByGo(dir, 'oc_x', ['boardgo:oc_x:2']), null, '已摘走不再命中')
  // 无 goId 的老条目不被误摘
  bn.pushNotice(dir, 'oc_y', { cardId: 'legacy' })
  assert.equal(bn.takeNoticeByGo(dir, 'oc_y', ['boardgo:oc_y:9']), null)
})

test('boardnotice: 队列上限 — 超出丢最旧;损坏文件按空队处理', () => {
  const dir = tmpDir()
  for (let i = 1; i <= bn.NOTICE_MAX_QUEUE + 2; i++) bn.pushNotice(dir, 'oc_x', { cardId: 'c' + i })
  assert.equal(bn.shiftNotice(dir, 'oc_x').cardId, 'c3', '最旧两条(c1/c2)被挤出')
  // 损坏文件
  fs.writeFileSync(path.join(dir, encodeURIComponent('oc_bad') + '.json'), '{not json')
  assert.equal(bn.shiftNotice(dir, 'oc_bad'), null)
  bn.pushNotice(dir, 'oc_bad', { cardId: 'ok' }) // 损坏后仍可正常写
  assert.equal(bn.shiftNotice(dir, 'oc_bad').cardId, 'ok')
})
