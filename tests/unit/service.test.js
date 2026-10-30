// `sbot service` 的单元文件全由纯函数生成 —— 这里钉住生成结果;真正动系统的 launchctl / systemctl 不在单测里跑。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const svc = require('../../src/service')

const SPEC = svc.serviceSpec({
  nodeBin: '/opt/node/bin/node',
  sbotBin: '/opt/lib/node_modules/sintbot/bin/sbot.js',
  configPath: '/Users/me/.sbot/config.json',
  uiHost: '0.0.0.0',
  home: '/Users/me',
  pathEnv: '/opt/node/bin:/usr/bin:/bin',
})

test('service: spec 固定 node / 入口 / 配置的绝对路径,cwd 跟着配置走', () => {
  assert.deepEqual(SPEC.args, ['/opt/lib/node_modules/sintbot/bin/sbot.js', 'start', '--ui', '--no-open', '--ui-host', '0.0.0.0', '--config', '/Users/me/.sbot/config.json'])
  assert.equal(SPEC.workdir, '/Users/me/.sbot')
  assert.equal(SPEC.errLog, '/Users/me/.sbot/logs/err.log')
  // 对照组:不给 uiHost / configPath 就不带这两组参数,cwd 退到 ~/.sbot
  const bare = svc.serviceSpec({ nodeBin: 'n', sbotBin: 's', home: '/h', pathEnv: '' })
  assert.deepEqual(bare.args, ['s', 'start', '--ui', '--no-open'])
  assert.equal(bare.workdir, '/h/.sbot')
})

test('service: launchd plist 带保活 / 登录即起 / PATH / 日志,参数逐个成 <string>', () => {
  const x = svc.launchdPlist(SPEC)
  assert.match(x, /<key>Label<\/key><string>com\.sbot\.daemon<\/string>/)
  assert.match(x, /<key>KeepAlive<\/key><true\/>/)
  assert.match(x, /<key>RunAtLoad<\/key><true\/>/)
  assert.match(x, /<key>PATH<\/key><string>\/opt\/node\/bin:\/usr\/bin:\/bin<\/string>/)
  assert.match(x, /<string>\/opt\/node\/bin\/node<\/string>\n {4}<string>\/opt\/lib\/node_modules\/sintbot\/bin\/sbot\.js<\/string>\n {4}<string>start<\/string>/)
  assert.match(x, /<key>StandardErrorPath<\/key><string>\/Users\/me\/\.sbot\/logs\/err\.log<\/string>/)
})

