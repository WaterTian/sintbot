// 设计风格档(src/design.js)—— 纯逻辑四块:
//   parseStyleMeta      front matter 里的 name/description(极简行扫描,值可能带引号)
//   isStyleDoc          「风格档」vs「同名架构文档」的认帧 —— 落盘前的安全阀,错认=覆盖别人的文档
//   listStyles          内置 + 用户预设合并(同 slug 用户覆盖内置)
//   resolveStyleTarget  落盘目标裁决(根被架构文档占用则退 design/DESIGN.md;force 才覆盖)
//   extractPalette      参考图主色统计(经 encodePngRGBA/decodePngRGBA 走一遍真实解码路径)
// 风格可视化(v0.9.2)另四块:
//   parseStyleTokens    front matter 完整 tokens(极简 YAML 子集,按缩进建树)
//   styleRoles          colors → bg/ink/accent/muted/line 五角色(键名命中 + 亮度/彩度兜底)
//   swatchSpec/Layout   tokens → 图元表(两端共用:控制台画 SVG、群图光栅成 PNG)
//   renderSwatchSheet   RGBA 平面(经 encodePngRGBA 走真实编码;像素采样验颜色真落对了)
// 预设内容(assets/design-styles)由另一路维护,这里一律用临时目录自造,不依赖其真实内容 ——
// 唯一的例外是文末那组内置预设回归网(全能出图标 / 场景标签 / **几何指纹两两不同**),
// 它们就是要盯住真实预设别被改坏。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parseStyleMeta, isStyleDoc, listStyles, findStyleDoc, resolveStyleTarget, extractPalette,
  parseStyleTokens, styleRoles, swatchSpec, swatchLayout, renderSwatchSheet, styleCard, projectStyleCard,
  swatchRoleReport, SWATCH_ROLE_HINT,
  allStyles, BUILTIN_STYLES_DIR, PILL, CARD_W, CARD_H } = require('../../src/design')
const { encodePngRGBA, decodePngRGBA } = require('../../src/platform/board')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-design-'))

const styleDoc = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\ncolors:\n  bg: "#FFFFFF"\n  ink: "#172033"\n---\n\n# 风格\n\n正文。\n`

// ── parseStyleMeta ───────────────────────────────────────────────────────────

test('parseStyleMeta:裸值 / 双引号 / 单引号都取到,值里的冒号不被截断', () => {
  const text = '---\nname: "极简 · 黑白"\ndescription: \'干净、留白多:排版驱动\'\ncolors:\n  bg: "#fff"\n---\n正文\n'
  assert.deepEqual(parseStyleMeta(text), { name: '极简 · 黑白', description: '干净、留白多:排版驱动', suits: '', platform: '' })
})

test('parseStyleMeta:缺字段给空串,不编内容', () => {
  assert.deepEqual(parseStyleMeta('---\ncolors:\n  bg: "#fff"\n---\n'), { name: '', description: '', suits: '', platform: '' })
})

test('parseStyleMeta:没有 front matter ⇒ 两个空串(不去正文里瞎猜)', () => {
  assert.deepEqual(parseStyleMeta('# 架构设计\n\nname: 不算\n'), { name: '', description: '', suits: '', platform: '' })
})

test('parseStyleMeta:只认行首顶层键,缩进的同名子键不算', () => {
  const text = '---\ntypography:\n  name: Inter\nname: 主名\ncolors:\n  bg: "#fff"\n---\n'
  assert.equal(parseStyleMeta(text).name, '主名')
})

// ── isStyleDoc(认帧:错认=覆盖掉别人的文档)──────────────────────────────────

test('isStyleDoc:front matter 里有顶层 colors ⇒ 真', () => {
  assert.equal(isStyleDoc(styleDoc('极简', '干净')), true)
})

test('isStyleDoc:项目架构文档(同名 DESIGN.md,无 front matter)⇒ 假', () => {
  assert.equal(isStyleDoc('# sbot 架构设计\n\n## 1. 总览\n\ncolors: 这行在正文里,不算\n'), false)
})

test('isStyleDoc:有 front matter 但没有 colors(例如普通文档的元信息)⇒ 假', () => {
  assert.equal(isStyleDoc('---\ntitle: 方案\nauthor: me\n---\n正文\n'), false)
})

test('isStyleDoc:围栏没闭合 ⇒ 假(宁可漏认,不可错认)', () => {
  assert.equal(isStyleDoc('---\ncolors:\n  bg: "#fff"\n\n还没闭合\n'), false)
})

test('isStyleDoc:缩进的 colors 不算顶层 token', () => {
  assert.equal(isStyleDoc('---\ntheme:\n  colors: x\n---\n'), false)
})

// ── listStyles ───────────────────────────────────────────────────────────────

test('listStyles:两目录合并、同 slug 用户级覆盖内置、自定义排在最前', () => {
  const root = tmp()
  const builtinDir = path.join(root, 'builtin'); const userDir = path.join(root, 'user')
  fs.mkdirSync(builtinDir); fs.mkdirSync(userDir)
  fs.writeFileSync(path.join(builtinDir, 'zen.md'), styleDoc('禅意', '内置版'))
  fs.writeFileSync(path.join(builtinDir, 'bold.md'), styleDoc('浓烈', '大字重高对比'))
  fs.writeFileSync(path.join(userDir, 'zen.md'), styleDoc('禅意(我的)', '自定义版'))
  fs.writeFileSync(path.join(userDir, 'notes.txt'), 'ignored') // 非 .md 不列
  const list = listStyles({ builtinDir, userDir })
  assert.deepEqual(list.map((s) => s.slug), ['zen', 'bold']) // zen 是自定义(覆盖了同名内置)⇒ 排前
  assert.equal(list[0].source, 'user')
  assert.equal(list[0].name, '禅意(我的)')
  assert.equal(list[0].description, '自定义版')
  assert.equal(list[0].path, path.join(userDir, 'zen.md'))
  assert.equal(list[1].source, 'builtin')
})

// 次序是**产品判断**不是实现细节:自定义那两三套是 operator 最常用的,按字母混进十几种内置
// 里就得逐个找。两个消费者(控制台分组渲染 / CLI 场景分组)共用这一份次序,故钉在这里。
test('listStyles:自定义整组在前,组内各自按 slug', () => {
  const root = tmp()
  const builtinDir = path.join(root, 'builtin'); const userDir = path.join(root, 'user')
  fs.mkdirSync(builtinDir); fs.mkdirSync(userDir)
  for (const s of ['alpha', 'mid', 'zulu']) fs.writeFileSync(path.join(builtinDir, s + '.md'), styleDoc(s, '内置'))
  for (const s of ['brand', 'yak']) fs.writeFileSync(path.join(userDir, s + '.md'), styleDoc(s, '自定义'))
  assert.deepEqual(listStyles({ builtinDir, userDir }).map((s) => s.slug), ['brand', 'yak', 'alpha', 'mid', 'zulu'])
})

test('listStyles:目录不存在安全返回 []', () => {
  const root = tmp()
  assert.deepEqual(listStyles({ builtinDir: path.join(root, 'nope'), userDir: path.join(root, 'also-nope') }), [])
  assert.deepEqual(listStyles({}), [])
})

test('listStyles:name 缺失时退回 slug(列表不能出空白列)', () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'nameless.md'), '---\ncolors:\n  bg: "#fff"\n---\n')
  const [s] = listStyles({ builtinDir: root })
  assert.equal(s.name, 'nameless')
  assert.equal(s.description, '')
})

// ── resolveStyleTarget ───────────────────────────────────────────────────────

// readFile 注入:字符串 map ⇒ 存在;缺键 ⇒ null(不存在)
const fakeRead = (files) => (abs) => (Object.prototype.hasOwnProperty.call(files, abs) ? files[abs] : null)

const CWD = path.resolve('/proj')
const ROOT_DOC = path.join(CWD, 'DESIGN.md')
const FALLBACK_DOC = path.join(CWD, 'design', 'DESIGN.md')

test('resolveStyleTarget:干净项目 ⇒ 落项目根 DESIGN.md,无降级说明', () => {
  const r = resolveStyleTarget({ cwd: CWD, readFile: fakeRead({}) })
  assert.equal(r.path, ROOT_DOC)
  assert.equal(r.note, '')
})

test('resolveStyleTarget:根 DESIGN.md 是架构文档 ⇒ 退 design/DESIGN.md,note 说明为什么', () => {
  const r = resolveStyleTarget({ cwd: CWD, readFile: fakeRead({ [ROOT_DOC]: '# 架构设计\n\n## 总览\n' }) })
  assert.equal(r.path, FALLBACK_DOC)
  assert.match(r.note, /架构文档/)
})

test('resolveStyleTarget:已有风格档 ⇒ 拒绝(要 --force),force 放行且 note 标明覆盖', () => {
  const files = { [ROOT_DOC]: styleDoc('禅意', '干净') }
  assert.throws(() => resolveStyleTarget({ cwd: CWD, readFile: fakeRead(files) }), /--force/)
  const r = resolveStyleTarget({ cwd: CWD, force: true, readFile: fakeRead(files) })
  assert.equal(r.path, ROOT_DOC)
  assert.match(r.note, /覆盖/)
})

test('resolveStyleTarget:force 也不覆盖架构文档 —— 仍退到 design/DESIGN.md', () => {
  const r = resolveStyleTarget({ cwd: CWD, force: true, readFile: fakeRead({ [ROOT_DOC]: '# 架构设计\n' }) })
  assert.equal(r.path, FALLBACK_DOC)
})

test('resolveStyleTarget:根是架构文档且降级点已有风格档 ⇒ 无 force 拒绝、force 放行', () => {
  const files = { [ROOT_DOC]: '# 架构设计\n', [FALLBACK_DOC]: styleDoc('禅意', '干净') }
  assert.throws(() => resolveStyleTarget({ cwd: CWD, readFile: fakeRead(files) }), /--force/)
  const r = resolveStyleTarget({ cwd: CWD, force: true, readFile: fakeRead(files) })
  assert.equal(r.path, FALLBACK_DOC)
})

test('resolveStyleTarget:两个落点都被非风格档占用 ⇒ 中文报错让人用 --out 另指', () => {
  const files = { [ROOT_DOC]: '# 架构设计\n', [FALLBACK_DOC]: '# 设计说明(不是风格档)\n' }
  assert.throws(() => resolveStyleTarget({ cwd: CWD, readFile: fakeRead(files) }), /--out/)
})

test('resolveStyleTarget:--out 走围栏 —— 相对路径放行,绝对路径 / .. 一律拒', () => {
  const r = resolveStyleTarget({ cwd: CWD, out: path.join('design', 'style.md'), readFile: fakeRead({}) })
  assert.equal(r.path, path.join(CWD, 'design', 'style.md'))
  assert.throws(() => resolveStyleTarget({ cwd: CWD, out: path.join(CWD, 'x.md'), readFile: fakeRead({}) }), /绝对路径/)
  assert.throws(() => resolveStyleTarget({ cwd: CWD, out: '../x.md', readFile: fakeRead({}) }), /'\.\.'/)
  assert.throws(() => resolveStyleTarget({ cwd: CWD, out: 'a/../../x.md', readFile: fakeRead({}) }), /'\.\.'/)
})

test('resolveStyleTarget:--out 指到非风格档 ⇒ 连 --force 也拒(force 只换风格档,不清别的文件)', () => {
  const files = { [path.join(CWD, 'README.md')]: '# 说明文档\n' }
  for (const force of [false, true]) {
    assert.throws(() => resolveStyleTarget({ cwd: CWD, out: 'README.md', force, readFile: fakeRead(files) }), /不是风格档/)
  }
  // 只读群里的 agent 也能跑本命令 ⇒ 「--force 写任意路径」的覆盖通道必须堵死(扩展名 + 认帧双闸)
  const src = { [path.join(CWD, 'src', 'app.js')]: 'module.exports = 1\n' }
  assert.throws(() => resolveStyleTarget({ cwd: CWD, out: 'src/app.js', force: true, readFile: fakeRead(src) }), /只能写 \.md/)
})

test('resolveStyleTarget:--out 指到已有风格档 ⇒ 无 force 拒、有 force 放行', () => {
  const abs = path.join(CWD, 'design', 'brand.md')
  const files = { [abs]: styleDoc('旧档', '换掉它') }
  assert.throws(() => resolveStyleTarget({ cwd: CWD, out: 'design/brand.md', readFile: fakeRead(files) }), /--force/)
  const r = resolveStyleTarget({ cwd: CWD, out: 'design/brand.md', force: true, readFile: fakeRead(files) })
  assert.equal(r.path, abs)
  assert.match(r.note, /覆盖/)
})

test('resolveStyleTarget:--out 非 .md 一律拒(风格档就是 Markdown;顺带挡掉覆盖任意文件的通道)', () => {
  assert.throws(() => resolveStyleTarget({ cwd: CWD, out: 'src/app.js', readFile: fakeRead({}) }), /只能写 \.md/)
  assert.throws(() => resolveStyleTarget({ cwd: CWD, out: 'style', readFile: fakeRead({}) }), /只能写 \.md/)
  assert.equal(resolveStyleTarget({ cwd: CWD, out: 'docs/STYLE.MD', readFile: fakeRead({}) }).path, path.join(CWD, 'docs', 'STYLE.MD'))
})

test('resolveStyleTarget:根不存在但退档位已有风格档 ⇒ 沿用退档位(不在根另立第二份让旧档成孤儿)', () => {
  const files = { [FALLBACK_DOC]: styleDoc('禅意', '干净') }
  assert.throws(() => resolveStyleTarget({ cwd: CWD, readFile: fakeRead(files) }), /--force/)
  const r = resolveStyleTarget({ cwd: CWD, force: true, readFile: fakeRead(files) })
  assert.equal(r.path, FALLBACK_DOC)
  assert.match(r.note, /沿用既有风格档位置/)
})

test('resolveStyleTarget:根不存在、退档位是普通文档 ⇒ 照落根(退档位只在「已是风格档」时才优先)', () => {
  const r = resolveStyleTarget({ cwd: CWD, readFile: fakeRead({ [FALLBACK_DOC]: '# 设计说明\n' }) })
  assert.equal(r.path, ROOT_DOC)
})

test('resolveStyleTarget:读不动目标(EACCES 等)⇒ 抛错拒绝继续,绝不当「不存在」覆盖掉', () => {
  const boom = () => { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e }
  assert.throws(() => resolveStyleTarget({ cwd: CWD, readFile: boom }), /permission denied/)
  assert.throws(() => resolveStyleTarget({ cwd: CWD, out: 'design/x.md', force: true, readFile: boom }), /permission denied/)
})

test('resolveStyleTarget:真实文件系统上的默认 readFile —— 不可读文件 fail-closed,不存在才放行', () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'DESIGN.md'), '# 架构设计\n')
  fs.chmodSync(path.join(root, 'DESIGN.md'), 0o000)
  try {
    if (process.getuid && process.getuid() === 0) return // root 无视权限位,这条断言在 root 下无意义
    assert.throws(() => resolveStyleTarget({ cwd: root }), /无法判断它是不是风格档/)
  } finally { fs.chmodSync(path.join(root, 'DESIGN.md'), 0o644) }
  const clean = tmp() // 同一条默认路径上,「文件不存在」照常放行(ENOENT 才是「没有」)
  assert.equal(resolveStyleTarget({ cwd: clean }).path, path.join(clean, 'DESIGN.md'))
})

// ── findStyleDoc(生图后端拿到的就是它 —— 必须与落盘裁决认同一套帧)────────────────────

test('findStyleDoc:根是风格档 ⇒ 根;根是架构文档而退档位是风格档 ⇒ 退档位', () => {
  assert.equal(findStyleDoc({ cwd: CWD, readFile: fakeRead({ [ROOT_DOC]: styleDoc('禅意', 'x') }) }), ROOT_DOC)
  assert.equal(findStyleDoc({ cwd: CWD, readFile: fakeRead({ [ROOT_DOC]: '# 架构设计\n', [FALLBACK_DOC]: styleDoc('禅意', 'x') }) }), FALLBACK_DOC)
})

test('findStyleDoc:退档位存在但不是风格档 ⇒ null(不把架构文档喂给生图后端)', () => {
  assert.equal(findStyleDoc({ cwd: CWD, readFile: fakeRead({ [ROOT_DOC]: '# 架构设计\n', [FALLBACK_DOC]: '# 设计说明\n' }) }), null)
  assert.equal(findStyleDoc({ cwd: CWD, readFile: fakeRead({}) }), null)
})

test('findStyleDoc:读不动就当没有(生图是增强,不该被一个读不了的文件堵死)', () => {
  const boom = () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e }
  assert.equal(findStyleDoc({ cwd: CWD, readFile: boom }), null)
})

// ── extractPalette(合成 PNG → 真实解码 → 统计)────────────────────────────────

// 按 (x,y) 取色的画布 → PNG buffer → decodePngRGBA(与 CLI 走同一条解码路径)
function synth(w, h, colorAt) {
  const px = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = colorAt(x, y)
      const o = (y * w + x) * 4
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a
    }
  }
  const d = decodePngRGBA(encodePngRGBA(px, w, h))
  assert.ok(d, 'PNG 往返解码应成功')
  return d
}

test('extractPalette:纯色图 ⇒ 单一主色、占比 100%,中性色为空', () => {
  const d = synth(64, 64, () => [0x4a, 0x90, 0xd9])
  const p = extractPalette(d.px, d.width, d.height)
  assert.equal(p.colors.length, 1)
  assert.equal(p.colors[0].hex, '#4A90D9')
  assert.equal(Math.round(p.colors[0].share * 100), 100)
  assert.deepEqual(p.neutrals, [])
})

test('extractPalette:双色分块 ⇒ 按占比排序,share 反映真实比例', () => {
  // 左 3/4 品红,右 1/4 橄榄绿(都远离白/黑/灰,不会被归进中性色)
  const d = synth(100, 40, (x) => (x < 75 ? [0xc0, 0x2a, 0x6b] : [0x3d, 0x8b, 0x2f]))
  const p = extractPalette(d.px, d.width, d.height)
  assert.deepEqual(p.colors.map((c) => c.hex), ['#C02A6B', '#3D8B2F'])
  assert.equal(Math.round(p.colors[0].share * 100), 75)
  assert.equal(Math.round(p.colors[1].share * 100), 25)
})

test('extractPalette:白底大图 ⇒ 白进中性色不进主色,主色仍是那一小块强调色(大图走 stride 采样)', () => {
  const d = synth(600, 600, (x, y) => (x < 120 && y < 120 ? [0xcc, 0x22, 0x22] : [0xff, 0xff, 0xff]))
  const p = extractPalette(d.px, d.width, d.height)
  assert.equal(p.colors[0].hex, '#CC2222')
  assert.ok(!p.colors.some((c) => c.hex === '#FFFFFF'), '白色不该出现在主色里')
  assert.equal(p.neutrals[0].hex, '#FFFFFF')
  assert.ok(p.neutrals[0].share > 0.9)
  assert.ok(Math.abs(p.colors[0].share - 0.04) < 0.01, '强调色约占 4%')
})

test('extractPalette:近黑与低饱和灰归中性色;透明像素不计入分母', () => {
  // 上半:近黑;下半:低饱和灰;右四分之一整列透明(α=0,不参与统计)
  const d = synth(40, 40, (x, y) => (x >= 30 ? [0, 0, 255, 0] : (y < 20 ? [0x08, 0x08, 0x0a] : [0x88, 0x8c, 0x90])))
  const p = extractPalette(d.px, d.width, d.height)
  assert.deepEqual(p.colors, [], '全是中性色 ⇒ 没有主色')
  assert.equal(p.neutrals.length, 2)
  for (const nlist of p.neutrals) assert.ok(Math.abs(nlist.share - 0.5) < 0.02, '分母是有效采样点,透明列不算')
})

test('extractPalette:1px 竖条纹大图 —— 跨步与行宽互素,不会整列漏采(采成纯色)', () => {
  // 600 宽 ⇒ 采样跨步本会取 2,与宽有公因子 ⇒ 只采偶数列 ⇒ 红色被采成 100%(蓝色整列蒸发)
  const d = synth(600, 600, (x) => (x % 2 === 0 ? [0xd0, 0x20, 0x20] : [0x20, 0x20, 0xd0]))
  const p = extractPalette(d.px, d.width, d.height)
  assert.equal(p.colors.length, 2, '两种条纹都要被采到')
  for (const c of p.colors) assert.ok(Math.abs(c.share - 0.5) < 0.05, `条纹占比应各约一半,实际 ${c.hex} ${c.share}`)
})

test('extractPalette:--n 截断主色个数', () => {
  // 6 条互不相邻的彩色横带 → 只取前 2
  const bands = [[0xd0, 0x20, 0x20], [0x20, 0xd0, 0x20], [0x20, 0x20, 0xd0], [0xd0, 0xd0, 0x20], [0xd0, 0x20, 0xd0], [0x20, 0xd0, 0xd0]]
  const d = synth(60, 60, (x, y) => bands[Math.min(5, Math.floor(y / 10))])
  assert.equal(extractPalette(d.px, d.width, d.height).colors.length, 6)
  assert.equal(extractPalette(d.px, d.width, d.height, { n: 2 }).colors.length, 2)
})

// ── parseStyleTokens ─────────────────────────────────────────────────────────

test('parseStyleTokens:按缩进建树 —— 两层嵌套、标量去引号、顶层键并列', () => {
  const t = parseStyleTokens('---\nname: 甲\ncolors:\n  bg: "#FFF"\n  ink: \'#111\'\ntypography:\n  headline:\n    fontFamily: "A, B"\n    fontWeight: 700\nspacing:\n  unit: 8px\n---\n正文\n')
  assert.equal(t.name, '甲')
  assert.deepEqual(t.colors, { bg: '#FFF', ink: '#111' })
  assert.deepEqual(t.typography.headline, { fontFamily: 'A, B', fontWeight: '700' })
  assert.equal(t.spacing.unit, '8px')
})

test('parseStyleTokens:没 front matter ⇒ {};注释与空行跳过;不吃的语法(数组续行)不致整体失败', () => {
  assert.deepEqual(parseStyleTokens('# 架构文档\n\n正文\n'), {})
  const t = parseStyleTokens('---\n# 这是注释\n\ncolors:\n  bg: "#FFF"\nomitted:\n  - Shapes\n  - Components\nspacing:\n  unit: 12px\n---\n')
  assert.deepEqual(t.colors, { bg: '#FFF' })
  assert.equal(t.spacing.unit, '12px', '数组续行被跳过后,后面的顶层键仍要正常解析')
})

test('parseStyleTokens:退出嵌套靠缩进回落 —— 子键不会串到后一个顶层段', () => {
  const t = parseStyleTokens('---\ncolors:\n  bg: "#FFF"\nrounded:\n  md: 12px\n---\n')
  assert.deepEqual(t.colors, { bg: '#FFF' })
  assert.deepEqual(t.rounded, { md: '12px' })
  assert.equal(t.colors.md, undefined)
})

// ── styleRoles ───────────────────────────────────────────────────────────────

test('styleRoles:键名整词命中五角色', () => {
  const r = styleRoles({ bg: '#FFFFFF', ink: '#111111', accent: '#FF0000', muted: '#888888', line: '#DDDDDD' })
  assert.equal(r.bg, '#FFFFFF'); assert.equal(r.ink, '#111111'); assert.equal(r.accent, '#FF0000')
  assert.equal(r.muted, '#888888'); assert.equal(r.line, '#DDDDDD')
  assert.equal(r.dark, false)
})

test('styleRoles:⚠ 不做子串匹配 —— ink-blue 不能被认成 ink(否则整张图标全错)', () => {
  // riso-print 的真实形态:paper + 四种「ink-*」油墨色。ink 应由启发式判到最深的 ink-black,
  // 而不是键名里第一个含 "ink" 的 ink-blue。
  const r = styleRoles({ paper: '#F3EEE2', 'ink-blue': '#0078BF', 'ink-pink': '#FF48B0', 'ink-orange': '#FF6C2F', 'ink-black': '#1A1A1A' })
  assert.equal(r.bg, '#F3EEE2')
  assert.equal(r.ink, '#1A1A1A', 'ink 应是与底色对比最强的那个,不是键名含 ink 的第一个')
})

test('styleRoles:primary 二义 —— 有独立 bg 键时当文字色,没有时当强调色', () => {
  assert.equal(styleRoles({ neutral: '#F4F3EF', primary: '#111418', accent: '#D93025' }).ink, '#111418')
  // 无 bg 类键名:primary 让给 accent,底色由启发式挑最亮的
  const r2 = styleRoles({ primary: '#2244A8', surface: '#FFFFFF' })
  assert.equal(r2.bg, '#FFFFFF')
  assert.equal(r2.accent, '#2244A8')
})

test('styleRoles:深色风格 —— 全是深色时取最暗的当底,dark 标记为真', () => {
  const r = styleRoles({ shade1: '#0B0E14', shade2: '#151A23', text: '#E6EAF2', accent: '#2DD4BF' })
  assert.equal(r.bg, '#0B0E14')
  assert.equal(r.dark, true)
  assert.equal(r.ink, '#E6EAF2')
})

test('styleRoles:强调色取彩度最高 —— 灰不够门槛就退回对比最强', () => {
  assert.equal(styleRoles({ paper: '#FFFFFF', ink: '#111111', a: '#8A8A8C', b: '#E85D2F' }).accent, '#E85D2F')
  // 只有无彩色可选 ⇒ 彩度门槛拦下,退回「剩余色里对比最强」
  const r = styleRoles({ paper: '#FFFFFF', ink: '#111111', g1: '#909090', g2: '#4A4A4A' })
  assert.equal(r.accent, '#4A4A4A')
})

