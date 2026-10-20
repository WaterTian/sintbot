// 定时任务到点做什么(v0.11.103 从 bin 的 scheduler.fire 抽出来):三种任务各走各的路,依赖全部注入 ⇒ 可单测。
//   do  → 构造合成消息喂 engine(复用群路由 / 锁 / 权限 / 卡片全套管线,群间互不干扰)
//   say → 直接发一条消息(过 redact),不起 agent
//   run → daemon 直接跑命令(src/core/cronrun.js),不起 agent、不占群锁、不进会话;成功只留日志 + 账本一行,
//         失败群里一句人话附输出末尾,task.escalate 时改为把输出交给 agent 排查
// 直发的消息(say 正文 / 脚本失败提示)发不出去时**补发**,不是丢掉:09-17 21:00 一次约 5 分钟的断网里,脚本
//   失败提示恰好也发不出去(平台层只记一行日志就把 null 吞了),群里对那次失败一无所知。断网正是失败最常见的
//   原因 ⇒ 「失败提示」在最需要它的时候最容易丢。补发按 1 / 5 / 15 / 30 分钟四次,正文前加一行「补发 · 原定几点」,
//   四次都不成才放弃并记日志;同一条消息再次触发时只换正文不叠加。
// 为什么抽出来:这段判断原来写在调用方(bin)里,单测只测得到被它调用的纯函数 —— 「A 必须传到 B」的接线
// 从来没被钉住(v0.11.54 那版逮到三条同形的漏)。现在 fire 本身就是被测对象。
// ⚠ core 保持无感:这里不认平台名、不认 runner 名,只认注入进来的函数。
const { runScriptTask, runOk, runReason, outputTail, runFailureNotice, escalationPrompt, DEFAULT_TIMEOUT_MS } = require('./cronrun')
const { fmtStamp } = require('./time')

// 直发消息发不出去时的补发间隔:1 / 5 / 15 / 30 分钟(累计约 51 分钟)。09-17 那次断网 5 分钟,第二次就能补上;
// 更长的断网多半是机器本身出事,那时群里该由另一台的看门告警说话,不靠这里无限重试。
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000]

