// Slack 群里的 `sbot feishu …`:引擎注入 SBOT_PLATFORM=slack,这族动作要在动配置、动网络
// 之前就拦下并说人话 —— 否则要么打到飞书 API 报 lark 错、要么报「feishu 未配置」,agent 会转头重试。
// 显式 --chat(operator 手工指飞书群)不拦。零网络:配置指向不存在的路径。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const BIN = path.join(__dirname, '..', '..', 'bin', 'sbot.js')

function run(args, env) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-slackguard-'))
  try {
    const r = spawnSync(process.execPath, [BIN, ...args], {
      cwd, encoding: 'utf8', timeout: 20000,
      env: { ...process.env, SBOT_CONFIG: path.join(cwd, 'nope.json'), NO_COLOR: '1', ...env },
    })
    return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
  } finally { fs.rmSync(cwd, { recursive: true, force: true }) }
}

test('sbot feishu in a Slack group (SBOT_PLATFORM=slack, no --chat) is refused before touching config', () => {
  for (const action of [['send-msg', 'hi'], ['send-image', 'a.png'], ['history'], ['download', 'm1', 'k1', 'image']]) {
    const r = run(['feishu', ...action], { SBOT_PLATFORM: 'slack', SBOT_CHAT_ID: 'C0123' })
    assert.notEqual(r.code, 0, action.join(' '))
    assert.match(r.out, /本群在 Slack 上/, action.join(' '))
    assert.doesNotMatch(r.out, /feishu 未配置|nope\.json/, action.join(' ')) // 拦在读配置之前
  }
})

test('explicit --chat bypasses the Slack guard (operator pointing at a feishu chat by hand)', () => {
  const r = run(['feishu', 'send-msg', 'hi', '--chat', 'oc_manual'], { SBOT_PLATFORM: 'slack', SBOT_CHAT_ID: 'C0123' })
  assert.notEqual(r.code, 0) // 没有配置,照旧失败 —— 但不是被 Slack 守卫拦的
  assert.doesNotMatch(r.out, /本群在 Slack 上/)
})

test('feishu group (SBOT_PLATFORM unset or feishu) is not intercepted', () => {
  for (const env of [{ SBOT_CHAT_ID: 'oc_x' }, { SBOT_CHAT_ID: 'oc_x', SBOT_PLATFORM: 'feishu' }]) {
    const r = run(['feishu', 'send-msg', 'hi'], env)
    assert.doesNotMatch(r.out, /本群在 Slack 上/)
  }
})
