// 控制台 × 企业微信(双平台并存):`/api/wecom/chats` 的候选来自机器人被 @ 过的群(官方 CLI 两路合并),群名顺手回写;
// 建群 / 解散 / 拉人在企微没有接口 ⇒ 对企微群(按群配置 / id 形态 / 只配了企微判)明确报做不了(而不是去拿飞书凭证撞 400「先填 appId」);
// 绑群写入 platform 字段。走真实 HTTP 端点 + 注入的假执行器,零网络。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createUiServer } = require('../../src/ui/server')

const NOTICE = { security_notice: 'x', extra_identity_context: 'y' }
function fakeExec(calls) {
  return (bin, args, opts, cb) => {
    calls.push(args.join(' '))
    if (args[0] === 'auth') return setImmediate(() => cb(null, 'Status: authorized\nBot ID: ' + (fakeExec.authBot || 'aibX') + '\n', '')) // 纯文本,不是 JSON
    if (args[0] === 'identity') return setImmediate(() => fakeExec.whoami ? cb(null, JSON.stringify({ ...NOTICE, extra_identity_context: fakeExec.whoami }), '') : cb(Object.assign(new Error('x'), { code: 2 }), '', 'error: unrecognized subcommand')) // 默认当老版工具:没有身份服务
    const out = args[0] === 'message'
      ? { ...NOTICE, sessions: [{ chat_id: 'wrG1', chat_name: '测试群·新名', last_msg_time: '2026-10-10 14:00:00', chat_type: 'group' }, { chat_id: 'woU1', chat_name: '王五', last_msg_time: '2026-10-10 15:00:00', chat_type: 'single' }] }
      : { ...NOTICE, chats: [{ chat_id: 'wrG2', chat_name: '另一个群', last_msg_time: '2026-10-09 09:00:00' }, { chat_id: 'wrG1', chat_name: '测试群·新名', last_msg_time: '2026-10-10 14:00:00' }] }
    setImmediate(() => cb(null, JSON.stringify(out), ''))
  }
}

