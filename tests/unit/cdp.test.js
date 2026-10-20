// src/cdp.js —— 常驻浏览器的 CDP 客户端:会话配对 / 事件 / 超时,输入翻译,截屏推流的 ack 顺序,端点过滤。
// 全部零网络:ws 用假的(内存里回包),HTTP 端点用本地临时 http 服务。
// 分辨力:配对 / 超时 / 断线各有正反两例;推流的 ack 顺序钉「没写完之前不许 ack」再钉「写完必 ack」;输入翻译对每类合法事件
// 各断言一次,坏输入逐个列举(改宽任何一条校验都会有一条红)。
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const cdp = require('../../src/cdp')

// 假 WebSocket:记下发出的报文;`reply(id, result)` / `emit(method, params)` / `fail()` 从测试侧驱动
class FakeWS {
  constructor(url) { this.url = url; this.sent = []; this.h = {}; FakeWS.last = this; setTimeout(() => this.h.open && this.h.open(), 0) }
  on(ev, fn) { this.h[ev] = fn }
  send(s) { this.sent.push(JSON.parse(s)) }
  reply(id, result) { this.h.message(JSON.stringify({ id, result })) }
  error(id, message) { this.h.message(JSON.stringify({ id, error: { message } })) }
  emit(method, params) { this.h.message(Buffer.from(JSON.stringify({ method, params }))) }
  close() { this.h.close && this.h.close() }
}
const connect = async (opts = {}) => { const s = new cdp.CdpSession('ws://x/devtools/page/1', { WebSocketImpl: FakeWS, timeoutMs: 80, ...opts }); await s.connect(); return { s, ws: FakeWS.last } }

test('CdpSession: call 按 id 配对回包;error 回包变成拒绝;事件按 method 分发(Buffer 与字符串都认)', async () => {
  const { s, ws } = await connect()
  const p1 = s.call('Page.enable'); const p2 = s.call('Runtime.evaluate', { expression: '1' })
  assert.equal(ws.sent.length, 2); assert.equal(ws.sent[0].method, 'Page.enable'); assert.equal(ws.sent[1].params.expression, '1')
  ws.reply(ws.sent[1].id, { result: { value: 1 } }); ws.reply(ws.sent[0].id, {})
  assert.deepEqual(await p2, { result: { value: 1 } }); assert.deepEqual(await p1, {})
  const p3 = s.call('Nope.x'); ws.error(ws.sent[2].id, 'no such method')
  await assert.rejects(p3, /Nope\.x: no such method/)
  const got = []; const off = s.on('Page.screencastFrame', (p) => got.push(p.sessionId))
  ws.emit('Page.screencastFrame', { sessionId: 7 }); ws.emit('Other.event', {})
  assert.deepEqual(got, [7]); off(); ws.emit('Page.screencastFrame', { sessionId: 8 }); assert.deepEqual(got, [7], 'off 之后不再收')
})

test('CdpSession: 超时拒绝;断线把挂着的 call 全拒掉;关闭后再 call 直接拒', async () => {
  const { s, ws } = await connect()
  await assert.rejects(s.call('Slow.x'), /超时/)
  const p = s.call('Pending.y'); ws.close()
  await assert.rejects(p, /断开/)
  await assert.rejects(s.call('After.z'), /未就绪/)
})

