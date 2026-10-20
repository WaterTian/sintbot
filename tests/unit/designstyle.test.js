// 自定义风格(v0.11.21)—— src/design.js 里「表单 → 风格档」那一整条链的纯逻辑:
//   normalizeStyleForm / validateStyleForm / validateStyleSlug / suggestSlug   表单归一与校验
//   composeStyleDoc                                                            表单 → 合规风格档
//   styleFormFromDoc / quantizeRounded / quantizeWeight                        风格档 → 表单(复制为新款)
//   withStyleName                                                              收录时改名
//   saveUserStyle / deleteUserStyle                                            落盘:冲突 / 遮蔽 / 回归
//   colorLiterals / parseCssCandidates / extractFormFromTexts                  从参考提炼(CSS 解析)
//   parseHtmlStyleRefs / extractFromUrl / scanProjectDir / extractFromDir      网址与目录两条入口 + 围栏
//
// 两条不变量贯穿全篇,坏了就是产品级 bug:
//   ① 生成的档**只用四个语义键名**(bg/ink/accent/muted)⇒ styleRoles 整键名命中,
//      用户点的「强调色」就是图上按钮那块 —— 而不是退回「挑彩度最高的」(v0.9.3 真机踩过)
//   ② 四个圆角档在预览图上**肉眼可分** —— 分不出的档位等于没给选项

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  SCENE_WORDS, ROUND_LEVELS, WEIGHT_LEVELS,
  EXTRA_COLOR_MAX, deriveExtraTokens, deriveStyleTraits, describeExtract,
  normalizeStyleForm, validateStyleForm, validateStyleSlug, suggestSlug,
  composeStyleDoc, styleFormFromDoc, withStyleName, quantizeRounded, quantizeWeight,
  saveUserStyle, deleteUserStyle,
  colorLiterals, parseCssCandidates, dedupeColors, extractFormFromTexts,
  parseHtmlStyleRefs, extractFromUrl, scanProjectDir, extractFromDir,
  isPublicHostname, SSRF_MSG, projectStyleCard,
  isStyleDoc, parseStyleMeta, parseStyleTokens, styleRoles, swatchSpec, swatchLayout, styleCard, listStyles,
  findStyleDocs, resolveStyleTarget, resolveStyleAs, withStylePlatform, pickStyleDoc, projectStyleCards,
  styleProse, withStyleProse, withKeptSections, iconSpec,
} = require('../../src/design')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-nsty-'))
const FORM = {
  name: '品牌紫',
  description: '干净、克制:大留白 + 一点紫',
  suits: ['工具产品', '品牌门面'],
  colors: { bg: '#FFFFFF', ink: '#172033', accent: '#6D28D9', muted: '#6B7280' },
  rounded: 'soft',
  weight: 'heavy',
  serif: false,
  mono: true,
}

// ── 表单归一 / 校验 ───────────────────────────────────────────────────────────

test('normalizeStyleForm:认不出的值一律退回默认,不抛错(实时预览要能吃半填的表单)', () => {
  const f = normalizeStyleForm({ name: '  x  ', colors: { bg: 'not-a-color' }, rounded: '???', weight: 9, suits: ['不存在的场景'] })
  assert.equal(f.name, 'x')
  assert.equal(f.colors.bg, '#FFFFFF') // 坏色值退默认而不是崩
  assert.equal(f.rounded, 'subtle')
  assert.equal(f.weight, 'medium')
  assert.deepEqual(f.suits, [])
  assert.deepEqual(normalizeStyleForm(null).suits, []) // null / undefined 也要活着回来
  assert.equal(normalizeStyleForm(undefined).colors.accent, '#6D28D9')
})

test('normalizeStyleForm:三位 hex 补全成六位并大写;场景按词表顺序去重', () => {
  const f = normalizeStyleForm({ name: 'a', colors: { bg: '#fff', ink: '#000' }, suits: ['工具产品', '内容阅读', '工具产品'] })
  assert.equal(f.colors.bg, '#FFFFFF')
  assert.equal(f.colors.ink, '#000000')
  assert.deepEqual(f.suits, ['内容阅读', '工具产品'])
})

test('normalizeStyleForm:名称/描述里的引号与换行被剔掉 —— 否则写出的 front matter 自己解析不回来', () => {
  const f = normalizeStyleForm({ name: '他说"很好"\n下一行', description: 'a\\b' })
  assert.equal(f.name, '他说很好 下一行')
  assert.equal(f.description, 'ab')
  const doc = composeStyleDoc(f)
  assert.equal(parseStyleMeta(doc).name, '他说很好 下一行', '带引号的名字必须能原样读回来')
})

test('validateStyleForm:名称必填 / 四个色都要合法 / 档位与场景要在词表里', () => {
  assert.throws(() => validateStyleForm({ ...FORM, name: '   ' }), /名称必填/)
  assert.throws(() => validateStyleForm({ ...FORM, colors: { ...FORM.colors, accent: 'purple' } }), /强调.*#RRGGBB/s)
  assert.throws(() => validateStyleForm({ ...FORM, colors: { ...FORM.colors, bg: '' } }), /底色.*(空)/s)
  assert.throws(() => validateStyleForm({ ...FORM, rounded: 'roundish' }), /圆角档位/)
  assert.throws(() => validateStyleForm({ ...FORM, weight: 'ultra' }), /字重档位/)
  assert.throws(() => validateStyleForm({ ...FORM, suits: ['随便写的'] }), /不在词表里/)
  assert.equal(validateStyleForm(FORM).name, '品牌紫') // 正常表单原样通过
})

test('validateStyleSlug:白名单形状 —— 路径穿越与大写空格一律挡在拼路径之前', () => {
  assert.equal(validateStyleSlug(' brand-purple '), 'brand-purple')
  for (const bad of ['', '  ', '../evil', 'a/b', 'Brand', 'brand purple', '-lead', 'x'.repeat(42), 'a.b', '中文']) {
    assert.throws(() => validateStyleSlug(bad), /标识/, `「${bad}」不该被放行`)
  }
  assert.equal(validateStyleSlug('x'.repeat(41)), 'x'.repeat(41)) // 上限是 41 位(首位 + 40)
})

test('suggestSlug:ASCII 名字才给建议,中文名不硬转', () => {
  assert.equal(suggestSlug('Brand Purple'), 'brand-purple')
  assert.equal(suggestSlug('  ACME__2026!  '), 'acme-2026')
  assert.equal(suggestSlug('品牌紫'), '')
  assert.equal(suggestSlug('!!!'), '')
})

// ── composeStyleDoc(核心:生成物必须是一份能被本系统读回来的合规风格档)────────

test('composeStyleDoc:出的是合规风格档 —— 认帧过、元信息读得回、五语义键在', () => {
  const doc = composeStyleDoc(FORM)
  assert.equal(isStyleDoc(doc), true, 'front matter 里必须有顶层 colors,否则落盘那侧会拒收')
  assert.deepEqual(parseStyleMeta(doc), { name: '品牌紫', description: '干净、克制:大留白 + 一点紫', suits: '品牌门面 · 工具产品', platform: '' })
  const t = parseStyleTokens(doc)
  // ⭐ 只许语义键名。line 是第五个(v0.11.21 修):它不显式写下来,styleRoles 的兜底会
  // 「从没被认领的色里挑一个」当分割线,而补充色恰恰是那批没被认领的 —— 见下面那条用例。
  assert.deepEqual(Object.keys(t.colors), ['bg', 'ink', 'accent', 'muted', 'line'], '⭐ 只许语义键名')
  assert.equal(t.spacing.unit, '8px')
  assert.equal(t.border.width, '1px')
})

// ── 一个项目多份风格档(v0.11.22)──────────────────────────────────────────────
// 起因(DemoApp 真机):同一个项目有小程序与后台网站两块面,圆角尺度 / 间距 / 正文字号 /
// 层级表达没有一项相同 —— 压成一份档,数出来的众数不属于任何一块。

const mkProject = () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'design', 'styles'), { recursive: true })
  return root
}
const doc = (name, platform) => `---\nname: ${name}${platform ? `\nplatform: "${platform}"` : ''}\ncolors:\n  bg: "#FFFFFF"\n  ink: "#111111"\n---\n\n正文\n`

test('findStyleDocs:老位置那份排最前(= 没指名时用它),design/styles 按文件名跟在后面', () => {
  const root = mkProject()
  fs.writeFileSync(path.join(root, 'DESIGN.md'), doc('通用'))
  fs.writeFileSync(path.join(root, 'design', 'styles', 'miniprogram.md'), doc('小程序档', '小程序'))
  fs.writeFileSync(path.join(root, 'design', 'styles', 'admin.md'), doc('后台档', '后台网站'))
  const docs = findStyleDocs({ cwd: root })
  assert.deepEqual(docs.map((d) => d.rel), ['DESIGN.md', path.join('design', 'styles', 'admin.md'), path.join('design', 'styles', 'miniprogram.md')])
  assert.deepEqual(docs.map((d) => d.platform), ['', '后台网站', '小程序'])
})

test('findStyleDocs:design/styles 里的非风格档不列(喂给生图后端只会把画面带偏)', () => {
  const root = mkProject()
  fs.writeFileSync(path.join(root, 'design', 'styles', 'notes.md'), '# 随手记\n\n不是风格档\n')
  fs.writeFileSync(path.join(root, 'design', 'styles', 'web.md'), doc('前台', '网页前台'))
  assert.deepEqual(findStyleDocs({ cwd: root }).map((d) => d.name), ['前台'])
})

test('findStyleDocs:一份都没有 ⇒ 空数组(而不是抛错)', () => {
  assert.deepEqual(findStyleDocs({ cwd: tmp() }), [])
})

test('--as 载体词 ⇒ 落 design/styles/ 的固定英文名 + 该写进档的 platform', () => {
  assert.deepEqual(resolveStyleAs('小程序'), { slug: 'miniprogram', platform: '小程序' })
  assert.deepEqual(resolveStyleAs('后台网站'), { slug: 'admin', platform: '后台网站' })
  // 自由用途名也收(一个项目的分面不见得都落进那五个词)
  assert.deepEqual(resolveStyleAs('landing-2026'), { slug: 'landing-2026', platform: '' })
  assert.throws(() => resolveStyleAs('大屏 Screen'), /--as/) // 中文文件名跨机同步迟早出事
})

test('--as:目标已存在仍要 --force;非风格档一律拒(不覆盖别人的文件)', () => {
  const root = mkProject()
  const target = path.join(root, 'design', 'styles', 'admin.md')
  const r = resolveStyleTarget({ cwd: root, as: '后台网站' })
  assert.equal(r.path, target)
  assert.equal(r.platform, '后台网站')
  fs.writeFileSync(target, doc('后台档', '后台网站'))
  assert.throws(() => resolveStyleTarget({ cwd: root, as: '后台网站' }), /--force/)
  assert.equal(resolveStyleTarget({ cwd: root, as: '后台网站', force: true }).path, target)
  fs.writeFileSync(target, '# 我是别的文档\n')
  assert.throws(() => resolveStyleTarget({ cwd: root, as: '后台网站', force: true }), /不是风格档/)
})

test('withStylePlatform:文件名只是文件名,「这份管哪块」必须写进档里', () => {
  const t = withStylePlatform(doc('后台档'), '后台网站')
  assert.equal(parseStyleMeta(t).platform, '后台网站')
  assert.equal(parseStyleMeta(withStylePlatform(t, '小程序')).platform, '小程序') // 覆盖而不是追加第二行
  assert.equal(withStylePlatform('# 不是风格档\n', '小程序'), '# 不是风格档\n')
})

test('pickStyleDoc:载体词 / 文件名 / 档名三种写法都认,不指名取第一份,认不出给 null', () => {
  const docs = [
    { rel: 'DESIGN.md', name: '通用', platform: '' },
    { rel: path.join('design', 'styles', 'admin.md'), name: '后台档', platform: '后台网站' },
  ]
  assert.equal(pickStyleDoc(docs, '后台网站').name, '后台档')
  assert.equal(pickStyleDoc(docs, 'admin').name, '后台档')
  assert.equal(pickStyleDoc(docs, 'admin.md').name, '后台档')
  assert.equal(pickStyleDoc(docs, '后台档').name, '后台档')
  assert.equal(pickStyleDoc(docs, '').name, '通用') // 不指名 ⇒ 通用档;调用方负责说出用了哪份
  assert.equal(pickStyleDoc(docs, '海报'), null)    // 认不出**不猜**,由调用方报错
})

test('pickStyleDoc:一份档标了两个载体时,指名其中任一个都要命中', () => {
  const docs = [{ rel: 'DESIGN.md', name: '通用', platform: '' }, { rel: 'x.md', name: '两用', platform: '小程序 · 后台网站' }]
  assert.equal(pickStyleDoc(docs, '小程序').name, '两用')
  assert.equal(pickStyleDoc(docs, '后台网站').name, '两用') // 只认全等的话这条会漏 ⇒「明明标了却说没有」
})

// 截断只许发生在控制台那条路。findStyleDocs 是**清单与 CLI** 吃的,少列一份 = 告诉 agent
// 「这个项目只有这些档」,而那是假话 —— 静默截断被读成「已覆盖全部」是本仓库反复踩过的那类。
test('份数上限只作用于控制台的卡片,不作用于清单/CLI 看的那份清单', () => {
  const root = mkProject()
  for (let i = 0; i < 11; i++) fs.writeFileSync(path.join(root, 'design', 'styles', `s${i}.md`), doc('s' + i))
  assert.equal(findStyleDocs({ cwd: root }).length, 11, 'findStyleDocs 不许截断')
  assert.equal(projectStyleCards(root).length, 8, '群卡侧封顶(每张卡背一份图元表,挂在心跳上)')
})

