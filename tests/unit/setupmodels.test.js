// setupmodels — `sbot setup` 模型步的纯逻辑:推荐顺序、key 是否到位、国际站端点、试跑失败的人话。
// 交互本身(bin/sbot.js)靠真跑向导验;这里锁住会被文档和官网照字面引用的规则。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const m = require('../../src/setupmodels')
const example = require('../../sbot.config.example.json')

test('subscriptionRoute: Claude 订阅优先,其次 Codex,都没有 ⇒ null(转去推荐 DeepSeek)', () => {
  assert.equal(m.subscriptionRoute({ claudeLoggedIn: true, codexLoggedIn: true }), 'claude')
  assert.equal(m.subscriptionRoute({ claudeLoggedIn: false, codexLoggedIn: true }), 'codex')
  assert.equal(m.subscriptionRoute({ claudeLoggedIn: null, codexLoggedIn: false }), null)
  assert.equal(m.subscriptionRoute(), null)
  assert.equal(m.RECOMMENDED, 'deepseek')
})

test('PROVIDER_INFO: 每一家都对得上示例配置里的预设,国际站端点是 https', () => {
  for (const [name, info] of Object.entries(m.PROVIDER_INFO)) {
    assert.ok(example.providers[name], `示例配置里有 ${name}`)
    assert.ok(example.providers[name].baseUrl, `${name} 是 API key 类预设`)
    assert.match(info.site, /^https:\/\//)
    if (info.intl) assert.match(info.intl.baseUrl, /^https:\/\/.+\/anthropic$/)
  }
  assert.ok(m.PROVIDER_INFO.deepseek && !m.PROVIDER_INFO.deepseek.intl, 'DeepSeek 只有一个端点')
})

test('looksMainland: 只认中国大陆时区,其余(含香港 / 台北)都不是', () => {
  assert.equal(m.looksMainland('Asia/Shanghai'), true)
  assert.equal(m.looksMainland('Asia/Urumqi'), true)
  assert.equal(m.looksMainland('Asia/Hong_Kong'), false)
  assert.equal(m.looksMainland('Asia/Taipei'), false)
  assert.equal(m.looksMainland('America/Los_Angeles'), false)
  assert.equal(m.looksMainland(''), false)
})

test('keyPresent: 明文非空算;env: 引用要看变量此刻有没有值', () => {
  assert.equal(m.keyPresent('sk-abc'), true)
  assert.equal(m.keyPresent(''), false)
  assert.equal(m.keyPresent(undefined), false)
  assert.equal(m.keyPresent('env:DEEPSEEK_API_KEY', { DEEPSEEK_API_KEY: 'sk-1' }), true)
  assert.equal(m.keyPresent('env:DEEPSEEK_API_KEY', {}), false)
})

test('explainTestFailure: 各家真实的 401 原文都归到「key 不对」', () => {
  // 2026-10-19 用无效 key 打各家 /v1/messages 拿到的原文
  for (const t of [
    'API Error: 401 {"error":{"message":"Authentication Fails, Your api key: ****test is invalid","type":"authentication_error"}}',
    'API Error: 401 {"error":{"message":"令牌已过期或验证不正确","type":"401"}}',
    'API Error: 401 {"error":{"message":"token expired or incorrect","type":"401"}}',
    'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"login fail"}}',
    'Invalid API key · Fix external API key',
  ]) assert.equal(m.explainTestFailure(t).kind, 'auth', t)
})

test('explainTestFailure: 余额 / 网络 / 模型名 / 其他', () => {
  assert.equal(m.explainTestFailure('API Error: 402 {"error":{"message":"Insufficient Balance"}}').kind, 'balance')
  assert.equal(m.explainTestFailure('余额不足或无可用资源包,请充值').kind, 'balance')
  const net = m.explainTestFailure('fetch failed: getaddrinfo ENOTFOUND api.deepseek.com', { baseUrl: 'https://api.deepseek.com/anthropic' })
  assert.equal(net.kind, 'network'); assert.match(net.text, /api\.deepseek\.com/)
  assert.equal(m.explainTestFailure('API Error: 404 model not found').kind, 'model')
  const other = m.explainTestFailure('something odd\nsecond line')
  assert.equal(other.kind, 'other'); assert.equal(other.text, 'something odd')
  assert.equal(m.explainTestFailure('').text, '没有返回内容')
})
