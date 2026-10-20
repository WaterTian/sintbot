// 控制台「接管浏览器」:页面与 /api/browser/* 的门 + 推流 / 输入 / 签票的行为。浏览器是假的(cdpImpl 注入),零网络。
//
// 门的几条判据各钉一遍:① 票走 URL 片段,页面上 POST claim 才换 cookie,第二次 410;② cookie 只开 /api/browser/*,控制台其它接口 401,
// 且 cookie 不能签票、不能新开网址;③ 签票只认管理员令牌或「本机环回 + 不带反代头 + 带 X-Sbot-Local 头」—— 缺任何一样都 401;
// ④ 票绑了标签页,持票人碰别的页一律 403;⑤ 同一标签页两个人看:开流一次、一人走了另一人照收、最后一人走了才停流。
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createUiServer } = require('../../src/ui/server')
const { rmTmpDir } = require('./tmpdir')
const { waitAudit } = require('./auditlog')
const { hashPassword } = require('../../src/ui/auth')
const takeover = require('../../src/ui/takeover')

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-br-')) }
function rawReq(port, { method = 'GET', path: reqPath = '/', headers = {}, body = null, onChunk = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      let b = ''
      res.on('data', (c) => { b += c; if (onChunk && onChunk(b, res)) { res.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: b }) } })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }))
    })
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}
// 长连接的推流客户端:攒着 body,测试自己决定什么时候断
function openStream(port, reqPath, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: reqPath, headers }, (res) => {
      const st = { status: res.statusCode, body: '', ended: false, close: () => res.destroy(), frames: () => st.body.split('event: frame').length - 1 }
      res.on('data', (c) => { st.body += c }); res.on('end', () => { st.ended = true })
      resolve(st)
    })
    r.on('error', reject); r.end()
  })
}
const until = async (fn, ms = 1500) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 15)) } return true }

// 假浏览器:两个标签页;推流 = 先 seed 再一帧,并把 onFrame 留给测试推更多帧;输入 = 数一数
function fakeCdp({ down = false } = {}) {
  const calls = []
  const f = {
    calls, onFrame: null,
    DEFAULT_CDP_URL: 'http://127.0.0.1:9222',
    async versionInfo() { if (down) throw new Error('connect ECONNREFUSED 127.0.0.1:9222'); return { Browser: 'Chrome/152.0' } },
    async listTargets() { if (down) throw new Error('connect ECONNREFUSED 127.0.0.1:9222'); return [{ id: 'T1', title: '安全验证', url: 'https://example.com/verify', wsUrl: 'ws://fake/T1' }, { id: 'T2', title: 'blank', url: 'about:blank', wsUrl: 'ws://fake/T2' }] },
    async newTarget(_, url) { calls.push(['new', url]); return { id: 'T9', url } },
    async activateTarget(_, id) { calls.push(['activate', id]); return null },
    CdpSession: class { constructor(u) { this.url = u; this.connected = false; this._close = new Set() } async connect() { this.connected = true; return this } on() { return () => {} } onClose(fn) { this._close.add(fn); return () => this._close.delete(fn) } close() { this.connected = false; for (const x of this._close) x() } async call() { return {} } },
    async startScreencast(session, opts, onFrame) { calls.push(['screencast', opts.maxWidth, opts.quality]); f.onFrame = onFrame; await onFrame({ data: 'U0VFRA==', meta: { deviceWidth: 1280, deviceHeight: 720, seed: true } }); await onFrame({ data: 'RjE=', meta: { deviceWidth: 1280, deviceHeight: 720 } }); return async () => { calls.push(['stop']) } },
    async seedFrame(session, opts, onFrame) { calls.push(['seed', opts.maxWidth]); await onFrame({ data: 'U0VFRDI=', meta: { deviceWidth: 1280, deviceHeight: 720, seed: true } }) },
    async dispatchInputs(session, events) { calls.push(['input', events.length]); return { sent: events.length, skipped: 0, failed: 0, dropped: 0 } },
  }
  return f
}