test('projectStyleCards:每份一张卡,带 rel 与 platform(群卡靠它把几份分开)', () => {
  const root = mkProject()
  fs.writeFileSync(path.join(root, 'design', 'styles', 'miniprogram.md'), doc('小程序档', '小程序'))
  fs.writeFileSync(path.join(root, 'design', 'styles', 'admin.md'), doc('后台档', '后台网站'))
  const cards = projectStyleCards(root)
  assert.deepEqual(cards.map((c) => [c.name, c.platform]), [['后台档', '后台网站'], ['小程序档', '小程序']])
  assert.ok(cards[0].layout && cards[0].layout.rects.length, '每张卡都要带图元表(群卡直接画)')
  assert.equal(cards[0].form, undefined, '群卡这条不带表单六项 —— 它挂在 /api/state 上,每个绑定群都背一份是白扛的字节')
})

// ── 修改已有自定义风格:正文去留(v0.11.23)──────────────────────────────────
// 表单只管 tokens,正文是人在群里一轮轮磨出来的 ⇒ 「改个强调色」不该把它冲掉。
// ⚠ 「正文是不是还是生成的骨架」**判不了**:旧版本生成的档与当前模板天然不同,
//    自动判会把它们一律误判成手改、永久冻住正文 ⇒ 交给人选,默认保留。

test('withStyleProse:front matter 换新、正文逐字节不动', () => {
  const before = composeStyleDoc(FORM)
  const hand = before.replace("- Do:待补 —— 这套风格最该坚持的两三件事。", '- Do:强调色一屏只出现一次。')
  const after = withStyleProse(composeStyleDoc({ ...FORM, colors: { ...FORM.colors, accent: '#FF0000' } }), hand)
  assert.equal(parseStyleTokens(after).colors.accent, '#FF0000', '设定要换成新的')
  assert.equal(styleProse(after), styleProse(hand), '正文必须逐字节保住(手写的细则不许丢)')
  assert.match(after, /强调色一屏只出现一次/)
  assert.equal(isStyleDoc(after), true)
})

test('withStyleProse:改两次也不走样(拼接不吃掉正文开头的空行)', () => {
  const a = composeStyleDoc(FORM)
  const b = withStyleProse(composeStyleDoc({ ...FORM, weight: 'heavy' }), a)
  const c = withStyleProse(composeStyleDoc({ ...FORM, weight: 'light' }), b)
  assert.equal(styleProse(c), styleProse(a)) // split/join 不是逆运算,少一个换行就会逐次吃空行
})

test('withStyleProse:旧档没正文/不是风格档 ⇒ 原样用新档,不炸', () => {
  const fresh = composeStyleDoc(FORM)
  assert.equal(withStyleProse(fresh, ''), fresh)
  assert.equal(withStyleProse(fresh, '# 随手记\n没有 front matter\n'), fresh)
})

test('styleProse:没有 front matter ⇒ 空串(不去正文里瞎猜)', () => {
  assert.equal(styleProse('# 架构设计\n正文\n'), '')
  assert.ok(styleProse(composeStyleDoc(FORM)).includes('## Overview'), '对照组:正常风格档取得到正文')
})

// ── 三样有预览通道的属性:渐变 · 投影 · 状态色(v0.11.22)──────────────────────
// ⭐ 头号不变量:它们走 front matter 的**顶层独立段**,绝不进 colors ⇒ 抢不走五个角色。
//    v0.9.2 的教训是「彩度最高的那个自动当强调」,而危险红天生彩度最高 —— 一旦把状态色
//    写进 colors,作者点的强调色当场被挤掉,且他无从察觉(图变了,档看着还挺对)。

test('⭐ 状态色抢不走强调色 —— 危险红彩度最高,accent 仍是作者点的那个', () => {
  const doc = composeStyleDoc({ ...FORM, colors: { ...FORM.colors, accent: '#6B7280' }, statusColors: { danger: '#FF0000', success: '#00FF00' } })
  const t = parseStyleTokens(doc)
  assert.deepEqual(Object.keys(t.colors), ['bg', 'ink', 'accent', 'muted', 'line'], '状态色不许出现在 colors 段')
  assert.equal(styleRoles(t.colors).accent, '#6B7280') // 灰强调色 vs 纯红状态色,选的仍是灰
  assert.equal(swatchSpec(doc).status.length, 2)      // 对照组:状态色确实写进去了(不是「根本没写」)
})

test('渐变:写进档、按钮图元带 grad;两端同色当场报错(那是纯色不是渐变)', () => {
  const doc = composeStyleDoc({ ...FORM, gradientTo: '#2E1065' })
  assert.equal(swatchSpec(doc).gradient.from, FORM.colors.accent) // from 恒是强调色
  assert.equal(swatchSpec(doc).gradient.to, '#2E1065')
  const grads = swatchLayout(swatchSpec(doc)).rects.filter((r) => r.grad)
  assert.equal(grads.length, 1, '渐变落在强调按钮上,只此一处')
  assert.equal(grads[0].fill, FORM.colors.accent)
  assert.throws(() => validateStyleForm({ ...FORM, gradientTo: FORM.colors.accent }), /纯色/)
  // 不写渐变的档:一个带 grad 的图元都没有(缺省不改老图)
  assert.equal(swatchLayout(swatchSpec(composeStyleDoc(FORM))).rects.filter((r) => r.grad).length, 0)
})

test('投影:none 不画阴影、color 把阴影染成强调色', () => {
  const none = swatchLayout(swatchSpec(composeStyleDoc({ ...FORM, elevation: 'none' })))
  assert.equal(none.rects.filter((r) => /^#[0-9A-F]{6}[0-9A-F]{2}$/.test(r.fill)).length, 0, 'none 档不该有半透明阴影图元')
  assert.equal(none.rects[0].x, 0, '不投影 ⇒ 卡片铺满,不再让出偏移')
  const col = swatchLayout(swatchSpec(composeStyleDoc({ ...FORM, elevation: 'color' })))
  const sh = col.rects.find((r) => /^#[0-9A-F]{6}[0-9A-F]{2}$/.test(r.fill))
  assert.ok(sh, '彩色档该有一层半透明阴影')
  assert.equal(sh.fill.slice(0, 7), FORM.colors.accent, '彩色档的阴影染强调色')
})

// 回归纪律:16 种内置预设一个都没写 elevation/gradient/status ⇒ 它们的图元表必须**逐字节不变**。
// 这条钉住的是「新通道全部缺省关闭」,坏了的话整库的图会集体变样而没人说得清为什么。
test('缺省三通道全关 ⇒ 内置预设的图元表与新属性无关', () => {
  const doc = '---\nname: 老档\ncolors:\n  bg: "#FFFFFF"\n  ink: "#111111"\n---\n'
  const spec = swatchSpec(doc)
  assert.equal(spec.gradient, null)
  assert.equal(spec.elevation, null)
  assert.deepEqual(spec.status, [])
  const lay = swatchLayout(spec)
  assert.equal(lay.rects[0].fill, '#00000010', '老档的硬阴影仍是那个 6% 中性黑')
  assert.equal(lay.rects[0].x, 3, '偏移仍是 3')
})

// 既有缺陷(v0.11.22 顺手修):片宽/间距写死 16/5 ⇒ **12 片起**真的画到卡片外面(实测 12 片
// 右沿 265 > 卡宽 260,被 viewBox 裁掉)。加了状态色后更容易撞:5 角色 + 6 补充色 + 3 状态 = 14 片,
// 正是本用例的形状。
test('色板条:十几片也全在卡内(自适应片宽),状态色画成圆点排在右边', () => {
  const doc = composeStyleDoc({
    ...FORM,
    extraColors: ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'],
    statusColors: { success: '#2E7D32', warning: '#D4A017', danger: '#E53935' },
  })
  const lay = swatchLayout(swatchSpec(doc))
  const out = lay.rects.filter((r) => r.x < -0.01 || r.x + r.w > lay.w + 0.01 || r.y < -0.01 || r.y + r.h > lay.h + 0.01)
  assert.deepEqual(out, [], '任何图元都不许越出卡片(SVG 那侧会被 viewBox 悄悄裁掉,群图那侧直接越界)')
  assert.ok(lay.rects.length > 20, '对照组:图元确实画了(不是「什么都没画」所以没越界)')
})

test('「复制为新款」把三样一起带回表单(丢了就是悄悄退回纯色按钮 + 默认投影)', () => {
  const doc = composeStyleDoc({ ...FORM, gradientTo: '#2E1065', elevation: 'color', statusColors: { danger: '#E53935' } })
  const f = styleFormFromDoc(doc)
  assert.equal(f.gradientTo, '#2E1065')
  assert.equal(f.elevation, 'color')
  assert.deepEqual(f.statusColors, { danger: '#E53935' })
})

// ── 提炼这三样(确定性统计)──────────────────────────────────────────────────

test('提炼:没有一处 box-shadow ⇒ none(那是真结论,不是没读到)', () => {
  const t = deriveStyleTraits(parseCssCandidates(['body{background:#fff;color:#111}']), '#111111')
  assert.equal(t.elevation, 'none')
  assert.equal(t.gradientTo, undefined) // 提不出的项根本不出现
  assert.equal(t.statusColors, undefined)
})

test('提炼:彩色投影占比够高 ⇒ color;渐变取离强调色更远的那一端', () => {
  const css = '.a{box-shadow:0 8px 24px rgba(212,160,23,0.3)}.b{box-shadow:0 8px 24px rgba(27,107,55,0.32)}'
    + '.c{background:linear-gradient(135deg,#0D3B1F,#1B6B37)}.d{background:linear-gradient(135deg,#0D3B1F,#1B6B37)}'
  const t = deriveStyleTraits(parseCssCandidates([css]), '#1B6B37')
  assert.equal(t.elevation, 'color')
  assert.equal(t.gradientTo, '#0D3B1F') // 强调色是那支亮绿 ⇒ 该带回来的是深绿那端
})

test('提炼:状态色只认变量名的语义,不认颜色本身(红也可能就是品牌色)', () => {
  const t = deriveStyleTraits(parseCssCandidates([':root{--color-success:#34A853;--destructive:#E53935;--color-red:#FF0000}']), '#000000')
  assert.deepEqual(t.statusColors, { success: '#34A853', danger: '#E53935' }) // --color-red 不是语义名,不收
})

// oklch:Tailwind v4 / shadcn 现在默认就把整套主题写成它,不认 ⇒ 现代后台一个主色都读不到
test('提色:认 oklch(与浏览器口径对齐:纯白纯黑精确、色相落在同一支)', () => {
  assert.equal(colorLiterals('oklch(1 0 0)')[0], '#FFFFFF')
  assert.equal(colorLiterals('oklch(0 0 0)')[0], '#000000')
  const g = colorLiterals('oklch(0.42 0.12 152)')[0]
  const rgb = [1, 3, 5].map((i) => parseInt(g.slice(i, i + 2), 16))
  assert.ok(rgb[1] > rgb[0] && rgb[1] > rgb[2], 'hue 152 是绿:G 通道该最大,实际 ' + g)
  assert.equal(colorLiterals('oklch(0.5 0.1 20 / 0.02)').length, 0, '近乎全透明的不算一个色(与 rgba 同判)')
})

test('提炼:小程序样式后缀 .wxss 也扫得到(不然「小程序」这个载体根本提不出来)', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'app.wxss'), 'page{background:#F5F5F5;color:#333333}')
  const r = scanProjectDir(dir)
  assert.deepEqual(r.files, ['app.wxss'])
})

// ── 载体维度(v0.11.22)────────────────────────────────────────────────────────
// 载体与场景是两个轴:场景答「做什么」、载体答「在哪儿看」。**留空是常态**(通用款),
// 所以「没标时一个字都不多写」与「标了时写对」同等重要 —— 前者是 16 种内置预设零改动的前提。

test('载体:标了 ⇒ front matter 出 platform、Layout 段带该载体的画布口径', () => {
  const doc = composeStyleDoc({ ...FORM, platforms: ['小程序'] })
  assert.equal(parseStyleMeta(doc).platform, '小程序')
  assert.ok(doc.includes('画布(小程序)'), '画布口径要点名是哪个载体的') // 全角括号,别写成正则捕获组
  assert.match(doc, /750rpx/) // 画布口径是这份档最先被用到的一个数,不能只写个标签
})

test('载体:没标 ⇒ 档里一个字都不多写(通用款不该被硬塞一个画布)', () => {
  const doc = composeStyleDoc(FORM)
  assert.equal(parseStyleMeta(doc).platform, '')
  assert.doesNotMatch(doc, /^platform:/m)
  assert.doesNotMatch(doc, /画布/)
  assert.match(doc, /基础间距单位/) // 对照组:Layout 段本身在 —— 否则上面两条是「根本没扫到」
})

test('载体:多选按词表顺序输出、去重、认不出的丢掉', () => {
  const f = normalizeStyleForm({ platforms: ['印刷物料', '小程序', '小程序', '大屏'] })
  assert.deepEqual(f.platforms, ['小程序', '印刷物料'])
})

test('载体:落盘校验对词表外的词报错(直打接口这条路不许静默丢)', () => {
  assert.throws(() => validateStyleForm({ ...FORM, platforms: ['大屏'] }), /载体/)
})

