// 图标来源核对(design check 的第四条判据):**页面里的图标是不是从当前这套系统来的**。
//
// 由来 = 2026-08-25 真机:图标档写着 `system: pixelart`,而页面里的 `home` 与 Tabler 的 path
// 逐字一致(先按 Tabler 取过 sprite,换系统后没重取)。前三条判据全绿 —— 因为它们查的是
// 「画得对不对」,没有一条查「这张图打哪儿来」。更糟的一层:选了**填充型**系统时描边三项
// 会被 form 分流跳过,⇒ **选了填充型系统反而查不出来源错**。
//
// ⚠ 本文件每条断言都配**对照组**(同一个判据在正例上必须不响)—— 这条判据一旦误报,
//   整份交付报告就会被无视,那比不做还糟。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const design = require('../../src/design.js')

// spec 一律**走真实产出链**造:composeIconsDoc → parseIconsDoc → iconSpec。
// ⚠ 手工造 spec 是这一族栽过的坑(mock 与真实返回值漂移 ⇒ 判据在测试里永远命中)。
function specOf(system, tokens = {}) {
  const doc = design.parseIconsDoc(design.composeIconsDoc({ system }))
  assert.ok(doc && doc.system === system, `图标档没造出来:${system}`)
  return design.iconSpec(tokens, doc)
}

// 假图标库:名字 → svg 源文件文本。按库名分组,readFile 按路径反查。
function fakeLibs(map) {
  const files = new Map()
  const roots = {}
  for (const [lib, icons] of Object.entries(map)) {
    const def = design.ICON_LIBS[lib]
    assert.ok(def, `没有这个库:${lib}`)
    roots[lib] = '/fake/' + def.pkg
    for (const [name, svg] of Object.entries(icons)) {
      const d = def.dirs[0]
      files.set(path.join(roots[lib], d.dir, name + (d.suffix || '') + '.svg'), svg)
    }
  }
  return { roots, readFile: (abs) => (files.has(abs) ? files.get(abs) : null) }
}

