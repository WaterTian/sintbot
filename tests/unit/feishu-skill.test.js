// Base skill (群项目基础能力) — the `sbot feishu send-*` path fence. This is the
// security boundary: the agent calls `sbot feishu send-file <path>` with cwd = its
// project workdir, and sbot sends with its OWN privileged app creds. The fence must
// confine sends to the workdir so a compromised/creative agent can't exfiltrate host
// files (e.g. ~/.sbot/config.json) through the bot. Mirrors lark-cli: cwd-relative only.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resolveSendPath, sendChatFile, sendChatImage } = require('../../src/platform/feishu')

// A real dir with one real file (the fence also checks existence).
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-fence-'))
fs.writeFileSync(path.join(root, 'ok.txt'), 'x')
fs.mkdirSync(path.join(root, 'sub'))
fs.writeFileSync(path.join(root, 'sub', 'deep.txt'), 'y')

test('resolveSendPath: allows a cwd-relative file', () => {
  assert.equal(resolveSendPath(root, 'ok.txt'), path.join(root, 'ok.txt'))
  assert.equal(resolveSendPath(root, 'sub/deep.txt'), path.join(root, 'sub', 'deep.txt'))
  assert.equal(resolveSendPath(root, './ok.txt'), path.join(root, 'ok.txt'))
})

test('resolveSendPath: rejects absolute paths', () => {
  assert.throws(() => resolveSendPath(root, '/etc/passwd'), /绝对路径/)
  assert.throws(() => resolveSendPath(root, path.join(root, 'ok.txt')), /绝对路径/) // even an in-tree absolute
})

test('resolveSendPath: rejects any .. segment (no escaping the workdir)', () => {
  assert.throws(() => resolveSendPath(root, '../x.txt'), /\.\./)
  assert.throws(() => resolveSendPath(root, 'sub/../../x'), /\.\./)
  assert.throws(() => resolveSendPath(root, '..\\win.txt'), /\.\./) // backslash split too (Windows)
})

test('resolveSendPath: rejects a missing file', () => {
  assert.throws(() => resolveSendPath(root, 'nope.txt'), /不存在/)
})

test('resolveSendPath: rejects empty path', () => {
  assert.throws(() => resolveSendPath(root, ''), /缺少文件路径/)
  assert.throws(() => resolveSendPath(root, undefined), /缺少文件路径/)
})

// Upload response shape (real-machine bug, v0.2.0→0.2.1): the SDK returns image_key/file_key
// either at the TOP LEVEL or nested under .data. sendChatFile/sendChatImage must read both,
// then post a file/image message carrying that key. (Reading only .data.* broke the send.)
test('sendChatFile: reads file_key from the TOP LEVEL of the SDK response, then sends msg_type=file', async () => {
  const sent = []
  const client = { im: {
    file: { create: async () => ({ code: 0, file_key: 'file_top123' }) },        // top-level key
    message: { create: async (arg) => { sent.push(arg); return {} } },
  } }
  const key = await sendChatFile(client, 'oc_x', path.join(root, 'ok.txt'))
  assert.equal(key, 'file_top123')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].data.msg_type, 'file')
  assert.match(sent[0].data.content, /file_top123/)
})

test('sendChatImage: reads image_key nested under .data, then sends msg_type=image', async () => {
  const sent = []
  const client = { im: {
    image: { create: async () => ({ code: 0, data: { image_key: 'img_nested456' } }) }, // nested key
    message: { create: async (arg) => { sent.push(arg); return {} } },
  } }
  const key = await sendChatImage(client, 'oc_x', path.join(root, 'ok.txt'))
  assert.equal(key, 'img_nested456')
  assert.equal(sent[0].data.msg_type, 'image')
  assert.match(sent[0].data.content, /img_nested456/)
})
