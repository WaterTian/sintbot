// 企业微信官方命令行工具封装(src/platform/wecomcli.js):基础技能 / 生图通知 / 接管入口三处共用。
// 判据:回包剥两段安全提示 · {error} 与非 JSON 都算失败 · 单聊 id 两套空间要搜人换算且只认精确唯一命中 ·
// 发送按 --msg-type 取同名 JSON 参数 · 图 / 文件先上传再发。零网络:注入假 exec。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createWecomCli } = require('../../src/platform/wecomcli')

const NOTICE = { security_notice: 'x', extra_identity_context: 'y' }
function fakeExec(table, calls = []) {
  return (bin, args, opts, cb) => {
    calls.push(args.join(' '))
    const hit = table.find(([re]) => re.test(args.join(' ')))
    const out = hit ? hit[1](args) : { ...NOTICE }
    setImmediate(() => (out instanceof Error ? cb(out, '', '') : cb(null, typeof out === 'string' ? out : JSON.stringify({ ...NOTICE, ...out }), '')))
  }
}

test('wecomcli: run 剥安全提示字段;{error} / 非 JSON / 退出码非零都 reject;ENOENT 带 code', async () => {
  const wc = createWecomCli({ bin: 'x', exec: fakeExec([[/ok/, () => ({ a: 1 })], [/bad/, () => ({ error: { code: 'E', message: '没权限' } })], [/junk/, () => 'not json']]) })
  assert.deepEqual(await wc.run(['ok']), { a: 1 })
  await assert.rejects(wc.run(['bad']), /没权限/)
  await assert.rejects(wc.run(['junk']), /可读的结果/)
  const wc2 = createWecomCli({ bin: 'x', exec: (b, a, o, cb) => setImmediate(() => cb(Object.assign(new Error('nf'), { code: 'ENOENT' }), '', '')) })
  await assert.rejects(wc2.run(['any']), (e) => e.code === 'ENOENT' && /未安装/.test(e.message))
})

test('wecomcli: 单聊 id 搜人换算 —— 群原样;精确唯一才发;找不到 / 不唯一都拒(回归:此前这里引用了未定义变量,一跑就炸)', async () => {
  const calls = []
  const wc = createWecomCli({ bin: 'x', exec: fakeExec([
    [/search --keywords WangWu/, () => ({ users: [{ userid: 'woA2ok', name: '王五', matched_keywords: ['WangWu'] }, { userid: 'woA2other', name: '赵六', matched_keywords: ['ZhaoLiu'] }] })],
    [/search --keywords Nobody/, () => ({ users: [] })],
    [/search --keywords Dup/, () => ({ users: [{ userid: 'w1', matched_keywords: ['Dup'] }, { userid: 'w2', matched_keywords: ['Dup'] }] })],
    [/message aibot send/, () => ({ success: true })],
  ], calls) })
  assert.equal(await wc.chatIdForCli('wrGROUP1234'), 'wrGROUP1234'); assert.equal(calls.length, 0, '群不搜人')
  assert.equal(await wc.chatIdForCli('WangWu'), 'woA2ok')
  await assert.rejects(wc.chatIdForCli('Nobody'), /找不到/)
  await assert.rejects(wc.chatIdForCli('Dup'), /不唯一/)
  await wc.sendMarkdown('WangWu', '**hi**')
  const send = calls.find((c) => /message aibot send/.test(c))
  assert.match(send, /--chat-id woA2ok --msg-type markdown --markdown /); assert.match(send, /"content":"\*\*hi\*\*"/)
})

test('wecomcli: 发图 / 发文件先上传拿 media_id 再发;success:false 算失败;history 拉近 7 天', async () => {
  const calls = []
  const wc = createWecomCli({ bin: 'x', exec: fakeExec([
    [/media upload --type image/, () => ({ media_id: 'MID-IMG' })],
    [/media upload --type file/, () => ({ media_id: 'MID-FILE' })],
    [/send .* --msg-type image/, () => ({ success: true })],
    [/send .* --msg-type file/, () => ({ success: false, message: '太大' })],
    [/chat messages list/, () => ({ messages: [{ userid: 'U1', user_name: '甲', msg_type: 'text', text: { content: 'x' } }] })],
  ], calls) })
  await wc.sendImage('wrG', '/tmp/a.png')
  assert.ok(calls.some((c) => /upload --type image --file-path \/tmp\/a\.png/.test(c)))
  assert.ok(calls.some((c) => /--msg-type image --image \{"media_id":"MID-IMG"\}/.test(c)))
  await assert.rejects(wc.sendFile('wrG', '/tmp/a.pdf'), /太大/)
  // 时间字面量按北京时间(与主机时区无关):UTC 04:00 = 北京 12:00
  const msgs = await wc.history('wrG', { now: () => new Date(Date.UTC(2026, 9, 10, 4, 0, 0)) })
  assert.equal(msgs[0].user_name, '甲')
  const h = calls.find((c) => /chat messages list/.test(c))
  assert.match(h, /--chat-id wrG --begin-time 2026-10-04 12:00:00 --end-time 2026-10-10 12:00:00/, '6 天(整 7 天会被接口拒 850016)· 北京字面量')
  const { fmtBeijing } = require('../../src/platform/wecomcli')
  assert.equal(fmtBeijing(new Date(Date.UTC(2026, 9, 10, 16, 5, 9))), '2026-10-11 00:05:09', '跨日也按北京算')
})

