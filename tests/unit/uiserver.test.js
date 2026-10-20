// Console server security — token auth + Host check and config
// write-back protection on a corrupted file. Uses raw node:http so
// we can forge Host headers the way a DNS-rebinding page would.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createUiServer, execShellCommand } = require('../../src/ui/server')
const { hashPassword } = require('../../src/ui/auth')

function tmpConfig(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-ui-'))
  const p = path.join(dir, 'sbot.config.json')
  fs.writeFileSync(p, content)
  return p
}

function listen(ui) {
  return new Promise((resolve) => ui.listen(0, '127.0.0.1', () => resolve(ui.server.address().port)))
}

function rawReq(port, { method = 'GET', path: reqPath = '/', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      let b = ''
      res.on('data', (c) => (b += c))
      res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}

// Boot a server on a valid config, hand the extracted page token to the test body.
async function withServer(configJson, fn) {
  const cfgPath = tmpConfig(configJson)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {} })
  const port = await listen(ui)
  const page = await rawReq(port, { path: '/' })
  const m = page.body.match(/TOKEN='([0-9a-f]{32})'/)
  try { await fn({ port, token: m && m[1], cfgPath, page }) } finally { ui.close() }
}

const VALID_CFG = JSON.stringify({ agent: { maxConcurrent: 2 }, providers: { claude: {} }, groups: {} })

test('ui: serving the page injects a 32-hex per-process token', async () => {
  await withServer(VALID_CFG, async ({ page, token }) => {
    assert.equal(page.status, 200)
    assert.ok(token, 'token placeholder must be replaced in the served HTML')
  })
})

test('ui: /api/* without the token is rejected 401', async () => {
  await withServer(VALID_CFG, async ({ port }) => {
    const r = await rawReq(port, { path: '/api/usage' })
    assert.equal(r.status, 401)
    const w = await rawReq(port, { method: 'POST', path: '/api/agent', headers: { 'Content-Type': 'application/json' }, body: '{"maxConcurrent":9}' })
    assert.equal(w.status, 401) // the CSRF write path is closed
  })
})

test('ui: /api/* with the token works — header or ?token= (EventSource path)', async () => {
  await withServer(VALID_CFG, async ({ port, token }) => {
    const h = await rawReq(port, { path: '/api/usage', headers: { 'X-Sbot-Token': token } })
    assert.equal(h.status, 200)
    const q = await rawReq(port, { path: '/api/usage?token=' + token })
    assert.equal(q.status, 200)
  })
})

// v0.11.9:模型卡额度行的「↻」。这里钉的是接线 —— 路由没被前面的 `/api/usage` 吞掉、
// 未知模型报 400 而不是 500、写路径同样要 token,以及**手点也不绕过 hidden/缺 key 的守卫**
// (零探测那条纪律在这条新入口上必须照样成立)。真实拉取的分支在 usage.test.js 里注入 probe 测。
test('ui: /api/usage/refresh 只刷一个模型 — 未知名字 400,hidden/缺 key 返回 null 且不探测,无 token 401', async () => {
  const cfg = JSON.stringify({ agent: { maxConcurrent: 2 }, providers: { claude: { hidden: true }, ds: { baseUrl: 'https://example.invalid/v1' } }, groups: {} })
  await withServer(cfg, async ({ port, token }) => {
    const post = (body, hdr = { 'X-Sbot-Token': token }) =>
      rawReq(port, { method: 'POST', path: '/api/usage/refresh', headers: { ...hdr, 'Content-Type': 'application/json' }, body })
    assert.equal((await post('{"name":"claude"}', {})).status, 401)
    assert.equal((await post('{"name":"nope"}')).status, 400)
    const hidden = await post('{"name":"claude"}')
    assert.equal(hidden.status, 200)
    assert.deepEqual(JSON.parse(hidden.body), { name: 'claude', usage: null })  // hidden ⇒ 不翻 Keychain
    assert.deepEqual(JSON.parse((await post('{"name":"ds"}')).body), { name: 'ds', usage: null }) // 缺 key ⇒ 不打网络
  })
})

test('ui: a non-loopback Host header is rejected 403 (DNS rebinding)', async () => {
  await withServer(VALID_CFG, async ({ port, token }) => {
    const r = await rawReq(port, { path: '/api/usage', headers: { 'X-Sbot-Token': token, Host: 'attacker.example:4600' } })
    assert.equal(r.status, 403)
    const page = await rawReq(port, { path: '/', headers: { Host: 'attacker.example' } })
    assert.equal(page.status, 403) // token delivery channel is gated too
  })
})

// ── console access password (LAN gating) ──────────────────────────────────────
// With a password set, the page must NOT hand out the loopback token; access flows
// through /api/login instead. Config carries a real scrypt hash.
const AUTH_CFG = JSON.stringify({ providers: { claude: {} }, groups: {}, ui: { auth: hashPassword('s3cret-pass') } })

test('ui: with a password set, the page injects an EMPTY token (login required)', async () => {
  const cfgPath = tmpConfig(AUTH_CFG)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {} })
  const port = await listen(ui)
  try {
    const page = await rawReq(port, { path: '/' })
    assert.equal(page.status, 200)
    assert.match(page.body, /let TOKEN='';/) // placeholder replaced with empty string(v0.11.72 起注入行单独一句,登录令牌另起一行从 localStorage 取)
    assert.doesNotMatch(page.body, /TOKEN='[0-9a-f]{32}'/) // no loopback token leaked
    // and the loopback token is NOT accepted implicitly — /api/* still needs a real token
    const r = await rawReq(port, { path: '/api/usage' })
    assert.equal(r.status, 401)
  } finally { ui.close() }
})

test('ui: /api/login issues a session token that then authorizes /api/*', async () => {
  const cfgPath = tmpConfig(AUTH_CFG)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {} })
  const port = await listen(ui)
  try {
    const bad = await rawReq(port, { method: 'POST', path: '/api/login', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'nope' }) })
    assert.equal(bad.status, 401)
    const ok = await rawReq(port, { method: 'POST', path: '/api/login', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 's3cret-pass' }) })
    assert.equal(ok.status, 200)
    const sess = JSON.parse(ok.body).token
    assert.match(sess, /^[0-9a-f]{48}$/)
    // session token works both as header and ?token= (EventSource path)
    assert.equal((await rawReq(port, { path: '/api/usage', headers: { 'X-Sbot-Token': sess } })).status, 200)
    assert.equal((await rawReq(port, { path: '/api/usage?token=' + sess })).status, 200)
  } finally { ui.close() }
})

test('ui: LAN bind (host 0.0.0.0) allows a private-IP Host but still blocks a public one', async () => {
  const cfgPath = tmpConfig(AUTH_CFG)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, host: '0.0.0.0', log: () => {} })
  const port = await listen(ui)
  try {
    const priv = await rawReq(port, { method: 'POST', path: '/api/login', headers: { 'Content-Type': 'application/json', Host: '192.168.1.50:' + port }, body: JSON.stringify({ password: 's3cret-pass' }) })
    assert.equal(priv.status, 200) // private LAN Host accepted
    const pub = await rawReq(port, { path: '/', headers: { Host: 'attacker.example' } })
    assert.equal(pub.status, 403) // public host (DNS rebinding) still blocked
  } finally { ui.close() }
})

test('ui: LAN bind + password — a loopback request still gets the token (本机免密)', async () => {
  // Binding to 0.0.0.0 forces a password (to gate LAN visitors), but opening the console
  // from 127.0.0.1 on the same machine must NOT be gated by it. The test client connects
  // over loopback → remoteAddress is 127.0.0.1 → the real token is injected, and it
  // authorizes /api/* with no login. (A non-loopback/LAN request still falls back to the
  // login form — that path is verified on a real LAN, not reachable from this local harness.)
  const cfgPath = tmpConfig(AUTH_CFG)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, host: '0.0.0.0', log: () => {} })
  const port = await listen(ui)
  try {
    const page = await rawReq(port, { path: '/' })
    assert.equal(page.status, 200)
    const m = page.body.match(/TOKEN='([0-9a-f]{32})'/)
    assert.ok(m, 'a loopback request under LAN bind must receive the real token (免密)')
    assert.equal((await rawReq(port, { path: '/api/usage', headers: { 'X-Sbot-Token': m[1] } })).status, 200)
  } finally { ui.close() }
})

test('ui: execShellCommand forces UTF-8 codepage on Windows (fixes GBK mojibake), no-op elsewhere', () => {
  assert.equal(execShellCommand('claude mcp add x', 'win32'), 'chcp 65001>nul & claude mcp add x')
  assert.equal(execShellCommand('claude mcp add x', 'darwin'), 'claude mcp add x')
  assert.equal(execShellCommand('claude mcp add x', 'linux'), 'claude mcp add x')
})