test('styleRoles:只有两个颜色也要凑出五角色(muted/line 由 bg↔ink 混出,不空)', () => {
  const r = styleRoles({ bg: '#FFFFFF', ink: '#000000' })
  for (const k of ['bg', 'ink', 'accent', 'muted', 'line']) assert.match(r[k], /^#[0-9A-F]{6}$/, k + ' 必须有值')
  assert.equal(r.palette.length, 2, 'palette 只列作者真写了的颜色')
})

test('styleRoles:非法值丢弃、3 位 hex 扩成 6 位、一个合法色都没有 ⇒ null', () => {
  const r = styleRoles({ bg: '#fff', bad: 'rgb(1,2,3)', nested: { x: 1 }, ink: '#123456' })
  assert.equal(r.bg, '#FFFFFF')
  assert.deepEqual(r.palette.map((p) => p.key), ['bg', 'ink'], '非法值与嵌套段不进色板')
  assert.equal(styleRoles({}), null)
  assert.equal(styleRoles({ a: 'not-a-color' }), null)
})

test('styleRoles:palette 保作者写的顺序(顺序本身是主次意图)', () => {
  const r = styleRoles({ zulu: '#111111', alpha: '#FFFFFF', mike: '#FF0000' })
  assert.deepEqual(r.palette.map((p) => p.key), ['zulu', 'alpha', 'mike'])
})

// ── swatchSpec ───────────────────────────────────────────────────────────────

const specOf = (fm) => swatchSpec('---\n' + fm + '\n---\n正文\n')

test('swatchSpec:圆角取常规档最大值 —— 999/full 是胶囊语义,不许参与取最大', () => {
  // 圆融亲和的真实形态:md 12 / lg 20 / full 999 ⇒ 20(不是 999,否则整张图标变胶囊)
  assert.equal(specOf('colors:\n  bg: "#FFF"\nrounded:\n  md: 12px\n  lg: 20px\n  full: 999px').radius, 20)
  assert.equal(specOf('colors:\n  bg: "#FFF"\nrounded:\n  none: 0px\n  full: 999px').radius, 0)
})

test('swatchSpec:全是胶囊 ⇒ 哨兵;rounded 段缺失 ⇒ 0(不替作者假设默认值)', () => {
  assert.equal(specOf('colors:\n  bg: "#FFF"\nrounded:\n  full: 999px').radius, PILL)
  assert.equal(specOf('colors:\n  bg: "#FFF"').radius, 0)
})

test('swatchSpec:serif 判定要先剜掉 sans-serif(否则无衬线全被判成衬线)', () => {
  assert.equal(specOf('colors:\n  bg: "#FFF"\ntypography:\n  headline:\n    fontFamily: "\'Noto Sans SC\', sans-serif"').serif, false)
  assert.equal(specOf('colors:\n  bg: "#FFF"\ntypography:\n  headline:\n    fontFamily: "\'Noto Serif SC\', serif"').serif, true)
})

test('swatchSpec:字重 clamp 到 100..900、缺失退 400;mono 看所有字体族', () => {
  assert.equal(specOf('colors:\n  bg: "#FFF"\ntypography:\n  headline:\n    fontWeight: 9999').headlineWeight, 900)
  assert.equal(specOf('colors:\n  bg: "#FFF"\ntypography:\n  headline:\n    fontFamily: "X"').headlineWeight, 400)
  assert.equal(specOf('colors:\n  bg: "#FFF"\ntypography:\n  data:\n    fontFamily: "IBM Plex Mono, monospace"').mono, true)
})

test('swatchSpec:headline 缺失时退回第一个字体子块(不至于什么都读不到)', () => {
  const s = specOf('colors:\n  bg: "#FFF"\ntypography:\n  body:\n    fontFamily: "\'Noto Serif SC\', serif"\n    fontWeight: 500')
  assert.equal(s.serif, true)
  assert.equal(s.headlineWeight, 500)
})

test('swatchSpec:没 colors ⇒ roles 为 null(调用方兜底,这里不编颜色)', () => {
  assert.equal(swatchSpec('# 架构文档\n正文\n').roles, null)
  assert.equal(specOf('name: 甲').roles, null)
})

// ── swatchLayout ─────────────────────────────────────────────────────────────

test('swatchLayout:图元表非空、坐标全在卡内、色板 chips 按 palette 出片', () => {
  const lay = swatchLayout(specOf('colors:\n  bg: "#FFFFFF"\n  ink: "#111111"\n  accent: "#FF0000"\n  extra: "#00FF00"'))
  assert.equal(lay.w, CARD_W); assert.equal(lay.h, CARD_H)
  assert.ok(lay.rects.length > 8, '至少要有底/边/标题/正文/按钮/色板一系列图元')
  for (const r of lay.rects) {
    assert.ok(r.x >= 0 && r.y >= 0, '图元不许出卡片左上')
    assert.ok(r.x + r.w <= lay.w + 0.01 && r.y + r.h <= lay.h + 0.01, `图元不许出卡片右下: ${JSON.stringify(r)}`)
  }
  // 色板 chips:4 个 token ⇒ 4 片,**按作者写的顺序**(chip 内芯高 14 = 16 内缩 1px 描边底,
  // 卡里没有别的图元是这个高度)。⚠ 不能按颜色计数 —— extra 同时被判成了 muted,正文线也在用它。
  const cells = lay.rects.filter((r) => Math.abs(r.h - 14) < 0.01)
  assert.deepEqual(cells.map((r) => r.fill), ['#FFFFFF', '#111111', '#FF0000', '#00FF00'])
  assert.equal(lay.empty, false)
})

test('swatchLayout:无色板 ⇒ empty 标记 + 中性灰空卡(不猜颜色)', () => {
  const lay = swatchLayout(swatchSpec('# 架构文档\n'))
  assert.equal(lay.empty, true)
  assert.ok(lay.rects.some((r) => r.fill === '#FFFFFF'))
})

test('swatchLayout:index>0 才出序号点阵;恒单字(CLI 上限 4,双位数不存在)', () => {
  assert.equal(swatchLayout(specOf('colors:\n  bg: "#FFF"'), { index: 0 }).digits.length, 0)
  const d3 = swatchLayout(specOf('colors:\n  bg: "#FFF"'), { index: 3 }).digits
  assert.equal(d3.length, 1); assert.equal(d3[0].d, '3')
  assert.equal(swatchLayout(specOf('colors:\n  bg: "#FFF"'), { index: 4 }).digits[0].d, '4')
})

test('swatchLayout:行距随 spacing.unit 变 —— unit 大的风格正文排得疏(留白性格如实)', () => {
  const gapOf = (unit) => {
    const body = swatchLayout(specOf(`colors:\n  bg: "#FFFFFF"\n  ink: "#111111"\nspacing:\n  unit: ${unit}px`))
      .rects.filter((r) => Math.abs(r.h - 4) < 0.01) // 正文线唯一 h=4
    assert.equal(body.length, 3, '正文恒 3 条 —— 疏密体现在行距不减行数')
    return body[1].y - body[0].y
  }
  assert.ok(gapOf(14) > gapOf(6), '行距应随 unit 增大')
})

// ── renderSwatchSheet ────────────────────────────────────────────────────────

const pxAt = (sheet, x, y) => {
  const o = (y * sheet.width + x) * 4
  return '#' + [sheet.px[o], sheet.px[o + 1], sheet.px[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

test('renderSwatchSheet:尺寸随卡数增长;单张不编号、多张自动编号', () => {
  const one = renderSwatchSheet([specOf('colors:\n  bg: "#FFF"')])
  const three = renderSwatchSheet([1, 2, 3].map(() => specOf('colors:\n  bg: "#FFF"')))
  assert.equal(one.height, three.height)
  assert.ok(three.width > one.width * 2)
  // 编号块用 accent 色画在卡片右上 —— 多张时该处不再是底色
  const numbered = renderSwatchSheet([1, 2].map(() => specOf('colors:\n  bg: "#FFFFFF"\n  accent: "#FF0000"')))
  assert.ok(numbered.px.includes(0xff), '编号块的强调色应落在平面里')
})

test('renderSwatchSheet:底色真落到像素上(卡片内部采样),空数组抛错', () => {
  const sheet = renderSwatchSheet([specOf('colors:\n  bg: "#123456"\n  ink: "#EEEEEE"')], { numbered: false })
  // 卡片内部靠右下的空白处应是底色(pad=20 表格背景 + 卡片 pad=18 内容区)
  assert.equal(pxAt(sheet, 20 + CARD_W - 30, 20 + 12), '#123456')
  assert.equal(pxAt(sheet, 2, 2), '#FFFFFF', '表格背景默认白')
  assert.throws(() => renderSwatchSheet([]), /至少要一个/)
})

test('renderSwatchSheet:α 阴影不画成实心黑(8 位 hex 要按覆盖率混色)', () => {
  const sheet = renderSwatchSheet([specOf('colors:\n  bg: "#FFFFFF"')], { numbered: false })
  // 卡片右下外侧那 2px 是半透明硬阴影:必须是浅灰,不能是 #000000
  const shadow = pxAt(sheet, 20 + CARD_W - 1, 20 + Math.round(CARD_H / 2))
  assert.notEqual(shadow, '#000000', '8 位 hex 的 α 被忽略就会画出实心黑边')
  assert.notEqual(shadow, '#FFFFFF', '阴影总得比背景深一点才看得见')
})

test('renderSwatchSheet:产物能被真实 PNG 编解码走通(与群里发出去的是同一条路)', () => {
  const sheet = renderSwatchSheet([specOf('colors:\n  bg: "#0B0E14"\n  ink: "#E6EAF2"')], { numbered: false })
  const d = decodePngRGBA(encodePngRGBA(sheet.px, sheet.width, sheet.height))
  assert.ok(d, 'PNG 必须能解回来')
  assert.equal(d.width, sheet.width); assert.equal(d.height, sheet.height)
})

// ── styleCard / projectStyleCard ─────────────────────────────────────────────

test('styleCard:控制台要的字段齐全,layout 在服务端算好(前端不重算布局)', () => {
  const c = styleCard(styleDoc('甲', '乙'), { slug: 'jia', source: 'builtin' })
  assert.equal(c.slug, 'jia'); assert.equal(c.source, 'builtin')
  assert.equal(c.name, '甲'); assert.equal(c.description, '乙')
  assert.ok(c.layout && c.layout.rects.length > 8)
  assert.ok(Array.isArray(c.palette) && c.palette.length === 2)
})

test('projectStyleCard:认帧与 findStyleDoc 同一套 —— 架构文档不当风格档', () => {
  const d = tmp()
  assert.equal(projectStyleCard(d), null, '空目录 ⇒ null')
  fs.writeFileSync(path.join(d, 'DESIGN.md'), '# 架构设计文档\n\n## 模块\n')
  assert.equal(projectStyleCard(d), null, '根 DESIGN.md 是架构文档 ⇒ null(不能误认成风格档)')
  fs.mkdirSync(path.join(d, 'design'))
  fs.writeFileSync(path.join(d, 'design', 'DESIGN.md'), styleDoc('退档位风格', '说明'))
  const c = projectStyleCard(d)
  assert.equal(c.name, '退档位风格')
  assert.equal(c.rel, path.join('design', 'DESIGN.md'))
  assert.equal(projectStyleCard(''), null)
  assert.equal(projectStyleCard('/nonexistent-path-xyz'), null, '读不动一律当没有,绝不抛(会打挂 /api/state)')
})

// ── 真实预设回归网 ───────────────────────────────────────────────────────────

test('内置预设:全部解析出五角色与可画的图元(改预设别把图标弄坏)', () => {
  const styles = allStyles()
  assert.ok(styles.length >= 16, `内置预设至少 16 种,实际 ${styles.length}`)
  for (const s of styles) {
    const spec = swatchSpec(fs.readFileSync(s.path, 'utf8'))
    assert.ok(spec.roles, `${s.slug} 必须解析出色板(front matter 少了 colors?)`)
    for (const k of ['bg', 'ink', 'accent', 'muted', 'line']) assert.match(spec.roles[k], /^#[0-9A-F]{6}$/, `${s.slug}.${k}`)
    assert.ok(spec.name, `${s.slug} 要有 name`)
    assert.ok(spec.roles.palette.length >= 3, `${s.slug} 色板至少 3 色`)
    assert.ok(swatchLayout(spec).rects.length > 8, `${s.slug} 要画得出图元`)
  }
})

test('内置预设:4 张并排出图(群里那张候选对比图的真实路径)', () => {
  const specs = allStyles().slice(0, 4).map((s) => swatchSpec(fs.readFileSync(s.path, 'utf8')))
  const sheet = renderSwatchSheet(specs)
  assert.equal(sheet.height, 20 * 2 + CARD_H)
  assert.equal(sheet.width, 20 * 2 + 4 * CARD_W + 3 * 18)
  assert.ok(encodePngRGBA(sheet.px, sheet.width, sheet.height).length > 1000, '要出一张真 PNG')
})

// ── 对外表述(2026-07-30 产品决定:控制台与群里不出现工具名/机器路径)────────────

test('swatch 输出:提醒 agent 群消息里别写 slug/命令/路径', () => {
  // stdout 里必须留命令名(agent 靠它执行),但要同时挡住「照抄进群」
  const { execFileSync } = require('node:child_process')
  const d = tmp()
  const out = execFileSync(process.execPath,
    [path.join(__dirname, '..', '..', 'bin', 'sbot.js'), 'design', 'swatch', 'swiss-grid', 'neo-chinese'],
    { cwd: d, encoding: 'utf8' })
  assert.match(out, /别把 slug、命令名或机器路径写进去/)
  assert.match(out, /序号 \+ 名称 \+ 一句话/)
  // v0.9.3:角色判定 + 「改色值没用」也必须真的出现在 stdout(纯函数测得再全,没接上线也白搭)
  assert.match(out, /图就是按这套角色判定画的/)
  assert.match(out, /强调 #[0-9A-F]{6}/)
  assert.match(out, /改色值没用/)
})

// ── 角色判定自查输出(v0.9.3;真机 2026-07-31)──────────────────────────────────
// 病史:用户说「主色改靛蓝」,agent 把「几何构成」的 `blue` 换成靛蓝、图也重画了,可按钮还是
// 黄的 —— blue/yellow/red 都不在 ROLE_KEYS ⇒ 按彩度挑,黄恒胜。它却在群里断言「靛蓝将承担
// 主要视觉面积」,与图恰好相反。v0.9.2 把图设计成一道自检,但那要它主动看图核对(有识图能力
// 也没做);把判定打成文字,自检就降成「读一行」。这组钉住:报告如实、提示给得出出路。

test('swatchRoleReport:几何构成的强调色是黄(yellow)不是蓝 —— 键名不在词表就按彩度挑', () => {
  const hit = allStyles().find((s) => s.slug === 'geometric-pop')
  const out = swatchRoleReport([swatchSpec(fs.readFileSync(hit.path, 'utf8'))])
  assert.match(out, /底色 #F6EFE3\(cream\)/)
  assert.match(out, /强调 #F2B705\(yellow\)/)
  assert.match(out, /次要 #2244A8\(blue\)/)
})

test('swatchRoleReport:把 blue 的值换成靛蓝,强调色仍是黄 —— 那次真机困惑的原样复现', () => {
  const hit = allStyles().find((s) => s.slug === 'geometric-pop')
  const text = fs.readFileSync(hit.path, 'utf8').replace('#2244A8', '#3F51B5')
  const out = swatchRoleReport([swatchSpec(text)])
  assert.match(out, /强调 #F2B705\(yellow\)/, '改色值不该改变角色归属')
  assert.match(out, /次要 #3F51B5\(blue\)/)
})

test('swatchRoleReport:键名改成 accent ⇒ 靛蓝当上强调色(报告要能体现这条出路真的走得通)', () => {
  const hit = allStyles().find((s) => s.slug === 'geometric-pop')
  const text = fs.readFileSync(hit.path, 'utf8').replace('blue: "#2244A8"', 'accent: "#3F51B5"')
  assert.match(swatchRoleReport([swatchSpec(text)]), /强调 #3F51B5\(accent\)/)
})

test('swatchRoleReport:多张带序号,与图上的数字一一对齐', () => {
  const specs = allStyles().slice(0, 3).map((s) => swatchSpec(fs.readFileSync(s.path, 'utf8')))
  const lines = swatchRoleReport(specs, { numbered: true }).split('\n')
  assert.equal(lines.length, 3)
  lines.forEach((line, i) => assert.match(line, new RegExp(`^ {2}${i + 1}\\. 底色 #`)))
})

test('swatchRoleReport:色板缺失如实说画成空卡,不编颜色', () => {
  assert.match(swatchRoleReport([swatchSpec('---\nname: 无色\n---\n\n正文\n')]), /灰色空卡/)
  assert.equal(swatchRoleReport([]), '')
  assert.equal(swatchRoleReport(null), '')
})

// ── 场景标签(v0.9.5)──────────────────────────────────────────────────────────
// 风格库涨到二十几种后,agent 只看名字和一句话挑不准,而它挑漏的那个用户根本看不到。
test('parseStyleMeta:解析 suits 场景标签', () => {
  const t = '---\nname: X\ndescription: d\nsuits: "工具产品 · 品牌门面"\ncolors:\n  bg: "#FFF"\n---\n'
  assert.equal(parseStyleMeta(t).suits, '工具产品 · 品牌门面')
  assert.equal(parseStyleMeta('---\nname: X\ncolors:\n  bg: "#FFF"\n---\n').suits, '') // 没写 ⇒ 空串,不编内容
})

// ⚠ **本轮改造的验收网**。风格库从 8 涨到 25 之后,「25 张图都好看」和「25 张图都一样」
// 看起来不一样,但同样是失败(同 CONTRIBUTING.md 那条「否定结论要带对照组」)。
// 几何指纹 = 去掉颜色、只留位置与尺寸 ⇒ 两个风格若指纹相同,说明后来那个**一条差异维度
// 都没用上**(字号比 / 描边 / 图块 / serif / mono),用户在候选对比图里根本分不出来。
// 改坏的典型场景:新增风格时 fontSize 忘了写、border 与 imagery 直接抄了别人的值。
test('内置预设:任意两张预览图的几何指纹都不相同(否则那个风格没用上任何差异维度)', () => {
  const seen = new Map()
  for (const s of allStyles()) {
    const spec = swatchSpec(fs.readFileSync(s.path, 'utf8'))
    const fp = JSON.stringify(swatchLayout(spec).rects.map((r) => [r.x, r.y, r.w, r.h, r.r].map((n) => Math.round(n * 100) / 100)))
    const prev = seen.get(fp)
    assert.ok(!prev, `${s.slug} 与 ${prev} 的预览图形状逐像素相同 —— 只有配色不同的两个风格,在候选图里分不出来`)
    seen.set(fp, s.slug)
  }
})

// SVG 那侧靠 viewBox 裁切,越界图元会被直接切掉(历史上"阴影偏 3 而卡片只让 2"就是这么发现的)
test('内置预设:全部图元都在卡内(越界会被 SVG 的 viewBox 静默切掉)', () => {
  for (const s of allStyles()) {
    const L = swatchLayout(swatchSpec(fs.readFileSync(s.path, 'utf8')))
    for (const r of L.rects) {
      assert.ok(r.x >= -0.01 && r.y >= -0.01 && r.x + r.w <= L.w + 0.01 && r.y + r.h <= L.h + 0.01,
        `${s.slug} 有图元越界:${JSON.stringify(r)}`)
    }
  }
})

// 图标声明的两条不变量(v0.11.49)。第一条治的是「声明了却报未启用」——**判据写成「档里写了就必须
// 读得到」而不是写死份数**:写死份数的话,新增一份带声明的档会把测试改红,而那不是回归。
test('内置预设:凡写了图标声明的档,都必须读得出 spec(声明了却报未启用是这条要治的)', () => {
  let declared = 0
  for (const s of allStyles()) {
    const text = fs.readFileSync(s.path, 'utf8')
    const tk = parseStyleTokens(text)
    const has = !!(tk.icons || tk.icon)
    if (!has) { assert.equal(design.iconSpec(tk), null, `${s.slug} 没声明却读出了 spec —— 那就是凭空捏造依据`); continue }
    declared++
    assert.ok(design.iconSpec(tk), `${s.slug} 档里写了图标声明,却报未启用`)
  }
  // 对照组:这条断言若因为「一份都没扫到」而全绿,和真的全通过看起来一模一样
  assert.ok(declared > 0, '一份带声明的内置档都没扫到 ⇒ 本次扫描无效,不是「全通过」')
})

// 声明实心却挂在一个没有实心图标的库上 = 取出来必然是线性,而 stderr 摘要还会跟着声明写「实心」。
// 这条盯着真实资产:日后有人新写一份 solid 档、library 顺手填 lucide,当场变红。
// ⚠ 这条必须自带对照组:循环体只对 style==='filled' 的档生效,一旦上游把它们读成 null
//   (比如回落被改坏),循环一次都不进,**全绿与真的全通过一模一样**。变异检验里正是这样
//   被另一个变异掩护过一次 —— 空测试就是这么长的。
test('内置预设:声明实心的档,它的库必须真有实心图标(lucide 一个都没有)', () => {
  let filled = 0
  for (const s of allStyles()) {
    const spec = design.iconSpec(parseStyleTokens(fs.readFileSync(s.path, 'utf8')))
    if (!spec || spec.style !== 'filled') continue
    filled++
    const libs = [spec.library, spec.fallbackLibrary].filter(Boolean)
    assert.ok(libs.some((l) => ((design.ICON_LIBS[l] || {}).dirs || []).some((d) => d.style === 'filled')),
      `${s.slug} 声明实心,但 ${libs.join('/')} 里没有实心目录 ⇒ 会静默发线性图标`)
  }
  assert.ok(filled > 0, '一份实心档都没扫到 ⇒ 本次扫描无效(上游可能把声明读成了 null),不是「全通过」')
})

// 备选档放 assets/design-styles/extra/(质量合格但位置太挤,与库里某个太近)。
// listStyles 只扫一层目录 ⇒ 天然不收录。这条钉住那个机制,免得日后改成递归扫描把它们放进来。
test('内置预设:extra/ 子目录里的备选档不进风格库', () => {
  const extra = path.join(__dirname, '..', '..', 'assets', 'design-styles', 'extra')
  const parked = fs.readdirSync(extra).filter((f) => f.endsWith('.md') && f !== 'README.md').map((f) => f.slice(0, -3))
  assert.ok(parked.length > 0, 'extra/ 应当有备选档')
  const active = new Set(allStyles().map((s) => s.slug))
  for (const slug of parked) assert.ok(!active.has(slug), `${slug} 在 extra/ 里却出现在风格库中`)
})

// 全库网格(v0.10.1):候选对比与浏览是两个场景 —— 前者 2-4 张大图看细节,后者要全。
test('renderSwatchSheet:cols 出多行网格,尺寸按行列算', () => {
  const specs = allStyles().map((s) => swatchSpec(fs.readFileSync(s.path, 'utf8')))
  const one = renderSwatchSheet(specs.slice(0, 4))            // 不给 cols = 单行(旧行为)
  const grid = renderSwatchSheet(specs.slice(0, 8), { cols: 4 }) // 4 列 ⇒ 2 行
  assert.equal(one.height, grid.height - (CARD_H + 18), '两行应当正好高出一张卡 + 一个间距')
  assert.equal(one.width, grid.width, '4 张单行与 4 列网格同宽')
})

// ⚠ 序号牌此前只画 String(index)[0] —— 上限 4 时无所谓,一到两位数就把 16 画成「1」,
// 两张卡的序号牌会一模一样,用户说「第 16 个」时对不上。
test('swatchLayout:两位数序号完整画出(全库网格出到 16)', () => {
  const spec = swatchSpec(fs.readFileSync(allStyles()[0].path, 'utf8'))
  assert.deepEqual(swatchLayout(spec, { index: 7 }).digits.map((d) => d.d), ['7'])
  assert.deepEqual(swatchLayout(spec, { index: 16 }).digits.map((d) => d.d), ['1', '6'])
  const L = swatchLayout(spec, { index: 16 })
  for (const d of L.digits) assert.ok(d.x >= 0 && d.x + 5 * d.s <= L.w, '两位数序号不得越出卡片')
})

// ⚠ 这两条断言的是**内置预设**这批随包发布的文件,所以只许读包内目录。原本走 allStyles() /
// 裸跑 CLI ⇒ 连带读进 ~/.sbot/design-styles:operator 自己建一套没标场景的风格(控制台新建
// 表单里场景本就是选填),`npm test` 当场变红,而红的是他的机器状态、不是这个仓库。
// 通则:单测不许把断言下到本机私有目录上 —— CI 绿、本机红,查起来最贵。
test('内置预设:每个都标了场景,且落在固定词表里', () => {
  const SCENES = ['工具产品', '品牌门面', '内容阅读', '活动推广', '生图插画']
  for (const s of listStyles({ builtinDir: BUILTIN_STYLES_DIR })) {
    assert.ok(s.suits, `${s.slug} 没标 suits —— 它会掉进「未标场景」组,等于挑不到`)
    for (const one of s.suits.split('·').map((x) => x.trim()).filter(Boolean)) {
      assert.ok(SCENES.includes(one), `${s.slug} 的场景「${one}」不在词表里,分组会漏掉它`)
    }
  }
})

test('design styles:按场景分组输出,并教「先确认用途」', () => {
  const { execFileSync } = require('node:child_process')
  // HOME/USERPROFILE 指向空目录 ⇒ 只看内置那批(见上一条注释:别把断言下到本机私有目录上)
  const home = tmp()
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'sbot.js'), 'design', 'styles'],
    { cwd: tmp(), encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } })
  assert.match(out, /先确认用途/)
  assert.match(out, /【工具产品】/)
  assert.match(out, /【生图插画】/)
  assert.doesNotMatch(out, /【未标场景】/) // 内置预设全部标过 ⇒ 不该出现这一组
})

test('SWATCH_ROLE_HINT:写明「改色值没用」与出路「改名为 accent」—— 这是本次修复的主体', () => {
  assert.match(SWATCH_ROLE_HINT, /改色值没用/)
  assert.match(SWATCH_ROLE_HINT, /改名为 `accent`/)
  assert.match(SWATCH_ROLE_HINT, /彩度最高/)
})

const design = require('../../src/design') // 新增块用命名空间(既有断言仍走上面的解构导入)

// ── 设计规范回归检查(v0.11.29,含视觉回归)──────────────
// 定位:**不做阻断式强制**(教训 6:配置类策略对半可信 agent 本质不可强制)——
// 只把机器测得准的偏离确定性地列出来,判断权留给人。所以这里最要紧的两类断言是:
// ① 该报的报得出 ② **不该报的一个都不许报**(假警报会让整份报告被无视)。

const FT = `---
name: "测试风格"
colors:
  bg: "#F5F5F5"
  ink: "#333333"
  accent: "#1B6B37"
typography:
  body:
    fontFamily: "'Inter', 'Noto Sans SC', sans-serif"
rounded:
  md: 8px
  full: 999px
gradient:
  from: "#1B6B37"
  to: "#0D3B1F"
elevation:
  shadow: "0 4px 16px rgba(27, 107, 55, 0.3)"
status:
  success: "#34A853"
  danger: "#E53935"
---
正文`

test('design check: 合法色不只看 colors —— status/gradient/elevation 里的色也算数', () => {
  const tk = design.parseStyleTokens(FT)
  const allowed = design.styleAllowedColors(tk)
  for (const hex of ['#F5F5F5', '#333333', '#1B6B37', '#0D3B1F', '#34A853', '#E53935']) {
    assert.ok(allowed.includes(hex), `${hex} 应是合法色`)
  }
  // v0.11.22 特意让 status/gradient 走顶层(免得抢 accent)—— 漏收它们就会把作者
  // 明明定义过的成功绿报成偏离,那种假警报会让整份报告失去信任
  assert.ok(allowed.includes('#34A853'), 'status.success 必须算合法')
  assert.ok(allowed.includes('#1B6B37'), 'gradient 两端必须算合法')
})

test('design check: 抓得到真偏离(色/圆角/字体各一)', () => {
  const tk = design.parseStyleTokens(FT)
  const css = '.a{color:#22C55E;border-radius:6px;font-family:Roboto,sans-serif}'
  const r = design.checkDesign([{ rel: 'a.css', text: css }], tk)
  assert.equal(r.findings.length, 3)
  const kinds = r.findings.map((f) => f.kind).sort()
  assert.deepEqual(kinds, ['color', 'font', 'radius'])
  const color = r.findings.find((f) => f.kind === 'color')
  assert.equal(color.value, '#22C55E')
  assert.equal(color.nearest, '#34A853', '要指出最接近的合法色 —— 人据此判断是不是写错了')
})

test('design check: ⭐ 合规写法一个都不许误报(假警报比不报更糟)', () => {
  const tk = design.parseStyleTokens(FT)
  const css = [
    // ⚠ 字体链接是这份「合规交付」的一部分(v0.11.66 起查字体可得性):Inter 不是系统自带,
    //   没有这一行的页面上它根本不会出现 —— 那不是合规写法,是字体身份的幻觉。
    "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');",
    '.a{background:#1B6B37;border-radius:8px;font-family:"Inter",sans-serif}',      // 直接命中
    '.b{background:linear-gradient(135deg,#1B6B37,#0D3B1F)}',                        // 渐变两端都在档里
    '.c{color:#1b6b37}',                                                            // 同色小写
    '.d{border-radius:50%}',                                                        // 等价 full
    '.e{border-radius:999px}',
    '.f{box-shadow:0 4px 16px rgba(27,107,55,.3)}',                                 // elevation 同色
    '.g{color:#34A853}',                                                            // status
    '.h{border-radius:0}',                                                          // 直角恒合法
  ].join('\n')
  const r = design.checkDesign([{ rel: 'ok.css', text: css }], tk)
  assert.deepEqual(r.findings, [], '这些全是合规写法,一条都不该报')
})

test('design check: 风格档没写 rounded 就不查圆角(没依据就不报)', () => {
  const tk = design.parseStyleTokens('---\ncolors:\n  bg: "#FFFFFF"\n---\n')
  const r = design.checkDesign([{ rel: 'a.css', text: '.a{border-radius:7px}' }], tk)
  assert.ok(!r.findings.some((f) => f.kind === 'radius'), '风格档没定义圆角档位时,任何圆角都不算偏离')
})

test('design check: rem/rpx 换算成 px 再比(小程序 rpx 是 750 稿口径)', () => {
  assert.deepEqual(design.usedRadii('.a{border-radius:0.5rem}'), [8], '0.5rem = 8px')
  assert.deepEqual(design.usedRadii('.a{border-radius:16rpx}'), [8], '16rpx = 8px')
  assert.deepEqual(design.usedRadii('.a{border-radius:50%}'), [999])
})

test('design check: font-family 只比首选族(后面的都是兜底,逐个比必然假警报)', () => {
  assert.deepEqual(design.usedFontFamilies('.a{font-family:"Inter", "Noto Sans SC", sans-serif}'), ['inter'])
  assert.deepEqual(design.usedFontFamilies('.a{font-family:var(--f)}'), [], 'CSS 变量无从比对,跳过')
})

test('design check: 报告结尾必须写明「不一致 ≠ 做错了」', () => {
  const tk = design.parseStyleTokens(FT)
  const r = design.checkDesign([{ rel: 'a.css', text: '.a{color:#22C55E}' }], tk)
  const txt = design.formatCheckReport(r, { styleName: '测试风格' })
  assert.match(txt, /不等于做错了/, '不写死这句,agent 会把设计图自带的渐变也一并改没了')
  assert.match(txt, /由人来定要不要改/)
  // 零偏离时给一句干净的结论(交付说明里要贴)
  const clean = design.formatCheckReport(design.checkDesign([{ rel: 'b.css', text: '.a{color:#1B6B37}' }], tk), {})
  assert.match(clean, /未发现不一致/)
})

test('design check: tokens 摘要把色板/字体/圆角摆进清单(消灭「没加载」)', () => {
  const d = design.tokenDigest(design.parseStyleTokens(FT))
  assert.match(d, /#1B6B37/)
  assert.match(d, /inter/)
  assert.match(d, /8px/)
  assert.match(d, /success #34A853/)
  assert.ok(d.length < 400, '清单每轮都付 token —— 摘要必须短')
  // 色板过长要截断并标总数,不能无限长
  const many = { colors: Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['c' + i, '#11223' + (i % 10)])) }
  assert.match(design.tokenDigest(many), /共 20 个/)
})

// ── 图标体系(P1a):契约见 docs/ICONS.md ────────────────────────────────────────
// 缺口不是「少一个检查器」,是**一致性没有载体** —— 风格档此前零处提到图标(DemoApp 那份
// 的色/字/间距/投影/动效全是从 95 个页面量出来的,唯独图标一片空白),于是每做一个新页面
// agent 就重新发明一套 path。⚠ **一致性由「取得到正确图标」保证,不由「检查出不一致」保证**:
// 检查器只兜底,它能发现不一致、造不出一致。下面每条都是能区分两种实现的实验。

const ICONS_FM = `---
name: "带图标的风格"
colors:
  bg: "#FFFFFF"
  ink: "#333333"
  accent: "#1B6B37"
icons:
  library: "lucide"
  fallbackLibrary: "tabler"
  strokeWidth: 2
  size:
    sm: 16px
    md: 18px
    lg: 24px
  semantics:
    back: "chevron-left"
---
正文`

// 两个库的分发文件长相(逐字取自实物):属性完全同构 —— 这正是「可混用」的依据;
// tabler 多一条占位框 path,内联前必须剥掉。
const LUCIDE_SVG = `<!-- @license lucide-static v1.31.0 - ISC -->
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-left"><path d="m15 18-6-6 6-6"/></svg>`
const TABLER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-brand-x"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M4 4l11.733 16h4.267l-11.733 -16z"/></svg>`

test('icons: 没有 icons 段 ⇒ spec 为 null(整类不测的依据,没依据就不报)', () => {
  assert.equal(design.iconSpec(design.parseStyleTokens(FT)), null)
  assert.ok(design.iconSpec(design.parseStyleTokens(ICONS_FM)))
})

test('icons: spec 填默认 —— 缺省即 24 网格 / 描边 2 / round / outlined', () => {
  const s = design.iconSpec({ icons: { library: 'lucide' } })
  assert.equal(s.grid, 24)
  assert.equal(s.strokeWidth, 2)
  assert.equal(s.linecap, 'round')
  assert.equal(s.linejoin, 'round')
  assert.equal(s.style, 'outlined')
  // 显式值必须压过默认
  const s2 = design.iconSpec({ icons: { library: 'x', grid: '20px', strokeWidth: 1.5, linecap: 'butt' } })
  assert.equal(s2.grid, 20); assert.equal(s2.strokeWidth, 1.5); assert.equal(s2.linecap, 'butt')
})

// ── 单数 `icon:` 回落(v0.11.49)────────────────────────────────────────────────
// 25 份内置档里 17 份写着 `icon:`,0 份有 `icons:` —— 那批档(2026-07-31)比 icons 的读取器
// (2026-08-17)早 17 天,写档的人自己发明了一段字段,**全仓库从来没有代码读过它**。
// 症状:明明声明了描边/端点/风格,系统却报「未启用图标体系」。
const LEGACY_ICON_FM = `---
name: "旧写法的风格"
colors:
  bg: "#FFFFFF"
  ink: "#111111"
icon:
  style: line
  strokeWidth: "1.5px"
  linecap: butt
  corner: sharp
---
正文`

test('icon 回落:单数段也算声明 —— 四项逐一翻译到 SVG 口径', () => {
  const s = design.iconSpec(design.parseStyleTokens(LEGACY_ICON_FM))
  assert.ok(s, '声明了却报未启用,正是这条要治的症状')
  assert.equal(s.style, 'outlined', 'line 是设计口径,SVG 那套叫 outlined')
  assert.equal(s.strokeWidth, 1.5, '"1.5px" 要落成数字')
  assert.equal(s.linecap, 'butt', 'linecap 两套口径同名同值,原样过')
  assert.equal(s.linejoin, 'miter', 'corner: sharp 就是 stroke-linejoin: miter')
})

test('icon 回落:复数段永远优先 —— 两个都写时不许被旧段盖回去', () => {
  const s = design.iconSpec({ icons: { library: 'tabler', style: 'filled' }, icon: { style: 'line', strokeWidth: '9px' } })
  assert.equal(s.style, 'filled')
  assert.equal(s.strokeWidth, 2, '旧段一个字都不该渗进来')
})

test('icon 回落:标量的 icon(比如写成一个 emoji)不算声明', () => {
  assert.equal(design.iconSpec({ icon: '🎨' }), null)
  assert.equal(design.iconSpec({ icon: ['a'] }), null)
})

test('icons: style/corner 的两套口径都收,归一到 SVG 那套', () => {
  const st = (v) => design.iconSpec({ icons: { style: v } }).style
  assert.equal(st('line'), 'outlined'); assert.equal(st('linear'), 'outlined'); assert.equal(st('outline'), 'outlined')
  assert.equal(st('solid'), 'filled'); assert.equal(st('Filled'), 'filled')
  assert.equal(st('outlined'), 'outlined', '已经是 SVG 口径的原样过')
  const jn = (o) => design.iconSpec({ icons: o }).linejoin
  assert.equal(jn({ corner: 'sharp' }), 'miter')
  assert.equal(jn({ corner: 'round' }), 'round')
  assert.equal(jn({ corner: 'sharp', linejoin: 'bevel' }), 'bevel', '显式 linejoin 压过 corner')
})

// ⚠ 这条不是偏好是事实:lucide 里实心图标数为 0 ⇒ 声明实心却默认挂 lucide,必然静默拿到线性。
// 这个坑对**手写 icons 段**同样成立(v0.11.31 起就在),不是回落引入的。
test('icons: 没声明库时按 style 定库 —— 实心只有 tabler 供得起', () => {
  assert.equal(design.iconSpec({ icons: { style: 'solid' } }).library, 'tabler')
  assert.equal(design.iconSpec({ icons: { style: 'line' } }).library, 'lucide')
  assert.equal(design.iconSpec({ icons: {} }).library, 'lucide', '没说风格 = 线性,老默认不变')
  assert.equal(design.iconSpec({ icons: { style: 'solid', library: 'lucide' } }).library, 'lucide', '显式声明永远赢(哪怕它取不到实心 —— 那由 iconStyleGap 出声)')
})

test('iconStyleGap:声明实心却只取得到线性目录 ⇒ 出声;能取到就闭嘴', () => {
  // ⚠ fixture 必须与 `iconDirs` 真实返回**同形**(带 style/weight/suffix)—— 这两条曾经手搓成
  //   只有 {lib,dir},于是「按路径正则判」这条老判据在测试里永远命中,phosphor 的假警报
  //   (实心目录叫 `fill` 不叫 `filled`)一次都没跑到。下面另有一条形状守卫钉死这件事。
  const filled = { style: 'filled', library: 'lucide', fallbackLibrary: null }
  assert.match(design.iconStyleGap(filled, [{ lib: 'lucide', dir: '/x/lucide-static/icons', style: 'outlined' }]) || '', /实心/)
  assert.equal(design.iconStyleGap(filled, [{ lib: 'tabler', dir: '/x/@tabler/icons/filled', style: 'filled' }]), null, '取得到就不该多话')
  // ⭐ 能区分两种实现:实心目录**不叫 filled**(phosphor 的叫 fill)时,按路径正则判就会误报
  assert.equal(design.iconStyleGap(filled, [{ lib: 'phosphor', dir: '/x/@phosphor-icons/core/assets/fill', style: 'filled' }]), null,
    '目录名里没有 filled 字样,但它声明了自己是实心 —— 判据必须读声明,不能读路径')
  assert.equal(design.iconStyleGap({ style: 'outlined', library: 'lucide' }, [{ lib: 'lucide', dir: '/x/icons', style: 'outlined' }]), null, '线性风格与这条无关')
  assert.equal(design.iconStyleGap(filled, []), null, '一个库都没装是另一条路,那边有专门的提示,这里不抢话')
})

// ── 图标系统(v0.11.53:与设计风格平级的实体)────────────────────────────────
// 系统 = 图形从哪来 + 叫什么名 + 怎么起名;风格 = 我用哪套 + 怎么画它。
// ⚠ 这份是 16 份内置档解析出来的 spec **冻结快照**,守的是「**代码**改动不许悄悄改变解析结果」。
//   ⚠ 它红了先分清是哪一类:
//     · 改了 `src/` 之后红 ⇒ **真破坏**,回去看代码,别动这排数字
//     · **故意改了 `assets/design-styles/` 的内容**之后红 ⇒ 护栏如实响了,更新快照并在 commit
//       里写清改了哪几份、为什么
//   ⚠ 初值只能从当时的实现 dump(快照本来如此),但**绝不许「改完代码顺手更新快照」** ——
//     那样它就废了(教训 16:自己跟自己比只能证明「新代码内部自洽」)。
//   ⚠ 两处看着奇怪但**是事实不是笔误**:`geometric-pop` / `riso-print` 声明的是实心,而
//     lucide 里实心图标数为 0(它只有 outlined 一个目录)⇒ 没声明库时按 style 自动落到 tabler。
//   ⚠ 2026-09-02:原先有 8 份是 `null`(那 8 份没写 `icon:` 段);本次给它们补了声明,快照同步更新。
const ICONSPEC_FROZEN = {
  'acid-pop': { library: 'tabler', fallbackLibrary: null, style: 'filled', grid: 24, strokeWidth: 2, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'archive-index': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'art-deco': { library: 'tabler', fallbackLibrary: null, style: 'filled', grid: 24, strokeWidth: 1, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'cinematic-noir': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'editorial': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'geometric-pop': { library: 'tabler', fallbackLibrary: null, style: 'filled', grid: 24, strokeWidth: 3, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'hand-drawn': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1.5, linecap: 'round', linejoin: 'round', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'islamic-geometry': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1.5, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'liquid-glass': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1.5, linecap: 'round', linejoin: 'round', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'neo-chinese': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'precision-mono': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1.5, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'quiet-luxury': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'riso-print': { library: 'tabler', fallbackLibrary: null, style: 'filled', grid: 24, strokeWidth: 2, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'soft-friendly': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 2, linecap: 'round', linejoin: 'round', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'swiss-grid': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
  'tech-dark': { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1.5, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} },
}
// 手写档的几种形状(与内置档互补:内置档一份 `icons:` 都没有,全是单数 `icon:`)
const ICONSPEC_BASELINE_FIXTURES = [
  [{}, null],
  [{ icon: '🎨' }, null],
  [{ icons: { library: 'lucide' } }, { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 2, linecap: 'round', linejoin: 'round', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} }],
  [{ icons: { library: 'lucide', fallbackLibrary: 'tabler', strokeWidth: 1.5, grid: '20px', linecap: 'butt', linejoin: 'bevel', color: '{colors.ink}', assets: 'a/b , c', size: { sm: 16, md: 18, lg: 24 }, semantics: { back: 'chevron-left' } } },
    { library: 'lucide', fallbackLibrary: 'tabler', style: 'outlined', grid: 20, strokeWidth: 1.5, linecap: 'butt', linejoin: 'bevel', color: '{colors.ink}', assets: ['a/b', 'c'], size: { sm: 16, md: 18, lg: 24 }, semantics: { back: 'chevron-left' } }],
  [{ icons: { style: 'solid' } }, { library: 'tabler', fallbackLibrary: null, style: 'filled', grid: 24, strokeWidth: 2, linecap: 'round', linejoin: 'round', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} }],
  [{ icon: { style: 'line', strokeWidth: '1.5px', linecap: 'butt', corner: 'sharp' } }, { library: 'lucide', fallbackLibrary: null, style: 'outlined', grid: 24, strokeWidth: 1.5, linecap: 'butt', linejoin: 'miter', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} }],
  [{ icons: { library: 'tabler', style: 'filled' }, icon: { style: 'line', strokeWidth: '9px' } }, { library: 'tabler', fallbackLibrary: null, style: 'filled', grid: 24, strokeWidth: 2, linecap: 'round', linejoin: 'round', color: null, assets: [], size: { sm: 16, md: 20, lg: 24 }, semantics: {} }],
]

test('图标系统:不写 system 的档,spec 与 v0.11.52 逐字节相同(零破坏是硬约束)', () => {
  // ⚠ 剥掉本版新增的三个字段再比:system(选了哪套)/ form(描边型还是填充型)/ weight(字重档)。
  //   它们是**新增**而不是改动 —— 取值另行断言,别让「多了一个字段」把真正的回归淹掉。
  const stripSystem = (s) => { if (!s) return s; const { system, systemUnknown, form, weight, ...rest } = s; return rest }
  let checked = 0
  for (const s of allStyles()) {
    if (!(s.slug in ICONSPEC_FROZEN)) continue // 新加的内置档不算回归,跳过(下面有对照组)
    const spec = design.iconSpec(parseStyleTokens(fs.readFileSync(s.path, 'utf8')))
    assert.deepEqual(stripSystem(spec), ICONSPEC_FROZEN[s.slug], `${s.slug} 的图标声明被这次改动动了`)
    if (spec) {
      assert.equal(spec.system, null, `${s.slug} 没写 system,却读出了一套系统 —— 那是凭空替作者做主`)
      assert.equal(spec.form, 'stroke', `${s.slug} 没选系统时挂的是描边型库,form 必须如实是 stroke`)
      assert.equal(spec.weight, 'regular', `${s.slug} 没声明字重就该是 regular`)
      assert.equal(spec.systemUnknown, null, `${s.slug} 没写 system,不该有「认不出的名字」`)
    }
    checked++
  }
  // 对照组:内置档一份都没扫到时,上面的循环零次也是「全绿」,与真的全通过一模一样
  assert.ok(checked >= 16, `只对上了 ${checked} 份内置档 ⇒ 本次比对无效,不是「全通过」`)
  for (const [tokens, want] of ICONSPEC_BASELINE_FIXTURES) {
    assert.deepEqual(stripSystem(design.iconSpec(tokens)), want, `手写档 ${JSON.stringify(tokens)} 的 spec 变了`)
  }
})

// ⭐ 2026-08-25 结构纠正(产品决定):**图标库与设计风格平级** —— `system` 的家从风格档搬到
//   项目的 design/icons.md。取图标时两份档合并:**图标档答「图形从哪来、叫什么名」,
//   风格档答「怎么画它」**。下面每条都是能区分两种实现的实验。
const ICONS_DOC = `---
system: "tabler"
assets: "miniprogram/images/icons"
---
# 图标
正文`

test('图标档:认帧 · 顶层扁平 · 「没说兜底」与「明确不要兜底」是两回事', () => {
  assert.ok(design.isIconsDoc(ICONS_DOC))
  assert.ok(!design.isIconsDoc('---\nname: "风格"\ncolors:\n  bg: "#FFF"\n---\n'), '风格档不该被认成图标档(认错了会往别人文档上写东西)')
  assert.ok(!design.isIconsDoc('# 就是一篇普通文档'), '没有 front matter 一律不认')
  const d = design.parseIconsDoc(ICONS_DOC)
  assert.equal(d.system, 'tabler')
  assert.deepEqual(d.assets, ['miniprogram/images/icons'])
  assert.equal(d.fallbackLibrary, undefined, '没说 ⇒ undefined(不是 null)')
  assert.equal(design.parseIconsDoc('---\nsystem: "tabler"\nfallback: "none"\n---\n').fallbackLibrary, null, '明确不要 ⇒ null')
  // ⚠ 这两者混成一个,系统自带的兜底会被静默关掉 —— 而那是取不到图标时唯一的退路
  assert.equal(design.iconSpec({ icons: {} }, design.parseIconsDoc(ICONS_DOC)).fallbackLibrary, 'lucide')
  assert.equal(design.iconSpec({ icons: {} }, design.parseIconsDoc('---\nsystem: "tabler"\nfallback: "none"\n---\n')).fallbackLibrary, null)
})

test('图标档的线性/实心:三级优先 · 认不出当没说 · 供不起挡在写盘前', () => {
  const FILLED = '---\nsystem: "tabler"\nstyle: "filled"\n---\n# 图标\n项目细则:别删我\n'
  // ① 声明读得出;没声明 ⇒ undefined(**不是 'outlined'**)—— 写死默认值就等于图标档
  //    替所有没声明的项目做了主张,风格档那一级也就永远看不出「谁真的说了话」
  assert.equal(design.parseIconsDoc(FILLED).style, 'filled')
  assert.equal(design.parseIconsDoc(ICONS_DOC).style, undefined, '没写 ⇒ undefined')
  assert.equal(design.parseIconsDoc('---\nsystem: "tabler"\nstyle: "solid"\n---\n').style, 'filled', '同义词照收(与风格档同一张表)')

  // ② 认不出的词当没说 + 留痕:静默归一成线性的话,档里写着 `sold`(少个 i)的人
  //    会一直以为自己选的是实心 —— 同 fallbackUnknown 那条纪律
  const bad = design.parseIconsDoc('---\nsystem: "tabler"\nstyle: "sold"\n---\n')
  assert.equal(bad.style, undefined)
  assert.equal(bad.styleUnknown, 'sold', '认不出要留痕给界面标注,不能悄悄咽下去')

  // ③ ⭐⭐ 优先级:风格档 > 图标档 > 默认。**这三条是整个改动的要害** ——
  //    若拿 `_icWord` 的返回值反推「有没有声明」,「风格档没写」会被当成「写了 outlined」,
  //    图标档那一级永远轮不到,下面第一条就会红。
  const proj = design.parseIconsDoc(FILLED)
  assert.equal(design.iconSpec({ icons: {} }, proj).style, 'filled', '风格档没写 ⇒ 用图标档声明的实心')
  assert.equal(design.iconSpec({ icons: { strokeWidth: 2 } }, proj).style, 'filled', '风格档写了别的键但没写 style ⇒ 仍轮到图标档')
  assert.equal(design.iconSpec({ icons: { style: 'line' } }, proj).style, 'outlined', '风格档声明的优先(一个项目多份风格档,形态本就该各不相同)')
  assert.equal(design.iconSpec({ icons: {} }, design.parseIconsDoc(ICONS_DOC)).style, 'outlined', '两边都没写 ⇒ 默认线性')

  // ④ 写盘裁决:供不起的形态**挡在写盘前**。落了盘就成了「档里白纸黑字写着实心、
  //    取图标时静默拿到线性」—— 这条线上最贵的一类 bug(v0.11.49 两处一起骗人)
  assert.throws(() => design.iconsDocText(null, { system: 'lucide', style: 'filled' }), /没有实心/, 'lucide 一个实心图标都没有')
  assert.throws(() => design.iconsDocText(null, { system: 'tabler', style: 'zzz' }), /认不出/)
  assert.ok(design.iconsDocText(null, { system: 'tabler', style: 'filled' }).includes('style: "filled"'))

  // ⑤ 已有档:形态写得进去,而**正文逐字节保留**(人往这份档里写的细则不许被换个形态冲掉)
  const flipped = design.iconsDocText(FILLED, { system: 'tabler', style: 'outlined' })
  assert.equal(design.parseIconsDoc(flipped).style, 'outlined')
  assert.ok(flipped.includes('项目细则:别删我'), '换形态不该动正文')
  assert.ok(!/style:\s*"filled"/.test(flipped), '旧值要被换掉,不能两行 style 并存')
  // 传空 = 明确清掉(回默认线性)。⚠ 服务端因此必须在「只改系统」时把当前值原样传回,
  //    否则会把人家声明过的实心静默抹掉
  assert.equal(design.parseIconsDoc(design.iconsDocText(FILLED, { system: 'tabler', style: '' })).style, undefined)

  // ⑥ 写出去要读得回来(对所有系统),且默认不写死形态
  for (const sys of Object.keys(design.ICON_SYSTEMS)) {
    const styles = design.ICON_SYSTEMS[sys].styles || []
    assert.equal(design.parseIconsDoc(design.iconsDocText(null, { system: sys })).style, undefined, `${sys}:没要求形态就别写死它`)
    if (styles.includes('filled')) {
      assert.equal(design.parseIconsDoc(design.iconsDocText(null, { system: sys, style: 'filled' })).style, 'filled', `${sys} 供得起实心,该写得进去`)
    } else {
      assert.throws(() => design.iconsDocText(null, { system: sys, style: 'filled' }), /没有实心/, `${sys} 供不起实心,该挡下来`)
    }
  }
})

test('风格档里 icons.style 的子键级改写:只动那一行,正文与其余键逐字节保留', () => {
  // ⚠ icons 段里嵌着 size / semantics 两层子表 —— 段的结尾必须按「下一个顶层键」判,
  //    拿缩进猜会在第一个子表处提前收尾,把后面的顶层键甩进段里改坏
  const DOC = ['---', 'name: "后台"', 'colors:', '  bg: "#FFF"', 'icons:', '  style: "filled"',
    '  strokeWidth: 2', '  size:', '    sm: 12px', '    md: 14px', '  semantics:', '    back: "caret-left"',
    'typography:', '  headline:', '    fontSize: "40px"', '---', '', '# 风格', '正文:别删我'].join('\n')

  const out = design.withIconsStyleInStyleDoc(DOC, 'outlined')
  assert.match(out, /^\s+style: "outlined"$/m, 'style 改掉了')
  assert.ok(!/style: "filled"/.test(out), '旧值不能残留')
  for (const keep of ['name: "后台"', '  bg: "#FFF"', '  strokeWidth: 2', '    sm: 12px', '    back: "caret-left"', 'typography:', '    fontSize: "40px"'])
    assert.ok(out.includes(keep), `其余键必须原样保留:${keep}`)
  assert.ok(out.includes('# 风格\n正文:别删我'), '正文逐字节保留')
  // ⭐ 顶层键没被卷进 icons 段:typography 仍在 style 行之后、且仍是顶层(行首无空格)
  assert.match(out, /^typography:$/m, 'typography 仍是顶层键')

  // 清空 = 删掉那一行,别的不动
  const cleared = design.withIconsStyleInStyleDoc(DOC, '')
  assert.ok(!/style:/.test(cleared.split('---')[1]), '声明已删除')
  assert.ok(cleared.includes('  strokeWidth: 2') && cleared.includes('正文:别删我'))

  // 没有 icons 段时:要设就补一段,要清则原样返回(别凭空造出空段)
  const NOIC = '---\nname: "甲"\n---\n\n# 风格\n'
  assert.match(design.withIconsStyleInStyleDoc(NOIC, 'filled'), /icons:\n\s+style: "filled"/)
  assert.equal(design.withIconsStyleInStyleDoc(NOIC, ''), NOIC, '本来就没声明,要清就是无事可做')
  // 不是风格档(无 front matter)⇒ null,交调用方处理,别把普通文件改坏
  assert.equal(design.withIconsStyleInStyleDoc('# 就是一篇普通文档', 'filled'), null)

  // ⭐ style 排在**嵌套子表之后**时才区分得开「按顶层键判段尾」与「按缩进判」——
  //    上面那份档 style 在最前面,两种写法结果恰好一样(变异检验实测这一条活了下来,
  //    说明原用例对它没有分辨力)。缩进版会在 `    sm:` 处提前收尾 ⇒ 段内找不到 style,
  //    于是**再补一行**,档里两行 style 并存,而 YAML 读到的是后一行 —— 界面显示改了、实际没改。
  const AFTER = ['---', 'icons:', '  size:', '    sm: 12px', '    md: 14px', '  style: "filled"',
    '  strokeWidth: 2', 'typography:', '  headline: "x"', '---', '', '# 风格', '正文'].join('\n')
  const o2 = design.withIconsStyleInStyleDoc(AFTER, 'outlined')
  assert.equal((o2.match(/^\s+style\s*:/gm) || []).length, 1, 'style 行必须只剩一行 —— 两行并存时读到的是后一行,界面与事实会分家')
  assert.match(o2, /^\s+style: "outlined"$/m)
  assert.equal(design.iconSpec(design.parseStyleTokens(o2)).style, 'outlined', '读回来必须是新值')
  assert.match(o2, /^typography:$/m, 'typography 仍是顶层键')

  // 改完要能被自己读回来(写出去读不回来是最蠢的一种坏)
  assert.equal(design.iconSpec(design.parseStyleTokens(out)).style, 'outlined')
  assert.equal(design.iconSpec(design.parseStyleTokens(design.withIconsStyleInStyleDoc(DOC, 'filled'))).style, 'filled')
})

test('两档合并:图标档答「图形从哪来」,风格档答「怎么画它」', () => {
  const proj = design.parseIconsDoc(ICONS_DOC)
  const s = design.iconSpec({ icons: { strokeWidth: 1.5, linecap: 'butt', style: 'line', size: { sm: 14, md: 18 } } }, proj)
  // 图标档那半
  assert.equal(s.system, 'tabler'); assert.equal(s.library, 'tabler'); assert.equal(s.fallbackLibrary, 'lucide')
  assert.equal(design.resolveIconName('more', s), 'dots', '词表跟着系统走')
  assert.deepEqual(s.assets, ['miniprogram/images/icons'], 'assets 的家是图标档(它是项目事实)')
  // 风格档那半
  assert.equal(s.strokeWidth, 1.5); assert.equal(s.linecap, 'butt'); assert.equal(s.style, 'outlined')
  assert.deepEqual(s.size, { sm: 14, md: 18 })
  // 同一份图标档配另一套风格 ⇒ 图形来源不变、画法变。**这就是拆开绑定要买到的东西**
  const s2 = design.iconSpec({ icons: { strokeWidth: 2, linecap: 'round' } }, proj)
  assert.equal(s2.library, 'tabler'); assert.equal(design.resolveIconName('more', s2), 'dots')
  assert.equal(s2.strokeWidth, 2); assert.equal(s2.linecap, 'round')
})

test('两档合并:风格档里写 system 一个字都不起作用(绑定确实拆开了)', () => {
  // ⚠ 能区分两种实现:若 system 还从风格档读,下面 library 会是 tabler、词表会是 tabler 的
  const s = design.iconSpec({ icons: { system: 'tabler' } })
  assert.equal(s.system, null, '风格档的 system 不再是图标来源 —— 换风格不该换掉图标')
  assert.equal(s.library, 'lucide', '退回老路(按 style 定库),不是挂上 tabler')
  assert.deepEqual(s.semantics, {}, '也不该拿到 tabler 的词表')
  // 对照组:同样的 system 写在**图标档**里就必须生效,否则上面的 null 可能只是「整个功能没接上」
  const ok = design.iconSpec({ icons: {} }, design.parseIconsDoc(ICONS_DOC))
  assert.equal(ok.library, 'tabler'); assert.equal(design.resolveIconName('more', ok), 'dots')
})

test('两档合并:只有图标档、风格档没写过图标 ⇒ 仍然算启用', () => {
  // 项目选了图标系统,画法退回默认即可 —— 这时报「未启用图标体系」会把人引去改风格档
  const s = design.iconSpec({}, design.parseIconsDoc(ICONS_DOC))
  assert.ok(s, '有图标档就算启用')
  assert.equal(s.library, 'tabler'); assert.equal(s.strokeWidth, 2, '画法退回默认')
  assert.equal(design.iconSpec({}, null), null, '两边都没有才是 null(没依据就不报)')
})

test('两档合并:历史遗留 —— 没有图标档时,风格档里的 library / assets 仍然认', () => {
  // DemoApp 两份档已经这么写着,当场作废等于把生产项目的图标来源掐掉
  const s = design.iconSpec({ icons: { library: 'tabler', fallbackLibrary: 'lucide', assets: 'images/icons' } })
  assert.equal(s.library, 'tabler'); assert.equal(s.fallbackLibrary, 'lucide')
  assert.deepEqual(s.assets, ['images/icons'])
  // 有图标档时以图标档为准
  const s2 = design.iconSpec({ icons: { library: 'lucide', assets: 'old/dir' } }, design.parseIconsDoc(ICONS_DOC))
  assert.equal(s2.library, 'tabler', '图标档赢')
  assert.deepEqual(s2.assets, ['miniprogram/images/icons'])
})

test('iconSourceConflict:风格档里那行旧 library 已经不起作用 ⇒ 必须出声', () => {
  // ⚠ 「两个消费者读不同来源」不出声,就会有一个长期正确、掩护另一个长期失效(教训 26):
  //   那行 library 看着好好的,实际一个字都不管用,人还会照着它排查
  const proj = design.parseIconsDoc(ICONS_DOC)
  const tokens = { icons: { library: 'lucide', strokeWidth: 1.5 } }
  const msg = design.iconSourceConflict(design.iconSpec(tokens, proj), tokens, 'design/icons.md') || ''
  assert.match(msg, /library/, '要点名是哪一行不管用了')
  assert.match(msg, /design\/icons\.md/, '也要说清现在谁说了算')
  // 只写画法的风格档 = 正常分工,不该有任何提示(误报会让整条提示被无视)
  assert.equal(design.iconSourceConflict(design.iconSpec({ icons: { strokeWidth: 1.5 } }, proj), { icons: { strokeWidth: 1.5 } }, 'design/icons.md'), null)
  // 没有图标档时也不提示 —— 那时风格档里那行是**真在起作用**的
  assert.equal(design.iconSourceConflict(design.iconSpec(tokens), tokens, 'design/icons.md'), null)
})

test('图标档:认不出的系统名 = 当没选(不半信半疑地拿它去查表)', () => {
  // ⚠ 用一个**确实不存在**的名字:这条原先拿 phosphor 当反例,而 phosphor 后来成了真系统 ——
  //   反例被扶正,测试就从「认不出的名字要落 null」悄悄变成了「phosphor 要落 null」。
  const s = design.iconSpec({ icons: { style: 'solid' } }, { system: 'nonesuch-icons', assets: [] })
  assert.equal(s.system, null)
  assert.equal(s.library, 'tabler', '退回「按 style 定库」那条老路,不是挂在一套不存在的系统上')
  assert.deepEqual(s.semantics, {}, '认不出就一个词都别给 —— 给错词表比不给更糟')
})

test('composeIconsDoc:落盘的档必须能被自己读回来(写出去读不回来是最蠢的一种坏)', () => {
  for (const sys of Object.keys(design.ICON_SYSTEMS)) {
    const text = design.composeIconsDoc({ system: sys, assets: 'a/b' })
    assert.ok(design.isIconsDoc(text), `${sys} 写出来的档认不出是图标档`)
    const back = design.parseIconsDoc(text)
    assert.equal(back.system, sys)
    assert.deepEqual(back.assets, ['a/b'])
    assert.equal(back.fallbackLibrary, undefined, '没要求关兜底就别写死它')
    assert.equal(design.parseIconsDoc(design.composeIconsDoc({ system: sys, fallback: 'none' })).fallbackLibrary, null)
    // ⚠ **正文不许复述「这是哪套系统」** —— 换系统时正文是逐字节保留的(人往里写的细则不许被冲掉),
    //   复述一遍就成了同一件事的第二份拷贝:front matter 改了、正文没改,档里两句话当场互相矛盾。
    //   真机撞到过:front matter 写着 lucide,正文还在说「本项目用 Pixelarticons」。
    const body = text.split('---')[2] || ''
    for (const [k, v] of Object.entries(design.ICON_SYSTEMS)) {
      assert.ok(!body.includes(v.label), `${sys} 的正文里出现了系统名「${v.label}」—— 换系统后它就是假话`)
      assert.ok(!new RegExp('\\b' + k + '\\b').test(body), `${sys} 的正文里出现了系统名「${k}」`)
    }
    assert.ok(body.includes('system'), '对照组:正文要指向 front matter 的 system(否则上面的「不含」可能只是正文空了)')
    // ⚠ 落出去的档是给人看的:不许漏出内部值,也不许说假话。真机上「就用第 4 个」落出来的档里
    //   曾写着「取不到时不去 null 兜底(默认会兜)」—— 而 pixelart 根本不兜。
    assert.ok(!text.includes('null'), `${sys} 的档里漏出了 null`)
    if (!design.ICON_SYSTEMS[sys].fallbackLibrary) {
      assert.ok(!/默认会兜/.test(text), `${sys} 没有兜底库,档里却写着「默认会兜」—— 那是假话`)
      assert.match(text, /没有兜底库/, '没有兜底就要如实说,别让人以为取不到会自动换一家')
    }
  }
  assert.throws(() => design.composeIconsDoc({ system: 'nonesuch-icons' }), /没有名为/, '认不出的系统名不许落盘')
})

test('iconSystemGap:系统给不了的 style ⇒ 那些图全从兜底库来,「选了系统」当场作废', () => {
  const proj = design.parseIconsDoc('---\nsystem: "lucide"\n---\n')
  const spec = design.iconSpec({ icons: { style: 'filled' } }, proj)
  const dirs = [{ lib: 'tabler', dir: '/x/@tabler/icons/filled', style: 'filled' }, { lib: 'lucide', dir: '/x/lucide-static/icons', style: 'outlined' }]
  const msg = design.iconSystemGap(spec, dirs) || ''
  assert.match(msg, /Lucide/, '要说清是哪套系统被架空了')
  assert.match(msg, /兜底库 Tabler/, '要说清这些图**实际从哪来**(原来写成 /Tabler|tabler/,被「换成 tabler」那半句也满足 ⇒ 没有分辨力)')
  assert.doesNotMatch(msg, /icons\.system/, '别教人去改风格档的 system —— 本版起它一个字都不起作用')
  // 换成供得起实心的系统就该闭嘴
  const tProj = design.parseIconsDoc('---\nsystem: "tabler"\n---\n')
  assert.equal(design.iconSystemGap(design.iconSpec({ icons: { style: 'filled' } }, tProj), dirs), null)
  // ⚠ 这条是变异检验补出来的,也是最容易错的一格:**系统支持的 style 一律闭嘴**,
  //   哪怕兜底库同类目录就排在后面 —— 判据若只看「有没有兜底能供这一类」,
  //   那么每一次正常的 tabler 线性取图都会跳出一句「等于没选 Tabler」(真实 iconDirs 的
  //   线性排序正是 tabler/outline → lucide/icons)。误报会让整条提示被无视(v0.11.29 同理)。
  const outlinedDirs = [{ lib: 'tabler', dir: '/x/@tabler/icons/outline', style: 'outlined' }, { lib: 'lucide', dir: '/x/lucide-static/icons', style: 'outlined' }, { lib: 'tabler', dir: '/x/@tabler/icons/filled', style: 'filled' }]
  assert.equal(design.iconSystemGap(design.iconSpec({ icons: {} }, tProj), outlinedDirs), null,
    'tabler 系统取线性是它的本行,不该有任何提示')
  // 没选系统 = 这条整个不适用(没选过,谈不上被架空)
  assert.equal(design.iconSystemGap(design.iconSpec({ icons: { style: 'filled' } }), dirs), null)
  // 兜底供不上时不抢话 —— 那是 iconStyleGap 那条更具体的路(「你会拿到线性」)
  const noFill = [{ lib: 'lucide', dir: '/x/lucide-static/icons', style: 'outlined' }]
  assert.equal(design.iconSystemGap(spec, noFill), null, '两条同时喊会把人绕晕')
  assert.match(design.iconStyleGap(spec, noFill) || '', /实心/, '而那条必须真的在喊,否则这里的沉默就成了漏报')
})

test('iconIsFilled:实心与否按源文件的 fill 判(声明是意图,取到哪张图才算数)', () => {
  assert.equal(design.iconIsFilled(LUCIDE_SVG), false, 'fill="none" 的线性图')
  assert.equal(design.iconIsFilled(TABLER_SVG), false)
  const FILLED = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h14"/></svg>'
  assert.equal(design.iconIsFilled(FILLED), true)
  assert.equal(design.iconIsFilled(''), false, '取不到图时别说它是实心')
  // 同一判据必须只有一处:归一改写也靠它决定用哪套属性 —— 这里顺手钉住两者不会分家
  const out = design.normalizeIconSvg(FILLED, design.iconSpec({ icons: { style: 'filled' } }), { size: 20 })
  assert.match(out, /fill="currentColor"/, '实心图不该被套上 fill:none + stroke-width')
  assert.ok(!/stroke-width/.test(out))
})

// 图标库那张列表的样张。⚠ 头等不变量:**「实心」那排必须真是实心** —— 用普通查找顺序取的话,
// 没有实心版的名字会静默落回线性目录,于是那一排里混着线性图,等于拿线性冒充实心
// (实测 tabler 的实心只覆盖词表 62 条里的 48 条,这不是边角情况)。
test('图标库样张:线性排与实心排按源文件的 fill 分得干干净净(装了图标库才跑)', (t) => {
  const roots = design.iconRoots({ base: path.join(__dirname, '..', '..') })
  if (!roots.lucide || !roots.tabler) return t.skip('本机没装图标包 —— 这条只在装了库的机器上有意义')
  const ps = design.iconSystemPreviews({ roots })
  assert.ok(ps.length >= 2, '一套都没出 ⇒ 本次无效')
  let checkedFilled = 0, checkedStroke = 0
  for (const p of ps) {
    assert.ok(p.icons.length > 0, `${p.system} 一个线性样张都没有`)
    // ⚠ **判据按库的形态分流**:`fill=none + stroke` 只是**描边型**库表达「线性」的方式;
    //   填充型库(phosphor / pixelart)的线性档本身就是 fill=currentColor 的填充路径 ——
    //   拿描边型那把尺子量它,量出来的每一条都是误报。这正是 form 这个字段存在的理由。
    const form = (design.ICON_LIBS[p.library] || {}).form
    if (form === 'stroke') {
      for (const i of p.icons) assert.equal(design.iconIsFilled(i.svg), false, `${p.system} 是描边型,线性排里却混进了实心图 ${i.name}`)
      checkedStroke++
    }
    if (!p.styles.includes('filled')) { assert.equal(p.filled.length, 0, `${p.system} 不支持实心,却出了实心样张`); continue }
    assert.ok(p.filled.length > 0, `${p.system} 支持实心却一个实心样张都没有`)
    if (form === 'stroke') for (const i of p.filled) assert.equal(design.iconIsFilled(i.svg), true, `${p.system} 的实心排里混进了线性图 ${i.name} —— 那是拿线性冒充实心`)
    // ⭐ 对**每一种**形态都成立的那条:同一个语义名,两排的图形必须**真的不同**。
    //   否则「实心排」只是把线性排又画了一遍 —— 而那种失败在界面上看着完全正常。
    for (const f of p.filled) {
      const line = p.icons.find((i) => i.sem === f.sem)
      if (!line) continue
      assert.notEqual(line.svg, f.svg, `${p.system} 的 ${f.sem}:实心排与线性排是同一张图 ⇒ 那一排等于没画`)
      checkedFilled++
    }
  }
  // 对照组:一条都没核过时,上面的循环全绿与真通过一模一样
  assert.ok(checkedFilled > 0, '一个实心样张都没核 ⇒ 本次扫描无效')
  assert.ok(checkedStroke > 0, '一套描边型库都没扫到 ⇒ 那半边判据本次没跑')
  // 同一个语义名,两套系统必须给出不同的图标名 —— 这排图存在的理由就是让这件事看得见
  const [a, b] = ps
  const nameOf = (p, sem) => (p.icons.find((i) => i.sem === sem) || {}).name
  assert.notEqual(nameOf(a, 'more'), nameOf(b, 'more'), '两套的「更多」叫法相同 ⇒ 这排样张证明不了任何事')
})

// ⚠ 下面四条都是**变异检验逼出来的**:改坏对应的代码时测试全绿,说明这四件事此前没人管。
// 群里那张对照图。⚠ **它会被发进群**,所以两条硬约束:带序号(让人指着选)· 一个命令名都不许有
//   (用户面零工具名 —— 对群成员而言产品只有 SintBot 一个身份)。
test('图标系统对照图:带序号 · 标出当前 · 图里不出现任何命令名', () => {
  const fake = [
    { system: 'aa', label: 'AA', form: 'stroke', styles: ['outlined'], count: 100, installed: true, icons: [{ sem: 'more', name: 'dots', svg: '<svg></svg>' }], filled: [] },
    { system: 'bb', label: 'BB', form: 'fill', styles: ['outlined', 'filled'], weights: ['a', 'b'], count: 200, installed: true, icons: [{ sem: 'more', name: 'x', svg: '<svg></svg>' }], filled: [{ sem: 'more', name: 'x', svg: '<svg></svg>' }] },
  ]
  const html = design.iconSheetHtml(fake, { current: 'bb' })
  assert.match(html, /class="no">1</, '每套要有序号 —— 群里说「用第 N 个」比让人打英文名靠谱')
  assert.match(html, /class="no">2</)
  assert.match(html, /当前/, '当前用的那套必须标出来')
  assert.match(html, />AA</); assert.match(html, />BB</)
  assert.match(html, /这套没有实心/, '不支持实心的要如实说,别把那一排空着')
  // ⚠ 零工具名:图会进群 —— 出现命令名就把「产品只有 SintBot 一个身份」这件事破了
  for (const bad of ['sbot ', 'design icons', 'npm ', '--sheet', '.md']) {
    assert.ok(!html.includes(bad), `对照图里出现了 ${bad} —— 群成员看到的产品里不该有命令名/文件名`)
  }
  // 未装的库要如实说,不留空白(空白会被读成「这套是空的」)
  assert.match(design.iconSheetHtml([{ ...fake[0], installed: false }], {}), /还没装/)
  // 转义:label 来自定义表,但这段以后可能接别处的输入 —— 先把口子堵上
  assert.ok(!design.iconSheetHtml([{ ...fake[0], label: '<img src=x>' }], {}).includes('<img src=x>'))
})

test('图标系统:兜底库必须与主库参数同构(不同构的兜底 = 画风当场突变)', () => {
  // 判据机械可得:形态(描边型/填充型)与网格都相同才算同构 —— 混用看不出来才谈得上兜底。
  // ⚠ 反例正是 phosphor:256 网格填充型,配 lucide(24 网格描边型)当兜底,
  //   取不到的那几个名字会冒出一枚气质完全不同的图,**比缺一张图难看得多**。
  let checked = 0
  for (const [name, sys] of Object.entries(design.ICON_SYSTEMS)) {
    if (!sys.fallbackLibrary) continue
    const a = design.ICON_LIBS[sys.library], b = design.ICON_LIBS[sys.fallbackLibrary]
    assert.equal(b.form, a.form, `${name} 的兜底库形态与主库不同(${a.form} vs ${b.form})⇒ 混出来一眼看得出`)
    assert.equal(b.grid, a.grid, `${name} 的兜底库网格与主库不同(${a.grid} vs ${b.grid})`)
    checked++
  }
  assert.ok(checked > 0, '没有一套系统配了兜底 ⇒ 这条本次没跑')
})

test('图标系统:字重要真取到那一档的文件(要 bold 就不能给 regular)', (t) => {
  const roots = design.iconRoots({ base: path.join(__dirname, '..', '..') })
  const multi = Object.entries(design.ICON_SYSTEMS).find(([, s]) => (s.weights || []).length > 1)
  if (!multi || !roots[multi[1].library]) return t.skip('本机没装带字重的图标包 —— 这条只在装了库的机器上有意义')
  const [name, sys] = multi
  const mk = (w) => design.iconSpec({ icons: w ? { weight: w } : {} }, { system: name, assets: [] })
  const get = (w) => design.readIcon('settings', mk(w), design.iconDirs(mk(w), roots), {})
  const reg = get(null), bold = get('bold')
  assert.ok(reg && bold, `${name} 的 regular / bold 至少一档取不到`)
  // ⭐ 判据是**几何真的不同**:字重档若只是排序靠前、取到的仍是同一个文件,那这一维等于没做
  assert.notEqual(reg.svg, bold.svg, `${name} 声明 bold 却拿到了与 regular 一模一样的图 ⇒ 字重没生效`)
  assert.equal(bold.weight, 'bold', '取回来的要如实报是哪一档')
  // 对照组:同一档自己比必须相同,否则上面的 notEqual 只是随机噪音
  assert.equal(get('bold').svg, bold.svg, '同一档两次取到的图不一样 ⇒ 这条判据没有分辨力')
})

test('checkIcons:填充型库不查描边三项(查了每一条都是误报)', () => {
  // ⚠ 填充型库的图形里根本没有 stroke —— 轮廓已转成填充路径。不分流的话,用这类系统的项目
  //   每份产物都会收到一串「描边 X ≠ 声明的 Y」,而报告一旦变噪音就整份被无视。
  const css = '.i{stroke-width:1.8;stroke-linecap:butt;stroke-linejoin:bevel;width:18px;height:18px;fill:none;stroke:currentColor}'
  const src = [{ rel: 'p.css', text: css }]
  const strokeSpec = design.iconSpec({ icons: { strokeWidth: 2 } }, { system: 'lucide', assets: [] })
  const fillSpec = design.iconSpec({ icons: { strokeWidth: 2 } }, { system: 'phosphor', assets: [] })
  assert.equal(strokeSpec.form, 'stroke'); assert.equal(fillSpec.form, 'fill')
  const kinds = (spec) => design.checkIcons(src, spec).map((f) => f.kind)
  // 先证明**同一份输入在描边型下确实报得出来** —— 否则下面的「一条都没有」只是因为压根没查
  const a = kinds(strokeSpec)
  assert.ok(a.includes('icon-stroke') && a.includes('icon-cap') && a.includes('icon-join'), '描边型库这三项本该报出来')
  const b = kinds(fillSpec)
  for (const k of ['icon-stroke', 'icon-cap', 'icon-join']) assert.ok(!b.includes(k), `填充型库不该报 ${k}`)
  // 与形态无关的那几类照常报(别把整类检查一起关掉)
  const c = design.checkIcons([{ rel: 'p.html', text: '<button>🔍</button>' }], fillSpec).map((f) => f.kind)
  assert.ok(c.includes('icon-emoji'), '与描边无关的检查在填充型库上照常生效')
  // ⭐ **必须走真实入口再验一遍**:上面测的是手工造的 spec,而 `design check` 走的是 checkDesign ——
  //   它一度**没把项目的图标档传下去**,造出来的 spec 恒是描边型,于是填充型系统的项目每份产物都会
  //   收到一串假的「描边不合规」。单测全绿、真机端到端才撞出来 ⇒ 判据要钉在**调用方真会走的那条路**上。
  // ⚠ 同一条线上的第二处:`tokenDigest` 是**注入给 agent 的那行摘要** —— 不传图标档,
  //   它会对着用 phosphor 的项目说「图标 lucide」,而 agent 只信清单。
  const tk = { colors: { bg: '#FFFFFF' }, icons: { strokeWidth: 2 } }
  assert.match(design.tokenDigest(tk, { project: { system: 'phosphor', assets: [] } }), /图标 phosphor/)
  assert.doesNotMatch(design.tokenDigest(tk, { project: { system: 'phosphor', assets: [] } }), /描边 2/, '填充型库没有描边可言,报了就是假话')
  assert.match(design.tokenDigest(tk), /图标 lucide/, '对照组:不指名时仍是老行为(先证明这条断言分得出来)')
  assert.match(design.tokenDigest(tk), /描边 2/)
  const kindsVia = (project) => design.checkDesign(src, { icons: { strokeWidth: 2 } }, { project }).findings.map((f) => f.kind)
  const viaStroke = kindsVia({ system: 'lucide', assets: [] })
  assert.ok(viaStroke.includes('icon-stroke'), '描边型走 checkDesign 本该报得出来(先证明这条路真在查)')
  for (const k of ['icon-stroke', 'icon-cap', 'icon-join']) {
    assert.ok(!kindsVia({ system: 'phosphor', assets: [] }).includes(k), `填充型走 checkDesign 仍报了 ${k} —— 图标档没传到底`)
  }
})

test('图标系统定义表:自身的三条不变量(词表写错 = 那条语义永远取不到)', () => {
  const keysets = []
  for (const [name, sys] of Object.entries(design.ICON_SYSTEMS)) {
    assert.ok(design.ICON_LIBS[sys.library], `${name} 的主库 ${sys.library} 不在 ICON_LIBS 里`)
    assert.ok(!sys.fallbackLibrary || design.ICON_LIBS[sys.fallbackLibrary], `${name} 的兜底库不在 ICON_LIBS 里`)
    assert.ok(sys.styles.length, `${name} 一种 style 都不支持`)
    for (const [k, v] of Object.entries(sys.semantics)) {
      // resolveIconName 会拒掉不合法的名字(要拼进文件路径,教训 7)⇒ 词表里写个非法名,
      // 症状是「按语义名取图标,系统说两个库里都没有」
      assert.equal(design.resolveIconName(k, sys), v, `${name} 的语义名 ${k} → ${v} 过不了白名单`)
    }
    keysets.push([name, new Set(Object.keys(sys.semantics))])
  }
  assert.ok(keysets.length >= 2, '至少要有两套系统,否则「选一套」无从谈起')
  // ⚠ 这条原先只比前两套(`const [[n0,s0],[n1,s1]] = keysets`)—— 新加的系统它**根本没看**,
  //   看着像在管所有系统,实际只管两套。改成:**每一套都必须覆盖核心词**。
  // ⚠ 判据不是「所有系统键集合相同」:库与库的覆盖面本就不同(pixelart 里没有 medal、
  //   也没有圆圈态的对勾/叉),硬要求一致只会逼出「硬塞一个形近的图标」——
  //   而那是「做了 A 让人以为做了 B」。核心词之外缺就缺,按语义名取时会如实报「这个库里没有」。
  const CORE = ['back', 'forward', 'close', 'search', 'settings', 'user', 'add', 'edit', 'delete',
    'check', 'more', 'menu', 'home', 'download', 'share', 'notification', 'lock', 'calendar', 'heart', 'star']
  for (const [name, set] of keysets) {
    for (const k of CORE) assert.ok(set.has(k), `图标系统 ${name} 缺核心语义名 ${k} ⇒ 换到它就丢词`)
  }
  assert.ok(keysets.length >= 4, `只扫到 ${keysets.length} 套系统 ⇒ 新加的那两套没被这条覆盖`)
})

// 词表里的名字必须在**真实库文件**里存在。⚠ 两个包共 56.5MB、不随 sbot 分发 ⇒ CI 上没有它们,
// 这条只能在装了库的机器上跑。**宁可显式 skip,也不静默全绿**(那就是空测试的长相)。
test('图标系统:每条语义名在自己主库里都真有这个文件(装了图标库才跑)', (t) => {
  const roots = design.iconRoots({ base: path.join(__dirname, '..', '..') })
  if (!roots.lucide || !roots.tabler) return t.skip('本机没装 lucide-static / @tabler/icons —— 这条只在装了库的机器上有意义')
  let checked = 0
  for (const [name, sys] of Object.entries(design.ICON_SYSTEMS)) {
    const dirs = design.iconDirs({ style: 'outlined', library: sys.library, fallbackLibrary: null }, roots)
    assert.ok(dirs.length, `${name} 的主库目录没找到`)
    for (const [k, v] of Object.entries(sys.semantics)) {
      assert.ok(dirs.some((d) => fs.existsSync(path.join(d.dir, v + '.svg'))),
        `${name} 的语义名 ${k} → ${v} 在 ${sys.library} 里没有这个文件 ⇒ 按它取图标会拿到「两个库里都没有」`)
      checked++
    }
  }
  assert.ok(checked > 0, '一条都没核 ⇒ 本次扫描无效')
  // 对照组:一个必然不存在的名字必须查不到,否则上面的 existsSync 就是恒真(路径拼错时全绿)
  const d0 = design.iconDirs({ style: 'outlined', library: 'lucide', fallbackLibrary: null }, roots)
  assert.ok(!d0.some((d) => fs.existsSync(path.join(d.dir, 'zzz-not-a-real-icon.svg'))), '对照组命中了 ⇒ 判据没有分辨力')
})

test('icons: icons 段不许污染角色判定(教训 13 —— 进 colors 就会抢走 accent)', () => {
  const tk = design.parseStyleTokens(ICONS_FM)
  const roles = design.styleRoles(tk.colors)
  assert.equal(roles.accent, '#1B6B37', 'accent 必须仍是作者点的那个色')
  assert.ok(!Object.keys(tk.colors).includes('icons'), 'icons 必须住顶层,不能落进 colors')
})

test('icons: 取图标 —— 主库命中,语义名先经 semantics 翻译', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const dirs = [{ lib: 'lucide', dir: '/L' }, { lib: 'tabler', dir: '/T' }]
  const readFile = (p) => (p === '/L/chevron-left.svg' ? LUCIDE_SVG : null)
  const got = design.readIcon('back', spec, dirs, { readFile })   // back → chevron-left
  assert.ok(got, '语义表里的 back 必须翻成 chevron-left 并取到')
  assert.equal(got.lib, 'lucide')
  assert.equal(got.name, 'chevron-left')
})

test('icons: 主库没有的名字自动落到兜底库(双库是不是真接上了)', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const dirs = [{ lib: 'lucide', dir: '/L' }, { lib: 'tabler', dir: '/T' }]
  const readFile = (p) => (p === '/T/brand-x.svg' ? TABLER_SVG : null) // 主库没有
  const got = design.readIcon('brand-x', spec, dirs, { readFile })
  assert.ok(got, '主库取不到时必须去兜底库')
  assert.equal(got.lib, 'tabler')
  const miss = design.readIcon('nope-nope', spec, dirs, { readFile })
  assert.equal(miss, null, '两个库都没有 ⇒ 如实返回空,不要瞎给一个')
})

test('icons: 归一 —— 剥掉 tabler 占位框、改写描边与尺寸、viewBox 原样保留', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const out = design.normalizeIconSvg(TABLER_SVG, spec, { size: 18 })
  assert.ok(!/M0 0h24v24H0z/.test(out), '占位框必须剥掉 —— 它是命中区不是图形')
  assert.match(out, /d="M4 4l11\.733 16h4\.267/, '真正的图形 path 必须留着')
  assert.match(out, /width="18"/); assert.match(out, /height="18"/)
  assert.match(out, /viewBox="0 0 24 24"/, 'viewBox 是坐标系,不能跟着尺寸改')
  assert.match(out, /stroke-width="2"/)
})

test('icons: 归一按风格档改写描边 —— 风格档写 1.5 就输出 1.5(不是原样吐文件)', () => {
  const spec = design.iconSpec({ icons: { library: 'lucide', strokeWidth: 1.5 } })
  const out = design.normalizeIconSvg(LUCIDE_SVG, spec, { size: 24 })
  assert.match(out, /stroke-width="1\.5"/)
  assert.ok(!/stroke-width="2"/.test(out))
})

test('icons: 无障碍名默认就位 —— 装饰用 aria-hidden,给了 label 则 aria-label + role', () => {
  const spec = design.iconSpec({ icons: { library: 'lucide' } })
  const plain = design.normalizeIconSvg(LUCIDE_SVG, spec, { size: 18 })
  assert.match(plain, /aria-hidden="true"/, '默认装饰性 —— 让取出来的图标天生过得了无障碍那条检查')
  const labeled = design.normalizeIconSvg(LUCIDE_SVG, spec, { size: 18, label: '返回' })
  assert.match(labeled, /aria-label="返回"/)
  assert.match(labeled, /role="img"/)
  assert.ok(!/aria-hidden/.test(labeled), '有名字了就不该再对读屏隐藏 —— 两者同时出现等于自相矛盾')
})

test('icons: sprite 输出保留版权声明(Lucide 是 ISC,要求副本保留)', () => {
  const spec = design.iconSpec({ icons: { library: 'lucide' } })
  const sprite = design.iconSpriteSvg([{ name: 'chevron-left', lib: 'lucide', svg: LUCIDE_SVG }], spec)
  assert.match(sprite, /<symbol[^>]+id="i-chevron-left"/)
  assert.match(sprite, /ISC|Lucide/i, '许可声明必须在,不能顺手删干净')
  assert.ok(!/<svg[^>]*>\s*<svg/.test(sprite), 'symbol 里不该再嵌一层 svg')
})

test('icons check: 描边不一致 —— 真实案例出在 CSS 而不是 svg 属性上', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const css = '.ui-icon{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}'
  const f = design.checkIcons([{ rel: 'p.html', text: css }], spec)
  const hit = f.filter((x) => x.kind === 'icon-stroke')
  assert.equal(hit.length, 1, '同一个值只报一条,不逐处点名')
  assert.equal(hit[0].value, 1.8)
  assert.equal(hit[0].expected, 2)
})

test('icons check: 端点/连接不一致要报', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const f = design.checkIcons([{ rel: 'a.css', text: '.i{stroke-width:2;stroke-linecap:butt;stroke-linejoin:miter}' }], spec)
  assert.ok(f.some((x) => x.kind === 'icon-cap' && x.value === 'butt'))
  assert.ok(f.some((x) => x.kind === 'icon-join' && x.value === 'miter'))
})

test('icons check: ⭐ Lucide 与 Tabler 混用不报 —— 判据是参数同构,不是库名相同', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const page = `<div>${LUCIDE_SVG}${TABLER_SVG}</div>`
  const f = design.checkIcons([{ rel: 'mix.html', text: page }], spec)
  assert.equal(f.filter((x) => x.kind === 'icon-stroke' || x.kind === 'icon-cap' || x.kind === 'icon-join').length, 0,
    '两个库都是 24 网格 / 2px / round ⇒ 混用不破坏 HIG 那条唯一无条件要求,报了就是误报')
})

test('icons check: 栅格图当操作图标要报,而大图(插画/banner)不报', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const bad = design.checkIcons([{ rel: 'a.html', text: '<img src="icon-share.png" width="20">' }], spec)
  assert.ok(bad.some((x) => x.kind === 'icon-raster'), '20px 的 png 就是拿位图当图标')
  const ok = design.checkIcons([{ rel: 'b.html', text: '<img src="banner.png" width="750">' }], spec)
  assert.equal(ok.filter((x) => x.kind === 'icon-raster').length, 0, '750px 是插画/banner —— 报它就是误报')
})

test('icons check: 缺无障碍名报一条汇总(不逐个点名,否则报告变噪音)', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const naked = '<svg class="ui-icon" viewBox="0 0 24 24"><path d="M1 1"/></svg>'
  const f = design.checkIcons([{ rel: 'a.html', text: naked.repeat(18) }], spec)
  const hit = f.filter((x) => x.kind === 'icon-a11y')
  assert.equal(hit.length, 1, '18 个缺名字 ⇒ 一条汇总')
  assert.equal(hit[0].count, 18)
  // 有 aria-hidden 或 aria-label 或 <title> 的都不算缺
  const good = '<svg aria-hidden="true"><path/></svg><svg aria-label="返回"><path/></svg><svg><title>关闭</title><path/></svg>'
  assert.equal(design.checkIcons([{ rel: 'b.html', text: good }], spec).filter((x) => x.kind === 'icon-a11y').length, 0)
})

test('icons check: 风格档没有 icons 段 ⇒ 图标类零告警(对照组:同一份产物有段时报得出来)', () => {
  const noIcons = design.iconSpec(design.parseStyleTokens(FT))
  const css = '.i{stroke-width:1.8;stroke-linecap:butt}'
  assert.equal(design.checkIcons([{ rel: 'a.css', text: css }], noIcons).length, 0, '没依据就不报')
  const withIcons = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  assert.ok(design.checkIcons([{ rel: 'a.css', text: css }], withIcons).length > 0, '对照组:有段时同一份产物必须报得出来')
})

test('icons: checkDesign 把图标类合并进来,并标出图标体系有没有启用', () => {
  const tk = design.parseStyleTokens(ICONS_FM)
  const r = design.checkDesign([{ rel: 'a.css', text: '.i{stroke-width:1.8}' }], tk)
  assert.equal(r.iconsEnabled, true)
  assert.ok(r.findings.some((f) => f.kind === 'icon-stroke'))
  const r2 = design.checkDesign([{ rel: 'a.css', text: '.i{stroke-width:1.8}' }], design.parseStyleTokens(FT))
  assert.equal(r2.iconsEnabled, false)
  assert.equal(r2.findings.filter((f) => String(f.kind).startsWith('icon-')).length, 0)
})

test('icons: 报告有图标段,并写明「尺寸差异可能是光学微调」;未启用时明说', () => {
  const tk = design.parseStyleTokens(ICONS_FM)
  const txt = design.formatCheckReport(design.checkDesign([{ rel: 'a.css', text: '.i{stroke-width:1.8}' }], tk), {})
  assert.match(txt, /描边/)
  assert.match(txt, /光学/, 'HIG 明确要求按视觉重量微调尺寸 —— 报告必须替它说这句话')
  const off = design.formatCheckReport(design.checkDesign([{ rel: 'a.css', text: '.i{stroke-width:1.8}' }], design.parseStyleTokens(FT)), {})
  assert.match(off, /未启用图标体系/)
})

test('icons: tokenDigest 带图标一行,且总长仍在预算内(清单每轮都付 token)', () => {
  const d = design.tokenDigest(design.parseStyleTokens(ICONS_FM))
  assert.match(d, /图标/)
  assert.match(d, /lucide/i)
  assert.ok(d.length < 400, '摘要必须短')
  // 没有 icons 段的档不该凭空多出图标行
  assert.ok(!/图标/.test(design.tokenDigest(design.parseStyleTokens(FT))))
})

test('icons: 找包 —— 认 sbot 自己全局目录的同级,找不到就如实为空', () => {
  const exists = (p) => p === '/opt/homebrew/lib/node_modules/lucide-static'
  const roots = design.iconRoots({ base: '/opt/homebrew/lib/node_modules/sbot', exists })
  assert.equal(roots.lucide, '/opt/homebrew/lib/node_modules/lucide-static')
  assert.equal(roots.tabler, null, '没装的库必须如实为空 —— doctor 靠它如实报')
  const none = design.iconRoots({ base: '/nowhere/sbot', exists: () => false })
  // ⚠ 按 ICON_LIBS 逐键断言,**别写死键名清单** —— 写死的话每加一套系统这条就变红,
  //   而那不是回归。判据要的是「一个都没装时每一项都为 null」。
  assert.deepEqual(Object.keys(none).sort(), Object.keys(design.ICON_LIBS).sort(), '找包结果要覆盖全部已知库')
  for (const [k, v] of Object.entries(none)) assert.equal(v, null, `${k} 没装却不是 null`)
})

test('icons: 从 git 检出目录跑也找得到 —— 认 node 自己的全局根,不是只认包的同级', () => {
  // ⚠ 真机踩过:开发检出在 ~/Projects/sbot,同级是 ~/Projects,里面当然没有图标包 ⇒
  // 「装了却说没装」。全局根 = <node 所在 bin>/../lib/node_modules(homebrew 与 nvm 同布局)。
  const exists = (p) => p === '/opt/homebrew/lib/node_modules/lucide-static'
  const r = design.iconRoots({ base: '/Users/x/Projects/sbot', execPath: '/opt/homebrew/bin/node', exists })
  assert.equal(r.lucide, '/opt/homebrew/lib/node_modules/lucide-static')
  // 显式配置优先级最高
  const r2 = design.iconRoots({ base: '/Users/x/Projects/sbot', extra: '/opt/icons', execPath: '/opt/homebrew/bin/node', exists: (p) => p === '/opt/icons/lucide-static' })
  assert.equal(r2.lucide, '/opt/icons/lucide-static')
})

test('icons: 一台机器两个 node 前缀也找得到(真机场景:包在 homebrew,跑的是 nvm 的 node)', () => {
  // 这条是能区分两种实现的实验:只按 execPath 推全局根的实现在这里必然拿到 null,
  // 而实际上包就装在 /opt/homebrew 下 —— 现象是「装了却说没装」。
  const exists = (p) => p.startsWith('/opt/homebrew/lib/node_modules/')
  const r = design.iconRoots({
    base: '/Users/x/Projects/sbot',
    execPath: '/Users/x/.nvm/versions/node/v22.22.2/bin/node',
    exists,
  })
  assert.equal(r.lucide, '/opt/homebrew/lib/node_modules/lucide-static')
  assert.equal(r.tabler, '/opt/homebrew/lib/node_modules/@tabler/icons')
})

test('icons: 实心图标不按线性那套改写 —— 否则实心图形会被画成自己的轮廓线', () => {
  // ⚠ tabler 的 filled/ 那批是 fill="currentColor" 且没有 stroke 属性,而 iconDirs 里就带着
  // 那个目录(主库没有的名字会去那儿找)⇒ 硬套 fill:none + stroke-width 必然画坏。
  const filled = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" class="icon-tabler-filled"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M8.243 7.34l-6.38 .925z"/></svg>'
  const spec = design.iconSpec({ icons: { library: 'lucide', strokeWidth: 2 } })
  const out = design.normalizeIconSvg(filled, spec, { size: 18 })
  assert.match(out, /fill="currentColor"/, '实心就得保持实心')
  assert.ok(!/stroke-width/.test(out), '实心图标上写描边毫无意义,还会描出一圈轮廓')
  assert.ok(!/fill="none"/.test(out))
  assert.ok(!/M0 0h24v24H0z/.test(out), '占位框照样要剥')
})

test('icons: 图标名必须过白名单 —— 名字要拼进文件路径,不能让 ../ 溜进去', () => {
  // 教训 7:凡 agent 够得着的入口输入一律不可信。图标名本来就是 kebab-case。
  const spec = design.iconSpec({ icons: { library: 'lucide', semantics: { evil: '../../../../etc/passwd' } } })
  assert.equal(design.resolveIconName('../../secret', spec), '', '路径穿越一律拒,不是「找不到」')
  assert.equal(design.resolveIconName('evil', spec), '', '语义表里藏的穿越同样要拦(表也可能是它自己写的)')
  assert.equal(design.resolveIconName('chevron-left', spec), 'chevron-left')
  assert.equal(design.resolveIconName('Trophy', spec), 'trophy', '大小写归一,不该因为写了大写就说没这个图标')
  let asked = null
  design.readIcon('../x', spec, [{ lib: 'lucide', dir: '/L' }], { readFile: (p) => { asked = p; return null } })
  assert.equal(asked, null, '名字非法时连读都不该发生')
})

test('icons: front matter 写成行内对象也不该造出假档位(解析器只吃缩进树)', () => {
  // `size: { sm: 16px }` 会被解析成字符串;Object.entries 一个字符串会拆成字符下标,
  // 造出 {0:…,1:…} 这种假档位还不报错 —— 必须先判类型。
  const s = design.iconSpec({ icons: { library: 'lucide', size: '{ sm: 16px, md: 18px }', semantics: 'back: chevron-left' } })
  assert.deepEqual(Object.keys(s.size).sort(), ['lg', 'md', 'sm'], '退回默认档位,而不是一串字符下标')
  assert.deepEqual(s.semantics, {})
  assert.equal(design.iconSpec({ icons: { library: 'Lucide', fallbackLibrary: 'Tabler' } }).library, 'lucide')
  assert.equal(design.iconSpec({ icons: { library: 'Lucide', fallbackLibrary: 'Tabler' } }).fallbackLibrary, 'tabler')
})

test('icons: 声明 style: filled 就要真拿到实心 —— 目录顺序按 style 排在库优先之上', () => {
  // ⚠ 实测:两个库里没有一个名字是 filled 独有的(1054 个 filled 名字 outline 里全都有)
  // ⇒ 只按库排的实现里,filled 目录永远轮不到,声明实心却拿到线性 —— 这是能区分两种实现的实验。
  const roots = { lucide: '/L', tabler: '/T' }
  const outlined = design.iconDirs(design.iconSpec({ icons: { library: 'lucide', fallbackLibrary: 'tabler', style: 'outlined' } }), roots)
  assert.equal(outlined[0].dir, '/L/icons', '线性风格:主库仍在最前')
  assert.ok(outlined.findIndex((d) => /filled/.test(d.dir)) > outlined.findIndex((d) => /outline/.test(d.dir)), '线性风格下 filled 排在 outline 之后')
  const filled = design.iconDirs(design.iconSpec({ icons: { library: 'lucide', fallbackLibrary: 'tabler', style: 'filled' } }), roots)
  assert.match(filled[0].dir, /filled/, '实心风格:实心目录必须排第一,否则 style 声明等于没写')
})

// ── emoji 当操作图标 + 线性/实心混用(v0.11.32)──────────────
// ⚠ emoji **按位置判,不按字符判**:设计参照原型实测 89/162 文件、1131 处 emoji,按字符判
// 等于一次吐 1131 条 —— 报告一旦变噪音就没人看(v0.11.29「间距/阴影不测」同一条理由)。
// 判据收成:**可交互元素里,某段文本只由 emoji 构成** ⇒ 它就是被当成图标在用。
// 「按钮文案里点缀一个 emoji」不算(那是标签的一部分,不承担图标职责)。

test('icons check: 按钮里单独一个 emoji 要报,正文里的 emoji 一个都不报', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const bad = design.checkIcons([{ rel: 'a.html', text: '<button>🔍</button>' }], spec)
  assert.ok(bad.some((x) => x.kind === 'icon-emoji'), '按钮里孤零零一个放大镜 = 拿 emoji 当图标')
  // ⭐ 这条是能区分「按位置判」与「按字符判」两种实现的实验
  const prose = '<p>今天上新 ⚡ 很多,太强了 🎉🎉</p><div>本周 👑 榜单</div>'
  assert.equal(design.checkIcons([{ rel: 'b.html', text: prose }], spec).filter((x) => x.kind === 'icon-emoji').length, 0,
    '正文里的装饰 emoji 不是操作图标 —— 报它就是在制造 1131 条噪音')
})

test('icons check: 小程序的点击绑定也算可交互(bindtap/catchtap)', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const wxml = '<view bindtap="goRec"><text>🔥</text><text>推荐</text></view>'
  assert.ok(design.checkIcons([{ rel: 'p.wxml', text: wxml }], spec).some((x) => x.kind === 'icon-emoji'),
    '小程序的可点击 view 与 web 的 button 同权 —— 只认 onclick 会把小程序整个漏掉')
})

test('icons check: 按钮文案里点缀的 emoji 不算(只有独占一段才算图标)', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const ok = '<button>开始答题 🎉</button><a href="#">查看榜单 🏆</a>'
  assert.equal(design.checkIcons([{ rel: 'c.html', text: ok }], spec).filter((x) => x.kind === 'icon-emoji').length, 0,
    'emoji 和文字同在一段 ⇒ 它是文案的一部分,不承担图标职责')
})

test('icons check: 多处 emoji 图标汇总成一条,并给例子', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const many = '<button>🔍</button><button>❤️</button><view catchtap="x"><text>⚙️</text></view>'
  const hit = design.checkIcons([{ rel: 'd.html', text: many }], spec).filter((x) => x.kind === 'icon-emoji')
  assert.equal(hit.length, 1, '按文件聚合,不逐处点名')
  assert.equal(hit[0].count, 3)
  assert.ok(hit[0].sample.length, '要给例子,否则人不知道去哪儿找')
})

test('icons check: 同一页混用线性与实心图标要报(HIG 那条 level of detail 的可测部分)', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const outline = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M1 1"/></svg>'
  const filled = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 2"/></svg>'
  const hit = design.checkIcons([{ rel: 'm.html', text: outline + filled }], spec).filter((x) => x.kind === 'icon-fillmix')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].outline, 1); assert.equal(hit[0].filled, 1)
  // 全线性 / 全实心都不报
  assert.equal(design.checkIcons([{ rel: 'o.html', text: outline + outline }], spec).filter((x) => x.kind === 'icon-fillmix').length, 0)
  assert.equal(design.checkIcons([{ rel: 'f.html', text: filled + filled }], spec).filter((x) => x.kind === 'icon-fillmix').length, 0)
})

test('icons check: 插画类 svg 不参与线性/实心判定(尺寸闸门,不做分类)', () => {
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const icon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M1 1"/></svg>'
  // 200×200 的插画带 fill —— 它不是图标,不该把整页判成「混用」
  const illo = '<svg width="200" height="200" viewBox="0 0 200 200" fill="#E5E7EB" aria-hidden="true"><circle cx="100" cy="100" r="100"/></svg>'
  assert.equal(design.checkIcons([{ rel: 'i.html', text: icon + illo }], spec).filter((x) => x.kind === 'icon-fillmix').length, 0,
    '对照组:换成 24 网格的实心图标就必须报得出来')
  const realFilled = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 2"/></svg>'
  assert.equal(design.checkIcons([{ rel: 'j.html', text: icon + realFilled }], spec).filter((x) => x.kind === 'icon-fillmix').length, 1)
})

test('icons check: emoji 判定必须走标签栈 —— 嵌套在别的元素里的按钮不许漏', () => {
  // ⚠ 真机才发现的:用「配对元素正则」`<el>(.*?)</el>` 扫,外层元素会把内层整段吞掉,
  // 于是**嵌套的可点按钮全部漏掉** —— 而现实页面里按钮几乎总是嵌套的。这条是能区分
  // 「配对正则」与「标签栈」两种实现的实验。
  const spec = design.iconSpec(design.parseStyleTokens(ICONS_FM))
  const n = (html) => design.checkIcons([{ rel: 'x.html', text: html }], spec).filter((x) => x.kind === 'icon-emoji').length
  assert.equal(n('<div class="card"><button>🔍</button></div>'), 1, '嵌在 div 里的按钮')
  assert.equal(n('<view><view bindtap="x"><text>✕</text></view></view>'), 1, '小程序两层 view')
  assert.equal(design.usedIcons('<a onclick="x"><button>🔍</button></a>').emojiIcons.length, 1, '嵌套可点元素不重复计数')
  assert.equal(design.usedIcons('<button><img src="a.png"/>🔍</button>').emojiIcons.length, 1, '自闭合标签不打乱栈')
  assert.equal(n('<div><p>正文 ⚽ 很多 🎉</p></div>'), 0, '非可点祖先里的 emoji 一个都不报')
})

// ── 图标资产体检(v0.11.49,设计系统缺口 1)────────────────────────────────────
// design check 查页面写法,这里查**图标文件本身**。三件确定性事实:颜色能不能继承 ·
// 有没有同图多份 · 参数偏不偏离声明。真机基线(DemoApp 119 个 svg):写死颜色 118、
// 图形相同 30 组 77 文件、描边 4 种、网格 7 种 —— 下面的用例都照着那些形状造。
const AUDIT_SPEC = { library: 'lucide', style: 'outlined', grid: 24, strokeWidth: 2, linecap: 'round', linejoin: 'round', size: {}, semantics: {} }
const svgIcon = (o = {}) => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="${o.vb || '0 0 24 24'}"`
  + ` fill="none" stroke="${o.stroke || 'currentColor'}" stroke-width="${o.sw == null ? 2 : o.sw}"`
  + ` stroke-linecap="${o.cap || 'round'}" stroke-linejoin="${o.join || 'round'}"><path d="${o.d || 'm9 18 6-6-6-6'}"/></svg>`

test('资产体检: 几何指纹只认图形 —— 同图不同色必须撞成一组', () => {
  const a = design.iconGeomKey(svgIcon({ stroke: '#333333' }))
  const b = design.iconGeomKey(svgIcon({ stroke: '#D4A017', sw: 1.6, cap: 'butt' }))
  assert.equal(a, b, '颜色/描边/端点都是表现属性,不该影响「是不是同一个图」')
  assert.notEqual(a, design.iconGeomKey(svgIcon({ d: 'M2 2 L4 4' })), '图形真不同就必须分开')
  assert.equal(design.iconGeomKey('<svg viewBox="0 0 24 24"></svg>'), '', '没有任何图形 ⇒ 不参与分组,空文件不该互相「重复」')
})

test('资产体检: tabler 的透明占位框要剥掉 —— 同一个图的两库版本不该判成两个', () => {
  const lucide = '<svg viewBox="0 0 24 24" stroke="currentColor"><path d="m9 18 6-6-6-6"/></svg>'
  const tabler = '<svg viewBox="0 0 24 24" stroke="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="m9 18 6-6-6-6"/></svg>'
  assert.equal(design.iconGeomKey(lucide), design.iconGeomKey(tabler))
})

test('资产体检: 写死颜色按色值聚合,currentColor 单独计数', () => {
  const res = design.auditIconAssets([
    { rel: 'a.svg', text: svgIcon({ stroke: '#333333' }) },
    { rel: 'b.svg', text: svgIcon({ stroke: '#333333', d: 'M1 1' }) },
    { rel: 'c.svg', text: svgIcon({ stroke: '#D4A017', d: 'M2 2' }) },
    { rel: 'd.svg', text: svgIcon({ d: 'M3 3' }) }, // currentColor
  ], AUDIT_SPEC)
  assert.equal(res.total, 4)
  assert.equal(res.currentColor, 1)
  assert.equal(res.hardcoded.count, 3)
  assert.deepEqual(res.hardcoded.colors, [['#333333', 2], ['#D4A017', 1]], '按出现次数降序,给的是「哪几种色最泛滥」')
})

test('资产体检: 重复副本按几何分组,组内排序稳定;省得下来几个是算出来的', () => {
  const res = design.auditIconAssets([
    { rel: 'icons/chevron-right.svg', text: svgIcon({ stroke: '#333' }) },
    { rel: 'icons/colored/chevron-right-gold.svg', text: svgIcon({ stroke: '#D4A017' }) },
    { rel: 'icons/colored/chevron-right-gray.svg', text: svgIcon({ stroke: '#999' }) },
    { rel: 'icons/heart.svg', text: svgIcon({ d: 'M5 5', stroke: '#333' }) },
  ], AUDIT_SPEC)
  assert.equal(res.dups.groups.length, 1)
  assert.deepEqual(res.dups.groups[0], ['icons/chevron-right.svg', 'icons/colored/chevron-right-gold.svg', 'icons/colored/chevron-right-gray.svg'])
  assert.equal(res.dups.files, 3)
  assert.equal(res.dups.redundant, 2, '三份同图,合并后省两个')
})

test('资产体检: 参数偏离按值聚合,没写该属性的文件不算偏离', () => {
  const res = design.auditIconAssets([
    { rel: 'ok.svg', text: svgIcon({}) },
    { rel: 'thin.svg', text: svgIcon({ sw: 1.6, d: 'M1 1' }) },
    { rel: 'fat.svg', text: svgIcon({ sw: 2.5, d: 'M2 2' }) },
    // ⚠ 实心图标本来就没有描边:没写 stroke-width 的不该被报成「描边偏离」
    { rel: 'filled.svg', text: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3"/></svg>' },
  ], AUDIT_SPEC)
  assert.equal(res.stroke.count, 2)
  assert.deepEqual(res.stroke.values.sort(), ['1.6', '2.5'])
  assert.equal(res.linecap, null, '端点都对 ⇒ 这一项整条不出现')
})

test('资产体检: 网格看 viewBox 不看 width/height(后者是渲染尺寸,本来各页各定)', () => {
  const res = design.auditIconAssets([
    { rel: 'icon.svg', text: svgIcon({}) },
    { rel: 'illo.svg', text: svgIcon({ vb: '0 0 200 200', d: 'M9 9' }) },
  ], AUDIT_SPEC)
  assert.equal(res.grid.count, 1)
  assert.deepEqual(res.grid.values, ['200×200'])
})

test('资产体检: 没有 icons 声明 ⇒ 返回 null(没依据就不做,同 checkIcons 那条纪律)', () => {
  assert.equal(design.auditIconAssets([{ rel: 'a.svg', text: svgIcon({}) }], null), null)
  assert.match(design.formatIconAuditReport(null), /未启用图标体系/)
})

test('资产体检: 报告全干净时说清楚查了什么,不留「没报=没查」的歧义', () => {
  const res = design.auditIconAssets([{ rel: 'a.svg', text: svgIcon({}) }], AUDIT_SPEC)
  const r = design.formatIconAuditReport(res, { styleName: 'X', roots: ['assets/icons'] })
  assert.match(r, /扫描 1 个 svg/)
  assert.match(r, /assets\/icons/, '扫的是哪儿必须写出来 —— 否则「没问题」可能是「扫错了目录」')
  assert.match(r, /未发现问题/)
})

// ⚠ 截断必须出声(no silent caps):列不下的组要说还有多少,否则「只列了 8 组」会被读成「只有 8 组」。
test('资产体检: 组数超上限时明说还剩多少,绝不静默截断', () => {
  const files = []
  for (let i = 0; i < 12; i++) { const d = `M${i} ${i}`; files.push({ rel: `g${i}-a.svg`, text: svgIcon({ d, stroke: '#111' }) }, { rel: `g${i}-b.svg`, text: svgIcon({ d, stroke: '#222' }) }) }
  const r = design.formatIconAuditReport(design.auditIconAssets(files, AUDIT_SPEC), {})
  assert.match(r, /图形完全相同 12 组/, '总数要如实报')
  assert.match(r, /还有 4 组未列出/, '截断了就得说漏了几组')
})

// 「几何相同」是量出来的,「冗余」是判断 —— 小程序 tabbar 的选中/未选中只能是两个图片文件、
// 改不了色,同图两色是平台强制的。把事实说成缺陷,人发现一条不成立就会连整份报告一起丢掉。
test('资产体检: 措辞只说事实,不把「几何相同」直接判成「冗余/做错了」', () => {
  const res = design.auditIconAssets([
    { rel: 'tabbar/home.svg', text: svgIcon({ stroke: '#999' }) },
    { rel: 'tabbar/home-active.svg', text: svgIcon({ stroke: '#1B6B37' }) },
  ], AUDIT_SPEC)
  const r = design.formatIconAuditReport(res, {})
  assert.doesNotMatch(r, /纯冗余/, '不许把量出来的事实说成缺陷')
  assert.match(r, /哪些该合由人定|由人来定/, '判断权必须留给人')
  assert.match(r, /不自动改/, '删图标文件不可逆,这句得在')
})

// ⚠ 连 `<svg` 都没有的文件不算进总数 —— 混着算的话「扫描 2 个 svg · 未发现问题」里有一个是
// 垃圾文件,那句话就成了假的(「没查出问题」和「根本查不了」看起来一模一样)。真机扫出来的。
test('资产体检: 不是 svg 的文件不进总数,单列说明「没查」', () => {
  const res = design.auditIconAssets([
    { rel: 'ok.svg', text: svgIcon({}) },
    { rel: 'broken.svg', text: 'not an svg at all' },
    { rel: 'README.svg', text: '# 说明' },
  ], AUDIT_SPEC)
  assert.equal(res.total, 1, '总数只算真 svg')
  assert.deepEqual(res.notSvg, ['broken.svg', 'README.svg'])
  const r = design.formatIconAuditReport(res, {})
  assert.match(r, /扫描 1 个 svg/)
  assert.match(r, /没有 `<svg>`.*\*\*没查\*\*/, '必须说清是「没查」而不是「查过没问题」')
  assert.match(r, /broken\.svg/)
})

test('资产体检: 全是真 svg 时不冒出那条噪音', () => {
  const res = design.auditIconAssets([{ rel: 'a.svg', text: svgIcon({}) }], AUDIT_SPEC)
  assert.deepEqual(res.notSvg, [])
  assert.doesNotMatch(design.formatIconAuditReport(res, {}), /没查/, '没有可疑文件就别多一行')
})

// ⚠ 2026-08-24 真机换来的:agent 用 `--sprite` 一次取 14 个图标做后台页面,吐出来的 symbol
// **没有 fill/stroke/描边/端点** —— 归一在 normalizeIconSvg 里算完了,却因为只取了正则的
// m[2](内容)而把 m[1](属性)整个丢掉。它自己手写 CSS 补齐才没出事;SVG 默认 fill 是**黑色**
// 且无描边 ⇒ 线性图标会渲染成一团黑块。⭐ 判据 = **同一条命令加不加 --sprite,渲染必须一样**。
test('icons sprite: symbol 必须带上归一后的表现属性(与单图标形态一致)', () => {
  const spec = design.iconSpec({ icons: { library: 'lucide', strokeWidth: 1.5, linecap: 'butt', linejoin: 'miter' } })
  const src = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>'
  const sprite = design.iconSpriteSvg([{ lib: 'lucide', name: 'plus', svg: src }], spec)
  const sym = /<symbol\b([^>]*)>/i.exec(sprite)[1]
  for (const [k, v] of [['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.5'], ['stroke-linecap', 'butt'], ['stroke-linejoin', 'miter']]) {
    assert.match(sym, new RegExp(`\\s${k}="${v}"`), `symbol 缺 ${k}="${v}"(风格档说了算,不是库的默认值)`)
  }
  // 尺寸不搬:sprite 的每个 use 尺寸可以不同,写死在 symbol 上就锁死了
  assert.doesNotMatch(sym, /\swidth=/, 'width 不该搬到 symbol 上')
  assert.doesNotMatch(sym, /\sheight=/, 'height 不该搬到 symbol 上')
  assert.match(sym, /viewBox="0 0 24 24"/)
})

test('icons sprite: 实心风格不该被硬套描边(判据取源文件的 fill,与单图标同一条规则)', () => {
  const spec = design.iconSpec({ icons: { library: 'tabler', style: 'filled' } })
  const filled = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h4"/></svg>'
  const sym = /<symbol\b([^>]*)>/i.exec(design.iconSpriteSvg([{ lib: 'tabler', name: 'x', svg: filled }], spec))[1]
  assert.match(sym, /fill="currentColor"/, '实心图标靠 fill 撑起图形')
  assert.doesNotMatch(sym, /stroke-width/, '实心的没有描边,硬加会把图形描成一圈轮廓')
})

// ── 布局体检(v0.11.52)────────────────────────────────────────────────────────
// 真机来源:交付前 design check 零不一致,而列表页有四处文字压在头像上 —— **「合规」和
// 「好用」是两件事**。下面的输入用的就是那次实测数字(1280 零处 / 1000 四处 / 614 一处)。
const RUN = (width, o = {}) => ({ raw: { width, leaves: 60, overlaps: [], clipped: [], small: [], pageOverflow: 0, ...o } })
const OV = (a, b, w = 13, h = 14) => ({ a, b, ae: 'SPAN.table-muted', be: 'SPAN.avatar', w, h })

test('布局体检: 同一处问题在多档宽度只报一行,并列出命中的宽度', () => {
  const res = design.mergeLayoutRuns([
    RUN(1280),
    RUN(1000, { overlaps: [OV('· 城东展厅', '林'), OV('· 城西展厅', '周')] }),
    RUN(614, { overlaps: [OV('· 城西展厅', '周', 10, 14)] }),
  ])
  assert.equal(res.findings.length, 2, '三次扫描两个问题,不是三行')
  const both = res.findings.find((f) => f.a === '· 城西展厅')
  assert.deepEqual(both.widths, [1000, 614], '两档都命中要都列出来')
  assert.deepEqual(res.widths, [1280, 1000, 614], '扫过哪几档必须留痕')
})

// ⚠ key 里不许含像素数:同一对元素在不同宽度重叠的像素当然不同,含进去就合并不掉、
//   报告又变回逐宽度刷屏 —— 这正是聚合要解决的问题。
test('布局体检: 重叠的合并键不含像素数(否则同一处会被拆成多行)', () => {
  const a = design.layoutFindings(RUN(1000, { overlaps: [OV('x', 'y', 13, 14)] }).raw)[0]
  const b = design.layoutFindings(RUN(614, { overlaps: [OV('x', 'y', 5, 9)] }).raw)[0]
  assert.equal(a.key, b.key)
})

test('布局体检: 零发现时必须点破「只覆盖扫过的宽度」', () => {
  const r = design.formatLayoutReport(design.mergeLayoutRuns([RUN(1280), RUN(430)]), { rel: 'a.html' })
  assert.match(r, /未发现问题/)
  assert.match(r, /1280 \/ 430px/, '扫了哪几档要写出来')
  assert.match(r, /只覆盖上面这几档宽度/, '「没发现」只在扫过的宽度上成立 —— 不点破就会被读成「没问题」')
})

test('布局体检: 三类确定性事实各自成句;整页溢出要过 1px 噪音门', () => {
  const res = design.mergeLayoutRuns([
    RUN(430, { overlaps: [OV('甲', '乙')], clipped: [{ el: 'DIV.wrap', by: 180 }], small: [{ el: 'BUTTON', t: '删', w: 18, h: 18 }], pageOverflow: 40 }),
    RUN(1280, { pageOverflow: 1 }), // 1px 是抗锯齿噪音,不该报
  ])
  const kinds = res.findings.map((f) => f.kind)
  assert.deepEqual(kinds, ['overlap', 'clipped', 'page-overflow', 'small'], '按严重度排序:重叠 → 裁切 → 整页溢出 → 目标偏小')
  assert.deepEqual(res.findings.find((f) => f.kind === 'page-overflow').widths, [430], '1px 那档不许混进来')
  const r = design.formatLayoutReport(res, {})
  assert.match(r, /文字重叠/); assert.match(r, /内容被裁掉/); assert.match(r, /整页横向溢出/); assert.match(r, /点击目标偏小/)
  assert.match(r, /几何事实.*不是审美意见/, '要说清它报的是事实,判断权仍在人')
})

// 探针是要注进页面执行的字符串,拼错了在真机上才会炸 —— 至少钉住它是可解析的表达式,
// 且把三类判据都问到了(⚠ 这条不能替代真机验证,真机已在 1280/1000/614 三档验过)。
test('布局体检: 探针脚本可解析,且确实问了三类判据', () => {
  assert.doesNotThrow(() => new Function('return ' + design.LAYOUT_PROBE), '探针字符串必须是合法表达式')
  for (const k of ['getBoundingClientRect', 'overflowX', 'scrollWidth', 'innerWidth']) assert.match(design.LAYOUT_PROBE, new RegExp(k))
  assert.match(design.LAYOUT_PROBE, new RegExp(String(design.LAYOUT_MIN_TARGET)), '点击目标下限要真的用上,不是写在注释里')
  // ⚠ 省略号截断是**故意的**(text-overflow:ellipsis 必须配 overflow:hidden)—— 不排掉它,
  //   每一处正常的单行省略都会被报成「内容永远看不到」。这是自测这个检查器时当场抓到的误报。
  assert.match(design.LAYOUT_PROBE, /textOverflow/, '必须把省略号截断排除在「被裁掉」之外')
  assert.match(design.LAYOUT_PROBE, /webkitLineClamp/, '行数截断同理')
})

// ── 控制台只读显示图标那一维(v0.11.52)──────────────────────────────────────────
// 由来:控制台是**唯一的「建风格」入口**,而它建出来的档一份都没有 icons 段 ⇒ 用它自建的
// 风格图标体系必然是关的,而界面上零提示。与「17 份内置档声明了却报未启用」同族:到达率。
// ⭐ 2026-08-25 结构纠正:风格卡**只报「怎么画它」,不报「图形从哪来」**。
//   图标库与设计风格平级 —— 用哪套系统是**项目**的选择(design/icons.md),不是这份风格档的属性。
//   在风格卡上标「图标 tabler」会让人以为换风格就换图标,而那正是要拆开的绑定。
test('风格卡: 只下发图标的画法,不下发「用哪个库」(平级,不是风格的一个维度)', () => {
  const card = design.styleCard(ICONS_FM, {}, { withForm: false })
  assert.equal(card.icons.style, 'outlined')
  assert.equal(card.icons.strokeWidth, 2)
  assert.equal(card.icons.linecap, 'round')
  assert.ok(card.icons.sizes >= 1, '尺寸档只报个数,不把整张表铺进卡片')
  // ⚠ 能区分两种实现:v0.11.52 这里下发的正是 library,卡上那枚 chip 就是拿它渲染的
  assert.equal(card.icons.library, undefined, '图标来源不该出现在风格卡上')
  assert.equal(card.icons.fallbackLibrary, undefined)
})

test('风格卡: 没声明就是 null —— 界面据此标「未启用」', () => {
  assert.equal(design.styleCard(FT, {}, { withForm: false }).icons, null)
})

// ⚠ **只读,绝不进表单**:表单一旦部分管这个段,重新 compose 出的新档就「已有 icons 段」,
//   withKeptSections 便不再带回旧值 ⇒ semantics / size / assets 被静默删掉。
//   这正是当初逼出 withKeptSections 的那个形状,加编辑等于把它以更隐蔽的方式请回来。
test('风格卡: 图标不进表单 —— 进了就会在改风格的往返里静默删掉语义表', () => {
  const form = design.styleCard(ICONS_FM, {}, { withForm: true }).form
  assert.ok(form, '前提:表单确实下发了')
  assert.equal(form.icons, undefined, '表单不许管这个段')
  // 对照:确认这份档**真的有** icons(否则上面那条是空断言)
  assert.ok(design.styleCard(ICONS_FM, {}, { withForm: false }).icons, '对照组:这份档确实声明了图标')
})

// ⚠ **手搓 fixture 与真实返回值的形状必须一致** —— 这一条是纪律审计逼出来的:
//   `iconDirs` 现在返回 {lib,dir,style,weight,suffix},而 gap 那两条用例长期只喂 {lib,dir}。
//   判据从「路径里有没有 filled」改成「读目录声明的 style」时,测试里那条老路径永远命中,
//   于是 phosphor 的假警报(实心目录叫 fill)一次都没跑到,靠真机才发现。
//   ⭐ mock 与真实返回值一旦漂移,测试就只是在测 mock。
test('iconDirs:返回项的形状(手搓 fixture 与它对不上,gap 那几条就只是在测 mock)', (t) => {
  const roots = design.iconRoots({ base: path.join(__dirname, '..', '..') })
  if (!roots.lucide || !roots.tabler) return t.skip('本机没装图标包 —— 这条要拿真实返回值比对')
  const spec = design.iconSpec({ icons: {} }, { system: 'tabler', assets: [] })
  const dirs = design.iconDirs(spec, roots)
  assert.ok(dirs.length, '一个目录都没解析出来')
  for (const d of dirs) {
    for (const k of ['lib', 'dir', 'style', 'weight', 'suffix']) {
      assert.ok(k in d, `iconDirs 少了 ${k} 字段 —— 手搓 fixture 会跟着漏`)
    }
    assert.ok(['outlined', 'filled'].includes(d.style), `style 只能是 outlined/filled,拿到 ${d.style}`)
  }
  // ⭐ 关键的一条:实心目录**未必**叫 filled —— phosphor 的叫 fill ⇒ 判据不许读路径
  if (roots.phosphor) {
    const ps = design.iconSpec({ icons: { style: 'filled' } }, { system: 'phosphor', assets: [] })
    const pd = design.iconDirs(ps, roots).filter((d) => d.style === 'filled')
    assert.ok(pd.length, 'phosphor 应当有实心目录')
    assert.ok(!/filled/i.test(pd[0].dir), '这正是路径正则判不出来的那一格 —— 目录名里没有 filled 字样')
  }
})

// ⚠ 下面四条都是对抗式审查逼出来的,每条都能真出事。
test('图标档:认不出的系统名必须留痕,不能静默退回默认库', () => {
  // 由来:`system: "pixelarticons"`(写成了 npm 包名)⇒ 一路静默退回 lucide,而 `design icons`
  // 末行还把这个无效名字当成有效选择念出来「本项目:pixelarticons」—— agent 照着向群里转述,
  // 而每一张图都来自 Lucide。**做了 A 让人以为做了 B。**
  const s = design.iconSpec({ icons: {} }, { system: 'pixelarticons', assets: [] })
  assert.equal(s.system, null, '认不出就不许当成选中')
  assert.equal(s.systemUnknown, 'pixelarticons', '但必须留痕,否则调用方无从说破')
  assert.equal(design.iconSpec({ icons: {} }, { system: 'pixelart', assets: [] }).systemUnknown, null, '对照组:认得出的不留痕')
})

test('查表不走原型链 —— 一份坏档不许把控制台打黑', () => {
  // ⚠ 实测:`system: "constructor"` ⇒ `ICON_SYSTEMS['constructor']` 命中原型上的东西且为真,
  //   后面 `sys.semantics` 当场抛;而 projectIconCard 挂在 /api/state 上、不在任何 try 里
  //   ⇒ **一个群的一份坏档,让所有群的控制台每 15 秒黑一次**。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-proto-'))
  try {
    fs.mkdirSync(path.join(tmp, 'design'))
    for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      fs.writeFileSync(path.join(tmp, 'design', 'icons.md'), `---\nsystem: "${bad}"\n---\n`)
      const card = design.projectIconCard(tmp) // 不许抛
      assert.equal(card.known, false, `${bad} 不该被当成认得出的系统`)
      assert.equal(design.iconSpec({ icons: {} }, design.parseIconsDoc(fs.readFileSync(path.join(tmp, 'design', 'icons.md'), 'utf8'))).system, null)
    }
    // 对照组:正常名字必须仍然认得出 —— 否则上面的「不抛」可能只是因为整个功能坏了
    fs.writeFileSync(path.join(tmp, 'design', 'icons.md'), '---\nsystem: "tabler"\n---\n')
    assert.equal(design.projectIconCard(tmp).known, true)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})

test('图标档:认不出的兜底库名当没说,并留痕 —— 界面不许照着念', () => {
  // `fallback: "lucid"`(少打一个 e)⇒ iconDirs 查不到它,**静默变成没有兜底**,
  // 而群卡那行还会照写「取不到时去 lucid 兜底」。
  const d = design.parseIconsDoc('---\nsystem: "tabler"\nfallback: "lucid"\n---\n')
  assert.equal(d.fallbackLibrary, undefined, '认不出就当没说(不是 null —— null 是「明确不要」)')
  assert.equal(d.fallbackUnknown, 'lucid', '要留痕给界面标注')
  const ok = design.parseIconsDoc('---\nsystem: "tabler"\nfallback: "lucide"\n---\n')
  assert.equal(ok.fallbackLibrary, 'lucide'); assert.equal(ok.fallbackUnknown, null, '对照组:认得出的不留痕')
})

test('图标档:换系统只改 front matter,正文逐字节保留', () => {
  // 风格档早有「手写细则不许被换个设定冲掉」这条硬规矩,图标档漏了同一条 ——
  // 而这份档的注释还写着「是给人看的」,就是要人往里写东西。
  const doc = design.composeIconsDoc({ system: 'lucide' }) + '\n## 本项目细则\n- 徽章一律不走图标体系\n'
  const out = design.withIconsDocFront(doc, { system: 'phosphor', assets: 'a/b' })
  assert.match(out, /徽章一律不走图标体系/, '正文被冲掉了')
  const back = design.parseIconsDoc(out)
  assert.equal(back.system, 'phosphor'); assert.deepEqual(back.assets, ['a/b'])
  // ⚠ 连**注释掉的同名占位**也要清:模板里那句「不去 tabler 兜底」换成 phosphor 后就是假话
  assert.ok(!/兜底/.test(out.split('---')[1] || ''), 'front matter 里不该留下与新系统矛盾的旧注释')
  assert.equal(design.withIconsDocFront('没有 front matter 的文件', { system: 'lucide' }), null, '认不出帧就别改')
  // ⚠ 裁决本身也要测:它有 CLI 与控制台**两个落点**,判断若留在各自落点里就测不到 ——
  //   而测不到的分支正是会漂的那个(同一条线上 checkDesign 已经栽过一次)。
  assert.match(design.iconsDocText(doc, { system: 'phosphor' }), /徽章/, '已有档:正文必须保留')
  assert.ok(!/徽章/.test(design.iconsDocText(null, { system: 'phosphor' })), '没有档:走模板新建')
  assert.match(design.iconsDocText('不是档', { system: 'phosphor' }), /^---/, '认不出帧也退回模板,别写出半截东西')
})

test('iconSourceConflict:风格档里**仍然生效**的行不许被列进「删掉」', () => {
  // ⚠ assets 的优先级是「图标档有就用它,没有就用风格档的」⇒ 图标档没写 assets 时,
  //   风格档那行**还在起作用**。把它说成死行,人照做之后资产体检当场变成「不知道要扫哪儿」——
  //   而扫描范围必须声明、绝不自动发现 ⇒ 等于把整条体检关掉,且不会有任何东西报出来。
  const tokens = { icons: { library: 'lucide', assets: 'images/icons' } }
  const projNoAssets = { system: 'tabler', assets: [] }
  const msgA = design.iconSourceConflict(design.iconSpec(tokens, projNoAssets), tokens, 'design/icons.md', { projHasAssets: false }) || ''
  assert.match(msgA, /library/, '先证明这条确实在报(否则下面的「不含 assets」只是因为整句没出来)')
  assert.ok(!/assets/.test(msgA), '图标档没声明 assets 时,风格档那行仍然生效 —— 不许叫人删')
  const projAssets = { system: 'tabler', assets: ['a/b'] }
  const msgB = design.iconSourceConflict(design.iconSpec(tokens, projAssets), tokens, 'design/icons.md', { projHasAssets: true }) || ''
  assert.match(msgB, /assets/, '图标档声明了 assets 时,风格档那行才真的不起作用')
})

// ── 图标 vs 图表:判据的唯一闸门(2026-09-02 真机换来的)────────────────────────
// 病史:一份消耗看板的产物里**一个图标都没有**(0 个 use / 0 个 symbol),却被连报四次
// 「图标描边 1 — 风格档是 1.5」与「图标来源未核对」—— 页面里那两张 <svg viewBox="0 0 560 200">
// 是**图表**,19 处 stroke-width 全是网格线与折线,而判据是「全文扫 stroke-width」+「数所有 svg」。
// 下面这组用真实形状复现它,并钉住两条不许被一起治掉的东西:CSS 形式的描边、sprite 形态。
const CHART_PAGE = `<div class="wrap">
  <svg viewBox="0 0 560 200" class="chart" role="img" aria-label="本月每日消耗">
    <line x1="0" y1="10" x2="560" y2="10" stroke="#E6E6E6" stroke-width="1"/>
    <polyline fill="none" stroke="#2B5AE1" stroke-width="1" stroke-linecap="butt" points="0,10 20,30"/>
  </svg>
</div>`
const ICON_PAGE = `<button><svg viewBox="0 0 24 24" fill="none" stroke-width="1" stroke-linecap="butt" aria-label="设置"><path d="M1 1"/></svg></button>`

test('图表的描边不进图标判据 —— 图表页零 icon 描边事实', () => {
  const u = design.usedIcons(CHART_PAGE)
  assert.deepEqual(u.strokes, [], '图表的 stroke-width 属性不该被当成图标描边')
  assert.deepEqual(u.caps, [], 'stroke-linecap 同理')
  assert.equal(u.iconSvgs, 0, '这一页没有任何「像图标的」svg')
  // 对照组:同一把尺子对真图标必须照样收得到 —— 否则上面三个 0 只是因为整条判据被关掉了
  const v = design.usedIcons(ICON_PAGE)
  assert.deepEqual(v.strokes, [1], '真图标(方形 24 viewBox)的描边照样要收')
  assert.deepEqual(v.caps, ['butt'])
  assert.equal(v.iconSvgs, 1)
})

test('CSS 规则形式的描边仍然全收 —— 这条是更早的真机教训,不许被一起治掉', () => {
  // prototype-v2.html 把 stroke-width 写在 `.ui-icon` 规则里,只扫标签属性会一条都发现不了,
  // 而那恰恰是当时唯一一条真偏差。图表页那 19 处是**属性**形式,两者必须分开处理。
  const u = design.usedIcons('<style>.ui-icon{stroke-width:1.8;stroke-linejoin:miter}</style>')
  assert.deepEqual(u.strokes, [1.8], 'CSS 里的描边宽度必须还收得到')
  assert.deepEqual(u.joins, ['miter'])
})

test('sprite 形态不被闸门误伤 —— 图形在 symbol 上,外层容器没 viewBox', () => {
  const sprite = '<svg style="display:none"><symbol id="i-home" viewBox="0 0 24 24" stroke-width="1.5"><path d="M1 1"/></symbol></svg>'
  const u = design.usedIcons(sprite)
  assert.deepEqual(u.strokes, [1.5], 'symbol 上的描边要收 —— 只扫 svg 等于用了 sprite 的页面这一维恒不检查')
  assert.equal(u.iconSvgs, 1, 'sprite 里的 symbol 算「像图标的东西」')
})

test('端到端:只有图表的页面不再报图标描边,也不再报「图标来源未核对」', () => {
  const tokens = parseStyleTokens(['---', 'colors:', '  bg: "#FAFAFA"', 'icons:', '  library: lucide', '  strokeWidth: 1.5', '---'].join('\n'))
  const res = design.checkDesign([{ rel: 'dash.html', text: CHART_PAGE }], tokens)
  assert.ok(res.iconsEnabled, '先证明图标这一类确实启用了(否则下面的「没报」是因为整类没查)')
  assert.equal(res.findings.filter((f) => String(f.kind).startsWith('icon-')).length, 0, '图表页不该产生任何图标类 finding')
  assert.equal(res.iconSource.svgs, 0, '「有没有图标那种东西」的闸门要答 0,它决定报不报「来源未核对」')
  assert.ok(!design.formatCheckReport(res).includes('图标**来源**未核对'), '报告里不许再出现这句常驻噪音')
  // 对照组:同一份风格档下,真图标页必须照样报得出来(证明这条判据没被整条关掉)
  const res2 = design.checkDesign([{ rel: 'ui.html', text: ICON_PAGE }], tokens)
  assert.ok(res2.findings.some((f) => f.kind === 'icon-stroke'), '真图标的描边 1 ≠ 声明的 1.5,本该报出来')
})

// ── 已知例外:同三条报了四次,缺的是「记住已经判过的」────────────────────────
test('findingKey 不含文件名 —— 同一处偏离在两个文件里是同一个身份', () => {
  const a = { kind: 'color', rel: 'a.html', value: '#B42318' }
  const b = { kind: 'color', rel: 'b.css', value: '#b42318' }
  assert.equal(design.findingKey(a), design.findingKey(b), '接受一次就该管住全部,含 rel 就会退回逐文件刷屏')
  assert.equal(design.findingKey(a), 'color|#b42318')
  assert.notEqual(design.findingKey(a), design.findingKey({ kind: 'radius', value: '#B42318' }), '类别不同必须是不同身份')
})

test('例外档:没写理由的一律不认(防止退化成万能消音器)', () => {
  const doc = ['---', 'accepted:', '  "color|#B42318": "涨跌语义色 · 2026-09-02"', '  "color|#067647":', '  radius|12px: 设计图自带', '---'].join('\n')
  const m = design.parseAcceptedDoc(doc)
  assert.equal(m['color|#b42318'], '涨跌语义色 · 2026-09-02', '带引号的键 + 理由要读得出')
  assert.ok(!('color|#067647' in m), '空理由的不认')
  assert.equal(m['radius|12px'], '设计图自带', '不带引号的键也认')
  assert.deepEqual(design.parseAcceptedDoc('没有 front matter'), {}, '不是 front matter ⇒ 空表,不抛')
})

test('命中例外的挪出 findings,但报告必须如实说出来 —— 接受 ≠ 消失', () => {
  const tokens = parseStyleTokens(['---', 'colors:', '  bg: "#FAFAFA"', '  ink: "#0A0A0A"', '---'].join('\n'))
  const src = [{ rel: 'dash.html', text: '<i style="color:#B42318"></i><b style="color:#067647"></b>' }]
  const before = design.checkDesign(src, tokens)
  assert.equal(before.findings.filter((f) => f.kind === 'color').length, 2, '先证明这两条本来是会报的')
  assert.deepEqual(before.accepted, [], '没给例外表时 accepted 恒为空数组(形状稳定,消费方不必判 undefined)')
  const after = design.checkDesign(src, tokens, { accepted: { 'color|#b42318': '涨跌语义色(红涨)' } })
  assert.equal(after.findings.filter((f) => f.kind === 'color').length, 1, '命中的那条不再算进 findings')
  assert.equal(after.accepted.length, 1)
  assert.equal(after.accepted[0].why, '涨跌语义色(红涨)', '理由要跟着走,供人复核当初判得对不对')
  const rep = design.formatCheckReport(after)
  assert.match(rep, /另有 1 条此前已判定可接受/, '静默消掉就分不出「判过、可接受」与「压根没查」')
  assert.match(rep, /涨跌语义色\(红涨\)/, '理由必须出现在报告里')
})

test('全部命中例外时:标题说「未发现不一致」,但那一行仍然要在', () => {
  const tokens = parseStyleTokens(['---', 'colors:', '  bg: "#FAFAFA"', '---'].join('\n'))
  const res = design.checkDesign([{ rel: 'a.html', text: '<i style="color:#B42318"></i>' }], tokens,
    { accepted: { 'color|#b42318': '涨跌语义色' } })
  const rep = design.formatCheckReport(res)
  assert.match(rep, /未发现不一致/)
  assert.match(rep, /另有 1 条此前已判定可接受/, '零 findings 那条**提前 return** 的路径上也得报出来')
})

test('接线:`design check` 那条路真的把例外表传下去了', () => {
  // ⚠ 判断写在调用方(bin)里,单测只测得到被调用的纯函数 —— 这一族已经栽过(checkDesign
  //   没把图标档传下去,而单测手工造的 spec 绿得很好看)。故直接钉住调用方那行源码。
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'bin', 'sbot.js'), 'utf8')
  const at = src.indexOf('design.checkDesign(sources, tokens, {')
  assert.ok(at > 0, '先证明扫到了那个调用(扫不到时下面的断言会变成假绿)')
  const call = src.slice(at, at + 400) // 定长切片:嵌套花括号让「配对」正则必然在第一个 } 提前收口
  assert.match(call, /accepted:\s*design\.findAcceptedDoc\(/, 'bin 必须把 findAcceptedDoc 的结果传进去')
  assert.match(call, /project:\s*design\.findIconsDoc\(/, '同一条路上的图标档也要还在(防止改动时顺手删掉)')
  assert.match(call, /roots:\s*iconRootsHere\(/, 'roots 同理')
})

test('到达率:有不一致时,报告要告诉人「例外怎么记」—— 做了没人知道等于没做', () => {
  const tokens = parseStyleTokens(['---', 'colors:', '  bg: "#FAFAFA"', '---'].join('\n'))
  const withHits = design.checkDesign([{ rel: 'a.html', text: '<i style="color:#B42318"></i>' }], tokens)
  const rep = design.formatCheckReport(withHits)
  assert.match(rep, /design\/check-accepted\.md/, '最需要它的那一刻才说 —— 不塞进每轮都付 token 的清单')
  assert.match(rep, /没写理由的不生效/, '两条约束要写足,否则它会退化成消音器')
  // ⚠ 零不一致时不许出现这句:那时它是一句无处安放的噪音(同「图标来源未核对」那条常驻噪音)
  const clean = design.checkDesign([{ rel: 'a.html', text: '<i style="color:#FAFAFA"></i>' }], tokens)
  assert.ok(!design.formatCheckReport(clean).includes('check-accepted'), '没有不一致时不该多这一行')
})

test('sprite+use 形态算图标 —— 真实产物做对照组时逮到的回归', () => {
  // 项目自己推荐的输出形态:`<svg class="icon"><use href="#p-house"/></svg>` —— **没有 viewBox
  // 也没有 width**。只按方形/尺寸判 ⇒ 这类页面 iconSvgs 恒 0,「图标来源只核对了一半」那行
  // 会被静默吞掉,而那正是「零告警 vs 压根没查」要区分的东西。
  const page = '<button><svg class="icon" aria-hidden="true"><use href="#p-house"/></svg></button>'
  assert.equal(design.usedIcons(page).iconSvgs, 1, 'use 引用是图标的确证,不该被闸门挡掉')
  // 对照组:同样没有 viewBox、但里面不是 use 的 svg 不算图标(否则闸门等于没有)
  assert.equal(design.usedIcons('<svg class="chart"><rect/></svg>').iconSvgs, 0)
})

// ── 风格档体检(第四条平级验收:查档本身)──────────────────────────────────────
const _fm = (body) => ['---', ...body, '---'].join('\n')

test('语义色放错段:ok/warn 写在 colors 里要报,角色词与 status 段里的不报', () => {
  const t = parseStyleTokens(_fm(['colors:', '  bg: "#FFFFFF"', '  ink: "#111111"', '  accent: "#2B5AE1"', '  ok: "#0A7F3F"']))
  const f = design.auditStyleSpec(t).findings.find((x) => x.kind === 'spec-status-misplaced')
  assert.deepEqual(f.items.map((i) => i.key), ['ok'], 'accent 是角色词、bg/ink 同理,只有 ok 该被点名')
  // 对照组:同一个色写进 status 段就不该再报(否则这条判据没有分辨力)
  const t2 = parseStyleTokens(_fm(['colors:', '  bg: "#FFFFFF"', '  ink: "#111111"', 'status:', '  ok: "#0A7F3F"']))
  assert.ok(!design.auditStyleSpec(t2).findings.some((x) => x.kind === 'spec-status-misplaced'))
})

test('对比度分两档:<3 是「几乎看不见」,3~4.5 是「小字吃力」', () => {
  // 由来:16 份内置档里 4 份的 muted 落在 3.2~4.1(设计惯例),与一条 1.22:1 的真雷同级 ⇒ 真雷被淹。
  // 取值是先算准的:#62FFB3=1.22(硬) · #8A8A8A=3.31(弱) · #0A0A0A=18.97(不报)
  const t = parseStyleTokens(_fm(['colors:', '  bg: "#FAFAFA"', '  ink: "#0A0A0A"', '  muted: "#8A8A8A"', '  ok: "#62FFB3"']))
  const fs2 = design.auditStyleSpec(t).findings
  const hard = fs2.find((x) => x.kind === 'spec-contrast')
  const weak = fs2.find((x) => x.kind === 'spec-contrast-weak')
  assert.deepEqual(hard.items.map((i) => i.key), ['ok'], '1.22:1 是硬问题')
  assert.deepEqual(weak.items.map((i) => i.key), ["muted"], "3~4.5 之间的走提示档")
  assert.ok(!fs2.some((x) => x.kind === 'spec-contrast' && x.items.some((i) => i.key === 'ink')), 'ink 对比 19:1,不该出现')
})

test('只测作者真写了的键 —— styleRoles 的兜底会凭空造色,拿它体检等于评价不存在的颜色', () => {
  // bg+ink 写了、muted 没写。styleRoles 会派生一个 muted(mix(bg,ink,0.55) ≈ #989898,
  // 配白底约 3.0)—— 若走它,这里会冒出一条指着「档里根本没有的颜色」的告警。
  const t = parseStyleTokens(_fm(['colors:', '  bg: "#FFFFFF"', '  ink: "#444444"']))
  const fs2 = design.auditStyleSpec(t).findings.filter((x) => String(x.kind).startsWith('spec-contrast'))
  assert.deepEqual(fs2, [], '没写 muted 就不该有 muted 的对比度告警')
  // 对照组:写上一个同样低对比的 muted,就必须报得出来(证明这条判据本身在跑)
  const t2 = parseStyleTokens(_fm(['colors:', '  bg: "#FFFFFF"', '  ink: "#444444"', '  muted: "#989898"']))
  assert.ok(design.auditStyleSpec(t2).findings.some((x) => String(x.kind).startsWith('spec-contrast')))
})

test('没有可辨认的底色键 ⇒ 对比度整类不测,而且必须说出来', () => {
  const t = parseStyleTokens(_fm(['colors:', '  primary: "#123456"', '  secondary: "#654321"']))
  const r = design.auditStyleSpec(t)
  assert.equal(r.contrastTested, false)
  assert.match(design.formatSpecReport(r), /对比度这一类\*\*没测\*\*/, '「没测」与「没问题」不能长一样')
})

test('中文兜底:按档报,有 CJK 族的不报', () => {
  const t = parseStyleTokens(_fm(['typography:', '  body:', '    fontFamily: "\'Geist\', \'Noto Sans SC\', sans-serif"',
    '  data:', '    fontFamily: "\'Geist Mono\', ui-monospace, monospace"']))
  const f = design.auditStyleSpec(t).findings.find((x) => x.kind === 'spec-cjk')
  assert.deepEqual(f.items.map((i) => i.slot), ['data'], '只有等宽那档缺兜底')
  assert.ok(design.CJK_FAMILY_RE.test("'PingFang SC'") && design.CJK_FAMILY_RE.test('思源黑体'), '常见中文族名要认得')
})

test('进 check 指针的只有硬问题 —— 设计惯例与纯英文产品不该常驻刷屏', () => {
  const weakOnly = parseStyleTokens(_fm(['colors:', '  bg: "#FFFFFF"', '  ink: "#111111"', '  muted: "#8A8A8A"',
    'typography:', '  body:', '    fontFamily: "Inter, sans-serif"']))
  const r = design.auditStyleSpec(weakOnly)
  assert.ok(r.findings.length >= 2, '先证明这份档确实有东西可报(否则下面的 0 是假绿)')
  assert.equal(design.specHardIssues(r), 0, '偏弱对比 + 缺中文兜底都不进指针')
  const hard = design.auditStyleSpec(parseStyleTokens(_fm(['colors:', '  bg: "#FAFAFA"', '  ok: "#62FFB3"'])))
  assert.ok(design.specHardIssues(hard) > 0, '语义色放错段 / 几乎看不见 要进指针')
})

test('接线:`design doctor` 在,且 `design check` 把档体检的条数传给了报告', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'bin', 'sbot.js'), 'utf8')
  assert.match(src, /action === 'doctor'/, '子命令要真的接上(不然 --help 里写了也用不了)')
  // 顶层 help 的 design 行分两截(风格与图标 / 四条验收),doctor 在第二截;完整的「每个动作都列在
  // 顶层与各自 --help 里」由 tests/unit/cli-help.test.js 从分支里读出来钉着,这里只钉这一条接线。
  assert.match(src, /sbot design <动作>[^\n]*\n[^\n]*\bdoctor\b/, '顶层 help 要列出来 —— 没列 = 能力到不了用它的人手上')
  const at = src.indexOf('design.formatCheckReport(res, {')
  assert.ok(at > 0, '先证明扫到了那个调用')
  assert.match(src.slice(at, at + 200), /specIssues:\s*design\.specHardIssues\(/, 'check 报告必须拿到档体检的条数')
})

test('两个词表必须互斥 —— 角色词与语义词撞车会让色板色被当成语义色误报', () => {
  // ⚠ 这条钉的是**不变量**,不是某段代码:`auditStyleSpec` 里那道 `_isRoleWord` 过滤在两表
  //   不相交时不改变任何行为(变异检验会显示它存活 —— 属实)。保留它是运行时防御:真撞车时
  //   「角色优先」才是对的,而误报会伤用户;把「不相交」收成这条断言,撞车当场就会红。
  const roleWords = new Set(Object.values(design.ROLE_KEYS).flat())
  const dup = Object.values(design.SEMANTIC_COLOR_WORDS).flat().filter((w) => roleWords.has(w))
  assert.ok(roleWords.size > 10, '先证明真读到了角色词表(读空时下面的 0 是假绿)')
  assert.deepEqual(dup, [], '语义词表里出现了角色词 —— 要么改名,要么确认 _isRoleWord 的裁决是想要的')
})

// ── 布局体检的可读性两条(v0.11.62)────────────────────────────────────────────
test('中文小字的下限取风格档**最小档位**,不是正文档', () => {
  // 由来:真实基线上 body=14 而档里还声明了 data=13 —— 拿 14 当门槛,7 个合法的 13px 会被
  // 报成偏离。作者声明过的档位就是合法的。
  const t = parseStyleTokens(['---', 'typography:', '  headline:', '    fontSize: "24px"',
    '  body:', '    fontSize: "14px"', '  data:', '    fontSize: "13px"', '---'].join('\n'))
  assert.equal(design.styleMinFontSize(t), 13)
  assert.equal(design.styleMinFontSize(parseStyleTokens('---\ncolors:\n  bg: "#FFF"\n---')), 0, '没写字号 ⇒ 0 ⇒ 那一类不测')
})

test('探针参数化:门槛真的注进页面代码,0 时那一类整条不跑', () => {
  const on = design.layoutProbe({ cjkMinSize: 13 })
  assert.doesNotThrow(() => new Function('return ' + on), '探针必须还是合法表达式')
  assert.match(on, /CJK_MIN = 13/, '门槛要真的写进去,不是留在注释里')
  assert.match(on, /closest\('svg'\)/, '图表内的文字必须排除 —— 坐标轴刻度天生就小')
  assert.match(on, /aria-disabled/, 'WCAG 豁免失效控件')
  assert.match(design.layoutProbe(), /CJK_MIN = 0/, '不给门槛 ⇒ 0')
  assert.equal(design.LAYOUT_PROBE, design.layoutProbe(), '默认形态与既有消费者一致')
})

test('两条新判据按数值聚合成一条,不逐元素刷屏', () => {
  // 真实基线:一份页面上「12px 中文」有 40 个元素、跨 9 个 class —— 逐个报是四十行噪音。
  const raw = {
    width: 430, leaves: 9, overlaps: [], clipped: [], small: [], pageOverflow: 0, cjkMin: 13,
    cjkSmall: Array.from({ length: 40 }, (_, i) => ({ el: 'SPAN.c' + (i % 9), t: '文', size: 12 })),
    lowContrast: [{ el: 'P.a', t: '甲', ratio: 2.1, need: 4.5, size: 12, cjk: true },
      { el: 'P.b', t: '乙', ratio: 2.1, need: 4.5, size: 12, cjk: true }],
  }
  const f = design.layoutFindings(raw)
  const cjk = f.filter((x) => x.kind === 'cjk-small')
  assert.equal(cjk.length, 1, '40 个元素只出一条')
  assert.equal(cjk[0].count, 40)
  assert.equal(cjk[0].els.length, 4, '样本类名最多留 4 个,够定位就行')
  const con = f.filter((x) => x.kind === 'contrast')
  assert.equal(con.length, 1, '同一对比度 = 同一处病因')
  assert.equal(con[0].count, 2)
})

test('中文小字那一类没测时必须说出来 —— 「没测」与「没问题」不能长一样', () => {
  const off = design.mergeLayoutRuns([{ raw: { width: 430, leaves: 3, overlaps: [], clipped: [], small: [], pageOverflow: 0, cjkMin: 0 } }])
  const rep = design.formatLayoutReport(off)
  assert.match(rep, /中文小字这一类没测/)
  assert.ok(!/无中文小字/.test(rep), '没测就不许在「未发现问题」里把它列成已查项')
  const on = design.mergeLayoutRuns([{ raw: { width: 430, leaves: 3, overlaps: [], clipped: [], small: [], pageOverflow: 0, cjkMin: 13 } }])
  assert.match(design.formatLayoutReport(on), /无中文小字/, '测了才算查过')
})

test('报告把门槛与判据交代清楚(照着报告就能判断要不要理它)', () => {
  const res = design.mergeLayoutRuns([{ raw: {
    width: 430, leaves: 5, overlaps: [], clipped: [], small: [], pageOverflow: 0, cjkMin: 13,
    cjkSmall: [{ el: 'SPAN.sub', t: '输入·缓存', size: 12 }], lowContrast: [] } }])
  const rep = design.formatLayoutReport(res)
  assert.match(rep, /中文小字\*\* 12px 共 1 处/)
  assert.match(rep, /风格档最小的档位是 13px/, '门槛要写在报告里,否则没法判断这条对不对')
  assert.match(rep, /图表内的文字（坐标轴刻度）一律不计|图表内的文字\(坐标轴刻度\)一律不计/)
})

test('白名单认得小赖等开源中文族 —— 真机上它被误报过一次', () => {
  for (const f of ["'Xiaolai'", "'LXGW WenKai'", "'Sarasa Gothic SC'", "'MiSans'", '小赖字体', '霞鹜文楷']) {
    assert.ok(design.CJK_FAMILY_RE.test(f), f + ' 应当被认作中文族')
  }
  assert.ok(!design.CJK_FAMILY_RE.test("'Geist Mono', ui-monospace"), '纯拉丁等宽栈不该被误认')
})

test('接线:`design layout` 那条路真的把风格档的门槛传下去了', () => {
  // 判断写在 bin 里,单测只测得到纯函数 —— 不传 = 中文小字整条不跑,而报告照样一片绿。
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'bin', 'sbot.js'), 'utf8')
  assert.match(src, /const cjkMinSize = pick \? design\.styleMinFontSize\(/, '门槛要从风格档算出来')
  assert.match(src, /cdpLayoutScan\(abs, widths, base, \{ cjkMinSize \}\)/, '要真的传进扫描')
  assert.match(src, /design\.layoutProbe\(probeOpts\)/, '扫描要把参数交给探针,不能还用写死的那份')
})

// ── 中文兜底进判据(第 3 批)──────────────────────────────────────────────────
test('字体栈两处来源都要收 —— 真实产物是 CSS 自定义属性 + var() 引用', () => {
  // 只扫 `font-family:` 会拿到一个 "var(--mono)" 字符串,这一维等于恒不检查。
  const css = ":root{--mono:'Geist Mono',monospace;--sans:'Geist','Noto Sans SC',sans-serif}\n"
    + '.a{font-family:var(--mono)}.b{font-family:"Inter",sans-serif}'
  const st = design.usedFontStacks(css)
  assert.equal(st.length, 3, '两条自定义属性 + 一条直写;var(--mono) 那条不算')
  assert.ok(st.some((s) => /Geist Mono/.test(s)) && st.some((s) => /Inter/.test(s)))
  assert.ok(!st.some((s) => /^var\(/.test(s)), 'var() 引用本身不是字体栈')
})

test('中文兜底缺失:只在产物真有汉字、且档声明过中文族时才报', () => {
  const withCjk = parseStyleTokens(['---', 'typography:', '  body:', '    fontFamily: "\'Geist\', \'Noto Sans SC\', sans-serif"',
    '  data:', '    fontFamily: "\'Geist Mono\', monospace"', '---'].join('\n'))
  assert.deepEqual(design.styleCjkFamilies(withCjk), ['Noto Sans SC'])
  const hit = (text, tk = withCjk) => design.checkDesign([{ rel: 'a.html', text }], tk).findings.filter((f) => f.kind === 'font-cjk')
  const nakedCss = ":root{--mono:'Geist Mono',monospace}<p>今日消耗</p>"
  assert.equal(hit(nakedCss).length, 1, '有汉字 + 栈里没中文族 ⇒ 报')
  // 三个否定对照 —— 少一个都说明判据没有分辨力
  assert.equal(hit(":root{--mono:'Geist Mono',monospace}<p>Today</p>").length, 0, '产物纯拉丁 ⇒ 不报')
  assert.equal(hit(":root{--mono:'Geist Mono','Noto Sans SC',monospace}<p>今日消耗</p>").length, 0, '栈里有中文族 ⇒ 不报')
  const noCjkDoc = parseStyleTokens('---\ntypography:\n  body:\n    fontFamily: "Inter, sans-serif"\n---')
  assert.equal(hit(nakedCss, noCjkDoc).length, 0, '档本身没声明中文族 ⇒ 不报(没依据就不报)')
})

test('清单摘要必须带上中文族 —— 那是 agent 每轮唯一看得到的字体口径', () => {
  const tk = parseStyleTokens(['---', 'colors:', '  bg: "#FFF"', 'typography:',
    '  body:', '    fontFamily: "\'Geist\', \'Noto Sans SC\', sans-serif"', '---'].join('\n'))
  const dg = design.tokenDigest(tk)
  // v0.11.68 起,不是系统自带的族带「需自带文件」标记 —— 否则 agent 照档写 Geist,页面上出来的还是苹方
  assert.match(dg, /字体 geist\(需自带文件\) · 中文 Noto Sans SC/, '不给中文族 = 教出「这项目没有中文字体」;不标需自带 = 教出「写上就有」')
  // 对照组:档里没有中文族时不该凭空多出这一段
  const bare = parseStyleTokens('---\ntypography:\n  body:\n    fontFamily: "Inter, sans-serif"\n---')
  assert.ok(!/中文/.test(design.tokenDigest(bare)))
  // 对照组:两边都自带的族不标(标了就是噪音)
  const sys = parseStyleTokens('---\ntypography:\n  body:\n    fontFamily: "Georgia, \'PingFang SC\', serif"\n---')
  assert.match(design.tokenDigest(sys), /字体 georgia · 中文/); assert.doesNotMatch(design.tokenDigest(sys), /需自带/)
})

test('生成的风格档三条栈全带中文兜底 —— 等宽那条以前是空的', () => {
  const doc = design.composeStyleDoc({ name: '测试', colors: { bg: '#FFFFFF', ink: '#111111', accent: '#6D28D9', muted: '#6B7280' }, mono: true })
  const tk = parseStyleTokens(doc)
  const slots = Object.entries(tk.typography || {}).filter(([, v]) => v && v.fontFamily)
  assert.ok(slots.length >= 3, '先证明真读到了三档(读空时下面的断言是假绿)')
  for (const [slot, v] of slots) assert.ok(design.CJK_FAMILY_RE.test(v.fontFamily), slot + ' 档缺中文兜底:' + v.fontFamily)
})

// ── 控制台表单的档位必须与服务端一致 ──────────────────────────────────────────
test('前端三组档位 id 与服务端逐一对上 —— 这条以前只写在注释里,没有东西守着', () => {
  // ⚠ 项目教训:「教训写成文字挡不住复发,得收成一个被调用的东西」。前端多一个档,人选得到
  //   却存不进去(normalizeStyleForm 会把它当非法值退回默认),而**没有任何报错**。
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'console.html'), 'utf8')
  const idsOf = (name) => {
    const m = new RegExp('const ' + name + '=\\[(.*?)\\];').exec(html)
    assert.ok(m, name + ' 没扫到 —— 扫不到时下面的比对会变成假绿')
    return [...m[1].matchAll(/\['([\w-]+)'/g)].map((x) => x[1])
  }
  for (const [front, back] of [['NS_ROUNDS', design.ROUND_LEVELS], ['NS_WEIGHTS', design.WEIGHT_LEVELS],
    ['NS_ELEVS', design.ELEV_LEVELS]]) {
    const a = idsOf(front).slice().sort()
    const b = Object.keys(back).slice().sort()
    assert.ok(a.length > 1, front + ' 至少该有两档(对照组:读空时下面的 deepEqual 会恒真)')
    assert.deepEqual(a, b, front + ' 与服务端对不上')
  }
})

test('生成的档恒定一套系统优先栈,且表单里已无字体字段', () => {
  const base = { name: '甲', colors: { bg: '#FFFFFF', ink: '#111111', accent: '#6D28D9', muted: '#6B7280' } }
  const form = design.styleFormFromDoc(design.composeStyleDoc(base))
  for (const k of ['serif', 'mono', 'cjkFont', 'cjkCustom']) assert.ok(!(k in form), k + ' 不该再是表单字段')
  const body = parseStyleTokens(design.composeStyleDoc(base)).typography.body.fontFamily
  assert.ok(body.indexOf('PingFang SC') < body.indexOf('Noto Sans SC'), '系统族排在思源之前:' + body)
  assert.ok(!/Songti|Yuanti|HYQiHei/.test(body), '不再有别的档位')
})

test('拉丁族排在中文族前面 —— 反过来拉丁字母会用中文字体里的字形', () => {
  const doc = design.composeStyleDoc({ name: '甲', colors: { bg: '#FFFFFF', ink: '#111111', accent: '#6D28D9', muted: '#6B7280' } })
  const body = parseStyleTokens(doc).typography.body.fontFamily
  const iLatin = body.indexOf('Inter'), iCjk = body.indexOf('PingFang SC')
  // ⚠ 先各自断言存在:`indexOf` 找不到返回 -1,而 `-1 < 任意正数` **恒真** ——
  //   「拉丁族整个从栈里消失」这个方向原本恒绿(审计变异逮到)。
  assert.ok(iLatin >= 0, '拉丁族必须在栈里,实际:' + body)
  assert.ok(iCjk >= 0, '中文族必须在栈里,实际:' + body)
  assert.ok(iLatin < iCjk, '实际顺序:' + body)
  assert.match(body, /sans-serif$/, '通用关键字必须收尾')
})

test('生成器出的三档字重必须都是九档标准值 —— 650 会让汉字走合成伪粗', () => {
  // ⚠ 由来:18 份档量下来只有 1 份用了非标准字重(650),而那一份正是**控制台生成的**。
  //   拉丁 Inter 是可变字体真渲染得出 650,中文静态族只有九档(苹方最重到 Semibold 600)
  //   ⇒ 同一行里拉丁真粗、汉字假粗。
  const ws = Object.values(design.WEIGHT_LEVELS).map((w) => w.fontWeight)
  assert.ok(ws.length >= 3, '先证明真读到了档位表')
  for (const w of ws) assert.ok(design.STD_FONT_WEIGHTS.includes(w), '非标准字重:' + w)
  // 分档不能被改坏:600 仍要落在「中」,否则「修改风格」会把中档读成轻档
  assert.equal(design.quantizeWeight(design.WEIGHT_LEVELS.medium.fontWeight), 'medium')
})

test('风格档体检认得出非标准字重,且进 check 指针', () => {
  const t = parseStyleTokens(['---', 'typography:', '  headline:', '    fontWeight: 650',
    '  body:', '    fontWeight: 400', '---'].join('\n'))
  const r = design.auditStyleSpec(t)
  const f = r.findings.find((x) => x.kind === 'spec-weight')
  assert.deepEqual(f.items, [{ slot: 'headline', weight: 650 }], '400 是标准值,不该被点名')
  assert.match(design.formatSpecReport(r), /合成伪粗/)
  assert.ok(design.specHardIssues(r) > 0, '判据准(误报预算 1/18)⇒ 该进指针')
  // 对照组:全是标准值时一个字都不多说
  const okDoc = parseStyleTokens('---\ntypography:\n  headline:\n    fontWeight: 600\n---')
  assert.ok(!design.auditStyleSpec(okDoc).findings.some((x) => x.kind === 'spec-weight'))
})

test('HTML 内联 style 的字体栈按属性边界收口 —— 吞过头会「该报的不报」且把正文吐进报告', () => {
  // 真机复现过的两个后果:①吞进来的那段里恰好有后面 <style> 块的中文族 ⇒ 整串被判成有兜底
  // ②`sample` 把页面正文带进报告,而那份报告要贴进群。
  const html = `<span style="font-family:'Geist Mono',monospace">11.81亿 tokens</span>\n`
    + `<div>今日消耗</div>\n<style>:root{--sans:'Geist','Noto Sans SC',sans-serif}</style>`
  const stacks = design.usedFontStacks(html)
  assert.ok(stacks.length >= 2, '先证明真收到了栈(收不到时下面的断言是假绿)')
  for (const s of stacks) {
    assert.ok(s.length <= 60, '栈被吞过头了(' + s.length + ' 字符):' + s.slice(0, 60))
    assert.ok(!/[<>]/.test(s), '栈里混进了标签 ⇒ 会把正文吐进报告:' + s.slice(0, 60))
  }
  assert.ok(stacks.includes("'Geist Mono',monospace"), '内联那条要原样收到')
  // 端到端:内联写法与 <style> 块写法必须报出同样的结果
  const tk = parseStyleTokens(['---', 'typography:', '  body:', '    fontFamily: "\'Geist\', \'Noto Sans SC\', sans-serif"',
    '  data:', '    fontFamily: "\'Geist Mono\', monospace"', '---'].join('\n'))
  const hit = (t) => design.checkDesign([{ rel: 'p.html', text: t }], tk).findings.filter((f) => f.kind === 'font-cjk')
  assert.equal(hit(html).length, 1, '内联写法该报 1')
  assert.equal(hit(`<div>今日消耗</div><style>.a{font-family:'Geist Mono',monospace}</style>`).length, 1, '对照组:<style> 块写法同样报 1')
})

test('字体栈长度上限:真实世界的长栈不许被丢,吞过头的必须丢', () => {
  // ⚠ 基准**来自被测代码之外**:控制台自己那条 --sans 是真实世界里最长的一条。
  //   上限定成 200 时它只差 23 字符就会被静默丢掉 —— 而「丢掉」= 静默漏检。
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'console.html'), 'utf8')
  const m = /--sans:([^;]+);/.exec(html)
  assert.ok(m, '没扫到控制台那条栈 —— 扫不到时下面的断言是假绿')
  const longest = m[1].trim()
  assert.ok(longest.length > 150, '基准栈本该很长,实际 ' + longest.length + ' 字符')
  assert.equal(design.usedFontStacks('.a{font-family:' + longest + '}').length, 1, '真实世界的长栈不许被丢')
  // 吞过头的量级完全不同(整段文件),必须丢
  assert.equal(design.usedFontStacks(".a{font-family:'A'," + 'x'.repeat(500) + ',sans-serif}').length, 0, '异常长的必须丢')
})

// ── v0.11.63:审计逮到的那批 ────────────────────────────────────────────────
test('对比度测不准时不许说「无低对比文字」—— 渐变底/半透明卡片上「太浅」原本永远查不出', () => {
  const mk = (bgUnknown) => design.mergeLayoutRuns([{ raw: { width: 1280, leaves: 9, overlaps: [], clipped: [],
    small: [], pageOverflow: 0, cjkMin: 13, cjkSmall: [], lowContrast: [], bgUnknown } }])
  const clean = design.formatLayoutReport(mk(0))
  assert.match(clean, /无低对比文字/, '底色都量得准时才能这么说(对照组)')
  const skipped = design.formatLayoutReport(mk(7))
  assert.ok(!/无低对比文字/.test(skipped), '有测不准的就不许断言「无」—— 这正是 status:ok 那一族的假绿')
  assert.match(skipped, /7 处文字的\*\*对比度没测\*\*/, '没测多少要说出来')
})

test('例外档写错要出声 —— 静默失效与「根本没这个文件」输出一模一样', () => {
  const W = design.acceptedDocWarnings
  assert.deepEqual(W(''), [], '没有这个文件 ⇒ 不多话')
  assert.match(W('# 已知例外\n\n- color|#B42318:品牌红\n')[0], /没有 front matter/, '最自然的纯 markdown 写法此前静默失效')
  assert.match(W('---\nfoo: 1\n---\n')[0], /没有 `accepted:` 段/)
  const yaml = W('---\naccepted:\n  - color|#B42318: 列表写法\n---\n')
  assert.match(yaml[0], /YAML 列表写法/, '键会带上 "- " 而永远匹配不上')
  const noWhy = W('---\naccepted:\n  color|#067647:\n---\n')
  assert.match(noWhy[0], /没写为什么/)
  // 对照组:写对了就一个字都不多说
  assert.deepEqual(W('---\naccepted:\n  color|#B42318: 涨跌语义色\n---\n'), [])
})

test('例外档里没匹配上的键要点名 —— 不然它只会越攒越多', () => {
  const tokens = parseStyleTokens('---\ncolors:\n  bg: "#FAFAFA"\n---')
  const res = design.checkDesign([{ rel: 'a.html', text: '<i style="color:#B42318"></i>' }], tokens,
    { accepted: { 'color|#b42318': '用上的', 'radius|999px': '早修好的旧条目' } })
  assert.deepEqual(res.acceptedStale, ['radius|999px'])
  assert.match(design.formatCheckReport(res), /1 条这次一条都没匹配上/)
})

test('描边三项的闸门:图表页跳过,而「描边写在 CSS、页面里没有 svg」那条真机案例照查', () => {
  const spec = parseStyleTokens('---\nicons:\n  library: lucide\n  strokeWidth: 1.5\n---')
  const hit = (t) => design.checkDesign([{ rel: 'a.html', text: t }], spec).findings.filter((f) => f.kind === 'icon-stroke')
  assert.equal(hit('<style>.ui-icon{stroke-width:1.8}</style>').length, 1, '⚠ 真机案例:描边写在 CSS、页面零 svg ⇒ 必须照查')
  assert.equal(hit('<svg viewBox="0 0 560 200"><style>.g{stroke-width:1}</style><line/></svg>').length, 0, '图表页 ⇒ 跳过')
  assert.equal(hit('<svg viewBox="0 0 24 24"><path stroke-width="1"/></svg>').length, 1, '真图标 ⇒ 照查(对照组)')
})

test('字号单位不能盲 —— 0.875rem 曾让中文小字整条静默失效', () => {
  assert.equal(design.styleMinFontSize({ typography: { body: { fontSize: '0.875rem' } } }), 14)
  assert.equal(design.styleMinFontSize({ typography: { body: { fontSize: '24rpx' } } }), 12, '小程序 rpx 按 750 设计稿折半')
  assert.equal(design.styleMinFontSize({ typography: { body: { fontSize: '13px' } } }), 13, '对照组:px 不变')
})

test('字体栈:注释里的旧写法不算 · @font-face 不算 · 不带通用关键字的自定义属性也要收', () => {
  assert.deepEqual(design.usedFontStacks('/* 旧: font-family: Arial, sans-serif; */'), [], '注释里的不是活栈')
  assert.deepEqual(design.usedFontStacks("@font-face{font-family:'MyIcons';src:url(i.woff2)}"), [],
    '@font-face 是族名声明,结构上不可能带中文兜底 ⇒ 报它永远修不掉')
  assert.deepEqual(design.usedFontStacks(":root{--mono:'Geist Mono','Courier New'}"), ["'Geist Mono','Courier New'"],
    '不带通用关键字的栈此前整条不检查')
})

test('控制台默认状态色必须过自己的 doctor —— 否则那个项目此后每次交付都多一行噪音', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'console.html'), 'utf8')
  const m = /NS_STATUS_DEF=\{([^}]+)\}/.exec(html)
  assert.ok(m, '没扫到默认状态色 —— 扫不到时下面是假绿')
  const def = {}
  for (const kv of m[1].split(',')) { const [k, v] = kv.split(':'); def[k.trim()] = v.replace(/['"]/g, '').trim() }
  assert.equal(Object.keys(def).length, 3, '三档都要在')
  const doc = design.composeStyleDoc({ name: 't', colors: { bg: '#FFFFFF', ink: '#1A1D24', accent: '#6D28D9', muted: '#6B7280' }, statusColors: def })
  assert.equal(design.specHardIssues(design.auditStyleSpec(parseStyleTokens(doc))), 0, '默认值自己就不合格:' + JSON.stringify(def))
})

test('接线:`design layout --as 打错` 必须 die,不许静默降级', () => {
  // 静默降级的后果不只是少查一类:cjkMinSize 变 0,报告会把「你 --as 打错了」说成
  // 「你的档里没写字号」—— 给出**错误的原因**(审计实测)。
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'bin', 'sbot.js'), 'utf8')
  const at = src.indexOf("if (action === 'layout')")
  assert.ok(at > 0, '没扫到 layout 分支')
  assert.match(src.slice(at, at + 2600), /if \(asOpt && !pick\) return die\(/, 'layout 必须与 check / doctor 同口径')
  // 例外档的格式警告接在 check 分支上(不在 layout),单独钉
  const ck = src.indexOf("if (action === 'check')")
  assert.ok(ck > 0 && /design\.acceptedDocWarnings\(/.test(src.slice(ck, ck + 2600)), 'check 分支必须接上例外档格式警告')
})

test('控制台表单里不再有「字体」栏 —— 加回来要有人发现', () => {
  // ⚠ 「不该有某个东西」的断言最容易假绿 ⇒ 必须带对照组:相邻几栏还在,才证明真扫到了表单。
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'console.html'), 'utf8')
  for (const w of ['圆角', '标题字重', '投影']) assert.ok(html.includes(w), '对照组「' + w + '」应当在')
  assert.ok(html.includes('nsRound') && html.includes('nsElev'), '对照组:相邻控件 id 在')
  for (const id of ['nsSerif', 'nsCjk', 'NS_CJK', 'styleFonts']) {
    assert.ok(!html.includes(id), id + ' 不该再出现(2026-09-02 拍板去掉整个「字体」栏)')
  }
  // ⚠ 这条原先写死匹配 `<label class="f">字体</label>` —— 而当时留在表单里的是
  //   `字体（不用选）`,**精确匹配放它过去了**:控件删了、说明还在,测试照样全绿。
  //   ⇒ 判据改成「以字体开头的任何标签」,把后缀那一族一起挡住。
  assert.ok(!/<label class="f">字体/.test(html), '「字体」开头的表单标签不该再出现(含「字体（不用选）」)')
  assert.ok(!/一个字节不下载/.test(html), '那段只读字体说明不该再出现')
  // 服务端也不该再供数:唯一的消费者没了,留着就是下一次「两处各写一份」的种子
  const dsrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'design.js'), 'utf8')
  const ssrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'server.js'), 'utf8')
  assert.ok(!/function defaultFontHint/.test(dsrc), 'defaultFontHint 已无消费者,不该还留着')
  assert.ok(!/defaultFontHint/.test(ssrc), '/api/design/styles 不该再回传 fonts')
  // 对照组:那份栈本身还在(删的是展示,不是策略)—— 全删了这条测试就该报警
  assert.ok(/CJK_SYSTEM_FIRST/.test(dsrc) && /PingFang SC/.test(dsrc), '对照组:默认中文栈仍在')
  // 对照组:按档为真的那枚 chip 还在 —— 它才是「这份档中文走哪一路」的正路
  assert.ok(/cjkKinds/.test(html), '对照组:风格卡上那枚中文路数 chip 仍在')
})

