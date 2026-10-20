// 群内反馈本(src/core/issues.js)—— 事件流折叠、发号、指纹与落盘。
// 这本账的消费者是「把多台机器的本子拉到一起集中分析」那一步,所以两条不变量最要紧:
// ① 反馈原话不可被后续操作改写(它是证据) ② 发号不能重复(重号会让 close 打在错的那条上)。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createIssues, foldEvents, nextId, parseLines, summarize, fingerprint, MAX_TEXT } = require('../../src/core/issues')

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-issues-')), 'issues.jsonl')
const openEv = (id, over = {}) => ({ op: 'open', id, ts: 1000 + id, chatId: 'oc_x', group: 'G群', sender: '韩梅梅', text: '图片一直没出来', version: '0.11.24', host: 'h1', turn: null, ...over })

test('issues: open 事件折叠成未处理态', () => {
  const [it] = foldEvents([openEv(1)])
  assert.equal(it.id, 1)
  assert.equal(it.status, 'open')
  assert.equal(it.sender, '韩梅梅')
  assert.equal(it.text, '图片一直没出来')
})

test('issues: close 只改状态与备注,不动原文', () => {
  const [it] = foldEvents([openEv(1), { op: 'close', id: 1, ts: 9000, note: 'v0.11.24 修了' }])
  assert.equal(it.status, 'closed')
  assert.equal(it.note, 'v0.11.24 修了')
  assert.equal(it.closedAt, 9000)
  assert.equal(it.text, '图片一直没出来', '反馈原话是证据,任何后续操作都不能改写它')
})

test('issues: 后续事件塞了 text 也改不动原文(证据不可篡改)', () => {
  const [it] = foldEvents([openEv(1), { op: 'close', id: 1, ts: 9000, text: '被改过的说法' }])
  assert.equal(it.text, '图片一直没出来')
})

test('issues: reopen 把它放回未处理,并清掉关闭时间', () => {
  const [it] = foldEvents([openEv(1), { op: 'close', id: 1, ts: 9000 }, { op: 'reopen', id: 1, ts: 9500 }])
  assert.equal(it.status, 'open')
  assert.equal(it.closedAt, 0)
})

test('issues: close 一个不存在的 id 被忽略,不凭空造出记录', () => {
  assert.equal(foldEvents([{ op: 'close', id: 42, ts: 1 }]).length, 0)
})

test('issues: 未知 op 忽略,整本仍读得出来(老版本读新文件)', () => {
  const arr = foldEvents([openEv(1), { op: 'someFutureOp', id: 1, ts: 2 }, openEv(2)])
  assert.equal(arr.length, 2)
  assert.equal(arr[0].status, 'open')
})

test('issues: 发号取历史最大 + 1,不是条数 + 1', () => {
  // 手工删过行之后条数会小于最大号 —— 用条数发号就会发出重复号,而重号会让 close
  // 打在错的那条上(这正是本文件里最容易写错、也最难在生产上察觉的一处)。
  const items = foldEvents([openEv(1), openEv(7)])
  assert.equal(items.length, 2)
  assert.equal(nextId(items), 8, '条数是 2,但下一个号必须是 8')
  assert.equal(nextId([]), 1)
})

test('issues: 一行坏 JSON 不会让整本读不出来', () => {
  const evs = parseLines('{"op":"open","id":1}\n{坏行\n{"op":"open","id":2}\n')
  assert.deepEqual(evs.map((e) => e.id), [1, 2])
})

test('issues: 指纹带上 status/耗时/token/模型 —— 报问题的人描述不出的那半', () => {
  const fp = fingerprint({ status: 'ok', ms: 5161, tokens: { in: 0, out: 0 }, provider: 'claude' })
  assert.match(fp, /ok/)
  assert.match(fp, /5s/)
  assert.match(fp, /tokens\{in:0,out:0\}/, '空轮的判据就藏在这两个零里')
  assert.match(fp, /claude/)
  assert.equal(fingerprint(null), '', '没有上一轮就不附,不为凑字段编一个')
})

// ⭐ 失败原因必须**渲染出来**。此前引擎把 err 存进了 turn,而这里是固定白名单 ⇒ 三个人眼可见
// 的出口(控制台概览 / issue list / 群里回执)全都丢掉它 —— 承诺的能力一个字都没到达用户手上,
// 而当时的测试断言的是**裸对象**,全绿。判据要钉在**渲染结果**上,不是钉在数据结构上。
test('issues: 指纹渲染失败原因 —— 光看 status 只知道错了、不知道错在哪', () => {
  const fp = fingerprint({ status: 'error', ms: 12000, tokens: { in: 0, out: 0 }, provider: 'claude', err: 'error_max_turns: 轮次到顶' })
  assert.match(fp, /error_max_turns/)
  assert.match(fp, /轮次到顶/)
  assert.match(fp, /error · 12s/) // 对照组:原有几项没被挤掉
  // ok 轮没有 err ⇒ 指纹里也不该冒出来(否则「有原因」就不再是失败的信号)
  assert.doesNotMatch(fingerprint({ status: 'ok', ms: 1000, provider: 'claude' }), /error_max_turns/)
  // 指纹是给人扫一眼的 ⇒ 再收一次长度;全文留在 issue show 里
  const long = fingerprint({ status: 'error', ms: 1000, err: 'x'.repeat(400) })
  assert.ok(long.length < 200, `指纹被一条超长原因撑爆了(${long.length})`)
})

