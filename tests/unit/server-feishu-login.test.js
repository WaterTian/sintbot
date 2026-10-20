// 控制台「用飞书登录」的服务端链路(假飞书):起跳 302 → 回调换令牌 → 名单放行 / 拒绝 → 会话落盘重启仍在 → 登出。
// 也钉住:页面注入的开关、/api/state 里的就绪态与回调地址、公网地址接口的校验、未鉴权白名单只多这两条。
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createUiServer } = require('../../src/ui/server')
const { hashPassword } = require('../../src/ui/auth')
const fl = require('../../src/ui/feishulogin')
const { waitAudit } = require('./auditlog')

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-fl-')) }
function listen(ui) { return new Promise((resolve) => ui.listen(0, '127.0.0.1', () => resolve(ui.server.address().port))) }
function req(port, { method = 'GET', path: p = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }))
    })
    r.on('error', reject); if (body) r.write(body); r.end()
  })
}

const CFG = (over = {}) => JSON.stringify({
  agent: { maxConcurrent: 1 }, providers: { claude: {} }, groups: {},
  ui: { auth: hashPassword('pw-123456'), publicUrl: 'https://cb.example.com' },
  feishu: { appId: 'cli_test', appSecret: 'sec_test', admins: [{ openId: 'ou_admin', name: '王五' }] },
  ...over,
})

// 假飞书:换 token 与取身份两个端点;按 code 决定身份,记录收到的请求
function fakeFeishu(log = []) {
  return async (url, init) => {
    log.push({ url: String(url), init })
    const ok = (json) => ({ status: 200, json: async () => json })
    if (String(url) === fl.TOKEN_URL) {
      const b = JSON.parse(init.body)
      if (b.code === 'code-admin') return ok({ code: 0, access_token: 'u-admin' })
      if (b.code === 'code-stranger') return ok({ code: 0, access_token: 'u-stranger' })
      return ok({ code: 20001, error: 'invalid_grant', error_description: '授权码无效' })
    }
    if (String(url) === fl.USERINFO_URL) {
      const t = init.headers.Authorization
      if (t === 'Bearer u-admin') return ok({ code: 0, data: { open_id: 'ou_admin', name: '王五' } })
      if (t === 'Bearer u-stranger') return ok({ code: 0, data: { open_id: 'ou_nobody', name: '路人' } })
    }
    throw new Error('unexpected ' + url)
  }
}

async function boot(cfgJson, extra = {}) {
  const dir = tmpDir(); const cfgPath = path.join(dir, 'sbot.config.json'); fs.writeFileSync(cfgPath, cfgJson)
  const sessionsPath = path.join(dir, 'ui-sessions.json')
  const calls = []
  const auditPath = path.join(dir, 'audit.jsonl')
  const ui = createUiServer({ configPath: cfgPath, sessionsPath, auditPath, fetchImpl: fakeFeishu(calls), log: () => {}, ...extra })
  const port = await listen(ui)
  return { ui, port, cfgPath, sessionsPath, auditPath, calls, dir }
}

test('页面开关:三样齐 ⇒ 注入 1;缺公网地址 ⇒ 注入空(登录页不出按钮)', async () => {
  const a = await boot(CFG())
  try { const p = await req(a.port, { path: '/' }); assert.match(p.body, /const FEISHU_LOGIN='1'/) } finally { a.ui.close() }
  const b = await boot(CFG({ ui: { auth: hashPassword('pw-123456') } }))
  try { const p = await req(b.port, { path: '/' }); assert.match(p.body, /const FEISHU_LOGIN=''/) } finally { b.ui.close() }
})

test('起跳:302 到飞书授权页,带 client_id / 已登记的回调 / 一次性 state;没配好 ⇒ 400 且说缺哪样', async () => {
  const a = await boot(CFG())
  try {
    const r = await req(a.port, { path: fl.START_PATH })
    assert.equal(r.status, 302)
    const u = new URL(r.headers.location)
    assert.equal(u.origin + u.pathname, 'https://accounts.feishu.cn/open-apis/authen/v1/authorize')
    assert.equal(u.searchParams.get('client_id'), 'cli_test')
    assert.equal(u.searchParams.get('redirect_uri'), 'https://cb.example.com/api/auth/feishu/callback')
    assert.match(u.searchParams.get('state'), /^[0-9a-f]{32}$/)
  } finally { a.ui.close() }
  const b = await boot(CFG({ feishu: { appId: 'cli_test', appSecret: 'sec_test', admins: [] } }))
  try {
    const r = await req(b.port, { path: fl.START_PATH })
    assert.equal(r.status, 400)
    assert.match(r.body, /管理员名单为空/)
    assert.doesNotMatch(r.body, /setItem/)
  } finally { b.ui.close() }
})