const strokeSvg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${d}" /></svg>`
const fillSvg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="${d}" /></svg>`
// 页面里的一枚 sprite 图标 —— 与 iconSpriteSvg 产出的形状一致(**含那行许可注释**:真实产出
// 一定带着它,夹具少了它就等于每个用例都顺带在测「署名没了」,而那是另一条判据的事)
// ⚠ `id` 默认是我们自己出的 `i-<名字>`;真机产物用的是别家前缀(`p-house`)⇒ 那条用例显式传 id
const spritePage = (name, d, { lib = '', fill = 'currentColor', id = 'i-' + name, notice = '<!-- icons: Pixelarticons — MIT · Lucide — ISC · Tabler — MIT -->' } = {}) =>
  `<html><body><svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${notice}`
  + `<symbol id="${id}"${lib ? ` data-icon="${lib}/${name}"` : ''} viewBox="0 0 24 24" fill="${fill}">`
  + `<path d="${d}" /></symbol></svg>`
  + `<svg width="20" height="20" aria-hidden="true"><use href="#${id}"/></svg></body></html>`

const kinds = (findings, kind) => findings.filter((f) => f.kind === kind)

test('页面里认得出来源的图标:sprite 的 symbol 名 + data-icon 标记', () => {
  const refs = design.pageIconRefs(spritePage('home', 'M1 1h2', { lib: 'tabler' })
    + '<svg viewBox="0 0 24 24" data-icon="lucide/house"><path d="M3 3h1"/></svg>')
  assert.deepStrictEqual(refs.map((r) => r.name + '@' + r.lib), ['home@tabler', 'house@lucide'])
  assert.ok(refs.every((r) => r.geom), '几何指纹没算出来 —— 后面所有比对都会静默失效')
})

test('图标名来自页面 = 不可信输入,认不出的形状一律不收(它下一步要拼进文件路径)', () => {
  const bad = design.pageIconRefs('<svg viewBox="0 0 24 24" style="display:none"><symbol id="i-../../etc/passwd"><path d="M1 1"/></symbol></svg>')
  assert.deepStrictEqual(bad, [], '带路径的名字被收进来了')
  // 对照组:同一段结构换个合法名字必须收得到 —— 否则上面那个 deepStrictEqual 只是因为整条没跑
  const ok = design.pageIconRefs('<svg viewBox="0 0 24 24" style="display:none"><symbol id="i-home"><path d="M1 1"/></symbol></svg>')
  assert.strictEqual(ok.length, 1, '对照组也没收到 ⇒ 这个用例没有分辨力')
})

test('判据①:来源标记写着别家的库 ⇒ 报;写着兜底库 ⇒ 不报(走兜底是正路)', () => {
  const spec = specOf('tabler')   // 主库 tabler · 兜底 lucide
  const hit = design.checkIconSource([{ rel: 'a.html', text: spritePage('home', 'M1 1h2', { lib: 'pixelart' }) }], spec, null)
  assert.strictEqual(kinds(hit, 'icon-source').length, 1)
  assert.match(kinds(hit, 'icon-source')[0].sample[0].why, /Pixelarticons/)
  // 对照组两条:主库与兜底库都不许响
  for (const lib of ['tabler', 'lucide']) {
    const q = design.checkIconSource([{ rel: 'a.html', text: spritePage('home', 'M1 1h2', { lib }) }], spec, null)
    assert.strictEqual(kinds(q, 'icon-source').length, 0, `${lib} 被当成了别家的库`)
  }
})

test('判据②:名字在当前库里有,但图形对不上 ⇒ 报;逐字相同 ⇒ 不报', () => {
  const spec = specOf('pixelart')
  const { roots, readFile } = fakeLibs({ pixelart: { home: fillSvg('M0 0h4v4H0z') } })
  const lookup = design.iconLookup(roots, { readFile })
  const page = (d) => [{ rel: 'a.html', text: spritePage('home', d) }]
  assert.strictEqual(kinds(design.checkIconSource(page('M9 9h1'), spec, lookup), 'icon-source').length, 1)
  assert.strictEqual(kinds(design.checkIconSource(page('M0 0h4v4H0z'), spec, lookup), 'icon-source').length, 0, '同一张图被报成了来源不符')
})

test('判据③:当前系统里没这个名字,而图形与别家的同名图标逐字相同 ⇒ 它就是从那儿来的', () => {
  const spec = specOf('pixelart')   // 无兜底
  const { roots, readFile } = fakeLibs({ pixelart: { home: fillSvg('M0 0h4v4H0z') }, lucide: { star: strokeSvg('M7 7h3') } })
  const lookup = design.iconLookup(roots, { readFile })
  const hit = design.checkIconSource([{ rel: 'a.html', text: spritePage('star', 'M7 7h3') }], spec, lookup)
  assert.strictEqual(kinds(hit, 'icon-source').length, 1)
  assert.match(kinds(hit, 'icon-source')[0].sample[0].why, /Lucide/)
})

// ⭐ 真机打脸的那条:我们出的 sprite 是 `id="i-house"`,而交付的产物里 17 个 symbol 全是
//    `id="p-house"` —— agent 自己换了前缀。只认自家格式的话一个都认不出,而输出会是
//    「没有认得出来源的图标」,与「查过没问题」看起来一模一样。
test('别家起的 symbol 前缀也认得出(真机产物是 p-house,不是 i-house)', () => {
  const spec = specOf('pixelart')
  const { roots, readFile } = fakeLibs({ pixelart: { home: fillSvg('M0 0h4v4H0z') }, lucide: { house: strokeSvg('M7 7h3') } })
  const lookup = design.iconLookup(roots, { readFile })
  // 页面里那张与 Lucide 的 house 逐字相同 ⇒ 它就是从那儿来的(名字是剥前缀猜的,但几何是硬证据)
  const hit = design.checkIconSource([{ rel: 'a.html', text: spritePage('house', 'M7 7h3', { id: 'p-house' }) }], spec, lookup)
  assert.strictEqual(kinds(hit, 'icon-source').length, 1, 'p- 前缀的 sprite 没被认出来')
  assert.match(kinds(hit, 'icon-source')[0].sample[0].why, /Lucide/)
})

test('⚠ 猜出来的名字只认「几何逐字相同」这种正证据,绝不用来说「图形不一致」', () => {
  const spec = specOf('pixelart')
  // pixelart 里确实有 home,但页面里这张 `p-home` 与它不同、也不与任何别家相同 ⇒ 名字是猜的 ⇒ 不下结论
  const { roots, readFile } = fakeLibs({ pixelart: { home: fillSvg('M0 0h4v4H0z') } })
  const lookup = design.iconLookup(roots, { readFile })
  const guess = design.checkDesign([{ rel: 'a.html', text: spritePage('home', 'M9 9h9', { id: 'p-home' }) }], { colors: {} },
    { project: design.parseIconsDoc(design.composeIconsDoc({ system: 'pixelart' })), roots, readFile })
  assert.strictEqual(kinds(guess.findings, 'icon-source').length, 0, '拿猜出来的名字下了「图形不一致」的结论')
  assert.strictEqual(guess.iconSource.refs, 0, '没判出结论却算成「查过了」')
  assert.match(design.formatCheckReport(guess), /未核对/, '什么都没查动,却没说「没查」')
  // 对照组:同一张图换成可信名字(我们自己的 i- 前缀)必须报
  const trusted = design.checkIconSource([{ rel: 'a.html', text: spritePage('home', 'M9 9h9') }], spec, lookup)
  assert.strictEqual(kinds(trusted, 'icon-source').length, 1, '对照组也没响 ⇒ 上面那个 0 什么都没证明')
})

test('⚠ 名字哪个库里都没有 ⇒ 一个字都不报(项目自有图形:徽章 / logo)', () => {
  const spec = specOf('pixelart')
  const { roots, readFile } = fakeLibs({ pixelart: { home: fillSvg('M0 0h4v4H0z') } })
  const lookup = design.iconLookup(roots, { readFile })
  const own = design.checkIconSource([{ rel: 'a.html', text: spritePage('club-crest', 'M9 9h9') }], spec, lookup)
  assert.strictEqual(kinds(own, 'icon-source').length, 0, '项目自有图形被报了 —— 这类误报会让整份报告被丢掉')
  // 对照组:同一套输入里,库里有的那个名字必须照报(证明这次确实查了)
  const hit = design.checkIconSource([{ rel: 'a.html', text: spritePage('home', 'M9 9h9') }], spec, lookup)
  assert.strictEqual(kinds(hit, 'icon-source').length, 1, '对照组也没响 ⇒ 上面那条「不报」什么都没证明')
})

test('⚠ 判据③ 必须拿几何说话:只按名字判,会把「当前系统的库没装」误报成「取自别家」', () => {
  const spec = specOf('pixelart')
  // pixelart 没装(roots 里没有它)⇒ 只有 lucide 查得动;页面里那张的几何**与 lucide 的不同**
  const { roots, readFile } = fakeLibs({ lucide: { home: strokeSvg('M7 7h3') } })
  const lookup = design.iconLookup(roots, { readFile })
  const q = design.checkIconSource([{ rel: 'a.html', text: spritePage('home', 'M1 1h1') }], spec, lookup)
  assert.strictEqual(kinds(q, 'icon-source').length, 0, '只按名字就下了结论')
  // 对照组:几何真的一样时必须报
  const hit = design.checkIconSource([{ rel: 'a.html', text: spritePage('home', 'M7 7h3') }], spec, lookup)
  assert.strictEqual(kinds(hit, 'icon-source').length, 1)
})

test('判据④:填充型系统 + 页面里有描边型图标 ⇒ 报(这一维正是 form 分流放弃掉的那条)', () => {
  const stroked = `<html><body><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 1h2"/></svg></body></html>`
  const hit = design.checkIconSource([{ rel: 'a.html', text: stroked }], specOf('pixelart'), null)
  assert.strictEqual(kinds(hit, 'icon-form').length, 1, '填充型系统里的描边图标没被报出来')
  // 对照组:描边型系统里同一段文本一个字都不该说
  assert.strictEqual(kinds(design.checkIconSource([{ rel: 'a.html', text: stroked }], specOf('tabler'), null), 'icon-form').length, 0)
})