async function withServer(cfgObj, fn, { cdp = fakeCdp(), lan = false, takeoverNow = null } = {}) {
  const dir = tmpDir()
  const cfgPath = path.join(dir, 'sbot.config.json'); fs.writeFileSync(cfgPath, JSON.stringify(cfgObj))
  const auditPath = path.join(dir, 'audit.jsonl')
  const ui = createUiServer({ configPath: cfgPath, sessionsPath: path.join(dir, 's.json'), auditPath, log: () => {}, cdpImpl: cdp, host: lan ? '0.0.0.0' : '127.0.0.1', takeoverNow })
  const port = await new Promise((r) => ui.listen(0, '127.0.0.1', () => r(ui.server.address().port)))
  const page = await rawReq(port, { path: '/' })
  const m = page.body.match(/TOKEN='([0-9a-f]{32})'/)
  // 审计本是异步追加:断言前等到条数够为止(为什么、等多久见 ./auditlog.js)
  const auditWait = (n) => waitAudit(auditPath, n)
  try { await fn({ port, token: m && m[1], cfgPath, cdp, audit: auditWait, ui }) } finally { ui.close(); await rmTmpDir(dir) }
}
const CFG = { agent: { maxConcurrent: 2 }, providers: { claude: {} }, groups: {} }
// 对外绑定 + 密码 = 生产机的形状:本机环回免密注入令牌,带反代头 / 局域网来的不注入(与首页同一条规则)
const LAN = { ...CFG, ui: { auth: hashPassword('pw-for-test') } }
const J = { 'Content-Type': 'application/json' }
const LOCAL = { ...J, 'X-Sbot-Local': '1' }
const cookieOf = (r) => String((r.headers['set-cookie'] || [])[0] || '').split(';')[0]
const ticketOf = (url) => url.split('#k=')[1]
// 群成员拿票换 cookie 的标准动作(经隧道来:带反代头)
const claim = (port, k, extra = {}) => rawReq(port, { method: 'POST', path: '/api/browser/claim', headers: { ...J, 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https', ...extra }, body: JSON.stringify({ k }) })
const hasLan = () => Object.values(os.networkInterfaces()).flat().some((n) => n && n.family === 'IPv4' && !n.internal)

test('browser: 一次性链接 —— 本机签票(带 X-Sbot-Local)→ 票在 URL 片段里 → 页面 POST claim 换 cookie → 同一张票第二次 410;审计三条', async () => {
  await withServer(CFG, async ({ port, audit }) => {
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: J, body: '{}' })).status, 401, '不带 X-Sbot-Local 的环回 POST 不算本机(挡本机网页的跨站 POST)')
    const mint = await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: LOCAL, body: '{}' })
    assert.equal(mint.status, 200, mint.body)
    const j = JSON.parse(mint.body)
    assert.match(j.url, /^http:\/\/127\.0\.0\.1:\d+\/browser#k=[0-9a-f]{32}$/, '只绑环回 ⇒ 退成 127.0.0.1(局域网地址根本连不上),票在片段里')
    assert.equal(j.reach, 'local'); assert.equal(j.public, false); assert.equal(j.minutes, 10); assert.equal(j.target, null)
    const k = ticketOf(j.url)
    // 裸 GET 带票不消费票(链接预览 / 安全扫描抓不走)
    const peek = await rawReq(port, { path: '/browser?k=' + k, headers: { 'X-Forwarded-For': '203.0.113.9' } })
    assert.equal(peek.status, 200); assert.equal(peek.headers['set-cookie'], undefined, 'GET 不下发 cookie')
    const use = await claim(port, k)
    assert.equal(use.status, 200, use.body)
    const ck = cookieOf(use); assert.match(ck, /^sbot-takeover=[0-9a-f]{32}$/)
    assert.match(String(use.headers['set-cookie'][0]), /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/, '经 https 反代来的加 Secure')
    const again = await claim(port, k)
    assert.equal(again.status, 410, '票只能用一次'); assert.match(JSON.parse(again.body).error, /已失效/)
    const rows = await audit(3)
    assert.deepEqual(rows.map((a) => a.kind).sort(), ['takeover-mint', 'takeover-use', 'takeover-use'])
    const mintRow = rows.find((a) => a.kind === 'takeover-mint'), uses = rows.filter((a) => a.kind === 'takeover-use')
    assert.equal(mintRow.reach, 'local'); assert.deepEqual(uses.map((a) => a.ok).sort(), [false, true], '一次成功一次被拒(两条异步追加,落盘先后不保证)')
  })
  // 对外绑定 ⇒ 局域网地址(这台机器没有局域网网卡时退成 local,断言按事实分支)
  await withServer(LAN, async ({ port }) => {
    const j = JSON.parse((await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: LOCAL, body: '{}' })).body)
    if (hasLan()) { assert.equal(j.reach, 'lan'); assert.match(j.url, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/browser#k=/) } else { assert.equal(j.reach, 'local') }
  }, { lan: true })
})

