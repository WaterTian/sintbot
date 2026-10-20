// Plugin discovery + per-group enablement assembly.
// Fixtures are real temp dirs — the module reads ~/.claude.json / skills dirs /
// .mcp.json, all injectable via the `home` param for hermetic tests.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { globalPlugins, codexPlugins, parseCodexMcpServers, projectPlugins, buildMcpConfig, pluginAllowRules, writeMcpConfigFile, scanSkills, mcpBrowserUrl, browserTargets } = require('../../src/plugins')

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-plug-')) }

function mkSkill(base, name, frontmatter) {
  const d = path.join(base, name)
  fs.mkdirSync(d, { recursive: true })
  if (frontmatter !== null) fs.writeFileSync(path.join(d, 'SKILL.md'), frontmatter)
  return d
}

test('plugins: scanSkills lists only dirs with SKILL.md, pulls frontmatter description', () => {
  const dir = tmpdir()
  mkSkill(dir, 'deploy', '---\nname: deploy\ndescription: 部署到生产\n---\nbody')
  mkSkill(dir, 'nodesc', '---\nname: nodesc\n---\nbody')
  mkSkill(dir, 'not-a-skill', null) // 无 SKILL.md → 不算 skill
  fs.writeFileSync(path.join(dir, 'stray.txt'), 'x') // 非目录 → 忽略
  const out = scanSkills(dir)
  assert.deepEqual(out.map((s) => s.name).sort(), ['deploy', 'nodesc'])
  assert.equal(out.find((s) => s.name === 'deploy').description, '部署到生产')
  assert.equal(out.find((s) => s.name === 'nodesc').description, '')
})

test('plugins: scanSkills on a missing dir returns empty', () => {
  assert.deepEqual(scanSkills('/no/such/dir-sbot-xyz'), [])
})

test('plugins: scanSkills follows symlinked skill dirs (用户 skills 常为符号链接)', () => {
  const real = tmpdir(), skillsDir = tmpdir()
  mkSkill(real, 'linked', '---\ndescription: 链接技能\n---\n')
  fs.symlinkSync(path.join(real, 'linked'), path.join(skillsDir, 'linked'))
  assert.deepEqual(scanSkills(skillsDir), [{ name: 'linked', description: '链接技能' }])
})

test('plugins: globalPlugins reads ~/.claude.json mcpServers + ~/.claude/skills', () => {
  const home = tmpdir()
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: {
      chrome: { command: 'npx', args: ['chrome-mcp'] },
      figma: { type: 'http', url: 'https://mcp.figma.com/x' },
    },
    otherStuff: true,
  }))
  mkSkill(path.join(home, '.claude', 'skills'), 'gskill', '---\ndescription: 全局技能\n---\n')
  const out = globalPlugins(home)
  assert.deepEqual(out.mcp.map((m) => m.name).sort(), ['chrome', 'figma'])
  assert.equal(out.mcp.find((m) => m.name === 'chrome').detail, 'npx chrome-mcp')
  assert.equal(out.mcp.find((m) => m.name === 'figma').detail, 'http · https://mcp.figma.com/x')
  assert.deepEqual(out.skills, [{ name: 'gskill', description: '全局技能', source: '用户级' }])
})

// Codex 有自己的 MCP 库(~/.codex/config.toml,与 Claude 的 ~/.claude.json 两套)。
test('plugins: parseCodexMcpServers extracts stdio + remote, skips .env/.http_headers subtables', () => {
  const toml = `
model = "gpt-5.5"
approval_policy = "never"

# stdio server with a nested env subtable
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[mcp_servers.context7.env]
API_KEY = "secret-should-not-leak"

[mcp_servers.figma]
url = "https://mcp.figma.com/mcp"
bearer_token_env_var = "FIGMA_OAUTH_TOKEN"

[mcp_servers."my-srv"]
command = "node"
args = ["server.js"]
`
  const s = parseCodexMcpServers(toml)
  assert.deepEqual(Object.keys(s).sort(), ['context7', 'figma', 'my-srv'])
  assert.equal(s.context7.command, 'npx')
  assert.deepEqual(s.context7.args, ['-y', '@upstash/context7-mcp'])
  assert.equal(s.context7.env, undefined) // env 子表不并入(不透密钥)
  assert.equal(s.figma.url, 'https://mcp.figma.com/mcp')
  assert.equal(s['my-srv'].command, 'node') // 引号名
})

