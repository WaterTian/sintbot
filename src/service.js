// `sbot service` —— 把 `sbot start` 装成常驻服务:崩溃自动拉起、登录(或开机)自启。
//
// 平台:macOS = launchd LaunchAgent(GUI 域,随用户登录起)· Linux = systemd --user。
// Windows 不自动装:服务化要第三方托管器(NSSM / pm2),这里只打印现成命令(docs/install.md)。
//
// 结构:单元文件全由纯函数生成(可单测、`--dry-run` 原样打印);真正动系统的只有 install /
// uninstall / restart / status 里那几行 launchctl / systemctl,出错如实报、不吞。
//
// ⚠ 服务里跑的是**当前这份** node 与 sbot 入口的绝对路径,并且显式带 `--config <绝对路径>` ——
//   常驻进程的 cwd 与 PATH 都不是装的人那一刻的 shell,靠「从当前目录找配置」或「PATH 里找 node」
//   在常驻环境里会静默找错 / 找不到。
// ⚠ node 路径不能直接用 process.execPath:Homebrew 下它是带版本号的 Cellar 路径
//   (/opt/homebrew/Cellar/node/26.0.0/bin/node),升级 node 后旧目录被删,服务就再也起不来 ⇒
//   换成指向同一个可执行文件、但不带版本号的路径(stableNodeBin);找不到就照用并提醒。
// ⚠ 服务进程拿不到装的人 shell 里的环境变量:配置里 `env:VAR` 引用的 key 在终端里解析得到,
//   到了 launchd / systemd 里就是空的 ⇒ install 时点名;`--pass-env` 才把值写进单元文件(权限 600)。
// ⚠ PATH 取装的那一刻的 shell PATH,并把 node / claude / codex 所在目录排在最前:agent 要 spawn
//   `claude` / `codex`,launchd 给的默认 PATH 只有 /usr/bin:/bin,nvm / homebrew 装的都找不到。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const LABEL = 'com.sbot.daemon'      // launchd 标签(与早期手写 plist 同名 ⇒ 装新版直接替换旧的)
const UNIT = 'sbot.service'          // systemd --user 单元名

function xmlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// systemd ExecStart 的单个参数:含空白 / 引号 / 反斜杠 / $ / % 才加双引号并转义
function sdQuote(s) {
  s = String(s)
  if (!/[\s"'\\$%;]/.test(s) && s !== '') return s
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '$$$$').replace(/%/g, '%%') + '"'
}

// PATH:优先目录在前,其后是现有 PATH,去重去空
function buildPath(firstDirs, existing, delimiter = ':') {
  const out = []
  for (const d of [...firstDirs, ...String(existing || '').split(delimiter)]) {
    if (d && !out.includes(d)) out.push(d)
  }
  return out.join(delimiter)
}

// 路径里带版本号的(Homebrew Cellar / nvm / volta / fnm / asdf / n,或任何 x.y.z 目录段):
// 换版本后这个路径就不在了
function versionedPath(p) {
  return /\/Cellar\/|\/\.nvm\/versions\/|\/\.volta\/tools\/image\/|\/fnm\/node-versions\/|\/\.asdf\/installs\/|\/n\/versions\//.test(String(p))
    || /\/[^/]*\d+\.\d+\.\d+[^/]*\//.test(String(p))
}

// 给服务用的 node 路径:与 execPath 是同一个可执行文件、但不带版本号。候选 = PATH 上的 node,
// 以及 Homebrew 的 <prefix>/bin/node 与 <prefix>/opt/<formula>/bin/node(升级后会跟着指向新版)。
// → { bin, warn? };哪个都对不上就照用 execPath 并给一句提醒。
function stableNodeBin({ execPath, candidates = [], exists = fs.existsSync, realpath = fs.realpathSync }) {
  if (!versionedPath(execPath)) return { bin: execPath }
  const real = (p) => { try { return realpath(p) } catch { return null } }
  const target = real(execPath) || execPath
  const m = String(execPath).match(/^(.*)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/)
  const brew = m ? [path.join(m[1], 'bin', 'node'), path.join(m[1], 'opt', m[2], 'bin', 'node')] : []
  for (const c of [...candidates, ...brew]) {
    if (c && exists(c) && !versionedPath(c) && real(c) === target) return { bin: c }
  }
  return { bin: execPath, warn: `node 的路径带版本号(${execPath}),换 node 版本后要重跑 sbot service install` }
}

// 配置里所有 `env:VAR` 引用的变量名(去重,按出现顺序)。下划线开头的键是说明 / 示例(`_slack_example` 这类),
// 运行时不读,不算
function envRefs(obj, out = []) {
  if (typeof obj === 'string') {
    const m = obj.match(/^env:([A-Za-z_][A-Za-z0-9_]*)$/)
    if (m && !out.includes(m[1])) out.push(m[1])
  } else if (Array.isArray(obj)) obj.forEach((v) => envRefs(v, out))
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { if (!k.startsWith('_')) envRefs(v, out) }
  return out
}

// 服务的全部事实(纯数据):各平台单元文件都从这里生成。env = 额外写进单元文件的环境变量(--pass-env)
function serviceSpec({ nodeBin, sbotBin, configPath, uiHost, home, pathEnv, env = {} }) {
  const args = [sbotBin, 'start', '--ui', '--no-open']
  if (uiHost) args.push('--ui-host', uiHost)
  if (configPath) args.push('--config', configPath)
  const workdir = configPath ? path.dirname(configPath) : path.join(home, '.sbot')
  const logDir = path.join(home, '.sbot', 'logs')
  return { nodeBin, args, workdir, logDir, pathEnv, env, outLog: path.join(logDir, 'out.log'), errLog: path.join(logDir, 'err.log') }
}

function launchdPlist(spec) {
  const arr = [spec.nodeBin, ...spec.args].map((a) => `    <string>${xmlEsc(a)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${arr}
  </array>
  <key>WorkingDirectory</key><string>${xmlEsc(spec.workdir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xmlEsc(spec.pathEnv)}</string>
${Object.entries(spec.env || {}).map(([k, v]) => `    <key>${xmlEsc(k)}</key><string>${xmlEsc(v)}</string>\n`).join('')}  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>${xmlEsc(spec.outLog)}</string>
  <key>StandardErrorPath</key><string>${xmlEsc(spec.errLog)}</string>
</dict>
</plist>
`
}

function systemdUnit(spec) {
  return `[Unit]
Description=SintBot daemon (group chat -> headless Claude Code)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${[spec.nodeBin, ...spec.args].map(sdQuote).join(' ')}
WorkingDirectory=${sdQuote(spec.workdir)}
Environment=${sdQuote('PATH=' + spec.pathEnv)}
${Object.entries(spec.env || {}).map(([k, v]) => `Environment=${sdQuote(k + '=' + v)}\n`).join('')}Restart=always
RestartSec=15
KillSignal=SIGTERM
TimeoutStopSec=30
StandardOutput=append:${spec.outLog}
StandardError=append:${spec.errLog}

[Install]
WantedBy=default.target
`
}

function unitPath(platform, home) {
  if (platform === 'darwin') return path.join(home, 'Library', 'LaunchAgents', LABEL + '.plist')
  if (platform === 'linux') return path.join(home, '.config', 'systemd', 'user', UNIT)
  return null
}

function render(platform, spec) {
  if (platform === 'darwin') return launchdPlist(spec)
  if (platform === 'linux') return systemdUnit(spec)
  return null
}

// Windows:不自动装,给现成命令(两种托管器任选)
function windowsHint(spec) {
  const cmd = [spec.nodeBin, ...spec.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
  return [
    'Windows 上请用托管器把下面这条命令装成服务(任选其一,详见 docs/install.md):',
    '',
    `  命令:${cmd}`,
    '',
    '  · NSSM:nssm install SintBot ' + `"${spec.nodeBin}" ` + spec.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
    `          nssm set SintBot AppDirectory "${spec.workdir}"`,
    '          nssm start SintBot',
    '  · pm2: pm2 start ' + `"${spec.args[0]}" --name sbot -- ` + spec.args.slice(1).join(' ') + ' && pm2 save',
  ].join('\n')
}

function run(bin, args, opts = {}) {
  try { return { ok: true, out: execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) } }
  catch (e) { return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || e.message || e).trim(), code: e.status } }
}