test('browser: cookie 只开 /api/browser/*,控制台其它接口 401,不能签票、不能新开网址;/browser 页对 cookie 用户标 TAKEOVER;退出所有设备连接管一起吊销', async () => {
  await withServer(LAN, async ({ port, token }) => {
    const mint = JSON.parse((await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: LOCAL, body: '{"minutes":3}' })).body)
    assert.equal(mint.minutes, 3)
    const ck = cookieOf(await claim(port, ticketOf(mint.url)))
    const H = { Cookie: ck, 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https' }
    const t = await rawReq(port, { path: '/api/browser/targets', headers: H })
    assert.equal(t.status, 200); const tj = JSON.parse(t.body); assert.equal(tj.ok, true); assert.equal(tj.mode, 'takeover'); assert.equal(tj.targets.length, 2, '没绑标签页的票看得到全部')
    for (const p of ['/api/state', '/api/activity', '/api/events']) assert.equal((await rawReq(port, { path: p, headers: H })).status, 401, p + ':cookie 到不了控制台其它接口')
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: { ...H, ...LOCAL }, body: '{}' })).status, 401, '接管者不能再签票(带反代头就不是本机)')
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/targets', headers: { ...H, ...J }, body: '{"url":"https://evil.example/"}' })).status, 403, '持票人不能新开网址')
    const page = await rawReq(port, { path: '/browser', headers: H })
    assert.equal(page.status, 200); assert.match(page.body, /const TAKEOVER='1'==='1'/); assert.match(page.body, /let TOKEN='';/, '经反代来的人不注入免密令牌')
    // 结束接管:cookie 清掉、会话作废
    const end = await rawReq(port, { method: 'POST', path: '/api/browser/end', headers: { ...H, ...J }, body: '{}' })
    assert.equal(end.status, 200); assert.match(String(end.headers['set-cookie'][0]), /Max-Age=0/); assert.match(String(end.headers['set-cookie'][0]), /Secure/)
    assert.equal((await rawReq(port, { path: '/api/browser/targets', headers: H })).status, 401, '结束后 cookie 不再认')
    // 退出所有设备 = 恐慌按钮:正在进行的接管一起断
    const ck2 = cookieOf(await claim(port, ticketOf(JSON.parse((await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: LOCAL, body: '{}' })).body).url)))
    assert.equal((await rawReq(port, { path: '/api/browser/targets', headers: { ...H, Cookie: ck2 } })).status, 200)
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/logout/all', headers: { ...J, 'X-Sbot-Token': token }, body: '{}' })).status, 200)
    assert.equal((await rawReq(port, { path: '/api/browser/targets', headers: { ...H, Cookie: ck2 } })).status, 401, '退出所有设备后接管 cookie 失效')
  }, { lan: true })
})

test('browser: 签票的门 —— 带反代头的环回请求不算本机(401);管理员令牌可签;配了公网地址就用公网地址;--tab 把票绑在标签页上', async () => {
  await withServer({ ...CFG, ui: { publicUrl: 'https://cb.example.com' } }, async ({ port, token }) => {
    const denied = await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: { ...LOCAL, 'X-Forwarded-For': '203.0.113.9' }, body: '{}' })
    assert.equal(denied.status, 401)
    const ok = await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: { ...J, 'X-Sbot-Token': token, 'X-Forwarded-For': '203.0.113.9' }, body: '{"tab":"example"}' })
    assert.equal(ok.status, 200); const j = JSON.parse(ok.body)
    assert.match(j.url, /^https:\/\/cb\.example\.com\/browser#k=[0-9a-f]{32}$/); assert.equal(j.public, true); assert.equal(j.reach, 'public'); assert.equal(j.target, 'T1')
    const miss = await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: { ...J, 'X-Sbot-Token': token }, body: '{"tab":"nope-nope"}' })
    assert.equal(miss.status, 400); assert.match(JSON.parse(miss.body).error, /没有匹配/)
    // 按标签页 id 绑页(agent 从列表里拿到的就是大写十六进制 id):大小写都要命中 —— 此前参数先小写化再与大写 id 严格相等,按 id 永远绑不上,只能用网址片段
    const byId = await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: { ...J, 'X-Sbot-Token': token }, body: '{"tab":"T1"}' })
    assert.equal(byId.status, 200, byId.body); assert.equal(JSON.parse(byId.body).target, 'T1')
    const byIdLower = await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: { ...J, 'X-Sbot-Token': token }, body: '{"tab":"t2"}' })
    assert.equal(byIdLower.status, 200, byIdLower.body); assert.equal(JSON.parse(byIdLower.body).target, 'T2')
    // 绑了标签页的票:只看得到那一页,碰别的页 403
    const ck = cookieOf(await claim(port, ticketOf(j.url)))
    const H = { Cookie: ck, 'X-Forwarded-For': '203.0.113.9' }
    const t = JSON.parse((await rawReq(port, { path: '/api/browser/targets', headers: H })).body)
    assert.equal(t.bound, 'T1'); assert.deepEqual(t.targets.map((x) => x.id), ['T1'])
    assert.equal((await rawReq(port, { path: '/api/browser/stream?id=T2', headers: H })).status, 403)
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/input', headers: { ...H, ...J }, body: '{"id":"T2","events":[{"t":"tap","x":1,"y":1}]}' })).status, 403)
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/targets/activate', headers: { ...H, ...J }, body: '{"id":"T2"}' })).status, 403)
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/input', headers: { ...H, ...J }, body: '{"id":"T1","events":[{"t":"tap","x":1,"y":1}]}' })).status, 200, '自己那一页照常')
  })
})

