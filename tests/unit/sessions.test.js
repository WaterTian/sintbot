// 控制台登录会话落盘:签发 / 校验 / 过期 / 登出 / 重启后仍在 / 文件坏了当空 / 权限 0600。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createSessionStore, DEFAULT_TTL_MS } = require('../../src/ui/sessions')

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-sess-')), 'nested', 'ui-sessions.json')

test('默认有效期是 30 天(字面量基准)', () => {
  assert.equal(DEFAULT_TTL_MS, 30 * 24 * 60 * 60 * 1000)
})

test('签发 → 有效;重开 store 读回仍有效;登出后两边都失效', () => {
  const file = tmpFile()
  let t = 5_000_000
  const s1 = createSessionStore({ file, ttlMs: 60_000, now: () => t })
  const tok = s1.add({ via: 'feishu', who: '王五', ip: '1.2.3.4' })
  assert.match(tok, /^[0-9a-f]{48}$/)
  assert.equal(s1.has(tok), true)
  assert.deepEqual(s1.get(tok), { exp: t + 60_000, via: 'feishu', who: '王五', ip: '1.2.3.4', at: t })
  assert.equal(s1.has('deadbeef'), false)
  // 模拟重启:另起一个 store 读同一文件
  const s2 = createSessionStore({ file, ttlMs: 60_000, now: () => t })
  assert.equal(s2.has(tok), true, '落盘了,重启不登出')
  s2.remove(tok)
  assert.equal(s2.has(tok), false)
  const s3 = createSessionStore({ file, ttlMs: 60_000, now: () => t })
  assert.equal(s3.has(tok), false, '登出也落盘')
})

test('过期即失效,且过期项在下一次读文件时被清掉', () => {
  const file = tmpFile()
  let t = 1_000
  const s = createSessionStore({ file, ttlMs: 100, now: () => t })
  const tok = s.add({})
  t += 101
  assert.equal(s.has(tok), false)
  assert.equal(s.size, 0)
  const again = createSessionStore({ file, ttlMs: 100, now: () => t })
  assert.equal(again.size, 0)
})

test('文件权限 0600(POSIX);目录不存在会自动建', () => {
  const file = tmpFile()
  const s = createSessionStore({ file })
  s.add({})
  assert.ok(fs.existsSync(file))
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})

test('文件损坏 / 形状不对:按没有会话处理,不抛,并记一条日志;之后能正常写', () => {
  const file = tmpFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '{not json')
  const logs = []
  const s = createSessionStore({ file, log: (m) => logs.push(m) })
  assert.equal(s.size, 0)
  assert.equal(logs.length, 1)
  assert.match(logs[0], /读不出来/)
  const tok = s.add({})
  assert.equal(createSessionStore({ file }).has(tok), true)
  // 形状对但令牌不合法 / 没有 exp 的项被丢弃
  fs.writeFileSync(file, JSON.stringify({ v: 1, tokens: { 'not-hex!': { exp: 9e15 }, ['b'.repeat(48)]: { nope: 1 }, ['c'.repeat(48)]: { exp: 9e15, via: 'password' } } }))
  const s2 = createSessionStore({ file, now: () => 1 })
  assert.equal(s2.has('not-hex!'), false)
  assert.equal(s2.has('b'.repeat(48)), false)
  assert.equal(s2.has('c'.repeat(48)), true)
})

test('两枚令牌:登出一枚,另一枚仍有效(「其它设备上的登录不受影响」的唯一证据)', () => {
  const file = tmpFile()
  const s = createSessionStore({ file })
  const a = s.add({ via: 'feishu', who: '甲', openId: 'ou_a' }), b = s.add({ via: 'password', authRef: 'scrypt$abc' })
  assert.notEqual(a, b)
  s.remove(a)
  assert.equal(s.has(a), false); assert.equal(s.has(b), true)
  assert.equal(createSessionStore({ file }).has(b), true, '另一枚也落盘着')
})

test('revokeWhere 按身份线索吊销;clear 全吊;签发时的额外字段(openId / authRef / xff)原样存、空值不存', () => {
  const file = tmpFile()
  const s = createSessionStore({ file })
  const a = s.add({ via: 'feishu', who: '甲', openId: 'ou_a', xff: '1.1.1.1' })
  const b = s.add({ via: 'feishu', who: '乙', openId: 'ou_b', xff: '' })
  const c = s.add({ via: 'password', authRef: 'scrypt$old' })
  assert.equal(s.get(a).openId, 'ou_a'); assert.equal(s.get(a).xff, '1.1.1.1')
  assert.equal('xff' in s.get(b), false, '空值不落盘')
  assert.equal(s.revokeWhere((m) => m.via === 'feishu' && m.openId !== 'ou_b'), 1, '只吊甲')
  assert.equal(s.has(a), false); assert.equal(s.has(b), true); assert.equal(s.has(c), true)
  assert.equal(s.revokeWhere(() => false), 0)
  assert.equal(s.revokeWhere((m) => m.via === 'password' && m.authRef !== 'scrypt$new'), 1, '换了密码 ⇒ 旧密码签的作废')
  assert.equal(createSessionStore({ file }).has(a), false, '吊销落盘')
  assert.equal(s.clear(), 1); assert.equal(s.size, 0)
  assert.equal(createSessionStore({ file }).size, 0)
})

test('没有 file:纯内存,行为一致,不抛', () => {
  const s = createSessionStore({})
  const tok = s.add({ via: 'password' })
  assert.equal(s.has(tok), true)
  s.remove(tok)
  assert.equal(s.has(tok), false)
})
