// 还没接聊天平台时的 `sintbot start --ui`(后台服务就是这么起的):不退出,只开控制台;
// 由服务托管(SBOT_SUPERVISED=1)时,配置里第一次出现配齐的平台就自己退出(退出码 0),让 launchd / systemd 拉起来连上。
// 1.0.10–1.0.11 没平台时服务不装、守护进程一起就退出,装完连控制台都打不开。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')

const BIN = path.join(__dirname, '..', '..', 'bin', 'sbot.js')

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.unref(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)) }) })
const until = async (fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, 150)) } }

test('start --ui without a platform serves the console and, when supervised, exits once a platform is saved', { skip: process.platform === 'win32', timeout: 40000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-setup-console-'))
  const home = path.join(tmp, 'home')
  fs.mkdirSync(home)
  const cfgPath = path.join(tmp, 'config.json')
  const cfg = { providers: { claude: {} }, defaultProvider: 'claude', groups: {} }
  fs.writeFileSync(cfgPath, JSON.stringify(cfg), { mode: 0o600 })
  const port = await freePort()
  let out = ''
  const child = spawn(process.execPath, [BIN, 'start', '--ui', '--no-open', '--ui-port', String(port), '--config', cfgPath], {
    cwd: tmp, env: { HOME: home, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, NO_COLOR: '1', SBOT_SUPERVISED: '1' },
  })
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  const exited = new Promise((res) => child.on('exit', (code) => res(code)))
  try {
    const up = await until(async () => { try { return (await fetch(`http://127.0.0.1:${port}/`)).status } catch { return null } }, 15000)
    assert.equal(up, 200, out)
    assert.match(out, /还没接聊天平台,只开控制台/)
    assert.equal(child.exitCode, null, 'must keep running without a platform')
    // 控制台里填好 Slack 凭据(这里直接改配置文件 —— 控制台保存走的也是写这份文件)
    fs.writeFileSync(cfgPath, JSON.stringify({ ...cfg, slack: { botToken: 'xoxb-1', appToken: 'xapp-1' } }), { mode: 0o600 })
    const code = await Promise.race([exited, new Promise((r) => setTimeout(() => r('timeout'), 15000))])
    assert.equal(code, 0, out)
    assert.match(out, /已接上 slack —— 3 秒后重启守护进程连上/)
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