test('browser: 推流 —— meta 先到,seed 帧与真帧带视口尺寸;断开后审计一条 takeover-stream 并停流', async () => {
  const cdp = fakeCdp()
  await withServer(CFG, async ({ port, token, audit }) => {
    const r = await rawReq(port, { path: '/api/browser/stream?id=T1&w=480&q=50', headers: { 'X-Sbot-Token': token }, onChunk: (b) => b.split('event: frame').length >= 3 })
    assert.equal(r.status, 200); assert.match(r.headers['content-type'], /text\/event-stream/); assert.equal(r.headers['x-accel-buffering'], 'no')
    const events = r.body.trim().split('\n\n').map((c) => { const ev = c.match(/^event: (\w+)/m)[1]; const data = JSON.parse(c.match(/^data: (.*)$/m)[1]); return { ev, data } })
    assert.equal(events[0].ev, 'meta'); assert.equal(events[0].data.url, 'https://example.com/verify'); assert.equal(events[0].data.mode, 'admin')
    assert.equal(events[1].ev, 'frame'); assert.equal(events[1].data.seed, true); assert.equal(events[1].data.w, 1280); assert.equal(events[1].data.b64, 'U0VFRA==')
    assert.equal(events[2].ev, 'frame'); assert.equal(events[2].data.seed, false); assert.equal(events[2].data.b64, 'RjE=')
    assert.deepEqual(cdp.calls.find((c) => c[0] === 'screencast'), ['screencast', 480, 50])
    assert.ok(await until(() => cdp.calls.some((c) => c[0] === 'stop')), '客户端断开要停流')
    const a = (await audit(1)).find((x) => x.kind === 'takeover-stream')
    assert.ok(a); assert.equal(a.frames, 2); assert.equal(a.target, 'T1'); assert.equal(a.by, 'admin')
    assert.equal(a.b64, undefined, '帧内容不进审计')
  }, { cdp })
})

test('browser: 同一标签页两个人看 —— 开流一次、后来者补首帧、一人走了另一人照收、最后一人走了才停流', async () => {
  const cdp = fakeCdp()
  await withServer(CFG, async ({ port, token }) => {
    const H = { 'X-Sbot-Token': token }
    const A = await openStream(port, '/api/browser/stream?id=T1&w=640', H)
    assert.ok(await until(() => A.frames() >= 2), 'A 收到 seed + 一帧')
    const B = await openStream(port, '/api/browser/stream?id=T1&w=480', H)
    assert.ok(await until(() => B.frames() >= 1), 'B 收到自己的首帧')
    assert.equal(cdp.calls.filter((c) => c[0] === 'screencast').length, 1, '开流只开一次')
    assert.deepEqual(cdp.calls.find((c) => c[0] === 'seed'), ['seed', 480], '后来者按自己的尺寸补首帧')
    await cdp.onFrame({ data: 'RjI=', meta: { deviceWidth: 1280, deviceHeight: 720 } })
    assert.ok(await until(() => A.frames() >= 3 && B.frames() >= 2), '一帧发给两个人')
    A.close()
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(cdp.calls.some((c) => c[0] === 'stop'), false, 'A 走了不能停流 —— B 还在看')
    await cdp.onFrame({ data: 'RjM=', meta: { deviceWidth: 1280, deviceHeight: 720 } })
    assert.ok(await until(() => B.frames() >= 3), 'B 照常收帧')
    B.close()
    assert.ok(await until(() => cdp.calls.filter((c) => c[0] === 'stop').length === 1), '最后一人走了才停流,且只停一次')
  }, { cdp })
})