test('载体:「复制为新款」把它带回表单(丢了就等于复制出来的那套没归属)', () => {
  const doc = composeStyleDoc({ ...FORM, platforms: ['后台网站'] })
  assert.deepEqual(styleFormFromDoc(doc).platforms, ['后台网站'])
  assert.deepEqual(styleFormFromDoc(doc).suits, ['品牌门面', '工具产品']) // 场景那条同路回收,顺带钉住没被载体挤掉
})

// v0.9.3 真机事故的根:键名叫 blue/yellow 时,改色值改不动角色归属,按钮恒是彩度最高那个。
// 语义键名把这条路从源头堵死 —— 这是整套「新建风格」最要紧的一条设计。
test('composeStyleDoc ⭐ 强调色就是用户点的那个:角色判定四项与表单逐一对上', () => {
  const roles = styleRoles(parseStyleTokens(composeStyleDoc(FORM)).colors)
  assert.equal(roles.bg, '#FFFFFF')
  assert.equal(roles.ink, '#172033')
  assert.equal(roles.accent, '#6D28D9')
  assert.equal(roles.muted, '#6B7280')
  // 强调色挑一个**彩度低于 muted** 的:靠启发式的话它永远选不上,只有键名命中才对得住用户
  const dull = { ...FORM, colors: { bg: '#FFFFFF', ink: '#111111', accent: '#7A7F87', muted: '#C0392B' } }
  assert.equal(styleRoles(parseStyleTokens(composeStyleDoc(dull)).colors).accent, '#7A7F87')
})

test('composeStyleDoc:深浅不给选 —— 底色亮度自己判', () => {
  assert.equal(styleRoles(parseStyleTokens(composeStyleDoc(FORM)).colors).dark, false)
  const dark = { ...FORM, colors: { ...FORM.colors, bg: '#0F1117', ink: '#E6E8EF' } }
  assert.equal(styleRoles(parseStyleTokens(composeStyleDoc(dark)).colors).dark, true)
})

// 四档若在图上分不出来,这个选项就是假的 —— 用户点了四次看到同一张图。
test('composeStyleDoc ⭐ 圆角四档在预览图上两两可分(卡片圆角 + 按钮圆角这对签名值)', () => {
  const sig = Object.keys(ROUND_LEVELS).map((lv) => {
    const spec = swatchSpec(composeStyleDoc({ ...FORM, rounded: lv }))
    const lay = swatchLayout(spec)
    // rects[0] = 硬阴影,rects[1] = 卡片外框(圆角即卡片圆角);按钮那块用 accent 填,取最大的一块
    const card = lay.rects[1].r
    const btn = lay.rects.filter((r) => r.fill === FORM.colors.accent).sort((a, b) => b.w * b.h - a.w * a.h)[0].r
    return { lv, card: +card.toFixed(2), btn: +btn.toFixed(2) }
  })
  for (let i = 0; i < sig.length; i++) {
    for (let j = i + 1; j < sig.length; j++) {
      const d = Math.max(Math.abs(sig[i].card - sig[j].card), Math.abs(sig[i].btn - sig[j].btn))
      assert.ok(d >= 1, `圆角档「${sig[i].lv}」与「${sig[j].lv}」在图上几乎一样(最大差 ${d.toFixed(2)}px)⇒ 等于没给选项`)
    }
  }
  assert.equal(sig.find((s) => s.lv === 'sharp').card, 0, '直角档卡片必须是真直角')
  assert.ok(sig.find((s) => s.lv === 'pill').btn > sig.find((s) => s.lv === 'pill').card,
    '胶囊档的语义是「容器温和、按钮整胶囊」—— 按钮圆角必须大于卡片圆角')
})

test('composeStyleDoc:胶囊档必须同时留一个 <100 的常规档 —— 全是 999 会让整张图标一起胶囊化', () => {
  const spec = swatchSpec(composeStyleDoc({ ...FORM, rounded: 'pill' }))
  assert.equal(spec.pill, true)
  assert.ok(spec.radius > 0 && spec.radius < 100, `常规圆角应落在 (0,100),实际 ${spec.radius}`)
})

test('composeStyleDoc:三档字重各自把 titleScale 拉开 —— 预览图上标题条高才分得出', () => {
  const seen = new Set()
  for (const lv of Object.keys(WEIGHT_LEVELS)) {
    const spec = swatchSpec(composeStyleDoc({ ...FORM, weight: lv }))
    assert.equal(spec.headlineWeight, WEIGHT_LEVELS[lv].fontWeight)
    assert.ok(spec.titleScale > 0, '标题与正文都要有 fontSize,否则 titleScale 这条连续量通道是空的')
    seen.add(spec.titleScale)
  }
  assert.equal(seen.size, 3, '三档的字号反差比必须两两不同')
})

test('composeStyleDoc:三档恒定同一套系统优先栈(表单已无字体选项)', () => {
  // ⚠ 2026-09-02 产品决定去掉整个「字体」栏:中文字体是低频决定,要换在群里说一句更省事。
  const tk = parseStyleTokens(composeStyleDoc({ ...FORM }))
  const slots = Object.entries(tk.typography || {}).filter(([, v]) => v && v.fontFamily)
  assert.ok(slots.length >= 3, '先证明真读到了三档')
  const first = slots[0][1].fontFamily
  for (const [k, v] of slots) assert.equal(v.fontFamily, first, k + ' 档应与其余档同一套栈')
  // 系统字体必须排在 webfont 之前 —— 那是这次改动的要点(不下载也好看)
  assert.ok(first.indexOf('PingFang SC') < first.indexOf('Noto Sans SC'), '系统族要排在思源之前:' + first)
  assert.match(first, /sans-serif$/)
  // 表单里给了 serif/mono 也不该再生效
  const withOld = parseStyleTokens(composeStyleDoc({ ...FORM, serif: true, mono: true }))
  assert.equal(withOld.typography.body.fontFamily, first, '旧字段传进来也不改变结果')
})

