// 多平台路由器(src/platform/multi.js):飞书 + 企微同时接,按 chatId 分发;入站消息带着自己的适配器进引擎;
// 判不出归属且有多个适配器 ⇒ 不发(宁可不发也别发错群);只有一个适配器 ⇒ 全归它;connHealth 按平台名出字典。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createMultiPlatform } = require('../../src/platform/multi')

function fakeAdapter(name) {
  const a = { name, calls: [], started: null, hooks: null, stopped: false, skillCmd: `sbot ${name}`, features: { x: name } }
  a.start = async (cb, h) => { a.started = cb; a.hooks = h }
  a.reply = async (ctx, c) => { a.calls.push(['reply', ctx.chatId, c]); return name }
  a.send = async (id, c) => { a.calls.push(['send', id, c]); return name }
  a.sendCard = async (id, card) => { a.calls.push(['card', id, card]); return { msgId: name } }
  a.createStreamingCard = async (ctx) => ({ from: name, chatId: ctx.chatId })
  a.connHealth = () => ({ state: 'connected', who: name })
  a.stop = async () => { a.stopped = true }
  return a
}

test('multi: 按 resolve 分发 reply / send / sendCard / 流式卡;判不出且有多个 ⇒ 不发并记日志', async () => {
  const fe = fakeAdapter('feishu'), we = fakeAdapter('wecom')
  const logs = []
  const table = { oc_1: 'feishu', wr_1: 'wecom' }
  const m = createMultiPlatform({ adapters: { feishu: fe, wecom: we }, resolve: (id) => table[id] || null, log: (s) => logs.push(s) })
  assert.deepEqual(m.names(), ['feishu', 'wecom']); assert.equal(m.get('wecom'), we); assert.equal(m.get('slack'), null)
  assert.equal(await m.send('oc_1', 'a'), 'feishu'); assert.equal(await m.send('wr_1', 'b'), 'wecom')
  assert.equal(await m.reply({ chatId: 'wr_1', reqId: 'r' }, 'c'), 'wecom')
  assert.deepEqual((await m.sendCard('oc_1', { t: 1 })), { msgId: 'feishu' })
  assert.deepEqual(await m.createStreamingCard({ chatId: 'wr_1' }), { from: 'wecom', chatId: 'wr_1' })
  assert.equal(await m.send('nobody', 'x'), null, '判不出 ⇒ null')
  assert.equal(await m.reply({ chatId: 'nobody' }, 'x'), null)
  assert.equal(await m.createStreamingCard({ chatId: 'nobody' }), null)
  assert.ok(logs.some((l) => /nobody/.test(l) && /platform/.test(l)), '日志说清哪个会话判不出、要补什么')
  assert.deepEqual(fe.calls.map((c) => c[1]), ['oc_1', 'oc_1']); assert.deepEqual(we.calls.map((c) => c[1]), ['wr_1', 'wr_1'])
  assert.equal(m.forChat('oc_1'), fe); assert.equal(m.forChat('nobody'), null)
  // resolve 抛错也当判不出,不炸调用方
  const m2 = createMultiPlatform({ adapters: { feishu: fe, wecom: we }, resolve: () => { throw new Error('boom') } })
  assert.equal(await m2.send('oc_1', 'x'), null)
  // 路由器自己不带平台自描述(否则会被引擎当成某个平台写清单)
  assert.equal(m.skillCmd, undefined); assert.equal(m.features, undefined); assert.equal(m.chatLabel, undefined)
})

test('multi: 只有一个适配器 ⇒ 判不出也归它(只配飞书的两台零改动);resolve 指向没配的平台也归它', async () => {
  const fe = fakeAdapter('feishu')
  const m = createMultiPlatform({ adapters: { feishu: fe }, resolve: () => null })
  assert.equal(await m.send('anything', 'x'), 'feishu'); assert.equal(m.forChat('whatever'), fe)
  const m1 = createMultiPlatform({ adapters: { feishu: fe }, resolve: () => 'wecom' }) // 群被写了 platform:"wecom" 但这台只配飞书(doctor 会 warn):仍拿飞书发
  assert.equal(m1.forChat('x'), fe)
  assert.throws(() => createMultiPlatform({ adapters: {} }), /at least one/)
  assert.deepEqual(createMultiPlatform({ adapters: { feishu: fe, wecom: null } }).names(), ['feishu'], '没配的槽(null)不算')
})

test('multi: start 各起一遍、入站回调带自己的适配器;hooks 可按平台覆盖;connHealth 字典;stop 全停', async () => {
  const fe = fakeAdapter('feishu'), we = fakeAdapter('wecom')
  const m = createMultiPlatform({ adapters: { feishu: fe, wecom: we }, resolve: () => null })
  const got = []
  const onCardAction = () => 'base', weCard = () => 'we'
  await m.start((msg, adapter, name) => got.push([msg.chatId, adapter.name, name]), { onRecall: 'R', onCardAction, byPlatform: { wecom: { onCardAction: weCard } } })
  fe.started({ chatId: 'oc_1' }); we.started({ chatId: 'wr_1' })
  assert.deepEqual(got, [['oc_1', 'feishu', 'feishu'], ['wr_1', 'wecom', 'wecom']])
  // 回调的返回值必须交回适配器(v0.11.117):适配器靠它 .catch 兜住引擎抛错,吞掉 = unhandled rejection 退进程
  const m2 = createMultiPlatform({ adapters: { feishu: fakeAdapter('feishu') }, resolve: () => null })
  const boom = Promise.reject(new Error('engine boom')); boom.catch(() => {})
  await m2.start(() => boom)
  assert.equal(m2.get('feishu').started({ chatId: 'oc_2' }), boom, 'onMessage 的 Promise 原样返回')
  // 配置判不出归属的会话(resolve 回 null)⇒ 按最近一次入站的适配器回;没见过入站 ⇒ null
  assert.equal(m.forChat('wr_1'), we); assert.equal(m.forChat('oc_1'), fe); assert.equal(m.forChat('never'), null)
  fe.started({ chatId: 'wr_1' }); assert.equal(m.forChat('wr_1'), fe, '最近一次入站说了算')
  assert.equal(fe.hooks.onRecall, 'R'); assert.equal(fe.hooks.onCardAction, onCardAction); assert.equal(fe.hooks.byPlatform, undefined, 'byPlatform 不透传给适配器')
  assert.equal(we.hooks.onCardAction, weCard, '企微那份按平台覆盖'); assert.equal(we.hooks.onRecall, 'R')
  assert.deepEqual(m.connHealth(), { feishu: { state: 'connected', who: 'feishu' }, wecom: { state: 'connected', who: 'wecom' } })
  await m.stop(); assert.ok(fe.stopped && we.stopped)
})