test('ui: overview health adds a Codex CLI row only when a codex provider is configured', async () => {
  // no codex provider → Claude CLI row, no Codex CLI row (与 doctor 一致)
  await withServer(VALID_CFG, async ({ port, token }) => {
    const s = JSON.parse((await rawReq(port, { path: '/api/state', headers: { 'X-Sbot-Token': token } })).body)
    assert.ok(s.health.rows.some((r) => r.label === 'Claude CLI'), 'Claude CLI 行恒在')
    assert.ok(!s.health.rows.some((r) => r.label === 'Codex CLI'), '无 codex provider ⇒ 无 Codex CLI 行')
  })
  // codex provider present → a Codex CLI row appears (probe 可失败/codex 未装,行仍在);可用模型标「含 Codex」
  const CODEX_CFG = JSON.stringify({ agent: { maxConcurrent: 2 }, providers: { claude: {}, gpt: { runner: 'codex', model: 'gpt-5.5' } }, groups: {} })
  await withServer(CODEX_CFG, async ({ port, token }) => {
    const s = JSON.parse((await rawReq(port, { path: '/api/state', headers: { 'X-Sbot-Token': token } })).body)
    assert.ok(s.health.rows.some((r) => r.label === 'Codex CLI'), 'codex provider ⇒ Codex CLI 健康行')
    assert.match(s.health.rows.find((r) => r.label === '可用模型').detail, /含 Codex/)
  })
})

// 项目级插件/技能进群行(v0.11.2):群卡摘要不点开也看得见 workdir 自带的 MCP 与技能。
// 无声明的 workdir 给空数组(不给 null —— 前端直接 .mcp.length 不判空)。
test('ui: /api/state group rows carry project-level MCP + skills (proj, v0.11.2)', async () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-proj-'))
  fs.writeFileSync(path.join(wd, '.mcp.json'), JSON.stringify({ mcpServers: { 'wechat-devtools': { command: 'uvx' }, cloudbase: { command: 'sh' } } }))
  fs.mkdirSync(path.join(wd, '.claude', 'skills', 'cloudbase'), { recursive: true })
  fs.writeFileSync(path.join(wd, '.claude', 'skills', 'cloudbase', 'SKILL.md'), '---\nname: cloudbase\ndescription: 云开发全家桶\n---\n')
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-bare-'))
  const cfg = JSON.stringify({ agent: { maxConcurrent: 2 }, providers: { claude: {} }, groups: { oc_p: { workdir: wd, provider: 'claude' }, oc_b: { workdir: bare, provider: 'claude' }, oc_e: { provider: 'claude' } } })
  // ⚠ 把测试进程 cwd 切到带 .mcp.json 的目录:无 workdir 的群若少了判空 guard,
  // path.join('', '.mcp.json') 会退化成 cwd 相对读、读到"别的项目"的声明 —— 这一步让
  // 「guard 被删」与「guard 在」两种实现在断言上可区分(复核实验坐实过这条退化路径)。
  const prevCwd = process.cwd()
  process.chdir(wd)
  try {
    await withServer(cfg, async ({ port, token }) => {
      const s = JSON.parse((await rawReq(port, { path: '/api/state', headers: { 'X-Sbot-Token': token } })).body)
      const gp = s.groups.find((g) => g.chatId === 'oc_p'), gb = s.groups.find((g) => g.chatId === 'oc_b'), ge = s.groups.find((g) => g.chatId === 'oc_e')
      assert.deepEqual(gp.proj.mcp, ['wechat-devtools', 'cloudbase'])
      assert.deepEqual(gp.proj.skills, ['cloudbase'])
      assert.deepEqual(gb.proj, { mcp: [], skills: [] })
      assert.deepEqual(ge.proj, { mcp: [], skills: [] }, '无 workdir 的群绝不能拿 daemon cwd 凑项目声明')
    })
  } finally { process.chdir(prevCwd) }
})

test('ui: /api/state exposes the console access address (net block)', async () => {
  // default loopback bind → lan:false, local set, no LAN urls
  await withServer(VALID_CFG, async ({ port, token }) => {
    const s = JSON.parse((await rawReq(port, { path: '/api/state', headers: { 'X-Sbot-Token': token } })).body)
    assert.equal(s.net.lan, false)
    assert.match(s.net.local, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.deepEqual(s.net.lanUrls, [])
  })
  // LAN bind (host 0.0.0.0) → lan:true, lanUrls is an array (may be empty in CI w/o a LAN iface)
  const cfgPath = tmpConfig(VALID_CFG)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, host: '0.0.0.0', log: () => {} })
  const port = await listen(ui)
  try {
    const token = (await rawReq(port, { path: '/' })).body.match(/TOKEN='([0-9a-f]{32})'/)[1]
    const s = JSON.parse((await rawReq(port, { path: '/api/state', headers: { 'X-Sbot-Token': token } })).body)
    assert.equal(s.net.lan, true)
    assert.ok(Array.isArray(s.net.lanUrls))
    for (const u of s.net.lanUrls) assert.match(u, /^http:\/\/\d+\.\d+\.\d+\.\d+:\d+$/)
  } finally { ui.close() }
})

test('ui: /api/state exposes the bot timezone clock (time block, 顶栏时钟) + host tz for reference', async () => {
  await withServer(VALID_CFG, async ({ port, token }) => {
    const before = Date.now()
    const s = JSON.parse((await rawReq(port, { path: '/api/state', headers: { 'X-Sbot-Token': token } })).body)
    assert.equal(s.time.tz, 'Asia/Shanghai') // 未配置 ⇒ 产品默认北京口径(与主机时区无关)
    assert.equal(s.time.offsetMin, 480)
    assert.equal(typeof s.time.hostTz, 'string')
    // ⚠ 期望值写 `0 - …` 不写 `-…`:主机在 UTC 时 getTimezoneOffset() 是 0,一元负号得到 -0,而服务端那个数经 JSON
    //   序列化后回来是 0,strictEqual 按 Object.is 判 0 ≠ -0 ⇒ 只在 UTC 主机上红。CI 就是 UTC,这条从 2026-07-14 起
    //   让 main 的 CI 红了两个月而本地(非 UTC)一直绿;`0 - 0` 是 +0,与 JSON 回来的值一致。
    assert.equal(s.time.hostOffsetMin, 0 - new Date().getTimezoneOffset())
    assert.ok(s.time.now >= before && s.time.now <= Date.now() + 1000)
    assert.equal(s.timezone, '') // 未显式配置 ⇒ 设置页留空显示占位默认
  })
})

test('ui: /api/agent 会话压缩阈值 — 0 或 [10万,100万] 收,区间外拒(存前挡坏值,防 CLI 拒参数死轮)', async () => {
  await withServer(VALID_CFG, async ({ port, token, cfgPath }) => {
    const post = (b) => rawReq(port, { method: 'POST', path: '/api/agent', headers: { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    let r = await post({ autocompactTokens: 200000 })
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).agent.autocompactTokens, 200000)
    assert.equal(JSON.parse(r.body).agent.autocompactTokens, 200000) // state 回显 = 控制台即时可见
    r = await post({ autocompactTokens: 0 }) // 0 = 关闭,合法
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).agent.autocompactTokens, 0)
    for (const bad of [50000, 2_000_000, -1, 1.5, 'x']) {
      r = await post({ autocompactTokens: bad })
      assert.equal(r.status, 400, `应拒绝 ${bad}`)
      assert.match(JSON.parse(r.body).error, /100000|整数/)
    }
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).agent.autocompactTokens, 0, '坏值没落盘')
  })
})

test('ui: /api/agent 回执等待 — 非负整数毫秒收(含 0),负数/小数拒', async () => {
  await withServer(VALID_CFG, async ({ port, token, cfgPath }) => {
    const post = (b) => rawReq(port, { method: 'POST', path: '/api/agent', headers: { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    let r = await post({ ackDelayMs: 10000 })
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).agent.ackDelayMs, 10000)
    assert.equal(JSON.parse(r.body).agent.ackDelayMs, 10000)
    r = await post({ ackDelayMs: 0 }) // 0 = 不发,合法
    assert.equal(r.status, 200)
    for (const bad of [-1, 1.5, 'x']) {
      r = await post({ ackDelayMs: bad })
      assert.equal(r.status, 400, `应拒绝 ${bad}`)
    }
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).agent.ackDelayMs, 0, '坏值没落盘')
  })
})

test('ui: /api/agent saves a valid timezone, rejects an invalid one, clears back to default', async () => {
  await withServer(VALID_CFG, async ({ port, token, cfgPath }) => {
    const post = (b) => rawReq(port, { method: 'POST', path: '/api/agent', headers: { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    let r = await post({ timezone: 'Asia/Tokyo' })
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).timezone, 'Asia/Tokyo')
    assert.equal(JSON.parse(r.body).time.tz, 'Asia/Tokyo')
    r = await post({ timezone: 'Not/AZone' })
    assert.equal(r.status, 400)
    assert.match(JSON.parse(r.body).error, /IANA/)
    r = await post({ timezone: '' }) // 清空 ⇒ 删键回默认
    assert.equal(r.status, 200)
    assert.equal('timezone' in JSON.parse(fs.readFileSync(cfgPath, 'utf8')), false)
    assert.equal(JSON.parse(r.body).time.tz, 'Asia/Shanghai')
  })
})

test('ui: a corrupted config file is never overwritten by a save', async () => {
  const broken = '{ "providers": { "claude": {} }, }' // trailing comma — invalid JSON
  const cfgPath = tmpConfig(broken)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {} })
  const port = await listen(ui)
  try {
    const page = await rawReq(port, { path: '/' })
    const token = page.body.match(/TOKEN='([0-9a-f]{32})'/)[1]
    const r = await rawReq(port, { method: 'POST', path: '/api/agent', headers: { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }, body: '{"maxConcurrent":9}' })
    assert.equal(r.status, 500)
    assert.match(JSON.parse(r.body).error, /配置文件损坏/)
    assert.equal(fs.readFileSync(cfgPath, 'utf8'), broken) // file untouched
  } finally { ui.close() }
})

