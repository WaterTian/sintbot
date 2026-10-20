#!/usr/bin/env node
'use strict'
/**
 * Slack 接入前的三个未知数探针 —— 见 docs/SLACK.md「进度表达」。
 *
 * 这三件事**官方文档给不了答案**,而其中第一条会直接决定架构是否成立,
 * 所以必须在写 sbot 适配器之前先测掉。
 *
 * 用法(先领 Slack Developer Program 的免费 sandbox,别在生产群跑):
 *   export SLACK_BOT_TOKEN=xoxb-…
 *   export SLACK_CHANNEL=C…            # bot 必须已被 /invite 进这个频道
 *   export SLACK_RECIPIENT=U…          # 可选:真人 user id,流式在频道里必填此项
 *   export SLACK_APP_TOKEN=xapp-…      # socket 探针要用(带 connections:write 的 app-level token)
 *
 *   node docs/slack-probe.js auth          # 先跑这个,确认凭据与 scope
 *   node docs/slack-probe.js plan-check    # 这个 workspace 能走路线 A 还是 B(免费版走 A)
 *   node docs/slack-probe.js socket        # Socket Mode 端到端:连上并真收一条消息(需 SLACK_APP_TOKEN)
 *   node docs/slack-probe.js visibility    # ① 流式消息别人看不看得见(决定性)
 *   node docs/slack-probe.js stream-life   # ② 流的服务端最长存活时间
 *   node docs/slack-probe.js edit-window [秒]  # ③ chat.update 的编辑窗口
 *   node docs/slack-probe.js echo [分钟]   # 第 1 步最小闭环:把 src/platform/slack.js 真跑起来
 *
 * ⚠ 零新依赖:只用 Node 原生 fetch(≥22,与 package.json engines 一致)。
 *   (例外:`echo` 会 require 适配器,它用 `ws` —— 那是仓库既有依赖,不是探针引进来的。)
 * ⚠ 会真的往频道里发消息。跑完 visibility / stream-life 记得自己删掉测试消息。
 */

const TOKEN = process.env.SLACK_BOT_TOKEN
const CHANNEL = process.env.SLACK_CHANNEL
const RECIPIENT = process.env.SLACK_RECIPIENT || ''
const API = 'https://slack.com/api/'

const log = (...a) => console.log(...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hhmm = () => new Date().toTimeString().slice(0, 8)

/**
 * ⚠ Slack 的业务错误一律是 HTTP 200 + ok:false(与飞书同构)。这里显式抛出,
 *   是为了让探针本身不会"看起来成功但其实什么都没发生" —— 那正是 v0.11.48
 *   那次事故藏了四天的形态。
 */
async function api(method, body) {
  const r = await fetch(API + method, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body || {}),
  })
  const j = await r.json().catch(() => ({}))
  if (r.status === 429) {
    const e = new Error(`ratelimited, Retry-After=${r.headers.get('retry-after')}s`)
    e.code = 'ratelimited'; throw e
  }
  if (!j.ok) { const e = new Error(`${method} → ${j.error}`); e.code = j.error; e.payload = j; throw e }
  return j
}

/**
 * ⚠ Slack 的**读类方法**(conversations.info / chat.getPermalink 等)只吃 GET + query,
 *   给它们发 POST + JSON body 会返回 invalid_arguments —— 实测踩到过。
 *   写类方法(chat.postMessage / chat.update / …)则用上面的 api() 发 JSON。
 */
