// 单实例锁:同一份状态只许一个 daemon(两个会抢同一个平台的消息)。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { acquire } = require('../../src/core/instancelock')

const lockFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-lock-')), 'state', 'daemon.lock')

test('instancelock: 抢到就写自己的 pid;release 只删自己的那把', () => {
  const f = lockFile()
  const a = acquire(f, { pid: 111, isSbot: () => ({ alive: false }) })
  assert.equal(a.ok, true)
  assert.equal(fs.readFileSync(f, 'utf8'), '111')
  fs.writeFileSync(f, '222') // 期间被别人接管了
  a.release()
  assert.equal(fs.readFileSync(f, 'utf8'), '222', '别人的锁不许删')
  fs.writeFileSync(f, '111'); a.release()
  assert.equal(fs.existsSync(f), false, '自己的锁退出时删掉')
})

test('instancelock: 持有者还活着且是 sbot ⇒ 第二个拿不到,报出持有者', () => {
  const f = lockFile()
  acquire(f, { pid: 111, isSbot: () => ({ alive: false }) })
  const b = acquire(f, { pid: 222, isSbot: (pid) => ({ alive: pid === 111, cmd: 'node /x/bin/sbot.js start --ui' }) })
  assert.deepEqual(b, { ok: false, holder: 111, cmd: 'node /x/bin/sbot.js start --ui' })
  assert.equal(fs.readFileSync(f, 'utf8'), '111', '拿不到的一方不许动锁')
})

test('instancelock: 持有者已经不在(崩了没删 / pid 被无关进程复用)⇒ 接管', () => {
  const f = lockFile()
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, '111')
  const b = acquire(f, { pid: 222, isSbot: () => ({ alive: false }) })
  assert.equal(b.ok, true)
  assert.equal(fs.readFileSync(f, 'utf8'), '222')
  // 锁里是自己的 pid(重启后 pid 恰好相同)也照样接管,不会自己拦自己
  const c = acquire(f, { pid: 222, isSbot: () => ({ alive: true }) })
  assert.equal(c.ok, true)
})

test('instancelock: 默认判据认得出真进程 —— 自己这个 node 进程活着但不是 sbot ⇒ 不拦', () => {
  const f = lockFile()
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, String(process.pid))
  const r = acquire(f, { pid: process.pid + 1 }) // 用默认 isSbot:进程在,但命令行里没有 sbot
  assert.equal(r.ok, process.platform === 'win32' ? false : true)
})