test('sprite 页面的线性/实心也要数得到 —— 只扫 <svg> 的话用了 sprite 就等于没查', () => {
  const sprite = '<svg style="display:none" aria-hidden="true">'
    + '<symbol id="i-a" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M1 1"/></symbol>'
    + '<symbol id="i-b" viewBox="0 0 24 24" fill="currentColor"><path d="M2 2"/></symbol></svg>'
  assert.deepStrictEqual(design.usedIcons(sprite).fill, { outline: 1, filled: 1 })
})

test('一个图标库都没装 ⇒ iconLookup 回 null,而不是一个恒空的函数', () => {
  assert.strictEqual(design.iconLookup({}, { readFile: () => null }), null)
  const { roots, readFile } = fakeLibs({ lucide: { home: strokeSvg('M1 1') } })
  const fn = design.iconLookup(roots, { readFile })
  assert.ok(typeof fn === 'function' && fn.libs.includes('lucide'), '装了库反而没给出查找器')
})

test('没选图标系统 ⇒ 这一条整条不测(没依据就不报)', () => {
  const spec = design.iconSpec({ icons: { style: 'outlined' } }, null)   // 风格档有 icons 段、项目没有图标档
  assert.ok(spec && !spec.system)
  assert.deepStrictEqual(design.checkIconSource([{ rel: 'a.html', text: spritePage('home', 'M1 1', { lib: 'pixelart' }) }], spec, null), [])
})