test('中文字体顺序:生成器 · 内置黑体档 · 控制台界面三处必须同序', () => {
  // ⚠ 「同一份策略两个消费者读不同来源」是本项目栽过的形状 —— 这三处以前就漂过一次
  //   (控制台给自己 6 层、给用户生成 1 层)。这条断言把它钉住。
  const cjkOf = (stack) => String(stack).split(',').map((x) => x.replace(/['"]/g, '').trim())
    .filter((x) => /PingFang|Hiragino|YaHei|Noto Sans|Source Han Sans/i.test(x)).join(' → ')
  const gen = cjkOf(parseStyleTokens(design.composeStyleDoc({ name: 'x',
    colors: { bg: '#FFF', ink: '#111', accent: '#6D28D9', muted: '#6B7280' } })).typography.body.fontFamily)
  assert.ok(gen.split('→').length >= 4, '先证明真取到了中文段:' + gen)
  const builtin = cjkOf(parseStyleTokens(fs.readFileSync(
    path.join(__dirname, '..', '..', 'assets', 'design-styles', 'swiss-grid.md'), 'utf8')).typography.body.fontFamily)
  assert.equal(builtin, gen, '内置黑体档与生成器不同序')
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'console.html'), 'utf8')
  const m = /--sans:([^;]+);/.exec(html)
  assert.ok(m, '没扫到控制台那条栈')
  assert.equal(cjkOf(m[1]), gen, '控制台界面与生成器不同序')
  // ⚠ 思源必须排在雅黑**之前**:装了就比雅黑好看,没装时本来也不生效,排前面零代价
  assert.ok(gen.indexOf('Source Han Sans SC') < gen.indexOf('Microsoft YaHei'), '思源要排在雅黑之前:' + gen)
})

test('宋体只出现在大标题上,且栈里不许有中易宋体', () => {
  // 用户判断(2026-09-02):「只在大标题时使用加粗宋体会好看一点,其他情况下宋体不好看」。
  // 技术依据:宋体横细竖粗,小字号时横画在屏幕上发虚断裂;字够大才有像素撑住骨架。
  const dir = path.join(__dirname, '..', '..', 'assets', 'design-styles')
  const SERIF = /Songti|SimSun|Noto Serif|Source Han Serif/i
  let slots = 0, serifSlots = 0
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const tk = parseStyleTokens(fs.readFileSync(path.join(dir, f), 'utf8'))
    for (const [slot, v] of Object.entries(tk.typography || {})) {
      if (!v || !v.fontFamily) continue
      slots++
      assert.ok(!/SimSun/.test(String(v.fontFamily)), f + '/' + slot + ' 还挂着中易宋体')
      if (!SERIF.test(String(v.fontFamily))) continue
      serifSlots++
      const px = parseFloat(String(v.fontSize || ''))
      assert.ok(Number.isFinite(px) && px >= 28, f + '/' + slot + ' 用宋体但只有 ' + v.fontSize + ',小字宋体在屏幕上会发虚')
    }
  }
  assert.ok(slots > 40, '对照组:该扫到 40+ 个字档,实际 ' + slots)
  assert.ok(serifSlots >= 3, '对照组:该有几档确实在用宋体(全 0 说明判据没分辨力),实际 ' + serifSlots)
})