test('composeStyleDoc:正文按官方八段固定序出模板,能填实的填实、填不实的留「待补」', () => {
  const doc = composeStyleDoc(FORM)
  const order = ['## Overview', '## Colors', '## Typography', '## Layout', '## Elevation & Depth', '## Shapes', '## Components', "## Do's and Don'ts"]
  let at = -1
  for (const h of order) {
    const i = doc.indexOf(h)
    assert.ok(i > 0, `缺 section:${h}`)
    assert.ok(i > at, `section 顺序不对:${h} 出现在前一段之前`)
    at = i
  }
  for (const hex of Object.values(FORM.colors)) assert.ok(doc.includes(hex), `色彩段要写明 ${hex}`)
  assert.match(doc, /待补/, '填不实的段落要留「待补」并说清该写什么')
  assert.match(doc, /一个具体参照胜过一堆形容词/)
  assert.equal((doc.match(/^## /gm) || []).length, 8)
})

test('composeStyleDoc:场景/描述留空时不写空字段(front matter 不留噪音)', () => {
  const doc = composeStyleDoc({ name: '只有名字', colors: FORM.colors })
  assert.doesNotMatch(doc, /^description:/m)
  assert.doesNotMatch(doc, /^suits:/m)
  assert.equal(parseStyleMeta(doc).name, '只有名字')
  assert.equal(isStyleDoc(doc), true)
})

// ── 风格档 → 表单(「复制为新款」)────────────────────────────────────────────

test('composeStyleDoc ↔ styleFormFromDoc:六项往返不失真', () => {
  for (const rounded of Object.keys(ROUND_LEVELS)) {
    for (const weight of Object.keys(WEIGHT_LEVELS)) {
      const f = { ...FORM, rounded, weight }
      assert.deepEqual(styleFormFromDoc(composeStyleDoc(f)), normalizeStyleForm(f), `${rounded}/${weight} 往返失真`)
    }
  }
})

test('styleFormFromDoc:内置预设也要能整套预填进表单(复制为新款对任何一款都得成立)', () => {
  for (const s of listStyles({ builtinDir: path.join(__dirname, '..', '..', 'assets', 'design-styles') })) {
    const f = styleFormFromDoc(fs.readFileSync(s.path, 'utf8'))
    assert.ok(f.name, `${s.slug} 预填不出名称`)
    for (const k of ['bg', 'ink', 'accent', 'muted']) assert.match(f.colors[k], /^#[0-9A-F]{6}$/, `${s.slug} 的 ${k} 预填不出`)
    assert.ok(ROUND_LEVELS[f.rounded] && WEIGHT_LEVELS[f.weight], `${s.slug} 的档位量化落到了词表外`)
    for (const w of f.suits) assert.ok(SCENE_WORDS.includes(w), `${s.slug} 的场景 ${w} 不在词表里`)
  }
})

test('quantizeRounded / quantizeWeight:边界落档', () => {
  assert.equal(quantizeRounded(0, false), 'sharp')
  assert.equal(quantizeRounded(2, false), 'sharp')
  assert.equal(quantizeRounded(3, false), 'subtle')
  assert.equal(quantizeRounded(10, false), 'subtle')
  assert.equal(quantizeRounded(11, false), 'soft')
  assert.equal(quantizeRounded(4, true), 'pill', '有胶囊语义就是胶囊档,常规值再小也一样')
  assert.equal(quantizeRounded(9999, false), 'pill', '只有胶囊档没有常规档的老风格档也要落到胶囊')
  assert.deepEqual([400, 500, 550, 600, 650, 700, 701, 900].map(quantizeWeight),
    ['light', 'light', 'light', 'medium', 'medium', 'medium', 'heavy', 'heavy'])
})

test('styleCard:随卡片下发角色四色与表单六项 —— 前端不必(也不许)自己推一遍', () => {
  const c = styleCard(composeStyleDoc(FORM))
  assert.deepEqual(c.roles, FORM.colors)
  assert.deepEqual(c.form, normalizeStyleForm(FORM))
  assert.ok(Array.isArray(c.layout.rects) && c.layout.rects.length > 10)
})

test('styleCard:中文那枚标签三态 —— 走黑体不标 · 不走黑体标 · 声明了字体却没中文族标「未声明」', () => {
  // 起因:实测 18 张卡有 12 张挂着「中文黑体」,而 feat() 自己的规矩是「常态不用说,
  // 例外才值得标」(深色只 3 张、衬线只 5 张都守了这条,唯独中文那枚没守)。
  // ⚠ v0.11.65 做成两态,把「走黑体」和「压根没写中文族」合成了同一个「不标」——
  //   两种不同状态给同一个信号(status:ok 那条教训的同族)。第三态就是补这个。
  const mk = (fam) => styleCard('---\nname: t\ntypography:\n  body:\n    fontFamily: "' + fam + '"\n---\n正文\n')
  const hei = mk("'PingFang SC', 'Microsoft YaHei', sans-serif")
  assert.deepEqual(hei.cjkKinds, ['黑体'], '先证明真读出了路数(否则下面那条恒 default)')
  assert.equal(hei.cjkState, 'default', '纯黑体是常态,不该标')
  for (const [fam, want] of [["'Songti SC', 'PingFang SC', serif", ['宋体', '黑体']],
    ["'Yuanti SC', 'PingFang SC', sans-serif", ['圆体', '黑体']],
    ["'Caveat', 'PingFang SC', cursive", ['黑体', '手写']]]) {
    const c = mk(fam)
    assert.deepEqual(c.cjkKinds, want, fam + ' 的路数读错了')
    assert.equal(c.cjkState, 'exception', fam + ' 不走黑体那条常规路,该标')
  }
  // 第三态:声明了字体、一个中文族都没有 ⇒ 与「走黑体」必须分得开
  assert.equal(mk("'Inter', sans-serif").cjkState, 'missing', '声明了字体却没中文族 ⇒ missing,不能与走黑体同一个信号')
  // 连字体都没写的档不算「未声明」(那是句废话;与 doctor ④ 同口径——它也只看有 fontFamily 的档位)。
  // 直接测裁决函数(前端与 styleCard 都只消费它):
  assert.equal(require('../../src/design.js').cjkCardState(parseStyleTokens('---\nname: t\ncolors:\n  bg: "#FFFFFF"\n---\n')), 'default', '连 fontFamily 都没有 ⇒ 没什么可说')
  assert.equal(require('../../src/design.js').cjkCardState(parseStyleTokens('---\nname: t\ntypography:\n  body:\n    fontSize: "16px"\n---\n')), 'default', '有档位但没 fontFamily ⇒ 同上')
})

test('16 套内置档:该标中文的是少数,且没有一份是「未声明」—— 判据失效时这条会报警', () => {
  // ⚠ 对照组式断言:全 default 说明判据没分辨力,全 exception 说明降噪没生效。实测应为 6 份
  //   (档案索引 · 编辑风 · 手绘 · 新中式 · 静奢 · 柔和友好),留出余量防内置档微调时误报。
  const dir = path.join(__dirname, '..', '..', 'assets', 'design-styles')
  const cards = fs.readdirSync(dir).filter((x) => x.endsWith('.md'))
    .map((f) => styleCard(fs.readFileSync(path.join(dir, f), 'utf8')))
  const exc = cards.filter((c) => c.cjkState === 'exception')
  assert.ok(cards.length >= 16, '对照组:该扫到 16 套内置档,实际 ' + cards.length)
  assert.ok(exc.length >= 4 && exc.length <= 9,
    '该标的应是少数(4~9 份),实际 ' + exc.length + ':' + exc.map((c) => c.name).join('/'))
  assert.ok(cards.filter((c) => c.cjkState === 'default').length >= 8, '大多数走黑体的那批不该再挂标签')
  assert.equal(cards.filter((c) => c.cjkState === 'missing').length, 0, '内置档 v0.11.63 已补齐中文兜底,不该有「未声明」;有就是档被改坏了')
})

test('前端消费服务端的三态裁决,不自己判「是不是黑体」', () => {
  // ⚠ 本项目栽过的形状:同一份策略两个消费者各写各的 ⇒ 必然漂移。那个词的权威
  //   在 design.js 的 CJK_KIND_RE,前端只许读 cjkState。
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'console.html'), 'utf8')
  const at = html.indexOf('中文${esc((s.cjkKinds')
  assert.ok(at > 0, '没扫到中文那枚 chip 的渲染处')
  const seg = html.slice(at - 500, at + 400)
  assert.ok(/s\.cjkState==='exception'/.test(seg), '例外那枚必须由服务端的 cjkState 门控')
  assert.ok(/s\.cjkState==='missing'/.test(seg) && /中文未声明/.test(seg), '第三态「未声明」必须有自己的 chip')
  assert.ok(!/cjkNotable/.test(html), '旧的两态字段不该再有人读')
  assert.ok(!/['"]黑体['"]/.test(seg), '前端不许出现那个词的字面量(那是服务端的词表)')
})

// ── withStyleName(收录时改名)────────────────────────────────────────────────

test('withStyleName:换 front matter 的 name,正文与其余 tokens 一字不动', () => {
  const doc = composeStyleDoc(FORM)
  const out = withStyleName(doc, '公司门面')
  assert.equal(parseStyleMeta(out).name, '公司门面')
  assert.equal(parseStyleMeta(out).description, FORM.description, '描述不该被动')
  assert.equal(out.split('---')[2], doc.split('---')[2], '正文必须逐字相同')
  assert.equal(isStyleDoc(out), true)
})

test('withStyleName:原档没有 name 行就插一行;空名字或非风格档一律原样返回', () => {
  const noName = '---\ncolors:\n  bg: "#fff"\n---\n正文\n'
  assert.equal(parseStyleMeta(withStyleName(noName, '补上')).name, '补上')
  assert.equal(withStyleName(noName, '  '), noName)
  assert.equal(withStyleName('# 架构文档\n', 'x'), '# 架构文档\n')
})

// ── 落盘:冲突 / 遮蔽 / 回归 / 认帧 ───────────────────────────────────────────

test('saveUserStyle:原子落盘 —— 目录自动建,过程中不留半截 .md', () => {
  const dir = path.join(tmp(), 'styles') // 故意不预先建
  const r = saveUserStyle('brand-purple', composeStyleDoc(FORM), { dir })
  assert.equal(r.replaced, false)
  assert.equal(r.shadowed, false)
  assert.equal(fs.readFileSync(r.path, 'utf8'), composeStyleDoc(FORM))
  assert.deepEqual(fs.readdirSync(dir), ['brand-purple.md'], '不许留下临时文件')
  assert.deepEqual(listStyles({ userDir: dir }).map((s) => s.name), ['品牌紫'])
})

test('saveUserStyle:同名冲突要 overwrite 才过,错误带 CONFLICT(调用方翻 409)', () => {
  const dir = tmp()
  saveUserStyle('a1', composeStyleDoc(FORM), { dir })
  let err = null
  try { saveUserStyle('a1', composeStyleDoc({ ...FORM, name: '另一套' }), { dir }) } catch (e) { err = e }
  assert.ok(err, '同名不该被静默覆盖')
  assert.equal(err.code, 'CONFLICT')
  assert.match(err.message, /已经有「a1」/)
  assert.equal(parseStyleMeta(fs.readFileSync(path.join(dir, 'a1.md'), 'utf8')).name, '品牌紫', '被拒的那次不许动到已有文件')
  const r = saveUserStyle('a1', composeStyleDoc({ ...FORM, name: '另一套' }), { dir, overwrite: true })
  assert.equal(r.replaced, true)
  assert.equal(parseStyleMeta(fs.readFileSync(path.join(dir, 'a1.md'), 'utf8')).name, '另一套')
})

test('saveUserStyle:与内置同名不算冲突,但要如实告知「遮蔽了内置」', () => {
  const root = tmp()
  const builtinDir = path.join(root, 'b'); const dir = path.join(root, 'u')
  fs.mkdirSync(builtinDir)
  fs.writeFileSync(path.join(builtinDir, 'swiss-grid.md'), composeStyleDoc({ ...FORM, name: '内置的' }))
  const r = saveUserStyle('swiss-grid', composeStyleDoc(FORM), { dir, builtinDir })
  assert.equal(r.shadowed, true)
  assert.equal(r.replaced, false)
  // 合并清单里用户版顶掉内置版(遮蔽的语义)
  assert.deepEqual(listStyles({ builtinDir, userDir: dir }).map((s) => [s.slug, s.source, s.name]), [['swiss-grid', 'user', '品牌紫']])
})

test('saveUserStyle:非风格档一个字节都不写(认帧是落盘前的安全阀)', () => {
  const dir = tmp()
  assert.throws(() => saveUserStyle('bad', '# 这是一份架构文档\n\ncolors: 在正文里不算\n', { dir }), /不是风格档/)
  assert.deepEqual(fs.readdirSync(dir), [])
  assert.throws(() => saveUserStyle('../escape', composeStyleDoc(FORM), { dir }), /标识/)
  assert.deepEqual(fs.readdirSync(dir), [], 'slug 校验必须在建目录/写文件之前')
})

test('deleteUserStyle:只删用户目录;删掉遮蔽内置的那份 ⇒ 内置回归', () => {
  const root = tmp()
  const builtinDir = path.join(root, 'b'); const dir = path.join(root, 'u')
  fs.mkdirSync(builtinDir)
  fs.writeFileSync(path.join(builtinDir, 'zen.md'), composeStyleDoc({ ...FORM, name: '内置禅意' }))
  saveUserStyle('zen', composeStyleDoc({ ...FORM, name: '我的禅意' }), { dir, builtinDir })
  const r = deleteUserStyle('zen', { dir, builtinDir })
  assert.equal(r.removed, true)
  assert.equal(r.revertedToBuiltin, true)
  assert.deepEqual(listStyles({ builtinDir, userDir: dir }).map((s) => [s.source, s.name]), [['builtin', '内置禅意']],
    '删掉自定义之后,同名内置那套要自动回来')
  assert.equal(fs.existsSync(path.join(builtinDir, 'zen.md')), true, '内置文件绝不能被删')
})

test('deleteUserStyle:删一个不存在的 / 只在内置里的 ⇒ 人话报错,不是 ENOENT', () => {
  const root = tmp()
  const builtinDir = path.join(root, 'b'); const dir = path.join(root, 'u')
  fs.mkdirSync(builtinDir); fs.mkdirSync(dir)
  fs.writeFileSync(path.join(builtinDir, 'only-builtin.md'), composeStyleDoc(FORM))
  assert.throws(() => deleteUserStyle('only-builtin', { dir, builtinDir }), /内置的那些删不掉/)
  assert.throws(() => deleteUserStyle('nope', { dir, builtinDir }), /风格库里没有/)
  assert.equal(fs.existsSync(path.join(builtinDir, 'only-builtin.md')), true)
})

// ── 从参考提炼:CSS 解析 ──────────────────────────────────────────────────────

test('colorLiterals:三位/六位/八位 hex 与 rgb()/hsl() 都归一成大写六位', () => {
  assert.deepEqual(colorLiterals('#abc'), ['#AABBCC'])
  assert.deepEqual(colorLiterals('#AaBbCc'), ['#AABBCC'])
  assert.deepEqual(colorLiterals('#11223344'), ['#112233'], '八位 hex 取前六位')
  assert.deepEqual(colorLiterals('rgb(109, 40, 217)'), ['#6D28D9'])
  assert.deepEqual(colorLiterals('rgba(109 40 217 / 80%)'), ['#6D28D9'], '空格 + 斜杠语法也要认')
  assert.deepEqual(colorLiterals('hsl(0, 100%, 50%)'), ['#FF0000'])
  assert.deepEqual(colorLiterals('hsl(210deg 20% 10%)'), ['#141A1F'])
})

test('colorLiterals:近乎全透明的不算「一个颜色」;超长 hex 串整体不认(别截出假色)', () => {
  assert.deepEqual(colorLiterals('#11223300'), [])
  assert.deepEqual(colorLiterals('rgba(0,0,0,0.02)'), [])
  assert.deepEqual(colorLiterals('#1234567890'), [], '既非 3/6/8 位的串一个都不该截出来')
  assert.deepEqual(colorLiterals('id-#abcdef0'), [])
})

test('parseCssCandidates:按频次排序;html/body 的底色与文字色单独记账(那是唯一的硬信号)', () => {
  const css = `html, body { background:#0F1117; color:#E6E8EF; }
    .a{color:#6D28D9}.b{color:#6D28D9}.c{color:#6D28D9}
    .d{ font-family:'Inter', sans-serif; border-radius:12px }
    .e{ border-radius: 50% } .f{ border-radius: 999px }`
  const c = parseCssCandidates([css])
  assert.equal(c.rootBg, '#0F1117')
  assert.equal(c.rootInk, '#E6E8EF')
  assert.equal(c.colors[0].hex, '#0F1117', '被加权的底色应排第一')
  assert.equal(c.colors.find((x) => x.hex === '#6D28D9').count, 3)
  assert.deepEqual(c.fonts.map((f) => f.stack), ["'Inter', sans-serif"], 'CSS 里的引号不成对,不许剥出半个引号')
  assert.deepEqual(c.radii, [12, 999], '百分比是正圆语义(头像),不能混进圆角统计')
})

test('parseCssCandidates:注释里的颜色不算;@media 里的规则照样读得到', () => {
  const c = parseCssCandidates(['/* 旧配色 #FF0000 #FF0000 */ @media (min-width:1px){ body{background:#FAF9F6} }'])
  assert.equal(c.colors.some((x) => x.hex === '#FF0000'), false)
  assert.equal(c.rootBg, '#FAF9F6')
})

test('dedupeColors:近似色并档(#FAFAFA 与 #F9F9F9 是同一个意图,不该挤掉真正的第二色)', () => {
  const out = dedupeColors([
    { hex: '#FAFAFA', count: 5, weight: 5 }, { hex: '#F9F9F9', count: 3, weight: 3 }, { hex: '#C0392B', count: 2, weight: 2 },
  ], 6)
  assert.deepEqual(out.map((c) => c.hex), ['#FAFAFA', '#C0392B'])
  assert.equal(out[0].count, 8, '并档时频次要累加')
})

test('extractFormFromTexts:深色站点判得出深色底(光靠「最浅的当底」会整个判反)', () => {
  const { form, evidence } = extractFormFromTexts([`
    html,body{background:#0F1117;color:#E6E8EF}
    .btn{background:#6d28d9;border-radius:999px;font-family:'Inter',sans-serif}
    .code{font-family:'JetBrains Mono',monospace}
    .m{color:hsl(220,14%,24%)}`])
  assert.equal(form.colors.bg, '#0F1117')
  assert.equal(form.colors.ink, '#E6E8EF')
  assert.equal(form.colors.accent, '#6D28D9')
  assert.equal(form.rounded, 'pill')
  // ⚠ 字体不再进表单,但从参考里读出的事实要留给人看(同浅色那条)
  assert.equal(evidence.mono, true, '提炼出的等宽事实不能丢')
  assert.equal(evidence.serif, false)
  assert.ok(!('mono' in form) && !('serif' in form), '但它们不再是表单字段')
  assert.equal(evidence.source, 'css')
  assert.ok(evidence.colors.length >= 3 && evidence.colors[0].count > 0, '证据要带具体色与频次,否则用户不知道它凭什么这么猜')
})

test('extractFormFromTexts:浅色 + 衬线 + 微圆的站点也判得对', () => {
  const { form, evidence, suggest } = extractFormFromTexts([`body{background:#FAF9F6;color:#1A1A1A;font-family:Georgia, serif}
    .a{color:#C0392B}.a2{color:#C0392B}.a3{color:#C0392B}.m{color:#777777}.b{border-radius:4px}`])
  assert.deepEqual(form.colors, { bg: '#FAF9F6', ink: '#1A1A1A', accent: '#C0392B', muted: '#777777' })
  // ⚠ 字体不再进表单(2026-09-02 拍板去掉整个「字体」栏),但**从参考里读出的事实要留给人看** ——
  //   evidence 与描述句里都还在,人看到「衬线标题」可以自己去群里让它换字体。
  assert.equal(evidence.serif, true, '提炼出的衬线事实不能丢')
  assert.match(suggest.description, /衬线/)
  assert.ok(!('serif' in form), '但它不再是表单字段')
  assert.equal(form.rounded, 'subtle')
})

test('extractFormFromTexts:什么都没读到 ⇒ 退回默认表单并如实标注,不编内容', () => {
  const { form, evidence } = extractFormFromTexts(['/* 空 */'])
  assert.deepEqual(form.colors, normalizeStyleForm({}).colors)
  assert.deepEqual(evidence.colors, [])
  assert.equal(evidence.roundedFound, false)
})

// CSS 与 JS 两种写法的值边界不同,合成一条正则必有一边被切错 ——
// 实测:JS 那条会把后面的 colors 段一起吞成字体名。
test('extractFormFromTexts:JS 主题对象的字体值到闭合引号为止,不吞掉后面的键', () => {
  const { evidence } = extractFormFromTexts(['module.exports={theme:{fontFamily:"Inter, sans-serif",colors:{brand:"#6D28D9"},borderRadius:"14px"}}'])
  assert.deepEqual(evidence.fonts, ['Inter, sans-serif'])
  assert.ok(evidence.colors.some((c) => c.hex === '#6D28D9'))
  assert.deepEqual(evidence.radii, [14], 'JS 写法的圆角值带引号,也要读得出来')
})

// ── 从参考提炼:网址 ─────────────────────────────────────────────────────────

test('parseHtmlStyleRefs:内联 <style> 全收;<link> 只跟同源,协议与数量都封顶', () => {
  const html = `<link rel="stylesheet" href="/a.css">
    <link rel=stylesheet href=https://cdn.other.com/b.css>
    <link rel="preload stylesheet" href="https://ex.com/c.css">
    <link rel="icon" href="/f.ico">
    <link rel="stylesheet" href="javascript:alert(1)">
    <style>body{color:#fff}</style><style>  </style>`
  const r = parseHtmlStyleRefs(html, 'https://ex.com/p/x')
  assert.deepEqual(r.inline, ['body{color:#fff}'], '空的 <style> 不收')
  assert.deepEqual(r.links, ['https://ex.com/a.css', 'https://ex.com/c.css'], '跨站与非 http(s) 一律不跟')
})

test('parseHtmlStyleRefs:总份数封顶(内联 + 外链一起算)', () => {
  const html = '<style>a{}</style><style>b{}</style>' + Array.from({ length: 10 }, (_, i) => `<link rel=stylesheet href="/s${i}.css">`).join('')
  const r = parseHtmlStyleRefs(html, 'https://ex.com/', { max: 4 })
  assert.equal(r.inline.length + r.links.length, 4)
})

// ⚠ 这条守的是**墙钟兜不住的那一类卡死**:正则一旦跑起来就不可中断,tick 只在两次调用之间
//   生效。此前这里的 `<style[^>]*>([\s\S]*?)<\/style>` 与 `<link\b[^>]*>` 都是二次方的,
//   512KB 的病态 HTML 实测 4.7s / 10.9s / 41s(第三个是单个巨型标签里塞满 `rel=`),
//   而这三条全都发生在 extractFromUrl 第一次 tick() 之前 —— 墙钟连一次都点不到。
test('parseHtmlStyleRefs:病态 HTML 不许把整个进程钉住(二次方正则已换成 indexOf 扫描)', () => {
  // 每条 = [说法, 病态输入, 触发二次方的那个串, 它至少出现多少次]
  const cases = [
    ['未闭合的 <style> 重复', '<style>'.repeat(73000), '<style', 73000],
    ['连一个 > 都没有的 <style', '<style '.repeat(73000), '<style', 73000],
    ['连一个 > 都没有的 <link', '<link '.repeat(73000), '<link', 73000],
    ['单个巨型标签里塞满 rel=', '<link ' + 'rel='.repeat(120000) + '>', 'rel=', 120000],
  ]
  for (const [label, evil, needle, minCount] of cases) {
    // 对照组一:输入**确实病态** —— 尺寸够大、那个串真的出现了这么多次、且读不出任何样式表。
    // 少了这一条,「跑得快」可能只是因为输入根本不是那个形状(拼错一个字符就成了空跑)。
    assert.ok(evil.length > 400 * 1024, `${label}:输入没到 400KB,这条用例什么都没验(${evil.length})`)
    assert.ok(evil.split(needle).length - 1 >= minCount, `${label}:${needle} 没出现够 ${minCount} 次`)
    const t0 = Date.now()
    const r = parseHtmlStyleRefs(evil, 'https://ex.com/')
    const ms = Date.now() - t0
    assert.deepEqual([r.inline.length, r.links.length], [0, 0], `${label}:这份病态输入里本来就没有样式表`)
    assert.ok(ms < 1500, `${label}:花了 ${ms}ms —— 二次方回来了`)
  }
  // 对照组二:同样的形状写成正常 HTML 时**读得出来** —— 否则上面全是「因为什么都不解析」而绿的
  const ok = parseHtmlStyleRefs('<style>body{color:red}</style><LINK REL=stylesheet HREF=/a.css>', 'https://ex.com/')
  assert.deepEqual([ok.inline, ok.links], [['body{color:red}'], ['https://ex.com/a.css']], '大小写与无引号写法照旧要认')
  // 前面一堆未闭合的 <style> 不许把后面那份真的挡住(indexOf 版是「找不到闭合就整轮停」,
  // 得确认停的时机对:闭合存在时必须继续走完)
  const mixed = parseHtmlStyleRefs('<style>x{}'.repeat(2000) + '<style>body{color:red}</style>', 'https://ex.com/')
  assert.equal(mixed.inline.length, 1)
})

test('parseHtmlStyleRefs:墙钟传得进去 —— 病态输入在解析这一步就喊停,不用等到抓样式表', () => {
  const boom = () => { const e = new Error('这次提炼花的时间太长了'); e.code = 'EXTRACT_GUARD'; throw e }
  assert.throws(() => parseHtmlStyleRefs('<style>a{}</style>', 'https://ex.com/', { tick: boom }), /花的时间太长/)
  assert.ok(parseHtmlStyleRefs('<style>a{}</style>', 'https://ex.com/').inline.length, '对照组:不掐墙钟时这一页解析得出来')
})

test('extractFromUrl:抓 HTML + 同源样式表 → 候选 + 证据(fetch 注入,不走网络)', async () => {
  const seen = []
  const fake = async (u) => {
    seen.push(u)
    if (u === 'https://ex.com/') return { ok: true, status: 200, text: async () => '<link rel=stylesheet href="/s.css"><style>body{background:#FAF9F6}</style>' }
    if (u === 'https://ex.com/s.css') return { ok: true, status: 200, text: async () => 'body{color:#1A1A1A}.a{color:#C0392B}.a2{color:#C0392B}' }
    throw new Error('unexpected ' + u)
  }
  const r = await extractFromUrl('https://ex.com/', { fetchImpl: fake })
  assert.deepEqual(seen, ['https://ex.com/', 'https://ex.com/s.css'])
  assert.equal(r.evidence.source, 'url')
  assert.equal(r.evidence.sheets, 2)
  assert.equal(r.form.colors.bg, '#FAF9F6')
  assert.equal(r.form.colors.ink, '#1A1A1A')
})

test('extractFromUrl:坏输入与失败都翻成人话,并指出深度提炼另有一条路', async () => {
  await assert.rejects(() => extractFromUrl('ftp://x/y', { fetchImpl: async () => ({}) }), /只认 http/)
  await assert.rejects(() => extractFromUrl('不是网址', { fetchImpl: async () => ({}) }), /不是一个网址/)
  await assert.rejects(() => extractFromUrl('https://ex.com/', { fetchImpl: async () => ({ ok: false, status: 403, text: async () => '' }) }), /打不开这个网址.*403/s)
  await assert.rejects(() => extractFromUrl('https://ex.com/', { fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<p>纯 HTML</p>' }) }), /没找到样式表/)
  const timeout = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
  await assert.rejects(() => extractFromUrl('https://ex.com/', { fetchImpl: timeout }), /超时/)
  // `fetch failed` 是 Node 对一切网络层失败的统一说法 —— 原样甩出去等于给 operator 一句英文内部报错
  await assert.rejects(() => extractFromUrl('https://ex.com/', { fetchImpl: async () => { throw new TypeError('fetch failed') } }),
    (e) => /连不上这个网址/.test(e.message) && !/fetch failed/.test(e.message))
})

test('extractFromUrl:单份样式表拉不到只是少一份,不让整次提炼失败', async () => {
  const fake = async (u) => {
    if (u === 'https://ex.com/') return { ok: true, status: 200, text: async () => '<link rel=stylesheet href="/dead.css"><style>body{background:#101010;color:#EEEEEE}</style>' }
    throw new Error('ECONNREFUSED')
  }
  const r = await extractFromUrl('https://ex.com/', { fetchImpl: fake })
  assert.equal(r.evidence.sheets, 1)
  assert.equal(r.form.colors.bg, '#101010')
})

// ── 从参考提炼:本地目录(围栏)──────────────────────────────────────────────

test('scanProjectDir 围栏:相对路径 / 不存在 / 是文件 —— 三种都拒,且报的是人话', () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'x.css'), 'body{color:#111}')
  assert.throws(() => scanProjectDir('relative/path'), /绝对路径/)
  assert.throws(() => scanProjectDir(path.join(root, 'nope')), /目录不存在/)
  assert.throws(() => scanProjectDir(path.join(root, 'x.css')), /是一个文件,不是目录/)
  assert.throws(() => scanProjectDir(''), /先填一个目录/)
})

test('scanProjectDir:只收样式类文件,跳过 node_modules 与隐藏目录,深度与文件数封顶', () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'src'))
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  fs.mkdirSync(path.join(root, '.cache'), { recursive: true })
  fs.mkdirSync(path.join(root, 'a', 'b', 'c', 'd', 'e'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'app.scss'), 'body{color:#111}')
  fs.writeFileSync(path.join(root, 'tailwind.config.js'), 'module.exports={}')
  fs.writeFileSync(path.join(root, 'theme.json'), '{}')
  fs.writeFileSync(path.join(root, 'README.md'), '# no')
  fs.writeFileSync(path.join(root, 'src', 'app.tsx'), 'const x=1')
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'lib.css'), 'a{color:#f00}')
  fs.writeFileSync(path.join(root, '.cache', 'x.css'), 'a{color:#f00}')
  fs.writeFileSync(path.join(root, 'a', 'b', 'c', 'd', 'e', 'deep.css'), 'a{color:#f00}')
  const r = scanProjectDir(root)
  assert.deepEqual(r.files.sort(), [path.join('src', 'app.scss'), 'tailwind.config.js', 'theme.json'].sort())
  const capped = scanProjectDir(root, { maxFiles: 1 })
  assert.equal(capped.files.length, 1)
})

