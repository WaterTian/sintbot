// 控制台「用飞书登录」的纯逻辑:公网地址归一 · 授权 URL · 一次性 state · 换 token / 取身份(假 fetch)
// · 名单匹配 · 落地页转义 · 入口就绪判据。基准全是字面量,不拿被测代码里的常量当期望。
const test = require('node:test')
const assert = require('node:assert/strict')
const fl = require('../../src/ui/feishulogin')

test('端点与路径是字面量契约(nginx 的 ^~ /api/auth/feishu/ 与 client_secret 的去向都钉在这儿)', () => {
  assert.equal(fl.AUTHORIZE_URL, 'https://accounts.feishu.cn/open-apis/authen/v1/authorize')
  assert.equal(fl.TOKEN_URL, 'https://accounts.feishu.cn/oauth/v3/token')
  assert.equal(fl.USERINFO_URL, 'https://open.feishu.cn/open-apis/authen/v1/user_info')
  assert.equal(fl.START_PATH, '/api/auth/feishu/start')
  assert.equal(fl.CALLBACK_PATH, '/api/auth/feishu/callback')
})

test('normalizePublicUrl: 只认 https://host[:port],路径/查询/尾斜杠一律剥掉,http 与垃圾一律 null', () => {
  assert.equal(fl.normalizePublicUrl('https://cb.example.com'), 'https://cb.example.com')
  assert.equal(fl.normalizePublicUrl('https://cb.example.com/'), 'https://cb.example.com')
  assert.equal(fl.normalizePublicUrl('  https://cb.example.com/some/path?x=1#y '), 'https://cb.example.com')
  assert.equal(fl.normalizePublicUrl('https://cb.example.com:8443/'), 'https://cb.example.com:8443')
  assert.equal(fl.normalizePublicUrl('https://cb.example.com:443/'), 'https://cb.example.com', '默认端口不保留')
  assert.equal(fl.normalizePublicUrl('http://cb.example.com'), null, '回调必须 https')
  assert.equal(fl.normalizePublicUrl('https://user:pw@cb.example.com'), null)
  assert.equal(fl.normalizePublicUrl('cb.example.com'), null)
  assert.equal(fl.normalizePublicUrl(''), null)
  assert.equal(fl.normalizePublicUrl(null), null)
})

test('redirectUri / buildAuthorizeUrl: 回调路径固定,授权 URL 带齐四个参数且 redirect_uri 已编码', () => {
  const ru = fl.redirectUri('https://cb.example.com')
  assert.equal(ru, 'https://cb.example.com/api/auth/feishu/callback')
  const u = new URL(fl.buildAuthorizeUrl({ appId: 'cli_abc', redirectUri: ru, state: 'st4te' }))
  assert.equal(u.origin + u.pathname, 'https://accounts.feishu.cn/open-apis/authen/v1/authorize')
  assert.equal(u.searchParams.get('client_id'), 'cli_abc')
  assert.equal(u.searchParams.get('redirect_uri'), ru)
  assert.equal(u.searchParams.get('response_type'), 'code')
  assert.equal(u.searchParams.get('state'), 'st4te')
  assert.match(u.search, /redirect_uri=https%3A%2F%2Fcb/, '原样嵌进 query 里飞书会截断')
})

test('createStateStore: 一次性 · 过期作废 · 超上限淘汰最早的', () => {
  let t = 1_000_000
  let n = 0
  assert.equal(fl.createStateStore().size, 0)
  const st = fl.createStateStore({ ttlMs: 1000, max: 3, now: () => t, random: () => 's' + (++n) })
  const a = st.issue()
  assert.equal(a, 's1')
  assert.equal(st.consume(a), true)
  assert.equal(st.consume(a), false, '用过一次就作废')
  assert.equal(st.consume('nope'), false)
  assert.equal(st.consume(''), false)
  const b = st.issue(); t += 1001
  assert.equal(st.consume(b), false, '过了 TTL 作废')
  const c = st.issue(), d = st.issue(), e = st.issue(); st.issue() // 第四个 ⇒ 淘汰 c
  assert.equal(st.consume(c), false, '超上限淘汰最早的')
  assert.equal(st.consume(d), true); assert.equal(st.consume(e), true)
})

const fakeFetch = (routes) => async (url, init) => {
  const key = Object.keys(routes).find((k) => String(url).startsWith(k))
  if (!key) throw new Error('unexpected url ' + url)
  const r = typeof routes[key] === 'function' ? routes[key](init) : routes[key]
  return { status: r.status || 200, json: async () => { if (r.json === undefined) throw new Error('not json'); return r.json } }
}

test('exchangeCode: 成功取 access_token;飞书报错 / 非 JSON / 无 token 都抛人话', async () => {
  let sent = null
  const ok = fakeFetch({ [fl.TOKEN_URL]: (init) => { sent = JSON.parse(init.body); return { json: { code: 0, access_token: 'u-abc', token_type: 'Bearer' } } } })
  const r = await fl.exchangeCode({ fetchImpl: ok, appId: 'cli_x', appSecret: 'sec', code: 'c0de', redirectUri: 'https://h/cb' })
  assert.equal(r.accessToken, 'u-abc')
  assert.deepEqual(sent, { grant_type: 'authorization_code', client_id: 'cli_x', client_secret: 'sec', code: 'c0de', redirect_uri: 'https://h/cb' })
  await assert.rejects(fl.exchangeCode({ fetchImpl: fakeFetch({ [fl.TOKEN_URL]: { status: 400, json: { code: 20071, error: 'invalid_request', error_description: 'redirect_uri 不匹配' } } }), appId: 'a', appSecret: 's', code: 'c', redirectUri: 'r' }), /redirect_uri 不匹配/)
  await assert.rejects(fl.exchangeCode({ fetchImpl: fakeFetch({ [fl.TOKEN_URL]: { status: 502 } }), appId: 'a', appSecret: 's', code: 'c', redirectUri: 'r' }), /HTTP 502/)
  await assert.rejects(fl.exchangeCode({ fetchImpl: fakeFetch({ [fl.TOKEN_URL]: { json: { code: 0 } } }), appId: 'a', appSecret: 's', code: 'c', redirectUri: 'r' }), /拒绝/)
})