test('ui: a valid config still saves normally through the same path', async () => {
  await withServer(VALID_CFG, async ({ port, token, cfgPath }) => {
    const r = await rawReq(port, { method: 'POST', path: '/api/agent', headers: { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }, body: '{"maxConcurrent":7}' })
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).agent.maxConcurrent, 7)
  })
})

test('ui: binding rejects a missing workdir; a real dir binds', async () => {
  // 目录围栏(2026-09-08)起绑定只认项目根目录之内的路径 ⇒ 用例自带一个根,workdir 放在根里
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-root-'))
  const cfgWithRoot = JSON.stringify({ agent: { maxConcurrent: 2 }, providers: { claude: {} }, groups: {}, projectsRoots: [base] })
  await withServer(cfgWithRoot, async ({ port, token, cfgPath }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    const bad = await rawReq(port, { method: 'POST', path: '/api/groups', headers: H, body: JSON.stringify({ chatId: 'oc_t', workdir: '/no/such/dir-sbot-xyz' }) })
    assert.equal(bad.status, 400)
    assert.match(JSON.parse(bad.body).error, /workdir 不存在/)
    const dir = path.join(base, 'proj'); fs.mkdirSync(dir)
    const ok = await rawReq(port, { method: 'POST', path: '/api/groups', headers: H, body: JSON.stringify({ chatId: 'oc_t', workdir: dir }) })
    assert.equal(ok.status, 200)
    assert.equal(JSON.parse(ok.body).notified, false) // no feishu creds → no notice, and no crash
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.oc_t.workdir, dir)
  })
})

test('ui: disband only works on BOUND chats — unbound is rejected', async () => {
  const cfg = JSON.stringify({ providers: { claude: {} }, groups: { oc_b: { workdir: '/tmp' } } })
  await withServer(cfg, async ({ port, token }) => {
    const r = await rawReq(port, { method: 'DELETE', path: '/api/feishu/chats?chatId=oc_unknown', headers: { 'X-Sbot-Token': token } })
    assert.equal(r.status, 400)
    assert.match(JSON.parse(r.body).error, /仅已绑定的群/)
  })
})

test('ui: disband on a bound chat passes the bound gate, then stops at missing creds', async () => {
  const cfg = JSON.stringify({ providers: { claude: {} }, groups: { oc_b: { workdir: '/tmp' } } })
  await withServer(cfg, async ({ port, token }) => {
    const r = await rawReq(port, { method: 'DELETE', path: '/api/feishu/chats?chatId=oc_b', headers: { 'X-Sbot-Token': token } })
    assert.equal(r.status, 400)
    assert.match(JSON.parse(r.body).error, /appId\/appSecret/) // gate order: bound → creds → members
  })
})

test('ui: admins (可多个) persist via /api/feishu/admins — dedup + migrate off legacy adminOpenId', async () => {
  await withServer(VALID_CFG, async ({ port, token, cfgPath }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    // legacy single adminOpenId still writes and surfaces (migrated) as a one-element admins list
    const r0 = await rawReq(port, { method: 'POST', path: '/api/feishu', headers: H, body: JSON.stringify({ appId: 'cli_x', adminOpenId: ' ou_admin1 ', adminName: '张三' }) })
    assert.deepEqual(JSON.parse(r0.body).feishu.admins, [{ openId: 'ou_admin1', name: '张三' }])
    // the admins endpoint replaces the list, dedups by openId, drops the legacy single fields
    const r1 = await rawReq(port, { method: 'POST', path: '/api/feishu/admins', headers: H, body: JSON.stringify({ admins: [{ openId: 'ou_a', name: 'A' }, { openId: 'ou_a', name: 'dup' }, { openId: 'ou_b', name: 'B' }] }) })
    assert.equal(r1.status, 200)
    const saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).feishu
    assert.deepEqual(saved.admins, [{ openId: 'ou_a', name: 'A' }, { openId: 'ou_b', name: 'B' }])
    assert.equal(saved.adminOpenId, undefined) // migrated off the single-admin field
    assert.deepEqual(JSON.parse(r1.body).feishu.admins, [{ openId: 'ou_a', name: 'A' }, { openId: 'ou_b', name: 'B' }])
  })
})

test('ui: disband phase-2 without a valid one-time token is rejected', async () => {
  const cfg = JSON.stringify({ providers: { claude: {} }, groups: { oc_b: { workdir: '/tmp' } } })
  await withServer(cfg, async ({ port, token }) => {
    // a bare confirm=1 (no phase-1 token) must never reach the disband call
    const r = await rawReq(port, { method: 'DELETE', path: '/api/feishu/chats?chatId=oc_b&confirm=1&dtoken=deadbeef', headers: { 'X-Sbot-Token': token } })
    assert.equal(r.status, 400)
    assert.match(JSON.parse(r.body).error, /重新发起/)
  })
})

test('ui: per-group permissionMode saves, clears, and rejects hang-prone modes', async () => {
  const cfg = JSON.stringify({ providers: { claude: {} }, groups: { oc_b: { workdir: '/tmp' } } })
  await withServer(cfg, async ({ port, token, cfgPath }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    const set = await rawReq(port, { method: 'POST', path: '/api/groups/policy', headers: H, body: JSON.stringify({ chatId: 'oc_b', permissionMode: 'bypassPermissions' }) })
    assert.equal(set.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.oc_b.permissionMode, 'bypassPermissions')
    const bad = await rawReq(port, { method: 'POST', path: '/api/groups/policy', headers: H, body: JSON.stringify({ chatId: 'oc_b', permissionMode: 'default' }) })
    assert.equal(bad.status, 400) // 'default' would hang a headless turn
    assert.match(JSON.parse(bad.body).error, /挂起/)
    const clear = await rawReq(port, { method: 'POST', path: '/api/groups/policy', headers: H, body: JSON.stringify({ chatId: 'oc_b', permissionMode: '' }) })
    assert.equal(clear.status, 200)
    assert.equal('permissionMode' in JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.oc_b, false) // '' = 跟随全局
  })
})

test('ui: /api/groups/order reorders config keys; unknown ids ignored, unlisted kept (drag sort)', async () => {
  const cfg = JSON.stringify({ providers: { claude: {} }, groups: { oc_a: { workdir: '/tmp' }, oc_b: { workdir: '/tmp' }, oc_c: { workdir: '/tmp' } } })
  await withServer(cfg, async ({ port, token, cfgPath }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    const r = await rawReq(port, { method: 'POST', path: '/api/groups/order', headers: H, body: JSON.stringify({ order: ['oc_c', 'oc_ghost', 'oc_a'] }) })
    assert.equal(r.status, 200)
    // listed first in given order (ghost dropped), unlisted appended after
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups), ['oc_c', 'oc_a', 'oc_b'])
    assert.deepEqual(JSON.parse(r.body).groups.map((g) => g.chatId), ['oc_c', 'oc_a', 'oc_b']) // state follows key order
  })
})

test('ui: /api/plugins returns the global library; ?chatId adds project probe + enablement', async () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-wd-'))
  fs.writeFileSync(path.join(wd, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'db-mcp' } } }))
  const cfg = JSON.stringify({ providers: { claude: {} }, groups: { oc_b: { workdir: wd } } })
  await withServer(cfg, async ({ port, token }) => {
    const H = { 'X-Sbot-Token': token }
    const g = await rawReq(port, { path: '/api/plugins', headers: H })
    assert.equal(g.status, 200)
    const gb = JSON.parse(g.body)
    assert.ok(Array.isArray(gb.global.mcp) && Array.isArray(gb.global.skills))
    assert.equal(gb.project, undefined) // 无 chatId → 只有全局库
    const p = await rawReq(port, { path: '/api/plugins?chatId=oc_b', headers: H })
    const pb = JSON.parse(p.body)
    assert.deepEqual(pb.project.mcp, [{ name: 'db', detail: 'db-mcp' }])
    assert.equal(pb.enabled, null) // 未配置 = 未接管
    const missing = await rawReq(port, { path: '/api/plugins?chatId=oc_ghost', headers: H })
    assert.equal(missing.status, 404)
  })
})

