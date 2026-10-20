// 被打断的轮次(src/core/pending.js):落盘/消费/时效判定与两段文案的纯逻辑。
// 接线(关停时记账、启动时重投)在 bin,不在单测范围;engine 侧的快照判据在 engine.test.js。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pendingFile, writePending, takePending, resumable, resumePrompt, resumeNotice } = require('../../src/core/pending')

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-pending-'))
const rec = (o = {}) => ({ chatId: 'oc_1', text: '把上周的周报整理一下', msgId: 'm1', sender: '韩梅梅', ts: 1_700_000_000_000, ...o })

test('pending: 落盘后读回一致,且**读取即消费**(第二次为空)', () => {
  const f = pendingFile(tmpdir())
  assert.equal(writePending(f, [rec()]), 1)
  const got = takePending(f)
  assert.equal(got.length, 1)
  assert.deepEqual(got[0], rec())
  assert.equal(fs.existsSync(f), false) // 删在用之前:续做本身再崩也不会每次重启都重投
  assert.deepEqual(takePending(f), [])
})

test('pending: 没有文件 = 上次干净退出,不是错误', () => {
  assert.deepEqual(takePending(pendingFile(tmpdir())), [])
})

test('pending: 空列表不落文件(干净关停不留垃圾)', () => {
  const f = pendingFile(tmpdir())
  assert.equal(writePending(f, []), 0)
  assert.equal(writePending(f, [{ chatId: '', text: '' }]), 0) // 全被判非法 ⇒ 同样不落
  assert.equal(fs.existsSync(f), false)
})

test('pending: 坏 JSON 丢弃并删文件 —— 半截正文比没有更糟', () => {
  const f = pendingFile(tmpdir())
  fs.writeFileSync(f, '[{"chatId":"oc_1","text":"查一')
  const logs = []
  assert.deepEqual(takePending(f, (m) => logs.push(m)), [])
  assert.equal(fs.existsSync(f), false)
  assert.match(logs.join(' '), /格式错误/)
})

test('pending: 非法记录逐条剔除(缺 chatId / 缺正文 / 非对象)', () => {
  const f = pendingFile(tmpdir())
  writePending(f, [rec(), { chatId: 'oc_2' }, { text: '没有群' }, null, 'x', rec({ chatId: 'oc_3' })])
  const got = takePending(f)
  assert.deepEqual(got.map((r) => r.chatId), ['oc_1', 'oc_3'])
})

test('pending: 正文超长截断、记录数超上限截断(挡畸形/被塞大文件的记录)', () => {
  const f = pendingFile(tmpdir())
  writePending(f, [rec({ text: 'x'.repeat(9000) })])
  assert.equal(takePending(f)[0].text.length, 4000)
  writePending(f, Array.from({ length: 50 }, (_, i) => rec({ chatId: 'oc_' + i })))
  assert.equal(takePending(f).length, 20)
})

test('pending: 时效内的重做,超时的只记不做', () => {
  const now = 1_700_000_000_000
  const { due, expired } = resumable([
    rec({ chatId: 'fresh', ts: now - 5 * 60_000 }),   // 5 分钟前 —— 发版重启的典型间隔
    rec({ chatId: 'old', ts: now - 5 * 60 * 60_000 }), // 5 小时前 —— 隔夜的「看下现在的状态」是噪音
  ], { now })
  assert.deepEqual(due.map((r) => r.chatId), ['fresh'])
  assert.deepEqual(expired.map((r) => r.chatId), ['old'])
})

test('pending: ts 缺失/非法当过期处理 —— 判不了新旧就别动手', () => {
  const now = 1_700_000_000_000
  const { due, expired } = resumable([rec({ ts: 0 }), rec({ chatId: 'oc_2', ts: 'zz' })], { now })
  assert.equal(due.length, 0)
  assert.equal(expired.length, 2)
})

test('pending: ttlMinutes 可调,0 = 一律不重做', () => {
  const now = 1_700_000_000_000
  assert.equal(resumable([rec({ ts: now - 1000 })], { now, ttlMinutes: 0 }).due.length, 0)
  assert.equal(resumable([rec({ ts: now - 1000 })], { now, ttlMinutes: 1 }).due.length, 1)
})

test('pending: 重投正文 = 前缀 + 原文,前缀必须点明「可能已做过一半 + 先确认」', () => {
  const p = resumePrompt(rec({ text: '把首页改成深色并提交' }))
  assert.ok(p.endsWith('把首页改成深色并提交')) // 原文原样在末尾,不截断不改写
  assert.match(p, /被打断/)
  assert.match(p, /失忆|确认/)  // 被掐断的轮多半没落会话记录,不说它就会重复提交
  assert.match(p, /副作用/)
})

test('pending: 群内告知走纯文本体裁 —— 【】与「· 」,不出现 markdown 记号', () => {
  const n = resumeNotice(rec())
  assert.match(n, /^【继续上次被打断的任务】/)
  assert.match(n, /· 提问人:韩梅梅/)
  assert.match(n, /· 原文:把上周的周报整理一下/)
  assert.match(n, /\/stop/) // 反悔阀用现成命令,不另造闸门
  assert.equal(/[*#|]|^- /m.test(n), false) // 纯文本消息不渲染 markdown,写了就显示成符号
})

test('pending: 告知里的原文过长截断,不把整篇任务书刷进群', () => {
  const n = resumeNotice(rec({ text: '第一行\n第二行'.repeat(50) }))
  const quote = n.split('\n').find((l) => l.startsWith('· 原文:'))
  assert.ok(quote.length < 80)
  assert.ok(quote.endsWith('…'))
  assert.equal(quote.includes('\n'), false) // 换行压平,免得一条告知撑成一屏
})

test('pending: 没有发送者名时不硬编一行空的提问人', () => {
  assert.equal(resumeNotice(rec({ sender: '' })).includes('提问人'), false)
})
