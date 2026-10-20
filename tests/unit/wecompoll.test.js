// 「不 @ 也回复」轮询(src/platform/wecompoll.js):第一轮只建基线 · 新消息按规则门控喂(点名 / 跟进窗口)· 与长连接已投递的 @ 消息去重 ·
// 同一秒重叠靠键去重 · 水位按字面量推进 · 工具失败只记日志、没装就停 · 时间按北京字面量解析。全注入零网络。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHistoryPoll, parseBeijing, messageText } = require('../../src/platform/wecompoll')

function clock() {
  let t = parseBeijing('2026-10-10 16:00:00'); const timers = []
  return { now: () => t, setTimer: (fn, ms) => { const h = { fn, at: t + ms }; timers.push(h); return h }, clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1) },
    async run(n = 1) { for (let i = 0; i < n; i++) { timers.sort((a, b) => a.at - b.at); const h = timers.shift(); if (!h) return; t = Math.max(t, h.at); await h.fn(); await new Promise((r) => setImmediate(r)) } }, advance: (ms) => { t += ms } }
}
const msg = (time, content, userid = 'woA2u', user_name = '王五') => ({ userid, user_name, send_time: time, msg_type: 'text', text: { content } })

test('wecompoll: 时间按北京字面量解析;非文本给标记', () => {
  assert.equal(parseBeijing('2026-10-10 15:48:02'), Date.UTC(2026, 9, 10, 7, 48, 2)); assert.ok(Number.isNaN(parseBeijing('nope')))
  assert.equal(messageText({ msg_type: 'mixed', mixed: { msg_item: [{ msg_type: 'text', text: { content: '看这张' } }, { msg_type: 'image' }] } }), '看这张 [图片]')
  assert.equal(messageText({ msg_type: 'file', file: { file_name: 'a.pdf' } }), '[文件 a.pdf]'); assert.equal(messageText({ msg_type: 'video' }), '[视频]')
})

test('wecompoll: 第一轮只建基线不投递;之后新消息按门控喂 —— 点名随时答,窗口内不 @ 也答,窗口外不喂;水位推进', async () => {
  const c = clock(); const fed = []; const logs = []
  let history = [msg('2026-10-10 15:48:02', '@SintBot start test'), msg('2026-10-10 15:50:18', '旧消息')]
  const p = createHistoryPoll({ chats: () => ['wrG1', 'WangWu'], list: async (id) => { assert.equal(id, 'wrG1', '只轮询群'); return history }, deliver: (m) => fed.push(m), stripMention: (t) => t.replace(/^@SintBot\s*/, ''), ...c, intervalMs: 20_000, followMs: 300_000, botName: 'SintBot', log: (l) => logs.push(l) })
  assert.equal(p.start(), true)
  await c.run(1) // 第一轮:基线
  assert.equal(fed.length, 0, '旧消息不灌')
  history = [...history, msg('2026-10-10 16:00:30', '随便聊聊天气'), msg('2026-10-10 16:00:40', '机器人在吗')]
  await c.run(1)
  assert.deepEqual(fed.map((m) => m.text), ['机器人在吗'], '闲聊不喂;点名的喂')
  assert.equal(fed[0].chatId, 'wrG1'); assert.equal(fed[0].senderName, '王五'); assert.equal(fed[0].userId, 'woA2u'); assert.equal(fed[0].polled, true)
  assert.deepEqual(fed[0].replyCtx, { chatId: 'wrG1', chatType: 'group', quote: { sender: '王五', text: '机器人在吗', more: 0, senders: 1 } }, '没有 req_id ⇒ 回复走主动推送;quote 给推送开头引用原话')
  assert.equal(fed[0].batchOf, 1)
  assert.equal(fed[0].createTimeMs, parseBeijing('2026-10-10 16:00:40'))
  // 机器人开口 ⇒ 跟进窗口 5 分钟:之后不 @ 的消息也喂;窗口过了又不喂
  p.noteActivity('wrG1')
  history = [...history, msg('2026-10-10 16:01:00', '那帮我看下目录')]
  await c.run(1); assert.equal(fed.length, 2); assert.equal(fed[1].text, '那帮我看下目录')
  c.advance(6 * 60_000)
  history = [...history, msg('2026-10-10 16:08:00', '又闲聊')]
  await c.run(1); assert.equal(fed.length, 2, '窗口外不喂')
  assert.equal(p._state.get('wrG1').last, '2026-10-10 16:08:00', '不喂也推进水位,不会回头再看')
  // 同一秒再来一条不同内容:喂判定照常,键去重不误杀
  p.noteActivity('wrG1')
  history = [...history, msg('2026-10-10 16:08:00', '同一秒第二条')]
  await c.run(1); assert.equal(fed[fed.length - 1].text, '同一秒第二条')
  await c.run(1); assert.equal(fed.length, 3, '再轮一次不重复投递')
  p.stop()
})