test('extractFromDir:目录里已有风格档 ⇒ 直接用它的设定,并在证据里说明(有结论就别再猜)', () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'DESIGN.md'), composeStyleDoc(FORM))
  fs.writeFileSync(path.join(root, 'a.css'), 'body{background:#000;color:#fff}') // 与风格档相反的信号:不该被采信
  const r = extractFromDir(root)
  assert.equal(r.evidence.source, 'styledoc')
  assert.equal(r.evidence.styleDoc, 'DESIGN.md')
  assert.deepEqual(r.form, normalizeStyleForm(FORM))
})

test('extractFromDir:项目根是架构文档时不误采,退回扫 CSS', () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'DESIGN.md'), '# 架构设计\n\n## 1. 总览\n')
  fs.writeFileSync(path.join(root, 'a.css'), 'body{background:#FAF9F6;color:#1A1A1A}.k{color:#C0392B}')
  const r = extractFromDir(root)
  assert.equal(r.evidence.source, 'dir')
  assert.equal(r.form.colors.bg, '#FAF9F6')
  assert.ok(r.evidence.files >= 1)
})

test('extractFromDir:一个样式文件都没有 ⇒ 人话报错,不返回一套凭空的默认色', () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'readme.md'), '# 空项目')
  assert.throws(() => extractFromDir(root), /没找到样式文件/)
})

// ── 提炼器的加固(2026-08-11 对抗审查)────────────────────────────────────────
// 这一段全是「不修就会把 daemon 拖死或把这台机器当跳板」的那类问题,不是观感问题。

test('剥注释是 O(N) —— 512KB 满是未闭合 /* 的病态 CSS 不许把同进程的守护进程冻住', () => {
  // 旧写法 `/\/\*[\s\S]*?\*\//g` 在这份输入上实测 10.3 秒:每个 `/*` 都要往后扫到结尾才
  // 发现没有 `*/`,再从下一个 `/*` 重来。`/*a` 是「密度最高又永不出现 */」的最坏形状。
  // extractFromDir 一次吃 200 份文件 ⇒ 半小时,而它是同步跑在 daemon 进程里的。
  const bad = '/*a'.repeat(Math.floor(512 * 1024 / 3))
  assert.ok(bad.length > 500 * 1024, '对照组:病态输入本身得真有 512KB,否则这条用例测了个寂寞')
  assert.ok(bad.split('/*').length - 1 > 100_000, '对照组:未闭合的 /* 得真有十几万个')
  const t0 = Date.now()
  const c = parseCssCandidates([bad])
  const ms = Date.now() - t0
  assert.ok(ms < 1500, `解析这份输入花了 ${ms}ms —— 剥注释又回到了 O(N²)`)
  assert.deepEqual(c.colors, [], '未闭合的 /* 之后整段算注释(与浏览器同判),不该读出颜色')
})

test('提炼有总墙钟 —— 超时抛的是人话,不是让调用方干等', () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'a.css'), 'body{background:#FAF9F6}')
  assert.throws(() => extractFromDir(root, { wallMs: -1 }), /时间太长/)
  assert.ok(extractFromDir(root).form, '对照组:墙钟够用时这个目录本来提炼得出来')
})

test('提炼有总墙钟:网址侧同样有,且超时的话不被兜底文案改写成「连不上」', async () => {
  const fake = async () => ({ ok: true, status: 200, text: async () => '<style>body{background:#101010;color:#EEE}</style>' })
  await assert.rejects(() => extractFromUrl('https://ex.com/', { fetchImpl: fake, wallMs: -1 }), /时间太长/)
  assert.ok((await extractFromUrl('https://ex.com/', { fetchImpl: fake })).form, '对照组:不掐墙钟时这一页提炼得出来')
})