test('plugins: parseCodexMcpServers handles multi-line args arrays', () => {
  const toml = `[mcp_servers.multi]
command = "npx"
args = [
  "-y",
  "some-mcp",
  "--flag"
]
`
  const s = parseCodexMcpServers(toml)
  assert.deepEqual(s.multi.args, ['-y', 'some-mcp', '--flag'])
})

test('plugins: codexPlugins reads ~/.codex/config.toml → {mcp:[{name,detail,source}]}, missing file ⇒ empty', () => {
  const home = tmpdir()
  assert.deepEqual(codexPlugins(home), { mcp: [] }) // 无文件
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'),
    '[mcp_servers.ctx]\ncommand = "npx"\nargs = ["-y", "ctx-mcp"]\n')
  const out = codexPlugins(home)
  assert.deepEqual(out.mcp, [{ name: 'ctx', detail: 'npx -y ctx-mcp', source: 'codex' }])
})

// 产品口径(2026-07-03 拍板):MCP 库只认用户级(~/.claude.json 顶层),local 登记 /
// 其他项目文件 / Desktop 不聚合;skills 含用户级 + 已装插件(调用名带 插件名: 前缀)。
test('plugins: MCP 只认用户级;插件 skills 带 namespace 纳入', () => {
  const home = tmpdir()
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { chrome: { command: 'user-chrome' } },
    projects: { 'D:\\Projects\\a': { mcpServers: { figma: { command: 'proj-figma' } } } }, // local 登记 → 不进库
  }))
  const proot = path.join(home, 'plugcache', 'bot', '1.0')
  mkSkill(path.join(proot, 'skills'), 'lark-bot', '---\ndescription: 群机器人\n---\n')
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2, plugins: { 'bot@mkt': [{ scope: 'user', installPath: proot }] },
  }))
  const out = globalPlugins(home)
  assert.deepEqual(out.mcp, [{ name: 'chrome', detail: 'user-chrome', source: '用户级' }]) // figma(local 登记)不出现
  assert.deepEqual(out.skills.find((s) => s.name === 'bot:lark-bot'),
    { name: 'bot:lark-bot', description: '群机器人', source: '插件' })
})

test('plugins: globalPlugins with no ~/.claude.json is empty, not a crash', () => {
  const out = globalPlugins(tmpdir())
  assert.deepEqual(out, { mcp: [], skills: [] })
})

test('plugins: projectPlugins reads workdir/.mcp.json + .claude/skills', () => {
  const wd = tmpdir()
  fs.writeFileSync(path.join(wd, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'db-mcp' } } }))
  mkSkill(path.join(wd, '.claude', 'skills'), 'pskill', '---\ndescription: 项目技能\n---\n')
  const out = projectPlugins(wd)
  assert.deepEqual(out.mcp, [{ name: 'db', detail: 'db-mcp' }])
  assert.deepEqual(out.skills, [{ name: 'pskill', description: '项目技能' }])
})

test('plugins: buildMcpConfig = 项目级全部 + 全局按名启用,同名项目级覆盖', () => {
  const home = tmpdir(), wd = tmpdir()
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: { chrome: { command: 'g-chrome' }, figma: { command: 'g-figma' }, db: { command: 'g-db' } },
  }))
  fs.writeFileSync(path.join(wd, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'proj-db' } } }))
  const cfg = buildMcpConfig(wd, ['chrome', 'ghost'], home) // ghost 不存在 → 忽略
  assert.deepEqual(Object.keys(cfg.mcpServers).sort(), ['chrome', 'db'])
  assert.equal(cfg.mcpServers.db.command, 'proj-db') // 项目级覆盖全局同名
  assert.equal(cfg.mcpServers.chrome.command, 'g-chrome')
  // figma 未启用 → 不载入(strict 接管 fail-closed 的核心)
  assert.equal(cfg.mcpServers.figma, undefined)
})

test('plugins: pluginAllowRules maps servers → mcp__名__*,skills → Skill(名)', () => {
  const rules = pluginAllowRules({ mcpServers: { chrome: {}, db: {} } }, ['deploy'])
  assert.deepEqual(rules.sort(), ['Skill(deploy)', 'mcp__chrome__*', 'mcp__db__*'])
  assert.deepEqual(pluginAllowRules({ mcpServers: {} }, []), [])
})

