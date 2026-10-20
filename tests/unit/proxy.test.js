// 出网代理(CONNECT 隧道)的纯逻辑。⚠ **零网络**:底层 http/https 全部注入假实现,
// 隧道的成功路径要真 TLS ⇒ 不在这里(要拿真代理手动验)。
// 这里只钉两类东西:①**没配代理时行为与改动前逐字节相同**(这条改动的风险面全在它身上);
// ②出错与转发路径上那些"错了也不报错"的地方(跨源带 token、NO_PROXY 不认、407 静默、
//   已取消的 signal 仍建隧道然后炸进程、socks5 被当 http 代理)。
//
// ⚠ 本文件直接调 `agent.createConnection(...)`,**绕过了** Node `https.Agent.createSocket` 那层
//   (回调式签名的契约、servername 推导、按 host:port 分池)。那层的正确性靠 reviewer 逐行核过
//   Node 18.17 / 20 / 22 的 `_http_agent.js`(三版一字不差)+ 真代理回环实验,不在单测里重演。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  proxyFromEnv, noProxyFromEnv, proxyWarning, shouldBypass,
  TunnelAgent, createProxyFetch,
  getProxyFetch, getProxyAgent, resetProxy, proxyDescribe,
} = require('../../src/core/proxy')

// ── 假的 https/http 实现 ──────────────────────────────────────────────────────────
// `lib.request(opts, cb)` → 记下 opts,按剧本回一个响应。req 是个 EventEmitter,
// 额外带 write/end/destroy/setTimeout,足以覆盖被测代码用到的全部成员。
// ⚠ 尽量像真 Node:`res.headers` 键一律小写 · `destroy(err)` **异步**发 'error' 再 'close' ·
//   CONNECT 走 'connect' 事件 · 请求结束发 'close'。假得太顺,测试就会对真实失败形态视而不见。
function fakeHttp(script) {
  const calls = []
  let i = 0
  return {
    calls,
    request(opts, cb) {
      const step = typeof script === 'function' ? script(opts, i) : (Array.isArray(script) ? script[i] : script)
      i++
      const written = []
      const req = new EventEmitter()
      req.write = (b) => { written.push(Buffer.from(b)) }
      req.destroy = (err) => {
        if (req.destroyed) return
        req.destroyed = true
        setImmediate(() => { if (err) req.emit('error', err); req.emit('close') })
      }
      req.setTimeout = (ms, fn) => { req._timeout = { ms, fn } }
      req.end = () => {
        if (!step) return
        // hang:永不回应 —— 只有 setTimeout 的回调能把它结束掉(模拟"端口通但不是代理")
        if (step.hang) { if (req._timeout) setImmediate(req._timeout.fn); return }
        setImmediate(() => {
          if (req.destroyed) return
          if (step.error) return req.destroy(new Error(step.error))
          const res = new EventEmitter()
          res.statusCode = step.status || 200
          res.headers = Object.fromEntries(Object.entries(step.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
          res.resumed = false
          res.resume = () => { res.resumed = true }
          // ⚠ CONNECT 的响应走 'connect' 事件、不是响应回调 —— 两者搞混的话隧道那几条
          //   出错路径根本没被执行到,测试却是绿的(教训 29:正反都绿比没有测试更糟)。
          if (String(opts.method).toUpperCase() === 'CONNECT') {
            const socket = new EventEmitter()
            socket.destroy = () => { socket.destroyed = true }
            calls[calls.length - 1].socket = socket
            return req.emit('connect', res, socket)
          }
          calls[calls.length - 1].res = res
          cb(res)
          setImmediate(() => {
            if (req.destroyed) return
            if (step.body !== undefined) res.emit('data', Buffer.from(step.body))
            if (step.truncate) { res.emit('error', new Error('aborted')); return } // 半截响应:对端中途断线
            res.emit('end')
            req.emit('close')
          })
        })
      }
      calls.push({ opts, req, body: () => Buffer.concat(written).toString('utf8') })
      return req
    },
  }
}

const P = 'http://127.0.0.1:7890'
const mkFetch = (script, extra = {}) => {
  const https = fakeHttp(script)
  const agent = new TunnelAgent(P)
  return { https, agent, f: createProxyFetch(P, { agent, httpsImpl: https, ...extra }) }
}

// ── 读配置 ────────────────────────────────────────────────────────────────────────

test('proxyFromEnv: 六个变量按优先级读,大小写两套都认', () => {
  assert.equal(proxyFromEnv({ HTTPS_PROXY: 'http://a:1', http_proxy: 'http://b:2' }), 'http://a:1')
  assert.equal(proxyFromEnv({ http_proxy: 'http://b:2' }), 'http://b:2')
  assert.equal(proxyFromEnv({ ALL_PROXY: 'http://c:3' }), 'http://c:3')
  assert.equal(proxyFromEnv({ HTTPS_PROXY: '   ' }), '', '空白串不算配了')
  assert.equal(proxyFromEnv({}), '')
})

// ⚠ 生产机的 shell 就有 all_proxy=socks5://…。把 SOCKS 端口当 HTTP 代理发 CONNECT,在 Clash 的
//   mixed-port 上恰好碰对(开发机"是好的"),纯 SOCKS 端口上是 socket hang up / 干挂。
test('⭐ proxyFromEnv 只认 http://:socks5 / https 代理跳过,且能越过它取后面可用的', () => {
  assert.equal(proxyFromEnv({ all_proxy: 'socks5://127.0.0.1:7890' }), '')
  assert.equal(proxyFromEnv({ HTTPS_PROXY: 'https://proxy.corp' }), '', 'TLS 到代理这条路这里发不了 CONNECT')
  assert.equal(proxyFromEnv({ HTTPS_PROXY: 'socks5://a:1', http_proxy: 'http://b:2' }), 'http://b:2', '前面的不可用要越过去')
  assert.equal(proxyFromEnv({ HTTPS_PROXY: '不是 url' }), '')
})

test('proxyWarning: env 有代理但用不了 ⇒ 一句能照做的话;正常 / 没配 ⇒ 空', () => {
  const w = proxyWarning({ all_proxy: 'socks5://127.0.0.1:7890' })
  assert.match(w, /all_proxy/)
  assert.match(w, /socks5/)
  assert.match(w, /proxy\.http/, '要指到配置项')
  assert.equal(proxyWarning({ HTTPS_PROXY: 'http://a:1' }), '')
  assert.equal(proxyWarning({}), '')
  assert.equal(proxyWarning({ all_proxy: 'socks5://a:1', http_proxy: 'http://b:2' }), '', '有可用的就不该唠叨')
  assert.ok(!proxyWarning({ all_proxy: 'socks5://u:s3cret@a:1' }).includes('s3cret'), '警告里也不能吐凭据')
})

test('TunnelAgent: 构造时就拒绝非 http 代理,错误说人话', () => {
  assert.throws(() => new TunnelAgent('socks5://127.0.0.1:7890'), /只支持 http:\/\/.*socks5/)
  assert.throws(() => new TunnelAgent('https://proxy.corp'), /只支持 http:\/\//)
  assert.throws(() => new TunnelAgent('不是 url'), /无法解析/)
})

test('noProxyFromEnv: NO_PROXY / no_proxy', () => {
  assert.equal(noProxyFromEnv({ NO_PROXY: 'a.com' }), 'a.com')
  assert.equal(noProxyFromEnv({ no_proxy: 'b.com' }), 'b.com')
  assert.equal(noProxyFromEnv({}), '')
})

// ⚠ 这条不认的话,同一份 cfg.proxy 在 daemon 与 spawn 出去的子进程里含义就不同 ——
//   那种不一致平时无声,出事时最难查(applyProxyEnv 会把 deriveNoProxy 的国内端点写进去)。
test('shouldBypass: * / 精确 / 蕴含子域 / 前导点 / *. / 带端口 / 大小写 / 尾点', () => {
  assert.equal(shouldBypass('slack.com', '*'), true)
  assert.equal(shouldBypass('slack.com', 'slack.com'), true)
  assert.equal(shouldBypass('api.slack.com', 'slack.com'), true, '精确条目蕴含子域(curl 口径)')
  assert.equal(shouldBypass('api.slack.com', '.slack.com'), true)
  assert.equal(shouldBypass('api.slack.com', '*.slack.com'), true)
  assert.equal(shouldBypass('slack.com', '.slack.com'), true, '前导点也要匹配裸域')
  assert.equal(shouldBypass('API.Slack.COM', 'slack.com'), true)
  assert.equal(shouldBypass('slack.com', 'slack.com:443'), true, '条目带端口要忽略端口')
  assert.equal(shouldBypass('slack.com.', 'slack.com'), true, 'FQDN 尾点')
  assert.equal(shouldBypass('slack.com', 'a.com, b.com  c.com'), false)
  assert.equal(shouldBypass('notslack.com', 'slack.com'), false, '⚠ 后缀不能裸比:notslack.com 不是 slack.com 的子域')
  assert.equal(shouldBypass('slack.com', ''), false)
  assert.equal(shouldBypass('', '*'), false)
})

test('shouldBypass: IP 只做精确匹配;IPv6 条目带不带方括号都认、不被当成"host:端口"', () => {
  assert.equal(shouldBypass('10.0.0.1', '10.0.0.1'), true)
  assert.equal(shouldBypass('10.0.0.1', '0.0.1'), false, '⚠ IP 的后缀什么都不是,不能按域名后缀命中')
  assert.equal(shouldBypass('10.0.0.1', '1'), false)
  assert.equal(shouldBypass('10.0.0.1', '.0.0.1'), false)
  assert.equal(shouldBypass('::1', '::1'), true)
  assert.equal(shouldBypass('[::1]', '::1'), true)
  assert.equal(shouldBypass('::1', '[::1]'), true)
  assert.equal(shouldBypass('::1', '[::1]:8080'), true, '带括号的 IPv6 才能剥端口')
  assert.equal(shouldBypass('::2', '::1'), false)
  assert.equal(shouldBypass('localhost', '127.0.0.1'), false, '名字与 IP 不互相蕴含')
})

// ── ⭐ 没配代理 = 一个字都不变 ────────────────────────────────────────────────────
// 这是整条改动的安全底座:绝大多数机器没配代理,它们必须走原来那个全局 fetch。

test('⭐ 没配代理时 getProxyFetch/getProxyAgent 返回 null(调用方回落到全局 fetch)', () => {
  resetProxy()
  assert.equal(getProxyFetch({}), null)
  assert.equal(getProxyAgent({}), null)
  assert.equal(getProxyFetch({ all_proxy: 'socks5://a:1' }), null, '用不了的代理 = 没配')
  assert.equal(proxyDescribe({}), '')
})

test('配了代理才给出实例,且同一份 env 复用同一个 agent;换了代理旧 agent 被 destroy', () => {
  resetProxy()
  const env = { HTTPS_PROXY: P }
  const f = getProxyFetch(env)
  assert.equal(typeof f, 'function')
  const a1 = getProxyAgent(env)
  assert.equal(a1, getProxyAgent(env), '同一份 env 不该每次新建 agent')
  let destroyed = false
  a1.destroy = () => { destroyed = true }
  const a2 = getProxyAgent({ HTTPS_PROXY: 'http://127.0.0.1:7891' })
  assert.notEqual(a2, a1)
  assert.equal(destroyed, true, '换代理不关旧 agent 的 keepAlive 连接 = 每换一次泄一批 socket')
  resetProxy()
})

test('proxyDescribe: 给得出主机端口,但**不吐凭据**', () => {
  assert.equal(proxyDescribe({ HTTPS_PROXY: P }), P)
  const d = proxyDescribe({ HTTPS_PROXY: 'http://user:s3cret@10.0.0.1:3128' })
  assert.equal(d, 'http://10.0.0.1:3128(带认证)')
  assert.ok(!d.includes('s3cret'), '⚠ 代理 URL 里的密码绝不能进日志')
})

// ── fetch 垫片 ────────────────────────────────────────────────────────────────────

test('走隧道:请求打到目标主机、挂上 agent、Content-Length 按**字节**算', async () => {
  const { https, agent, f } = mkFetch({ status: 200, headers: { 'Content-Type': 'application/json' }, body: '{"ok":true}' })
  const body = new URLSearchParams({ channel: 'C1', text: '你好' })
  const res = await f('https://slack.com/api/chat.postMessage', { method: 'post', headers: { Authorization: 'Bearer xoxb-1' }, body })

  const o = https.calls[0].opts
  assert.equal(o.host, 'slack.com')
  assert.equal(o.port, 443)
  assert.equal(o.path, '/api/chat.postMessage')
  assert.equal(o.method, 'POST', 'method 归一成大写(重定向判 POST 时要用)')
  assert.equal(o.agent, agent, '⚠ 没挂上 agent 就等于直连 —— 这正是要修的那个洞')
  assert.equal(o.headers['Content-Length'], String(Buffer.byteLength(String(body))))
  assert.equal(https.calls[0].body(), String(body))
  assert.equal(res.status, 200)
  assert.equal(res.ok, true)
  assert.deepEqual(await res.json(), { ok: true })

  // 多字节裸字符串:字符数 ≠ 字节数,这条能分辨"用了 .length 还是 byteLength"
  const { https: h2, f: f2 } = mkFetch({ status: 200, body: '' })
  await f2('https://slack.com/x', { method: 'POST', body: '你好' })
  assert.equal(h2.calls[0].opts.headers['Content-Length'], '6', '"你好" 是 6 字节不是 2')
})

test('init.headers 是 Headers 实例 / 二维数组时不许静默丢头', async () => {
  const { https, f } = mkFetch({ status: 200, body: '' })
  await f('https://slack.com/a', { headers: new Headers({ Authorization: 'Bearer x', 'X-A': '1' }) })
  assert.equal(https.calls[0].opts.headers.authorization, 'Bearer x', '⚠ {...new Headers()} 会得到 {} —— 请求照发、只是没了 Authorization')
  await f('https://slack.com/b', { headers: [['X-B', '2']] })
  assert.equal(https.calls[1].opts.headers['X-B'], '2')
})

test('响应垫片:headers.get 大小写不敏感、缺的给 null、text/arrayBuffer 都在', async () => {
  const { f } = mkFetch({ status: 429, headers: { 'Retry-After': '7' }, body: 'nope' })
  const res = await f('https://slack.com/api/x')
  assert.equal(res.ok, false)
  assert.equal(res.headers.get('retry-after'), '7')
  assert.equal(res.headers.get('RETRY-AFTER'), '7', '适配器按小写读;真 Node 给的本来就是小写,这里是双保险')
  assert.equal(res.headers.get('nope'), null)
  assert.equal(await res.text(), 'nope')
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'nope')
})

// ⭐ 这条是安全项:Slack 的文件下载就是 files.slack.com → 签名 CDN 这种跳法,
//   带着 xoxb- 跳过去等于把 bot token 送给第三方主机。fetch 自己会摘,垫片必须同口径。
test('⭐ 跨源重定向摘掉 Authorization(同源则保留);判据是 origin 不只是 hostname', async () => {
  const cross = mkFetch([
    { status: 302, headers: { location: 'https://files-cdn.example.com/x.png?sig=abc' } },
    { status: 200, body: 'PNG' },
  ])
  await cross.f('https://files.slack.com/a.png', { headers: { Authorization: 'Bearer xoxb-secret', Cookie: 'c=1', 'X-Keep': 'y' }, redirect: 'follow' })
  assert.equal(cross.https.calls[0].opts.headers.Authorization, 'Bearer xoxb-secret')
  assert.equal(cross.https.calls[1].opts.headers.Authorization, undefined, '⚠ 跨源还带着 token 就是把凭据送出去')
  assert.equal(cross.https.calls[1].opts.headers.Cookie, undefined)
  assert.equal(cross.https.calls[1].opts.headers['X-Keep'], 'y', '只摘凭据类,别的头要留')
  assert.equal(cross.https.calls[0].res.resumed, true, '被跳过的那个响应必须排干,否则 keepAlive 连接不释放')

  const same = mkFetch([
    { status: 302, headers: { location: '/moved.png' } },
    { status: 200, body: 'PNG' },
  ])
  await same.f('https://files.slack.com/a.png', { headers: { Authorization: 'Bearer xoxb-secret' } })
  assert.equal(same.https.calls[1].opts.headers.Authorization, 'Bearer xoxb-secret', '同源要保留,否则下载拿不到')
  assert.equal(same.https.calls[1].opts.path, '/moved.png', '相对地址要按当前 URL 解析')

  // 同 host 不同端口 = 不同源
  const port = mkFetch([
    { status: 302, headers: { location: 'https://files.slack.com:8443/x' } },
    { status: 200, body: '' },
  ])
  await port.f('https://files.slack.com/a', { headers: { Authorization: 'Bearer s' } })
  assert.equal(port.https.calls[1].opts.headers.Authorization, undefined, 'origin = scheme+host+port,端口不同就是跨源')
})

test('重定向码:303 / 301+POST / 302+POST 降级成 GET 并丢 body 与描述 body 的头;307/308 原样保留', async () => {
  for (const status of [303, 302, 301]) {
    const { https, f } = mkFetch([{ status, headers: { location: 'https://slack.com/after' } }, { status: 200, body: 'ok' }])
    await f('https://slack.com/before', { method: 'POST', body: 'a=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    assert.equal(https.calls[1].opts.method, 'GET', `${status} 之后必须是 GET`)
    assert.equal(https.calls[1].body(), '')
    assert.equal(https.calls[1].opts.headers['Content-Length'], undefined, '⚠ 留着旧 Content-Length 会让对端一直等一个不会来的 body')
    assert.equal(https.calls[1].opts.headers['Content-Type'], undefined, 'body 没了,Content-Type 也得走')
  }
  for (const status of [307, 308]) {
    const { https, f } = mkFetch([{ status, headers: { location: 'https://slack.com/after' } }, { status: 200, body: 'ok' }])
    await f('https://slack.com/before', { method: 'POST', body: 'a=1' })
    assert.equal(https.calls[1].opts.method, 'POST', `${status} 要保留方法`)
    assert.equal(https.calls[1].body(), 'a=1', `${status} 要重发 body`)
  }
  // 303 上的 HEAD 保持 HEAD(spec);GET 自然也不动
  const head = mkFetch([{ status: 303, headers: { location: 'https://slack.com/after' } }, { status: 200 }])
  await head.f('https://slack.com/before', { method: 'HEAD' })
  assert.equal(head.https.calls[1].opts.method, 'HEAD')
})

test('只跟 301/302/303/307/308:304 带 Location 不算重定向', async () => {
  const { https, f } = mkFetch({ status: 304, headers: { location: 'https://elsewhere.example/x' } })
  const res = await f('https://slack.com/a')
  assert.equal(res.status, 304)
  assert.equal(https.calls.length, 1)
})

test("redirect:'manual' 原样交回 3xx;redirect:'error' 直接拒", async () => {
  const m = mkFetch({ status: 302, headers: { location: 'https://elsewhere.example/x' } })
  const res = await m.f('https://slack.com/a', { redirect: 'manual' })
  assert.equal(res.status, 302)
  assert.equal(m.https.calls.length, 1)
  const e = mkFetch({ status: 302, headers: { location: 'https://elsewhere.example/x' } })
  await assert.rejects(() => e.f('https://slack.com/a', { redirect: 'error' }), /redirect:'error'/)
})

test('重定向成环时报错收场,不静默挂死', async () => {
  const { f } = mkFetch(() => ({ status: 302, headers: { location: 'https://slack.com/loop' } }))
  await assert.rejects(() => f('https://slack.com/loop'), /重定向超过 20 跳/)
})

test('NO_PROXY 命中就不挂 agent(直连),报错也不再点名代理', async () => {
  const { https, f } = mkFetch({ error: 'connect ECONNREFUSED' }, { noProxy: '*.slack.com' })
  await assert.rejects(() => f('https://api.slack.com/x'), (e) => !/经代理/.test(e.message))
  assert.equal(https.calls[0].opts.agent, undefined, 'NO_PROXY 命中还挂 agent = 配置没起作用')
})

// ⚠ 本模块存在的理由的一半:直连超时的原始报错完全指不到"没走代理"。
test('出错信息要点名代理 —— 请求出错、半截响应两条路都要', async () => {
  const a = mkFetch({ error: 'connect ETIMEDOUT' })
  await assert.rejects(() => a.f('https://slack.com/x'), /connect ETIMEDOUT.*经代理 http:\/\/127\.0\.0\.1:7890/)
  const b = mkFetch({ status: 200, body: 'half', truncate: true })
  await assert.rejects(() => b.f('https://slack.com/y'), /aborted.*经代理/, '对端中途断线走的是 res 的 error,也得点名')
})

// ⚠ reviewer 现场复现:已取消的 signal 若"先建请求再 destroy",Node 会把 CONNECT + TLS 整条隧道
//   建完,然后在 socket 分配时无条件 emit 'error'(socket hang up)—— 而那时 error 监听器还没挂
//   ⇒ 未捕获异常,daemon 整个崩。正解是**根本不创建请求**。
test('⭐ 已经取消的 signal ⇒ 拒绝且一个请求都不发(否则隧道建完后 socket hang up 炸进程)', async () => {
  const { https, f } = mkFetch({ status: 200, body: 'x' })
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(() => f('https://slack.com/x', { signal: ac.signal }), { name: 'AbortError' })
  assert.equal(https.calls.length, 0, '连 CONNECT 都不该发出去')
})

test('取消到一半 ⇒ 拒绝,且请求被真的拆掉(不是只 reject 留着一个在途请求)', async () => {
  const { https, f } = mkFetch({ hang: true })
  const ac = new AbortController()
  const p = f('https://slack.com/y', { signal: ac.signal })
  ac.abort()
  await assert.rejects(() => p)
  assert.equal(https.calls[0].req.destroyed, true, '只 reject 不 destroy = 在途请求继续占着隧道')
})

// ⚠ 复用一个 AbortController 发多次请求时,成功的请求从不触发 abort 监听器 ⇒ 不摘就只增不减;
//   而 AbortSignal.timeout 的信号一旦挂上监听器会被 Node 钉住直到计时到点。
test('AbortSignal 的监听器在请求结束后被摘掉', async () => {
  const { f } = mkFetch({ status: 200, body: 'ok' })
  const ac = new AbortController()
  const added = [], removed = []
  const origAdd = ac.signal.addEventListener.bind(ac.signal)
  const origRemove = ac.signal.removeEventListener.bind(ac.signal)
  ac.signal.addEventListener = (t, fn, o) => { added.push(fn); return origAdd(t, fn, o) }
  ac.signal.removeEventListener = (t, fn) => { removed.push(fn); return origRemove(t, fn) }
  await f('https://slack.com/a', { signal: ac.signal })
  await f('https://slack.com/b', { signal: ac.signal })
  assert.equal(added.length, 2)
  assert.equal(removed.length, 2, '每个结束的请求都该把自己的监听器摘掉')
  assert.deepEqual(removed, added, '摘的必须是挂上去的那个')
})

test('非 http/https 一律拒绝(不留静默直连的口子)', async () => {
  const { f } = mkFetch({ status: 200 })
  await assert.rejects(() => f('ftp://slack.com/x'), /不支持的协议/)
  await assert.rejects(() => f('这不是个 URL'), /无效的 URL/)
})

test('明文 http 走代理用绝对形式 URI + Proxy-Authorization,不走 CONNECT', async () => {
  const plain = fakeHttp({ status: 200, body: 'ok' })
  const agent = new TunnelAgent('http://us%40er:p%40ss@127.0.0.1:7890')
  const f = createProxyFetch(agent.proxyUrl, { agent, httpImpl: plain, httpsImpl: fakeHttp({ status: 200 }) })
  await f('http://example.com/a?b=1')
  const o = plain.calls[0].opts
  assert.equal(o.host, '127.0.0.1', '明文请求要发给代理本身')
  assert.equal(o.port, '7890')
  assert.equal(o.path, 'http://example.com/a?b=1', '路径是完整 URL(搞混成 CONNECT 的表现是代理回 400)')
  assert.equal(o.headers.Host, 'example.com')
  assert.equal(o.headers['Proxy-Authorization'], 'Basic ' + Buffer.from('us@er:p@ss').toString('base64'), '带凭据的代理,明文这条路也得带认证头')
  assert.equal(o.agent, false)
})

// ── 隧道本身(只测出错路径:成功路径要真 TLS)────────────────────────────────────

// ⚠ 下面几条**故意让代理回非 200**:请求参数在发出时就记下了,断言不受影响;而回 200 会走进
//   真的 `tls.connect`,假 socket 不是真流 ⇒ 测试结束后炸一个 `stream.pause is not a function`
//   的异步异常(真撞过)。成功路径要真 TLS,不在单测里测,要拿真代理手动验。
test('TunnelAgent: CONNECT 的目标、Host 头与端口;IPv6 目标带方括号', () => {
  const http = fakeHttp({ status: 407 })
  const a = new TunnelAgent(P, { httpImpl: http })
  a.createConnection({ host: 'slack.com', port: 443 }, () => {})
  const o = http.calls[0].opts
  assert.equal(o.method, 'CONNECT')
  assert.equal(o.path, 'slack.com:443')
  assert.equal(o.headers.Host, 'slack.com:443')
  assert.equal(o.host, '127.0.0.1')
  assert.equal(o.port, '7890')
  assert.equal(o.headers['Proxy-Authorization'], undefined, '没凭据就不该凭空加认证头')
  a.createConnection({ host: '::1', port: 8443 }, () => {})
  assert.equal(http.calls[1].opts.path, '[::1]:8443', 'ws 传进来的 host 已剥括号,CONNECT authority 要补回去')
})

test('TunnelAgent: URL 里带凭据 ⇒ Proxy-Authorization,且做 URL 解码', () => {
  const http = fakeHttp({ status: 407 })
  const a = new TunnelAgent('http://us%40er:p%40ss@10.0.0.1:3128', { httpImpl: http })
  a.createConnection({ host: 'slack.com', port: 443 }, () => {})
  const got = http.calls[0].opts.headers['Proxy-Authorization']
  assert.equal(got, 'Basic ' + Buffer.from('us@er:p@ss').toString('base64'), '⚠ 不解码的话密码里有 @ 或 : 的人永远认证失败')
})

// ⚠ 407 这条:非 200 还硬往下走的话,TLS 会在代理返回的那张错误页上握手失败,
//   报出来的是一个指不到这里的密码学错误 —— 那正是最难查的一类。
test('TunnelAgent: 代理回非 200 ⇒ 当场报错、点名状态码、并把 socket 关掉', (t, done) => {
  const http = fakeHttp({ status: 407, headers: {} })
  const a = new TunnelAgent('http://10.0.0.1:3128', { httpImpl: http })
  a.createConnection({ host: 'slack.com', port: 443 }, (err) => {
    assert.ok(err, '非 200 必须报错')
    assert.match(err.message, /代理 CONNECT slack\.com:443 → 407/)
    assert.equal(http.calls[0].socket.destroyed, true, '不关的话那条半开的 TCP 就留着了')
    done()
  })
})

test('TunnelAgent: 连不上代理 ⇒ 说"连不上代理"而不是原始 ECONNREFUSED', (t, done) => {
  const http = fakeHttp({ error: 'connect ECONNREFUSED 127.0.0.1:7890' })
  const a = new TunnelAgent(P, { httpImpl: http })
  a.createConnection({ host: 'slack.com', port: 443 }, (err) => {
    assert.ok(err)
    assert.match(err.message, /连不上代理 http:\/\/127\.0\.0\.1:7890/)
    done()
  })
})

// ⚠ 代理端口通、但那头不是 HTTP 代理(端口配错指到别的服务):TCP 建得起来、CONNECT 永远没回应。
//   没有这个超时,外层 AbortSignal 触发 destroy 也收不掉这个挂着的 CONNECT —— 每次超时泄一个。
test('TunnelAgent: CONNECT 没有回应 ⇒ 按 connectTimeoutMs 收掉,并说清"多半不是代理"', (t, done) => {
  const http = fakeHttp({ hang: true })
  const a = new TunnelAgent('http://127.0.0.1:9', { httpImpl: http, connectTimeoutMs: 50 })
  a.createConnection({ host: 'slack.com', port: 443 }, (err) => {
    assert.ok(err)
    assert.match(err.message, /连不上代理 http:\/\/127\.0\.0\.1:9/)
    assert.match(err.message, /没有回应/)
    assert.match(err.message, /不是 HTTP 代理/, '要把"端口配错"这个最常见成因说出来')
    done()
  })
  assert.equal(http.calls.length, 1)
})

test('TunnelAgent: connectTimeoutMs 为 0 时不挂超时(留给调用方自己管)', async () => {
  const http = fakeHttp({ hang: true })
  const a = new TunnelAgent('http://127.0.0.1:9', { httpImpl: http, connectTimeoutMs: 0 })
  let called = false
  a.createConnection({ host: 'slack.com', port: 443 }, () => { called = true })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(called, false, '0 = 不挂超时,回调不该被触发')
})

test('TunnelAgent: agent 层给的 TLS 信任选项(ca / rejectUnauthorized…)要透传给 tls.connect', () => {
  // 拿不到真 tls.connect 的参数(成功路径不测)⇒ 只验白名单本身:http 层的键不在、信任类的键在
  const src = require('node:fs').readFileSync(require.resolve('../../src/core/proxy.js'), 'utf8')
  const m = /const TLS_PASSTHROUGH = \[([\s\S]*?)\]/.exec(src)
  assert.ok(m)
  const keys = m[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''))
  for (const k of ['ca', 'rejectUnauthorized', 'checkServerIdentity', 'ALPNProtocols']) assert.ok(keys.includes(k), k)
  for (const k of ['host', 'port', 'path', 'agent', 'headers', 'socket', 'servername']) assert.ok(!keys.includes(k), `${k} 是 http 层 / 隧道自己管的,透传会误解`)
})
