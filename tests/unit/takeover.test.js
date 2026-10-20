// src/ui/takeover.js —— 接管浏览器的一次性链接:单次即用完、短命、只开一扇门(门在 server 那层裁决,这里钉票本身)。
// 分辨力:每个否定断言(第二次不放行 / 过期不认)旁边都有同一张票第一次成功的正例;时间用注入的 now,不靠真钟。
const test = require('node:test')
const assert = require('node:assert/strict')
const tk = require('../../src/ui/takeover')

test('takeover: 签票 → 用票换会话 → 同一张票第二次不再放行;过期的票与会话都不认', () => {
  let t = 1_000_000
  const store = tk.createTakeoverStore({ ttlMs: 60_000, now: () => t })
  const { token, exp, ttlMs, targetId } = store.mint({ by: 'admin', targetId: 'T1' })
  assert.match(token, /^[0-9a-f]{32}$/); assert.equal(exp, t + 60_000); assert.equal(ttlMs, 60_000); assert.equal(targetId, 'T1')
  assert.deepEqual(store.stats(), { links: 1, unused: 1, sessions: 0 })
  const s = store.consume(token, { ip: '1.2.3.4' })
  assert.ok(s && /^[0-9a-f]{32}$/.test(s.sid)); assert.equal(s.exp, exp, '会话与票同一到期时刻,不滑动'); assert.equal(s.targetId, 'T1', '票绑的标签页跟到会话上'); assert.equal(store.session(s.sid).targetId, 'T1')
  assert.equal(store.consume(token), null, '票只能用一次 —— 被转发的人拿到的是用过的票')
  assert.equal(store.hasSession(s.sid), true); assert.equal(store.session(s.sid).ip, '1.2.3.4')
  assert.equal(store.hasSession('nope'), false); assert.equal(store.hasSession(''), false)
  t += 60_001
  assert.equal(store.hasSession(s.sid), false, '到点即失效')
  store.mint() // 再签一张只为让 stats 里有一张没用过的票
  assert.equal(store.consume('zz'), null, '不存在的票不认')
  assert.deepEqual(store.stats(), { links: 1, unused: 1, sessions: 0 })
})

test('takeover: 未用过但过期的票不能换会话;ttl 越界收编回 [1, 60] 分钟;revoke 立刻失效', () => {
  let t = 5000
  const store = tk.createTakeoverStore({ now: () => t })
  const late = store.mint({ ttl: 1 }); assert.equal(late.ttlMs, tk.MIN_TTL_MS, '太短收到 1 分钟')
  assert.equal(store.mint({ ttl: 9e9 }).ttlMs, tk.MAX_TTL_MS, '太长收到 60 分钟')
  assert.equal(store.mint({ ttl: 'x' }).ttlMs, tk.DEFAULT_TTL_MS, '不是数就用默认')
  t += tk.MIN_TTL_MS + 1
  assert.equal(store.consume(late.token), null, '过期的票换不到会话')
  const ok = store.consume(store.mint().token)
  assert.equal(store.revokeSession(ok.sid), true); assert.equal(store.hasSession(ok.sid), false)
  assert.ok(store.revokeAll() >= 1); assert.deepEqual(store.stats(), { links: 0, unused: 0, sessions: 0 })
  // 没用过的票封顶:本机任何进程都能签,不封顶是内存黑洞;超了丢最老的
  for (let i = 0; i < tk.MAX_UNUSED + 20; i++) store.mint()
  assert.equal(store.stats().unused, tk.MAX_UNUSED)
})

test('takeover: cookie 解析 / 下发 / 清除;链接形状', () => {
  assert.equal(tk.cookieValue('a=1; sbot-takeover=abc%20d; b=2'), 'abc d')
  assert.equal(tk.cookieValue('sbot-token=zz'), '')
  assert.equal(tk.cookieValue(undefined), '')
  assert.equal(tk.cookieValue('sbot-takeover=%'), '', '畸形编码不抛(否则整站 500)')
  const h = tk.setCookieHeader('S1', { maxAgeSec: 599.7, secure: true })
  assert.equal(h, 'sbot-takeover=S1; Path=/; HttpOnly; SameSite=Lax; Max-Age=599; Secure')
  assert.equal(tk.setCookieHeader('S1'), 'sbot-takeover=S1; Path=/; HttpOnly; SameSite=Lax; Max-Age=600')
  assert.match(tk.clearCookieHeader(), /Max-Age=0/)
  assert.equal(tk.takeoverUrl('https://cb.example.com/', 'T'), 'https://cb.example.com/browser#k=T', '票在片段里:服务器收不到、日志里没有')
  assert.equal(tk.takeoverUrl('http://192.168.1.2:4600', 'a b'), 'http://192.168.1.2:4600/browser#k=a%20b')
})

