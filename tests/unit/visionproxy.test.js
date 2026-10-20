// Vision strip-proxy — the pure request-body sanitizer. The proxy's
// HTTP plumbing is exercised by the live group loop; here we lock down the
// content-block rewrite that keeps a text-only model from 400ing on image input.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { stripImages, decodeUpstream, proxyBaseFor, ensureProxy, stopProxy, IMAGE_PLACEHOLDER } = require('../../src/agent/visionproxy')

test('stripImages: replaces a top-level image block with a text placeholder', () => {
  const body = { model: 'glm', messages: [
    { role: 'user', content: [
      { type: 'text', text: 'look at this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ] },
  ] }
  const { payload, changed } = stripImages(body)
  assert.equal(changed, 1)
  assert.deepEqual(payload.messages[0].content, [
    { type: 'text', text: 'look at this' },
    { type: 'text', text: IMAGE_PLACEHOLDER },
  ])
})

test('stripImages: recurses into tool_result content (tool-returned images)', () => {
  const body = { messages: [
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: [
        { type: 'text', text: 'screenshot:' },
        { type: 'image', source: { data: 'BBBB' } },
      ] },
    ] },
  ] }
  const { payload, changed } = stripImages(body)
  assert.equal(changed, 1)
  assert.deepEqual(payload.messages[0].content[0].content, [
    { type: 'text', text: 'screenshot:' },
    { type: 'text', text: IMAGE_PLACEHOLDER },
  ])
})

// 真实形状回归(2026-07-19):识图降级当初的场景是「群里有人发图」,而浏览器能力上线后多了一条
// 新路径 —— MCP 截图工具的返回值。claude 把 MCP 的 image content 包成 assistant 轮之后的
// user 轮 tool_result,图片块深一层。这条锁死那个确切形状,别在重构里把递归弄丢。
test('stripImages: chrome-devtools MCP screenshot tool_result (the browser path)', () => {
  const body = { model: 'glm-5.2', messages: [
    { role: 'user', content: [{ type: 'text', text: '截个图看看' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__chrome-devtools__take_screenshot', input: {} }] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_1', is_error: false, content: [
        { type: 'text', text: 'Took a screenshot of the current page' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQSkZJRg' } },
      ] },
    ] },
  ] }
  const { payload, changed } = stripImages(body)
  assert.equal(changed, 1)
  const tr = payload.messages[2].content[0]
  assert.equal(tr.type, 'tool_result')          // 包装块本身不动
  assert.equal(tr.tool_use_id, 'toolu_1')
  assert.equal(tr.is_error, false)
  assert.deepEqual(tr.content[1], { type: 'text', text: IMAGE_PLACEHOLDER })
  assert.equal(payload.messages[1].content[0].type, 'tool_use') // tool_use 轮原样
})

test('stripImages: counts every image across messages', () => {
  const body = { messages: [
    { role: 'user', content: [{ type: 'image', source: {} }] },
    { role: 'user', content: [{ type: 'image', source: {} }, { type: 'text', text: 'x' }] },
  ] }
  assert.equal(stripImages(body).changed, 2)
})

test('stripImages: text-only body is returned changed:0 and untouched', () => {
  const body = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }
  const { payload, changed } = stripImages(body)
  assert.equal(changed, 0)
  assert.deepEqual(payload.messages, body.messages)
})

test('stripImages: string content (not an array) is left alone', () => {
  const body = { messages: [{ role: 'user', content: 'plain string' }] }
  const { changed } = stripImages(body)
  assert.equal(changed, 0)
})

test('stripImages: non-message payloads pass through unchanged (no .changed)', () => {
  const notMessages = { some: 'other', body: 1 }
  assert.equal(stripImages(notMessages), notMessages) // returned verbatim
  assert.equal(stripImages(null), null)
  assert.equal(stripImages('str'), 'str')
})

test('stripImages: does not mutate the input payload', () => {
  const body = { messages: [{ role: 'user', content: [{ type: 'image', source: { data: 'X' } }] }] }
  stripImages(body)
  assert.equal(body.messages[0].content[0].type, 'image') // original still an image
})

test('decodeUpstream / proxyBaseFor: round-trip the upstream base through the path prefix', () => {
  const real = 'https://open.bigmodel.cn/api/anthropic'
  const proxyBase = proxyBaseFor(4321, real)
  assert.match(proxyBase, /^http:\/\/127\.0\.0\.1:4321\//)

  // claude appends /v1/messages to the proxy base → this is the path we receive.
  const seg = proxyBase.split('127.0.0.1:4321/')[1]
  const decoded = decodeUpstream('/' + seg + '/v1/messages')
  assert.equal(decoded.upstreamBase, real)
  assert.equal(decoded.restPath, '/v1/messages')
})

test('decodeUpstream: rejects a garbage prefix', () => {
  assert.equal(decodeUpstream('/!!!notbase64!!!/v1/messages'), null)
})

// End-to-end plumbing: a fake upstream stands in for GLM; a request through the
// live proxy must arrive image-stripped, at the right path, with headers intact,
// and the (streamed) response must pipe straight back.
test('ensureProxy: forwards image-stripped body to the real upstream and pipes the response', async (t) => {
  let received = null
  const upstream = http.createServer((req, res) => {
    let b = ''
    req.on('data', (c) => { b += c })
    req.on('end', () => {
      received = { path: req.url, auth: req.headers.authorization, body: JSON.parse(b) }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('data: {"ok":true}\n\n')
    })
  })
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
  const upstreamBase = `http://127.0.0.1:${upstream.address().port}/api/anthropic`
  t.after(() => { upstream.close(); stopProxy() })

  const port = await ensureProxy()
  const proxyBase = proxyBaseFor(port, upstreamBase)
  const seg = proxyBase.split(`127.0.0.1:${port}/`)[1]

  const payload = JSON.stringify({ model: 'glm', messages: [
    { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image', source: { data: 'ZZZZ' } }] },
  ] })

  const respBody = await new Promise((resolve, reject) => {
    const r = http.request({
      hostname: '127.0.0.1', port, method: 'POST', path: `/${seg}/v1/messages`,
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok-xyz', 'content-length': Buffer.byteLength(payload) },
    }, (resp) => { let d = ''; resp.on('data', (c) => { d += c }); resp.on('end', () => resolve(d)) })
    r.on('error', reject)
    r.end(payload)
  })

  assert.equal(received.path, '/api/anthropic/v1/messages') // upstream path prefix preserved
  assert.equal(received.auth, 'Bearer tok-xyz')             // auth forwarded untouched
  assert.deepEqual(received.body.messages[0].content, [     // image downgraded before it left
    { type: 'text', text: 'hi' },
    { type: 'text', text: IMAGE_PLACEHOLDER },
  ])
  assert.match(respBody, /"ok":true/)                        // response streamed back verbatim
})

const { DOC_PLACEHOLDER } = require('../../src/agent/visionproxy')

test('stripImages: document (PDF) blocks are downgraded like images (P2)', () => {
  const { payload, changed } = stripImages({ messages: [
    { role: 'user', content: [{ type: 'document', source: { type: 'base64', data: 'x' } }, { type: 'text', text: 'summarize' }] },
  ] })
  assert.equal(changed, 1)
  assert.deepEqual(payload.messages[0].content[0], { type: 'text', text: DOC_PLACEHOLDER })
  assert.equal(payload.messages[0].content[1].text, 'summarize')
})