test('网络层错误翻成人话:fetch 抛错 ⇒「连不上飞书」;AbortError ⇒「超时」', async () => {
  const boom = async () => { throw new Error('ECONNREFUSED 1.2.3.4:443') }
  await assert.rejects(fl.exchangeCode({ fetchImpl: boom, appId: 'a', appSecret: 's', code: 'c', redirectUri: 'r' }), /连不上飞书:ECONNREFUSED/)
  const abort = async () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e }
  await assert.rejects(fl.fetchUserInfo({ fetchImpl: abort, accessToken: 'x' }), /连接飞书超时\(10 秒\)/)
  await assert.rejects(fl.fetchUserInfo({ fetchImpl: abort, accessToken: 'x' }), (e) => !/aborted/i.test(e.message))
})

test('fetchUserInfo: 带 Bearer 取 open_id / name;缺 open_id 即抛', async () => {
  let auth = ''
  const ok = fakeFetch({ [fl.USERINFO_URL]: (init) => { auth = init.headers.Authorization; return { json: { code: 0, data: { open_id: 'ou_1', name: '王五', union_id: 'on_9' } } } } })
  const u = await fl.fetchUserInfo({ fetchImpl: ok, accessToken: 'u-abc' })
  assert.deepEqual(u, { openId: 'ou_1', name: '王五', unionId: 'on_9' })
  assert.equal(auth, 'Bearer u-abc')
  await assert.rejects(fl.fetchUserInfo({ fetchImpl: fakeFetch({ [fl.USERINFO_URL]: { json: { code: 99991663, msg: 'token expired' } } }), accessToken: 'x' }), /token expired/)
  await assert.rejects(fl.fetchUserInfo({ fetchImpl: fakeFetch({ [fl.USERINFO_URL]: { json: { code: 0, data: { name: '无 id' } } } }), accessToken: 'x' }), /取不到/)
})

test('adminMatch: 精确匹配 open_id,大小写与前后缀都不宽容;名单缺/空 ⇒ null', () => {
  const admins = [{ openId: 'ou_AbC', name: '甲' }, { openId: 'ou_def', name: '乙' }]
  assert.equal(fl.adminMatch(admins, 'ou_def').name, '乙')
  assert.equal(fl.adminMatch(admins, 'ou_abc'), null)
  assert.equal(fl.adminMatch(admins, 'ou_AbC '), null)
  assert.equal(fl.adminMatch(admins, ''), null)
  assert.equal(fl.adminMatch(undefined, 'ou_def'), null)
  assert.equal(fl.adminMatch([null, { name: '没 id' }], 'ou_def'), null)
})

test('loginResultHtml: 成功页只在令牌形状合法时写入;姓名与错误信息都转义;失败页不含任何令牌', () => {
  const okPage = fl.loginResultHtml({ ok: true, token: 'a'.repeat(48), name: '<img src=x onerror=alert(1)>' })
  assert.match(okPage, /localStorage\.setItem\('sbot-token','a{48}'\)/)
  assert.match(okPage, /location\.replace\('\/'\)/)
  assert.doesNotMatch(okPage, /<img/, '姓名里的标签必须转义')
  assert.match(okPage, /&lt;img/)
  const badTok = fl.loginResultHtml({ ok: true, token: "x');alert(1);('", name: 'n' })
  assert.doesNotMatch(badTok, /alert\(1\)/, '令牌形状不对就不写脚本')
  assert.doesNotMatch(badTok, /登录成功/)
  const fail = fl.loginResultHtml({ ok: false, message: '你的账号 <b>不在</b> 名单里' })
  assert.match(fail, /没能登录/)
  assert.match(fail, /&lt;b&gt;不在&lt;\/b&gt;/)
  assert.doesNotMatch(fail, /setItem/)
  // 用户面零工具名:页面里不能出现命令名或机器路径
  // localStorage 键名 sbot-token 是用户看不见的标识符(既有约定),不算;其余出现 sbot 一律算违规
  for (const p of [okPage, fail]) { assert.doesNotMatch(p, /\bsbot\b(?!-token)/); assert.doesNotMatch(p, /\.sbot|\/Users\/|~\//) }
  // 对照:判据真抓得住违规(拿一段故意违规的文案喂进去)
  assert.match(fl.loginResultHtml({ ok: false, message: '去 ~/.sbot/x 看' }), /\.sbot/)
})

test('feishuLoginReadiness: 公网地址 / 凭证 / 管理员名单三样齐才亮,缺哪样说哪样', () => {
  const full = { publicUrl: 'https://c.example.com', appId: 'cli_x', appSecret: 's', admins: [{ openId: 'ou_1' }] }
  assert.deepEqual(fl.feishuLoginReadiness(full), { ready: true, why: '' })
  assert.match(fl.feishuLoginReadiness({ ...full, publicUrl: '' }).why, /公网地址/)
  assert.match(fl.feishuLoginReadiness({ ...full, publicUrl: 'http://c.example.com' }).why, /公网地址/)
  assert.match(fl.feishuLoginReadiness({ ...full, appSecret: '' }).why, /凭证/)
  assert.match(fl.feishuLoginReadiness({ ...full, admins: [] }).why, /管理员/)
  assert.match(fl.feishuLoginReadiness({ ...full, admins: [{ name: '没 id' }] }).why, /管理员/)
})