async function apiGet(method, params) {
  const qs = new URLSearchParams(params || {}).toString()
  const r = await fetch(API + method + (qs ? '?' + qs : ''), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  const j = await r.json().catch(() => ({}))
  if (!j.ok) { const e = new Error(`${method} → ${j.error}`); e.code = j.error; e.payload = j; throw e }
  return j
}

function need(...vars) {
  const miss = vars.filter((v) => !process.env[v])
  if (miss.length) { console.error(`缺少环境变量: ${miss.join(', ')}`); process.exit(1) }
}

const probes = {}

// ── 先决:凭据与身份 ────────────────────────────────────────────────
probes.auth = async () => {
  need('SLACK_BOT_TOKEN')
  const a = await api('auth.test')
  log(`✅ token 有效`)
  log(`   team : ${a.team}  (${a.team_id})   ← 流式的 recipient_team_id 用这个`)
  log(`   bot  : ${a.user}  (${a.user_id})   ← mention 检测与"过滤自己的消息"用这个`)
  log(`   url  : ${a.url}`)
  if (!CHANNEL) return log('\n(未设 SLACK_CHANNEL,跳过频道检查)')
  try {
    const c = await apiGet('conversations.info', { channel: CHANNEL })
    log(`   频道 : #${c.channel.name}  member=${c.channel.is_member}`)
    if (!c.channel.is_member) log('   ⚠ bot 不在频道里 —— 先 /invite,否则收不到任何消息')
  } catch (e) { log(`   ⚠ 频道检查失败: ${e.code}`) }
}

// ── 能力探测:这个 workspace 到底能走哪条路线 ────────────────────────
// ⭐ 直接试探"能不能调",而不是查套餐名 —— 我们关心的是能不能跑;
//    而且 bot token 本来就读不到 workspace 的付费方案。
// 官方只笼统说 "some AI features require a paid plan",没有逐方法清单 ⇒ 只能实测。
probes['plan-check'] = async () => {
  need('SLACK_BOT_TOKEN', 'SLACK_CHANNEL')
  const a = await api('auth.test')
  log(`workspace: ${a.team}  (${a.team_id})`)
  log(`bot      : ${a.user}  (${a.user_id})\n`)

  const anchor = await api('chat.postMessage', { channel: CHANNEL, text: '[probe] 能力探测中,稍后自动删除' })
  const trash = [anchor.ts]
  const R = {}
  const tryIt = async (key, fn, okCodes = []) => {
    try { await fn(); R[key] = '✅ 可用' }
    catch (e) { R[key] = okCodes.includes(e.code) ? '✅ 可用' : `❌ ${e.code}` }
  }

  // —— 路线 A 的全部依赖(免费版应当全绿) ——
  await tryIt('chat.update  ', () => api('chat.update', { channel: CHANNEL, ts: anchor.ts, text: '[probe] 编辑测试' }))
  await tryIt('reactions.add', () => api('reactions.add', { channel: CHANNEL, timestamp: anchor.ts, name: 'eyes' }), ['already_reacted'])
  await tryIt('permalink    ', () => apiGet('chat.getPermalink', { channel: CHANNEL, message_ts: anchor.ts }))

  // —— 路线 B:流式 API。这正是"算不算付费 AI 特性"没有答案的那一项 ——
  await tryIt('startStream  ', async () => {
    const s = await api('chat.startStream', {
      channel: CHANNEL, thread_ts: anchor.ts,
      recipient_user_id: RECIPIENT || a.user_id, recipient_team_id: a.team_id,
      markdown_text: '[probe] 流式探测',
    })
    trash.push(s.ts)
    await api('chat.stopStream', { channel: CHANNEL, ts: s.ts }).catch(() => {})
  })

  // —— 路线 B:Agent Sessions(原生 Working… + Stop 按钮) ——
  await tryIt('agentSessions', async () => {
    await api('agents.sessions.setStatus', { channel_id: CHANNEL, thread_ts: anchor.ts, status: 'processing' })
    await api('agents.sessions.setStatus', { channel_id: CHANNEL, thread_ts: anchor.ts, status: 'active' }).catch(() => {})
  })

  for (const ts of trash) await api('chat.delete', { channel: CHANNEL, ts }).catch(() => {})

  log('═══ 结果 ═══')
  for (const [k, v] of Object.entries(R)) log(`  ${k}  ${v}`)

  const A = ['chat.update  ', 'reactions.add'].every((k) => R[k].startsWith('✅'))
  const B = R['startStream  '].startsWith('✅') && R['agentSessions'].startsWith('✅')
  log('\n═══ 结论 ═══')
  if (B)      log('  ⭐ 路线 B 可用 —— 原生流式 + Working…/Stop 按钮全部就绪(docs/SLACK.md「进度表达」)')
  else if (A) log('  ✅ 路线 A 可用,路线 B 不可用 —— 走 chat.update 就地重写 + reaction 回执(SLACK.md「进度表达」)')
  else        log('  🔴 连路线 A 都不通 —— 先按上面的错误码排查 scope 与频道成员身份')
  if (!B && A) {
    log('\n  路线 B 不可用的常见原因(按可能性排序):')
    log('   · feature_disabled  → workspace 未启用 AI agent 功能(免费方案,或管理员关掉了)')
    log('   · missing_scope     → manifest 没开 features.agent_view / 缺 assistant:write')
    log('   · not_authorized    → app 不在该频道')
    log('  ⇒ 想验路线 B 又不想升级:加入 Slack Developer Program 领一个免费全功能 sandbox。')
  }
  log('\n  ⚠ app 数量上限(免费版 10 个)bot token 查不到 —— 请手工看 workspace 设置的「已安装应用」。')
  log('    每台机器要占 1 个名额(一台机器一个 App,见 docs/SLACK.md「必须一开始就定对的三件事」)。')
}

// ── Socket Mode 端到端:整个选型都建立在它上面,必须真连一次 ────────
// ⚠ 用 app-level token(xapp-)不是 bot token;connections:write 装在它身上。
// ⚠ Node 原生 WebSocket 需 ≥22(与 design layout 同一前提),这里零新依赖。
probes.socket = async () => {
  need('SLACK_APP_TOKEN')
  const r = await fetch(API + 'apps.connections.open', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SLACK_APP_TOKEN}` }, // ⚠ 必须放 header,做 POST 参数会报错
  })
  const j = await r.json()
  if (!j.ok) { log(`❌ apps.connections.open → ${j.error}`); return }
  log(`✅ 拿到 wss URL(${j.url.slice(0, 46)}…)`)
  if (typeof WebSocket === 'undefined') { log('❌ 此 Node 没有原生 WebSocket,需 ≥22'); return }

  const ws = new WebSocket(j.url)
  let got = 0
  const t0 = Date.now()
  ws.addEventListener('open', () => log('✅ WebSocket 已连接,等待事件…(在频道里发条消息试试,60 秒后自动退出)'))
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data) } catch { return }
    if (m.type === 'hello') {
      // ⭐ hello 带 approximate_connection_time —— 官方说"每几小时要处理一次连接刷新",这是判据
      log(`   hello: 连接数=${m.num_connections} 预计存活≈${m.debug_info?.approximate_connection_time}s host=${m.debug_info?.host}`)
      return
    }
    if (m.type === 'disconnect') { log(`   ⚠ 服务端要求断开: reason=${m.reason}`); return }
    // ⭐ 必须先 ack 再处理 —— 60 分钟内 ack 失败率超 95% 会让事件订阅被临时禁用
    if (m.envelope_id) ws.send(JSON.stringify({ envelope_id: m.envelope_id }))
    const e = m.payload?.event
    if (e && e.type === 'message' && !e.bot_id) {
      got++
      log(`   📨 收到消息 #${got}: channel=${e.channel} user=${e.user} ts=${e.ts} text=${JSON.stringify((e.text || '').slice(0, 40))}`)
      log(`      subtype=${e.subtype || '(无)'} thread_ts=${e.thread_ts || '(无)'} files=${(e.files || []).length}`)
    } else if (e) log(`   · 其它事件: ${e.type}${e.subtype ? '/' + e.subtype : ''}`)
  })
  ws.addEventListener('error', () => log('   ⚠ WebSocket error'))
  await new Promise((res) => setTimeout(res, 60_000))
  ws.close()
  log(`\n结果: ${((Date.now() - t0) / 1000).toFixed(0)} 秒内收到 ${got} 条真人消息`)
  log(got ? '⭐ Socket Mode 端到端通了 —— 收事件这条链路可用' : '⚠ 没收到消息:确认 bot 在频道里、且期间真的有人发言')
}

