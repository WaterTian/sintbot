// 自定义风格的五个控制台端点(v0.11.21)。跑真 HTTP + 临时配置 + 临时风格目录:
//   POST   /api/design/preview   表单 → 卡片(不落盘,半填也要出图)
//   POST   /api/design/styles    校验 + 编译 + 原子落盘(同名 409;遮蔽内置如实回报)
//   DELETE /api/design/styles    只删自己建的
//   POST   /api/design/extract   网址 / 本机目录 → 候选 + 证据(围栏在这一层就要挡住)
//   POST   /api/design/collect   把某个群项目里的风格档复制进全局库
// 模块级逻辑在 designstyle.test.js;这里只钉端点:鉴权、路由不被 GET 那条吞掉、状态码、
// 落盘位置、以及**用户目录必须可注入**(否则这些用例会写进跑测者的真实风格库)。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createUiServer } = require('../../src/ui/server')
const { rmTmpDir } = require('./tmpdir')
const design = require('../../src/design')

const FORM = {
  name: '品牌紫',
  description: '干净、克制',
  suits: ['工具产品'],
  colors: { bg: '#FFFFFF', ink: '#172033', accent: '#6D28D9', muted: '#6B7280' },
  rounded: 'soft', weight: 'heavy', serif: false, mono: true,
}