test('plugins: writeMcpConfigFile writes a stable per-workdir path under home/.sbot/mcp', () => {
  const home = tmpdir()
  const f1 = writeMcpConfigFile('/proj/a', { mcpServers: { x: {} } }, home)
  const f2 = writeMcpConfigFile('/proj/a', { mcpServers: { y: {} } }, home)
  assert.equal(f1, f2) // 同 workdir → 同路径覆盖写,无清理负担
  assert.deepEqual(JSON.parse(fs.readFileSync(f2, 'utf8')), { mcpServers: { y: {} } })
  const f3 = writeMcpConfigFile('/proj/b', { mcpServers: {} }, home)
  assert.notEqual(f1, f3) // 不同 workdir → 不同文件
})

// #4 并发写锁:唯一 temp 名 → rename 后不留 .tmp 残留;写时回收 >1h 的孤儿 temp。
test('plugins: writeMcpConfigFile 原子写不留 temp 残留,并清理旧孤儿', () => {
  const home = tmpdir()
  writeMcpConfigFile('/proj/a', { mcpServers: { x: {} } }, home)
  const dir = path.join(home, '.sbot', 'mcp')
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []) // rename 后无 temp 残留
  // 造一个 2h 前的孤儿 .tmp(模拟写到一半崩溃),下次写应被清掉
  const orphan = path.join(dir, 'deadbeef.999.0.tmp')
  fs.writeFileSync(orphan, 'garbage')
  const old = Date.now() / 1000 - 2 * 3600
  fs.utimesSync(orphan, old, old)
  writeMcpConfigFile('/proj/b', { mcpServers: {} }, home)
  assert.equal(fs.existsSync(orphan), false) // 孤儿被回收
})

// ── 常驻浏览器指向(doctor 探活的数据源)────────────────────────────────────────

test('plugins: mcpBrowserUrl 解析 --browserUrl=… / -u / 分离参数;无则 null', () => {
  assert.equal(mcpBrowserUrl({ args: ['--browserUrl=http://127.0.0.1:9222', '--headless'] }), 'http://127.0.0.1:9222')
  assert.equal(mcpBrowserUrl({ args: ['-u', 'http://h:1'] }), 'http://h:1')
  assert.equal(mcpBrowserUrl({ args: ['--browserUrl', 'http://h:2'] }), 'http://h:2')
  assert.equal(mcpBrowserUrl({ args: ['--headless'] }), null)
  assert.equal(mcpBrowserUrl({}), null)
  assert.equal(mcpBrowserUrl({ args: ['--browserUrl='] }), null) // 空值不算指向
})

test('plugins: browserTargets 汇总两侧(用户级 + codex)指向;缺文件为空不崩', () => {
  const home = tmpdir()
  assert.deepEqual(browserTargets(home), [])
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
    mcpServers: {
      'chrome-devtools': { command: 'x', args: ['--browserUrl=http://127.0.0.1:9222'] },
      other: { command: 'y' }, // 无 browserUrl → 不出现
    },
  }))
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true })
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'),
    '[mcp_servers.chrome-devtools]\ncommand = "x"\nargs = ["--browserUrl=http://127.0.0.1:9222", "--screenshotFormat=jpeg"]\n')
  assert.deepEqual(browserTargets(home), [
    { source: '用户级', name: 'chrome-devtools', url: 'http://127.0.0.1:9222' },
    { source: 'codex', name: 'chrome-devtools', url: 'http://127.0.0.1:9222' },
  ])
})

// ── MCP 可达性预检 ───────────────────────────────────────────────────────────
// 全部注入探针 ⇒ **零网络、零真实文件系统探测**。要治的现场:一个没起的本地 http MCP
// 被勾进群里,每一轮 spawn 都替它付一次启动失败,而三处(体检/控制台/群里)都不吭声。

const { mcpProbeTarget, isLocalHost, probeMcp, probeMcpServers, resetProbeCache, PROBE_TTL_OK_MS, PROBE_TTL_DOWN_MS } = require('../../src/plugins')

// 探针替身:tcp 按 host:port 查表,exec 按命令查表;都记录被调次数(验缓存用)
function fakeProbes(tcpTable = {}, execTable = {}) {
  const calls = { tcp: 0, exec: 0 }
  return {
    calls,
    tcp: async (host, port) => { calls.tcp++; return tcpTable[`${host}:${port}`] || { ok: false, code: 'ECONNREFUSED' } },
    exec: (cmd) => { calls.exec++; return execTable[cmd] || { ok: false, code: 'ENOENT', path: cmd } },
  }
}