test('startScreencast: 先补一张首帧(带视口尺寸),真帧 onFrame 完成后才 ack(背压);返回的 stop 会停流', async () => {
  const { s, ws } = await connect({ timeoutMs: 500 })
  const frames = []; let resolveSlow
  const onFrame = (f) => { frames.push(f); return f.meta.seed ? Promise.resolve() : new Promise((r) => { resolveSlow = r }) }
  const stopP = cdp.startScreencast(s, { maxWidth: 320, quality: 30 }, onFrame)
  // 依次回:Page.enable → Page.startScreencast → captureScreenshot + getLayoutMetrics
  const byMethod = (m) => ws.sent.find((x) => x.method === m)
  await new Promise((r) => setTimeout(r, 5)); ws.reply(byMethod('Page.enable').id, {})
  await new Promise((r) => setTimeout(r, 5)); assert.equal(byMethod('Page.startScreencast').params.maxWidth, 320); ws.reply(byMethod('Page.startScreencast').id, {})
  await new Promise((r) => setTimeout(r, 5)); ws.reply(byMethod('Page.getLayoutMetrics').id, { cssVisualViewport: { clientWidth: 1280, clientHeight: 720 } })
  await new Promise((r) => setTimeout(r, 5))
  const shotReq = byMethod('Page.captureScreenshot'); assert.deepEqual(shotReq.params.clip, { x: 0, y: 0, width: 1280, height: 720, scale: 0.25 }, '首帧按推流的 maxWidth 同比例缩,否则第二帧到来画面会跳')
  ws.reply(shotReq.id, { data: 'SEED' })
  const stop = await stopP
  assert.equal(frames.length, 1); assert.equal(frames[0].data, 'SEED'); assert.equal(frames[0].meta.deviceWidth, 1280); assert.equal(frames[0].meta.seed, true)
  ws.emit('Page.screencastFrame', { data: 'F1', metadata: { deviceWidth: 1280, deviceHeight: 720 }, sessionId: 3 })
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(frames.length, 2); assert.equal(ws.sent.some((x) => x.method === 'Page.screencastFrameAck'), false, '消费方没写完之前不能 ack')
  resolveSlow(); await new Promise((r) => setTimeout(r, 5))
  const ack = ws.sent.find((x) => x.method === 'Page.screencastFrameAck'); assert.ok(ack); assert.equal(ack.params.sessionId, 3)
  await stop(); assert.ok(ws.sent.some((x) => x.method === 'Page.stopScreencast'))
})

test('inputToCdp: 七种事件各翻成正确的 CDP 调用;坏坐标 / 超长文本 / 未知键 / 未知类型 ⇒ null', () => {
  assert.deepEqual(cdp.inputToCdp({ t: 'move', x: 10.26, y: 20 }), [{ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: 10.3, y: 20, button: 'none', buttons: 0 } }])
  assert.equal(cdp.inputToCdp({ t: 'move', x: 1, y: 2, down: true })[0].params.button, 'left')
  assert.equal(cdp.inputToCdp({ t: 'down', x: 1, y: 2 })[0].params.type, 'mousePressed')
  assert.equal(cdp.inputToCdp({ t: 'up', x: 1, y: 2 })[0].params.type, 'mouseReleased')
  assert.deepEqual(cdp.inputToCdp({ t: 'tap', x: 1, y: 2 }).map((c) => c.params.type), ['mouseMoved', 'mousePressed', 'mouseReleased'])
  assert.deepEqual(cdp.inputToCdp({ t: 'wheel', x: 1, y: 2, dy: 120 })[0].params, { type: 'mouseWheel', x: 1, y: 2, deltaX: 0, deltaY: 120 })
  assert.deepEqual(cdp.inputToCdp({ t: 'text', text: '验证码 237367' }), [{ method: 'Input.insertText', params: { text: '验证码 237367' } }])
  const enter = cdp.inputToCdp({ t: 'key', key: 'Enter' })
  assert.equal(enter.length, 2); assert.equal(enter[0].params.type, 'keyDown'); assert.equal(enter[0].params.text, '\r'); assert.equal(enter[1].params.type, 'keyUp'); assert.equal(enter[0].params.windowsVirtualKeyCode, 13)
  assert.equal(cdp.inputToCdp({ t: 'key', key: 'Backspace' })[0].params.type, 'rawKeyDown')
  assert.equal(cdp.inputToCdp({ t: 'key', key: 'Escape', shift: true })[0].params.modifiers, 8)
  for (const bad of [{ t: 'move', x: 'a', y: 1 }, { t: 'move', x: -1, y: 1 }, { t: 'move', x: 1, y: 99999 }, { t: 'text', text: 'x'.repeat(cdp.MAX_TEXT + 1) }, { t: 'text', text: '' }, { t: 'key', key: 'F13' }, { t: 'wheel', x: 1, y: 1, dy: 99999 }, { t: 'nope', x: 1, y: 1 }, null, 'str']) {
    assert.equal(cdp.inputToCdp(bad), null, JSON.stringify(bad))
  }
})

