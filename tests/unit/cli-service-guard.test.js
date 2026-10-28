// `sintbot service install` 装之前的检查(都用 --dry-run,不动系统):
// 一个聊天平台都没接 ⇒ 照装(1.0.12 起服务先只开控制台,接上平台后自己重启连上),说一句;
// 配置引用了当前 shell 里的环境变量、配置没写代理时 shell 里的代理变量 ⇒ 不问也不说,直接写进服务定义(1.0.13,用户定「安装要精简」);
// --dry-run 打印时值遮住。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const BIN = path.join(__dirname, '..', '..', 'bin', 'sbot.js')

function run(cfg, env = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-svc-guard-'))
  try {
    const home = path.join(tmp, 'home')
    fs.mkdirSync(home)
    const file = path.join(tmp, 'config.json')
    fs.writeFileSync(file, JSON.stringify(cfg), { mode: 0o600 })
    const r = spawnSync(process.execPath, [BIN, 'service', 'install', '--dry-run', '--config', file], {
      cwd: tmp, input: '', encoding: 'utf8', timeout: 20000,
      env: { HOME: home, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: '1', ...env },
    })
    const wrote = fs.readdirSync(home, { recursive: true }).filter((f) => /sbot/.test(String(f)))
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), wrote }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

const base = { providers: { claude: {} }, defaultProvider: 'claude', groups: {} }

test('service install without a chat platform still installs (console-only until one is connected)', { skip: process.platform === 'win32' }, () => {
  for (const cfg of [base, { ...base, feishu: { appId: '', appSecret: '' } }, { ...base, slack: { botToken: 'env:SBOT_T_NOPE', appToken: 'env:SBOT_T_NOPE' } }]) {
    const r = run(cfg, { SINTBOT_LANG: 'zh' })
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /还没接聊天平台:服务先只开控制台/)
    assert.match(r.out, /SBOT_SUPERVISED/)
    assert.deepEqual(r.wrote, [])
  }
})

test('service install carries shell proxy vars only when the config has no proxy, silently and masked', { skip: process.platform === 'win32' }, () => {
  const r = run(base, { SINTBOT_LANG: 'en', https_proxy: 'http://127.0.0.1:7890', no_proxy: 'localhost' })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /https_proxy/)
  assert.match(r.out, /no_proxy/)
  assert.doesNotMatch(r.out, /127\.0\.0\.1:7890/) // 值遮住
  assert.doesNotMatch(r.out, /carried|Write their values/) // 不问也不说
  const withCfgProxy = run({ ...base, proxy: { http: 'http://127.0.0.1:7890' } }, { SINTBOT_LANG: 'en', https_proxy: 'http://127.0.0.1:7890' })
  assert.doesNotMatch(withCfgProxy.out, /https_proxy/)
  const onlyNoProxy = run(base, { SINTBOT_LANG: 'en', no_proxy: 'localhost' })
  assert.doesNotMatch(onlyNoProxy.out, /no_proxy/)
})

test('service install with a platform: env refs from the shell go into the unit without a question, values masked', { skip: process.platform === 'win32' }, () => {
  const cfg = { ...base, slack: { botToken: 'xoxb-1', appToken: 'xapp-1' }, providers: { claude: {}, deepseek: { baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'env:SBOT_T_KEY' } } }
  const r = run(cfg, { SBOT_T_KEY: 'sk-secret-value', SINTBOT_LANG: 'zh' })
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /SBOT_T_KEY/)
  assert.match(r.out, /已隐藏/)
  assert.doesNotMatch(r.out, /写进服务定义吗|只在当前终端里有/)
  assert.doesNotMatch(r.out, /sk-secret-value/)
  assert.deepEqual(r.wrote, [])
})