// ⚠ 「零告警」与「压根没查」在报告上长得一模一样 —— 这一维的沉默有三种成因,三种都要说得出口
test('报告如实交代「没查」:三种成因各一句话,而查过没发现时一句都不多', () => {
  const tokens = { colors: { primary: '#1B6B37' } }
  const doc = design.parseIconsDoc(design.composeIconsDoc({ system: 'pixelart' }))
  const { roots, readFile } = fakeLibs({ pixelart: { home: fillSvg('M0 0h4v4H0z') } })
  const page = [{ rel: 'a.html', text: spritePage('home', 'M0 0h4v4H0z') }]

  // ⚠ 「风格档写了 icons 段(画法)、项目却没选图标系统(图形从哪来)」是真实存在的一档 ——
  //   整类没启用时上面那句「未启用图标体系」已经说完了,这一句不该跟着重复
  const noSystem = design.checkDesign(page, { ...tokens, icons: { style: 'outlined' } }, { project: null, roots, readFile })
  assert.match(design.formatCheckReport(noSystem), /还没选图标系统/)

  const noLib = design.checkDesign(page, tokens, { project: doc, roots: {}, readFile })
  assert.match(design.formatCheckReport(noLib), /只核对了一半/)

  // 页面里**有图标**、但一个都认不出来源(手写的 svg,没名字没标记)
  const noRefs = design.checkDesign([{ rel: 'a.html', text: '<html><body><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M1 1h2"/></svg></body></html>' }], tokens, { project: doc, roots, readFile })
  assert.match(design.formatCheckReport(noRefs), /没有认得出来源的图标/)

  // ⚠ 对照组:页面里**压根没有图标**时一个字都不许说 —— 否则纯 CSS 交付、不用图标的项目
  //    每次检查都会多出这一行,那是常驻噪音(报告一变噪音就没人看了)
  const noIcons = design.checkDesign([{ rel: 'a.css', text: '.x{color:#1B6B37}' }], tokens, { project: doc, roots, readFile })
  assert.doesNotMatch(design.formatCheckReport(noIcons), /未核对|只核对了一半/, '没有图标的文件也被说了一句「没查」')

  // 对照组:真查过且没发现时,上面三句一句都不许冒出来(否则那三句就是恒定的噪音)
  const clean = design.checkDesign(page, tokens, { project: doc, roots, readFile })
  const txt = design.formatCheckReport(clean)
  assert.doesNotMatch(txt, /未核对|只核对了一半/, '查过没发现却还在说没查')
  assert.strictEqual(clean.findings.length, 0)
  // refs 是**真判出结论的个数**,也进 --json 给调用方用 ⇒ 数得准不准要有人管(页面里就一个图标)
  assert.strictEqual(clean.iconSource.refs, 1)
})