// ── 字体可得性(v0.11.66)—— 由来见 design.js fontAvailability 段头 ──────────────────────

test('fontAvailability:系统自带按平台分,通用族恒有,-apple-system 只有 mac 认', () => {
  const A = design.fontAvailability
  assert.deepEqual([A('Arial').mac, A('Arial').win], [true, true], 'Arial 两边都有')
  assert.deepEqual([A('Futura').mac, A('Futura').win], [true, false], 'Futura 只有 mac')
  assert.deepEqual([A('Segoe UI').mac, A('Segoe UI').win], [false, true], 'Segoe UI 只有 win')
  const canela = A("'Canela'")
  assert.deepEqual([canela.mac, canela.win, canela.free], [false, false, false], 'Canela 商业字体:哪儿都没有、也不免费')
  const inter = A('"INTER"')
  assert.deepEqual([inter.mac, inter.win, inter.free], [false, false, true], 'Inter 不是系统自带但免费可得;引号与大小写要归一')
  assert.equal(A('sans-serif').generic, true)
  const apple = A('-apple-system')
  assert.deepEqual([apple.generic, apple.mac, apple.win], [false, true, false], '-apple-system 不是通用族,Windows 不认')
  assert.equal(A('').key, '', '空族名不崩')
})

test('declaredFontSources:@font-face · 两代字体服务链接 · fontsource 包名 · 认不出的另计', () => {
  const S = design.declaredFontSources
  let r = S(['@font-face{font-family:"Canela";src:url(a.woff2)} .x{font-family:Canela}'])
  assert.ok(r.loaded.has('canela'), '@font-face 声明的族要认')
  r = S(['<link href="https://fonts.googleapis.com/css?family=Inter|EB+Garamond:400,700&display=swap">'])
  assert.ok(r.loaded.has('inter') && r.loaded.has('eb garamond'), '第一代写法:| 分隔、+ 是空格、: 后是字重')
  r = S(["@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Space+Grotesk&display=swap');"])
  assert.ok(r.loaded.has('inter') && r.loaded.has('space grotesk'), '第二代写法:多个 family= 参数')
  r = S(['<link href="https://fonts.loli.net/css2?family=Noto+Sans+SC">'])
  assert.ok(r.loaded.has('noto sans sc'), '国内镜像也认')
  r = S(['<link href="https://cdn.jsdelivr.net/npm/@fontsource/eb-garamond@5/index.css">'])
  assert.ok(r.loaded.has('eb garamond'), 'fontsource 包名 → 族名')
  r = S(['<link href="https://example.com/assets/fonts/brand.css">'])
  assert.equal(r.loaded.size, 0); assert.equal(r.unknownLinks, 1, '认不出族名的字体链接要计数,不能当没有')
  r = S(['/* @font-face{font-family:"Ghost"} */ .x{}'])
  assert.ok(!r.loaded.has('ghost'), '注释里的声明不算活的')
  // 对照组:普通链接不算字体链接
  r = S(['<link href="https://example.com/app.css">'])
  assert.deepEqual([r.loaded.size, r.unknownLinks], [0, 0])
})