test('wecomcli: fetchMedia 两种回包形态都归一成本机文件 —— 框架落盘给 file_path(相对路径按 outDir 解析)/ 短内容内联 content 自己落盘;没内容算失败', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wecomcli-media-'))
  const calls = [], cwds = []
  const inner = fakeExec([
    [/files get --media-id MID-DISK/, () => ({ media_item: { media_id: 'MID-DISK', media_type: 'image', file_name: 'a.png', file_path: 'msg_media' } })],
    [/files get --media-id MID-ABS/, () => ({ media_item: { media_id: 'MID-ABS', media_type: 'file', file_path: '/abs/elsewhere/msg_media' } })],
    [/files get --media-id MID-INLINE/, () => ({ media_item: { media_id: 'MID-INLINE', media_type: 'file', file_name: 'notes.txt', content: 'hello' } })],
    [/files get --media-id MID-EMPTY/, () => ({ media_item: { media_id: 'MID-EMPTY' } })],
  ], calls)
  const wc = createWecomCli({ bin: 'x', exec: (b, a, o, cb) => { cwds.push(o.cwd); inner(b, a, o, cb) } })
  const a = await wc.fetchMedia('MID-DISK', dir)
  assert.deepEqual(a, { path: path.join(dir, 'msg_media'), name: 'a.png', type: 'image' }, '相对 file_path 按目标目录解析')
  assert.equal(calls[0], 'message files get --media-id MID-DISK --output-dir .', '工具只许写自己的 cwd ⇒ --output-dir . 配 cwd=目标目录(真机被拒过)'); assert.equal(cwds[0], dir)
  const b = await wc.fetchMedia('MID-ABS', dir)
  assert.equal(b.path, '/abs/elsewhere/msg_media', '绝对路径原样'); assert.equal(b.name, null)
  const c = await wc.fetchMedia('MID-INLINE', dir)
  assert.equal(c.path, path.join(dir, 'notes.txt')); assert.equal(fs.readFileSync(c.path, 'utf8'), 'hello', '内联内容自己落盘')
  await assert.rejects(wc.fetchMedia('MID-EMPTY', dir), /没有返回文件内容/)
  await assert.rejects(wc.fetchMedia('', dir), /缺少媒体 id/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('wecomcli: whoami —— 身份接口文本解析成机器人 / 授权用户;没名字就抛;run 默认剥掉 extra_identity_context、keepContext 才留', async () => {
  const ctx = '<extra_identity_context>\n机器人身份：\n名字：SintBot\nID：aibDemo\n授权真人用户身份：\n名字：王五  \nID：woDemo\nCLI 调用一定由你的机器人身份代用户执行。\n</extra_identity_context>'
  const wc = createWecomCli({ bin: 'x', exec: fakeExec([[/identity whoami/, () => ({ extra_identity_context: ctx })], [/other/, () => ({ a: 1, extra_identity_context: ctx })]]) })
  assert.deepEqual(await wc.whoami(), { bot: { name: 'SintBot', id: 'aibDemo' }, user: { name: '王五', id: 'woDemo' } })
  assert.deepEqual(await wc.run(['other']), { a: 1 }, '默认剥掉身份段')
  const wc2 = createWecomCli({ bin: 'x', exec: fakeExec([[/identity whoami/, () => ({ extra_identity_context: '<extra_identity_context>\n授权真人用户身份：\n名字：王五\nID：w\n</extra_identity_context>' })]]) })
  await assert.rejects(wc2.whoami(), /没有返回机器人名/)
})

test('wecomcli: 错误带 code 与续期链接;850003 / 853006 翻成人话', async () => {
  const wc = createWecomCli({ bin: 'x', exec: fakeExec([
    [/exp/, () => ({ error: { code: 850003, message: 'permission expired', help_message: 'https://work.weixin.qq.com/renew/abc' } })],
    [/size/, () => ({ error: { code: '853006', message: 'not allowed' } })],
    [/plain/, () => ({ error: { code: 40058, message: '参数不合法' } })],
  ]) })
  await assert.rejects(wc.run(['exp']), (e) => e.code === 850003 && /授权已过期.*续期链接/.test(e.message) && e.help === 'https://work.weixin.qq.com/renew/abc')
  await assert.rejects(wc.run(['size']), (e) => e.code === '853006' && /企业规模门控/.test(e.message) && /不是配置错/.test(e.message))
  await assert.rejects(wc.run(['plain']), (e) => e.code === 40058 && e.message === '参数不合法')
})
