// Console access-password hashing (scrypt) — used to gate LAN exposure of the console.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { hashPassword, verifyPassword } = require('../../src/ui/auth')

test('auth: hashPassword → verifyPassword round-trips the right password', () => {
  const stored = hashPassword('correct horse battery staple')
  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
  assert.equal(verifyPassword('correct horse battery staple', stored), true)
  assert.equal(verifyPassword('wrong password', stored), false)
})

test('auth: same password hashes differently each time (random salt)', () => {
  const a = hashPassword('hunter2'), b = hashPassword('hunter2')
  assert.notEqual(a, b)
  assert.equal(verifyPassword('hunter2', a), true)
  assert.equal(verifyPassword('hunter2', b), true)
})

test('auth: verifyPassword never throws on malformed stored values', () => {
  for (const bad of [null, undefined, '', 'plaintext', 'scrypt$onlyonepart', 'scrypt$zz$zz', 'bcrypt$aa$bb', 42, {}]) {
    assert.equal(verifyPassword('x', bad), false)
  }
})

test('auth: empty password still verifies against its own hash (edge, but consistent)', () => {
  const stored = hashPassword('')
  assert.equal(verifyPassword('', stored), true)
  assert.equal(verifyPassword('x', stored), false)
})
