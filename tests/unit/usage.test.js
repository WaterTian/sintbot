// 额度/余额查询的守卫与手动刷新(v0.11.9:模型卡额度行的「↻」)。
//
// 全程零网络:queryable 挡掉的 provider 根本不探测,能查的那些用注入的 probe 顶替真实拉取,
// 而 getUsage 在缓存新鲜时不会调 providerUsage —— 若哪天缓存逻辑坏了,这些用例会去连
// example.invalid 然后失败(不是挂住),失败本身就是信号。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { getUsage, refreshUsage, queryable, hasUsageApi, createUsageProbe } = require('../../src/usage')

const KEYED = { baseUrl: 'https://example.invalid/v1', apiKey: 'k' } // 可查,但本文件从不真拉

test('queryable: hidden / codex / 第三方缺 key 一律不查,登录态 claude 与有 key 的第三方放行', () => {
  assert.equal(queryable(KEYED), true)
  assert.equal(queryable({}), true)                                   // 登录态 claude:无 baseUrl 非 codex
  assert.equal(queryable({ ...KEYED, hidden: true }), false)          // operator 撤下 ⇒ 零探测
  assert.equal(queryable({ runner: 'codex' }), false)                 // 走 codex 自家通道
  assert.equal(queryable({ baseUrl: 'https://x/v1' }), false)         // 第三方缺 key
  assert.equal(queryable(null), false)
})

test('refreshUsage: 不可查的 provider 直接返回 null,连 probe 都不调(hidden ⇒ 零探测在手点这条路上同样成立)', async () => {
  let calls = 0
  const probe = async () => { calls++; return { label: '额度', value: 'X' } }
  for (const p of [{ ...KEYED, hidden: true }, { runner: 'codex' }, { baseUrl: 'https://x/v1' }])
    assert.equal(await refreshUsage('t-blocked', p, { probe }), null)
  assert.equal(calls, 0)
})

test('refreshUsage: 拉到就写缓存,随后的整页 getUsage 直接读它', async () => {
  const v = await refreshUsage('t-ok', KEYED, { probe: async () => ({ label: '额度', value: 'V1' }) })
  assert.deepEqual(v, { label: '额度', value: 'V1' })
  assert.deepEqual(await getUsage({ 't-ok': KEYED }), { 't-ok': { label: '额度', value: 'V1' } })
})

test('refreshUsage: 拉不到时留住上一次的值 —— 手点刷新失败不该让卡片上的额度行凭空消失', async () => {
  await refreshUsage('t-keep', KEYED, { probe: async () => ({ label: '额度', value: 'V1' }) })
  assert.equal(await refreshUsage('t-keep', KEYED, { probe: async () => null }), null)
  assert.deepEqual(await getUsage({ 't-keep': KEYED }), { 't-keep': { label: '额度', value: 'V1' } })
  // probe 抛错与返回 null 同等对待(接口挂了不该把整块状态带走)
  assert.equal(await refreshUsage('t-keep', KEYED, { probe: async () => { throw new Error('boom') } }), null)
  assert.deepEqual(await getUsage({ 't-keep': KEYED }), { 't-keep': { label: '额度', value: 'V1' } })
})

test('刚刷新过的 provider 被标 hidden ⇒ 整页不再吐它的额度(守卫在前,缓存里有值也不算数)', async () => {
  await refreshUsage('t-drop', KEYED, { probe: async () => ({ label: '额度', value: 'V1' }) })
  assert.deepEqual(await getUsage({ 't-drop': { ...KEYED, hidden: true } }), {})
  assert.deepEqual(await getUsage({ 't-drop': KEYED }), { 't-drop': { label: '额度', value: 'V1' } }) // 对照组:不 hidden 时确实拿得到
})

// ── hasUsageApi:「本来能不能查」≠「该不该探」 ──

test('hasUsageApi: 有余额接口的第三方与登录态 claude 算能查,没接口的第三方不算', () => {
  assert.equal(hasUsageApi({}), true)                                              // 登录态 claude
  assert.equal(hasUsageApi({ baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'k' }), true)
  assert.equal(hasUsageApi({ baseUrl: 'https://open.bigmodel.cn/api/anthropic', apiKey: 'k' }), true)
  assert.equal(hasUsageApi({ baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'k' }), true)
  // 火山 coding plan:key 齐全该探(queryable),但**没有**公开余额接口 ⇒ 查不到是结构性的,
  // 不该被说成「暂时没查到,稍后再试」让人白等
  const volcano = { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'k' }
  assert.equal(queryable(volcano), true, '对照组:它确实是「该探」的')
  assert.equal(hasUsageApi(volcano), false)
  assert.equal(hasUsageApi({ runner: 'codex' }), false)                            // 走自家通道
  assert.equal(hasUsageApi({ baseUrl: 'https://api.deepseek.com' }), false)        // 缺 key
  assert.equal(hasUsageApi(null), false)
})