// ── 读响应体:流式截断,不是「先全收进内存再 slice」──────────────────────────

const _mkStream = (chunks, state) => ({
  getReader() {
    let i = 0
    return {
      read: async () => { if (i >= chunks.length) return { done: true } ; state.reads++; return { done: false, value: new TextEncoder().encode(chunks[i++]) } },
      cancel: async () => { state.cancels++ },
    }
  },
})

test('_readCapped:流式读到上限就停并 cancel —— 上限后面的内容根本没读进来', async () => {
  const state = { reads: 0, cancels: 0 }
  const fake = async (u) => {
    if (u === 'https://ex.com/') return { ok: true, status: 200, headers: { get: () => null }, text: async () => '<link rel=stylesheet href="/s.css">' }
    if (u === 'https://ex.com/s.css') {
      return { ok: true, status: 200, headers: { get: () => null }, body: _mkStream(['body{background:#FAF9F6}', 'x'.repeat(40), '.late{color:#C0392B}'], state) }
    }
    throw new Error('unexpected ' + u)
  }
  const r = await extractFromUrl('https://ex.com/', { fetchImpl: fake, maxBytes: 60 })
  const hexes = r.evidence.colors.map((c) => c.hex)
  assert.ok(hexes.includes('#FAF9F6'), '对照组:上限之前的内容照常读到')
  assert.ok(!hexes.includes('#C0392B'), '上限之后的那一块不该被读进来')
  assert.equal(state.reads, 2, '到线就停:第三块根本没去读')
  assert.equal(state.cancels, 1, '停下来要 cancel,否则连接一直挂着')
})

test('_readCapped:Content-Length 就超限 ⇒ 一个字节都不读,直接拒(先 text() 再 slice 等于没有上限)', async () => {
  let bodyRead = 0
  const fake = async () => ({
    ok: true, status: 200,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? '999999999' : null) },
    text: async () => { bodyRead++; return '<style>body{background:#101010}</style>' },
  })
  await assert.rejects(() => extractFromUrl('https://ex.com/', { fetchImpl: fake }), /内容太大/)
  assert.equal(bodyRead, 0, '拒收就是拒收,不许「先读完再说」')
})

test('scanProjectDir:超过上限的单个文件整份跳过,不进候选(截断一个 bundle 的头也提炼不出什么)', () => {
  const root = tmp()
  fs.writeFileSync(path.join(root, 'small.css'), 'body{background:#FAF9F6}')
  fs.writeFileSync(path.join(root, 'huge.css'), '/* pad */'.repeat(200) + 'body{color:#C0392B}')
  const r = scanProjectDir(root, { maxBytes: 200 })
  assert.deepEqual(r.files, ['small.css'])
  assert.equal(scanProjectDir(root).files.length, 2, '对照组:上限够大时两份都收')
})

// ── 网址侧 SSRF 围栏 ────────────────────────────────────────────────────────

test('isPublicHostname:本机 / 内网 / 链路本地 / 元数据段一律不算公网', () => {
  for (const h of [
    'localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.1',
    '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '::1', '::', '[::1]', 'fc00::1', 'fd12:3456::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:192.168.0.1',
  ]) assert.equal(isPublicHostname(h), false, `${h} 不该被当成公网地址`)
  // 对照组:公网地址与普通域名照常放行 —— 否则「全拒」看起来也像「全对」
  for (const h of ['example.com', 'www.ex.com', '8.8.8.8', '1.1.1.1', '172.32.0.1', '11.0.0.1', '2001:4860:4860::8888'])
    assert.equal(isPublicHostname(h), true, `${h} 是公网地址,不该被拒`)
  assert.equal(isPublicHostname(''), false)
})

test('extractFromUrl:本机与内网地址连 fetch 都不发(不做跳板)', async () => {
  let calls = 0
  const fake = async () => { calls++; return { ok: true, status: 200, text: async () => '<style>body{background:#101010}</style>' } }
  for (const u of ['http://127.0.0.1:9222/json', 'http://localhost:8080/', 'http://192.168.1.75/', 'http://169.254.169.254/latest/meta-data/'])
    await assert.rejects(() => extractFromUrl(u, { fetchImpl: fake }), new RegExp(SSRF_MSG), u)
  assert.equal(calls, 0, '拒的意思是一次请求都不发')
})

test('extractFromUrl:跟跳时每一跳都重过围栏 —— 公网 301 到内网照样拒', async () => {
  const seen = []
  const red = (loc) => ({ ok: false, status: 301, headers: { get: (k) => (String(k).toLowerCase() === 'location' ? loc : null) } })
  const fake = async (u) => {
    seen.push(u)
    if (u === 'https://ex.com/') return red('http://127.0.0.1:9222/json')
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => '<style>body{background:#101010}</style>' }
  }
  await assert.rejects(() => extractFromUrl('https://ex.com/', { fetchImpl: fake }), new RegExp(SSRF_MSG))
  assert.deepEqual(seen, ['https://ex.com/'], '内网那一跳不许真去请求')
})

test('extractFromUrl:跳数封顶,超了报人话', async () => {
  const red = (loc) => ({ ok: false, status: 302, headers: { get: (k) => (String(k).toLowerCase() === 'location' ? loc : null) } })
  const fake = async (u) => red(u + 'x/')
  await assert.rejects(() => extractFromUrl('https://ex.com/', { fetchImpl: fake }), /转了太多次/)
})

test('extractFromUrl:公网之间的跳照常跟,且相对样式表按**最终落点**解析(S1)', async () => {
  const seen = []
  const fake = async (u) => {
    seen.push(u)
    if (u === 'https://ex.com/') return { ok: false, status: 301, headers: { get: (k) => (String(k).toLowerCase() === 'location' ? 'https://www.ex.com/' : null) } }
    if (u === 'https://www.ex.com/') return { ok: true, status: 200, headers: { get: () => null }, text: async () => '<link rel=stylesheet href="/s.css">' }
    if (u === 'https://www.ex.com/s.css') return { ok: true, status: 200, headers: { get: () => null }, text: async () => 'body{background:#FAF9F6;color:#1A1A1A}' }
    throw new Error('unexpected ' + u)
  }
  // 拿请求前那个 URL 当基准的话:/s.css 会解析成 https://ex.com/s.css(fetch 打不到)⇒ 一份样式表都读不到
  const r = await extractFromUrl('https://ex.com/', { fetchImpl: fake })
  assert.deepEqual(seen, ['https://ex.com/', 'https://www.ex.com/', 'https://www.ex.com/s.css'])
  assert.equal(r.evidence.ref, 'https://www.ex.com/', '证据里记的是最终落点')
  assert.equal(r.form.colors.bg, '#FAF9F6')
})

// ── CSS 变量:深色站的底色普遍经 var() 一手 ──────────────────────────────────

test('parseCssCandidates:底色写成 var(--bg) 也认得出来 —— 否则深色站整个判反', () => {
  const css = ':root{--bg:#0F1117;--ink:#E6E8EC}body{background:var(--bg);color:var(--ink)}'
  const c = parseCssCandidates([css])
  assert.equal(c.rootBg, '#0F1117')
  assert.equal(c.rootInk, '#E6E8EC')
  const r = extractFormFromTexts([css])
  assert.equal(r.form.colors.bg, '#0F1117')
  assert.equal(swatchSpec(composeStyleDoc(r.form)).roles.dark, true, '这就是一个深色站,别判成亮色')
})

test('parseCssCandidates:var() 只展一层链且不被互相引用转死;变量名本身也算声明', () => {
  // --page 指向 --slate-900:语义变量指向色板变量是真实写法,展得开才记得到账
  const c = parseCssCandidates([':root{--slate-900:#0F1117;--page:var(--slate-900)}body{background:var(--page)}'])
  assert.equal(c.rootBg, '#0F1117')
  // 互相引用不许把进程转死
  const loop = parseCssCandidates([':root{--a:var(--b);--b:var(--a);--bg:#123456}'])
  assert.equal(loop.rootBg, '#123456', '变量名带 bg ⇒ 直接计底色账(作者已经说了它是底色)')
})

test('parseCssCandidates:`*` 通配 reset 不算站点底色声明', () => {
  // *,*::before{...} 这类重置到处都是;认它的话,凡引了 normalize/reset 的站点底色全被它顶掉
  const c = parseCssCandidates(['*,*::before,*::after{box-sizing:border-box;background:#FF00FF}body{background:#FAF9F6}'])
  assert.equal(c.rootBg, '#FAF9F6')
})

// ── 落盘的两条兜底(S3 / N1)────────────────────────────────────────────────

test('validateStyleSlug:拒 Windows 保留设备名(形状合法,但在那边根本落不了盘)', () => {
  for (const bad of ['con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9'])
    assert.throws(() => validateStyleSlug(bad), /保留字/, `「${bad}」不该被放行`)
  // 对照组:形近但不是保留名的照常过
  for (const ok of ['con-brand', 'com0', 'lpt', 'nul2', 'console'])
    assert.equal(validateStyleSlug(ok), ok)
})

test('saveUserStyle:落盘失败报中文人话(不带机器路径),且不留 .tmp 残片', () => {
  const dir = tmp()
  fs.mkdirSync(path.join(dir, 'brand.md')) // 目标名被一个目录占住 ⇒ rename 必失败
  let err = null
  try { saveUserStyle('brand', composeStyleDoc(FORM), { dir, overwrite: true }) } catch (e) { err = e }
  assert.ok(err, '写不进去时不许悄悄算成功')
  assert.match(err.message, /存不进风格库/)
  assert.ok(!err.message.includes(dir), '错误文案会原样进控制台提示 —— 不许带绝对路径')
  assert.ok(!/EISDIR|illegal operation/.test(err.message), '也不许把英文内部报错甩给人看')
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], '失败要清掉半截文件')
})

// ── 心跳负重(S7)────────────────────────────────────────────────────────────

test('styleCard:表单六项只给风格库那张卡 —— 群卡(15s 心跳)不背它', () => {
  const doc = composeStyleDoc(FORM)
  const lib = styleCard(doc)
  assert.equal(lib.form.colors.accent, '#6D28D9', '库卡要带 form:「复制为新款」靠它预填')
  const root = tmp()
  fs.writeFileSync(path.join(root, 'DESIGN.md'), doc)
  const card = projectStyleCard(root)
  assert.equal('form' in card, false, '群卡不带 form')
  assert.equal(card.name, '品牌紫', '对照组:这张卡本身是算出来了的')
  assert.ok(card.layout.rects.length > 10, '对照组:图元表照旧在')
})

// ── 从参考提炼 · 三项增强(v0.11.21)──────────────────────────────────────────
// ① 事实性描述建议 ② 补充色入档 ③ 字距/描边/间距/字号/行高入档
// 贯穿三项的同一条纪律:**提不出就省略** —— 风格档里的每一行都会被当成作者的决定,
// 凭空补上的那行没人知道它是猜的。所以下面每个收集器都各有一条「读不出 ⇒ 不写」的用例。

test('收集器:字距 / 描边 / 字号 / 行高 / 间距都按频次记账,值里的 var(--x) 先展开', () => {
  const c = parseCssCandidates([`:root{--sp:16px;--lh:1.6}
    h1{letter-spacing:.08em;font-size:40px}
    h2{letter-spacing:.08em}
    p{font-size:16px;line-height:var(--lh);padding:var(--sp);margin:var(--sp) 0}
    .card{border:2px solid #ccc;padding:24px}
    .btn{border-width:2px}`])
  assert.deepEqual(c.tracking, [{ value: 0.08, count: 2 }])
  assert.deepEqual(c.borders, [{ value: 2, count: 2 }])
  assert.deepEqual(c.fontSizes, [{ value: 16, count: 1 }, { value: 40, count: 1 }], '同次数取小值 —— 排序必须全序,否则同一份 CSS 两次提炼给出不同答案')
  assert.deepEqual(c.lineHeights, [{ value: 1.6, count: 1 }], 'line-height 写成 var(--lh) 也要读得到')
  assert.deepEqual(c.spacings, [16, 16, 24], '`margin:16px 0` 里的 0 不进网格统计')
})

test('收集器:这几项散落在所有规则里(不像底色只认 html/body),但自定义属性的**定义**不计频次', () => {
  const c = parseCssCandidates([':root{--font-size:99px;--pad:7px}.a{font-size:20px}.b{font-size:20px}'])
  assert.deepEqual(c.fontSizes, [{ value: 20, count: 2 }], '`--font-size:99px` 是一次声明不是一次采用,记进去就把定义当成了用法')
  assert.deepEqual(c.spacings, [], '对照组:没有任何 margin/padding 被用到,所以间距是空的')
})

test('收集器:读不出 px 数的写法一律当没写(rem/calc 要先假设根字号,那正是「不替作者假设」的反面)', () => {
  const c = parseCssCandidates(['.a{padding:1.5rem;font-size:1rem;border:.125rem solid;letter-spacing:normal;line-height:150%}'])
  assert.deepEqual(c.spacings, [])
  assert.deepEqual(c.fontSizes, [])
  assert.deepEqual(c.borders, [])
  assert.deepEqual(c.tracking, [], 'letter-spacing:normal 不是「字距 0」,是没写')
  assert.deepEqual(c.lineHeights, [], '行高只认无单位:百分比与 px 都要先知道字号才有意义')
  const ok = parseCssCandidates(['.a{padding:12px;font-size:15px;border:1px solid;letter-spacing:.1em;line-height:1.5}'])
  assert.equal(ok.spacings.length + ok.fontSizes.length + ok.borders.length + ok.tracking.length + ok.lineHeights.length, 5, '对照组:同样五项写成认得出的形式,一个不漏')
})

