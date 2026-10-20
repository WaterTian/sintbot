// Claude 订阅登录态探测 + 模型候选。两者都只在「登录了」时才给型号 —— 拍板:没登录不列。
// 探测走 `claude auth status --json`(官方非交互子命令);这里测的是解析与降级,不 spawn。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseAuthStatus, describeLogin } = require('../../src/agent/claudestatus')
const { listModels, mergeModels, parseExtraModels, BUILTIN } = require('../../src/agent/claudemodels')

const okJson = JSON.stringify({
  loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty',
  email: 'a@b.com', orgId: 'x', orgName: 'A Org', subscriptionType: 'max',
})

test('parseAuthStatus: 订阅登录 → 档位/账号/方式都带出来', () => {
  const s = parseAuthStatus(okJson, 0)
  assert.deepEqual(s, { ok: true, loggedIn: true, plan: 'max', email: 'a@b.com', org: 'A Org', method: 'claude.ai', apiProvider: 'firstParty' })
  assert.equal(describeLogin(s).level, 'ok')
  assert.match(describeLogin(s).text, /max/)
})

test('parseAuthStatus: 未登录 ⇒ fail + 可照做的下一步', () => {
  const s = parseAuthStatus(JSON.stringify({ loggedIn: false }), 0)
  assert.equal(s.ok, true)      // 探针本身跑通了
  assert.equal(s.loggedIn, false)
  const d = describeLogin(s)
  assert.equal(d.level, 'fail')
  assert.match(d.text, /claude auth login/)
})

test('parseAuthStatus: 老版本 CLI 没这个子命令 ⇒ 「未验证」,不能当成「未登录」', () => {
  // 这两种情况必须分开:未登录是「去登录」,未验证是「探不到,别乱下结论」。
  const s = parseAuthStatus("error: unknown command 'auth'", 1)
  assert.equal(s.ok, false)
  const d = describeLogin(s)
  assert.equal(d.level, 'warn')          // warn 而不是 fail —— 生产机那种不用 Claude 的机器不该被判故障
  assert.match(d.text, /未验证/)
  assert.doesNotMatch(d.text, /未登录/)
})

test('parseAuthStatus: 非 JSON / 空输出不抛', () => {
  for (const [out, code] of [['', 1], ['garbage', 0], [null, 0]]) {
    const s = parseAuthStatus(out, code)
    assert.equal(s.ok, false); assert.equal(s.loggedIn, false)
  }
})

test('describeLogin: 探针没跑(null)也给「未验证」而不是崩', () => {
  assert.equal(describeLogin(null).level, 'warn')
})

test('listModels: 未登录 ⇒ 一个型号都不给(拍板:没登录不列)', () => {
  const r = listModels({ loggedIn: false })
  assert.deepEqual(r.models, [])
  assert.equal(r.source, 'none')
})

test('listModels: 已登录 ⇒ 首项是「跟随 Claude Code 默认」(id 为空)', () => {
  const r = listModels({ loggedIn: true, home: '/nonexistent-home' })
  assert.equal(r.models[0].id, '')       // 空 id = 不设 ANTHROPIC_MODEL
  assert.match(r.models[0].name, /默认/)
  assert.equal(r.source, 'builtin')      // 读不到账号额外项时如实标 builtin
  assert.ok(r.models.some((m) => m.id === 'claude-opus-5'))
})

// v0.11.9(operator 点名):Opus 4.8 仍在服务且额度池与 Opus 5 分开,得能在下拉里选到。
// id 必须是不带日期后缀的固定串 —— 拼一个 `-2026xxxx` 出来会 404。
test('listModels: 已登录 ⇒ 列出 Opus 4.8,且 id 无日期后缀', () => {
  const m = listModels({ loggedIn: true, home: '/nonexistent-home' }).models
  const o48 = m.find((x) => x.id === 'claude-opus-4-8')
  assert.ok(o48, '模型下拉里应有 Opus 4.8')
  assert.match(o48.name, /4\.8/)
  for (const x of m) assert.doesNotMatch(x.id, /-\d{8}$/, `型号 id 不该带日期后缀: ${x.id}`)
})

test('parseExtraModels: 读本机账号的额外可选型号;字段缺失/形状变了都不抛', () => {
  assert.deepEqual(
    parseExtraModels({ additionalModelOptionsCache: [{ value: 'claude-fable-5[1m]', label: 'Fable', description: 'x' }] }),
    [{ id: 'claude-fable-5[1m]', name: 'Fable', note: 'x' }])
  for (const bad of [null, {}, { additionalModelOptionsCache: 'nope' }, { additionalModelOptionsCache: [null, {}, { value: '' }] }])
    assert.deepEqual(parseExtraModels(bad), [])
})

test('mergeModels: 账号额外项追加在内置之后,同 id 不重复', () => {
  const m = mergeModels([{ id: 'claude-fable-5', name: 'Fable' }, { id: 'claude-opus-5', name: '重复' }])
  assert.equal(m.length, BUILTIN.length + 1)
  const fable = m.find((x) => x.id === 'claude-fable-5')
  assert.equal(fable.extra, true)                                  // 打标,面板用 ★ 标出来
  assert.equal(m.filter((x) => x.id === 'claude-opus-5').length, 1) // 内置那条保留,不被覆盖
})
