'use strict'
// 定时脚本任务(cron kind:'run',v0.11.103):纯逻辑 + 真 spawn(只跑本机 node,零网络)。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { runScriptTask, outputTail, runOk, runReason, runFailureNotice, escalationPrompt } = require('../../src/core/cronrun')

const NODE = JSON.stringify(process.execPath)

test('cronrun: 退出码 0 = 成功,输出收得到', async () => {
  const r = await runScriptTask({ command: `${NODE} -e "console.log('hi'); console.error('warn')"`, cwd: os.tmpdir(), env: process.env, timeoutMs: 10_000 })
  assert.equal(r.code, 0); assert.equal(runOk(r), true)
  assert.match(r.stdout, /hi/); assert.match(r.stderr, /warn/)
  assert.ok(r.ms >= 0)
})

test('cronrun: 非 0 退出码 = 失败,原因带退出码', async () => {
  const r = await runScriptTask({ command: `${NODE} -e "console.log('partial'); process.exit(3)"`, cwd: os.tmpdir(), env: process.env, timeoutMs: 10_000 })
  assert.equal(r.code, 3); assert.equal(runOk(r), false)
  assert.equal(runReason(r), '退出码 3')
})

test('cronrun: 超时杀掉整棵树,标 timedOut,不等它自己退', async () => {
  const t0 = Date.now()
  const r = await runScriptTask({ command: `${NODE} -e "setTimeout(() => {}, 20000)"`, cwd: os.tmpdir(), env: process.env, timeoutMs: 300 })
  assert.equal(r.timedOut, true); assert.equal(runOk(r), false)
  assert.match(runReason(r), /超时/)
  assert.ok(Date.now() - t0 < 5000, '超时后必须很快回来,不能等 20 秒')
})

test('cronrun: 脚本 exit 0 但留下一个握着 stdout 的后台进程 ⇒ 以 exit 为准很快回来、不算超时、不杀它', async () => {
  const marker = 'sbot-bg-' + process.pid
  const t0 = Date.now()
  const r = await runScriptTask({ command: `sleep 25 & echo ${marker}; exit 0`, cwd: os.tmpdir(), env: process.env, timeoutMs: 10_000 })
  const ms = Date.now() - t0
  assert.equal(r.code, 0); assert.equal(r.timedOut, false); assert.equal(runOk(r), true)
  assert.match(r.stdout, new RegExp(marker))
  assert.ok(ms < 5000, `exit 后至多等一段 stdio 宽限就该回来,实际 ${ms}ms`)
  const { execSync } = require('node:child_process')
  // ⚠ pgrep -f 的模式写成 [s]leep:Linux 上 pgrep 会把跑它的那个 sh -c(命令行里含同样字样)也数进去,macOS 不会 —— CI 红过一次
  const alive = (() => { try { return execSync('pgrep -f "[s]leep 25" | wc -l').toString().trim() } catch { return '0' } })()
  assert.ok(Number(alive) >= 1, '脚本故意留下的后台进程不该被连锅端')
  try { execSync('pkill -f "^sleep 25$"') } catch {}
})

test('cronrun: 超时杀的是整棵树(shell + 它起的孙进程)', async () => {
  const r = await runScriptTask({ command: 'sleep 30.017; echo never', cwd: os.tmpdir(), env: process.env, timeoutMs: 400 })
  assert.equal(r.timedOut, true)
  await new Promise((res) => setTimeout(res, 300))
  const { execSync } = require('node:child_process')
  const left = (() => { try { return execSync('pgrep -f "[s]leep 30.017" | wc -l').toString().trim() } catch { return '0' } })() // [s]leep:见上一例
  assert.equal(Number(left), 0, '孙进程 sleep 30.017 必须随进程组一起死')
})