// 许可署名:2026-08-25 真机上,我们出的 sprite 带着 `<!-- icons: Tabler — MIT -->`,而交付的
// 页面里**一条注释都没有**(实测 grep <!-- 为空)。Lucide 是 ISC、其余 MIT,都要求副本保留声明。
test('sprite 的许可声明被删掉 ⇒ 报;还在 ⇒ 不报', () => {
  const spec = specOf('pixelart')
  const { roots, readFile } = fakeLibs({ pixelart: { home: fillSvg('M0 0h4v4H0z') } })
  const lookup = design.iconLookup(roots, { readFile })
  const page = (notice) => [{ rel: 'a.html', text: spritePage('home', 'M0 0h4v4H0z', { notice }) }]
  const gone = design.checkDesign(page(''), { colors: {} }, { project: design.parseIconsDoc(design.composeIconsDoc({ system: 'pixelart' })), roots, readFile })
  assert.strictEqual(kinds(gone.findings, 'icon-license').length, 1, '注释被删了却没人吭声')
  assert.match(design.formatCheckReport(gone), /Pixelarticons — MIT/)
  // 对照组:注释还在就一个字都不说
  const kept = design.checkDesign(page('<!-- icons: Pixelarticons — MIT -->'), { colors: {} }, { project: design.parseIconsDoc(design.composeIconsDoc({ system: 'pixelart' })), roots, readFile })
  assert.strictEqual(kinds(kept.findings, 'icon-license').length, 0)
})

test('⚠ 许可这条只对 sprite 成立 —— 单图标形态从来没带过署名,拿它要求署名就是凭空指控', () => {
  // ⚠ 必须走 checkDesign 这条真路:判据本身对不对,与「调用方把哪一份清单交给它」是两件事,
  //    而恰恰是后者会漂(直接调 iconLicenseGap 的话,把 sprite 换成 libs 的变异杀不死)。
  const doc = design.parseIconsDoc(design.composeIconsDoc({ system: 'pixelart' }))
  const run = (text) => design.checkDesign([{ rel: 'a.html', text }], { colors: {} }, { project: doc, roots: {}, readFile: () => null })
  const inline = `<html><body><svg width="20" height="20" viewBox="0 0 24 24" data-icon="pixelart/home" fill="currentColor" aria-hidden="true"><path d="M0 0h4v4H0z"/></svg></body></html>`
  assert.strictEqual(kinds(run(inline).findings, 'icon-license').length, 0, '单图标形态被要求署名了')
  // 对照组:同一张图换成 sprite 形态(且无注释)必须报 —— 否则上面那个 0 什么都没证明
  assert.strictEqual(kinds(run(spritePage('home', 'M0 0h4v4H0z', { lib: 'pixelart', notice: '' })).findings, 'icon-license').length, 1)
})