test('ui: /api/groups/plugins saves enablement (strict takeover) and reset restores default', async () => {
  const cfg = JSON.stringify({ providers: { claude: {} }, groups: { oc_b: { workdir: '/tmp' } } })
  await withServer(cfg, async ({ port, token, cfgPath }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    const set = await rawReq(port, { method: 'POST', path: '/api/groups/plugins', headers: H, body: JSON.stringify({ chatId: 'oc_b', mcp: ['chrome', '', 7], skills: ['deploy'] }) })
    assert.equal(set.status, 200)
    const saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.oc_b.plugins
    assert.deepEqual(saved, { mcp: ['chrome'], skills: ['deploy'] }) // 非字符串/空项被清洗
    assert.deepEqual(JSON.parse(set.body).groups[0].plugins, saved) // state 透出配置
    const rst = await rawReq(port, { method: 'POST', path: '/api/groups/plugins', headers: H, body: JSON.stringify({ chatId: 'oc_b', reset: true }) })
    assert.equal(rst.status, 200)
    assert.equal('plugins' in JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.oc_b, false) // 恢复默认加载
    const missing = await rawReq(port, { method: 'POST', path: '/api/groups/plugins', headers: H, body: JSON.stringify({ chatId: 'oc_ghost', mcp: [] }) })
    assert.equal(missing.status, 404)
  })
})

test('ui: /api/plugins/exec runs a global library install command (整合自群卡)', async () => {
  await withServer(VALID_CFG, async ({ port, token }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    const ok = await rawReq(port, { method: 'POST', path: '/api/plugins/exec', headers: H, body: JSON.stringify({ command: 'node -e "console.log(\'sbot-exec-ok\')"' }) })
    assert.equal(ok.status, 200)
    const rb = JSON.parse(ok.body)
    assert.equal(rb.ok, true)
    assert.match(rb.output, /sbot-exec-ok/)                  // 全局安装,无需 chatId/workdir
    const fail = await rawReq(port, { method: 'POST', path: '/api/plugins/exec', headers: H, body: JSON.stringify({ command: 'node -e "process.exit(3)"' }) })
    assert.equal(JSON.parse(fail.body).ok, false)            // 非零退出 → ok:false
    const empty = await rawReq(port, { method: 'POST', path: '/api/plugins/exec', headers: H, body: JSON.stringify({ command: '  ' }) })
    assert.equal(empty.status, 400)                          // 空命令 400
    const noauth = await rawReq(port, { method: 'POST', path: '/api/plugins/exec', body: JSON.stringify({ command: 'ls' }) })
    assert.equal(noauth.status, 401)                         // 无 token → 401(操作台专用)
  })
})

// 活动重同步(下一步 ②):SSE 无重放,故 daemon 存最近 turn 事件环形缓冲,控制台经
// /api/activity 载入/重连时补齐(id 去重、done 覆盖 start、按加入序封顶、conn 事件不入池)。
test('ui: /api/activity replays buffered turn events, done supersedes start', async () => {
  const cfgPath = tmpConfig(VALID_CFG)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {} })
  const port = await listen(ui)
  try {
    const page = await rawReq(port, { path: '/' })
    const H = { 'X-Sbot-Token': page.body.match(/TOKEN='([0-9a-f]{32})'/)[1] }

    let r = await rawReq(port, { path: '/api/activity', headers: H })
    assert.equal(r.status, 200)
    assert.deepEqual(JSON.parse(r.body).activity, []) // empty before any turn

    ui.pushEvent('turn', { id: 'c:1', ts: 100, group: 'g1', kind: 'start', text: 'hi' })
    ui.pushEvent('turn', { id: 'c:1', ts: 100, group: 'g1', kind: 'done', status: 'ok', ms: 1200, reply: 'yo' })
    ui.pushEvent('turn', { id: 'c:2', ts: 200, group: 'g2', kind: 'start', text: 'hey' })
    ui.pushEvent('conn', { state: 'connected' }) // non-turn: must NOT enter the buffer

    r = await rawReq(port, { path: '/api/activity', headers: H })
    const act = JSON.parse(r.body).activity
    assert.equal(act.length, 2)         // start+done collapse to one turn; conn ignored
    assert.equal(act[0].id, 'c:2')      // newest-first
    assert.equal(act[1].id, 'c:1')
    assert.equal(act[1].kind, 'done')   // done superseded start (same id, in place)
    assert.equal(act[1].reply, 'yo')
  } finally { ui.close() }
})

test('ui: /api/activity buffer is capped, evicting oldest', async () => {
  const cfgPath = tmpConfig(VALID_CFG)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {} })
  const port = await listen(ui)
  try {
    const page = await rawReq(port, { path: '/' })
    const H = { 'X-Sbot-Token': page.body.match(/TOKEN='([0-9a-f]{32})'/)[1] }
    for (let i = 0; i < 40; i++) ui.pushEvent('turn', { id: 'x:' + i, ts: 1000 + i, kind: 'start' })
    const act = JSON.parse((await rawReq(port, { path: '/api/activity', headers: H })).body).activity
    assert.equal(act.length, 30)                    // ACT_MAX
    assert.equal(act[0].id, 'x:39')                 // newest kept, newest-first
    assert.ok(!act.some((e) => e.id === 'x:0'))     // oldest evicted
  } finally { ui.close() }
})

test('ui: pushEvent(turn) broadcasts the turn AND an immediate tick frame (状态与新任务同帧刷新)', async () => {
  const cfgPath = tmpConfig(VALID_CFG)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {}, getLiveState: () => ({ running: true, concurrency: { active: 1, max: 2 }, queue: 0, groups: { G: { busy: true } } }) })
  const port = await listen(ui)
  try {
    const token = (await rawReq(port, { path: '/' })).body.match(/TOKEN='([0-9a-f]{32})'/)[1]
    const chunks = []
    const req = http.request({ host: '127.0.0.1', port, path: `/api/events?token=${token}` }, (res) => res.on('data', (c) => chunks.push(String(c))))
    req.end()
    await new Promise((r) => setTimeout(r, 150)) // hello 到达
    ui.pushEvent('turn', { id: 'G:1', kind: 'start', ts: 1 })
    await new Promise((r) => setTimeout(r, 150))
    const all = chunks.join('')
    const afterTurn = all.slice(all.indexOf('event: turn'))
    assert.match(afterTurn, /^event: turn/)
    assert.match(afterTurn, /event: tick/) // turn 后紧跟 tick(不等 3s 心跳)
    assert.match(afterTurn, /"busy":true/) // tick 帧携带最新 live 状态
    req.destroy()
  } finally { ui.close() }
})

test('ui: /api/changelog serves the shipped version history (auth required, 设置页版本历史卡)', async () => {
  await withServer(VALID_CFG, async ({ port, token }) => {
    assert.equal((await rawReq(port, { path: '/api/changelog' })).status, 401)
    const r = await rawReq(port, { path: '/api/changelog', headers: { 'X-Sbot-Token': token } })
    assert.equal(r.status, 200)
    const list = JSON.parse(r.body).changelog
    assert.ok(Array.isArray(list) && list.length >= 1, 'CHANGELOG.json ships with the package')
    assert.match(list[0].version, /^\d+\.\d+\.\d+$/)
    assert.ok(Array.isArray(list[0].items) && list[0].items.every((i) => i.t && i.d))
    assert.equal(list[0].version, require('../../package.json').version, '最新条目 = 当前版本(发版时同步维护)')
  })
})

// 英文界面的版本历史正文(数据文件里的中文正文,词典翻不了它)另走一条:随包分发的 CHANGELOG.en.json。
test('ui: /api/changelog-en serves the English version history (auth required, 英文界面的版本历史卡)', async () => {
  await withServer(VALID_CFG, async ({ port, token }) => {
    assert.equal((await rawReq(port, { path: '/api/changelog-en' })).status, 401)
    const r = await rawReq(port, { path: '/api/changelog-en', headers: { 'X-Sbot-Token': token } })
    assert.equal(r.status, 200)
    const list = JSON.parse(r.body).changelog
    assert.ok(Array.isArray(list) && list.length >= 1, 'CHANGELOG.en.json ships with the package')
    assert.ok(list.every((v) => /^\d+\.\d+\.\d+$/.test(v.version) && Array.isArray(v.items)))
  })
})

// 英文本可以整份缺席(没翻完 / 老包里根本没有)—— 那是「一条英文都没有,整卡出中文」,不是错误。
// 读不到就 500 的话,英文界面的设置页会整张卡空掉。
test('ui: /api/changelog-en 读不到文件时给空数组,不是 500(页面据此整卡回退中文)', async () => {
  const SRV = require.resolve('../../src/ui/server')
  const saved = require.cache[SRV]
  const realRead = fs.readFileSync
  delete require.cache[SRV] // 换一份新的模块实例,避开进程内那份已经读好的缓存
  fs.readFileSync = (f, ...rest) => {
    if (String(f).endsWith('CHANGELOG.en.json')) { const e = new Error('ENOENT: no such file'); e.code = 'ENOENT'; throw e }
    return realRead(f, ...rest)
  }
  const cfgPath = tmpConfig(VALID_CFG)
  let ui = null
  try {
    ui = require(SRV).createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {} })
    const port = await listen(ui)
    const tok = (await rawReq(port, { path: '/' })).body.match(/TOKEN='([0-9a-f]{32})'/)[1]
    const r = await rawReq(port, { path: '/api/changelog-en', headers: { 'X-Sbot-Token': tok } })
    assert.equal(r.status, 200)
    assert.deepEqual(JSON.parse(r.body).changelog, [])
    // 对照组:同一个实例上中文那份照样读得出来(证明不是整台服务器都瞎了)
    const zh = await rawReq(port, { path: '/api/changelog', headers: { 'X-Sbot-Token': tok } })
    assert.ok(JSON.parse(zh.body).changelog.length >= 1)
  } finally { if (ui) ui.close(); fs.readFileSync = realRead; require.cache[SRV] = saved }
})