test('cronrun: 群面输出末尾不带机器路径 —— 栈帧行丢掉、项目目录换 . 、home 换 ~;给 agent 的那份保留', () => {
  const home = os.homedir()
  const res = { code: 1, cwd: home + '/Projects/demo', stdout: '', stderr: `Error: ENOENT ${home}/Projects/demo/scripts/x.js\n    at Object.<anonymous> (${home}/Projects/demo/scripts/x.js:3:1)\n    at Module._compile (node:internal/modules/cjs/loader:1)\nfatal at end` }
  const notice = runFailureNotice({ text: 'node scripts/x.js' }, res)
  assert.doesNotMatch(notice, new RegExp(home.replace(/[/\\]/g, '\\$&')), '群面不许出现 home 绝对路径')
  assert.doesNotMatch(notice, /^\s+at\s/m, '栈帧行整行丢掉')
  assert.match(notice, /ENOENT \.\/scripts\/x\.js/); assert.match(notice, /fatal at end/)
  const prompt = escalationPrompt({ text: 'node scripts/x.js' }, res)
  assert.match(prompt, new RegExp(home.replace(/[/\\]/g, '\\$&')), '给 agent 的保留原路径,它要照着复现')
})

test('cronrun: cwd 不存在 ⇒ 不抛,error 里说清', async () => {
  const r = await runScriptTask({ command: 'true', cwd: path.join(os.tmpdir(), 'sbot-no-such-dir-' + Date.now()), env: process.env, timeoutMs: 5000 })
  assert.equal(runOk(r), false)
  assert.ok(r.error || r.code !== 0, '起不来算失败')
  assert.match(runReason(r), /没能启动|退出码/)
})

test('cronrun: env 传进去(TZ 与脚本看到的一致)', async () => {
  const r = await runScriptTask({ command: `${NODE} -e "console.log(process.env.SBOT_PROBE_X)"`, cwd: os.tmpdir(), env: { ...process.env, SBOT_PROBE_X: 'probe-42' }, timeoutMs: 10_000 })
  assert.match(r.stdout, /probe-42/)
})

test('cronrun: 输出末尾只取最后几行、去空行、封顶', () => {
  const res = { stdout: Array.from({ length: 30 }, (_, i) => `out${i}`).join('\n') + '\n\n\n', stderr: 'e1\n\ne2\n' }
  const tail = outputTail(res, { maxLines: 4 })
  assert.deepEqual(tail.split('\n'), ['out26', 'out27', 'out28', 'out29'])
  const long = outputTail({ stdout: 'x'.repeat(2000), stderr: '' }, { maxChars: 100 })
  assert.equal(long.length, 101); assert.ok(long.startsWith('…'))
})

test('cronrun: 群面失败提示 —— 备注优先当任务名,没有就命令首行前 40 字;零工具名', () => {
  const res = { code: 2, stdout: '', stderr: 'Error: ENOTFOUND api.example\n    at x' }
  const withNote = runFailureNotice({ text: 'node scripts/watch.js --x', note: '站点巡检' }, res)
  assert.match(withNote, /^❌ 定时脚本没跑成功\(退出码 2\)· 站点巡检\n/)
  assert.match(withNote, /ENOTFOUND/)
  const noNote = runFailureNotice({ text: 'LARK_CLI_NO_PROXY=1 node scripts/watch-youzan-new-products.js --send-report --verbose' }, res)
  assert.match(noNote, /· LARK_CLI_NO_PROXY=1 node scripts\/watch-y\n/, '首行只留前 40 字')
  assert.ok(noNote.split('\n')[0].length < 80, '首行不许带整条长命令')
  for (const s of [withNote, noNote]) { assert.doesNotMatch(s, /sbot/); assert.doesNotMatch(s, /~\/\.sbot/) }
  assert.match(runFailureNotice({ text: 'x' }, { timedOut: true }), /超时被终止/)
})

test('cronrun: 交给 agent 的正文带原命令与输出末尾', () => {
  const p = escalationPrompt({ text: 'node scripts/a.js' }, { code: 1, stdout: 'line-a\nline-b', stderr: '' })
  assert.match(p, /退出码 1/); assert.match(p, /node scripts\/a\.js/); assert.match(p, /line-b/); assert.match(p, /复现并排查/)
  assert.match(escalationPrompt({ text: 'x' }, { code: 1, stdout: '', stderr: '' }), /\(无输出\)/)
})
