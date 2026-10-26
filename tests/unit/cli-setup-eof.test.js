// `sintbot setup` 的输入一上来就结束(</dev/null、管道、Docker RUN、CI):每一问拿默认值,得能走完。
// 1.0.8 在模型菜单原地空转(默认「1」→ key 为空 → 回菜单),3 分钟写出 18 GB。
// 环境只给临时 HOME 和只有 node 的 PATH:没有 claude / codex、没有模型 key,正好走到那个菜单。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const BIN = path.join(__dirname, '..', '..', 'bin', 'sbot.js')

test('setup with stdin already at EOF finishes on defaults instead of looping', { skip: process.platform === 'win32' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-setup-eof-'))
  try {
    const home = path.join(tmp, 'home')
    const bin = path.join(tmp, 'bin')
    fs.mkdirSync(home)
    fs.mkdirSync(bin)
    fs.symlinkSync(process.execPath, path.join(bin, 'node'))
    const cfg = path.join(tmp, 'config.json')
    const r = spawnSync(process.execPath, [BIN, 'setup', '--config', cfg], {
      cwd: tmp, input: '', encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, NO_COLOR: '1', LANG: 'en_US.UTF-8' },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    assert.equal(r.error, undefined, `setup did not finish: ${r.error && r.error.code}\n${out.slice(-2000)}`)
    assert.ok(out.length < 200000, `output kept growing (${out.length} chars)`)
    assert.equal((out.match(/先跳过\(之后在控制台/g) || []).length, 1, 'model menu shown more than once')
    assert.match(out, /稍后自己装/) // 没人回答时不替他装 Claude Code
    assert.doesNotMatch(out, /\$ npm install/) // 也不替他装设计图标库或别的东西
    assert.ok(fs.existsSync(cfg), `config not written\n${out.slice(-2000)}`)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})