test('wecompoll: 与长连接已投递的 @ 消息去重;followMs=0 全喂;intervalMs=0 不起', async () => {
  const c = clock(); const fed = []
  let history = []
  const p = createHistoryPoll({ chats: () => ['wrG'], list: async () => history, deliver: (m) => fed.push(m), stripMention: (t) => t.replace(/^@SintBot\s*/, ''), wasDelivered: (id, text, tMs) => text === '现在几点' && Math.abs(tMs - parseBeijing('2026-10-10 16:00:10')) < 60_000, ...c, intervalMs: 20_000, followMs: 0, botName: 'SintBot' })
  p.start(); await c.run(1)
  history = [msg('2026-10-10 16:00:10', '@SintBot 现在几点'), msg('2026-10-10 16:00:12', '随便一句')]
  await c.run(1)
  assert.deepEqual(fed.map((m) => m.text), ['随便一句'], '@ 消息长连接已答过 ⇒ 不再喂;followMs=0 ⇒ 闲聊也喂')
  assert.equal(createHistoryPoll({ intervalMs: 0, list: async () => [] }).start(), false)
})

test('wecompoll: 工具失败只记日志(前 3 次 + 每 30 次);ENOENT ⇒ 停轮询', async () => {
  const c = clock(); const logs = []
  let fail = new Error('boom')
  const p = createHistoryPoll({ chats: () => ['wrG'], list: async () => { throw fail }, deliver: () => {}, ...c, intervalMs: 1000, log: (l) => logs.push(l) })
  p.start(); await c.run(5)
  assert.equal(logs.filter((l) => /轮询失败/.test(l)).length, 3, '第 4、5 次不刷屏')
  fail = Object.assign(new Error('nf'), { code: 'ENOENT' })
  await c.run(1)
  assert.ok(logs.some((l) => /已停/.test(l)))
  const before = logs.length; await c.run(3); assert.equal(logs.length, before, '停了就不再跑')
})