test('service: plist 里的路径做 XML 转义(& < > " 不许破坏文档)', () => {
  const s = svc.serviceSpec({ nodeBin: '/a&b/node', sbotBin: '/x<y>/sbot.js', configPath: '/c "q"/config.json', home: '/h', pathEnv: '/p' })
  const x = svc.launchdPlist(s)
  assert.match(x, /<string>\/a&amp;b\/node<\/string>/)
  assert.match(x, /<string>\/x&lt;y&gt;\/sbot\.js<\/string>/)
  assert.match(x, /\/c &quot;q&quot;\/config\.json/)
  assert.doesNotMatch(x, /\/a&b\//)
})

test('service: systemd 单元 —— Restart=always、优雅停、参数按需加引号', () => {
  const u = svc.systemdUnit(SPEC)
  assert.match(u, /^ExecStart=\/opt\/node\/bin\/node \/opt\/lib\/node_modules\/sintbot\/bin\/sbot\.js start --ui --no-open --ui-host 0\.0\.0\.0 --config \/Users\/me\/\.sbot\/config\.json$/m)
  assert.match(u, /^Restart=always$/m)
  assert.match(u, /^KillSignal=SIGTERM$/m)
  assert.match(u, /^Environment=PATH=\/opt\/node\/bin:\/usr\/bin:\/bin$/m) // 无特殊字符不加引号(systemd 两种都认)
  assert.match(u, /^WantedBy=default\.target$/m)
  // 带空格 / $ / % 的参数:加双引号,$ 与 % 按 systemd 规则双写
  assert.equal(svc.sdQuote('/My Projects/a'), '"/My Projects/a"')
  assert.equal(svc.sdQuote('a$b'), '"a$$b"')
  assert.equal(svc.sdQuote('50%'), '"50%%"')
  assert.equal(svc.sdQuote('plain'), 'plain')
})

test('service: PATH 优先目录在前、去重去空', () => {
  assert.equal(svc.buildPath(['/n', '/c', '/n'], '/usr/bin::/c:/bin'), '/n:/c:/usr/bin:/bin')
  assert.equal(svc.buildPath([], 'C:\\a;C:\\b', ';'), 'C:\\a;C:\\b')
})

test('service: 单元文件位置按平台;Windows 不自动装、只给现成命令', () => {
  assert.equal(svc.unitPath('darwin', '/Users/me'), '/Users/me/Library/LaunchAgents/com.sbot.daemon.plist')
  assert.equal(svc.unitPath('linux', '/home/me'), '/home/me/.config/systemd/user/sbot.service')
  assert.equal(svc.unitPath('win32', 'C:\\Users\\me'), null)
  assert.equal(svc.render('win32', SPEC), null)
  const h = svc.windowsHint(SPEC)
  assert.match(h, /nssm install SintBot/)
  assert.match(h, /pm2 start/)
  assert.match(h, /--config \/Users\/me\/\.sbot\/config\.json/)
})

// ── node 路径:不能是带版本号的路径(Homebrew 升级 node 后 Cellar 旧目录被删,服务就起不来)──
test('service: stableNodeBin —— Homebrew Cellar 换成同一文件的 <prefix>/bin/node', () => {
  const real = { '/opt/homebrew/bin/node': '/opt/homebrew/Cellar/node/26.0.0/bin/node', '/opt/homebrew/Cellar/node/26.0.0/bin/node': '/opt/homebrew/Cellar/node/26.0.0/bin/node' }
  const r = svc.stableNodeBin({ execPath: '/opt/homebrew/Cellar/node/26.0.0/bin/node', exists: (p) => p in real, realpath: (p) => real[p] })
  assert.deepEqual(r, { bin: '/opt/homebrew/bin/node' })
})

test('service: stableNodeBin —— <prefix>/bin/node 指着别的版本时退到 opt/<formula>(node@22 这类 keg-only)', () => {
  const exe = '/opt/homebrew/Cellar/node@22/22.20.0/bin/node'
  const real = { '/opt/homebrew/bin/node': '/opt/homebrew/Cellar/node/26.0.0/bin/node', '/opt/homebrew/opt/node@22/bin/node': exe, [exe]: exe }
  const r = svc.stableNodeBin({ execPath: exe, exists: (p) => p in real, realpath: (p) => real[p] })
  assert.deepEqual(r, { bin: '/opt/homebrew/opt/node@22/bin/node' })
})

test('service: stableNodeBin —— PATH 上的候选只在指向同一文件时才用;nvm 找不到稳定路径就照用并提醒', () => {
  const exe = '/Users/me/.nvm/versions/node/v22.16.0/bin/node'
  const other = svc.stableNodeBin({ execPath: exe, candidates: ['/usr/local/bin/node'], exists: () => true, realpath: (p) => p })
  assert.equal(other.bin, exe, '/usr/local/bin/node 是另一个 node,不能拿来顶')
  assert.match(other.warn, /带版本号.*重跑 sintbot service install/)
  const same = svc.stableNodeBin({ execPath: exe, candidates: ['/Users/me/bin/node'], exists: () => true, realpath: () => exe })
  assert.deepEqual(same, { bin: '/Users/me/bin/node' })
  // 对照组:本来就不带版本号的路径原样返回、不提醒
  assert.deepEqual(svc.stableNodeBin({ execPath: '/usr/local/bin/node' }), { bin: '/usr/local/bin/node' })
})

test('service: versionedPath 认得几种带版本号的安装位置', () => {
  for (const p of ['/opt/homebrew/Cellar/node/26.0.0/bin/node', '/Users/me/.nvm/versions/node/v22.1.0/bin/node', '/Users/me/.volta/tools/image/node/22.1.0/bin/node', '/x/node-v22.16.0-darwin-arm64/bin/node'])
    assert.ok(svc.versionedPath(p), p)
  for (const p of ['/usr/local/bin/node', '/opt/homebrew/bin/node', '/opt/homebrew/opt/node@22/bin/node', '/usr/bin/node'])
    assert.ok(!svc.versionedPath(p), p)
})

// ── 环境变量:服务进程拿不到装的人 shell 里的变量 ──
test('service: envRefs 收集配置里全部 env:VAR(去重、深层、数组里也找)', () => {
  const raw = { feishu: { appId: 'env:FEISHU_APP_ID', appSecret: 'env:FEISHU_APP_SECRET' }, providers: { a: { apiKey: 'env:K' }, b: { apiKey: 'env:K' }, c: { apiKey: 'sk-literal' } }, x: ['env:ARR'], note: '说明里提到 env:NOT_A_REF 不算',
    _slack_example: { botToken: 'env:SLACK_BOT_TOKEN' }, feishu2: { _note: 'env:IN_NOTE' } } // 下划线键 = 说明 / 示例,运行时不读
  assert.deepEqual(svc.envRefs(raw), ['FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'K', 'ARR'])
})

test('service: --pass-env 的变量写进 plist / systemd 单元,值照样转义;不给就不写', () => {
  const s = svc.serviceSpec({ nodeBin: '/n', sbotBin: '/s', home: '/h', pathEnv: '/p', env: { K: 'a&b<c', Q: 'x y$z' } })
  const x = svc.launchdPlist(s)
  assert.match(x, /<key>PATH<\/key><string>\/p<\/string>\n {4}<key>K<\/key><string>a&amp;b&lt;c<\/string>\n {4}<key>Q<\/key><string>x y\$z<\/string>\n {4}<key>SBOT_SUPERVISED<\/key><string>1<\/string>\n {2}<\/dict>/)
  const u = svc.systemdUnit(s)
  assert.match(u, /^Environment=K=a&b<c$/m)
  assert.match(u, /^Environment="Q=x y\$\$z"$/m)
  // 对照组:没有 env 时 EnvironmentVariables 只有 PATH 和托管标记
  assert.doesNotMatch(svc.launchdPlist(SPEC), /<key>K<\/key>/)
  assert.deepEqual(svc.systemdUnit(SPEC).match(/^Environment=.*$/gm), ['Environment=PATH=' + SPEC.pathEnv, 'Environment=SBOT_SUPERVISED=1'])
  assert.match(svc.launchdPlist(SPEC), /<key>SBOT_SUPERVISED<\/key><string>1<\/string>/)
})

// launchctl is injected here: these regressions must never touch the real
// com.sbot.daemon job while the production service is running.
function withServiceHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sintbot-service-test-'))
  try { fn(home) } finally { fs.rmSync(home, { recursive: true, force: true }) }
}
function serviceTestSpec(home) {
  return svc.serviceSpec({ nodeBin: '/opt/node/bin/node', sbotBin: '/opt/lib/node_modules/sintbot/bin/sbot.js',
    configPath: path.join(home, '.sbot', 'config.json'), uiHost: '0.0.0.0', home, pathEnv: '/opt/node/bin:/usr/bin:/bin' })
}

test('service: macOS reinstall waits for bootout to finish before bootstrap', () => withServiceHome((home) => {
  const calls = []
  let prints = 0
  const runCommand = (bin, args) => {
    calls.push([bin, ...args])
    if (args[0] === 'bootout') return { ok: true, out: '' }
    if (args[0] === 'print') {
      prints++
      return prints < 3
        ? { ok: true, out: 'state = running' }
        : { ok: false, err: 'Could not find service "gui/501/com.sbot.daemon" in domain' }
    }
    if (args[0] === 'bootstrap') return { ok: true, out: '' }
    throw new Error(`unexpected command: ${bin} ${args.join(' ')}`)
  }
  const spec = serviceTestSpec(home)
  const r = svc.install(spec, { platform: 'darwin', home, runCommand, wait: () => {}, launchdTimeoutMs: 200, launchdPollMs: 100 })
  assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps))
  assert.equal(calls.filter((c) => c[1] === 'bootstrap').length, 1)
  assert.ok(calls.findIndex((c) => c[1] === 'bootstrap') > calls.findLastIndex((c) => c[1] === 'print'))
}))