test('plugins: mcpProbeTarget 分流 http / stdio,判不了的形态明说', () => {
  assert.deepEqual(mcpProbeTarget({ type: 'http', url: 'http://127.0.0.1:27182/mcp' }),
    { kind: 'http', url: 'http://127.0.0.1:27182/mcp', host: '127.0.0.1', port: 27182, local: true })
  assert.equal(mcpProbeTarget({ type: 'sse', url: 'https://mcp.example.com/sse' }).port, 443) // 默认端口按协议
  assert.equal(mcpProbeTarget({ url: 'http://0.0.0.0:9000' }).host, '127.0.0.1') // 绑定地址不是连接目标
  assert.deepEqual(mcpProbeTarget({ type: 'stdio', command: '/usr/local/bin/x-mcp' }),
    { kind: 'stdio', command: '/usr/local/bin/x-mcp', bare: false })
  assert.equal(mcpProbeTarget({ command: 'npx', args: ['-y', 'p'] }).bare, true) // 裸名 → 走 PATH
  // 判不了的三种:相对路径(cwd 是群 workdir,本进程算不出)/ 非 http 端点 / 什么都没有
  assert.equal(mcpProbeTarget({ command: './bin/x' }).kind, 'none')
  assert.equal(mcpProbeTarget({ url: 'ws://127.0.0.1:1' }).kind, 'none')
  assert.equal(mcpProbeTarget({ url: 'not a url' }).kind, 'none')
  assert.equal(mcpProbeTarget({}).kind, 'none')
  // 手写成一整串的 command:整串查 PATH 必 ENOENT ⇒ 若照探会被错判 down 而跳过,违反「宁可漏跳过」⇒ 不探
  assert.equal(mcpProbeTarget({ command: 'npx -y pkg' }).kind, 'none')
  // IPv6 环回:WHATWG URL 的 hostname 带方括号,连接时要剥掉,且要算本机(否则永远 unknown、永远判不了 down)
  assert.equal(mcpProbeTarget({ url: 'http://[::1]:8080/mcp' }).host, '::1')
  assert.equal(mcpProbeTarget({ url: 'http://[::1]:8080/mcp' }).local, true)
})

test('plugins: isLocalHost 认本机与内网,公网一律不认', () => {
  for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '10.0.0.5', '192.168.1.7', '172.16.0.1', '172.31.255.9'])
    assert.equal(isLocalHost(h), true, h)
  for (const h of ['mcp.example.com', '8.8.8.8', '172.15.0.1', '172.32.0.1', ''])
    assert.equal(isLocalHost(h), false, h)
})

test('plugins: http MCP 端口在听 → ok', async () => {
  const p = fakeProbes({ '127.0.0.1:27182': { ok: true } })
  const r = await probeMcp('fusion', { type: 'http', url: 'http://127.0.0.1:27182/mcp' }, p)
  assert.equal(r.status, 'ok')
})

test('plugins: 本机 http MCP 连接被拒 → down(这就是现场那个 fusion)', async () => {
  const p = fakeProbes({}) // 默认 ECONNREFUSED
  const r = await probeMcp('fusion', { type: 'http', url: 'http://127.0.0.1:27182/mcp' }, p)
  assert.equal(r.status, 'down')
  assert.match(r.detail, /连不上/)
  assert.match(r.detail, /ECONNREFUSED/)
})

// ⚠ 保守偏向的两条硬边界 —— 错跳过比漏跳过贵得多(能力凭空消失且没人知道为什么)
test('plugins: 公网 http MCP 直连被拒也只算 unknown(daemon 直连不走代理,不能替子进程下结论)', async () => {
  const p = fakeProbes({})
  const r = await probeMcp('figma', { type: 'http', url: 'https://mcp.figma.com/mcp' }, p)
  assert.equal(r.status, 'unknown')
})

test('plugins: 本机 http 超时只算 unknown(短超时可能误判慢启动的服务)', async () => {
  const p = fakeProbes({ '127.0.0.1:27182': { ok: false, code: 'ETIMEDOUT' } })
  const r = await probeMcp('fusion', { type: 'http', url: 'http://127.0.0.1:27182/mcp' }, p)
  assert.equal(r.status, 'unknown')
})