// 产出侧:**取图标时留下的那个指纹**。没有它,判据① 整条就是死代码 —— 而① 是库没装时
// 唯一还成立的一条(检查器只能发现不一致,"能发现"这件事本身要靠产出时留下的东西)。
test('取出来的图标自带来源指纹:单图标写在 svg 上,sprite 写在每个 symbol 上', () => {
  const spec = specOf('tabler')
  const one = design.normalizeIconSvg(strokeSvg('M1 1h2'), spec, { source: 'tabler/home' })
  assert.match(one, /data-icon="tabler\/home"/)
  // 对照组:不给来源就一个字节都不多(内置预览/样张走的正是这条路)
  assert.doesNotMatch(design.normalizeIconSvg(strokeSvg('M1 1h2'), spec, {}), /data-icon/)

  const sprite = design.iconSpriteSvg([{ lib: 'tabler', name: 'home', svg: strokeSvg('M1 1h2') }], spec)
  assert.match(sprite, /<symbol id="i-home" data-icon="tabler\/home"/)
  // 认得回来才算数:自己产出的东西,自己的检查器必须读得出来源
  assert.deepStrictEqual(design.pageIconRefs(sprite).map((r) => r.lib), ['tabler'])
})

// ⭐ 这一条盯的是**接线**,不是判据:`roots` 没从 CLI 传进去的话,上面所有用例照样全绿,
//    而真机上这条判据一次都不会跑(同一族已经栽过一次 —— checkDesign 的 project 参数)。
test('真跑一次 CLI:换了图标系统的页面必须被报出来(对照组 = 没换的那份)', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-iconsrc-'))
  try {
    // 假图标库 + 指过去的配置 —— CI 上没装真库,靠 design.iconsDir 这条 operator 用的路
    const libDir = path.join(cwd, 'libs', design.ICON_LIBS.pixelart.pkg, design.ICON_LIBS.pixelart.dirs[0].dir)
    fs.mkdirSync(libDir, { recursive: true })
    fs.writeFileSync(path.join(libDir, 'home.svg'), fillSvg('M0 0h4v4H0z'))
    fs.writeFileSync(path.join(cwd, 'sbot.config.json'), JSON.stringify({ design: { iconsDir: path.join(cwd, 'libs') } }))
    fs.writeFileSync(path.join(cwd, 'DESIGN.md'), '---\nname: "测试风格"\ncolors:\n  primary: "#1B6B37"\n---\n\n# 测试\n')
    fs.mkdirSync(path.join(cwd, 'design'), { recursive: true })
    fs.writeFileSync(path.join(cwd, 'design', 'icons.md'), design.composeIconsDoc({ system: 'pixelart' }))
    fs.writeFileSync(path.join(cwd, 'bad.html'), spritePage('home', 'M9 9h9'))
    fs.writeFileSync(path.join(cwd, 'good.html'), spritePage('home', 'M0 0h4v4H0z'))

    const run = (f) => spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'sbot.js'), 'design', 'check', f], {
      cwd, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, SBOT_CONFIG: path.join(cwd, 'sbot.config.json'), NO_COLOR: '1' },
    })
    const bad = run('bad.html')
    assert.match(bad.stdout, /图标来源不符/, `CLI 没报出来:${bad.stdout}${bad.stderr}`)
    assert.strictEqual(bad.status, 3, '有偏离要退出码 3')
    const good = run('good.html')
    assert.doesNotMatch(good.stdout, /图标来源不符|未核对/, `同一条路上正例被误报:${good.stdout}`)
    assert.strictEqual(good.status, 0)

    // 同一条真实路径上的产出侧:取图标时**真的**把来源指纹落进去了吗(bin 少传一个字段,
    // 上面那些纯函数用例照样全绿,而页面里从此一个指纹都没有)
    const icon = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'sbot.js'), 'design', 'icon', 'home'], {
      cwd, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, SBOT_CONFIG: path.join(cwd, 'sbot.config.json'), NO_COLOR: '1' },
    })
    assert.strictEqual(icon.status, 0, `取图标失败:${icon.stderr}`)
    assert.match(icon.stdout, /data-icon="pixelart\/home"/, `取出来的图标没带来源指纹:${icon.stdout}`)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
