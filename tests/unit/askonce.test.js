// 问一次模型(src/agent/askonce.js):只对有 baseUrl + apiKey 的 provider 成立 · 请求形状 = 消息协议最小集 · 两个鉴权头 ·
// model 剥 [1m] · 非 2xx / 超时 / 非 JSON / 没内容都 throw。注入假 fetch,零网络。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createAskOnce, askableProvider, stripModelTag } = require('../../src/agent/askonce')

test('askonce: askableProvider 三种不能 + 一种能;stripModelTag', () => {
  assert.match(askableProvider(undefined, 'x'), /没有叫「x」/)
  assert.match(askableProvider({ runner: 'codex' }, 'codex'), /不是这套消息协议/)
  assert.match(askableProvider({}, 'claude'), /没有配 baseUrl \+ apiKey/)
  assert.equal(askableProvider({ baseUrl: 'https://a', apiKey: 'k', model: 'm' }, 'd'), null)
  assert.equal(stripModelTag('deepseek-v4-pro[1m]'), 'deepseek-v4-pro'); assert.equal(stripModelTag(' x '), 'x')
})

test('askonce: 请求形状与回包解析;错误路径', async () => {
  const calls = []
  let reply = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'YES' }, { type: 'text', text: '!' }] }) })
  const ask = createAskOnce({ fetchImpl: async (url, init) => { calls.push({ url, init }); return reply(init) }, timeoutMs: 50 })
  const prov = { baseUrl: 'https://api.example.com/anthropic/', apiKey: 'sk-1', model: 'cheap[1m]', name: 'd' }
  assert.equal(await ask(prov, { system: 'S', user: 'U', maxTokens: 8 }), 'YES!')
  const c = calls[0]; assert.equal(c.url, 'https://api.example.com/anthropic/v1/messages'); assert.equal(c.init.method, 'POST')
  assert.equal(c.init.headers['x-api-key'], 'sk-1'); assert.equal(c.init.headers.authorization, 'Bearer sk-1'); assert.equal(c.init.headers['anthropic-version'], '2023-06-01')
  assert.deepEqual(JSON.parse(c.init.body), { model: 'cheap', max_tokens: 8, system: 'S', messages: [{ role: 'user', content: 'U' }], thinking: { type: 'disabled' } }, '默认关思考(真机:不关则 thinking 段吃光预算)')
  await ask(prov, { user: 'U', model: 'other' }); assert.equal(JSON.parse(calls[1].init.body).model, 'other', '按次指定型号优先'); assert.equal('system' in JSON.parse(calls[1].init.body), false)
  await assert.rejects(ask({ baseUrl: 'https://a', apiKey: 'k' }, { user: 'U' }), /没有型号名/)
  await assert.rejects(ask({ runner: 'codex', name: 'c' }, { user: 'U' }), /不是这套消息协议/)
  reply = () => ({ ok: false, status: 401, text: async () => 'invalid key' }); await assert.rejects(ask(prov, { user: 'U' }), /HTTP 401:invalid key/)
  reply = () => ({ ok: true, status: 200, text: async () => 'nope' }); await assert.rejects(ask(prov, { user: 'U' }), /不是 JSON/)
  reply = () => ({ ok: true, status: 200, text: async () => '{}' }); await assert.rejects(ask(prov, { user: 'U' }), /没有内容/)
  reply = (init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  await assert.rejects(ask(prov, { user: 'U' }), /超时\(50ms\)/)
  reply = () => { throw new Error('ECONNREFUSED') }; await assert.rejects(ask(prov, { user: 'U' }), /请求失败:ECONNREFUSED/)
  // 响应头到了、body 停滞:超时必须也罩住 r.text()(否则调用方永久挂起 ⇒ 整条轮询停摆)
  reply = (init) => ({ ok: true, status: 200, text: () => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) })
  await assert.rejects(ask(prov, { user: 'U' }), /超时\(50ms\)/)
  // 只有 thinking 段没有 text ⇒ 明说原因(思考型型号吃光预算),不是「看不懂」
  reply = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'thinking', thinking: '…' }] }) })
  await assert.rejects(ask(prov, { user: 'U' }), /只有 thinking 段没有文字/)
  // 默认 max_tokens 48(思考型型号留余量)
  reply = () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'NO' }] }) })
  await ask(prov, { user: 'U' }); assert.equal(JSON.parse(calls[calls.length - 1].init.body).max_tokens, 48)
  // 端点不认 thinking 字段(400 原话提到它)⇒ 退一次不带它重试;其他 400 不重试
  const n0 = calls.length
  reply = (init) => JSON.parse(init.body).thinking ? { ok: false, status: 400, text: async () => '{"error":"unknown field: thinking"}' } : { ok: true, status: 200, text: async () => JSON.stringify({ content: [{ type: 'text', text: 'YES' }] }) }
  assert.equal(await ask(prov, { user: 'U' }), 'YES'); assert.equal(calls.length - n0, 2, '第二次不带 thinking'); assert.equal('thinking' in JSON.parse(calls[calls.length - 1].init.body), false)
  reply = () => ({ ok: false, status: 400, text: async () => 'bad request' }); const n1 = calls.length
  await assert.rejects(ask(prov, { user: 'U' }), /HTTP 400:bad request/); assert.equal(calls.length - n1, 1, '与 thinking 无关的 400 不重试')
  // provider 没写 model、门控也没指定 ⇒ askableProvider 就拒(doctor 同口径)
  assert.match(askableProvider({ baseUrl: 'https://a', apiKey: 'k' }, 'd'), /没有型号名/); assert.equal(askableProvider({ baseUrl: 'https://a', apiKey: 'k' }, 'd', { model: 'x' }), null)
  assert.throws(() => createAskOnce({ fetchImpl: null }), /fetch unavailable/)
})
