// src/ui/dashboard.js —— 控制台「需要你处理」收件箱 + 活动流的账本回填。
// 分辨力:每条「不该出现」的断言旁边都有同形状的正例(同群同人重说过 vs 换了人 / 窗口内 vs 窗口外)。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const db = require('../../src/ui/dashboard')

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-dash-'))
const H = 3600_000

test('readLedgerTail: 读全本跳过坏行;只读末尾时丢掉切开的第一行;没有文件给空', () => {
  const f = path.join(tmpDir(), 'turns.jsonl')
  const rows = [1, 2, 3].map((i) => ({ ts: i, chatId: 'oc_a', text: 'x'.repeat(40) }))
  fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n{"ts":4,"chatId"\n')
  assert.deepEqual(db.readLedgerTail(f).map((r) => r.ts), [1, 2, 3])
  const size = fs.statSync(f).size
  assert.deepEqual(db.readLedgerTail(f, size - 5).map((r) => r.ts), [2, 3], '从第一行中间切开 ⇒ 第一行残片丢掉')
  assert.deepEqual(db.readLedgerTail(path.join(tmpDir(), 'nope.jsonl')), [])
})

test('ledgerActivity: 跳过定时脚本,id 与引擎同形,群名从配置取,带上失败原因,只取最近 n 条', () => {
  const rows = [
    { ts: 1, chatId: 'oc_aaaaaaaa11', sender: '甲', text: 'a', status: 'ok', ms: 10 },
    { ts: 2, chatId: 'oc_aaaaaaaa11', sender: '定时任务', text: 'python3 x.py', status: 'ok', script: true },
    { ts: 3, chatId: 'oc_bbbbbbbb22', sender: '乙', text: 'b', status: 'error', ms: 20, err: '模型报错' },
    { ts: 4, chatId: 'oc_aaaaaaaa11', sender: '甲', text: 'c', status: 'ok', ms: 30, tokens: { in: 1, out: 2 } },
  ]
  const ev = db.ledgerActivity(rows, { oc_aaaaaaaa11: { name: '设计组' } }, 2)
  assert.deepEqual(ev.map((e) => e.id), ['oc_bbbbbbbb22:3', 'oc_aaaaaaaa11:4'])
  assert.equal(ev[0].err, '模型报错'); assert.equal(ev[0].name, 'bbbbbb22', '配置里没有 ⇒ 退回 chatId 尾 8 位')
  assert.equal(ev[1].name, '设计组'); assert.equal(ev[1].group, 'aaaaaa11')
  assert.ok(ev.every((e) => e.kind === 'done' && e.fromLedger))
  assert.ok(!('err' in ev[1]), 'ok 轮不带 err')
  assert.equal(db.ledgerActivity(rows, {}, 20).length, 3, '脚本行不算')
})

test('failedTurns: 同群同一个人之后成功了 ⇒ 消失;换了人 / 别的群成功不算;72 小时外与非失败状态不算', () => {
  const now = 100 * H
  const rows = [
    { ts: now - 80 * H, chatId: 'g1', sender: '甲', status: 'error' },           // 窗口外
    { ts: now - 10 * H, chatId: 'g1', sender: '甲', status: 'failed' },          // 甲之后在 g1 成功了
    { ts: now - 9 * H, chatId: 'g1', sender: '乙', status: 'error' },            // 乙没再成功过(甲成功不算)
    { ts: now - 8 * H, chatId: 'g1', sender: '甲', status: 'ok' },
    { ts: now - 7 * H, chatId: 'g2', sender: '丙', status: 'error' },            // 丙在别的群成功不算
    { ts: now - 6 * H, chatId: 'g3', sender: '丙', status: 'ok' },
    { ts: now - 5 * H, chatId: 'g2', sender: '丁', status: 'stopped' },          // 人按的
    { ts: now - 4 * H, chatId: 'g2', sender: '丁', status: 'no-reply' },
    { ts: now - 3 * H, chatId: 'g2', sender: '戊', status: 'error', script: true }, // 定时脚本
  ]
  assert.deepEqual(db.failedTurns(rows, now).map((r) => r.sender), ['乙', '丙'])
})

test('buildInbox: 各类事项、忽略过的不出现、按时间倒序;没挂群的接管票与只服务子目录的预览不算', () => {
  const now = 50 * H
  const items = db.buildInbox({
    now,
    ledgerRows: [{ ts: now - 2 * H, chatId: 'g1', sender: '甲', text: '改首页', status: 'error', err: '超时' },
      { ts: now - 1 * H, chatId: 'g1', sender: '乙', text: '再试', status: 'failed' }],
    takeovers: [{ id: 't1', at: now - 30 * 60_000, exp: now + 60_000, chatId: 'g2', pageTitle: '登录' }, { id: 't2', at: now, exp: now + 1 }],
    issues: { openCount: 2, open: [{ ts: now - 3 * H }] },
    leftovers: { rows: [{ ageSec: 7200 }, { ageSec: 60 }] },
    previews: [{ id: 'p1', chatId: 'g1', name: '设计组', upMs: 5 * H, port: 4612, projectRoot: true }, { id: 'p2', chatId: 'g1', upMs: 1, projectRoot: false }],
    groups: { g1: { name: '设计组' } },
    dismissed: new Set([`failed:g1:${now - 1 * H}`]),
  })
  assert.deepEqual(items.map((i) => i.key), ['takeover:t1', `failed:g1:${now - 2 * H}`, 'leftovers', 'issues', 'preview:p1'])
  const f = items.find((i) => i.kind === 'failed')
  assert.equal(f.group, '设计组'); assert.equal(f.err, '超时'); assert.equal(f.dismissable, true)
  assert.equal(items.find((i) => i.kind === 'issues').count, 2)
  assert.equal(items.find((i) => i.kind === 'leftovers').ts, now - 7200_000, '按最老的那个进程算时间')
  assert.deepEqual(db.buildInbox({ now }), [], '什么都没有 ⇒ 空单')
})

test('createDismissStore: 忽略落盘、重开读回;7 天后清掉;文件坏了当空', () => {
  let t = 1000
  const file = path.join(tmpDir(), 'sub', 'inbox-dismissed.json')
  const a = db.createDismissStore({ file, now: () => t })
  assert.equal(a.set().size, 0)
  a.add('failed:g1:1')
  assert.ok(db.createDismissStore({ file, now: () => t }).set().has('failed:g1:1'), '重开仍在')
  t += 7 * 24 * H + 1
  assert.equal(db.createDismissStore({ file, now: () => t }).set().size, 0, '7 天后清掉')
  fs.writeFileSync(file, '{坏')
  assert.equal(db.createDismissStore({ file, now: () => t }).set().size, 0)
})

test('buildInbox: 健康检查没通过的排最前,只算 fail 不算 warn', () => {
  const now = Date.now()
  const health = { rows: [{ status: 'ok', label: 'Claude CLI' }, { status: 'warn', label: '可用群 / 项目' }, { status: 'fail', label: '飞书凭据' }] }
  const items = db.buildInbox({ health, issues: { openCount: 1, open: [{ ts: now }] }, now })
  assert.deepEqual(items.map((i) => i.key), ['health', 'issues'])
  assert.equal(items[0].count, 1); assert.deepEqual(items[0].labels, ['飞书凭据'])
  assert.deepEqual(db.buildInbox({ health: { rows: [{ status: 'warn', label: 'x' }] }, now }), [])
})

test('createLedgerTail: 账本没变就不重读;追加后读到新行;文件没了给空', () => {
  const file = path.join(tmpDir(), 'turns.jsonl')
  const tail = db.createLedgerTail(file)
  assert.deepEqual(tail.rows(), [])
  fs.writeFileSync(file, JSON.stringify({ ts: 1, chatId: 'g1' }) + '\n')
  const a = tail.rows()
  assert.equal(a.length, 1)
  assert.equal(tail.rows(), a, '没变 ⇒ 同一份(没重新解析)')
  fs.appendFileSync(file, JSON.stringify({ ts: 2, chatId: 'g1' }) + '\n')
  assert.equal(tail.rows().length, 2)
  fs.rmSync(file)
  assert.deepEqual(tail.rows(), [])
})
