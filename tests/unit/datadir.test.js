// 状态目录权限:目录 700、顶层与 logs/ 里的文件 600;新建的账本 / 反馈本 / 状态文件生来就是 600。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { secureDataDir } = require('../../src/core/datadir')
const { createLedger } = require('../../src/core/ledger')
const { createIssues } = require('../../src/core/issues')
const { StateStore } = require('../../src/core/store')
const { writePending, pendingFile } = require('../../src/core/pending')

const posix = process.platform !== 'win32'
const mode = (p) => fs.statSync(p).mode & 0o777
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-datadir-'))

test('datadir: 旧版本留下的 755 / 644 收紧成 700 / 600,并报出改了哪些', { skip: !posix }, () => {
  const dir = path.join(tmp(), '.sbot')
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true, mode: 0o755 })
  fs.chmodSync(dir, 0o755); fs.chmodSync(path.join(dir, 'logs'), 0o755)
  for (const f of ['turns.jsonl', 'audit.jsonl', 'state.json', 'logs/out.log']) fs.writeFileSync(path.join(dir, f), 'x', { mode: 0o644 })
  fs.writeFileSync(path.join(dir, 'ui-sessions.json'), 'x', { mode: 0o600 }) // 对照:本来就严的不动、不计数
  const changed = secureDataDir(dir)
  assert.equal(mode(dir), 0o700)
  assert.equal(mode(path.join(dir, 'logs')), 0o700)
  for (const f of ['turns.jsonl', 'audit.jsonl', 'state.json', 'logs/out.log', 'ui-sessions.json']) assert.equal(mode(path.join(dir, f)), 0o600, f)
  assert.equal(changed.length, 6)
  assert.ok(!changed.includes(path.join(dir, 'ui-sessions.json')))
  assert.deepEqual(secureDataDir(dir), [], '第二次启动没有要改的')
})

test('datadir: 不跟符号链接、不碰其他子目录里的东西', { skip: !posix }, () => {
  const root = tmp()
  const outside = path.join(root, 'outside.txt')
  fs.writeFileSync(outside, 'x', { mode: 0o644 })
  const dir = path.join(root, '.sbot')
  fs.mkdirSync(path.join(dir, 'preview'), { recursive: true })
  fs.symlinkSync(outside, path.join(dir, 'link.txt'))
  fs.writeFileSync(path.join(dir, 'preview', 'index.html'), 'x', { mode: 0o644 })
  secureDataDir(dir)
  assert.equal(mode(outside), 0o644, '目录外的文件不许被改')
  assert.equal(mode(path.join(dir, 'preview', 'index.html')), 0o644, '子目录靠父目录 700 挡住,里面的文件不逐个改')
  assert.equal(mode(dir), 0o700)
})

test('datadir: 目录不存在就以 700 建出来', { skip: !posix }, () => {
  const dir = path.join(tmp(), 'a', '.sbot')
  assert.deepEqual(secureDataDir(dir), [])
  assert.equal(mode(dir), 0o700)
})

test('datadir: Windows 只建目录、不改权限', () => {
  const dir = path.join(tmp(), '.sbot')
  assert.deepEqual(secureDataDir(dir, { platform: 'win32' }), [])
  assert.ok(fs.existsSync(dir))
})

test('datadir: 账本、反馈本、状态文件、被打断的请求新建时就是 600', { skip: !posix }, async () => {
  const dir = path.join(tmp(), '.sbot')
  const ledger = createLedger(path.join(dir, 'turns.jsonl'))
  ledger.append({ ts: 1, text: 'hi' })
  await new Promise((r) => setTimeout(r, 50)) // 账本是异步追加
  createIssues(path.join(dir, 'issues.jsonl')).add({ chatId: 'c', text: 'bug' })
  new StateStore(path.join(dir, 'state.json')).setSession('c', 's1')
  writePending(pendingFile(dir), [{ chatId: 'c', text: 'redo', sender: 'u', ts: Date.now() }])
  for (const f of ['turns.jsonl', 'issues.jsonl', 'state.json', path.basename(pendingFile(dir))]) assert.equal(mode(path.join(dir, f)), 0o600, f)
  assert.equal(mode(dir), 0o700)
})