// ── ① 决定性:频道内流式消息,非 recipient 的其他成员看不看得见 ──────
// 若答案是"看不见",群聊场景就只能走编辑消息,只能走 chat.update。
probes.visibility = async () => {
  need('SLACK_BOT_TOKEN', 'SLACK_CHANNEL')
  const a = await api('auth.test')
  const recipient = RECIPIENT || a.user_id
  if (!RECIPIENT) log('⚠ 未设 SLACK_RECIPIENT,回落到 bot 自己的 user_id —— 结论可能不代表真人视角\n')

  const anchor = await api('chat.postMessage', { channel: CHANNEL, text: '[probe] 可见性测试锚点' })
  const s = await api('chat.startStream', {
    channel: CHANNEL,
    thread_ts: anchor.ts,              // ⚠ 频道内必须挂 thread,否则 invalid_thread_ts
    recipient_user_id: recipient,
    recipient_team_id: a.team_id,
    markdown_text: '**[probe]** 流已开启,准备追加内容…\n',
  })
  for (let i = 1; i <= 3; i++) {
    await sleep(1500)
    await api('chat.appendStream', { channel: CHANNEL, ts: s.ts, markdown_text: `- 第 ${i} 段增量 (${hhmm()})\n` })
    log(`   append ${i}/3`)
  }
  const link = await apiGet('chat.getPermalink', { channel: CHANNEL, message_ts: s.ts }).catch(() => null)
  log(`\n✅ 流已建立  ts=${s.ts}  recipient=${recipient}`)
  if (link) log(`   ${link.permalink}`)
  log(`
⭐ 现在人工确认(这一步脚本代替不了 —— bot token 读回的是 bot 视角,不是别人的视角):
   1. 用 recipient 本人的账号打开上面的链接 → 应能看到三段增量
   2. 用**另一个不是 recipient 的账号**打开同一链接 → 看得见吗?
      看得见 ⇒ 路线 B 可用于群聊
      看不见 ⇒ 路线 B 在群聊作废,退回 chat.update(docs/SLACK.md「进度表达」)
   3. 确认完把 ts=${s.ts} 与锚点 ${anchor.ts} 删掉`)
  await api('chat.stopStream', { channel: CHANNEL, ts: s.ts }).catch((e) => log(`   (stopStream: ${e.code})`))
}