test('fontLanding:从头走到第一个能用的;自带的优先;两边落点可以不同', () => {
  const st = "'Canela', 'Playfair Display', 'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', 'PingFang SC', 'Microsoft YaHei', serif"
  const mac = design.fontLanding(st, { platform: 'mac' }), win = design.fontLanding(st, { platform: 'win' })
  assert.deepEqual([mac.family, mac.via], ['Songti SC', 'system'], 'mac 落到宋体')
  assert.deepEqual([win.family, win.via], ['Microsoft YaHei', 'system'], '⭐ Windows 落到雅黑 —— 宋体身份整个丢掉,这正是要暴露的')
  const ld = design.fontLanding(st, { platform: 'win', loaded: new Set(['canela']) })
  assert.deepEqual([ld.family, ld.via], ['Canela', 'loaded'], '项目自带了就落在首选上')
  const g = design.fontLanding("'Ghost Font', sans-serif", { platform: 'win' })
  assert.deepEqual([g.family, g.via], ['sans-serif', 'generic'], '只剩通用族 ⇒ 浏览器默认')
  assert.equal(design.fontLanding("'Ghost Font'", { platform: 'win' }), null, '一路走到底都没有 ⇒ null')
  const ap = design.fontLanding("'SF Pro Display', -apple-system, 'PingFang SC', 'Microsoft YaHei UI', sans-serif", { platform: 'win' })
  assert.equal(ap.family, 'Microsoft YaHei UI', 'Windows 不认 -apple-system,得跳过它(第一版算错在这)')
})