test('wecompoll: 历史里的图片 / 文件 —— 门控放行才取媒体,取到给本机路径标记、取不到给失败标记;没注入取媒体就只给占位;只发一张图的 @ 消息按纯文字去重(两边都是空串)', async () => {
  const { messageParts, plainText } = require('../../src/platform/wecompoll')
  // 拆片段:混排 = 文字 + 图;纯图 / 文件 / 视频各一个媒体片段;messageText 的占位输出不变(去重键靠它)
  const mixed = { msg_type: 'mixed', mixed: { msg_item: [{ msg_type: 'text', text: { content: '看这张' } }, { msg_type: 'image', image: { media_id: 'M1' } }] } }
  assert.deepEqual(messageParts(mixed), [{ type: 'text', text: '看这张' }, { type: 'media', kind: 'image', mediaId: 'M1', name: null }])
  assert.equal(plainText(mixed), '看这张'); assert.equal(messageText(mixed), '看这张 [图片]')
  // 历史接口真机形状:mixed.items(不是长连接的 msg_item)—— 10-12 一条「图 + 这是什么界面」就因此被拆成空
  const real = { msg_type: 'mixed', mixed: { items: [{ msg_type: 'image', image: { media_id: 'A62o' } }, { msg_type: 'text', text: { content: '这是什么界面' } }] } }
  assert.deepEqual(messageParts(real), [{ type: 'media', kind: 'image', mediaId: 'A62o', name: null }, { type: 'text', text: '这是什么界面' }]); assert.equal(plainText(real), '这是什么界面')
  assert.deepEqual(messageParts({ msg_type: 'file', file: { media_id: 'M2', file_name: 'a.pdf' } }), [{ type: 'media', kind: 'file', mediaId: 'M2', name: 'a.pdf' }])
  assert.equal(messageText({ msg_type: 'video', video: { media_id: 'M3' } }), '[视频]')

  const c = clock(); const fed = []; const fetched = []; const logs = []
  let history = []
  const fetchMedia = async (md, base) => { fetched.push([md.kind, md.mediaId, base]); if (md.mediaId === 'BAD') throw new Error('接口 500'); return `/inbox/${base}.png` }
  const p = createHistoryPoll({
    chats: () => ['wrG'], list: async () => history, deliver: (m) => fed.push(m), fetchMedia, stripMention: (t) => t.replace(/^@SintBot\s*/, ''),
    // 长连接那边记的是剥 @ 后的纯文字:只发一张图 @ 机器人 ⇒ 记成空串
    wasDelivered: (id, text, tMs) => text === '' && Math.abs(tMs - parseBeijing('2026-10-10 16:00:05')) < 1000,
    ...c, intervalMs: 1000, followMs: 5 * 60_000, botName: 'SintBot', log: (l) => logs.push(l),
  })
  p.start(); await c.run(1)
  const img = (time, mid, extra = {}) => ({ userid: 'u', user_name: '甲', send_time: time, msg_type: 'image', image: { media_id: mid }, ...extra })
  history = [
    img('2026-10-10 16:00:05', 'DUP'),                                    // @ 机器人只发了一张图:长连接已答 ⇒ 不喂、也不取媒体
    img('2026-10-10 16:00:10', 'SKIP'),                                   // 窗口外、没点名 ⇒ 不喂、不取媒体
    { ...mixed, userid: 'u', user_name: '甲', send_time: '2026-10-10 16:00:20', mixed: { msg_item: [{ msg_type: 'text', text: { content: 'SintBot 看这张' } }, { msg_type: 'image', image: { media_id: 'OK1' } }] } },
  ]
  await c.run(1)
  assert.equal(fed.length, 1, '只有点名那条喂')
  assert.equal(fed[0].text, 'SintBot 看这张\n[图片 path=/inbox/poll-20261010160020-' + fed[0].msgId.split(':').pop() + '-1.png]', '纯文字一行 + 本机路径标记一行,与长连接入站同形')
  assert.deepEqual(fetched.map((f) => f[1]), ['OK1'], '没放行的两条一次媒体都没取')
  // 窗口内:纯图消息也喂;取失败给失败标记 + 日志;文件带原名
  p.noteActivity('wrG')
  history = [...history, img('2026-10-10 16:00:30', 'BAD'), { userid: 'u', user_name: '甲', send_time: '2026-10-10 16:00:31', msg_type: 'file', file: { media_id: 'F1', file_name: 'b.pdf' } }]
  await c.run(1)
  assert.equal(fed.length, 2, '同一轮拉到的两条攒成一批投递')
  assert.equal(fed[1].batchOf, 2)
  const lines = fed[1].text.split('\n')
  assert.equal(lines[0], '[16:00 甲] [图片 下载失败]', '失败标记不带原话(原话有路径 / 工具名,agent 会复述);多条时每行带时分 + 发送者'); assert.ok(logs.some((l) => /群历史媒体下载失败\(image\): 接口 500/.test(l)), '原话进日志')
  assert.match(lines[1], /^\[16:00 甲\] \[文件 path=\/inbox\/poll-20261010160031-[a-z0-9]+-1\.png\]$/)
  assert.match(fed[1].msgId, /^poll:wrG:20261010160031:/, '代表取末条')
  assert.equal(fed[1].replyCtx.quote.text, '[文件 b.pdf]', '引用行用不带本机路径的标记(用户面零路径)'); assert.ok(!/path=/.test(fed[1].replyCtx.quote.text))
  assert.equal(fed[1].replyCtx.quote.more, 1, '攒批:末条之前还有 1 条'); assert.equal(fed[1].replyCtx.quote.senders, 1)
  assert.equal(fetched.find((f) => f[1] === 'F1')[0], 'file')
  p.stop()
  // 去重键空白归一:历史里「看这张 [图] 和这张 [图]」拼出 '看这张 和这张',长连接侧记的是换行拼再归一的同一串 ⇒ 对得上
  const { plainText: pt } = require('../../src/platform/wecompoll')
  assert.equal(pt({ msg_type: 'mixed', mixed: { msg_item: [{ msg_type: 'text', text: { content: '看这张' } }, { msg_type: 'image', image: { media_id: 'a' } }, { msg_type: 'text', text: { content: '  和这张 ' } }] } }).replace(/\s+/g, ' ').trim(), '看这张 和这张')
  // 不注入 fetchMedia:媒体只给占位标记(没装命令行工具的机器)
  const fed2 = []; const c2 = clock(); let h2 = []
  const p2 = createHistoryPoll({ chats: () => ['wrG'], list: async () => h2, deliver: (m) => fed2.push(m), ...c2, intervalMs: 1000, followMs: 0 })
  p2.start(); await c2.run(1)
  h2 = [{ userid: 'u', send_time: '2026-10-10 16:00:40', msg_type: 'file', file: { media_id: 'F2', file_name: 'c.xlsx' } }]
  await c2.run(1)
  assert.equal(fed2[0].text, '[文件 c.xlsx]')
  p2.stop()
})