// ⚠ userStylesDir() 指向真实的 ~ —— 端点内部按默认参数落盘,所以这里必须整体改写 HOME,
// 否则跑一次单测就会往跑测者的风格库里塞几个测试用的风格档(而且删不干净)。
async function withServer(run, { groups = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-dsg-'))
  // 假家目录放在 dir 之外:dir 是这些用例的项目根,而「家目录的上一级」会被围栏当成等于没围的值丢掉
  //(围栏第一次跑就把原先 dir/home 这个布局逮住了 —— 那正是它该拦的形状)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-dsg-home-'))
  const cfgPath = path.join(dir, 'sbot.config.json')
  // projectsRoots = 临时目录:提炼接口的目录侧只认项目根目录之内的路径(2026-09-08 起与目录浏览同一道围栏)
  fs.writeFileSync(cfgPath, JSON.stringify({ providers: { claude: {} }, defaultProvider: 'claude', groups, projectsRoots: [dir] }))
  const realHome = os.homedir
  os.homedir = () => home
  const ui = createUiServer({ sessionsPath: path.join(path.dirname(cfgPath), 'ui-sessions.json'), auditPath: path.join(path.dirname(cfgPath), 'audit.jsonl'), configPath: cfgPath, log: () => {} })
  await new Promise((r) => ui.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${ui.server.address().port}`
  // 锚点抠不到就先关服务器再抛:否则心跳定时器让 node --test 永不退出,CI 静默挂死而不是变红(2026-09-07 踩过)
  const tokenMatch = (await (await fetch(base + '/')).text()).match(/let TOKEN='([a-f0-9]{32})'/)
  if (!tokenMatch) { ui.close(); throw new Error('页面里抠不到注入的令牌锚点') }
  const token = tokenMatch[1]
  const H = { 'x-sbot-token': token, 'content-type': 'application/json' }
  const call = (method, p, body) => fetch(base + p, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) })
  const userDir = path.join(home, '.sbot', 'design-styles')
  try { await run({ call, base, token, userDir, dir, cfgPath }) }
  finally { ui.close(); os.homedir = realHome; await rmTmpDir(dir); fs.rmSync(home, { recursive: true, force: true }) }
}

test('server: /api/design/preview 把表单编译成卡片(带图元表与角色四色),不落盘', async () => {
  await withServer(async ({ call, userDir }) => {
    const r = await call('POST', '/api/design/preview', { form: FORM })
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.card.name, '品牌紫')
    assert.deepEqual(j.card.roles, FORM.colors, '角色四色由服务端算好下发 —— 前端不该自己推')
    assert.ok(j.card.layout.rects.length > 10, '图元表必须在,否则前端没得画')
    assert.equal(fs.existsSync(userDir), false, '预览一个字节都不该落盘')
  })
})

test('server: /api/design/preview 吃得下半填的表单(边填边看,不许中途报错)', async () => {
  await withServer(async ({ call }) => {
    for (const form of [{}, null, { name: '只有名字' }, { colors: { bg: '乱写' } }]) {
      const r = await call('POST', '/api/design/preview', { form })
      assert.equal(r.status, 200, `半填表单 ${JSON.stringify(form)} 不该 4xx`)
      assert.ok((await r.json()).card.layout.rects.length > 10)
    }
  })
})

test('server: 保存 → 落进用户风格库 → GET 列得出来并标 user', async () => {
  await withServer(async ({ call, userDir }) => {
    const r = await call('POST', '/api/design/styles', { form: FORM, slug: 'brand-purple' })
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.deepEqual([j.ok, j.slug, j.replaced, j.shadowed], [true, 'brand-purple', false, false])
    const text = fs.readFileSync(path.join(userDir, 'brand-purple.md'), 'utf8')
    assert.equal(design.isStyleDoc(text), true)
    assert.deepEqual(Object.keys(design.parseStyleTokens(text).colors), ['bg', 'ink', 'accent', 'muted', 'line'])
    const list = (await (await call('GET', '/api/design/styles')).json()).styles
    const mine = list.find((s) => s.slug === 'brand-purple')
    assert.equal(mine.source, 'user')
    assert.equal(mine.name, '品牌紫')
    assert.deepEqual(mine.form.colors, FORM.colors, '卡片要带表单六项,「复制为新款」才预填得出来')
  })
})

test('server: 同名保存 409(带人话),勾了覆盖才 200 —— 被拒的那次不动已有文件', async () => {
  await withServer(async ({ call, userDir }) => {
    await call('POST', '/api/design/styles', { form: FORM, slug: 'dup' })
    const conflict = await call('POST', '/api/design/styles', { form: { ...FORM, name: '另一套' }, slug: 'dup' })
    assert.equal(conflict.status, 409)
    assert.match((await conflict.json()).error, /已经有「dup」/)
    assert.equal(design.parseStyleMeta(fs.readFileSync(path.join(userDir, 'dup.md'), 'utf8')).name, '品牌紫')
    const ok = await call('POST', '/api/design/styles', { form: { ...FORM, name: '另一套' }, slug: 'dup', overwrite: true })
    assert.equal(ok.status, 200)
    assert.equal((await ok.json()).replaced, true)
    assert.equal(design.parseStyleMeta(fs.readFileSync(path.join(userDir, 'dup.md'), 'utf8')).name, '另一套')
  })
})

test('server: 与内置同名 = 遮蔽(200 + shadowed),删掉后内置自动回归', async () => {
  await withServer(async ({ call, userDir }) => {
    const builtin = design.listStyles({ builtinDir: design.BUILTIN_STYLES_DIR })[0].slug
    const r = await call('POST', '/api/design/styles', { form: { ...FORM, name: '我改的版本' }, slug: builtin })
    assert.equal(r.status, 200)
    assert.equal((await r.json()).shadowed, true, '遮蔽内置不是错误,但必须如实告知')
    let hit = (await (await call('GET', '/api/design/styles')).json()).styles.filter((s) => s.slug === builtin)
    assert.equal(hit.length, 1)
    assert.deepEqual([hit[0].source, hit[0].name], ['user', '我改的版本'])
    const d = await call('DELETE', '/api/design/styles', { slug: builtin })
    assert.equal(d.status, 200)
    assert.equal((await d.json()).revertedToBuiltin, true)
    assert.equal(fs.existsSync(path.join(userDir, builtin + '.md')), false)
    hit = (await (await call('GET', '/api/design/styles')).json()).styles.filter((s) => s.slug === builtin)
    assert.equal(hit[0].source, 'builtin', '删掉自定义之后同名内置那套要回来')
  })
})

test('server: 坏表单 / 坏标识 400,且不落盘;删不存在的那份也是 400 人话', async () => {
  await withServer(async ({ call, userDir }) => {
    for (const [body, re] of [
      [{ form: { ...FORM, name: '' }, slug: 'x1' }, /名称必填/],
      [{ form: { ...FORM, colors: { ...FORM.colors, accent: 'purple' } }, slug: 'x2' }, /#RRGGBB/],
      [{ form: FORM, slug: '../escape' }, /标识/],
      [{ form: FORM, slug: 'Upper' }, /标识/],
      [{ form: FORM, slug: '' }, /标识必填/],
    ]) {
      const r = await call('POST', '/api/design/styles', body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.match((await r.json()).error, re)
    }
    assert.equal(fs.existsSync(userDir) && fs.readdirSync(userDir).length > 0, false, '任何一次被拒都不许留下文件')
    const d = await call('DELETE', '/api/design/styles', { slug: 'never-existed' })
    assert.equal(d.status, 400)
    assert.match((await d.json()).error, /风格库里没有/)
  })
})

test('server: 五个新端点全部要 token(写路径没有一个能匿名调)', async () => {
  await withServer(async ({ base }) => {
    const J = { 'content-type': 'application/json' }
    for (const [method, p] of [['POST', '/api/design/preview'], ['POST', '/api/design/styles'],
      ['DELETE', '/api/design/styles'], ['POST', '/api/design/extract'], ['POST', '/api/design/collect']]) {
      const r = await fetch(base + p, { method, headers: J, body: '{}' })
      assert.equal(r.status, 401, `${method} ${p} 居然放行了匿名请求`)
    }
  })
})

test('server: /api/design/extract 认得出网址与绝对路径,认不出的给人话(不当成路径去 stat)', async () => {
  await withServer(async ({ call, dir }) => {
    const proj = path.join(dir, 'proj'); fs.mkdirSync(proj)
    fs.writeFileSync(path.join(proj, 'a.css'), 'body{background:#FAF9F6;color:#1A1A1A}.k{color:#C0392B}.b{border-radius:4px}')
    const r = await call('POST', '/api/design/extract', { ref: proj })
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.equal(j.evidence.source, 'dir')
    assert.equal(j.form.colors.bg, '#FAF9F6')
    assert.equal(j.form.rounded, 'subtle')
    assert.ok(j.evidence.colors.length, '证据必须带具体色,否则用户不知道它凭什么这么猜')
    for (const [ref, re] of [['', /先填一个参考/], ['relative/dir', /绝对路径/], ['ftp://x/y', /绝对路径|http/],
      [path.join(dir, 'no-such-dir'), /目录不存在/]]) {
      const bad = await call('POST', '/api/design/extract', { ref })
      assert.equal(bad.status, 400, ref)
      assert.match((await bad.json()).error, re)
    }
  })
})

// 网址侧是「服务器替我去取」的口子:不挡的话,一句「提炼这个网址」就能把这台机器变成跳板,
// 去够只听环回的本机服务、同网段的设备、云上的元数据端点。目录侧 2026-09-08 起与目录浏览、
// 保存绑定同一道项目根目录围栏(src/projectsroot.js)—— 此前敞开着,理由是「他本来就能开终端」,
// 但控制台已开到公网、围栏写在三处必漂,一处收紧另两处敞着等于没围。
test('server: /api/design/extract 网址侧只接公网 —— 本机/内网/元数据段一律 400;目录侧只接项目根目录之内', async () => {
  await withServer(async ({ call, dir }) => {
    for (const ref of ['http://127.0.0.1:9222/json', 'http://localhost:8080/', 'http://10.1.2.3/',
      'http://192.168.1.75/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]:9222/']) {
      const r = await call('POST', '/api/design/extract', { ref })
      assert.equal(r.status, 400, ref)
      assert.match((await r.json()).error, /本机或内网/, ref)
    }
    // 目录侧:根内照常提炼得出来(对照组);根外 400 且说清根在哪
    const proj = path.join(dir, 'proj2'); fs.mkdirSync(proj)
    fs.writeFileSync(path.join(proj, 'a.css'), 'body{background:#FAF9F6;color:#1A1A1A}')
    assert.equal((await call('POST', '/api/design/extract', { ref: proj })).status, 200)
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-dsg-out-'))
    fs.writeFileSync(path.join(outside, 'a.css'), 'body{background:#FAF9F6;color:#1A1A1A}')
    const r = await call('POST', '/api/design/extract', { ref: outside })
    assert.equal(r.status, 400)
    const err = (await r.json()).error
    assert.match(err, /项目根目录/); assert.ok(err.includes(dir), '要告诉人根在哪,不然他不知道该把项目放哪')
  })
})

test('server: /api/design/collect 把群项目里那份复制进全局库(可改名),项目里那份不动', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-dsgw-'))
  const wd = path.join(dir, 'proj'); fs.mkdirSync(wd)
  const original = design.composeStyleDoc({ ...FORM, name: '项目里那套' })
  fs.writeFileSync(path.join(wd, 'DESIGN.md'), original)
  await withServer(async ({ call, userDir }) => {
    const r = await call('POST', '/api/design/collect', { chatId: 'G', slug: 'house-style', name: '公司门面' })
    assert.equal(r.status, 200)
    const saved = fs.readFileSync(path.join(userDir, 'house-style.md'), 'utf8')
    assert.equal(design.parseStyleMeta(saved).name, '公司门面', '只有 name 该被换掉')
    assert.equal(design.parseStyleMeta(saved).description, FORM.description)
    assert.equal(saved.split('---')[2], original.split('---')[2], '正文必须逐字照抄')
    assert.equal(fs.readFileSync(path.join(wd, 'DESIGN.md'), 'utf8'), original, '项目里那份一个字节都不许动')
    // 第二次同名 ⇒ 409(与保存同一套冲突语义)
    assert.equal((await call('POST', '/api/design/collect', { chatId: 'G', slug: 'house-style' })).status, 409)
    assert.equal((await call('POST', '/api/design/collect', { chatId: 'G', slug: 'house-style', overwrite: true })).status, 200)
  }, { groups: { G: { workdir: wd, provider: 'claude' } } })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('server: collect 的三种「没什么可收」—— 群不存在 / 没绑目录 / 根上是架构文档', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-dsgw2-'))
  const empty = path.join(dir, 'empty'); fs.mkdirSync(empty)
  const arch = path.join(dir, 'arch'); fs.mkdirSync(arch)
  fs.writeFileSync(path.join(arch, 'DESIGN.md'), '# 架构设计\n\n## 1. 总览\n\ncolors: 正文里的不算\n')
  await withServer(async ({ call }) => {
    const a = await call('POST', '/api/design/collect', { chatId: 'NOPE', slug: 's1' })
    assert.equal(a.status, 404)
    const b = await call('POST', '/api/design/collect', { chatId: 'NOWD', slug: 's2' })
    assert.equal(b.status, 404)
    assert.match((await b.json()).error, /还没绑定项目目录/)
    // 架构文档不是风格档:认帧必须挡住,否则收进库的就是一份架构文档
    const c = await call('POST', '/api/design/collect', { chatId: 'ARCH', slug: 's3' })
    assert.equal(c.status, 404)
    assert.match((await c.json()).error, /还没有风格档/)
  }, { groups: { NOWD: { provider: 'claude' }, ARCH: { workdir: arch, provider: 'claude' }, E: { workdir: empty } } })
  fs.rmSync(dir, { recursive: true, force: true })
})

// ── 从参考提炼的三项增强(v0.11.21)在端点这一层的口径 ────────────────────────
// 这里只钉「透传」与「拦截」两件事:表单新长出来的字段必须**整个**交给 design.js
// (端点上不许有字段白名单,否则新字段静默丢在半路),越界的必须 400 且一个字节都不落盘。

test('server: preview 与保存都透传补充色与更多属性(端点上没有字段白名单)', async () => {
  await withServer(async ({ call, userDir }) => {
    const form = { ...FORM, extraColors: ['#0FA3B1', '#E55934'], extraTokens: { letterSpacing: 0.12, borderWidth: 3, spacingUnit: 4, headlineSize: 36, bodySize: 18, lineHeight: 1.4 } }
    const j = await (await call('POST', '/api/design/preview', { form })).json()
    assert.deepEqual(j.card.roles, FORM.colors, '补充色不许动四角色')
    assert.deepEqual(j.card.form.extraColors, ['#0FA3B1', '#E55934'])
    const plain = await (await call('POST', '/api/design/preview', { form: FORM })).json()
    assert.ok(j.card.layout.rects.length > plain.card.layout.rects.length, '补充色进了预览的色板条 ⇒ 图元比不给时多')

    assert.equal((await call('POST', '/api/design/styles', { form, slug: 'x1' })).status, 200)
    const doc = fs.readFileSync(path.join(userDir, 'x1.md'), 'utf8')
    assert.match(doc, /alt-1: "#0FA3B1"/)
    assert.match(doc, /alt-2: "#E55934"/)
    assert.match(doc, /letterSpacing: "0\.12em"/)
    assert.match(doc, /width: 3px/)
    assert.match(doc, /unit: 4px/)
    assert.match(doc, /fontSize: "36px"/)
    const spec = design.swatchSpec(doc)
    assert.equal(spec.titleScale, 2, '落盘那份自己就得能出图 —— 通道对不上说明写进去的和读出来的不是一回事')
  })
})

test('server: 补充色与更多属性越界 400,且一个字节都不落盘', async () => {
  await withServer(async ({ call, userDir }) => {
    const bads = [
      { extraColors: ['乱写'] },
      { extraColors: ['#111', '#222', '#333', '#444', '#555', '#666', '#777'] },
      { extraTokens: { letterSpacing: 0.9 } },
      { extraTokens: { borderWidth: 99 } },
      { extraTokens: { lineHeight: 9 } },
      { extraTokens: { headlineSize: 40 } },
    ]
    for (const patch of bads) {
      const r = await call('POST', '/api/design/styles', { form: { ...FORM, ...patch }, slug: 'bad' })
      assert.equal(r.status, 400, JSON.stringify(patch))
      const { error } = await r.json()
      assert.match(error, /[一-龥]{4,}/, '报错要是中文人话:' + error)
      assert.doesNotMatch(error, /Error|undefined|NaN|TypeError/, '不许把内部英文甩给人看:' + error)
    }
    assert.equal(fs.existsSync(path.join(userDir, 'bad.md')), false)
    // 对照组:同一条路走合法值必须 200 —— 否则上面那六条只是「什么都拒」
    assert.equal((await call('POST', '/api/design/styles', { form: { ...FORM, extraColors: ['#0FA3B1'], extraTokens: { borderWidth: 2 } }, slug: 'bad' })).status, 200)
  })
})

test('server: extract 回的 suggest 三样齐全(描述建议 / 补充色 / 更多属性)', async () => {
  await withServer(async ({ call, dir }) => {
    const proj = path.join(dir, 'ref-site')
    fs.mkdirSync(proj)
    fs.writeFileSync(path.join(proj, 'a.css'), `html,body{background:#0F1117;color:#E6E8EF}
      h1{font-size:40px;letter-spacing:.08em}
      p{font-size:16px;line-height:1.55;padding:16px;margin:24px}
      .card{border:2px solid #2A2F3A;border-radius:14px;padding:32px}
      .btn{background:#E8590C;padding:8px}.b2{color:#E8590C}.b3{color:#E8590C}
      .t{color:#4C6EF5}.t2{color:#4C6EF5}.g{color:#2A2F3A}`)
    const r = await call('POST', '/api/design/extract', { ref: proj })
    assert.equal(r.status, 200)
    const j = await r.json()
    assert.match(j.suggest.description, /深色底/)
    assert.match(j.suggest.description, /提自 ref-site/)
    assert.ok(!j.suggest.description.includes(dir), '出处只给目录名,不许把绝对路径回给前端')
    // #4C6EF5 是第二个强调蓝:不再被当成「次要文字色」(那一档要灰),归进补充色
    assert.deepEqual(j.suggest.extraColors, [{ hex: '#2A2F3A', count: 2 }, { hex: '#4C6EF5', count: 2 }])
    assert.deepEqual(j.suggest.extraTokens, { letterSpacing: 0.08, borderWidth: 2, spacingUnit: 8, lineHeight: 1.55, headlineSize: 40, bodySize: 16 })
    assert.equal(j.evidence.source, 'dir', '对照组:证据照旧在,suggest 是加出来的一份,不是换掉了它')
  })
})