test('回调:名单里的人 ⇒ 200 落地页带 48 位令牌,令牌能用;state 只能用一次;名单外 ⇒ 403 无令牌;换 token 失败 ⇒ 502', async () => {
  const a = await boot(CFG())
  try {
    const start = await req(a.port, { path: fl.START_PATH })
    const state = new URL(start.headers.location).searchParams.get('state')
    // 假 state 先撞一下:400,且不去碰飞书
    const bad = await req(a.port, { path: `${fl.CALLBACK_PATH}?code=code-admin&state=nope` })
    assert.equal(bad.status, 400); assert.equal(a.calls.length, 0)
    // 真 state + 管理员
    const ok = await req(a.port, { path: `${fl.CALLBACK_PATH}?code=code-admin&state=${state}` })
    assert.equal(ok.status, 200)
    const m = ok.body.match(/localStorage\.setItem\('sbot-token','([0-9a-f]{48})'\)/)
    assert.ok(m, '落地页要把令牌写进浏览器')
    assert.match(ok.body, /王五/)
    assert.equal(a.calls.length, 2, '换 token + 取身份各一次')
    assert.deepEqual(JSON.parse(a.calls[0].init.body), { grant_type: 'authorization_code', client_id: 'cli_test', client_secret: 'sec_test', code: 'code-admin', redirect_uri: 'https://cb.example.com/api/auth/feishu/callback' })
    const st = await req(a.port, { path: '/api/state', headers: { 'x-sbot-token': m[1] } })
    assert.equal(st.status, 200, '飞书签发的令牌与密码签发的走同一条鉴权')
    // 同一个 state 再用一次:拒绝
    const replay = await req(a.port, { path: `${fl.CALLBACK_PATH}?code=code-admin&state=${state}` })
    assert.equal(replay.status, 400)
    // 名单外的人:授权成功也进不来
    const s2 = new URL((await req(a.port, { path: fl.START_PATH })).headers.location).searchParams.get('state')
    const no = await req(a.port, { path: `${fl.CALLBACK_PATH}?code=code-stranger&state=${s2}` })
    assert.equal(no.status, 403)
    assert.match(no.body, /路人/); assert.match(no.body, /不在这台机器的管理员名单里/)
    assert.doesNotMatch(no.body, /setItem/)
    // 换 token 失败:502 + 人话
    const s3 = new URL((await req(a.port, { path: fl.START_PATH })).headers.location).searchParams.get('state')
    const bad2 = await req(a.port, { path: `${fl.CALLBACK_PATH}?code=code-bogus&state=${s3}` })
    assert.equal(bad2.status, 502); assert.match(bad2.body, /授权码无效/)
    // 没带 code
    const s4 = new URL((await req(a.port, { path: fl.START_PATH })).headers.location).searchParams.get('state')
    assert.equal((await req(a.port, { path: `${fl.CALLBACK_PATH}?state=${s4}` })).status, 400)
  } finally { a.ui.close() }
})