test('hasUsageApi: hidden 不影响「本来能不能查」—— 撤下只是控制台收纳,群照样在用它', () => {
  // hidden 的含义只有一条:模型页别列它。群里那台机器上的 claude 正是 hidden 而天天在跑,
  // 把 queryable 的 !hidden 混进来,/hud 就会对着一个查得到额度的模型说「不支持查额度」。
  assert.equal(hasUsageApi({ hidden: true }), true, '登录态 claude 被撤下,额度照样查得到')
  assert.equal(hasUsageApi({ baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'k', hidden: true }), true)
  // 对照组:「该不该主动去探」仍然看 hidden(整页刷新不为撤下的模型翻 Keychain)
  assert.equal(queryable({ hidden: true }), false)
})

// ── createUsageProbe:supported/value 分家 + 只缓存成功 ──

const mkProbe = (over = {}) => {
  const clock = { t: 1_000_000 }
  let calls = 0
  const p = createUsageProbe({
    now: () => clock.t,
    probe: async () => { calls++; return over.val === undefined ? { label: '订阅额度', value: '5h:12%' } : over.val },
    codexUsage: async () => { calls++; return over.codex === undefined ? '5h:3%' : over.codex },
    ...(over.opts || {}),
  })
  return { p, clock, calls: () => calls }
}

test('createUsageProbe: 查不到时 supported 仍为 true —— 「没查到」不许被降成「不支持」', async () => {
  const { p } = mkProbe({ val: null })
  assert.deepEqual(await p('claude', {}), { supported: true, value: null })
})

test('createUsageProbe: 没有额度接口的形态 supported=false,且根本不去探', async () => {
  const { p, calls } = mkProbe()
  assert.deepEqual(await p('volcano', { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: 'k' }), { supported: false, value: null })
  assert.deepEqual(await p('nokey', { baseUrl: 'https://api.deepseek.com/anthropic' }), { supported: false, value: null })
  assert.deepEqual(await p('none', null), { supported: false, value: null })
  assert.equal(calls(), 0)
  // 对照组:能查的形态确实会去探并带出值;**hidden 也在其中**(撤下不等于查不到)
  assert.deepEqual(await p('claude', {}), { supported: true, value: '订阅额度 5h:12%' })
  assert.deepEqual(await p('claude-hidden', { hidden: true }), { supported: true, value: '订阅额度 5h:12%' })
  assert.equal(calls(), 2)
})

test('createUsageProbe: 缓存键带 baseUrl —— 热改端点后不许把上一家的余额当这一家报', async () => {
  const vals = { 'https://api.deepseek.com/anthropic': { label: '余额', value: '¥1' }, 'https://api.minimaxi.com/anthropic': { label: '额度', value: '5h:7%' } }
  let calls = 0
  const p = createUsageProbe({ now: () => 1_000, probe: async (pv) => { calls++; return vals[pv.baseUrl] } })
  assert.deepEqual(await p('x', { baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'k' }), { supported: true, value: '余额 ¥1' })
  assert.deepEqual(await p('x', { baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'k' }), { supported: true, value: '额度 5h:7%' })
  assert.equal(calls, 2, '换了端点必须重探,不许吃同名的旧缓存')
  // 对照组:端点没变时缓存照常生效(同一把钟内不重复打接口)
  await p('x', { baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'k' })
  assert.equal(calls, 2)
})

test('createUsageProbe: codex 走自家通道(queryable 挡不住它)', async () => {
  const { p } = mkProbe()
  assert.deepEqual(await p('gpt', { runner: 'codex' }), { supported: true, value: '5h:3%' })
  const dead = mkProbe({ codex: null })
  assert.deepEqual(await dead.p('gpt', { runner: 'codex' }), { supported: true, value: null })
})

test('createUsageProbe: 成功压 60s,失败只压 10s —— 一次超时不该让整整一分钟都查不到', async () => {
  let val = null
  let calls = 0
  const clock = { t: 0 }
  const p = createUsageProbe({ now: () => clock.t, probe: async () => { calls++; return val } })
  assert.deepEqual(await p('claude', {}), { supported: true, value: null }); assert.equal(calls, 1)
  clock.t += 5_000 // 10s 内:挡住连点(端点限流阈值低)
  await p('claude', {}); assert.equal(calls, 1)
  clock.t += 6_000 // 过了 10s:人再问一次就真的重试
  val = { label: '订阅额度', value: '5h:9%' }
  assert.deepEqual(await p('claude', {}), { supported: true, value: '订阅额度 5h:9%' }); assert.equal(calls, 2)
  clock.t += 30_000 // 成功后 60s 内不再打接口
  await p('claude', {}); assert.equal(calls, 2)
  clock.t += 31_000
  await p('claude', {}); assert.equal(calls, 3)
})

test('createUsageProbe: 探测抛错等同查不到(不崩、不写死成功缓存)', async () => {
  let calls = 0
  const clock = { t: 0 }
  const p = createUsageProbe({ now: () => clock.t, probe: async () => { calls++; throw new Error('boom') } })
  assert.deepEqual(await p('claude', {}), { supported: true, value: null })
  clock.t += 11_000
  await p('claude', {})
  assert.equal(calls, 2, '失败没被当成功缓存 60s')
})