// ── ② 流的服务端最长存活时间 ────────────────────────────────────────
// 官方拒绝公布,但 SDK changelog 承认存在("the server closes a stream due to
// undocumented timeouts")。这是飞书 10 分钟坑的 Slack 版本,必须实测出数值。
probes['stream-life'] = async () => {
  need('SLACK_BOT_TOKEN', 'SLACK_CHANNEL')
  const a = await api('auth.test')
  const anchor = await api('chat.postMessage', { channel: CHANNEL, text: '[probe] 流存活时间测试' })
  const s = await api('chat.startStream', {
    channel: CHANNEL, thread_ts: anchor.ts,
    recipient_user_id: RECIPIENT || a.user_id, recipient_team_id: a.team_id,
    markdown_text: `**[probe]** 起流于 ${hhmm()},每 30 秒追加一次,直到服务端关闭\n`,
  })
  log(`起流 ts=${s.ts}  开始时间 ${hhmm()}  (Ctrl-C 可中断)\n`)
  const t0 = Date.now()
  for (let i = 1; i <= 180; i++) {           // 上限 90 分钟
    await sleep(30_000)
    const min = ((Date.now() - t0) / 60000).toFixed(1)
    try {
      await api('chat.appendStream', { channel: CHANNEL, ts: s.ts, markdown_text: `- +${min} 分钟 (${hhmm()})\n` })
      log(`   ✅ ${String(min).padStart(5)} 分钟  append 成功`)
    } catch (e) {
      log(`\n🔴 ${min} 分钟处失败 → ${e.code}`)
      if (e.code === 'message_not_in_streaming_state') {
        log(`⭐ 这就是流的服务端超时。把这个数字记下来,`)
        log(`   并确保适配器捕获此错误后降级到 chat.update(ts=${s.ts} 仍然有效)。`)
        // 验证逃生舱确实可用 —— 这是官方给的 fallback 路径
        try {
          await api('chat.update', { channel: CHANNEL, ts: s.ts, markdown_text: `(流已超时,改由 chat.update 续写 @ ${hhmm()})` })
          log(`✅ 逃生舱验证通过:流死后 chat.update 仍能写同一条消息`)
        } catch (e2) { log(`❌ 逃生舱也失败了: ${e2.code} —— 这会很麻烦,需另找降级路径`) }
      }
      return
    }
  }
  log('\n跑满 90 分钟仍未超时。停流。')
  await api('chat.stopStream', { channel: CHANNEL, ts: s.ts }).catch(() => {})
}

// ── ③ workspace 的消息编辑窗口是否约束 bot token ────────────────────
// 官方没明说该管理员设置是否作用于 bot,但 chat.update 的错误表里有 edit_window_closed,
// 释义写着 "per team settings"。按会发生来防 —— 这里测出实际行为。
probes['edit-window'] = async () => {
  need('SLACK_BOT_TOKEN', 'SLACK_CHANNEL')
  const wait = Number(process.argv[3] || 300)
  const m = await api('chat.postMessage', { channel: CHANNEL, text: `[probe] 编辑窗口测试 · 发出于 ${hhmm()}` })
  log(`已发消息 ts=${m.ts},等待 ${wait} 秒后尝试编辑…`)
  for (let left = wait; left > 0; left -= 30) { await sleep(Math.min(30, left) * 1000); log(`   剩余 ${Math.max(0, left - 30)}s`) }
  try {
    await api('chat.update', { channel: CHANNEL, ts: m.ts, text: `[probe] 已于 ${hhmm()} 成功编辑(等待 ${wait}s)` })
    log(`\n✅ 等待 ${wait}s 后仍可编辑 —— 该 workspace 在此时长内不限制 bot 编辑`)
    log(`   建议再用更长的等待值试一次,确认上界;或直接查 Workspace settings → Permissions → Message Editing`)
  } catch (e) {
    log(`\n🔴 编辑失败 → ${e.code}`)
    if (e.code === 'edit_window_closed') {
      log(`⭐ 确认该管理员设置**会**约束 bot token。适配器必须:`)
      log(`   捕获 edit_window_closed → 立刻 chat.postMessage 发新消息(带 thread_ts)→ 切换进度指针`)
      log(`   并且最终答案永远用独立的 postMessage 落地,不依赖 update 成功。`)
    }
  }
}