// deps:
//   getGroup(chatId) → 群配置(paused / workdir);tz() → 产品时区;handleMessage(msg) → engine 入口;
//   send(chatId, text) → 平台直发(已 redact);redact(s);log(s);ledger.append(row);removeTask(chatId, id) → 一次性任务触发后删;
//   runScript(opts) → 可注入(测试用假 spawn);now();env → 脚本继承的环境(对象,或 (task) => 对象:按群注入 SBOT_CHAT_ID 等);
//   cwdFallback → 群没配 workdir 时的 cwd;
//   send 的返回值契约(interfaces.js):resolve 成 **null = 平台确认没送到**(抛错同义);其余值(message_id / undefined)= 已送到或不跟踪。
//   retryDelaysMs → 补发间隔表(测试注入短的);setTimer / clearTimer → 定时器(测试注入假的)。
function createCronFire(deps) {
  const { getGroup, tz, handleMessage, send, redact = (s) => s, log = () => {}, ledger = null, removeTask = () => {}, runScript = runScriptTask, now = Date.now, env = process.env, cwdFallback = process.cwd(), retryDelaysMs = RETRY_DELAYS_MS, setTimer = setTimeout, clearTimer = clearTimeout } = deps
  const running = new Set() // 正在跑的脚本任务(chatId:id):同一任务不并行(小时级巡检 + 挂死脚本 = 无限堆进程)
  const children = new Map() // key → 子进程:关停时要能杀(审查逮到:daemon 退了脚本成孤儿,下次写 stdout 就 EPIPE 死、无人报)
  const undelivered = new Map() // 待补发的直发消息:key(chatId:id:用途) → { chatId, text, firstAt, tries, timer }

  // 直发一条,发不出去就排补发。key 按「任务 + 用途」去重:同一任务连着两次失败只留最新那条正文,不让群里收到一串。
  const deliver = (key, chatId, text) => {
    const prev = undelivered.get(key)
    if (prev) { if (prev.timer) clearTimer(prev.timer); undelivered.delete(key) }
    const rec = { chatId, text, firstAt: (prev && prev.firstAt) || now(), tries: 0, timer: null }
    return attempt(key, rec)
  }
  const attempt = (key, rec) => {
    // 补发时正文前加一行说明:读的人得知道这是几点的事,不然「没跑成功」四个字在 30 分钟后看到会误判成又失败了一次
    const body = rec.tries > 0 ? `(补发 · 原定 ${fmtStamp(rec.firstAt, tz())} 发出,当时发不出去)\n` + rec.text : rec.text
    return new Promise((resolve) => resolve(send(rec.chatId, body))).then((r) => r === null ? Promise.reject(new Error('平台没送到')) : r).then(() => {
      undelivered.delete(key)
      if (rec.tries > 0) log(`cron 消息补发成功(第 ${rec.tries} 次):${key}`)
    }, (e) => {
      const delay = retryDelaysMs[rec.tries]
      if (delay === undefined) { undelivered.delete(key); log(`cron 消息放弃补发(${rec.tries} 次都发不出去):${key} — ` + (e && e.message)); return }
      rec.tries++
      undelivered.set(key, rec)
      log(`cron 消息发不出去(${e && e.message}),${Math.round(delay / 60000)} 分钟后补发(第 ${rec.tries} 次):${key}`)
      rec.timer = setTimer(() => { rec.timer = null; attempt(key, rec) }, delay)
      if (rec.timer && typeof rec.timer.unref === 'function') rec.timer.unref() // 补发不该拖住进程退出
    })
  }

  const synthetic = (task, text, extra = {}) => {
    const t = now()
    // cron:true ⇒ 群里正忙时的排队提示走定时任务那句(engine T.queuedCron)
    return { chatId: task.chatId, userId: 'cron', senderName: '定时任务', synthetic: true, cron: true, text, msgId: `cron:${task.chatId}:${task.id}:${t}`, createTimeMs: t, replyCtx: { chatId: task.chatId }, ...extra }
  }

  const fireRun = (task, group) => {
    const key = `${task.chatId}:${task.id}`
    if (running.has(key)) { log(`cron 脚本跳过(上一次还没跑完): ${key}`); return Promise.resolve() }
    running.add(key)
    const startedAt = now()
    const cwd = (group && group.workdir) || cwdFallback
    const timeoutMs = task.timeoutMin > 0 ? task.timeoutMin * 60_000 : DEFAULT_TIMEOUT_MS
    // ⚠ new Promise 包一层:runScript 同步抛(spawn 本身炸了)也要走下面的 catch 释放 running 占位 ——
    //   Promise.resolve(f()) 那种写法里 f 同步抛会绕过 catch,占位永远不放,这个任务从此每次都「上一次还没跑完」。
    // env:脚本要拿到与 agent 子进程同一组基础能力变量(SBOT_CHAT_ID / SBOT_CONFIG / …,bin 里传 engine.baseSkillEnv),
    //   否则脚本里的 `sbot feishu send-msg` 不知道发到哪个群(09-17 18:00 实证:退出码 1「缺少目标群」)。
    const scriptEnv = typeof env === 'function' ? env(task) : env
    return new Promise((resolve) => resolve(runScript({ command: String(task.text || ''), cwd, env: { ...scriptEnv, TZ: tz() }, timeoutMs, onChild: (c) => children.set(key, c) }))).then((res) => {
      running.delete(key); children.delete(key)
      const ok = runOk(res)
      log(`cron 脚本 ${key} ${ok ? 'ok' : '失败(' + runReason(res) + ')'} · ${Math.round(res.ms / 1000)}s` + (ok ? '' : '\n' + outputTail(res)))
      // 账本一行(与轮次同一本;script:true 区分 —— 它没有模型、没有 token,读账本的人别把它当轮次算)
      if (ledger) ledger.append({ ts: startedAt, chatId: task.chatId, provider: null, sender: '定时任务', text: String(task.text || '').slice(0, 200), status: ok ? 'ok' : 'error', ms: res.ms, tokens: null, script: true, ...(ok ? {} : { err: runReason(res) }) })
      if (ok) return
      if (task.escalate) return handleMessage(synthetic(task, escalationPrompt(task, res)))
      return deliver(`${key}:fail`, task.chatId, redact(runFailureNotice(task, res)))
    }).catch((e) => { running.delete(key); children.delete(key); log('cron 脚本执行异常: ' + (e && e.message)) })
  }

  // 返回 Promise 只为测试能等到收尾;调度器不等它(fire-and-forget)。
  function fire(task) {
    try {
      // 暂停群到点跳过(不补触发,与「错过不触发」同语义)—— --do 烧额度、--say / --run 也是打扰
      const group = getGroup(task.chatId)
      if (group && group.paused) { log(`cron 跳过(群已暂停): ${task.chatId} ${task.id}`); return Promise.resolve() }
      let p
      if (task.kind === 'say') p = deliver(`${task.chatId}:${task.id}:say`, task.chatId, redact(String(task.text || '')))
      else if (task.kind === 'run') p = fireRun(task, group)
      else p = Promise.resolve(handleMessage(synthetic(task, String(task.text || ''), { resetSessionAfter: !!task.resetSession })))
      if (task.once || task.at) removeTask(task.chatId, task.id) // 一次性:触发后即删,列表不堆积
      return p
    } catch (e) { log('cron fire 失败: ' + (e && e.message)); return Promise.resolve() }
  }
  // 关停用:在跑的脚本数 / 杀掉全部(整棵进程组)。探空闲按 daemon 子进程数已能看见它们(detached 只换进程组,父仍是 daemon)。
  fire.inFlight = () => running.size
  fire.undelivered = () => undelivered.size // 待补发的直发消息数(关停 / 排障看)
  fire.abortAll = () => {
    // 待补发的一并放弃:进程都要退了,定时器留着也没人执行;记日志让排障的人知道丢了几条
    for (const [key, rec] of undelivered) { if (rec.timer) clearTimer(rec.timer); log(`关停:放弃补发 ${key}`) }
    undelivered.clear()
    let n = 0
    for (const [key, c] of children) {
      n++
      try { if (process.platform === 'win32') require('node:child_process').spawn('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }); else process.kill(-c.pid, 'SIGKILL') } catch { try { c.kill('SIGKILL') } catch {} }
      log(`关停:杀掉在跑的定时脚本 ${key}`)
    }
    children.clear(); running.clear()
    return n
  }
  return fire
}

module.exports = { createCronFire, RETRY_DELAYS_MS }