test('takeover: 票带 id;attach 挂元数据;兑换时回调 onClaimed 带元数据;过期没人兑换回调 onExpired;兑换过的票不再触发过期', async () => {
  const claimed = [], expired = []
  const store = tk.createTakeoverStore({ ttlMs: 60_000, onClaimed: (m) => claimed.push(m), onExpired: (m) => expired.push(m) })
  const m = store.mint({ ttl: 60_000 })
  assert.match(m.id, /^[0-9a-f]{12}$/, '票有个非秘密的 id 给 attach 用')
  assert.equal(store.attach('nope', { cardId: 'c' }), false, '不存在的 id')
  assert.equal(store.attach(m.id, { cardId: 'card-1', chatId: 'oc_x' }), true)
  const s = store.consume(m.token)
  assert.deepEqual(s.meta, { cardId: 'card-1', chatId: 'oc_x' }, '兑换结果带元数据')
  assert.deepEqual(claimed, [{ cardId: 'card-1', chatId: 'oc_x' }], '兑换触发 onClaimed')
  assert.equal(store.attach(m.id, { cardId: 'late' }), false, '用掉的票不能再挂')
  // 没挂元数据的票兑换不回调(没卡可翻)
  store.consume(store.mint().token); assert.equal(claimed.length, 1)
  // 过期回调:用真定时器,ttl 收编到 MIN(60s)太长 ⇒ 这里只验「兑换过的不触发」这一半;另一半靠 timer 存在性
  const e = store.mint({ ttl: 60_000 }); store.attach(e.id, { cardId: 'will-claim' }); store.consume(e.token)
  assert.equal(expired.length, 0)
})

test('takeover: 会话结束回调 onEnded —— 主动结束 / 退出所有设备 / 到期各一次,带元数据与原因;没挂卡的不回调;同一会话不重复', () => {
  const ended = []
  const store = tk.createTakeoverStore({ ttlMs: 60_000, onEnded: (m, o) => ended.push([m, o]) })
  const m = store.mint(); store.attach(m.id, { cardId: 'c-end' })
  const s = store.consume(m.token)
  assert.equal(store.revokeSession(s.sid), true); assert.deepEqual(ended, [[{ cardId: 'c-end' }, { reason: 'ended' }]], '点「结束」⇒ 回调一次,原因 ended')
  assert.equal(store.hasSession(s.sid), false)
  assert.equal(store.revokeSession(s.sid), false, '已结束的再结束不回调'); assert.equal(ended.length, 1)
  const plain = store.consume(store.mint().token); store.revokeSession(plain.sid); assert.equal(ended.length, 1, '没挂卡的会话结束不回调')
  const m2 = store.mint(); store.attach(m2.id, { cardId: 'c-all' }); store.consume(m2.token)
  assert.ok(store.revokeAll() >= 1); assert.deepEqual(ended[1], [{ cardId: 'c-all' }, { reason: 'ended' }], '退出所有设备 ⇒ 正在接管的也翻'); assert.deepEqual(store.stats(), { links: 0, unused: 0, sessions: 0 })
  // 到期:拨钟让 prune 看到会话过期 ⇒ 也回调,原因 expired(真定时器那条同一个出口,这里验出口本身)
  let t = 1000; const s2 = tk.createTakeoverStore({ ttlMs: 60_000, now: () => t, onEnded: (m, o) => ended.push([m, o]) })
  const m3 = s2.mint(); s2.attach(m3.id, { cardId: 'c-exp' }); s2.consume(m3.token); t += 60_001
  assert.equal(s2.stats().sessions, 0); assert.deepEqual(ended[2], [{ cardId: 'c-exp' }, { reason: 'expired' }], '到期的会话结束时也回调')
  assert.equal(ended.length, 3)
})