// ── 第 1 步最小闭环:让 src/platform/slack.js 自己跑一遍(不经引擎、不碰 bin/sbot.js)──
// 收到什么就回什么 + 打 👀 + 反查 permalink 对账。⭐ 它验的正是契约那四件事:
// start(收) / reply(回,挂线程) / addReaction(回执) / stop(优雅停),外加断线自愈。
// ⚠ 会真的往频道里发消息 —— 别在生产群跑。
probes.echo = async () => {
  need('SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN')
  const { createSlackPlatform } = require('../src/platform/slack')
  const mins = Number(process.argv[3]) || 5
  const plat = createSlackPlatform({
    botToken: TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    onlyWhenMentioned: process.env.SLACK_ONLY_MENTION === '1',
    // SLACK_DEBUG_RECONNECT=1 ⇒ 连接寿命缩到 360 秒,重连逻辑 6 分钟一轮(SLACK.md「可靠性」)
    ws: { debugReconnects: process.env.SLACK_DEBUG_RECONNECT === '1' },
    log: (m) => log('   ' + m),
  })
  await plat.start(
    async (msg) => {
      log(`📨 ${msg.senderName} @ ${msg.chatId}: ${JSON.stringify(msg.text.slice(0, 60))} · 图 ${(msg.images || []).length} · ts=${msg.msgId}`)
      await plat.addReaction(msg.chatId, msg.msgId, 'eyes')
      const body = ['**收到**(适配器自测回声,不经引擎)', '', '> ' + msg.text.slice(0, 300).replace(/\n/g, '\n> '), '', `- chatId \`${msg.chatId}\``, `- msgId \`${msg.msgId}\``].join('\n')
      const ts = await plat.reply(msg.replyCtx, body)
      // ⭐ 对账:permalink 是唯一能独立验证"消息真的在那个频道里"的手段(SLACK.md「静默失败」)
      log(ts ? `   ✅ 已回 ts=${ts} → ${(await plat.permalink(msg.chatId, ts)) || '(拿不到 permalink)'}` : '   🔴 回复失败 —— 看上面的错误码')
    },
    { onRecall: (r) => log(`   ↩ 收到撤回: chat=${r.chatId} msg=${r.msgId}`) },
  )
  log(`⏳ 跑 ${mins} 分钟 —— 去频道里说句话试试(Ctrl-C 可提前退出)`)
  const t0 = Date.now()
  const iv = setInterval(() => log(`   · ${((Date.now() - t0) / 60000).toFixed(1)} 分钟 · 连接 ${JSON.stringify(plat.connHealth().state)}`), 60_000)
  await sleep(mins * 60_000)
  clearInterval(iv)
  await plat.stop()
  log('已优雅停止(连接与定时器全部拆掉)')
}

// ── 入口 ──────────────────────────────────────────────────────────
const name = process.argv[2]
if (!name || !probes[name]) {
  console.error(`用法: node docs/slack-probe.js <${Object.keys(probes).join('|')}> [参数]`)
  console.error('详见本文件头部注释')
  process.exit(1)
}
probes[name]().catch((e) => {
  console.error(`\n❌ ${e.message}`)
  if (e.code === 'missing_scope') console.error(`   缺 scope: ${e.payload?.needed}(现有: ${e.payload?.provided})`)
  if (e.code === 'not_in_channel') console.error('   bot 不在频道里 —— 先 /invite')
  if (e.code === 'invalid_thread_ts') console.error('   ⚠ 频道内流式必须挂 thread,见 docs/SLACK.md「进度表达」')
  process.exit(1)
})