test('ui: /api/codex/models falls back to presets when codex is unreachable (auth required)', async () => {
  await withServer(VALID_CFG, async ({ port, token }) => {
    assert.equal((await rawReq(port, { path: '/api/codex/models' })).status, 401)
    const r = await rawReq(port, { path: '/api/codex/models', headers: { 'X-Sbot-Token': token } })
    assert.equal(r.status, 200)
    const d = JSON.parse(r.body)
    assert.ok(['live', 'preset'].includes(d.source))
    assert.ok(Array.isArray(d.models) && d.models.length >= 1)
    assert.ok(d.models.every((m) => m.model && m.name && Array.isArray(m.efforts)))
  })
})

// ── provider 变更联动(模型页改 model/推理强度 → 使用中的群) ──────────────────
async function withControlServer(cfgJson, fn) {
  const calls = { cleared: [], notified: [] }
  const cfgPath = tmpConfig(cfgJson)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {}, control: { clearSession: (c) => calls.cleared.push(c), notifyGroup: (c, t) => calls.notified.push([c, t]) } })
  const port = await listen(ui)
  const token = (await rawReq(port, { path: '/' })).body.match(/TOKEN='([0-9a-f]{32})'/)[1]
  try { await fn({ port, token, calls, cfgPath }) } finally { ui.close() }
}

test('ui: editing a provider model resets + notifies exactly the groups that follow it', async () => {
  const cfg = JSON.stringify({ agent: {}, defaultProvider: 'volcano', providers: { volcano: { baseUrl: 'https://x', apiKey: 'k', model: 'old-m' }, other: { baseUrl: 'https://y', apiKey: 'k', model: 'm2' } }, groups: {
    g_follow: { workdir: '/p', provider: 'volcano', name: '跟随群' },
    g_default: { workdir: '/p', name: '默认群' },
    g_pinned: { workdir: '/p', provider: 'volcano', model: 'pin-m', name: '钉死群' },
    g_other: { workdir: '/p', provider: 'other', name: '别家群' },
  } })
  await withControlServer(cfg, async ({ port, token, calls }) => {
    const r = await rawReq(port, { method: 'POST', path: '/api/providers/add', headers: { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'volcano', model: 'new-m' }) })
    assert.equal(r.status, 200)
    const pc = JSON.parse(r.body).providerChange
    assert.equal(pc.modelChanged, true)
    assert.equal(pc.affected, 2) // 跟随群 + 默认群;钉死群(model 覆盖)与别家群不动
    assert.equal(pc.live, true)
    assert.deepEqual(calls.cleared.sort(), ['g_default', 'g_follow'])
    assert.equal(calls.notified.length, 2)
    assert.match(calls.notified[0][1], /模型已更新.*new-m.*会话已重置/)
  })
})

test('ui: reasoningEffort-only change notifies WITHOUT reset; new tiers (ultra) accepted (0.2.5 回归修复)', async () => {
  const cfg = JSON.stringify({ agent: {}, defaultProvider: 'codex', providers: { codex: { runner: 'codex', model: 'gpt-5.6-sol' } }, groups: { g1: { workdir: '/p', provider: 'codex' } } })
  await withControlServer(cfg, async ({ port, token, calls, cfgPath }) => {
    const r = await rawReq(port, { method: 'POST', path: '/api/providers/add', headers: { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'codex', model: 'gpt-5.6-sol', reasoningEffort: 'ultra' }) })
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).providers.codex.reasoningEffort, 'ultra') // 旧枚举白名单会把 ultra 静默清空
    assert.equal(calls.cleared.length, 0) // 强度调整不重置会话
    assert.equal(calls.notified.length, 1)
    assert.match(calls.notified[0][1], /推理强度已调为 ultra/)
  })
})

// 识图降级的结构性缺口:控制台此前根本没有 vision 字段 ⇒ 从控制台建的第三方 provider 一律
// 漏标,文本模型撞上浏览器截图就 400 崩整轮。落盘只存 "没有识图" 这一种,默认透传不写字段。
test('ui: vision 开关落盘 — 勾选存 vision:false,取消删字段,state 如实回显', async () => {
  const cfg = JSON.stringify({ agent: {}, defaultProvider: 'volcano', providers: { volcano: { baseUrl: 'https://x', apiKey: 'k', model: 'glm-5.2' } }, groups: {} })
  await withControlServer(cfg, async ({ port, token, cfgPath }) => {
    const post = (b) => rawReq(port, { method: 'POST', path: '/api/providers/add', headers: { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    let r = await post({ name: 'volcano', model: 'glm-5.2', vision: false })
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).providers.volcano.vision, false)
    assert.equal(JSON.parse(r.body).providers.find((p) => p.name === 'volcano').vision, false)
    r = await post({ name: 'volcano', model: 'glm-5.2', vision: true }) // 取消勾选 ⇒ 回默认透传
    assert.equal('vision' in JSON.parse(fs.readFileSync(cfgPath, 'utf8')).providers.volcano, false)
    assert.equal(JSON.parse(r.body).providers.find((p) => p.name === 'volcano').vision, true)
    // 不传该字段(如 codex 卡片保存)⇒ 原值不动
    await post({ name: 'volcano', vision: false })
    await post({ name: 'volcano', model: 'glm-5.2' })
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).providers.volcano.vision, false)
  })
})

test('ui: adding a NEW provider triggers no group linkage; no-op edit neither', async () => {
  const cfg = JSON.stringify({ agent: {}, defaultProvider: 'volcano', providers: { volcano: { baseUrl: 'https://x', apiKey: 'k', model: 'm' } }, groups: { g1: { workdir: '/p' } } })
  await withControlServer(cfg, async ({ port, token, calls }) => {
    const post = (b) => rawReq(port, { method: 'POST', path: '/api/providers/add', headers: { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    let r = await post({ name: 'newone', baseUrl: 'https://z', model: 'nm' }) // 新增
    assert.equal(JSON.parse(r.body).providerChange.affected, 0)
    r = await post({ name: 'volcano', model: 'm' }) // 无变化编辑
    assert.equal(JSON.parse(r.body).providerChange.affected, 0)
    assert.equal(calls.notified.length, 0)
    assert.equal(calls.cleared.length, 0)
  })
})

test('ui: deleting a provider still used by groups is rejected (占用守卫)', async () => {
  const cfg = JSON.stringify({ agent: {}, providers: { volcano: { baseUrl: 'https://x', apiKey: 'k' }, spare: { baseUrl: 'https://y', apiKey: 'k' } }, groups: { g1: { workdir: '/p', provider: 'volcano', name: '群A' } } })
  const cfgPath = tmpConfig(cfg)
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {} })
  const port = await listen(ui)
  try {
    const token = (await rawReq(port, { path: '/' })).body.match(/TOKEN='([0-9a-f]{32})'/)[1]
    const bad = await rawReq(port, { method: 'DELETE', path: '/api/providers?name=volcano', headers: { 'X-Sbot-Token': token } })
    assert.equal(bad.status, 400)
    assert.match(JSON.parse(bad.body).error, /群A/)
    const ok = await rawReq(port, { method: 'DELETE', path: '/api/providers?name=spare', headers: { 'X-Sbot-Token': token } })
    assert.equal(ok.status, 200)
  } finally { ui.close() }
})

test('ui: /api/activity requires auth', async () => {
  await withServer(VALID_CFG, async ({ port }) => {
    assert.equal((await rawReq(port, { path: '/api/activity' })).status, 401)
  })
})

// ── workdir browser confinement (rooted at projects dir, operator request) ──────
const { listDirs } = require('../../src/ui/server')

test('listDirs: no target starts at the projects root (atRoot), lists its subdirs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-proj-'))
  fs.mkdirSync(path.join(root, 'projA')); fs.mkdirSync(path.join(root, 'projB'))
  fs.writeFileSync(path.join(root, 'note.txt'), 'x') // files excluded
  const r = listDirs('', root)
  assert.equal(r.cwd, root)
  assert.equal(r.atRoot, true)
  assert.deepEqual(r.items.map((i) => i.name), ['projA', 'projB'])
})

test('listDirs: a target OUTSIDE the root is clamped back to the root (cannot escape)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-proj-'))
  fs.mkdirSync(path.join(root, 'inside'))
  const escaped = listDirs(path.parse(root).root, root) // filesystem root — outside
  assert.equal(escaped.cwd, root)   // clamped, not the disk root
  assert.equal(escaped.atRoot, true)
  const sub = listDirs(path.join(root, 'inside'), root)
  assert.equal(sub.cwd, path.join(root, 'inside'))
  assert.equal(sub.atRoot, false)   // a real subdir is navigable, not root
})