test('deriveExtraTokens:字距与描边各有界 —— 越界的值当没读到,不硬夹回边界', () => {
  assert.deepEqual(deriveExtraTokens({ tracking: [{ value: 0.08, count: 3 }] }), { letterSpacing: 0.08 })
  assert.deepEqual(deriveExtraTokens({ borders: [{ value: 0, count: 3 }] }), { borderWidth: 0 }, '0px 描边是一个真设定(这套风格不描边),不是缺省')
  // 界在收集那一层就挡住了 —— 从 CSS 走一遍确认越界值根本进不了频次表
  const wild = parseCssCandidates(['.a{letter-spacing:.9em}.b{letter-spacing:-1em}.c{border:20px solid}.d{line-height:9}'])
  assert.deepEqual(wild.tracking, [])
  assert.deepEqual(wild.borders, [])
  assert.deepEqual(wild.lineHeights, [])
  assert.deepEqual(deriveExtraTokens(wild), {}, '一项都读不出 ⇒ 空对象,而不是一套编出来的默认值')
})

test('deriveExtraTokens:间距网格 —— 七成能被 8 整除算 8px,退而求其次 4px,都不满足就不写', () => {
  assert.deepEqual(deriveExtraTokens({ spacings: [8, 16, 24, 32] }), { spacingUnit: 8 })
  assert.deepEqual(deriveExtraTokens({ spacings: [8, 16, 24, 32, 13] }), { spacingUnit: 8 }, '八成合规,一个例外不推翻结论')
  assert.deepEqual(deriveExtraTokens({ spacings: [4, 12, 20, 28] }), { spacingUnit: 4 })
  assert.deepEqual(deriveExtraTokens({ spacings: [3, 5, 7, 9] }), {}, '没有统一网格是一个真结论,编个 8px 上去反而把它抹掉')
  assert.deepEqual(deriveExtraTokens({ spacings: [8, 16, 24] }), {}, '样本不足不下结论 —— 一两个 16px 说明不了这是不是网格')
})

test('deriveExtraTokens:字号是成对项 —— 正文与标题缺一个就一起省(反差比无从算起)', () => {
  const both = deriveExtraTokens({ fontSizes: [{ value: 16, count: 9 }, { value: 40, count: 4 }, { value: 15, count: 2 }] })
  assert.deepEqual(both, { headlineSize: 40, bodySize: 16 }, '正文取 14~18 里最高频,标题取 ≥24 里最高频')
  assert.deepEqual(deriveExtraTokens({ fontSizes: [{ value: 16, count: 9 }] }), {}, '只有正文 ⇒ 都不写')
  assert.deepEqual(deriveExtraTokens({ fontSizes: [{ value: 40, count: 9 }] }), {}, '只有标题 ⇒ 都不写')
  assert.deepEqual(deriveExtraTokens({ fontSizes: [{ value: 12, count: 9 }, { value: 20, count: 9 }] }), {}, '两个都落在区间外 ⇒ 都不写')
})

test('describeExtract:纯事实拼句,零气质词;有则拼、无则省;一段都拼不出就回空串', () => {
  assert.equal(
    describeExtract({ dark: true, serif: true, radius: 14, bg: '#0F1117', accent: '#E8590C', origin: 'example.com' }),
    '深色底 · 衬线标题 · 圆角 14px · 主色 #0F1117 / #E8590C(提自 example.com)')
  assert.equal(describeExtract({ dark: false, bg: '#FFFFFF' }), '浅色底 · 主色 #FFFFFF', '衬线/圆角/出处都没有 ⇒ 那几段整段不出现')
  assert.equal(describeExtract({ dark: true, pill: true, radius: 6 }), '深色底 · 胶囊圆角', '胶囊是语义,不报数值')
  assert.equal(describeExtract({}), '', '什么都没读到就不给建议 —— 空串让前端什么都不填,而不是填一句「未知风格」')
  assert.doesNotMatch(describeExtract({ dark: true, serif: true, radius: 14, bg: '#0F1117' }), /高级|克制|现代|简洁|优雅|大气/, '气质词是群里对话的事,这里只说事实')
})

test('extractFormFromTexts:suggest 三样一起回 —— 描述带出处 · 补充色 · 更多属性', () => {
  const { form, suggest } = extractFormFromTexts([`
    html,body{background:#0F1117;color:#E6E8EF}
    h1{font-size:40px;letter-spacing:.08em}
    p{font-size:16px;line-height:1.55;padding:16px;margin:24px}
    .card{border:2px solid #2A2F3A;border-radius:14px;padding:32px}
    .btn{background:#E8590C;padding:8px}.b2{color:#E8590C}.b3{color:#E8590C}
    .t{color:#4C6EF5}.t2{color:#4C6EF5}.g{color:#2A2F3A}`], { origin: 'example.com' })
  assert.equal(suggest.description, '深色底 · 圆角 14px · 主色 #0F1117 / #E8590C(提自 example.com)')
  assert.deepEqual(suggest.extraTokens, { letterSpacing: 0.08, borderWidth: 2, spacingUnit: 8, lineHeight: 1.55, headlineSize: 40, bodySize: 16 })
  const four = new Set(Object.values(form.colors))
  assert.ok(suggest.extraColors.length > 0, '四角色之外还在反复出现的色要作为补充色交出来')
  for (const c of suggest.extraColors) {
    assert.equal(four.has(c.hex), false, '补充色不许与四角色重复')
    assert.ok(c.count >= 2, '只出现过一次的是一次性用法,不算这套设计的色板')
  }
  assert.ok(suggest.extraColors.length <= EXTRA_COLOR_MAX)
})

test('extractFormFromTexts:一次性用法不进补充色,什么都没有时 suggest 三样都是空的', () => {
  const once = extractFormFromTexts(['body{background:#FAF9F6;color:#1A1A1A}.x{color:#123456}'])
  assert.equal(once.suggest.extraColors.some((c) => c.hex === '#123456'), false, '只出现一次 ⇒ 不收')
  assert.ok(once.suggest.description, '对照组:这一次的描述句是拼得出来的')
  const none = extractFormFromTexts(['/* 空 */'])
  assert.deepEqual(none.suggest.extraColors, [])
  assert.deepEqual(none.suggest.extraTokens, {})
  assert.equal(none.suggest.description, '', '连一个颜色都没读到 ⇒ 不编描述')
})

// ⭐ 这条坏了就是产品级 bug:补充色一旦用了 ROLE_KEYS 词表里的名字(primary / secondary / line …),
//   它会当场抢走角色 —— 用户点的强调色就不再是图上按钮那块了(v0.9.3 真机踩过同一个坑)。
test('⭐ 补充色永远不改变四角色判定 —— alt-N 不在角色词表里,抢不走 bg/ink/accent/muted', () => {
  const base = swatchSpec(composeStyleDoc(FORM))
  const withExtra = swatchSpec(composeStyleDoc({ ...FORM, extraColors: ['#0FA3B1', '#E55934', '#F2B705'] }))
  for (const k of ['bg', 'ink', 'accent', 'muted']) {
    assert.equal(withExtra.roles[k], base.roles[k], `补充色改动了 ${k} —— 角色是用户点定的,补充色只许旁听`)
    assert.equal(withExtra.roles[k], FORM.colors[k])
  }
  assert.deepEqual(withExtra.roles.palette.map((p) => p.key), ['bg', 'ink', 'accent', 'muted', 'line', 'alt-1', 'alt-2', 'alt-3'])
  assert.equal(base.roles.palette.length, 5, '对照组:不给补充色时色板只有五个语义键')
})

// ⭐ 同一个坑的第五面:补充色不抢 bg/ink/accent/muted(键名词表挡住了),却曾经抢走 **line** ——
//   styleRoles 的 line 兜底是「从没被认领的色里挑对比最低的那个」,而 alt-N 恰恰是那批没被
//   认领的。真机症状 = 带六个补充色的风格,预览图上的分割线变成纯黄。
//   修法是让 composeStyleDoc 把 line 显式写进档(见那边的注释),styleRoles 本身一个字没动
//   —— 它那套启发式还要伺候别人手写的档。
test('⭐ 补充色也抢不走 line —— 六个补充色下分割线仍是底色与文字色混出的那道淡灰', () => {
  const six = ['#F2B705', '#E55934', '#0FA3B1', '#7048E8', '#12B886', '#FA5252']
  const doc = composeStyleDoc({ ...FORM, extraColors: six })
  const spec = swatchSpec(doc)
  // 期望值按 _mix(bg, ink, 0.14) 现算 —— 抄一个字面量进来,改了混色比例这条用例就再也拦不住谁
  const mix = (a, b, t) => '#' + [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, '0')).join('').toUpperCase()
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const expect = mix(rgb(FORM.colors.bg), rgb(FORM.colors.ink), 0.14)
  assert.equal(spec.roles.line, expect, '分割线被某个补充色抢走了')
  assert.equal(six.includes(spec.roles.line), false, '⭐ 分割线不许是补充色里的任何一个')
  // 对照组:这六个色**确实**都进了这份档(不然上面那条是「因为根本没有补充色」而绿的)
  assert.deepEqual(spec.roles.palette.slice(5).map((p) => p.hex), six)
  assert.equal(parseStyleTokens(doc).colors.line, expect, 'line 要显式落在 front matter 里,不靠兜底')
})

