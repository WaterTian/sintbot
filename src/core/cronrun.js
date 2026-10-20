// 定时脚本任务(cron kind:'run',v0.11.103)—— 到点由 daemon 直接跑一条命令,不起 agent。
//
// 为什么要有第三种任务:实际部署里大半定时任务的正文是「跑这条命令,脚本自己发报告,你只需确认退出码为 0」——
// 模型只是个开关。2026-09-11~17 实读账本:一个看板群 7 天 168 轮定时轮里 162 轮静默,每轮 0.67M 缓存读、
// 30 秒;某项目 67 轮里 38 轮静默、每轮 1.33M。一周约 200 轮 agent 空跑、近 2 亿缓存 token,还占着群锁、
// 把巡检输出塞进群会话。脚本先跑:退出码 0 ⇒ 结束(只留日志与账本一行);非 0 / 超时 ⇒ 群里一句人话
// 附输出末尾,或(task.escalate)把输出交给 agent 处理 —— 模型只在需要判断时才被叫起来。
//
// 不占群锁、不进会话:与群里正在跑的 agent 并行。⇒ 只适合「读 API · 发报告 · 刷看板」这类脚本;会改仓库
// 工作区的活仍用 --do 让 agent 在锁内做(两边同时动一棵树是自找冲突)。同一任务上一次还没跑完,这次跳过。
//
// 纯逻辑(可注入 spawn / now)放这里,daemon 只接线:src/core/cronfire.js。
const os = require('node:os')
const { spawn: nodeSpawn } = require('node:child_process')

const IS_WIN = process.platform === 'win32'
const DEFAULT_TIMEOUT_MS = 15 * 60_000 // 巡检 / 日报脚本正常几十秒;15 分钟兜住挂死的
const MAX_OUTPUT = 64 * 1024 // 每路输出最多留 64KB(只为失败时取末尾;成功时整段丢)
const STDIO_GRACE_MS = 1500 // 进程已退但管道没关(它起的后台进程还握着 stdout)⇒ 等这么久就结算
const KILL_GRACE_MS = 2000 // 超时杀树之后最多再等这么久,close 不来也结算

// 跑一条命令(经 shell,cwd = 群项目目录),收齐退出码与两路输出。超时杀整棵进程树。
// 返回值永远 resolve(不 reject):{ code, signal, timedOut, stdout, stderr, ms, cwd, error }。
//   code 为 null 且 error 非空 = 连 spawn 都没起来(shell 不在 / cwd 不存在)。
// ⚠ 结算以 **exit** 为准而不是 close(审查逮到):close 要等 stdio 全关,脚本自己退了、它起的后台进程
//   (setsid 的 daemon 化子进程、`some-server &`)还握着 stdout ⇒ close 永不来 —— 旧写法下 Promise 永不
//   resolve,任务从此每次「上一次还没跑完」;exit 0 的也会拖到超时被报成「超时被终止」并把后台进程连锅端。
//   现在 exit 之后给 stdio 一段短宽限(该收的输出这时早收完了),到点就结算并把两路流销毁;超时杀树之后
//   同样有兜底定时器,close 不来也结算。
// onChild(child):把子进程交出去(cronfire 记着,关停时能杀);可不传。
function runScriptTask({ command, cwd, env, timeoutMs = DEFAULT_TIMEOUT_MS, spawn = nodeSpawn, now = Date.now, onChild } = {}) {
  return new Promise((resolve) => {
    const t0 = now()
    let stdout = '', stderr = '', settled = false, timedOut = false, timer = null, graceTimer = null, exited = null
    const cap = (s, add) => (s.length >= MAX_OUTPUT ? s : (s + add).slice(-MAX_OUTPUT))
    let child
    const destroyStreams = () => { try { child && child.stdout && child.stdout.destroy() } catch {} ; try { child && child.stderr && child.stderr.destroy() } catch {} }
    const finish = (r) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (graceTimer) clearTimeout(graceTimer)
      destroyStreams()
      resolve({ code: null, signal: null, error: null, ...r, timedOut, stdout, stderr, ms: now() - t0, cwd })
    }
    try {
      // detached(POSIX)让子进程自成进程组 ⇒ 超时能 kill(-pid) 连 shell 带脚本一起杀;Windows 走 taskkill /T。
      child = spawn(command, { cwd, env, shell: true, detached: !IS_WIN, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return finish({ error: (e && e.message) || String(e) })
    }
    if (typeof onChild === 'function') { try { onChild(child) } catch {} }
    const killTree = () => {
      if (!child || !child.pid) return
      if (IS_WIN) { try { spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }) } catch {} ; return }
      try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
    }
    if (child.stdout) child.stdout.on('data', (d) => { stdout = cap(stdout, String(d)) })
    if (child.stderr) child.stderr.on('data', (d) => { stderr = cap(stderr, String(d)) })
    child.on('error', (e) => finish({ error: (e && e.message) || String(e) }))
    child.on('exit', (code, signal) => {
      exited = { code, signal }
      if (!graceTimer) graceTimer = setTimeout(() => finish(exited), STDIO_GRACE_MS)
    })
    child.on('close', (code, signal) => finish({ code, signal }))
    if (timeoutMs > 0) timer = setTimeout(() => { timedOut = true; killTree(); if (!graceTimer) graceTimer = setTimeout(() => finish(exited || { code: null, signal: 'SIGKILL' }), KILL_GRACE_MS) }, timeoutMs)
  })
}