test('issues: 摘要把换行压平并截断(反馈常是多行,直接进列表会冲掉一屏)', () => {
  const s = summarize({ text: '第一行\n第二行   带   空格' }, { width: 100 })
  assert.equal(s, '第一行 第二行 带 空格')
  assert.equal(summarize({ text: 'x'.repeat(80) }, { width: 10 }), 'x'.repeat(10) + '…')
})

test('issues: 落盘端到端 —— 提、列、关、再列', () => {
  const file = tmpFile()
  const book = createIssues(file, { host: 'h1' })
  const a = book.add({ chatId: 'oc_a', group: 'A群', sender: '韩梅梅', text: '图片一直没出来', version: '0.11.24', turn: { status: 'ok', ms: 5161, tokens: { in: 0, out: 0 }, provider: 'claude' } })
  const b = book.add({ chatId: 'oc_b', group: 'B群', sender: '李雷', text: '列表里有重复项', version: '0.11.24' })
  assert.deepEqual([a.id, b.id], [1, 2], '同一本账里连续发号')
  assert.equal(book.list().length, 2)

  const closed = book.setStatus(1, 'close', '已修')
  assert.equal(closed.chatId, 'oc_a', 'close 要把原群带回来 —— 调用方拿它去那个群回一句')
  assert.equal(book.list().length, 1, '默认只列未处理的')
  assert.equal(book.list({ all: true }).length, 2)
  assert.equal(book.get(1).status, 'closed')
  assert.equal(book.get(1).text, '图片一直没出来')

  // 重复 close 不再产生事件(避免同一条被反复通知到群里)
  assert.equal(book.setStatus(1, 'close', '又修了一次'), null)
  assert.equal(book.get(1).note, '已修')
})

test('issues: 历史行只追加不改写 —— 关闭后原始 open 行仍逐字在文件里', () => {
  const file = tmpFile()
  const book = createIssues(file, { host: 'h1' })
  book.add({ chatId: 'oc_a', group: 'A群', sender: '韩梅梅', text: '原话' })
  book.setStatus(1, 'close', '处理了')
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2, '两个事件两行')
  assert.equal(JSON.parse(lines[0]).op, 'open')
  assert.equal(JSON.parse(lines[0]).text, '原话', '审计价值全在这一行没被动过')
  assert.equal(JSON.parse(lines[1]).op, 'close')
})

test('issues: 发号在同一把锁里完成 —— 拿到锁才算号,不会两条同号', () => {
  // withFileLock 注入成「记录调用顺序」的假锁:算号必须发生在锁内,否则并发提交会撞号。
  const file = tmpFile()
  const seq = []
  const book = createIssues(file, {
    host: 'h1',
    withFileLock: (f, fn) => { seq.push('lock'); const r = fn(); seq.push('unlock'); return r },
  })
  book.add({ text: 'a' })
  book.add({ text: 'b' })
  assert.deepEqual(seq, ['lock', 'unlock', 'lock', 'unlock'])
  assert.deepEqual(book.list().map((i) => i.id), [1, 2])
})

test('issues: 文件不存在时 list 返回空而不是抛', () => {
  const book = createIssues(path.join(os.tmpdir(), 'sbot-no-such-dir-' + Date.now(), 'issues.jsonl'))
  assert.deepEqual(book.list(), [])
  assert.equal(book.get(1), null)
})

test('issues: 实例名可自定 —— 汇总多台时这个名字就是分组依据', () => {
  // 主机名实测是 xxxdeMac-mini / yyydeMac-mini 这种,又长又认不出是哪台;
  // operator 心里它们叫「A 机」「B 机」,所以顶层 instance 一配,反馈就按人的叫法归堆。
  const book = createIssues(tmpFile(), { host: 'mac-b' })
  const rec = book.add({ text: 'x' })
  assert.equal(rec.host, 'mac-b')
  assert.equal(book.host, 'mac-b')
  // 不配就退主机名(非空即可 —— 具体值随机器,不钉死)
  assert.ok(createIssues(tmpFile()).host.length > 0)
})

test('issues: 超长正文封顶并留截断标记(有人会顺手粘一整屏日志)', () => {
  const book = createIssues(tmpFile(), { host: 'h1' })
  const rec = book.add({ text: 'x'.repeat(MAX_TEXT + 500) })
  assert.equal(rec.text.length, MAX_TEXT + '…(过长已截断)'.length)
  assert.match(rec.text, /…\(过长已截断\)$/, '留标记 —— 让人知道后面还有,别把它当全文')
  // 正常长度的一个字都不能动:原话是证据
  const normal = '刚才那几张图它没理我\n复现:上一轮还在跑的时候连发'
  assert.equal(book.add({ text: normal }).text, normal)
})

test('issues: 备注不是字符串一律当没写 —— 不许以对象形态写进事件行', () => {
  // API 传来的 note 可能是任意 JSON;不拦就会炸前端渲染(整本账连坐),拦成
  // '[object Object]' 也一样是脏数据 ⇒ 非字符串 = 没写。
  const book = createIssues(tmpFile(), { host: 'h1' })
  book.add({ chatId: 'oc_a', text: 'x' })
  const it = book.setStatus(1, 'close', { evil: 1 })
  assert.equal(it.note, '')
  assert.equal(book.get(1).note, '')
  assert.equal(typeof JSON.parse(require('fs').readFileSync(book.file, 'utf8').trim().split('\n')[1]).note, 'string')
})