test('browser: 输入 / 新开标签 / 切前台;浏览器没起来时接口说人话不炸;宽度与质量越界收编', async () => {
  const cdp = fakeCdp()
  await withServer(CFG, async ({ port, token }) => {
    const H = { 'X-Sbot-Token': token, ...J }
    const inp = await rawReq(port, { method: 'POST', path: '/api/browser/input', headers: H, body: JSON.stringify({ id: 'T1', events: [{ t: 'tap', x: 1, y: 2 }, { t: 'text', text: '237367' }] }) })
    assert.equal(inp.status, 200); assert.equal(JSON.parse(inp.body).sent, 2)
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/input', headers: H, body: '{"id":"T1"}' })).status, 400)
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/input', headers: H, body: '{"events":[{"t":"tap","x":1,"y":1}]}' })).status, 400)
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/targets', headers: H, body: '{"url":"javascript:alert(1)"}' })).status, 400, '只开 http(s)')
    const nt = await rawReq(port, { method: 'POST', path: '/api/browser/targets', headers: H, body: '{"url":"https://example.com/"}' })
    assert.equal(nt.status, 200); assert.equal(JSON.parse(nt.body).id, 'T9')
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/targets/activate', headers: H, body: '{"id":"T1"}' })).status, 200)
    assert.deepEqual(cdp.calls.filter((c) => c[0] !== 'input'), [['new', 'https://example.com/'], ['activate', 'T1']])
    const s = await rawReq(port, { path: '/api/browser/stream?id=T1&w=1&q=999', headers: { 'X-Sbot-Token': token }, onChunk: (b) => b.includes('event: frame') })
    assert.equal(s.status, 200); assert.deepEqual(cdp.calls.find((c) => c[0] === 'screencast'), ['screencast', 240, 90])
  }, { cdp })
  await withServer(CFG, async ({ port, token }) => {
    const t = await rawReq(port, { path: '/api/browser/targets', headers: { 'X-Sbot-Token': token } })
    assert.equal(t.status, 200); const j = JSON.parse(t.body); assert.equal(j.ok, false); assert.match(j.error, /浏览器没连上/); assert.deepEqual(j.targets, [])
    const s = await rawReq(port, { path: '/api/browser/stream?id=T1', headers: { 'X-Sbot-Token': token } })
    assert.equal(s.status, 502); assert.match(JSON.parse(s.body).error, /浏览器没连上/)
  }, { cdp: fakeCdp({ down: true }) })
})

test('browser: /browser 页对本机免密访客注入令牌、不标 TAKEOVER;没令牌也没 cookie 的外来请求两者皆空;畸形接管 cookie 不炸', async () => {
  await withServer(LAN, async ({ port, token }) => {
    const p = await rawReq(port, { path: '/browser' })
    assert.equal(p.status, 200); assert.match(p.body, new RegExp(`let TOKEN='${token}'`)); assert.match(p.body, /const TAKEOVER=''==='1'/)
    assert.match(p.headers['cache-control'], /no-store/)
    const q = await rawReq(port, { path: '/browser', headers: { 'X-Forwarded-For': '203.0.113.9' } })
    assert.match(q.body, /let TOKEN='';/); assert.match(q.body, /const TAKEOVER=''==='1'/)
    assert.doesNotMatch(q.body, new RegExp(token), '带反代头的请求不注入免密令牌')
    for (const path2 of ['/', '/browser', '/api/state']) assert.notEqual((await rawReq(port, { path: path2, headers: { Cookie: 'sbot-takeover=%' } })).status, 500, path2 + ':畸形 cookie 不能把整站打成 500')
  }, { lan: true })
})

// 用户面零工具名(CONTRIBUTING.md):接管页与失效文案都是群成员看得见的。
// 对照组:故意写一句违规的串必须被同一条正则抓到,否则正则本身没分辨力。
test('browser: 接管页与失效文案零工具名 / 零机器路径(storage 键名与请求头名除外)', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'browser.html'), 'utf8')
  // 只看人看得见的部分:标签体文字 + title/placeholder/aria-label 属性 + 脚本里的字符串字面量;剔掉 storage 键 / 请求头名这两类边界
  const visible = [...html.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]).concat([...html.matchAll(/(?:title|placeholder|aria-label)="([^"]*)"/g)].map((m) => m[1])).concat([...html.matchAll(/'([^'\n]{4,})'/g)].map((m) => m[1])).join('\n')
  const bad = /\bsbot\b(?!-token|-theme|-takeover)|~\/\.sbot|\/Users\/|SBOT_[A-Z_]+|X-Sbot-Token/i
  // 边界:storage 键 / 请求头名 / 服务端替换掉的两个占位符(__SBOT_TOKEN__ / __SBOT_TAKEOVER__ 到浏览器前已被换成值)
  const hits = visible.split('\n').filter((l) => bad.test(l) && !/X-Sbot-Token|sbot-token|sbot-theme|sbot-takeover|__SBOT_/.test(l))
  assert.deepEqual(hits, [], '接管页可见文案里出现了工具名 / 路径')
  assert.ok(bad.test('去跑 sbot browser link'), '对照组:正则要抓得到违规串')
  assert.ok(/接管|浏览器/.test(visible), '对照组:确实扫到了可见文案')
  await withServer(CFG, async ({ port }) => {
    const r = await claim(port, 'deadbeef')
    assert.equal(r.status, 410); const msg = JSON.parse(r.body).error; assert.equal(bad.test(msg), false, '失效文案零工具名'); assert.match(msg, /机器人/)
  })
})