test('会话落盘:飞书登录的令牌在「重启」后仍有效;登出后失效且落盘', async () => {
  const a = await boot(CFG())
  let token
  try {
    const state = new URL((await req(a.port, { path: fl.START_PATH })).headers.location).searchParams.get('state')
    const ok = await req(a.port, { path: `${fl.CALLBACK_PATH}?code=code-admin&state=${state}` })
    token = ok.body.match(/'([0-9a-f]{48})'/)[1]
    assert.ok(fs.existsSync(a.sessionsPath), '令牌要落盘')
  } finally { a.ui.close() }
  // 同一份配置 + 同一份会话文件 ⇒ 模拟守护进程重启
  const ui2 = createUiServer({ configPath: a.cfgPath, sessionsPath: a.sessionsPath, log: () => {} })
  const port2 = await listen(ui2)
  try {
    assert.equal((await req(port2, { path: '/api/state', headers: { 'x-sbot-token': token } })).status, 200, '重启不登出')
    assert.equal((await req(port2, { method: 'POST', path: '/api/logout', headers: { 'x-sbot-token': token } })).status, 200)
    assert.equal((await req(port2, { path: '/api/state', headers: { 'x-sbot-token': token } })).status, 401, '登出即失效')
    assert.equal((await req(port2, { method: 'POST', path: '/api/logout' })).status, 401, '登出本身要令牌(否则谁都能登出别人?不 —— 令牌就是身份,没令牌无从登出)')
  } finally { ui2.close() }
  const ui3 = createUiServer({ configPath: a.cfgPath, sessionsPath: a.sessionsPath, log: () => {} })
  const port3 = await listen(ui3)
  try { assert.equal((await req(port3, { path: '/api/state', headers: { 'x-sbot-token': token } })).status, 401, '登出也落盘') } finally { ui3.close() }
})

test('密码登录签发的令牌同样落盘,重启仍在', async () => {
  const a = await boot(CFG())
  let token
  try {
    const r = await req(a.port, { method: 'POST', path: '/api/login', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'pw-123456' }) })
    assert.equal(r.status, 200); token = JSON.parse(r.body).token; assert.match(token, /^[0-9a-f]{48}$/)
  } finally { a.ui.close() }
  const ui2 = createUiServer({ configPath: a.cfgPath, sessionsPath: a.sessionsPath, log: () => {} })
  const port2 = await listen(ui2)
  try { assert.equal((await req(port2, { path: '/api/state', headers: { 'x-sbot-token': token } })).status, 200) } finally { ui2.close() }
})

test('/api/state 报就绪态与回调地址;公网地址接口只认 https://host,存归一值,空即删', async () => {
  const a = await boot(CFG())
  try {
    const tok = JSON.parse((await req(a.port, { method: 'POST', path: '/api/login', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'pw-123456' }) })).body).token
    const h = { 'x-sbot-token': tok, 'Content-Type': 'application/json' }
    let st = JSON.parse((await req(a.port, { path: '/api/state', headers: h })).body)
    assert.equal(st.net.publicUrl, 'https://cb.example.com')
    assert.deepEqual(st.net.feishuLogin, { ready: true, why: '', redirectUri: 'https://cb.example.com/api/auth/feishu/callback' })
    const bad = await req(a.port, { method: 'POST', path: '/api/ui/public-url', headers: h, body: JSON.stringify({ publicUrl: 'http://plain.example.com' }) })
    assert.equal(bad.status, 400); assert.match(JSON.parse(bad.body).error, /https/)
    const good = await req(a.port, { method: 'POST', path: '/api/ui/public-url', headers: h, body: JSON.stringify({ publicUrl: ' https://ca.example.com:8443/some/path ' }) })
    assert.equal(good.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(a.cfgPath, 'utf8')).ui.publicUrl, 'https://ca.example.com:8443')
    assert.equal(JSON.parse(good.body).net.feishuLogin.redirectUri, 'https://ca.example.com:8443/api/auth/feishu/callback')
    const clear = await req(a.port, { method: 'POST', path: '/api/ui/public-url', headers: h, body: JSON.stringify({ publicUrl: '' }) })
    assert.equal(clear.status, 200)
    assert.equal('publicUrl' in (JSON.parse(fs.readFileSync(a.cfgPath, 'utf8')).ui || {}), false)
    st = JSON.parse(clear.body); assert.equal(st.net.feishuLogin.ready, false); assert.match(st.net.feishuLogin.why, /公网地址/)
    // 密码 hash 没被公网地址接口碰掉
    assert.ok(JSON.parse(fs.readFileSync(a.cfgPath, 'utf8')).ui.auth.startsWith('scrypt$'))
  } finally { a.ui.close() }
})

test('未鉴权白名单只多了起跳与回调两条;其它 /api/auth/* 形状的路径照样 401', async () => {
  const a = await boot(CFG())
  try {
    assert.equal((await req(a.port, { path: '/api/auth/feishu/other' })).status, 401)
    assert.equal((await req(a.port, { path: '/api/auth/feishu/start/../../state' })).status, 401)
    assert.equal((await req(a.port, { method: 'POST', path: fl.START_PATH })).status, 401, '起跳只认 GET')
  } finally { a.ui.close() }
})