test('plugins: stdio MCP 可执行文件在 → ok;不在 / 没权限 → down', async () => {
  const p = fakeProbes({}, { '/usr/local/bin/ok-mcp': { ok: true, path: '/usr/local/bin/ok-mcp' }, '/usr/local/bin/no-x': { ok: false, code: 'EACCES', path: '/usr/local/bin/no-x' } })
  assert.equal((await probeMcp('a', { command: '/usr/local/bin/ok-mcp' }, p)).status, 'ok')
  assert.equal((await probeMcp('b', { command: '/usr/local/bin/gone' }, p)).status, 'down')
  const noX = await probeMcp('c', { command: '/usr/local/bin/no-x' }, p)
  assert.equal(noX.status, 'down')
  assert.match(noX.detail, /可执行权限/)
  const bare = await probeMcp('d', { command: 'nope-mcp' }, p)
  assert.equal(bare.status, 'down')
  assert.match(bare.detail, /PATH/) // 裸名与绝对路径的说法要不一样(下一步动作不同)
})

test('plugins: 判不了的形态是 unprobed,不占体检行、也绝不跳过', async () => {
  const r = await probeMcp('rel', { command: './bin/x' }, fakeProbes())
  assert.equal(r.status, 'unprobed')
})

test('plugins: probeMcpServers 有 TTL 缓存 —— 窗口内不重复探,过期后重探', async () => {
  resetProbeCache()
  const p = fakeProbes({ '127.0.0.1:1': { ok: true } })
  const defs = { srv: { url: 'http://127.0.0.1:1/mcp' } }
  const t0 = 1_000_000
  assert.equal((await probeMcpServers(defs, { ...p, now: t0 }))[0].status, 'ok')
  assert.equal(p.calls.tcp, 1)
  const again = await probeMcpServers(defs, { ...p, now: t0 + PROBE_TTL_OK_MS - 1 })
  assert.equal(again[0].cached, true)
  assert.equal(p.calls.tcp, 1) // 窗口内没有再探
  await probeMcpServers(defs, { ...p, now: t0 + PROBE_TTL_OK_MS })
  assert.equal(p.calls.tcp, 2) // 过期重探
})

// ⚠ down 的缓存**故意更短**:用户看到警告就会去把服务起起来,拉黑久了等于「探一次永久失效」;
//    而复探一个被拒的端口是立刻返回的(不吃超时),几乎不花钱。
test('plugins: down 的缓存寿命短于 ok —— 服务起来后能较快恢复', async () => {
  resetProbeCache()
  const p = fakeProbes({}) // 一律 ECONNREFUSED
  const defs = { srv: { url: 'http://127.0.0.1:1/mcp' } }
  const t0 = 2_000_000
  assert.equal((await probeMcpServers(defs, { ...p, now: t0 }))[0].status, 'down')
  assert.equal(p.calls.tcp, 1)
  await probeMcpServers(defs, { ...p, now: t0 + PROBE_TTL_DOWN_MS - 1 })
  assert.equal(p.calls.tcp, 1)
  await probeMcpServers(defs, { ...p, now: t0 + PROBE_TTL_DOWN_MS })
  assert.equal(p.calls.tcp, 2)
  assert.ok(PROBE_TTL_DOWN_MS < PROBE_TTL_OK_MS)
})

test('plugins: 改了 url/command 缓存立刻失效(不拿旧结论套新配置)', async () => {
  resetProbeCache()
  const p = fakeProbes({ '127.0.0.1:1': { ok: true }, '127.0.0.1:2': { ok: true } })
  const t0 = 3_000_000
  await probeMcpServers({ srv: { url: 'http://127.0.0.1:1/mcp' } }, { ...p, now: t0 })
  await probeMcpServers({ srv: { url: 'http://127.0.0.1:2/mcp' } }, { ...p, now: t0 })
  assert.equal(p.calls.tcp, 2)
})

// ── 跳过注入 ────────────────────────────────────────────────────────────────

function homeWith(servers) {
  const home = tmpdir()
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: servers }))
  return home
}