test('service: macOS first install treats only a known missing job as normal', () => withServiceHome((home) => {
  const calls = []
  const runCommand = (bin, args) => {
    calls.push([bin, ...args])
    if (args[0] === 'bootout' || args[0] === 'print') return { ok: false, err: 'Could not find service in domain' }
    if (args[0] === 'bootstrap') return { ok: true, out: '' }
    throw new Error(`unexpected command: ${bin} ${args.join(' ')}`)
  }
  const r = svc.install(serviceTestSpec(home), { platform: 'darwin', home, runCommand, wait: () => {} })
  assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps))
  assert.ok(calls.some((c) => c[1] === 'bootstrap'))
}))

test('service: macOS unexpected bootout errors stop before bootstrap', () => withServiceHome((home) => {
  const calls = []
  const runCommand = (bin, args) => {
    calls.push([bin, ...args])
    return { ok: false, err: 'Operation not permitted', code: 1 }
  }
  const r = svc.install(serviceTestSpec(home), { platform: 'darwin', home, runCommand, wait: () => {} })
  assert.equal(r.steps[0].ok, false)
  assert.ok(!calls.some((c) => c[1] === 'bootstrap'))
}))

test('service: macOS timeout refuses to race into bootstrap', () => withServiceHome((home) => {
  const calls = []
  const runCommand = (bin, args) => {
    calls.push([bin, ...args])
    return args[0] === 'bootout' ? { ok: true } : { ok: true, out: 'state = running' }
  }
  const r = svc.install(serviceTestSpec(home), { platform: 'darwin', home, runCommand, wait: () => {}, launchdTimeoutMs: 2, launchdPollMs: 1 })
  assert.ok(r.steps.some((s) => !s.ok && s.cmd === 'launchctl wait for bootout'))
  assert.ok(!calls.some((c) => c[1] === 'bootstrap'))
}))

test('service: macOS retries one launchd EIO race after confirming the job is still absent', () => withServiceHome((home) => {
  const calls = []
  const runCommand = (bin, args) => {
    calls.push([bin, ...args])
    if (args[0] === 'bootout') return { ok: true }
    if (args[0] === 'print') return { ok: false, err: 'Could not find service in domain' }
    if (args[0] === 'bootstrap' && calls.filter((c) => c[1] === 'bootstrap').length === 1)
      return { ok: false, err: 'Bootstrap failed: 5: Input/output error', code: 5 }
    if (args[0] === 'bootstrap') return { ok: true }
    throw new Error(`unexpected command: ${bin} ${args.join(' ')}`)
  }
  const r = svc.install(serviceTestSpec(home), { platform: 'darwin', home, runCommand, wait: () => {} })
  assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps))
  assert.equal(calls.filter((c) => c[1] === 'bootstrap').length, 2)
}))