test('listDirs: 多个根时不传 target 先出根清单(不列任何目录),进入某个根后 atRoot 且可回清单', () => {
  const r1 = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-r1-')), r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-r2-'))
  fs.mkdirSync(path.join(r2, 'proj'))
  const list = listDirs('', [r1, r2])
  assert.equal(list.rootList, true); assert.equal(list.cwd, '')
  assert.deepEqual(list.items.map((i) => i.path), [r1, r2])
  const inR2 = listDirs(r2, [r1, r2])
  assert.equal(inR2.cwd, r2); assert.equal(inR2.atRoot, true); assert.deepEqual(inR2.items.map((i) => i.name), ['proj'])
  assert.deepEqual(inR2.roots, [r1, r2], '前端靠 roots 判断要不要画「回全部根目录」')
  // 越界目标在多根下同样夹回根清单,而不是随便挑一个根
  assert.equal(listDirs(path.parse(r1).root, [r1, r2]).rootList, true)
})

test('listDirs: 点开头目录与 node_modules 不列;根内指向根外的符号链接既不列、手填穿过去也夹回根', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-proj-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-out-'))
  fs.mkdirSync(path.join(outside, 'secret'))
  fs.mkdirSync(path.join(root, '.git')); fs.mkdirSync(path.join(root, 'node_modules')); fs.mkdirSync(path.join(root, 'app'))
  fs.symlinkSync(outside, path.join(root, 'link'))
  const r = listDirs('', root)
  assert.deepEqual(r.items.map((i) => i.name), ['app'])
  const viaLink = listDirs(path.join(root, 'link', 'secret'), root)
  assert.equal(viaLink.cwd, root, '字面上在根内、realpath 在根外 ⇒ 夹回根')
  assert.equal(viaLink.atRoot, true)
})

test('ui: /api/fs/listdir 与 POST /api/groups 的围栏同源 —— 越界的 path 夹回根,越界的 workdir 400,老的越界绑定改模型不受阻', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-root-'))
  const inside = path.join(base, 'proj'); fs.mkdirSync(inside)
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-out-'))
  // oc_old 是配置文件里手写的越界老绑定:保留它,改别的字段照样能存
  const cfg = JSON.stringify({ agent: { maxConcurrent: 2 }, providers: { claude: {}, glm: { baseUrl: 'https://x', apiKey: 'k' } }, groups: { oc_old: { workdir: outside, provider: 'claude' } }, projectsRoots: [base] })
  await withServer(cfg, async ({ port, token, cfgPath }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    // 目录浏览:/etc 与 base 的上级都夹回 base;根内正常进入
    for (const p of ['/etc', path.dirname(base), outside]) {
      const r = JSON.parse((await rawReq(port, { path: '/api/fs/listdir?path=' + encodeURIComponent(p), headers: H })).body)
      assert.equal(r.cwd, base, p); assert.equal(r.atRoot, true)
    }
    const sub = JSON.parse((await rawReq(port, { path: '/api/fs/listdir?path=' + encodeURIComponent(inside), headers: H })).body)
    assert.equal(sub.cwd, inside); assert.equal(sub.atRoot, false)
    // 保存绑定:越界 400 且说清根在哪;根内 200
    const bad = await rawReq(port, { method: 'POST', path: '/api/groups', headers: H, body: JSON.stringify({ chatId: 'oc_new', workdir: outside }) })
    assert.equal(bad.status, 400)
    assert.match(JSON.parse(bad.body).error, /项目根目录/); assert.ok(JSON.parse(bad.body).error.includes(base))
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/groups', headers: H, body: JSON.stringify({ chatId: 'oc_new', workdir: inside }) })).status, 200)
    // 越界老绑定:目录不变只换模型 ⇒ 放行;想把目录改到另一个越界处 ⇒ 拦
    const keep = await rawReq(port, { method: 'POST', path: '/api/groups', headers: H, body: JSON.stringify({ chatId: 'oc_old', workdir: outside, provider: 'glm' }) })
    assert.equal(keep.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.oc_old.provider, 'glm')
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-out2-'))
    assert.equal((await rawReq(port, { method: 'POST', path: '/api/groups', headers: H, body: JSON.stringify({ chatId: 'oc_old', workdir: other }) })).status, 400)
    // /api/state 把根下发给前端(绑群弹窗的提示与围栏同源)
    const st = JSON.parse((await rawReq(port, { path: '/api/state', headers: H })).body)
    assert.deepEqual(st.projectsRoots, [base])
    // 新建文件夹:parent 越界 ⇒ 夹回根下建
    const mk = JSON.parse((await rawReq(port, { method: 'POST', path: '/api/fs/mkdir', headers: H, body: JSON.stringify({ parent: outside, name: 'fresh' }) })).body)
    assert.equal(mk.path, path.join(base, 'fresh')); assert.ok(fs.existsSync(path.join(base, 'fresh')))
    assert.equal(fs.existsSync(path.join(outside, 'fresh')), false, '对照:根外一个字节都没建')
  })
})

// ── new project folder creation (confined to projects root, operator request) ──
const { makeDir } = require('../../src/ui/server')

test('makeDir: creates a folder under the root and returns its path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-mk-'))
  const r = makeDir(root, 'newproj', root)
  assert.equal(r.path, path.join(root, 'newproj'))
  assert.ok(fs.existsSync(path.join(root, 'newproj')))
})

test('makeDir: rejects unsafe names (separators / traversal / illegal / empty)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-mk-'))
  for (const bad of ['..', '.', 'a/b', 'a\\b', '', '   ', 'a:b', 'a*b', 'a?b'])
    assert.throws(() => makeDir(root, bad, root))
})

test('makeDir: clamps an outside parent back into the root (cannot create outside)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-mk-'))
  const r = makeDir(path.parse(root).root, 'x', root) // parent = disk root, outside
  assert.equal(r.path, path.join(root, 'x'))          // clamped under the projects root
  assert.ok(fs.existsSync(path.join(root, 'x')))
})

test('makeDir: rejects a duplicate folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-mk-'))
  makeDir(root, 'dup', root)
  assert.throws(() => makeDir(root, 'dup', root), /已存在/)
})

// ── 定时任务 cron endpoints (add/toggle/remove) — per-group, human-described, isolated ──
test('ui: cron add/toggle/remove per group, with human description, validation, and cross-group isolation', async () => {
  const cfg = JSON.stringify({ agent: { maxConcurrent: 2 }, providers: { claude: {} }, groups: { oc_a: { workdir: '/tmp/a' }, oc_b: { workdir: '/tmp/b' } } })
  await withServer(cfg, async ({ port, token }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    const post = (p, b) => rawReq(port, { method: 'POST', path: p, headers: H, body: JSON.stringify(b) })
    const groupsOf = (r) => JSON.parse(r.body).groups
    const gc = (r, id) => groupsOf(r).find((g) => g.chatId === id).crons

    let r = await post('/api/groups/cron/add', { chatId: 'oc_a', expr: '0 9 * * 1-5', kind: 'do', text: '拉构建' })
    assert.equal(r.status, 200)
    assert.equal(gc(r, 'oc_a').length, 1)
    assert.equal(gc(r, 'oc_a')[0].human, '工作日 09:00') // server attaches human description
    assert.equal(gc(r, 'oc_b').length, 0)               // group isolation: oc_b unaffected
    const id = gc(r, 'oc_a')[0].id

    r = await post('/api/groups/cron/add', { chatId: 'oc_a', expr: '99 9 * * *', kind: 'say', text: 'x' })
    assert.equal(r.status, 400) // invalid cron rejected
    r = await post('/api/groups/cron/add', { chatId: 'oc_a', expr: '@daily', kind: 'do', text: '' })
    assert.equal(r.status, 400) // empty text rejected
    r = await post('/api/groups/cron/add', { chatId: 'oc_a', expr: '@hourly', kind: 'run', text: 'node scripts/watch.js' })
    assert.equal(r.status, 200, '第三种任务类型 run(跑脚本,v0.11.103)控制台也能建')
    const runTask = gc(r, 'oc_a').find((c) => c.kind === 'run')
    assert.equal(runTask.text, 'node scripts/watch.js')
    r = await post('/api/groups/cron/remove', { chatId: 'oc_a', id: runTask.id }); assert.equal(r.status, 200)
    r = await post('/api/groups/cron/add', { chatId: 'oc_a', expr: '@hourly', kind: 'exec', text: 'x' })
    assert.equal(r.status, 400) // 不认的类型拒
    r = await post('/api/groups/cron/add', { chatId: 'oc_zzz', expr: '@daily', kind: 'say', text: 'x' })
    assert.equal(r.status, 404) // unknown group

    r = await post('/api/groups/cron/toggle', { chatId: 'oc_a', id, enabled: false })
    assert.equal(gc(r, 'oc_a')[0].enabled, false)

    r = await post('/api/groups/cron/remove', { chatId: 'oc_b', id }) // oc_a's id from oc_b
    assert.equal(r.status, 404) // cross-group remove isolated — not found in oc_b
    r = await post('/api/groups/cron/remove', { chatId: 'oc_a', id })
    assert.equal(r.status, 200)
    assert.equal(gc(r, 'oc_a').length, 0)
  })
})