const FONT_DOC = '---\nname: 字\ncolors:\n  bg: "#FFFFFF"\n  ink: "#111111"\ntypography:\n  headline:\n    fontFamily: "\'Canela\', \'Songti SC\', \'PingFang SC\', \'Microsoft YaHei\', serif"\n  body:\n    fontFamily: "\'Inter\', \'PingFang SC\', \'Microsoft YaHei UI\', sans-serif"\n  data:\n    fontFamily: "\'Futura\', \'Avenir Next\', \'PingFang SC\', \'Microsoft YaHei UI\', sans-serif"\n---\n正文\n'

test('design check: 档里声明、产物照用、却找不到加载来源的首选族 —— 报出两平台各自的落点', () => {
  const tk = parseStyleTokens(FONT_DOC)
  const css = ".h{font-family:'Canela','Songti SC','PingFang SC','Microsoft YaHei',serif} .h2{font-family:'Canela',serif} .p{font-family:'Inter','PingFang SC','Microsoft YaHei UI',sans-serif}"
  const r = design.checkDesign([{ rel: 'a.css', text: css }], tk)
  const fu = r.findings.filter((f) => f.kind === 'font-unloaded')
  assert.equal(fu.length, 2, '两个族各一条(Canela 与 Inter),不是每条栈一条:' + JSON.stringify(fu.map((f) => f.family)))
  const c = fu.find((f) => f.family === 'Canela')
  assert.ok(c, '先证明 Canela 那条真报出来了')
  assert.equal(c.stacks, 2, '同一个族两条栈 ⇒ 聚合成一条、计数 2')
  assert.deepEqual([c.mac, c.win, c.free], [false, false, false])
  assert.equal(c.landMac.family, 'Songti SC'); assert.equal(c.landWin.family, 'Microsoft YaHei')
  const i = fu.find((f) => f.family === 'Inter')
  assert.equal(i.free, true, 'Inter 要标免费可得(报告会说「加一行链接即可」)')
  // 报告:落点必须在句子里,两条出口也必须在
  const rep = design.formatCheckReport(r, { styleName: '字' })
  assert.match(rep, /「Canela」找不到加载来源/); assert.match(rep, /Songti SC/); assert.match(rep, /Microsoft YaHei/)
  assert.match(rep, /记进例外档/, '出口一:别处注入')
  assert.match(rep, /免费可得/, 'Inter 那条要给「加一行链接」的路')
  assert.match(rep, /要自带字体文件它才会出现/, 'Canela 那条只说「要自带文件」这个事实')
  assert.doesNotMatch(rep, /授权字体/, '⚠ 不断言许可:不在免费清单里 ≠ 授权字体(Inter Variable 就不在清单里)')
})

