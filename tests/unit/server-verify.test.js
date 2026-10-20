// /api/claude/verify 的去抖(v0.11.21):自动探(不带 force)不清缓存、60s 内直接吃
// claudeStatusCache;只有 force(人点「检测登录」)才绕过缓存强制现打。为什么必须分:
// daemon 重启后 operator 重登控制台、开几个标签页,页面加载的自动探每次都 clearCache 强打,
// 正好捅上游额度端点的低限流阈值(429 持续数分钟,群里 /hud 跟着遭殃)。
// 两条路的响应体长得一样 ⇒ 只有数「真探了几次」才测得出去抖 —— 所以把 claudestatus /
// claudeusage 经 require.cache 桩掉(必须先于 server 加载),计数器说话。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const N = { probes: 0, statusCleared: 0, usageCleared: 0, usageCalls: 0 }
const csPath = require.resolve('../../src/agent/claudestatus')
require.cache[csPath] = { id: csPath, filename: csPath, loaded: true, exports: {
  clearCache: () => { N.statusCleared++ },
  cachedLoginStatus: async () => { N.probes++; return { ok: true, loggedIn: true, plan: 'max' } },
} }
const cuPath = require.resolve('../../src/agent/claudeusage')
require.cache[cuPath] = { id: cuPath, filename: cuPath, loaded: true, exports: {
  clearCache: () => { N.usageCleared++ },
  usageLine: async () => { N.usageCalls++; return '5h:12%' },
} }
const { createUiServer } = require('../../src/ui/server')
const { rmTmpDir } = require('./tmpdir')

async function withServer(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-verify-'))
  const cfgPath = path.join(dir, 'sbot.config.json')
  fs.writeFileSync(cfgPath, JSON.stringify({ providers: { claude: {} }, defaultProvider: 'claude', agent: {}, groups: {} }))
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {} })
  await new Promise((r) => ui.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${ui.server.address().port}`
  // 锚点抠不到就先关服务器再抛:否则心跳定时器让 node --test 永不退出,CI 静默挂死而不是变红(2026-09-07 踩过)
  const tokenMatch = (await (await fetch(base + '/')).text()).match(/let TOKEN='([a-f0-9]{32})'/)
  if (!tokenMatch) { ui.close(); throw new Error('页面里抠不到注入的令牌锚点') }
  const token = tokenMatch[1]
  const call = (body) => fetch(base + '/api/claude/verify', {
    method: 'POST', headers: { 'x-sbot-token': token, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const models = () => fetch(base + '/api/claude/models', { headers: { 'x-sbot-token': token } })
  try { await run({ call, models }) }
  finally { ui.close(); await rmTmpDir(dir) }
}

test('verify: 自动探(无 force)只真探一次,60s 内后续请求吃缓存且不清任何缓存', async () => {
  await withServer(async ({ call }) => {
    const r1 = await call({})
    assert.equal(r1.status, 200)
    const j1 = await r1.json()
    assert.equal(j1.loggedIn, true)
    assert.equal(j1.usage, '5h:12%', '已登录要带上额度行')
    assert.equal(N.probes, 1)
    assert.equal(N.statusCleared, 0, '自动探绝不许清登录态缓存')
    assert.equal(N.usageCleared, 0, '自动探绝不许清额度缓存')
    const r2 = await call({})
    assert.equal(r2.status, 200)
    assert.equal((await r2.json()).usage, '5h:12%', '缓存答案要和现打的一致')
    assert.equal(N.probes, 1, '60s 内第二次自动探必须吃缓存,不许再打')
    assert.equal(N.usageCalls, 1, '额度也不许再拉')
  })
})

test('verify: force 绕过缓存 —— 清两处缓存并强制现打(点按钮就是要此刻的数)', async () => {
  await withServer(async ({ call }) => {
    await call({}) // 先灌一份新鲜缓存
    const before = { probes: N.probes, usageCalls: N.usageCalls }
    const r = await call({ force: true })
    assert.equal(r.status, 200)
    assert.equal(N.statusCleared >= 1, true, 'force 必须清登录态缓存')
    assert.equal(N.usageCleared >= 1, true, 'force 必须清额度缓存')
    assert.equal(N.probes, before.probes + 1, 'force 必须真探,不吃缓存')
    assert.equal(N.usageCalls, before.usageCalls + 1)
    // force 现打之后缓存已刷新 —— 紧随的自动探又该吃缓存,而不是被 force 搅得从头再来
    await call({})
    assert.equal(N.probes, before.probes + 1, 'force 后的自动探吃 force 灌的新缓存')
  })
})

// 模型下拉那条路也回填同一份缓存,但它**不查额度** —— 直接覆盖就把 usage 洗掉了,
// 而 60s 去抖会把这份缺 usage 的缓存原样吐给下一次自动探:卡片上的额度行凭空消失。
test('models 回填缓存时留住 usage —— 拉一次模型清单不该让卡片的额度行消失', async () => {
  await withServer(async ({ call, models }) => {
    assert.equal((await (await call({})).json()).usage, '5h:12%', '前提:verify 先灌进一份带额度的缓存')
    const rm = await models()
    assert.equal(rm.status, 200)
    assert.equal((await rm.json()).login.ok, true, '对照组:这条路本身是通的(否则下面的断言测了个寂寞)')
    const j = await (await call({})).json() // 不带 force ⇒ 走 60s 去抖,吃的正是上面被回填过的那份缓存
    assert.equal(j.usage, '5h:12%', '模型清单不查额度,但也不许把已有的额度洗掉')
    assert.equal(j.loggedIn, true)
  })
})