async function feishuToken(a, code = 'code-admin') {
  const state = new URL((await req(a.port, { path: fl.START_PATH })).headers.location).searchParams.get('state')
  const r = await req(a.port, { path: `${fl.CALLBACK_PATH}?code=${code}&state=${state}` })
  const m = r.body.match(/'([0-9a-f]{48})'/); return { status: r.status, token: m && m[1] }
}
// ⚠ 白盒依赖:服务端按配置文件 mtime 缓存「会话对齐」,同一秒内连改两次 mtime 不变就不会重对齐,所以把 mtime 往后拨 2 秒
const touch = (p) => { const t = new Date(Date.now() + 2000); fs.utimesSync(p, t, t) }

test('两枚令牌:登出一枚,另一枚仍 200;审计写进注入的文件而不是本机真实审计本', async () => {
  const a = await boot(CFG())
  try {
    const { token: t1 } = await feishuToken(a); const { token: t2 } = await feishuToken(a)
    assert.ok(t1 && t2 && t1 !== t2)
    assert.equal((await req(a.port, { method: 'POST', path: '/api/logout', headers: { 'x-sbot-token': t1 } })).status, 200)
    assert.equal((await req(a.port, { path: '/api/state', headers: { 'x-sbot-token': t1 } })).status, 401)
    assert.equal((await req(a.port, { path: '/api/state', headers: { 'x-sbot-token': t2 } })).status, 200, '别的设备不受影响')
    // 审计本是异步追加:等两笔飞书登录都落盘再断言(请求一回来就同步读,CI Node 20 读到过 1 条)
    const audit = (await waitAudit(a.auditPath, (rs) => rs.filter((r) => r.via === 'feishu').length >= 2)).map((r) => JSON.stringify(r)).join('\n')
    assert.equal((audit.match(/"via":"feishu"/g) || []).length, 2)
    assert.match(audit, /"openId":"ou_admin"/)
  } finally { a.ui.close() }
})

test('名单里删掉的人:旧会话在下一次请求就失效(不是 30 天);没删的人不受影响', async () => {
  const a = await boot(CFG({ feishu: { appId: 'cli_test', appSecret: 'sec_test', admins: [{ openId: 'ou_admin', name: '王五' }, { openId: 'ou_two', name: '乙' }] } }))
  try {
    const { token } = await feishuToken(a)
    assert.equal((await req(a.port, { path: '/api/state', headers: { 'x-sbot-token': token } })).status, 200)
    // 管理员把 ou_admin 删掉(直接改配置文件 = 与控制台 / CLI 改法等价的落盘结果)
    const raw = JSON.parse(fs.readFileSync(a.cfgPath, 'utf8')); raw.feishu.admins = [{ openId: 'ou_two', name: '乙' }]
    fs.writeFileSync(a.cfgPath, JSON.stringify(raw)); touch(a.cfgPath)
    assert.equal((await req(a.port, { path: '/api/state', headers: { 'x-sbot-token': token } })).status, 401, '删掉即失效')
    assert.equal(JSON.parse(fs.readFileSync(a.sessionsPath, 'utf8')).tokens[token], undefined, '吊销落盘')
  } finally { a.ui.close() }
})

test('换密码:旧密码签的会话失效,飞书签的不受影响;删掉密码也一样', async () => {
  const a = await boot(CFG())
  try {
    const pw = JSON.parse((await req(a.port, { method: 'POST', path: '/api/login', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'pw-123456' }) })).body).token
    const { token: fs1 } = await feishuToken(a)
    const raw = JSON.parse(fs.readFileSync(a.cfgPath, 'utf8')); raw.ui.auth = hashPassword('new-password'); fs.writeFileSync(a.cfgPath, JSON.stringify(raw)); touch(a.cfgPath)
    assert.equal((await req(a.port, { path: '/api/state', headers: { 'x-sbot-token': pw } })).status, 401)
    assert.equal((await req(a.port, { path: '/api/state', headers: { 'x-sbot-token': fs1 } })).status, 200)
    // 用新密码再签一枚,然后把密码整个删掉:密码签的失效,飞书签的仍在
    const pw2 = JSON.parse((await req(a.port, { method: 'POST', path: '/api/login', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'new-password' }) })).body).token
    const raw2 = JSON.parse(fs.readFileSync(a.cfgPath, 'utf8')); delete raw2.ui.auth; fs.writeFileSync(a.cfgPath, JSON.stringify(raw2)); touch(a.cfgPath)
    assert.equal((await req(a.port, { path: '/api/state', headers: { 'x-sbot-token': pw2 } })).status, 401, '删掉密码 ⇒ 密码签的全作废')
    assert.equal((await req(a.port, { path: '/api/state', headers: { 'x-sbot-token': fs1 } })).status, 200)
  } finally { a.ui.close() }
})