test('design check/doctor: 首选族来源的裁决只有一份(fontSourceVerdict),两处都调它', () => {
  // ⚠ v0.11.66 第一版是两处各写一遍同款判据,变异检验当场抓到 check 那份没被钉住 —— 这条钉「调的是同一个」
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'design.js'), 'utf8')
  const ck = src.indexOf("kind: 'font-unloaded'"), dr = src.indexOf("kind: 'spec-font-source'")
  assert.ok(ck > 0 && dr > 0, '两处 finding 都要在')
  assert.ok(/fontSourceVerdict\(stack/.test(src.slice(ck - 900, ck)), 'check 那条路必须经 fontSourceVerdict')
  assert.ok(/fontSourceVerdict\(v\.fontFamily/.test(src.slice(dr - 600, dr)), 'doctor 那条路必须经 fontSourceVerdict')
  assert.equal((src.match(/if \(av\.mac && av\.win\) (?:continue|return null)/g) || []).length, 1, '「两边都自带 ⇒ 不报」这句只许出现一次(在裁决函数里)')
})

test('fontSourceVerdict: 四种不该报的 —— 系统别名打头 · 苹方/雅黑跨平台栈 · 两边自带 · 已自带', () => {
  const V = design.fontSourceVerdict
  assert.equal(V("-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"), null, '系统别名打头 = 要的就是系统字体,整条不裁(审计实测被报成 Segoe UI 只有 win)')
  assert.equal(V("system-ui, 'PingFang SC', sans-serif"), null)
  assert.equal(V("'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif"), null, '中文首选、两边各落一路黑体 = 有意的跨平台写法(审计实测被误报)')
  assert.equal(V("Georgia, 'Songti SC', serif"), null, 'Georgia 两边都有')
  assert.equal(V("'Canela', serif", { loaded: new Set(['canela']) }), null, '项目自带了')
  // 对照组:该报的还报
  const serif = V("'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', 'PingFang SC', 'Microsoft YaHei', serif")
  assert.ok(serif && !serif.lostMac && serif.lostWin, '宋体栈:mac 落宋体没丢,Windows 落雅黑丢了')
  assert.equal(serif.cjk, true)
  const latin = V("'Canela', 'PingFang SC', 'Microsoft YaHei', serif")
  assert.ok(latin && latin.lostMac && latin.lostWin, '拉丁首选两边都丢')
  const fut = V("Futura, 'PingFang SC', 'Microsoft YaHei UI', sans-serif")
  assert.ok(fut && !fut.lostMac && fut.lostWin && fut.mac && !fut.win, 'Futura 只有 mac:mac 没丢,win 丢')
})