// hidden 属性只靠浏览器默认样式撑着,任何一条写了 display 的规则都会把它覆盖(真机截图逮到:群成员看到了只给管理员的「控制台」链接)。
// 钉一条全局兜底存在;对照组:去掉它,a.back 那条 display:inline-flex 就会把 hidden 顶掉。
test('browser: 接管页 CSS 必须有全局 [hidden]{display:none!important} 兜底 —— 否则写了 display 的元素 hidden 失效', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'browser.html'), 'utf8')
  const css = html.split('<style>')[1].split('</style>')[0]
  assert.match(css, /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/, '缺全局 [hidden] 兜底')
  // 对照组:确实存在会覆盖 hidden 的规则(否则这条测试防的是不存在的东西)
  const risky = [...css.matchAll(/([^{}]+)\{[^}]*\bdisplay\s*:\s*(?!none)[^;}]+/g)].map((m) => m[1].trim()).filter((s) => /\.back|#back/.test(s))
  assert.ok(risky.length >= 1, `对照组:a.back 应有一条写 display 的规则,实际 ${risky.length}`)
})

test('browser: mint 回票 id 与页面标题 / 网址;attach 把卡挂到票上(门同 link:要 X-Sbot-Local 或管理员);兑换时 onTakeoverClaim 收到卡的元数据;点「结束」onTakeoverEnd 收到同一份', async () => {
  const claimed = [], ended = []
  const dir = tmpDir(); const cfgPath = path.join(dir, 'sbot.config.json'); fs.writeFileSync(cfgPath, JSON.stringify(CFG))
  const ui = createUiServer({ configPath: cfgPath, sessionsPath: path.join(dir, 's.json'), auditPath: path.join(dir, 'a.jsonl'), log: () => {}, cdpImpl: fakeCdp(), onTakeoverClaim: (m) => claimed.push(m), onTakeoverEnd: (m, o) => ended.push([m, o]) })
  const port = await new Promise((r) => ui.listen(0, '127.0.0.1', () => r(ui.server.address().port)))
  try {
    const mint = JSON.parse((await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: LOCAL, body: '{"tab":"example"}' })).body)
    assert.match(mint.id, /^[0-9a-f]{12}$/); assert.equal(mint.pageTitle, '安全验证'); assert.equal(mint.pageUrl, 'https://example.com/verify')
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/link/attach', headers: J, body: JSON.stringify({ id: mint.id, card: { cardId: 'c1' } }) })).status, 401, 'attach 与 link 同一道门:不带 X-Sbot-Local 不算本机')
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/link/attach', headers: LOCAL, body: JSON.stringify({ id: 'nope', card: { cardId: 'c1' } }) })).status, 404)
    const at = await rawReq(port, { method: 'POST', path: '/api/browser/link/attach', headers: LOCAL, body: JSON.stringify({ id: mint.id, card: { cardId: 'card-9', chatId: 'oc_t', pageTitle: mint.pageTitle, pageUrl: mint.pageUrl, minutes: 10 } }) })
    assert.equal(at.status, 200, at.body)
    assert.equal(claimed.length, 0)
    const use = await claim(port, ticketOf(mint.url)); assert.equal(use.status, 200)
    const metaExp = { cardId: 'card-9', chatId: 'oc_t', pageTitle: '安全验证', pageUrl: 'https://example.com/verify', minutes: 10 }
    assert.deepEqual(claimed, [metaExp], '兑换时把卡的元数据交给 daemon 翻卡'); assert.equal(ended.length, 0)
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/end', headers: { Cookie: cookieOf(use), 'X-Forwarded-For': '203.0.113.9', ...J }, body: '{}' })).status, 200)
    assert.deepEqual(ended, [[metaExp, { reason: 'ended' }]], '点「结束接管」⇒ daemon 收到同一份元数据翻「已结束」(真机:结束后卡还挂着「正在接管中」)')
  } finally { ui.close(); await rmTmpDir(dir) }
})