test('wecompoll: 第二道门 —— 规则不放行才问门控(带最近几句上下文、不含候选句本身);YES 喂 / NO 不喂;纯媒体不问;门控抛异常当 NO;没配门控行为不变', async () => {
  const c = clock(); const fed = []; const asked = []; const logs = []
  let verdict = true, boom = false
  let history = []
  const gate = async (chatId, q) => { asked.push({ chatId, ...q }); if (boom) throw new Error('炸'); return verdict }
  const p = createHistoryPoll({ chats: () => ['wrG'], list: async () => history, deliver: (m) => fed.push(m), gate, ...c, intervalMs: 1000, followMs: 5 * 60_000, botName: 'SintBot', log: (l) => logs.push(l) })
  p.start(); await c.run(1)
  history = [msg('2026-10-10 16:00:01', '早上好啊', 'u1', '乙'), msg('2026-10-10 16:00:02', '那个报表再发一份', 'u2', '甲')]
  await c.run(1)
  assert.equal(asked.length, 2, '两句都没点名、不在窗口 ⇒ 都问')
  assert.deepEqual(asked[0].recent, [], '第一句之前没有上下文')
  assert.deepEqual(asked[1].recent, [{ sender: '乙', text: '早上好啊' }], '第二句的上下文 = 之前那句,不含自己')
  assert.equal(asked[1].text, '那个报表再发一份'); assert.equal(asked[1].sender, '甲'); assert.equal(asked[1].chatId, 'wrG')
  assert.equal(fed.length, 1, 'YES ⇒ 喂;同一轮两条攒成一批'); assert.equal(fed[0].batchOf, 2); assert.deepEqual(fed[0].text.split('\n'), ['[16:00 乙] 早上好啊', '[16:00 甲] 那个报表再发一份'])
  assert.deepEqual(fed[0].replyCtx.quote, { sender: '甲', text: '那个报表再发一份', more: 1, senders: 2 }, '两个人的两句:引用末条 + 还有 1 条 + 2 人')
  // 点名的不问门控(规则已放行);窗口内也不问
  history = [...history, msg('2026-10-10 16:00:10', 'SintBot 看看', 'u2', '甲')]
  await c.run(1); assert.equal(asked.length, 2); assert.equal(fed.length, 2)
  p.noteActivity('wrG'); history = [...history, msg('2026-10-10 16:00:20', '接着做', 'u2', '甲')]
  await c.run(1); assert.equal(asked.length, 2, '窗口内规则放行,不问'); assert.equal(fed.length, 3)
  c.advance(6 * 60_000)
  verdict = false; history = [...history, msg('2026-10-10 16:07:00', '中午吃啥', 'u1', '乙')]
  await c.run(1); assert.equal(asked.length, 3); assert.equal(fed.length, 3, 'NO ⇒ 不喂')
  assert.equal(asked[2].recent.length, 4, '上下文累积'); assert.equal(asked[2].recent[3].text, '接着做')
  // 上下文最多 8 句:再灌 10 句闲聊(都问门控、都 NO),最后一次问时上下文正好 8 条且是最新的 8 条
  history = [...history, ...Array.from({ length: 10 }, (_, i) => msg(`2026-10-10 16:07:${String(10 + i).padStart(2, '0')}`, `闲聊 ${i}`, 'u1', '乙'))]
  await c.run(1)
  const last = asked[asked.length - 1]; assert.equal(last.text, '闲聊 9'); assert.equal(last.recent.length, 8, '最多 8 句'); assert.deepEqual(last.recent.map((r) => r.text), ['中午吃啥', '[图片]', '闲聊 0', '闲聊 1', '闲聊 2', '闲聊 3', '闲聊 4', '闲聊 5', '闲聊 6', '闲聊 7', '闲聊 8'].slice(-8))
  history = history.filter((m) => !/^闲聊/.test(m.text && m.text.content)); c.advance(1000)
  // 带字的图:候选句带「[附图片]」提示(去重键 / 正文仍是纯文字);门控 YES 后媒体照常取
  verdict = true; history = [...history, { userid: 'u1', user_name: '乙', send_time: '2026-10-10 16:07:25', msg_type: 'mixed', mixed: { items: [{ msg_type: 'image', image: { media_id: 'MX' } }, { msg_type: 'text', text: { content: '这是什么界面' } }] } }]
  await c.run(1); assert.equal(asked[asked.length - 1].text, '这是什么界面 [附图片]', '门控看不到图,得告诉它有附件'); assert.equal(fed[fed.length - 1].text, '这是什么界面\n[图片 MX]'.replace('[图片 MX]', '[图片]'), '没注入 fetchMedia 的夹具 ⇒ 占位')
  verdict = false
  // 纯图片(没有文字)不问门控
  const nAsked = asked.length
  history = [...history, { userid: 'u1', user_name: '乙', send_time: '2026-10-10 16:07:05', msg_type: 'image', image: { media_id: 'M' } }]
  await c.run(1); assert.equal(asked.length, nAsked)
  // 门控抛异常 ⇒ 当 NO,日志一行
  boom = true; history = [...history, msg('2026-10-10 16:07:30', '帮我看看日志', 'u2', '甲')]
  await c.run(1); assert.equal(fed.length, 4, '抛异常当 NO,不多喂'); assert.ok(logs.some((l) => /门控异常/.test(l)))
  p.stop()
  // 没配门控:与此前一致 —— 规则不放行就不喂、也没人被问
  const fed2 = []; const c2 = clock(); let h2 = []
  const p2 = createHistoryPoll({ chats: () => ['wrG'], list: async () => h2, deliver: (m) => fed2.push(m), ...c2, intervalMs: 1000, followMs: 5 * 60_000 })
  p2.start(); await c2.run(1); h2 = [msg('2026-10-10 16:00:02', '那个报表再发一份')]; await c2.run(1); assert.equal(fed2.length, 0); p2.stop()
})

