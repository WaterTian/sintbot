// 瞬时错判据(src/agent/transienterr.js):两个 runner 共用的签名表。
// 由来:2026-09-08 测试群现场 codex 返回「Selected model is at capacity…」,群里落了英文原话。
const test = require('node:test')
const assert = require('node:assert')
const { classifyTransient, SIGNATURES } = require('../../src/agent/transienterr')

test('transienterr: 服务端过载 / 限流 / 网关错 ⇒ 一句人话', () => {
  const hits = [
    'Selected model is at capacity. Please try a different model.', // 2026-09-08 测试群原话
    'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    'Rate limit reached for gpt-x, please retry after 20s',
    'Too Many Requests',
    '502 Bad Gateway',
    'Service Unavailable',
    'Internal server error',
  ]
  for (const s of hits) {
    const t = classifyTransient(s)
    assert.ok(t, `应判为瞬时错:${s}`)
    // 人话零工具名(这句话直接进群)
    assert.doesNotMatch(t, /sbot|codex|claude|gpt/i, `群面文案不能带工具名/模型名:${t}`)
  }
})

test('transienterr: 额度类 / 配置类 / 普通报错都不算瞬时错(宁漏不误)', () => {
  const misses = [
    "You've hit your usage limit. Try again at 3pm.", // 额度类:等十秒没用
    'usage_limit_reached',
    'insufficient_quota',
    '额度用尽',
    "Unsupported value: 'ultra' — reasoning.effort", // 配置类(推理强度被拒)
    'provider_missing_key: 模型「x」还差密钥没配',
    'exit code 500', // 裸数字不认
    'nope', '', null, undefined,
  ]
  for (const s of misses) assert.equal(classifyTransient(s), '', `不该判为瞬时错:${s}`)
})

test('transienterr: 额度类优先排除 —— 同一句里既有 rate limit 又有 quota 也不算', () => {
  assert.equal(classifyTransient('Rate limit: quota exceeded for this month'), '')
  // 对照:去掉额度词就命中
  assert.ok(classifyTransient('Rate limit exceeded'))
})

test('transienterr: 签名表非空且每条都带人话', () => {
  assert.ok(SIGNATURES.length >= 4)
  for (const [re, human] of SIGNATURES) { assert.ok(re instanceof RegExp); assert.ok(human && /[一-鿿]/.test(human)) }
})

// 额度 / 账号类与瞬时错互斥:同一句话不能两边都认(两个 runner 都会同时过两份判据)
test('transienterr × quotaerr: 真机原话各归其位,互不重叠', () => {
  const { classifyQuota } = require('../../src/agent/quotaerr')
  const quotaish = ["You've hit your weekly limit · resets Oct 1 at 9am (Asia/Shanghai)", "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again at 2:30 PM.", 'Failed to authenticate: OAuth session expired and could not be refreshed', "Your account is on hold and can't use Claude Code."]
  for (const s of quotaish) { assert.ok(classifyQuota(s), s); assert.equal(classifyTransient(s), '', s) }
  const transientish = ['Selected model is at capacity. Please try a different model.', 'Rate limit exceeded', '502 Bad Gateway']
  for (const s of transientish) { assert.ok(classifyTransient(s), s); assert.equal(classifyQuota(s), null, s) }
})