test('plugins: buildMcpConfig 跳过「新鲜的 down」,ok / unknown 照常注入', async () => {
  resetProbeCache()
  const home = homeWith({
    dead: { url: 'http://127.0.0.1:27182/mcp' },        // 本机被拒 → down
    live: { url: 'http://127.0.0.1:9222/mcp' },          // 在听 → ok
    far: { url: 'https://mcp.example.com/mcp' },         // 公网直连没通 → unknown
  })
  const wd = tmpdir()
  const p = fakeProbes({ '127.0.0.1:9222': { ok: true } })
  const t0 = 4_000_000
  await probeMcpServers({ dead: { url: 'http://127.0.0.1:27182/mcp' }, live: { url: 'http://127.0.0.1:9222/mcp' }, far: { url: 'https://mcp.example.com/mcp' } }, { ...p, now: t0 })
  const logs = []
  const cfg = buildMcpConfig(wd, ['dead', 'live', 'far'], home, { now: t0, refresh: false, log: (m) => logs.push(m) })
  assert.deepEqual(Object.keys(cfg.mcpServers).sort(), ['far', 'live']) // dead 被跳过
  assert.equal(logs.length, 1) // 留痕一行,不刷屏
  assert.match(logs[0], /dead/)
  assert.match(logs[0], /跳过/)
})

// 「没探过」必须等于「不跳过」—— 否则 daemon 刚起的第一轮会把好服务全挡在外面
test('plugins: 缓存里没有结论时一律照常注入(第一轮永不误伤)', () => {
  resetProbeCache()
  const home = homeWith({ dead: { url: 'http://127.0.0.1:27182/mcp' } })
  const cfg = buildMcpConfig(tmpdir(), ['dead'], home, { refresh: false })
  assert.deepEqual(Object.keys(cfg.mcpServers), ['dead'])
})

test('plugins: down 结论过期后也不再跳过(拉黑不会永久)', async () => {
  resetProbeCache()
  const home = homeWith({ dead: { url: 'http://127.0.0.1:27182/mcp' } })
  const t0 = 5_000_000
  await probeMcpServers({ dead: { url: 'http://127.0.0.1:27182/mcp' } }, { ...fakeProbes({}), now: t0 })
  assert.deepEqual(Object.keys(buildMcpConfig(tmpdir(), ['dead'], home, { now: t0, refresh: false }).mcpServers), [])
  assert.deepEqual(Object.keys(buildMcpConfig(tmpdir(), ['dead'], home, { now: t0 + PROBE_TTL_DOWN_MS, refresh: false }).mcpServers), ['dead'])
})

// 管辖范围:只管「用户级 + 群里勾选」的那批。项目自带的 .mcp.json 是项目的事,不是群门控的事。
test('plugins: 项目级 .mcp.json 即使同名 down 也照常载入', async () => {
  resetProbeCache()
  const home = homeWith({ db: { url: 'http://127.0.0.1:27182/mcp' } })
  const wd = tmpdir()
  fs.writeFileSync(path.join(wd, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'proj-db' } } }))
  const t0 = 6_000_000
  await probeMcpServers({ db: { url: 'http://127.0.0.1:27182/mcp' } }, { ...fakeProbes({}), now: t0 })
  const cfg = buildMcpConfig(wd, ['db'], home, { now: t0, refresh: false })
  assert.equal(cfg.mcpServers.db.command, 'proj-db')
})

test('plugins: 跳过日志按名节流,不会每轮刷屏', async () => {
  resetProbeCache()
  const home = homeWith({ dead: { url: 'http://127.0.0.1:27182/mcp' } })
  const t0 = 7_000_000
  const p = fakeProbes({})
  const logs = []
  const opts = { refresh: false, log: (m) => logs.push(m) }
  for (let i = 0; i < 5; i++) {
    await probeMcpServers({ dead: { url: 'http://127.0.0.1:27182/mcp' } }, { ...p, now: t0 + i * 1000, force: true })
    buildMcpConfig(tmpdir(), ['dead'], home, { ...opts, now: t0 + i * 1000 })
  }
  assert.equal(logs.length, 1) // 五轮只说一次
})

// 变异检验:把跳过判据从 'down' 改成任何一档,上面「unknown 照常注入」那条就会红。
test('plugins: 跳过的唯一判据是 down,unknown 绝不跳过', async () => {
  resetProbeCache()
  const home = homeWith({ far: { url: 'https://mcp.example.com/mcp' } })
  const t0 = 8_000_000
  const res = await probeMcpServers({ far: { url: 'https://mcp.example.com/mcp' } }, { ...fakeProbes({}), now: t0 })
  assert.equal(res[0].status, 'unknown')
  assert.deepEqual(Object.keys(buildMcpConfig(tmpdir(), ['far'], home, { now: t0, refresh: false }).mcpServers), ['far'])
})