test('wecompoll: botName / keywords 给函数时每次现读 —— 改名、改点名词不用重建轮询', async () => {
  const c = clock(); const fed = []; let history = []; let name = 'SintBot', kws = ['机器人']
  const p = createHistoryPoll({ chats: () => ['wrG'], list: async () => history, deliver: (m) => fed.push(m), botName: () => name, keywords: () => kws, ...c, intervalMs: 1000, followMs: 5 * 60_000 })
  p.start(); await c.run(1)
  history = [msg('2026-10-10 16:00:02', '小助理 在吗')]; await c.run(1); assert.equal(fed.length, 0, '「小助理」还不在名单')
  kws = ['小助理']; history = [...history, msg('2026-10-10 16:00:03', '小助理 来一下')]; await c.run(1); assert.equal(fed.length, 1, '点名词热生效')
  name = '阿强'; history = [...history, msg('2026-10-10 16:00:04', '阿强 来一下')]; await c.run(1); assert.equal(fed.length, 2, '机器人名热生效')
  p.stop()
})

// ── 两车道(v0.11.115):慢车道分档 · 攒批 · 补拉 · 授权类错误暂停 ───────────────────────────
test('wecompoll: 分档间隔 —— 温档 = intervalMs;被 @ / 开口 / 喂过 ⇒ 热档且下次拉取提前;idleMs 没人说话 ⇒ 冷档;各群各自计', async () => {
  const c = clock(); const fed = []
  let history = { wrA: [msg('2026-10-10 15:59:50', '刚聊过')], wrB: [msg('2026-10-10 15:00:00', '一小时前')] }
  const p = createHistoryPoll({ chats: () => ['wrA', 'wrB'], list: async (id) => history[id], deliver: (m) => fed.push(m), ...c, intervalMs: 20_000, hotMs: 8_000, idleMs: 10 * 60_000, followMs: 300_000, botName: 'SintBot' })
  p.start(); await c.run(1) // 基线
  const t0 = c.now()
  assert.equal(p.tierName('wrA'), 'warm'); assert.equal(p.tierName('wrB'), 'cold', '一小时没人说话 ⇒ 冷')
  assert.equal(p._nextAt.get('wrA') - t0, 20_000); assert.equal(p._nextAt.get('wrB') - t0, 120_000, '冷档 = max(6×interval, 120s)')
  p.noteActivity('wrA')
  assert.equal(p.tierName('wrA'), 'hot'); assert.equal(p._nextAt.get('wrA') - c.now(), 8_000, '热档:下次拉取提前到 8s 内')
  history.wrA = [...history.wrA, msg('2026-10-10 16:00:05', '那帮我看下')]
  await c.run(1) // 8s 后的那次只拉 wrA(wrB 还没到期)
  assert.equal(c.now() - t0, 8_000); assert.deepEqual(fed.map((m) => m.text), ['那帮我看下'])
  assert.equal(p._nextAt.get('wrA') - c.now(), 8_000, '喂过 ⇒ 继续热档'); assert.equal(p._nextAt.get('wrB') - t0, 120_000, 'wrB 的计划没被动')
  c.advance(6 * 60_000) // 跟进窗口过了,近 10 分钟仍有人说话 ⇒ 温
  assert.equal(p.tierName('wrA'), 'warm')
  c.advance(10 * 60_000); assert.equal(p.tierName('wrA'), 'cold')
})