// 提示层 pointer-events:none 让手势穿过画面,层里的可点元素要逐个放开 —— 只放 a 没放 button 就是真机上「点开始接管没反应」。
// 钉:放开规则必须同时覆盖 a 与 button。对照组:none 那条确实存在(否则防的是不存在的东西)。
test('browser: 提示层里的 button 必须放开 pointer-events(真机:手指点「开始接管」穿透无反应)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'browser.html'), 'utf8').split('<style>')[1].split('</style>')[0]
  assert.match(css, /#hint\{[^}]*pointer-events\s*:\s*none/, '对照组:提示层本身是 pointer-events:none')
  assert.match(css, /#hint a\s*,\s*#hint button\s*\{[^}]*pointer-events\s*:\s*auto/, '层里的 a 与 button 都要放开')
})

test('browser: 接管者的推流跟着会话走 —— 自己点「结束」当场断;「退出所有设备」断掉所有接管者、管理员的不受影响;到期也断', async () => {
  // 拨钟:票据库的钟比真钟慢「默认 TTL - 300ms」⇒ 签出的票 exp 在真钟上只剩 300ms(TTL 下限 1 分钟,不拨钟等不起)
  const skew = takeover.DEFAULT_TTL_MS - 300
  await withServer(LAN, async ({ port, token, audit }) => {
    const mintOne = async () => cookieOf(await claim(port, ticketOf(JSON.parse((await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: LOCAL, body: '{}' })).body).url)))
    const hdr = (ck) => ({ Cookie: ck, 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https' })
    // ① 自己结束
    const ck = await mintOne()
    const A = await openStream(port, '/api/browser/stream?id=T1&w=480', hdr(ck))
    assert.equal(A.status, 200); assert.ok(await until(() => A.frames() >= 2), '接管者收到帧'); assert.equal(A.ended, false)
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/end', headers: { ...hdr(ck), ...J }, body: '{}' })).status, 200)
    assert.ok(await until(() => A.ended), '结束接管 ⇒ 服务端把这路推流断掉(页面重连才会撞 401 翻成「已到期」)')
    assert.equal((await openStream(port, '/api/browser/stream?id=T1', hdr(ck))).status, 401, '断掉后同一 cookie 再开流不认')
    assert.ok((await audit(6)).some((x) => x.kind === 'takeover-stream'), '被断掉的推流照样落一条审计')
    // ② 退出所有设备:两个接管者一起断,管理员自己那路不动(对照组)
    const [ck2, ck3] = [await mintOne(), await mintOne()]
    const B = await openStream(port, '/api/browser/stream?id=T1&w=480', hdr(ck2)); const C = await openStream(port, '/api/browser/stream?id=T1&w=480', hdr(ck3))
    const D = await openStream(port, '/api/browser/stream?id=T1&w=480', { 'X-Sbot-Token': token })
    assert.ok(await until(() => B.frames() >= 1 && C.frames() >= 1 && D.frames() >= 1))
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/logout/all', headers: { ...J, 'X-Sbot-Token': token }, body: '{}' })).status, 200)
    assert.ok(await until(() => B.ended && C.ended), '两个接管者的推流都断了')
    await new Promise((r) => setTimeout(r, 60)); assert.equal(D.ended, false, '管理员的推流不受「退出所有设备」影响'); D.close()
  }, { lan: true })
  // ③ 到期:票在真钟上 300ms 后到期 ⇒ 开着的推流到点自己断
  await withServer(LAN, async ({ port }) => {
    const ck = cookieOf(await claim(port, ticketOf(JSON.parse((await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: LOCAL, body: '{}' })).body).url)))
    const E = await openStream(port, '/api/browser/stream?id=T1&w=480', { Cookie: ck, 'X-Forwarded-For': '203.0.113.9' })
    assert.equal(E.status, 200); assert.ok(await until(() => E.frames() >= 1))
    assert.ok(await until(() => E.ended, 1500), '会话到期 ⇒ 推流到点断掉,而不是一张 10 分钟的票能看一整天')
  }, { lan: true, takeoverNow: () => Date.now() - skew })
})