// 输出末尾(失败时给人看的那几行):两路合并、去掉空行,取最后 maxLines 行、总长不超 maxChars。
// sanitize(群面用):⚠ 用户面零机器路径 —— 栈帧行(`    at …`)整行丢掉,项目目录换成 `.`、home 换成 `~`。
//   给 agent 的那份不脱(它要照着路径去复现)。
function outputTail(res, { maxLines = 8, maxChars = 600, sanitize = false } = {}) {
  let lines = ((res.stderr || '') + '\n' + (res.stdout || '')).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean)
  if (sanitize) {
    lines = lines.filter((l) => !/^\s+at\s/.test(l))
    const home = os.homedir()
    const cwd = res.cwd ? String(res.cwd).replace(/[\\/]+$/, '') : ''
    lines = lines.map((l) => {
      let t = l
      if (cwd) t = t.split(cwd).join('.')
      if (home) t = t.split(home).join('~')
      return t
    })
  }
  let out = lines.slice(-maxLines).join('\n')
  if (out.length > maxChars) out = '…' + out.slice(-maxChars)
  return out
}

// 结果一句话(日志 / 账本 / 群面共用的判据):成功 = 退出码 0 且没超时。
function runOk(res) { return !res.timedOut && !res.error && res.code === 0 }

function runReason(res) {
  if (res.timedOut) return '超时被终止'
  if (res.error) return '没能启动:' + res.error
  if (res.signal) return '被信号终止(' + res.signal + ')'
  return '退出码 ' + res.code
}

// 群面失败提示。⚠ 零工具名:不提「脚本 / 命令 / 退出码」以外的实现;不给机器路径(outputTail sanitize)——
// 任务名优先用 operator 写的备注,没有就用命令首行的前 40 个字(那是 operator 自己写的,他认得)。
function runFailureNotice(task, res) {
  const label = (task.note && String(task.note).trim()) || String(task.text || '').split('\n')[0].trim().slice(0, 40)
  const tail = outputTail(res, { sanitize: true })
  return `❌ 定时脚本没跑成功(${runReason(res)})· ${label}` + (tail ? '\n' + tail : '')
}

// 升级给 agent 的合成消息正文(task.escalate):把输出交给它排查。⚠ 这是给 agent 的指令不是群面文案,
// 命令与路径原样给(它要照着复跑)。
function escalationPrompt(task, res) {
  const tail = outputTail(res, { maxLines: 40, maxChars: 4000 })
  return `定时脚本没跑成功(${runReason(res)})。命令:\n${String(task.text || '')}\n\n输出末尾:\n${tail || '(无输出)'}\n\n请在项目根复现并排查;能修就修好后重跑一次确认,修不了就在群里说明原因与建议。`
}

module.exports = { runScriptTask, outputTail, runOk, runReason, runFailureNotice, escalationPrompt, DEFAULT_TIMEOUT_MS, MAX_OUTPUT, STDIO_GRACE_MS }
