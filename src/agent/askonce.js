// 问一次模型、拿一段文字:不起 CLI、不带会话、不开工具 —— 直接打 provider 的 HTTP 端点。
//
// 给谁用:企业微信「不 @ 也回复」的便宜模型门控(src/platform/wecomgate.js)这类「每条消息问一句 YES / NO」的活。
// 起一个 claude / codex 子进程要 2~5 秒、系统提示本身就几千 token,拿来判一句话是杀鸡用牛刀;而第三方 provider
// 在配置里本来就有 baseUrl + apiKey(消息协议与 claude CLI 用的是同一套),一个 POST 就够。
//
// 只支持「有 baseUrl + apiKey」的 provider:订阅登录的 claude(没有 key)与 codex(不是这套协议)不行 —— 调用方
// (doctor / 接线层)按 askableProvider 先判,不行就说清为什么,不在这里猜。
// 请求形状 = 消息协议最小集:{ model, max_tokens, system, messages:[{role:'user',content}] };鉴权两个头都带
// (Bearer 是 claude CLI 对这些端点用的方式,x-api-key 是协议原生写法,各家只认其一的都见过)。
// model 名里 claude CLI 专用的 `[1m]` 后缀(1M 上下文标记)要剥掉 —— 端点不认。
// ⚠ Node 的 fetch 不读 HTTP(S)_PROXY 环境变量:走代理才通的端点这里连不上(需要代理才能出网的机器)。门控失败只记日志、当 NO,不影响主流程。

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_TOKENS = 48

// provider 能不能这样问:返回 null = 能;否则一句人话说明为什么不能(doctor / 日志共用同一口径)
// opts.model = 调用方按次指定的型号;provider 自己没写 model 且这里也没给 ⇒ 请求必失败(端点要型号名),doctor 得提前说
function askableProvider(p, name = '', { model } = {}) {
  if (!p || typeof p !== 'object') return `没有叫「${name}」的模型配置`
  if (p.runner === 'codex') return `「${name}」走的不是这套消息协议,不能当门控`
  if (!p.baseUrl || !p.apiKey) return `「${name}」没有配 baseUrl + apiKey(订阅登录的模型没法直接 HTTP 调用),不能当门控`
  if (!stripModelTag(model || p.model)) return `「${name}」没有型号名(模型配置里没写 model,门控也没指定),不知道该问哪个型号`
  return null
}

const stripModelTag = (m) => String(m || '').replace(/\[1m\]$/i, '').trim()

function createAskOnce({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('askonce: fetch unavailable')
  /**
   * @param {{baseUrl:string, apiKey:string, model?:string}} provider
   * @param {{system?:string, user:string, model?:string, maxTokens?:number}} q
   * @returns {Promise<string>} 模型回的文字(多段只拼 text 段);非 2xx / 超时 / 形状不对都 throw
   */
  return async function askOnce(provider, q) {
    const why = askableProvider(provider, provider && provider.name, { model: q.model })
    if (why) throw new Error(why)
    const model = stripModelTag(q.model || provider.model)
    const url = String(provider.baseUrl).replace(/\/+$/, '') + '/v1/messages'
    // max_tokens 默认 48 不是 8:思考型型号会先吐 thinking 段,预算太小就一个字都轮不到 text 段,门控永远「看不懂」
    const body = { model, max_tokens: Math.max(1, q.maxTokens || DEFAULT_MAX_TOKENS), messages: [{ role: 'user', content: String(q.user || '') }] }
    if (q.system) body.system = String(q.system)
    // 默认关思考:实测(DeepSeek v4 的消息协议端点)不传就先吐 thinking 段把 48 个 token 全吃光、一个字答不出;传
    // `thinking:{type:'disabled'}` 后 1 个输出 token 0.7 秒答 YES。端点不认这个字段会 400 并在原话里提到 thinking ⇒ 退一次不带它重试。
    const post = async (b) => {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), timeoutMs)
      try {
        // ⚠ 超时必须罩住 r.text():响应头到了、body 停滞(网关半开 / 限流挂起)是常见形态,只罩 fetch 本身会让调用方永久挂起 ——
        //    而调用方(轮询 tick)是串行 await,一次挂起 = 所有企微群的「不 @ 也回复」静默停摆(对抗审查逮到)
        const r = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': provider.apiKey, authorization: `Bearer ${provider.apiKey}` },
          body: JSON.stringify(b),
          signal: ac.signal,
        })
        return { status: r.status, ok: r.ok, txt: await r.text() }
      } catch (e) {
        throw new Error(e && e.name === 'AbortError' ? `超时(${timeoutMs}ms)` : `请求失败:${(e && e.message) || e}`)
      } finally { clearTimeout(t) }
    }
    let { status, ok, txt } = await post(q.thinking === false ? body : { ...body, thinking: { type: 'disabled' } })
    if (!ok && status === 400 && q.thinking !== false && /thinking/i.test(String(txt))) ({ status, ok, txt } = await post(body))
    if (!ok) throw new Error(`HTTP ${status}:${String(txt).slice(0, 160)}`)
    let j
    try { j = JSON.parse(txt) } catch { throw new Error('回包不是 JSON:' + String(txt).slice(0, 80)) }
    const parts = Array.isArray(j && j.content) ? j.content : []
    const out = parts.filter((c) => c && c.type === 'text').map((c) => c.text).join('')
    if (!out && !parts.length) throw new Error('回包里没有内容')
    if (!out) throw new Error(`回包只有 ${parts.map((c) => c && c.type).join('/')} 段没有文字(多半是思考型型号把 token 预算吃光了,换非思考型号)`)
    return out
  }
}

module.exports = { createAskOnce, askableProvider, stripModelTag, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_TOKENS }