test('composeStyleDoc:补充色写成 alt-N 进 front matter,parseStyleTokens 原样读得回来', () => {
  const doc = composeStyleDoc({ ...FORM, extraColors: ['#0fa3b1', '#E55934'] })
  const t = parseStyleTokens(doc)
  assert.equal(t.colors['alt-1'], '#0FA3B1', '三位/小写都要先归一再落盘')
  assert.equal(t.colors['alt-2'], '#E55934')
  assert.equal(t.colors.accent, FORM.colors.accent, '四角色一字不动')
  assert.equal(isStyleDoc(doc), true)
  assert.match(doc, /alt-1 #0FA3B1/, '正文色彩段也要列出来 —— 档里出现的每个色都得有个说法')
  assert.doesNotMatch(composeStyleDoc(FORM), /alt-/, '对照组:不给补充色时档里一个 alt 都不许有')
})

test('normalizeStyleForm:补充色宽松归一 —— 坏值丢掉、去重、与四角色撞车的剔掉、封顶', () => {
  const f = normalizeStyleForm({ ...FORM, extraColors: ['#0fa3b1', '#0FA3B1', '乱写', FORM.colors.accent, { hex: '#E55934' }] })
  assert.deepEqual(f.extraColors, ['#0FA3B1', '#E55934'], '认字符串也认 {hex}(前端传前者,提炼结果是后者)')
  const many = normalizeStyleForm({ ...FORM, extraColors: ['#111', '#222', '#333', '#444', '#555', '#666', '#777'] })
  assert.equal(many.extraColors.length, EXTRA_COLOR_MAX)
  assert.deepEqual(normalizeStyleForm(FORM).extraColors, [], '没给就是空数组,不编颜色')
})

test('normalizeStyleForm:更多属性越界即丢弃(实时预览要吃得下半填的表单),字号成对丢', () => {
  const f = normalizeStyleForm({ ...FORM, extraTokens: { letterSpacing: 0.9, borderWidth: 2, spacingUnit: 8, headlineSize: 40, lineHeight: 1.5 } })
  assert.deepEqual(f.extraTokens, { borderWidth: 2, spacingUnit: 8, lineHeight: 1.5 }, '越界的字距丢掉;只有标题字号 ⇒ 字号整对丢掉')
  assert.deepEqual(normalizeStyleForm(FORM).extraTokens, {})
  assert.deepEqual(normalizeStyleForm({ ...FORM, extraTokens: 'x' }).extraTokens, {})
})

// 落盘那一刻的失真:`1e-7` 是合法的数、也在字距范围内,但 JS 拼进档里是 `"1e-7em"`,
// 而读回来的 _emNum 只认十进制小数 ⇒ 这一项在档里存在、却永远读不出来。归一到四位小数,
// 落进档的每个数都保证读得回来。
test('normalizeStyleForm:更多属性归一到四位小数 —— 写进档的数必须读得回来', () => {
  assert.deepEqual(normalizeStyleForm({ ...FORM, extraTokens: { letterSpacing: 1e-7 } }).extraTokens, { letterSpacing: 0 })
  assert.deepEqual(normalizeStyleForm({ ...FORM, extraTokens: { lineHeight: 1.5000000001 } }).extraTokens, { lineHeight: 1.5 })
  assert.deepEqual(normalizeStyleForm({ ...FORM, extraTokens: { letterSpacing: 0.0625 } }).extraTokens, { letterSpacing: 0.0625 },
    '对照组:四位以内的值一位都不许被抹掉(0.0625em = 1px/16,是真会出现的值)')
  // 真正要守的是往返:归一后的值写进档,再读回来必须还是它
  for (const v of [1e-7, 0.0625, 0.12]) {
    const f = normalizeStyleForm({ ...FORM, extraTokens: { letterSpacing: v } })
    const doc = composeStyleDoc(f)
    assert.doesNotMatch(doc, /e-\d/, '档里不许出现指数记法:' + v)
    assert.deepEqual(styleFormFromDoc(doc).extraTokens, f.extraTokens, '归一之后必须原样往返:' + v)
  }
})

test('validateStyleForm:补充色与更多属性越界一律报错(归一那侧丢掉,这侧必须说出来)', () => {
  const bad = (patch) => { try { validateStyleForm({ ...FORM, ...patch }); return null } catch (e) { return e.message } }
  assert.match(bad({ extraColors: ['zzz'] }), /补充色不是合法的颜色值/)
  assert.match(bad({ extraColors: ['#111', '#222', '#333', '#444', '#555', '#666', '#777'] }), /补充色最多 6 个/)
  assert.match(bad({ extraTokens: { letterSpacing: 0.9 } }), /字距超出可写的范围/)
  assert.match(bad({ extraTokens: { letterSpacing: -1 } }), /字距超出可写的范围/)
  assert.match(bad({ extraTokens: { borderWidth: 20 } }), /描边粗细超出可写的范围/)
  assert.match(bad({ extraTokens: { borderWidth: 'x' } }), /描边粗细不是一个数/)
  assert.match(bad({ extraTokens: { spacingUnit: 999 } }), /间距单位超出可写的范围/)
  assert.match(bad({ extraTokens: { lineHeight: 3 } }), /正文行高超出可写的范围/)
  assert.match(bad({ extraTokens: { headlineSize: 40 } }), /要么都给、要么都不给/)
  assert.match(bad({ extraTokens: [1, 2] }), /要给一个对象/)
  assert.match(bad({ extraColors: '#111' }), /要给一组颜色值/)
  // 对照组:合法的那一套必须过 —— 否则上面全是「什么都拦」而不是「拦对了」
  assert.equal(bad({ extraColors: ['#0FA3B1'], extraTokens: { letterSpacing: 0.08, borderWidth: 2, spacingUnit: 8, headlineSize: 40, bodySize: 16, lineHeight: 1.55 } }), null)
})

test('composeStyleDoc:更多属性只覆盖它提到的键,模板其余一行不动', () => {
  const plain = composeStyleDoc(FORM)
  const doc = composeStyleDoc({ ...FORM, extraTokens: { borderWidth: 3 } })
  const t = parseStyleTokens(doc)
  assert.equal(t.border.width, '3px')
  assert.equal(t.spacing.unit, '8px', '没提到的间距仍是模板值')
  assert.equal(t.typography.body.fontSize, '16px', '没提到的字号仍是模板值')
  assert.equal(t.typography.body.lineHeight, '1.65')
  assert.equal(t.typography.headline.letterSpacing, undefined, '没读到字距就一行都不写')
  assert.equal(parseStyleTokens(plain).border.width, '1px', '对照组:不给时描边仍是模板的 1px')
  assert.match(doc, /描边:3px 实线/, '正文与 front matter 不许各说各的')
  assert.match(composeStyleDoc({ ...FORM, extraTokens: { borderWidth: 0 } }), /描边:不描边/, '0px 要说人话,不是「0px 实线」')
})

test('composeStyleDoc + swatchSpec:字距 / 描边 / 间距 / 字号比 四条预览通道都亮得起来', () => {
  // FORM 是「重」档(48/16 = 3),这里的 36/18 = 2 —— 字号必须**盖过**档位给的那对,否则
  // 这条断言看着绿其实什么都没验(照抄档位值就分不出「盖上了」和「根本没盖」)
  const spec = swatchSpec(composeStyleDoc({ ...FORM, extraTokens: { letterSpacing: 0.12, borderWidth: 3, spacingUnit: 4, headlineSize: 36, bodySize: 18, lineHeight: 1.4 } }))
  assert.equal(spec.tracking, 0.12)
  assert.equal(spec.border.width, 3)
  assert.equal(spec.unit, 4)
  assert.equal(spec.titleScale, 2)
  const base = swatchSpec(composeStyleDoc(FORM))
  assert.equal(base.tracking, 0, '对照组:不给字距时这条通道是关的')
  assert.equal(base.border.width, 1)
  assert.equal(base.unit, 8)
  assert.equal(base.titleScale, 3, '对照组:不给字号时仍是「重」档那对 48/16')
})

test('composeStyleDoc ↔ styleFormFromDoc:补充色也往返 —— 「复制为新款」不许把半张色板弄丢', () => {
  const f = { ...FORM, extraColors: ['#0FA3B1', '#E55934'] }
  const back = styleFormFromDoc(composeStyleDoc(f))
  assert.deepEqual(back.extraColors, ['#0FA3B1', '#E55934'])
  assert.deepEqual(back.colors, FORM.colors, '四角色照旧原样回来')
  assert.deepEqual(styleFormFromDoc(composeStyleDoc(FORM)).extraColors, [], '对照组:原档没有补充色就不许凭空长出来')
  // 别人手写的档里,不叫 alt-N 的键不当补充色抓过来(那多半是作者自己的角色命名)
  const hand = ['---', 'name: "手写"', 'colors:', '  bg: "#FFFFFF"', '  ink: "#111111"', '  brand: "#FF0000"', '---', '', '## Colors', ''].join('\n')
  assert.deepEqual(styleFormFromDoc(hand).extraColors, [])
})

// 与上一条同一个道理,只是丢的东西换成了「更多属性」:「复制为新款」与「目录里已经有一份
// 风格档」两条路都走 styleFormFromDoc,它此前只回收补充色 —— 于是复制出来的那套字距、描边、
// 间距、字号、行高**全部退回模板值**,而 UI 上什么都不说。
test('composeStyleDoc ↔ styleFormFromDoc:更多属性也往返 —— 复制出来的那套不许悄悄退回模板值', () => {
  const XT = { letterSpacing: 0.12, borderWidth: 3, spacingUnit: 4, headlineSize: 36, bodySize: 18, lineHeight: 1.4 }
  const f = { ...FORM, extraTokens: XT }
  assert.deepEqual(styleFormFromDoc(composeStyleDoc(f)).extraTokens, XT, '五项一个都不许丢')
  // 只给一项也要原样回来(五项各走各的判据,别只在「全给」时才对)
  for (const [k, v] of Object.entries(XT)) {
    if (k === 'headlineSize' || k === 'bodySize') continue // 成对项,单给会被归一那侧整对丢掉
    assert.deepEqual(styleFormFromDoc(composeStyleDoc({ ...FORM, extraTokens: { [k]: v } })).extraTokens, { [k]: v }, k)
  }
  assert.deepEqual(styleFormFromDoc(composeStyleDoc({ ...FORM, extraTokens: { headlineSize: 36, bodySize: 18 } })).extraTokens,
    { headlineSize: 36, bodySize: 18 }, '字号成对给、成对回')
  // 对照组:模板骨架那几行**不算**作者写的 —— 一份没给更多属性的档回收出来必须是空的,
  // 否则上面全是「因为什么都收」而绿的,而证据区会凭空多出一行「还读到 · 描边 1px」
  assert.deepEqual(styleFormFromDoc(composeStyleDoc(FORM)).extraTokens, {}, '⭐ 模板默认值不许当成提炼所得回收')
  assert.deepEqual(styleCard(composeStyleDoc(f)).form.extraTokens, XT, '库卡带的那份表单同样要带上(前端预填靠它)')
  // 字距是唯一「写了就是写了」的一项:模板不给就整行不写,所以 0em 也是一个真设定
  assert.deepEqual(styleFormFromDoc(composeStyleDoc({ ...FORM, extraTokens: { letterSpacing: 0 } })).extraTokens, { letterSpacing: 0 })
})

test('extractFromDir:出处用目录名(控制台不展示机器内部路径);已有风格档那一支也给 suggest', () => {
  const root = tmp()
  const proj = path.join(root, 'my-brand-site')
  fs.mkdirSync(path.join(proj, 'css'), { recursive: true })
  fs.writeFileSync(path.join(proj, 'css', 'a.css'), 'html,body{background:#FAF9F6;color:#1A1A1A}.a{color:#C0392B}.a2{color:#C0392B}.b{border-radius:6px}')
  const r = extractFromDir(proj)
  // ⚠ 这里曾经写成 /（|\(提自 my-brand-site\)/ —— 全角括号「或」后半句,格式怎么漂都能中一半,
  //   等于没断言。钉死实际格式:describeExtract 拼的是全角括号包住的一段,且在句末。
  assert.equal(r.suggest.description.endsWith('(提自 my-brand-site)'), true,
    '出处段的格式变了:' + r.suggest.description)
  assert.ok(!r.suggest.description.includes(proj), '出处只给目录名,不许把绝对路径写进描述')
  // 已有风格档 ⇒ 有结论就别再猜:三样建议全取自这份档 —— 描述是作者写下的那句,
  // 补充色是档里的 alt-N,更多属性是档里与模板骨架不同的那几项(不是从 CSS 统计来的)
  const proj2 = path.join(root, 'has-doc')
  fs.mkdirSync(proj2)
  const XT = { letterSpacing: 0.06, borderWidth: 2, spacingUnit: 4, headlineSize: 36, bodySize: 15, lineHeight: 1.5 }
  fs.writeFileSync(path.join(proj2, 'DESIGN.md'), composeStyleDoc({ ...FORM, extraColors: ['#0FA3B1'], extraTokens: XT }))
  fs.writeFileSync(path.join(proj2, 'x.css'), '.a{letter-spacing:.3em;border:5px solid;padding:9px;font-size:44px}') // 与档里相反的信号:不该被采信
  const r2 = extractFromDir(proj2)
  assert.equal(r2.evidence.source, 'styledoc')
  assert.equal(r2.suggest.description, FORM.description, '作者写下的那句就是最好的建议')
  assert.deepEqual(r2.suggest.extraColors, [{ hex: '#0FA3B1', count: 0 }])
  // 证据区那句「直接取了它的设定,没有再去猜」得是真话 —— 硬写 {} 的话字距/描边/间距/字号
  // 全丢,表单里它们退回模板值,而 UI 上还写着「取了它的设定」
  assert.deepEqual(r2.suggest.extraTokens, XT, '档里写了什么就取什么,不许丢也不许从 CSS 里猜')
  // 对照组:同一支路径下,一份没写这几项的档仍然回空 —— 不是「恒等于非空」才绿的
  const proj3 = path.join(root, 'plain-doc')
  fs.mkdirSync(proj3)
  fs.writeFileSync(path.join(proj3, 'DESIGN.md'), composeStyleDoc(FORM))
  assert.deepEqual(extractFromDir(proj3).suggest.extraTokens, {}, '模板骨架那几行不是作者的决定,不许当提炼所得交出去')
})

test('extractFromUrl:suggest 跟着回,描述里的出处是域名', async () => {
  const fake = async (u) => {
    if (u === 'https://ex.com/') return { ok: true, status: 200, text: async () => '<style>html,body{background:#0F1117;color:#E6E8EF}.a{color:#E8590C}.b{color:#E8590C}.c{border-radius:14px}</style>' }
    throw new Error('unexpected ' + u)
  }
  const r = await extractFromUrl('https://ex.com/', { fetchImpl: fake })
  assert.match(r.suggest.description, /^深色底 · 圆角 14px · 主色 #0F1117 \/ #E8590C（?\(提自 ex\.com\)/)
  assert.ok(Array.isArray(r.suggest.extraColors))
  assert.equal(typeof r.suggest.extraTokens, 'object')
})

// ── 表单管不到的 front matter 段必须原样带过去(v0.11.33)────────────────────────
// ⚠ 真机审出来的:控制台「修改风格」是 doc → 表单 → 重新 compose 的往返,而表单只认它管的
// 那几段 ⇒ **`icons` 段被整段冲掉,而且是静默的**。这与 v0.11.23「正文默认逐字节保留」是同一
// 条道理:改个颜色不该把手写的声明弄没。做成通用的(不是只救 icons),下一个新段才不会重犯。
test('风格档往返: 表单管不到的段(icons)必须保住 —— 改个颜色不该把图标声明冲掉', () => {
  const src = `---
name: "带图标的"
colors:
  bg: "#FFFFFF"
  ink: "#333333"
  accent: "#1B6B37"
rounded:
  md: 8px
icons:
  library: "lucide"
  strokeWidth: 2
  semantics:
    back: "chevron-left"
---

## Overview

手写正文`
  const form = styleFormFromDoc(src)
  const rebuilt = composeStyleDoc(normalizeStyleForm(form))
  assert.ok(!/^icons:/m.test(rebuilt), '对照组:裸 compose 本来就会丢 —— 这正是要补的那一步')
  const kept = withKeptSections(rebuilt, src)
  assert.match(kept, /^icons:/m, 'icons 段必须回来')
  assert.match(kept, /semantics:/, '子键要连着整段带回来,不是只留一个键名')
  assert.match(kept, /back: "chevron-left"/)
  const spec = iconSpec(parseStyleTokens(kept))
  assert.ok(spec && spec.semantics.back === 'chevron-left', '带回来的必须还解析得出')
  // 表单管得到的段不许被旧档盖回去(否则等于改不动)
  const changed = composeStyleDoc(normalizeStyleForm({ ...form, colors: { ...form.colors, accent: '#FF0000' } }))
  assert.match(withKeptSections(changed, src), /#FF0000/, '新值必须留住 —— 只补旧档里「新档没有」的段')
  assert.ok(!/#1B6B37/.test(withKeptSections(changed, src)), '旧的强调色不该被带回来')
})

test('风格档往返: 旧档没有多余段 / 不是风格档时,原样返回不炸', () => {
  const plain = '---\nname: "普通"\ncolors:\n  bg: "#FFF"\n---\n\n正文'
  assert.equal(withKeptSections(plain, plain), plain)
  assert.equal(withKeptSections(plain, '不是风格档,连 front matter 都没有'), plain)
  assert.equal(withKeptSections(plain, ''), plain)
})
