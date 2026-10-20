// 凭据验证记录(src/core/verify.js):doctor / 控制台概览据此区分「配了」与「能用」。
// 钉三件事:① 按指纹记、不存原文,换凭据就查不到旧结论;② 只认凭据层面的失败(网络 / 超时不动原记录);
// ③ 状态不变时 6 小时内不重复写盘(真实轮次每轮都会报)。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const verify = require('../../src/core/verify')

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-verify-')), '.sbot', 'verify.json')

test('verify: 指纹 —— 同凭据同指纹、换任一字段就变;缺字段不记;文件里没有凭据原文、权限 600', () => {
  const p = { baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'sk-secret-123456' }
  assert.equal(verify.providerFp(p), verify.providerFp({ ...p }))
  assert.notEqual(verify.providerFp(p), verify.providerFp({ ...p, apiKey: 'sk-other' }))
  assert.notEqual(verify.providerFp(p), verify.providerFp({ ...p, baseUrl: 'https://x' }))
  assert.equal(verify.providerFp({ apiKey: 'k' }), '', '订阅登录 / 没 baseUrl:不记')
  assert.equal(verify.feishuFp({ appId: 'cli_a' }), '')
  const file = tmpFile()
  assert.equal(verify.record(verify.providerFp(p), true, '', { file }), true)
  const raw = fs.readFileSync(file, 'utf8')
  assert.ok(!raw.includes('sk-secret'), '不存原文')
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.equal(verify.lookup(verify.providerFp(p), { file }).ok, true)
  assert.equal(verify.lookup(verify.providerFp({ ...p, apiKey: 'sk-new' }), { file }), null, '换 key ⇒ 未验证')
})

test('verify: recordTurn 只认凭据层面的结论 —— 401 / 欠费记失败,网络与超时不动原记录', () => {
  const file = tmpFile()
  const p = { baseUrl: 'https://open.bigmodel.cn/api/anthropic', apiKey: 'k1234567890' }
  const fp = verify.providerFp(p)
  verify.recordTurn(p, true, '', { file })
  assert.equal(verify.recordTurn(p, false, 'fetch failed: ETIMEDOUT', { file }), false)
  assert.equal(verify.lookup(fp, { file }).ok, true, '网络错不推翻「能用」')
  verify.recordTurn(p, false, 'API Error: 401 {"error":{"type":"authentication_error"}}', { file })
  const v = verify.lookup(fp, { file })
  assert.equal(v.ok, false); assert.match(v.reason, /key 不对/)
  verify.recordTurn(p, false, 'API Error: 402 Insufficient Balance', { file })
  assert.match(verify.lookup(fp, { file }).reason, /余额/)
})

test('verify: recordPrecheck —— 飞书看 bot 身份;Slack 要 auth 与 socket 都通过;权限缺项不算', () => {
  const file = tmpFile()
  const fe = { appId: 'cli_a', appSecret: 's' }
  verify.recordPrecheck('feishu', fe, [{ key: 'bot', status: 'ok' }, { key: 'im:chat', status: 'warn' }], { file })
  assert.equal(verify.lookup(verify.feishuFp(fe), { file }).ok, true)
  const sl = { botToken: 'xoxb-1', appToken: 'xapp-1' }
  verify.recordPrecheck('slack', sl, [{ key: 'auth', status: 'ok' }, { key: 'scopes', status: 'fail' }, { key: 'socket', status: 'fail', label: 'Socket Mode', detail: 'app token 无效' }], { file })
  const v = verify.lookup(verify.slackFp(sl), { file })
  assert.equal(v.ok, false); assert.match(v.reason, /Socket Mode:app token 无效/)
})

test('verify: 状态不变 6 小时内不重复写盘,变了立刻写', () => {
  const file = tmpFile()
  const fp = verify.fingerprint('provider', 'b', 'k')
  const t0 = Date.parse('2026-10-20T10:00:00Z')
  assert.equal(verify.record(fp, true, '', { file, now: t0 }), true)
  assert.equal(verify.record(fp, true, '', { file, now: t0 + 3600e3 }), false)
  assert.equal(verify.record(fp, false, 'key 不对', { file, now: t0 + 3600e3 }), true)
  assert.equal(verify.record(fp, false, 'key 不对', { file, now: t0 + 7 * 3600e3 }), true, '超过 6 小时刷新时间')
})