const uid = () => (typeof process.getuid === 'function' ? process.getuid() : 0)

// 状态(只读):{ installed, running, pid, detail }
function status({ platform = process.platform, home = os.homedir() } = {}) {
  const file = unitPath(platform, home)
  const installed = !!(file && fs.existsSync(file))
  if (platform === 'darwin') {
    const r = run('launchctl', ['print', `gui/${uid()}/${LABEL}`])
    if (!r.ok) return { installed, loaded: false, running: false, pid: null, file }
    const pid = (r.out.match(/^\s*pid = (\d+)/m) || [])[1]
    const state = (r.out.match(/^\s*state = (\S+)/m) || [])[1] || ''
    return { installed, loaded: true, running: state === 'running', pid: pid ? Number(pid) : null, state, file }
  }
  if (platform === 'linux') {
    const r = run('systemctl', ['--user', 'show', UNIT, '--property=ActiveState,MainPID'])
    const active = (r.out.match(/ActiveState=(\S+)/) || [])[1] || ''
    const pid = Number((r.out.match(/MainPID=(\d+)/) || [])[1] || 0) || null
    return { installed, loaded: active !== '' && active !== 'inactive', running: active === 'active', pid, state: active, file }
  }
  return { installed: false, loaded: false, running: false, pid: null, file: null }
}

// 写单元文件(已有且内容不同 ⇒ 先备份)并加载。返回 { file, backup, steps: [{cmd, ok, err}] }
function install(spec, { platform = process.platform, home = os.homedir() } = {}) {
  const file = unitPath(platform, home)
  if (!file) throw new Error('这个平台不支持自动安装服务')
  const text = render(platform, spec)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.mkdirSync(spec.logDir, { recursive: true })
  let backup = null
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') !== text) {
    backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`
    fs.copyFileSync(file, backup)
  }
  fs.writeFileSync(file, text)
  // 单元文件里写了环境变量的值(多半是 key)⇒ 只给自己读写;没写就是普通权限
  if (Object.keys(spec.env || {}).length) fs.chmodSync(file, 0o600)
  const steps = []
  const step = (bin, args, tolerate) => { const r = run(bin, args); steps.push({ cmd: [bin, ...args].join(' '), ok: r.ok || !!tolerate, err: r.ok ? '' : r.err }); return r }
  if (platform === 'darwin') {
    step('launchctl', ['bootout', `gui/${uid()}/${LABEL}`], true) // 没加载过会报错,忽略
    step('launchctl', ['bootstrap', `gui/${uid()}`, file])
  } else {
    step('systemctl', ['--user', 'daemon-reload'])
    step('systemctl', ['--user', 'enable', UNIT])
    step('systemctl', ['--user', 'restart', UNIT])
  }
  return { file, backup, steps }
}

function restart({ platform = process.platform } = {}) {
  if (platform === 'darwin') return run('launchctl', ['kickstart', '-k', `gui/${uid()}/${LABEL}`])
  if (platform === 'linux') return run('systemctl', ['--user', 'restart', UNIT])
  return { ok: false, err: '这个平台不支持' }
}

function uninstall({ platform = process.platform, home = os.homedir() } = {}) {
  const file = unitPath(platform, home)
  const steps = []
  if (platform === 'darwin') {
    const r = run('launchctl', ['bootout', `gui/${uid()}/${LABEL}`]); steps.push({ cmd: 'launchctl bootout', ok: true, err: r.ok ? '' : r.err })
  } else if (platform === 'linux') {
    const r = run('systemctl', ['--user', 'disable', '--now', UNIT]); steps.push({ cmd: 'systemctl --user disable --now', ok: r.ok, err: r.ok ? '' : r.err })
  }
  let removed = false
  if (file && fs.existsSync(file)) { fs.unlinkSync(file); removed = true }
  if (platform === 'linux') run('systemctl', ['--user', 'daemon-reload'])
  return { file, removed, steps }
}

module.exports = { LABEL, UNIT, xmlEsc, sdQuote, buildPath, versionedPath, stableNodeBin, envRefs, serviceSpec, launchdPlist, systemdUnit, unitPath, render, windowsHint, status, install, restart, uninstall }