test('dispatchInputs: 坏事件跳过、CDP 报错记 failed、其余按序发;超过 max 的截掉', async () => {
  const calls = []
  const session = { call: async (m, p) => { calls.push(p.type || m); if (p.type === 'mouseReleased') throw new Error('navigating') } }
  const r = await cdp.dispatchInputs(session, [{ t: 'down', x: 1, y: 1 }, { t: 'nope' }, { t: 'up', x: 1, y: 1 }, { t: 'text', text: 'a' }], { max: 3 })
  assert.deepEqual(r, { sent: 2, skipped: 1, failed: 1, dropped: 0 }, 'max 只截 move/wheel:四条里没有可丢的,一条都不丢')
  assert.deepEqual(calls, ['mousePressed', 'mouseReleased', 'Input.insertText'])
  // 超过 max:丢的是最老的 move,down/up/text 一个不丢,尾部的 up 必须还在(丢了鼠标就卡在按下态)
  const many = [{ t: 'down', x: 1, y: 1 }, ...Array.from({ length: 300 }, (_, i) => ({ t: 'move', x: i, y: 1, down: true })), { t: 'up', x: 300, y: 1 }]
  const tr = cdp.trimEvents(many, 50)
  assert.equal(tr.list.length, 50); assert.equal(tr.dropped, 252); assert.equal(tr.list[0].t, 'down'); assert.equal(tr.list[tr.list.length - 1].t, 'up'); assert.equal(tr.list[1].x, 252, '留的是最近的几步')
  assert.equal(cdp.inputToCdp({ t: 'key', key: '__proto__' }), null, '键名不摸原型')
})

test('pointerToCss: 帧像素 → 页面 CSS 像素按比例换算并夹回视口;尺寸缺失 ⇒ null', () => {
  assert.deepEqual(cdp.pointerToCss({ px: 320, py: 100, imgW: 640, imgH: 400, cssW: 1280, cssH: 800 }), { x: 640, y: 200 })
  assert.deepEqual(cdp.pointerToCss({ px: 9999, py: -5, imgW: 640, imgH: 400, cssW: 1280, cssH: 800 }), { x: 1280, y: 0 })
  assert.equal(cdp.pointerToCss({ px: 1, py: 1, imgW: 0, imgH: 400, cssW: 1280, cssH: 800 }), null)
})

test('listTargets / versionInfo / newTarget: 只留 page 型且是网页的 target;PUT /json/new;端点失败抛错', async () => {
  const seen = []
  const srv = http.createServer((req, res) => {
    seen.push(req.method + ' ' + req.url)
    if (req.url === '/json/version') return res.end(JSON.stringify({ Browser: 'Chrome/152.0' }))
    if (req.url === '/json') return res.end(JSON.stringify([
      { id: 'a', type: 'page', title: 'A', url: 'https://a.example/', webSocketDebuggerUrl: 'ws://x/a' },
      { id: 'b', type: 'page', title: 'ext', url: 'chrome-extension://zz/popup.html', webSocketDebuggerUrl: 'ws://x/b' },
      { id: 'c', type: 'iframe', title: '', url: 'https://c.example/', webSocketDebuggerUrl: 'ws://x/c' },
      { id: 'd', type: 'page', title: 'blank', url: 'about:blank', webSocketDebuggerUrl: 'ws://x/d' },
    ]))
    if (req.url.startsWith('/json/new?')) return res.end(JSON.stringify({ id: 'n', url: decodeURIComponent(req.url.slice(10)), webSocketDebuggerUrl: 'ws://x/n' }))
    if (req.url.startsWith('/json/close/')) return res.end('Target is closing')
    res.writeHead(404); res.end('nope')
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${srv.address().port}`
  try {
    assert.equal((await cdp.versionInfo(base)).Browser, 'Chrome/152.0')
    const t = await cdp.listTargets(base)
    assert.deepEqual(t.map((x) => x.id), ['a', 'd'], '扩展页与 iframe 不算标签页')
    assert.equal(t[0].wsUrl, 'ws://x/a')
    const n = await cdp.newTarget(base, 'https://n.example/x?y=1'); assert.equal(n.url, 'https://n.example/x?y=1')
    assert.ok(seen.some((s) => s.startsWith('PUT /json/new?')))
    assert.equal(await cdp.closeTarget(base, 'a'), 'Target is closing')
    await assert.rejects(cdp.httpJSON(base + '/nope'), /HTTP 404/)
  } finally { srv.close() }
})