test('design doctor ⑤ 报告:中文路数变了要标 ⚠宋体→黑体;手机档不张口说 Windows', () => {
  const nc = design.auditStyleSpec(parseStyleTokens(fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'design-styles', 'neo-chinese.md'), 'utf8')))
  const line = design.formatSpecReport(nc).split('\n').find((l) => /首选字体/.test(l))
  assert.ok(line, '新中式该有这一行')
  assert.match(line, /headline「Source Han Serif SC」◇\(win→Microsoft YaHei⚠宋体→黑体\)/, '只说丢了的那一边,并标出路数变化')
  assert.doesNotMatch(line, /mac→/, 'mac 落在宋体上没丢,不该出现')
  assert.doesNotMatch(line, /body「PingFang SC」/, '正文苹方/雅黑那档是正确的跨平台写法,不该报')
  const mb = design.auditStyleSpec(parseStyleTokens('---\nplatform: 小程序\ncolors:\n  bg: "#FFFFFF"\ntypography:\n  body:\n    fontFamily: "\'Inter\', \'PingFang SC\', sans-serif"\n---\n'))
  const ml = design.formatSpecReport(mb).split('\n').find((l) => /首选字体/.test(l))
  assert.match(ml, /手机端/); assert.doesNotMatch(ml, /Windows|win→|mac→/, '手机档不能说桌面落点(清单只有 mac/win)')
  // check 那边同样
  const r = design.checkDesign([{ rel: 'a.wxss', text: ".p{font-family:'Inter','PingFang SC',sans-serif}" }], parseStyleTokens('---\nplatform: 小程序\ncolors:\n  bg: "#FFFFFF"\ntypography:\n  body:\n    fontFamily: "\'Inter\', \'PingFang SC\', sans-serif"\n---\n'))
  const rep = design.formatCheckReport(r)
  assert.match(rep, /手机上同样找不到它/); assert.doesNotMatch(rep, /Windows→|mac→/)
})

test('declaredFontSources: 正规接法自带的 preconnect 不算「认不出的链接」;畸形 % 不崩', () => {
  const S = design.declaredFontSources
  const r = S(['<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet">'])
  assert.deepEqual([[...r.loaded], r.unknownLinks], [['inter'], 0], '⚠ 审计实测:这个标准写法原先报「另有 2 个认不出」—— 每个正确接法都多一句噪音')
  assert.equal(S(['<link href="https://fonts.googleapis.com/css2">']).unknownLinks, 1, '对照组:没有 family 的**样式表**链接才算认不出')
  assert.doesNotThrow(() => S(['<link href="https://fonts.googleapis.com/css2?family=Inter%ZZ">']), '⚠ 审计实测:畸形 % 让整个 check 崩掉')
  assert.ok(S(['<link href="//fonts.googleapis.com/css?family=Lato:400,700">']).loaded.has('lato'), '协议相对的老写法也要认')
  // 小程序与 JS 侧的加载方式(DemoApp 是小程序,没有 @font-face 可扫)
  assert.ok(S(["wx.loadFontFace({ global: true, family: 'Inter', source: 'url(\"https://x/inter.woff2\")' })"]).loaded.has('inter'), 'wx.loadFontFace 要认')
  assert.ok(S(["const f = new FontFace('Canela', 'url(/c.woff2)'); document.fonts.add(f)"]).loaded.has('canela'), 'new FontFace 要认')
  // 对照组:普通的 `//` 注释残片不会被当成链接乱计
  assert.deepEqual([S(['.x{} // fonts here']).loaded.size, S(['.x{} // fonts here']).unknownLinks], [0, 0])
})

// ── 顶层 fonts 段(v0.11.68)—— 由来见 design.js CJK_STACKS 段头 ─────────────────────────

test('fonts 段:老写法逐字节不变;新写法由 fonts 默认 + 档位覆盖合成;generic 可推可给', () => {
  // 老写法:有 fontFamily 的档位一个字不动(兼容层 + 逃生口)
  const old = parseStyleTokens('---\nname: t\ntypography:\n  headline:\n    fontFamily: "A, B"\n    fontWeight: 700\n---\n')
  assert.deepEqual(old.typography.headline, { fontFamily: 'A, B', fontWeight: '700' }, '没有 fonts 段 ⇒ tokens 逐字节不变')
  const doc = '---\nname: t\nfonts:\n  latin: "\'Neue Haas Grotesk\', \'Helvetica Neue\'"\n  cjk: sans\ntypography:\n  headline:\n    latin: "\'Canela\'"\n    cjk: serif\n    fontSize: "56px"\n  body:\n    fontSize: "16px"\n  data:\n    latin: "\'Geist Mono\'"\n  note:\n    latin: ""\n    generic: "ui-monospace, monospace"\n---\n'
  const t = parseStyleTokens(doc).typography
  assert.equal(t.headline.fontFamily, "'Canela', 'Source Han Serif SC', 'Noto Serif SC', 'Songti SC', 'PingFang SC', 'Microsoft YaHei', serif", '档位覆盖拉丁 + 宋体档位 + generic 推 serif')
  assert.equal(t.body.fontFamily, design.SANS_STACK.replace("'Inter', 'Helvetica Neue'", "'Neue Haas Grotesk', 'Helvetica Neue'"), '不写 ⇒ 用 fonts 默认')
  assert.match(t.data.fontFamily, /^'Geist Mono', 'PingFang SC'.*monospace$/, '拉丁族名带 mono ⇒ generic 推 monospace')
  assert.equal(t.note.fontFamily, "'PingFang SC', 'Hiragino Sans GB', 'Source Han Sans SC', 'Noto Sans SC', 'Microsoft YaHei UI', 'Microsoft YaHei', ui-monospace, monospace", 'latin 写空 ⇒ 中文首选;generic 显式给')
  // 保留原键(L3 表单要读),fontSize 等不动
  assert.equal(t.headline.latin, "'Canela'"); assert.equal(t.headline.fontSize, '56px')
  // 裁决函数自己的契约:档位已有 fontFamily 时,即使 fonts 段在场也原样返回(老写法优先 = 逃生口)。
  // ⚠ 调用侧 applyFontsSegment 也守着这一条,两道门冗余 —— 变异检验打掉里面那道时外面那道掩护了它,
  //   所以这里直接打裁决函数。
  const both = { fonts: { latin: 'Georgia', cjk: 'serif' }, typography: { h: { fontFamily: "'Yu Mincho', serif" } } }
  assert.equal(design.resolveFontFamily(both, 'h'), "'Yu Mincho', serif", '有 fontFamily 的档位不许被 fonts 段重算')
})

test('fonts 段:四种中文档位 = 内置档扫描出的四种序列;sans 那条就是 CJK_SYSTEM_FIRST 同一个对象', () => {
  assert.strictEqual(design.CJK_STACKS.sans, design.CJK_SYSTEM_FIRST, '⚠ 不是抄一份 —— 「三处同源」钉的是同一个对象')
  assert.deepEqual(Object.keys(design.CJK_STACKS), ['sans', 'serif', 'rounded', 'hand'])
  assert.deepEqual(design.CJK_STACKS.serif, ['Source Han Serif SC', 'Noto Serif SC', 'Songti SC', 'PingFang SC', 'Microsoft YaHei'])
  assert.deepEqual(design.CJK_STACKS.rounded, ['Yuanti SC', 'Source Han Sans SC', 'PingFang SC', 'Microsoft YaHei'])
  assert.deepEqual(design.CJK_STACKS.hand, ['Xiaolai', ...design.CJK_SYSTEM_FIRST])
  // 两张词表不许再分叉:四条栈里每个族,CJK_FAMILY_RE 都得认(v0.11.68 逮到 Yuanti 不被认)
  for (const [k, st] of Object.entries(design.CJK_STACKS)) for (const f of st) assert.ok(design.CJK_FAMILY_RE.test(f), k + ' 的 ' + f + ' 不被 CJK_FAMILY_RE 认')
  // 且每条栈的路数与档位名一致
  // (手写栈的路数是「黑体·手写」—— styleCjkKinds 把手写排最后,所以看 includes 不看 [0])
  for (const [k, st] of Object.entries(design.CJK_STACKS)) assert.ok(design.styleCjkKinds({ typography: { x: { fontFamily: st.map((f) => "'" + f + "'").join(', ') } } }).includes(design.CJK_KIND_OF_STACK[k]), k + ' 的路数')
})

test('fonts 段:16 份内置档全部已迁 —— 没有一行 fontFamily,每档合成后都带中文族且身份不丢', () => {
  const dir = path.join(__dirname, '..', '..', 'assets', 'design-styles')
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.md'))
  let slots = 0, withFonts = 0
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8')
    const fm = text.split('\n').slice(1, text.split('\n').indexOf('---', 1))
    assert.equal(fm.filter((l) => /^\s+fontFamily:/.test(l)).length, 0, f + ' 还有逐档写死的 fontFamily')
    assert.ok(fm.some((l) => /^fonts:\s*$/.test(l)), f + ' 没有 fonts 段')
    withFonts++
    const tk = parseStyleTokens(text)
    for (const [s, v] of Object.entries(tk.typography || {})) {
      slots++
      assert.ok(v.fontFamily && design.CJK_FAMILY_RE.test(v.fontFamily), f + '/' + s + ' 合成后没有中文族:' + v.fontFamily)
    }
  }
  assert.ok(withFonts >= 16 && slots > 40, '对照组:16 份档 / 40+ 档位都扫到了:' + withFonts + '/' + slots)
  // 抽两份核对身份没丢:编辑风标题 Canela+宋体、正文 Neue Haas+黑体;柔和友好走圆体
  const ed = parseStyleTokens(fs.readFileSync(path.join(dir, 'editorial.md'), 'utf8')).typography
  assert.match(ed.headline.fontFamily, /^'Canela', 'Playfair Display', 'Source Han Serif SC'/)
  assert.match(ed.body.fontFamily, /^'Neue Haas Grotesk', 'PingFang SC'/)
  assert.deepEqual(design.styleCjkKinds(parseStyleTokens(fs.readFileSync(path.join(dir, 'soft-friendly.md'), 'utf8'))), ['圆体', '黑体'])
})

test('fonts 段:生成器改写新格式,合成结果与旧写法逐字相同;写错档位退黑体且 doctor 报', () => {
  const doc = design.composeStyleDoc({ name: 'x', colors: { bg: '#FFFFFF', ink: '#111111', accent: '#6D28D9', muted: '#6B7280' } })
  assert.match(doc, /^fonts:\n  latin: "'Inter', 'Helvetica Neue'"\n  cjk: sans\n/m, '生成器写 fonts 段')
  assert.doesNotMatch(doc, /fontFamily/, '档位里不再逐条写整栈')
  const t = parseStyleTokens(doc).typography
  assert.equal(t.headline.fontFamily, design.SANS_STACK); assert.equal(t.body.fontFamily, design.SANS_STACK); assert.equal(t.label.fontFamily, design.SANS_STACK)
  const bad = parseStyleTokens('---\nfonts:\n  latin: "Georgia"\n  cjk: serf\ntypography:\n  headline:\n    fontSize: "40px"\n    cjk: rounde\n---\n')
  assert.match(bad.typography.headline.fontFamily, /PingFang SC/, '认不出的档位退回黑体(档不整体失效)')
  const r = design.auditStyleSpec(bad)
  const k = r.findings.find((x) => x.kind === 'spec-fonts-kind')
  assert.ok(k && k.items.length === 2, '两处写错都要报:' + JSON.stringify(k && k.items))
  assert.match(design.formatSpecReport(r), /中文档位写错了:fonts 写的是「serf」 · headline 写的是「rounde」/)
  assert.match(design.formatSpecReport(r), /宋体风格会悄悄变成黑体/)
})

test('design check: 有加载来源就不报 —— @font-face 跨文件生效 · 字体服务链接 · 系统自带', () => {
  const tk = parseStyleTokens(FONT_DOC)
  const use = ".h{font-family:'Canela',serif} .p{font-family:'Inter',sans-serif}"
  // @font-face 在另一个文件里 ⇒ 也算(分开查会把「css 里声明了」读成「html 里没来源」)
  let r = design.checkDesign([{ rel: 'a.html', text: '<style>' + use + '</style>' }, { rel: 'fonts.css', text: '@font-face{font-family:"Canela";src:url(c.woff2)}' }], tk)
  assert.ok(!r.findings.some((f) => f.kind === 'font-unloaded' && f.family === 'Canela'), 'Canela 有 @font-face ⇒ 不报')
  assert.ok(r.findings.some((f) => f.kind === 'font-unloaded' && f.family === 'Inter'), '对照组:同一批里 Inter 没来源,仍该报(证明不是整类被关掉)')
  // 字体服务链接
  r = design.checkDesign([{ rel: 'a.html', text: '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400"><style>' + use + '</style>' }], tk)
  assert.ok(!r.findings.some((f) => f.kind === 'font-unloaded' && f.family === 'Inter'), 'Inter 有字体服务链接 ⇒ 不报')
  // 产物用的族不在档里 ⇒ 那是 'font' 偏离,不再叠一条 unloaded(双份噪音)
  r = design.checkDesign([{ rel: 'a.css', text: ".x{font-family:'Söhne',sans-serif}" }], tk)
  assert.ok(r.findings.some((f) => f.kind === 'font'), '对照组:字体偏离那条照报')
  assert.ok(!r.findings.some((f) => f.kind === 'font-unloaded'), '不在档里的族不叠报')
  // 只有一边自带 ⇒ 报,且说清是哪一边
  r = design.checkDesign([{ rel: 'a.css', text: ".d{font-family:'Futura','Avenir Next','PingFang SC','Microsoft YaHei UI',sans-serif}" }], tk)
  const fu = r.findings.find((f) => f.kind === 'font-unloaded')
  assert.ok(fu && fu.mac && !fu.win, 'Futura 只有 mac 自带 ⇒ 报 Windows 那一边')
  assert.equal(fu.landWin.family, 'Microsoft YaHei UI')
  assert.match(design.formatCheckReport(r), /只有 mac 自带,Windows 上没有/)
  // 认不出的外部字体链接 ⇒ 报告里如实点出个数
  r = design.checkDesign([{ rel: 'a.html', text: '<link href="https://cdn.example.com/fonts/brand.css"><style>' + use + '</style>' }], tk)
  assert.match(design.formatCheckReport(r), /另有 1 个外部样式表链接认不出族名/)
  // 风格档没写字体 ⇒ 整类不查(没依据就不报)
  r = design.checkDesign([{ rel: 'a.css', text: use }], parseStyleTokens('---\ncolors:\n  bg: "#FFFFFF"\n---\n'))
  assert.ok(!r.findings.some((f) => f.kind === 'font-unloaded'))
  // 档声明的是两边都自带的族、产物照用 ⇒ 不报(⚠ 这条钉的是 check 里那句 `mac && win ⇒ continue`,
  //   变异检验发现它此前没被任何用例钉住 —— doctor 那份同款判据有钉,check 这份没有)
  const sysDoc = parseStyleTokens('---\ncolors:\n  bg: "#FFFFFF"\ntypography:\n  headline:\n    fontFamily: "Georgia, \'Songti SC\', serif"\n  body:\n    fontFamily: "Arial, \'PingFang SC\', sans-serif"\n---\n')
  r = design.checkDesign([{ rel: 'a.css', text: ".h{font-family:Georgia,'Songti SC',serif} .p{font-family:Arial,'PingFang SC',sans-serif}" }], sysDoc)
  assert.ok(!r.findings.some((f) => f.kind === 'font-unloaded'), 'Georgia / Arial 两边都自带 ⇒ 不报:' + JSON.stringify(r.findings))
  assert.ok(r.findings.filter((f) => f.kind === 'font').length === 0, '对照组:它们也在档里,字体偏离也不报')
})

test('design check: font-unloaded 按族接受 —— 接受了 Canela 不等于接受了 Inter', () => {
  const tk = parseStyleTokens(FONT_DOC)
  const css = ".h{font-family:'Canela',serif} .p{font-family:'Inter',sans-serif}"
  assert.equal(design.findingKey({ kind: 'font-unloaded', family: "'Canela'" }), 'font-unloaded|canela')
  const r = design.checkDesign([{ rel: 'a.css', text: css }], tk, { accepted: { 'font-unloaded|canela': '由构建工具注入' } })
  assert.ok(r.accepted.some((f) => f.family === 'Canela'), 'Canela 挪进 accepted')
  assert.ok(r.findings.some((f) => f.kind === 'font-unloaded' && f.family === 'Inter'), 'Inter 仍在 findings')
})

test('design doctor ⑤: 16 份内置档首选字体全都不是系统自带 —— 这条判据就是为暴露它而生', () => {
  // ⚠ 不是「16 份档都错了」,是「16 份档的字体身份都依赖项目自带字体文件」,而此前没有任何一处说过这件事。
  const dir = path.join(__dirname, '..', '..', 'assets', 'design-styles')
  const files = fs.readdirSync(dir).filter((x) => x.endsWith('.md'))
  let flagged = 0, winYahei = 0
  for (const f of files) {
    const r = design.auditStyleSpec(parseStyleTokens(fs.readFileSync(path.join(dir, f), 'utf8')))
    const it = r.findings.find((x) => x.kind === 'spec-font-source')
    if (!it) continue
    flagged++
    const h = it.items.find((i) => i.slot === 'headline')
    if (h && h.landWin && /YaHei/.test(h.landWin.family)) winYahei++
  }
  assert.ok(files.length >= 16, '对照组:该扫到 16 份')
  assert.ok(flagged >= 14, '内置档几乎份份如此(实测 16/16),低于 14 说明判据或档变了:' + flagged)
  assert.ok(winYahei >= 14, '⭐ Windows 上标题落到雅黑(实测 16/16;第一版把 -apple-system 算成 Windows 落点时是 15)—— 衬线档与几何档的身份在 Windows 上整个消失:' + winYahei)
  // 对照组:首选是两边都自带的族 ⇒ 不报(证明不是「有字体就报」)
  const ok = design.auditStyleSpec(parseStyleTokens('---\ncolors:\n  bg: "#FFFFFF"\ntypography:\n  headline:\n    fontFamily: "Georgia, serif"\n  body:\n    fontFamily: "Arial, sans-serif"\n---\n'))
  assert.ok(!ok.findings.some((x) => x.kind === 'spec-font-source'), 'Georgia / Arial 两边都有 ⇒ 不报')
  // 这一类不进 specHardIssues(内置档份份如此,进指针就是常驻噪音)
  const one = design.auditStyleSpec(parseStyleTokens(FONT_DOC))
  assert.ok(one.findings.some((x) => x.kind === 'spec-font-source'))
  assert.equal(design.specHardIssues({ findings: one.findings.filter((x) => x.kind === 'spec-font-source') }), 0, '不进 check 末尾那行指针')
  const rep = design.formatSpecReport(one)
  assert.match(rep, /首选字体不是系统自带/); assert.match(rep, /headline「Canela」/); assert.match(rep, /data「Futura」◆/, '仅一边自带要标 ◆')
  assert.match(rep, /body「Inter」◇/, '免费可得要标 ◇')
})