test('退出所有设备:两枚令牌全失效,审计记一笔', async () => {
  const a = await boot(CFG())
  try {
    const { token: t1 } = await feishuToken(a); const { token: t2 } = await feishuToken(a)
    const r = await req(a.port, { method: 'POST', path: '/api/logout/all', headers: { 'x-sbot-token': t1 } })
    assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).n, 2)
    assert.equal((await req(a.port, { path: '/api/state', headers: { 'x-sbot-token': t1 } })).status, 401)
    assert.equal((await req(a.port, { path: '/api/state', headers: { 'x-sbot-token': t2 } })).status, 401)
    // 审计本是异步追加:等到那一笔出现再断言(原先这里只等 1 秒,CI 18.17 慢机器上红过一次)
    const auditTxt = (await waitAudit(a.auditPath, (rs) => rs.some((r) => r.kind === 'ui-logout-all'))).map((r) => JSON.stringify(r)).join('\n')
    assert.match(auditTxt, /"kind":"ui-logout-all","n":2/)
    assert.equal((await req(a.port, { method: 'POST', path: '/api/logout/all' })).status, 401, '没令牌不能吊别人')
  } finally { a.ui.close() }
})

test('回调:POST 401;起跳后配置变成未就绪 ⇒ 回调 400;假飞书抛网络错 ⇒ 502 人话', async () => {
  const a = await boot(CFG())
  try {
    assert.equal((await req(a.port, { method: 'POST', path: fl.CALLBACK_PATH })).status, 401)
    const state = new URL((await req(a.port, { path: fl.START_PATH })).headers.location).searchParams.get('state')
    const raw = JSON.parse(fs.readFileSync(a.cfgPath, 'utf8')); delete raw.ui.publicUrl; fs.writeFileSync(a.cfgPath, JSON.stringify(raw))
    const r = await req(a.port, { path: `${fl.CALLBACK_PATH}?code=code-admin&state=${state}` })
    assert.equal(r.status, 400); assert.match(r.body, /未填公网地址/)
  } finally { a.ui.close() }
  const b = await boot(CFG(), { fetchImpl: async () => { throw new Error('ECONNRESET') } })
  try {
    const { status } = await feishuToken(b)
    assert.equal(status, 502)
    const state = new URL((await req(b.port, { path: fl.START_PATH })).headers.location).searchParams.get('state')
    const r = await req(b.port, { path: `${fl.CALLBACK_PATH}?code=code-admin&state=${state}` })
    assert.match(r.body, /连不上飞书/); assert.doesNotMatch(r.body, /setItem/)
  } finally { b.ui.close() }
})

test('本机环回免密的保险:带反代头(X-Forwarded-For)的环回请求不注入令牌', async () => {
  const a = await boot(CFG(), { host: '0.0.0.0' }) // 对外绑定 + 请求从 127.0.0.1 来 = localBypass 的场景
  try {
    const plain = await req(a.port, { path: '/' })
    assert.match(plain.body, /let TOKEN='[0-9a-f]{32}'/, '对照:不带反代头的本机请求照旧免密')
    const viaProxy = await req(a.port, { path: '/', headers: { 'X-Forwarded-For': '203.0.113.9' } })
    assert.match(viaProxy.body, /let TOKEN='';/, '带了反代头 ⇒ 当外人,要登录')
    const viaProto = await req(a.port, { path: '/', headers: { 'X-Forwarded-Proto': 'https' } })
    assert.match(viaProto.body, /let TOKEN='';/)
  } finally { a.ui.close() }
})