async function withServer(raw, exec, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-wecom-ui-'))
  const cfgPath = path.join(dir, 'sbot.config.json')
  fs.writeFileSync(cfgPath, JSON.stringify(raw))
  const ui = createUiServer({ sessionsPath: path.join(dir, 'ui-sessions.json'), auditPath: path.join(dir, 'audit.jsonl'), configPath: cfgPath, wecomExec: exec })
  await new Promise((r) => ui.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${ui.server.address().port}`
  const m = (await (await fetch(base + '/')).text()).match(/let TOKEN='([a-f0-9]{32})'/)
  if (!m) { ui.close(); throw new Error('页面里抠不到注入的令牌锚点') }
  const H = { 'x-sbot-token': m[1], 'content-type': 'application/json' }
  const call = (p, method = 'GET', body) => fetch(base + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  try { await run({ call, cfgPath }) } finally { ui.close() }
}

test('server/wecom: 群候选来自两路 CLI 合并去重(只留群、按最近消息排序),已绑群名回写', async () => {
  const calls = []
  const raw = { wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: { wrG1: { workdir: '/x', name: '旧名' } } }
  await withServer(raw, fakeExec(calls), async ({ call, cfgPath }) => {
    const r = await call('/api/wecom/chats')
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.deepEqual(j.chats.map((c) => c.chatId), ['wrG1', 'wrG2'], '单聊不在候选里;wrG1 两路都有只留一份')
    assert.equal(j.chats[0].name, '测试群·新名')
    assert.match(j.hint, /被 @ 过/)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.wrG1.name, '测试群·新名', '群名回写')
    assert.ok(calls.some((c) => /^message aibot sessions list/.test(c)) && calls.some((c) => /^chat groups list/.test(c)), '对照:两路都调了')
  })
})

test('server/wecom: 建群 / 解散 / 拉成员对企微群明确说做不了;飞书群照走飞书那条路', async () => {
  // 只配企微:建群没有平台可建;wr 形态 / 已绑企微群的解散与拉人都报没接口
  const raw = { wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: { wrG1: { workdir: '/x' } } }
  await withServer(raw, fakeExec([]), async ({ call }) => {
    for (const [p, m, b] of [['/api/feishu/chats/create', 'POST', { name: 'x' }], ['/api/feishu/chat-members?chatId=wrG1', 'GET'], ['/api/feishu/chats?chatId=wrG1', 'DELETE'], ['/api/feishu/chats/members', 'POST', { chatId: 'wrG1', memberIds: ['u'] }]]) {
      const r = await call(p, m, b)
      assert.equal(r.status, 400, p)
      assert.match((await r.json()).error, /企业微信里建群/, p)
    }
    const r = await call('/api/feishu/chats'); assert.equal(r.status, 400); assert.match((await r.json()).error, /appId/, '飞书候选接口不再被企微接管,各管各的')
  })
  // 双平台都配:群按配置里的 platform(wrG1 写了)或 id 形态(未绑定的 wrZZZZZZZZ)分流 —— 企微群报没接口,飞书群走飞书(没填明文凭证 ⇒ 让人先填 appId)
  await withServer({ feishu: { appId: 'env:NOPE', appSecret: 'env:NOPE' }, wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: { wrG1: { workdir: '/x', platform: 'wecom' }, oc_f1: { workdir: '/y' } } }, fakeExec([]), async ({ call }) => {
    let r = await call('/api/feishu/chats?chatId=wrG1', 'DELETE'); assert.equal(r.status, 400); assert.match((await r.json()).error, /企业微信里建群/)
    r = await call('/api/feishu/chat-members?chatId=wrZZZZZZZZ', 'GET'); assert.equal(r.status, 400); assert.match((await r.json()).error, /企业微信里建群/)
    r = await call('/api/feishu/chats?chatId=oc_f1', 'DELETE'); assert.equal(r.status, 400); assert.match((await r.json()).error, /appId/)
  })
  // 对照:只配飞书(现有两台形态)同一个端点走飞书那条路
  await withServer({ providers: { claude: {} }, groups: {} }, (b, a, o, cb) => cb(new Error('不该调到')), async ({ call }) => {
    const r = await call('/api/feishu/chats')
    assert.equal(r.status, 400); assert.match((await r.json()).error, /appId/)
    const w = await call('/api/wecom/chats')
    assert.equal(w.status, 400); assert.match((await w.json()).error, /Bot ID/)
  })
})

test('server/wecom: 绑群写入 platform;没给按 id 形态 / 唯一平台推断;标成没配的平台也允许(doctor 群行报收不到消息)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-wecom-bind-'))
  const raw = { wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: {}, projectsRoots: [dir] }
  const wd = path.join(dir, 'p'); fs.mkdirSync(wd)
  await withServer(raw, fakeExec([]), async ({ call, cfgPath }) => {
    let r = await call('/api/groups', 'POST', { chatId: 'wrG9', workdir: wd, platform: 'wecom' })
    assert.equal(r.status, 200)
    const st = await r.json()
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.wrG9.platform, 'wecom')
    assert.equal(st.groups.find((g) => g.chatId === 'wrG9').platform, 'wecom', 'state 里群带 platform')
    assert.deepEqual(st.platforms, { feishu: false, wecom: true, slack: false })
    assert.equal(st.notified, false, '独立控制台没有机器人长连接 ⇒ 企微绑定通知发不了,如实报'); assert.equal(st.noticeQueued, false)
    // 没给 platform:企微单聊 id 认不出形态,只配了企微 ⇒ 归企微并写进文件
    r = await call('/api/groups', 'POST', { chatId: 'WangWu', workdir: wd })
    assert.equal(r.status, 200); assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.WangWu.platform, 'wecom')
    // 标成飞书却没配飞书:照样允许(纯配置模式先绑群后填凭据一直是允许的;doctor 群行会报「收不到消息」),字段按给的写
    r = await call('/api/groups', 'POST', { chatId: 'oc_zz', workdir: wd, platform: 'feishu' })
    assert.equal(r.status, 200); assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.oc_zz.platform, 'feishu')
    r = await call('/api/groups', 'POST', { chatId: 'oc_zz', workdir: wd, platform: 'discord' }) // 不认识的平台值
    assert.equal(r.status, 400); assert.match((await r.json()).error, /只认/)
  })
  // 两个平台都配 + 没给 platform:按 id 形态落文件;认不出形态(企微单聊 id)⇒ 暂按飞书落文件(已知行为:弹窗总会给 platform,这条只是兜底)
  const raw2 = { feishu: { appId: 'cli_x', appSecret: 's' }, wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: {}, projectsRoots: [dir] }
  await withServer(raw2, fakeExec([]), async ({ call, cfgPath }) => {
    for (const [cid, want] of [['oc_x1', 'feishu'], ['wrABCDEFGH12345', 'wecom'], ['WangWu', 'feishu']]) {
      const r = await call('/api/groups', 'POST', { chatId: cid, workdir: wd })
      assert.equal(r.status, 200, cid); assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups[cid].platform, want, cid)
    }
    // 显式平台与 id 形态打架 ⇒ 拒(改既有群时弹窗档位没切对的那种),文件不动
    let r = await call('/api/groups', 'POST', { chatId: 'wrABCDEFGH12345', workdir: wd, platform: 'feishu' })
    assert.equal(r.status, 400); assert.match((await r.json()).error, /企业微信的/); assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).groups.wrABCDEFGH12345.platform, 'wecom')
    r = await call('/api/groups', 'POST', { chatId: 'oc_x1', workdir: wd, platform: 'wecom' }); assert.equal(r.status, 400)
    r = await call('/api/groups', 'POST', { chatId: 'WangWu', workdir: wd, platform: 'wecom' }); assert.equal(r.status, 200, '没形态的 id 显式给什么就是什么')
  })
})

test('server/wecom: 概览连接行按平台字典一行一个;旧形状单快照按飞书;未知平台键被滤', () => {
  const { connHealthRows } = require('../../src/ui/server')
  const rows = connHealthRows({ feishu: { state: 'connected' }, wecom: { state: 'reconnecting', reconnects: 2 }, discord: { state: 'connected' } })
  assert.deepEqual(rows.map((r) => [r.label, r.status]), [['飞书连接', 'ok'], ['企业微信连接', 'warn']])
  assert.match(rows[1].detail, /重连中 · 重连 2/)
  assert.deepEqual(connHealthRows({ state: 'failed', lastError: 'x' }).map((r) => [r.label, r.status]), [['飞书连接', 'fail']])
  assert.deepEqual(connHealthRows(null), [])
})

test('server/wecom: 绑定通知按平台措辞 —— 企微群只收 @', () => {
  const { bindNoticeText } = require('../../src/ui/server')
  assert.match(bindNoticeText('/x/demo', 'wecom'), /只有 @ 我的消息/); assert.ok(!/直接发消息/.test(bindNoticeText('/x/demo', 'wecom')))
  assert.match(bindNoticeText('/x/demo'), /直接发消息或 @我/); assert.match(bindNoticeText('/x/demo', 'wecom'), /demo/, '对照:正文读到了')
})

test('server/wecom: 命令行工具没装 ⇒ 502 且把缘由说清', async () => {
  const raw = { wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: {} }
  await withServer(raw, (b, a, o, cb) => setImmediate(() => cb(Object.assign(new Error('nf'), { code: 'ENOENT' }))), async ({ call }) => {
    const r = await call('/api/wecom/chats')
    assert.equal(r.status, 502); assert.match((await r.json()).error, /未安装/)
  })
})

test('server/wecom: 设置卡写回(填了写、空值不覆盖、env: 保留、names 整体替换)与 state 的 wecom 块形状', async () => {
  const raw = { wecom: { botId: 'env:SBOT_T_WBOT', secret: 's0', names: { Old: '旧' } }, providers: { claude: {} }, groups: {} }
  await withServer(raw, fakeExec([]), async ({ call, cfgPath }) => {
    let st = await (await call('/api/state')).json()
    assert.deepEqual(st.wecom, { botId: '', botIdRef: 'SBOT_T_WBOT', secretStatus: 'set', botName: '', welcome: '', names: { Old: '旧' }, cliOff: false, keywords: null, pollSec: 0, followSec: 300, gatekeeper: null }, 'env: 引用的 botId 渲染为空 + 引用名;secret 只给形状;轮询两档给默认值')
    assert.deepEqual(st.platforms, { feishu: false, wecom: true, slack: false })
    // 空 botId / 空 secret 不覆盖;botName / welcome / names 整体按给的写(空串 = 删字段)
    let r = await call('/api/wecom', 'POST', { botId: '', secret: '  ', botName: 'SintBot', welcome: '', names: { WangWu: '王五', ' ': 'x', Bad: '' } })
    assert.equal(r.status, 200)
    let saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom
    assert.equal(saved.botId, 'env:SBOT_T_WBOT', 'env: 引用没被空串冲掉'); assert.equal(saved.secret, 's0')
    assert.equal(saved.botName, 'SintBot'); assert.equal('welcome' in saved, false); assert.deepEqual(saved.names, { WangWu: '王五' })
    r = await call('/api/wecom', 'POST', { botId: 'aibNEW', secret: 'sNEW', names: {} })
    saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom
    assert.equal(saved.botId, 'aibNEW'); assert.equal(saved.secret, 'sNEW'); assert.equal('names' in saved, false, '空映射 = 删字段')
    st = await r.json(); assert.equal(st.wecom.botId, 'aibNEW'); assert.equal(st.wecom.botIdRef, '')
    // 对照:没配 wecom 块时 state.wecom 为 null,platforms.wecom 为 false
    let bare = null
    await withServer({ providers: { claude: {} }, groups: {} }, fakeExec([]), async ({ call }) => { bare = await (await call('/api/state')).json() })
    assert.equal(bare.wecom, null); assert.equal(bare.platforms.wecom, false)
  })
})

test('server/wecom: 预检三行 —— 凭据形状 · 工具装没装 / 授权通不通 · 可绑定群数;不另开长连接', async () => {
  const calls = []
  await withServer({ wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: {} }, fakeExec(calls), async ({ call }) => {
    const r = await call('/api/wecom/precheck', 'POST', {})
    assert.equal(r.status, 200)
    const j = await r.json()
    const by = (l) => j.checks.find((c) => c.label === l)
    assert.equal(by('凭据').status, 'ok'); assert.equal(by('命令行工具').status, 'ok'); assert.equal(by('可绑定的群').status, 'ok'); assert.match(by('可绑定的群').detail, /^2 个/)
    assert.equal(by('工具授权身份').status, 'ok'); assert.match(by('工具授权身份').detail, /同一个机器人/)
    assert.ok(calls.some((c) => c === 'auth show'), '对照:老版工具没身份服务时退回 auth show')
    assert.equal(by('通讯录授权').status, 'ok'); assert.ok(calls.some((c) => /contact users search/.test(c)), '通讯录能力单独探')
    assert.match(j.note, /守护进程/)
    assert.ok(!calls.some((c) => /subscribe|aibot_subscribe/.test(c)), '对照:只调了列会话,没有订阅动作'); assert.ok(calls.length >= 1)
    for (const c of j.checks) assert.ok(!/sbot|wecom-cli/.test(c.detail), '控制台可见文案零工具名:' + c.detail)
  })
  // 工具授权给了另一个机器人 ⇒ warn 说清后果(姓名照常、发图 / 列群是那个机器人的)
  fakeExec.authBot = 'aibOTHER12345'
  await withServer({ wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: {} }, fakeExec([]), async ({ call }) => {
    const j = await (await call('/api/wecom/precheck', 'POST', {})).json()
    const t = j.checks.find((c) => c.label === '工具授权身份'); assert.equal(t.status, 'warn'); assert.match(t.detail, /另一个机器人\(aibOTH…2345\)/); assert.match(t.detail, /重新授权/)
  })
  delete fakeExec.authBot
  // 工具没装 ⇒ 命令行工具 warn(降级不阻断),没有「可绑定的群」行;凭据缺 ⇒ fail
  await withServer({ wecom: { botId: 'aibX' }, providers: { claude: {} }, groups: {} }, (b, a, o, cb) => setImmediate(() => cb(Object.assign(new Error('nf'), { code: 'ENOENT' }))), async ({ call }) => {
    const j = await (await call('/api/wecom/precheck', 'POST', {})).json()
    const by = (l) => j.checks.find((c) => c.label === l)
    assert.equal(by('凭据').status, 'fail'); assert.match(by('凭据').detail, /Secret/)
    assert.equal(by('命令行工具').status, 'warn'); assert.match(by('命令行工具').detail, /未安装/); assert.equal(by('可绑定的群'), undefined)
  })
  // 装了但调不通(没授权 / 过期)⇒ fail 且带原话
  await withServer({ wecom: { botId: 'aibX', secret: 's', cli: 'x-cli' }, providers: { claude: {} }, groups: {} }, (b, a, o, cb) => setImmediate(() => cb(null, JSON.stringify({ error: { code: 'AUTH', message: 'not authorized' } }), '')), async ({ call }) => {
    const j = await (await call('/api/wecom/precheck', 'POST', {})).json()
    const t = j.checks.find((c) => c.label === '命令行工具'); assert.equal(t.status, 'fail'); assert.match(t.detail, /not authorized/)
  })
  // 配置里关了工具 ⇒ skip
  await withServer({ wecom: { botId: 'aibX', secret: 's', cli: false }, providers: { claude: {} }, groups: {} }, (b, a, o, cb) => cb(new Error('不该调到')), async ({ call }) => {
    const j = await (await call('/api/wecom/precheck', 'POST', {})).json()
    assert.equal(j.checks.find((c) => c.label === '命令行工具').status, 'skip')
    const st = await (await call('/api/state')).json(); assert.equal(st.wecom.cliOff, true)
  })
})

test('server/wecom: 「不 @ 也回复」两档 —— state 给默认值;写回认 0;空串回默认;非法拒', async () => {
  await withServer({ wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: {} }, fakeExec([]), async ({ call, cfgPath }) => {
    let st = await (await call('/api/state')).json()
    assert.equal(st.wecom.pollSec, 0, '默认关'); assert.equal(st.wecom.followSec, 300)
    let r = await call('/api/wecom', 'POST', { pollSec: '0', followSec: 0 }); assert.equal(r.status, 200)
    let saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom; assert.equal(saved.pollSec, 0); assert.equal(saved.followSec, 0, '0 有意义(关 / 全喂),要写')
    st = await r.json(); assert.equal(st.wecom.pollSec, 0); assert.equal(st.wecom.followSec, 0)
    r = await call('/api/wecom', 'POST', { pollSec: '', followSec: '45.6' }); assert.equal(r.status, 200)
    saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom; assert.equal('pollSec' in saved, false, '空串 = 回默认'); assert.equal(saved.followSec, 46)
    r = await call('/api/wecom', 'POST', { pollSec: 'abc' }); assert.equal(r.status, 400); assert.match((await r.json()).error, /秒数/)
    r = await call('/api/wecom', 'POST', { followSec: -5 }); assert.equal(r.status, 400)
  })
})

test('server/wecom: 便宜模型门控写回 —— state 统一成 {provider, model};只认存在的模型名;空 provider = 关(删字段);型号可选', async () => {
  await withServer({ wecom: { botId: 'aibX', secret: 's', gatekeeper: 'deepseek' }, providers: { claude: {}, deepseek: { baseUrl: 'https://d', apiKey: 'k' } }, groups: {} }, fakeExec([]), async ({ call, cfgPath }) => {
    let st = await (await call('/api/state')).json()
    assert.deepEqual(st.wecom.gatekeeper, { provider: 'deepseek', model: '' }, '字串形态也统一成对象')
    let r = await call('/api/wecom', 'POST', { gatekeeper: { provider: 'deepseek', model: 'flash' } }); assert.equal(r.status, 200)
    assert.deepEqual(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom.gatekeeper, { provider: 'deepseek', model: 'flash' })
    assert.deepEqual((await r.json()).wecom.gatekeeper, { provider: 'deepseek', model: 'flash' })
    r = await call('/api/wecom', 'POST', { gatekeeper: { provider: 'deepseek', model: '' } }); assert.deepEqual(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom.gatekeeper, { provider: 'deepseek' }, '型号留空不写字段')
    r = await call('/api/wecom', 'POST', { gatekeeper: { provider: 'ghost' } }); assert.equal(r.status, 400); assert.match((await r.json()).error, /不在模型列表里/)
    r = await call('/api/wecom', 'POST', { gatekeeper: { provider: '', model: 'x' } }); assert.equal(r.status, 200)
    assert.equal('gatekeeper' in JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom, false, '关 = 删字段'); assert.equal((await r.json()).wecom.gatekeeper, null)
    r = await call('/api/wecom', 'POST', { gatekeeper: { provider: 'deepseek', model: 'flash' } }); assert.equal(r.status, 200)
    r = await call('/api/wecom', 'POST', { pollSec: '30' }); assert.deepEqual(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom.gatekeeper, { provider: 'deepseek', model: 'flash' }, '不带字段不动(先写回再 POST 别的字段,它要原样还在 —— 否则「没动」与「又删了一次」分不清)')
  })
})

test('server/wecom: 点名词与命令行工具开关 —— 字串按逗号 / 顿号 / 空白切、去重;空 = 回默认;超限拒;cliOff 开关只动 cli:false', async () => {
  await withServer({ wecom: { botId: 'aibX', secret: 's', cli: 'my-cli' }, providers: { claude: {} }, groups: {} }, fakeExec([]), async ({ call, cfgPath }) => {
    const saved = () => JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom
    let r = await call('/api/wecom', 'POST', { keywords: '小助理, 小助理、bot  老板' }); assert.equal(r.status, 200)
    assert.deepEqual(saved().keywords, ['小助理', 'bot', '老板']); assert.deepEqual((await r.json()).wecom.keywords, ['小助理', 'bot', '老板'])
    r = await call('/api/wecom', 'POST', { keywords: ['甲', ''] }); assert.deepEqual(saved().keywords, ['甲'], '数组形态也认')
    r = await call('/api/wecom', 'POST', { keywords: '' }); assert.equal('keywords' in saved(), false, '空 = 回默认'); assert.equal((await r.json()).wecom.keywords, null)
    r = await call('/api/wecom', 'POST', { keywords: 'x'.repeat(21) }); assert.equal(r.status, 400); assert.match((await r.json()).error, /点名词/)
    // 开关:关 ⇒ cli:false(自定义可执行名被盖掉,这是「关」的语义);开 ⇒ 删 false;本来是字串时「开」不动它
    r = await call('/api/wecom', 'POST', { cliOff: true }); assert.equal(saved().cli, false); assert.equal((await r.json()).wecom.cliOff, true)
    r = await call('/api/wecom', 'POST', { cliOff: false }); assert.equal('cli' in saved(), false); assert.equal((await r.json()).wecom.cliOff, false)
    r = await call('/api/wecom', 'POST', { botName: 'X' }); assert.equal('cli' in saved(), false, '不带字段不动')
  })
})

test('server/wecom: 刷新身份 —— 扫最近群历史里的 @,被 @ 最多的名字落进 botName;没人 @ 过给 hint;工具关着拒', async () => {
  const mk = (hist) => (b, a, o, cb) => {
    const key = a.join(' ')
    let out
    if (/aibot sessions list/.test(key)) out = { ...NOTICE, sessions: [{ chat_id: 'wrG1', chat_name: 'A', last_msg_time: '2026-10-10 14:00:00', chat_type: 'group' }, { chat_id: 'wrG2', chat_name: 'B', last_msg_time: '2026-10-09 14:00:00', chat_type: 'group' }] }
    else if (/chat groups list/.test(key)) out = { ...NOTICE, chats: [] }
    else if (/chat messages list/.test(key)) out = { ...NOTICE, messages: hist[/wrG1/.test(key) ? 0 : 1] }
    else out = { ...NOTICE }
    setImmediate(() => cb(null, JSON.stringify(out), ''))
  }
  const h1 = [{ msg_type: 'text', text: { content: '@SintBot 现在几点' } }, { msg_type: 'text', text: { content: '@张三 @SintBot 看看' } }]
  const h2 = [{ msg_type: 'mixed', mixed: { items: [{ msg_type: 'text', text: { content: '@SintBot 这是什么' } }] } }, { msg_type: 'text', text: { content: '@张三 吃饭' } }]
  await withServer({ wecom: { botId: 'aibX', secret: 's', botName: 'SintBot-Ops' }, providers: { claude: {} }, groups: {} }, mk([h1, h2]), async ({ call, cfgPath }) => {
    const r = await call('/api/wecom/identity', 'POST', {}); assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.name, 'SintBot'); assert.equal(j.count, 3); assert.equal(j.total, 4); assert.equal(j.groups, 2); assert.equal(j.changed, true)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom.botName, 'SintBot', '落进配置,手填的错名被纠正'); assert.equal(j.state.wecom.botName, 'SintBot')
    const r2 = await (await call('/api/wecom/identity', 'POST', {})).json(); assert.equal(r2.changed, false, '第二次不变')
  })
  await withServer({ wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: {} }, mk([[{ msg_type: 'text', text: { content: '闲聊' } }], []]), async ({ call, cfgPath }) => {
    const j = await (await call('/api/wecom/identity', 'POST', {})).json(); assert.equal(j.name, null); assert.match(j.hint, /@ 它说一句/)
    assert.equal('botName' in JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom, false, '没学到就不写')
  })
  await withServer({ wecom: { botId: 'aibX', secret: 's', cli: false }, providers: { claude: {} }, groups: {} }, mk([[], []]), async ({ call }) => {
    const r = await call('/api/wecom/identity', 'POST', {}); assert.equal(r.status, 400); assert.match((await r.json()).error, /命令行工具已关闭/)
  })
})

test('server/wecom: 刷新身份正路 = 工具身份接口(有名字 + ID + 授权用户);预检「工具授权身份」也先用它,名字一并显示', async () => {
  const mkId = (b, a, o, cb) => {
    const key = a.join(' ')
    if (/identity whoami/.test(key)) return setImmediate(() => cb(null, JSON.stringify({ ...NOTICE, extra_identity_context: '<extra_identity_context>\n机器人身份：\n名字：SintBot\nID：aibX\n授权真人用户身份：\n名字：王五\nID：woA2\n</extra_identity_context>' }), ''))
    if (/aibot sessions list/.test(key)) return setImmediate(() => cb(null, JSON.stringify({ ...NOTICE, sessions: [] }), ''))
    if (/auth show/.test(key)) return setImmediate(() => cb(null, 'Status: authorized\nBot ID: aibOTHER\n', ''))
    setImmediate(() => cb(null, JSON.stringify({ ...NOTICE, chats: [], messages: [] }), ''))
  }
  await withServer({ wecom: { botId: 'aibX', secret: 's', botName: 'SintBot-Ops' }, providers: { claude: {} }, groups: {} }, mkId, async ({ call, cfgPath }) => {
    const j = await (await call('/api/wecom/identity', 'POST', {})).json()
    assert.equal(j.source, 'identity'); assert.equal(j.name, 'SintBot'); assert.equal(j.botId, 'aibX'); assert.deepEqual(j.user, { name: '王五', id: 'woA2' }); assert.equal(j.changed, true)
    assert.equal(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).wecom.botName, 'SintBot')
    const pc = await (await call('/api/wecom/precheck', 'POST', {})).json()
    const t = pc.checks.find((c) => c.label === '工具授权身份'); assert.equal(t.status, 'ok'); assert.match(t.detail, /同一个机器人\(SintBot · aibX/, '有身份服务时不看 auth show(它给的是另一个 ID)')
  })
})

test('server/wecom: 预检「通讯录授权」—— 850003 ⇒ fail 说续期;别的错 ⇒ warn', async () => {
  const mk = (code) => (b, a, o, cb) => {
    const key = a.join(' ')
    if (/contact users search/.test(key)) return setImmediate(() => cb(null, JSON.stringify({ error: { code, message: 'nope', help_message: 'https://renew' } }), ''))
    if (/auth show/.test(key)) return setImmediate(() => cb(null, 'Status: authorized\nBot ID: aibX\n', ''))
    if (/identity/.test(key)) return setImmediate(() => cb(Object.assign(new Error('x'), { code: 2 }), '', 'err'))
    setImmediate(() => cb(null, JSON.stringify({ ...NOTICE, sessions: [], chats: [] }), ''))
  }
  await withServer({ wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: {} }, mk(850003), async ({ call }) => {
    const j = await (await call('/api/wecom/precheck', 'POST', {})).json(); const t = j.checks.find((c) => c.label === '通讯录授权')
    assert.equal(t.status, 'fail'); assert.match(t.detail, /已过期/); assert.match(t.detail, /续期/); assert.doesNotMatch(t.detail, /https:/)
  })
  await withServer({ wecom: { botId: 'aibX', secret: 's' }, providers: { claude: {} }, groups: {} }, mk(40058), async ({ call }) => {
    const j = await (await call('/api/wecom/precheck', 'POST', {})).json(); const t = j.checks.find((c) => c.label === '通讯录授权')
    assert.equal(t.status, 'warn'); assert.match(t.detail, /查不通/)
  })
})