test('ui: cron add supports one-off (at) — human date + expired flag + validation', async () => {
  const cfg = JSON.stringify({ agent: { maxConcurrent: 2 }, providers: { claude: {} }, groups: { oc_a: { workdir: '/tmp/a' } } })
  await withServer(cfg, async ({ port, token }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    const post = (p, b) => rawReq(port, { method: 'POST', path: p, headers: H, body: JSON.stringify(b) })
    const gc = (r) => JSON.parse(r.body).groups.find((g) => g.chatId === 'oc_a').crons
    let r = await post('/api/groups/cron/add', { chatId: 'oc_a', at: '2020-01-01 00:00', kind: 'say', text: '旧' })
    assert.equal(r.status, 200)
    const past = gc(r).find((c) => c.at === '2020-01-01 00:00')
    assert.equal(past.once, true)
    assert.equal(past.human, '2020年1月1日 00:00')
    assert.equal(past.expired, true)  // 过去 → 已过期
    r = await post('/api/groups/cron/add', { chatId: 'oc_a', at: '2099-12-31 23:59', kind: 'do', text: '未来' })
    assert.equal(gc(r).find((c) => c.at === '2099-12-31 23:59').expired, false) // 未来 → 未过期
    r = await post('/api/groups/cron/add', { chatId: 'oc_a', at: 'not-a-date', kind: 'say', text: 'x' })
    assert.equal(r.status, 400) // 非法一次性时间
  })
})

test('ui: /api/groups/pause 设置/清除 paused(落盘只写 true,恢复删字段);未知群 404', async () => {
  const cfg = JSON.stringify({ providers: { claude: {} }, groups: { oc_a: { workdir: '/tmp' } } })
  await withServer(cfg, async ({ port, token, cfgPath }) => {
    const H = { 'content-type': 'application/json', 'x-sbot-token': token }
    const on = await rawReq(port, { method: 'POST', path: '/api/groups/pause', headers: H, body: JSON.stringify({ chatId: 'oc_a', paused: true }) })
    assert.equal(on.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.oc_a.paused, true)
    assert.equal(JSON.parse(on.body).groups.find((g) => g.chatId === 'oc_a').paused, true) // buildState 透出
    const off = await rawReq(port, { method: 'POST', path: '/api/groups/pause', headers: H, body: JSON.stringify({ chatId: 'oc_a', paused: false }) })
    assert.equal(off.status, 200)
    assert.equal('paused' in JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.oc_a, false) // 恢复 = 删字段,配置不长毛
    const nf = await rawReq(port, { method: 'POST', path: '/api/groups/pause', headers: H, body: JSON.stringify({ chatId: 'oc_zzz', paused: true }) })
    assert.equal(nf.status, 404)
  })
})

// ── 反馈本(控制台侧)──────────────────────────────────────────────────────────
// ⚠ issuesPath 注入到临时文件:默认路径是本机真实的反馈本(生产数据),单测写它就是污染。

const { createIssues } = require('../../src/core/issues')

function withIssueServer(fn, { groups = '{"oc_a":{"workdir":"/p","name":"A群"}}' } = {}) {
  const cfgPath = tmpConfig(`{"providers":{"claude":{}},"groups":${groups}}`)
  const issuesPath = path.join(path.dirname(cfgPath), 'issues.jsonl')
  const sent = []
  const ui = createUiServer({
    sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, issuesPath, log: () => {},
    control: { notifyGroup: (chatId, text) => sent.push({ chatId, text }) },
  })
  return (async () => {
    const port = await listen(ui)
    const page = await rawReq(port, { path: '/' })
    const token = (page.body.match(/TOKEN='([0-9a-f]{32})'/) || [])[1]
    const book = createIssues(issuesPath)
    const get = async () => JSON.parse((await rawReq(port, { path: '/api/state', headers: { 'X-Sbot-Token': token } })).body)
    const post = (b) => rawReq(port, { method: 'POST', path: '/api/issues/status', headers: { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    try { await fn({ book, get, post, sent }) } finally { ui.close() }
  })()
}

test('ui: /api/state 带出反馈本 —— 未处理的必须在概览里看得见', async () => {
  await withIssueServer(async ({ book, get }) => {
    book.add({ chatId: 'oc_a', group: 'A群', sender: '韩梅梅', text: '图片一直没出来', version: '0.11.26', turn: { status: 'ok', ms: 5161, tokens: { in: 0, out: 0 }, provider: 'claude' } })
    const s = await get()
    assert.equal(s.issues.openCount, 1)
    assert.equal(s.issues.open[0].sender, '韩梅梅')
    assert.equal(s.issues.open[0].text, '图片一直没出来')
    assert.match(s.issues.open[0].fp, /ok · 5s · tokens\{in:0,out:0\} · claude/, '指纹要直接算好给前端,不让前端各拼一份')
  })
})

test('ui: 标记已处理 → 状态变更 + 回原群告知', async () => {
  await withIssueServer(async ({ book, get, post, sent }) => {
    book.add({ chatId: 'oc_a', group: 'A群', sender: '韩梅梅', text: '图片一直没出来' })
    const r = await post({ id: 1, op: 'close', note: 'v0.11.26 修了' })
    assert.equal(r.status, 200)
    const s = JSON.parse(r.body)
    assert.equal(s.issues.openCount, 0)
    assert.equal(s.issues.closed[0].note, 'v0.11.26 修了')
    assert.equal(sent.length, 1, '提了没下文,下次就没人提了')
    assert.equal(sent[0].chatId, 'oc_a')
    assert.match(sent[0].text, /#1 已处理/)
    assert.match(sent[0].text, /v0\.11\.26 修了/)
    assert.equal((await get()).issues.openCount, 0)
  })
})

test('ui: 回群通知必须过脱敏 —— notifyGroup 直通平台不脱敏', async () => {
  await withIssueServer(async ({ book, post, sent }) => {
    book.add({ chatId: 'oc_a', group: 'A群', sender: '韩梅梅', text: '报错了 key 是 sk-ant-api03-ABCDEF1234567890abcdefXYZ' })
    await post({ id: 1, op: 'close', note: '' })
    assert.equal(sent.length, 1)
    assert.doesNotMatch(sent[0].text, /sk-ant-api03-ABCDEF/, '粘在反馈里的 key 不能被原样广播回群')
    assert.match(sent[0].text, /redacted/)
  })
})

test('ui: 放回未处理不发群消息(只有「已处理」才值得打扰人)', async () => {
  await withIssueServer(async ({ book, post, sent }) => {
    book.add({ chatId: 'oc_a', group: 'A群', sender: '韩梅梅', text: 'x' })
    await post({ id: 1, op: 'close' })
    assert.equal(sent.length, 1)
    const r = await post({ id: 1, op: 'reopen' })
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(r.body).issues.openCount, 1)
    assert.equal(sent.length, 1, 'reopen 是内部动作,群里不该收到第二条')
  })
})

test('ui: 不存在的编号 404,非法 op 400', async () => {
  await withIssueServer(async ({ post }) => {
    assert.equal((await post({ id: 99, op: 'close' })).status, 404)
    assert.equal((await post({ id: 1, op: 'delete' })).status, 400)
  })
})

test('ui: 暂停的群不发关闭通知(与其它群内通知同一条既有语义)', async () => {
  await withIssueServer(async ({ book, post, sent }) => {
    book.add({ chatId: 'oc_a', group: 'A群', sender: '韩梅梅', text: 'x' })
    await post({ id: 1, op: 'close' })
    assert.equal(sent.length, 0, '暂停 = 别打扰这个群')
  }, { groups: '{"oc_a":{"workdir":"/p","name":"A群","paused":true}}' })
})

test('ui: close 响应如实报有没有告知到群 —— issueNotified 瞬态字段', async () => {
  // 有 daemon(control)且群未暂停 ⇒ true
  await withIssueServer(async ({ book, post }) => {
    book.add({ chatId: 'oc_a', group: 'A群', sender: '韩梅梅', text: 'x' })
    const r = await post({ id: 1, op: 'close' })
    assert.equal(JSON.parse(r.body).issueNotified, true)
  })
  // 群暂停 ⇒ false(前端据此说「群里未通知」而不是谎报「已告知」)
  await withIssueServer(async ({ book, post, sent }) => {
    book.add({ chatId: 'oc_a', group: 'A群', sender: '韩梅梅', text: 'x' })
    const r = await post({ id: 1, op: 'close' })
    assert.equal(JSON.parse(r.body).issueNotified, false)
    assert.equal(sent.length, 0)
  }, { groups: '{"oc_a":{"workdir":"/p","name":"A群","paused":true}}' })
})

test('ui: 纯配置模式(无 daemon)close 不谎报已告知', async () => {
  // sbot ui 单独跑时 control 为 null,notifyGroup 是静默 no-op —— issueNotified 必须 false
  const cfgPath = tmpConfig('{"providers":{"claude":{}},"groups":{"oc_a":{"workdir":"/p","name":"A群"}}}')
  const issuesPath = path.join(path.dirname(cfgPath), 'issues.jsonl')
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, issuesPath, log: () => {} }) // 不传 control
  const port = await listen(ui)
  const page = await rawReq(port, { path: '/' })
  const token = (page.body.match(/TOKEN='([0-9a-f]{32})'/) || [])[1]
  createIssues(issuesPath).add({ chatId: 'oc_a', group: 'A群', sender: '韩梅梅', text: 'x' })
  try {
    const r = await rawReq(port, { method: 'POST', path: '/api/issues/status', headers: { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 1, op: 'close' }) })
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(r.body).issueNotified, false)
    assert.equal(JSON.parse(r.body).issues.closed[0].id, 1, '状态本身照常落盘 —— 只是不吹通知')
  } finally { ui.close() }
})

