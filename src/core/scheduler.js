// Cron scheduler — a minute-resolution ticker that fires due tasks (定时任务 base skill).
//
// Wakes near each minute boundary, asks `tasks()` for the current work-list (so config
// hot-reload is picked up automatically), and fires every task whose cron matches the
// current instant in the product timezone. Dedup by minute-key: a task fires at most once
// per matching minute even if a tick jitters or fires twice. now/tz/tasks/fire and the timer
// fns are injected so the whole thing is unit-testable without real time or timers.
//
// Deliberately does NOT tick on start(): a daemon restart must not back-fire tasks whose
// minute happened to be current at boot (that would double-fire across restarts).

const { matchCron, matchAt } = require('./cron')
const { tzParts } = require('./time')

function minuteKey(ts, tz) {
  const p = tzParts(ts, tz)
  return `${p.year}-${p.month}-${p.day}-${p.hour}-${p.minute}`
}

function createScheduler({ tasks, fire, tz = () => 'Asia/Shanghai', now = () => Date.now(), log = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof tasks !== 'function' || typeof fire !== 'function') throw new Error('scheduler: tasks() and fire() are required')
  let timer = null
  let stopped = false
  const lastFired = new Map() // taskId -> minuteKey already fired (dedup within a minute)

  const tick = () => {
    if (stopped) return
    const ts = now(), z = tz()
    const key = minuteKey(ts, z)
    for (const t of (tasks() || [])) {
      if (!t || !t.id || (!t.expr && !t.at) || t.enabled === false) continue
      let due
      try { due = t.at ? matchAt(t.at, ts, z) : matchCron(t.expr, ts, z) } catch (e) { log(`cron 任务 ${t.id} 表达式无效(跳过): ${e && e.message}`); continue }
      if (!due) continue
      // Dedup key is scoped by chatId so two GROUPS holding a same-id task never suppress each
      // other (cross-group isolation): each (group, task) fires independently, once per minute.
      const dk = `${t.chatId || ''}:${t.id}`
      if (lastFired.get(dk) === key) continue // already fired this minute
      lastFired.set(dk, key)
      try { fire(t) } catch (e) { log(`cron fire ${t.id} 失败: ${e && e.message}`) }
    }
  }

  const schedule = () => {
    if (stopped) return
    // wake ~0.5s into the next minute so a tick reliably lands inside each target minute
    const ms = 60000 - (now() % 60000) + 500
    timer = setTimer(() => { tick(); schedule() }, ms)
    if (timer && timer.unref) timer.unref() // never keep the process alive on our account
  }

  return {
    start() { stopped = false; schedule() }, // align to the next minute; do NOT tick immediately
    stop() { stopped = true; if (timer) { clearTimer(timer); timer = null } },
    tick, // exposed for tests / manual drive
  }
}

module.exports = { createScheduler, minuteKey }