test('wecompoll: kick 立刻补拉指定群;只提前不推后;停了不动', async () => {
  const c = clock(); const fed = []; let n = 0
  let history = []
  const p = createHistoryPoll({ chats: () => ['wrA'], list: async () => { n++; return history }, deliver: (m) => fed.push(m), ...c, intervalMs: 20_000, followMs: 300_000 })
  p.start(); await c.run(1); assert.equal(n, 1)
  p.kick('wrA', 3_000); assert.equal(p._nextAt.get('wrA') - c.now(), 3_000)
  p.kick('wrA', 9_000); assert.equal(p._nextAt.get('wrA') - c.now(), 3_000, '只提前不推后')
  await c.run(1); assert.equal(n, 2); assert.equal(c.now() - parseBeijing('2026-10-10 16:00:00'), 3_000)
  p.stop(); p.kick('wrA'); await c.run(2); assert.equal(n, 2, '停了就不再拉')
})

test('wecompoll: 850003 / 853006 ⇒ 整体暂停 pauseMs 再试(不刷、不停死);其它错误照旧只记日志', async () => {
  const c = clock(); const logs = []; let n = 0
  let fail = Object.assign(new Error('not available'), { code: '853006' })
  const p = createHistoryPoll({ chats: () => ['wrA', 'wrB'], list: async () => { n++; throw fail }, deliver: () => {}, ...c, intervalMs: 1000, pauseMs: 30 * 60_000, log: (l) => logs.push(l) })
  p.start(); await c.run(1)
  const tFail = c.now()
  assert.equal(n, 1, '第一个群撞 853006 后本轮剩下的群不再各起一次子进程撞同一个错')
  assert.ok(logs.some((l) => /暂停 30 分钟.*企业规模门控/.test(l)))
  assert.equal(p._nextAt.get('wrA'), tFail + 30 * 60_000); assert.equal(p._nextAt.get('wrB'), tFail + 30 * 60_000, '所有群都排到暂停结束')
  p.kick('wrA'); await c.run(1) // 暂停期间 kick 也不拉(定时器触发的 tick 看 pausedUntil)
  assert.equal(n, 1, '暂停期间不拉'); assert.equal(c.now(), tFail, '定时器立刻触发过一次但没拉')
  await c.run(1) // 30 分钟后再试
  assert.equal(n, 2); assert.equal(c.now() - tFail, 30 * 60_000, '暂停到点自动再试')
  p.stop()
  // 对照:普通错误不暂停,下一 tick 照拉
  const c2 = clock(); let m = 0
  const p2 = createHistoryPoll({ chats: () => ['wrA'], list: async () => { m++; throw new Error('boom') }, deliver: () => {}, ...c2, intervalMs: 1000, log: () => {} })
  p2.start(); await c2.run(3); assert.equal(m, 3); p2.stop()
})