test('ui: POST /api/groups 只收规范绝对路径 —— 相对路径 / 含 .. 的写法 400;link/.. 字面在根内也进不来;老越界绑定的「没改」按 realpath 比', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-root-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-out-'))
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-out2-'))
  fs.mkdirSync(path.join(base, 'proj')); fs.symlinkSync(outside, path.join(base, 'proj', 'link'))
  fs.symlinkSync(other, path.join(outside, 'sub'))
  const S = path.sep
  const cfg = JSON.stringify({ agent: { maxConcurrent: 2 }, providers: { claude: {} }, groups: { oc_old: { workdir: outside } }, projectsRoots: [base] })
  await withServer(cfg, async ({ port, token, cfgPath }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    const post = async (b) => { const r = await rawReq(port, { method: 'POST', path: '/api/groups', headers: H, body: JSON.stringify(b) }); return { status: r.status, error: (JSON.parse(r.body) || {}).error || '' } }
    let r = await post({ chatId: 'oc_n', workdir: 'proj' })
    assert.equal(r.status, 400); assert.match(r.error, /绝对路径/)
    // ⚠ 字符串拼接构造 link/..(path.join 会先折叠 ..):规范形式那道先拒,不等它到围栏
    r = await post({ chatId: 'oc_n', workdir: base + S + 'proj' + S + 'link' + S + '..' })
    assert.equal(r.status, 400); assert.match(r.error, /规范/)
    r = await post({ chatId: 'oc_n', workdir: base + S + 'proj' + S + '..' + S + 'proj' })
    assert.equal(r.status, 400); assert.match(r.error, /规范/)
    // 直接指向链接:realpath 围栏拒
    r = await post({ chatId: 'oc_n', workdir: base + S + 'proj' + S + 'link' })
    assert.equal(r.status, 400); assert.match(r.error, /项目根目录/)
    // 老越界绑定:outside/sub/.. 字面等于 outside、内核不是 ⇒ 拒;outside 加尾部分隔符视为没改 ⇒ 放行
    r = await post({ chatId: 'oc_old', workdir: outside + S + 'sub' + S + '..', provider: 'claude' })
    assert.equal(r.status, 400)
    r = await post({ chatId: 'oc_old', workdir: outside + S, provider: 'claude' })
    assert.equal(r.status, 200)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.oc_old.workdir, outside + S)
    // 对照:根内规范路径照常 200
    assert.equal((await post({ chatId: 'oc_n', workdir: path.join(base, 'proj') })).status, 200)
  })
})

test('listDirs/makeDir: createMissing 只补建默认根;配置指定的根缺失不建、直接报错;不替人建多级父目录;点开头的名字拒', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-cm-')); const ghost = path.join(t, 'Projects')
  assert.throws(() => listDirs('', ghost, { createMissing: false }), /无法读取目录/)
  assert.equal(fs.existsSync(ghost), false, '配置指定的根不存在:一个字节都不建')
  const r = listDirs('', ghost, { createMissing: true })
  assert.equal(r.cwd, ghost); assert.ok(fs.existsSync(ghost)); assert.equal(r.atRoot, true)
  assert.throws(() => makeDir(path.join(ghost, 'a', 'b'), 'n', ghost, { createMissing: true }))
  assert.equal(fs.existsSync(path.join(ghost, 'a')), false, '多级父目录不替人建')
  assert.throws(() => makeDir(ghost, '.hidden', ghost), /不能以 \. 开头/)
  assert.equal(fs.existsSync(path.join(ghost, '.hidden')), false)
})

test('ui: 项目根目录在控制台只读 —— 两个写接口必须不存在(404),state.projectsRootsInfo 只报现状(存在态 / 配置原文 / 根外的群)', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-pr-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-pr-out-'))
  const ghost = path.join(base, 'Ghost')
  const cfg = JSON.stringify({ agent: { maxConcurrent: 2 }, providers: { claude: {} }, groups: { oc_out: { workdir: outside, name: '外面的群' } }, projectsRoots: [base, ghost] })
  await withServer(cfg, async ({ port, token, cfgPath }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    // 产品决定(2026-09-08):根目录是围栏的策略,控制台不给改 —— 不是藏按钮,是没有接口。这条用例钉住它不被顺手加回来。
    for (const p of ['/api/projects-roots', '/api/projects-roots/create']) {
      const r = await rawReq(port, { method: 'POST', path: p, headers: H, body: JSON.stringify({ roots: outside, root: ghost }) })
      assert.equal(r.status, 404, p)
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).projectsRoots, [base, ghost], '配置一个字节都没动')
    assert.equal(fs.existsSync(ghost), false, '缺失的根没有被建出来')
    const st = JSON.parse((await rawReq(port, { path: '/api/state', headers: H })).body)
    const info = st.projectsRootsInfo
    assert.deepEqual(info.roots.map((x) => [x.root, x.exists]), [[base, true], [ghost, false]])
    assert.equal(info.fromConfig, true); assert.deepEqual(info.configured, [base, ghost]); assert.deepEqual(info.dropped, [])
    assert.deepEqual(info.outside.map((o) => [o.chatId, o.name]), [['oc_out', '外面的群']])
    assert.deepEqual(st.projectsRoots, [base, ghost])
  })
})

// ── 绑群弹窗「保存修改」不许抹掉群的其它配置(2026-09-09 复现)────────────────────────────
// 弹窗对已绑定的群只发 chatId / workdir / provider / name 四样(console.html 的 mSave),而服务端此前
// 从头重建群对象、逐个挑字段保留 —— 只记得工具白名单与名字,权限档 / 远端 / 插件 / 定时任务 / 画布 /
// 脱敏 / 预览 / 暂停一次重存全丢:完全访问退回只读、画布解绑、定时任务消失,界面上看不出任何异常。
test('ui: POST /api/groups 对已绑定的群重存,没发来的群级字段原样留下;换 provider 才丢钉住的模型;新群不凭空多字段', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-keep-'))
  const wd = path.join(base, 'proj'); fs.mkdirSync(wd)
  const extras = {
    permissionMode: 'bypassPermissions', repo: 'git@example.com:x/y.git', plugins: ['mcp-a'],
    crons: [{ id: 'c1', expr: '0 9 * * *', text: 'hi' }], board: { url: 'https://x/board', createdAt: 1 },
    redactPii: false, preview: { idleMin: 0 }, paused: true,
  }
  const g = { workdir: wd, provider: 'claude', model: 'claude-x', name: 'G1', allowedTools: ['Read'], disallowedTools: ['Bash(sudo *)'], ...extras }
  const cfg = JSON.stringify({ agent: { maxConcurrent: 2 }, defaultProvider: 'claude', providers: { claude: {}, glm: {} }, groups: { oc_g: g }, projectsRoots: [base] })
  await withServer(cfg, async ({ port, token, cfgPath }) => {
    const H = { 'X-Sbot-Token': token, 'Content-Type': 'application/json' }
    const post = async (b) => (await rawReq(port, { method: 'POST', path: '/api/groups', headers: H, body: JSON.stringify(b) })).status
    const read = (id) => JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups[id]
    // 同 provider 重存(弹窗的真实载荷形状)
    assert.equal(await post({ chatId: 'oc_g', workdir: wd, provider: 'claude', name: 'G1 改名' }), 200)
    let after = read('oc_g')
    for (const k of Object.keys(extras)) assert.deepEqual(after[k], extras[k], `重存后 ${k} 必须原样留下`)
    assert.deepEqual(after.allowedTools, ['Read']); assert.deepEqual(after.disallowedTools, ['Bash(sudo *)'])
    assert.equal(after.model, 'claude-x', '同 provider 重存,钉住的模型留下')
    assert.equal(after.name, 'G1 改名', '对照:显式发来的字段要真的更新 —— 否则「都留下」可能只是整个没写')
    // 换 provider:钉住的模型是上一家的型号 id,带过去每轮都会用一个不存在的模型 ⇒ 丢;其余照留
    assert.equal(await post({ chatId: 'oc_g', workdir: wd, provider: 'glm', name: 'G1' }), 200)
    after = read('oc_g')
    assert.equal(after.provider, 'glm'); assert.equal('model' in after, false, '换了 provider,旧模型 id 不能带过去')
    for (const k of Object.keys(extras)) assert.deepEqual(after[k], extras[k], `换 provider 后 ${k} 仍要留下`)
    // 显式给 model 则以给的为准;不发 name 沿用上一次的
    assert.equal(await post({ chatId: 'oc_g', workdir: wd, provider: 'glm', model: 'glm-y' }), 200)
    after = read('oc_g'); assert.equal(after.model, 'glm-y'); assert.equal(after.name, 'G1')
    // 对照:新群只有发来的字段 + 默认 provider,不会从别处凭空长出字段
    assert.equal(await post({ chatId: 'oc_new', workdir: wd }), 200)
    assert.deepEqual(Object.keys(read('oc_new')).sort(), ['platform', 'provider', 'workdir']) // platform 是绑定时钉死的归属(双平台并存),不算凭空
    assert.equal(read('oc_new').provider, 'claude')
  })
})