test('browser: 接管页缩放控件 —— 在顶栏不在画面里(没画面时靠 body.streaming 藏)、三个键、模式键三态、两指手势与延迟 down 的关键判据都在', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/ui/browser.html'), 'utf8')
  assert.doesNotMatch(html, /#frame:not\(\[src\]\)~#zoom/, '旧的兄弟选择器不能残留(它要求 #zoom 在画面区里)')
  assert.match(html, /body:not\(\.streaming\) #zoom\{display:none\}/, '没画面时缩放控件藏起来(靠 body.streaming,不再靠画面元素的兄弟选择器)')
  assert.ok(html.indexOf('id="zoom"') < html.indexOf('<main id="stage"'), '缩放控件在顶栏、不在画面区里 —— 浮在画面右上角会压住网页自己右上角的按钮(比如搜索首页的「设置 / 登录」)')
  assert.match(html, /#zoom \[data-z\]\{display:none\}/, '窄屏只留「100%」一枚,− / + 只给桌面')
  assert.match(html, /data-z="out"/); assert.match(html, /data-z="in"/); assert.match(html, /id="zoomv"/)
  assert.match(html, /const MODES=\{tap:'点按',scroll:'滚动',pan:'移动'\}/, '模式键三态')
  assert.match(html, /ptrs\.size===2/, '两指进手势'); assert.match(html, /setTimeout\(commitDown,120\)/, '一指按下延迟 120ms 才发 down —— 捏合的第二指落下时页面不该收到点击')
  assert.match(html, /const STREAM_W_MAX=1024;/, '推流宽度上限 1024:帧和输入共用一条公网隧道,桌面按 1440~1600 要帧会把输入饿到每个事件 1.7~2 秒')
  assert.match(html, /pendingMoves\.push\(\{t:'move'/, 'move 攒全部中间点整批发:此前只留最后一个,隧道下 30 步拖动只到 5 个点、轨迹成跳跃')
  assert.doesNotMatch(html, /pendingMove[=)}]/, '单点覆盖的旧写法不能残留')
  assert.match(html, /transform-origin:0 0/, '变换以左上为原点,坐标换算靠 getBoundingClientRect 读变换后矩形')
  assert.match(html, /if\(e\.isPrimary\)\{ if\(down&&lastP\) push\(\{t:'up'/, 'primary 指针按下时清幽灵指针,且上一次没等到 up 的 down 要先补一个 up 松开远端鼠标')
  assert.match(html, /overflow:hidden;touch-action:none/, 'stage 自己管平移、禁掉浏览器原生手势')
  assert.equal(/scrollMode/.test(html), false, '旧的两态开关已被三态模式替掉')
})

test('browser: 推流还在等 CDP 建会话时就被「结束」—— 那一路也要断,且建好的会话引用要放掉(真机:agent 忙着截图时结束会话,画面照流到票到期)', async () => {
  const cdp = fakeCdp()
  // 建会话慢 250ms:模拟 CDP 忙(同一标签页正被 agent 截图)
  const Slow = class extends cdp.CdpSession { async connect() { await new Promise((r) => setTimeout(r, 250)); return super.connect() } }
  cdp.CdpSession = Slow
  await withServer(LAN, async ({ port, ui }) => {
    const ck = cookieOf(await claim(port, ticketOf(JSON.parse((await rawReq(port, { method: 'POST', path: '/api/browser/link', headers: LOCAL, body: '{}' })).body).url)))
    const H = { Cookie: ck, 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https' }
    // ⚠ 不能用 openStream:它等响应头,而 SSE 的头在 acquire 之后才写 ⇒ 等到头就已经错过了要测的窗口
    const A = { ended: false, status: 0 }
    const rq = http.request({ host: '127.0.0.1', port, path: '/api/browser/stream?id=T1&w=480', headers: H }, (res) => { A.status = res.statusCode; res.on('data', () => {}); res.on('end', () => { A.ended = true }) }); rq.on('error', () => { A.ended = true }); rq.end()
    await new Promise((r) => setTimeout(r, 40)) // 请求已到服务端、acquire 还没返回
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/browser/end', headers: { ...H, ...J }, body: '{}' })).status, 200)
    assert.ok(await until(() => A.ended, 1500), '建会话期间收到「结束」⇒ 这一路也断,不能等到票到期')
    assert.equal(cdp.calls.some((c) => c[0] === 'screencast'), false, '断掉的这一路不该再开流')
    await new Promise((r) => setTimeout(r, 400)) // 让慢 connect 回来
    const reg = ui._browserRoutes._registry.get('T1')
    assert.ok(!reg || reg.refs === 0, '建好的会话引用已放掉(refs 0 ⇒ 30 秒闲置会关);否则这条 CDP 会话永远挂着')
  }, { cdp, lan: true })
})

test('browser: 带票的链接一律走接管流程 —— 浏览器里存着控制台令牌也不能把它顶掉(真机:电脑上既没有「开始接管」也没有「结束接管」,还 unauthorized)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../src/ui/browser.html'), 'utf8')
  const tAt = html.indexOf('const ticket='), admAt = html.indexOf('const ADMIN=')
  assert.ok(tAt > 0 && admAt > tAt, '票要在 ADMIN 之前算出来 —— 否则存着的令牌先把身份定死,票根本没机会说话')
  assert.equal((html.match(/const ticket=/g) || []).length, 1, '票只算一处')
  assert.match(html, /if\(ticket\|\|TAKEOVER\) TOKEN=''/, '有票、或人已在接管会话里 ⇒ 丢掉存着的令牌,按接管走')
  assert.match(html, /r\.status===401&&ADMIN\)\{ try\{localStorage\.removeItem\('sbot-token'\)/, '管理员令牌失效 ⇒ 清掉并请人重新登录,别留一个连不上的死页面')
})
