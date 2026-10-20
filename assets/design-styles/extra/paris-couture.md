---
name: 巴黎高定
description: 象牙卡纸配 Didone 巨标题、爱马仕橙只占一条边——高级来自明度悬崖,不是灰调调和
suits: "品牌门面 · 内容阅读"
colors:
  paper: "#F2EDE4"
  ink: "#100D0B"
  accent: "#F37021"
  muted: "#8C8279"
  line: "#DCD5C9"
  bordeaux: "#6E1B24"
fonts:
  latin: "'Antique Olive', 'Neue Haas Grotesk Text', 'Helvetica Neue'"
  cjk: sans
typography:
  headline:
    latin: "'Didot', 'Didot LT Std', 'Bodoni 72', 'Playfair Display'"
    cjk: serif
    fontSize: "64px"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "0.04em"
  body:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
    measure: "58ch"
  label:
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.22em"
border:
  width: "0px"
  style: solid
  emphasis: "1px"
rounded:
  none: 0px
spacing:
  unit: "8px"
  gutter: "24px"
  margin: "48px"
  maxWidth: "1200px"
elevation:
  mode: flat
  levels: "0"
imagery:
  ratio: "4:5"
  treatment: none
  crop: full-bleed
icon:
  style: line
  strokeWidth: "1px"
  linecap: butt
  corner: sharp
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "24px"
  button-primary-hover:
    backgroundColor: "{colors.bordeaux}"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "32px"
  panel-bordeaux:
    backgroundColor: "{colors.bordeaux}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "48px"
  input-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "44px"
  tag:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
---

## Overview

参照物:Vogue 刊头(为 Condé Nast 定制的 Linotype Didot,属 Didone 分类,源头是 18 世纪末巴黎的 Firmin Didot)、爱马仕的橙盒与内页、法国时装屋的 lookbook。
版面只有三样东西:一张出血到边的图、一个横竖笔画极端反差的巨标题、一行拉开到 0.22em 的小标签。气质是「冷、准、贵」——**法式的高级不是灰调调和,是极端反差**,这一点几乎所有仿品都做反了。

## Colors

- **paper (#F2EDE4)**:象牙卡纸,带一点未漂白的暖。
- **ink (#100D0B)**:**近黑,必须是真黑不是灰黑**。与 paper 约 17:1——这道明度悬崖是高级感的第一来源;调成 #333 那种「柔和黑」,整个风格立刻塌成普通商务模板。
- **accent (#F37021)**:爱马仕橙,面积 **<1%**,只出现在一条边框、一个页码、一个标签底、一根引线上。⚠ 橙上放白字只有 2.5:1 必挂;**橙底黑字 6.6:1** 才是对的,这正是「橙盒黑印」的由来。
- **muted (#8C8279)**:暖灰,与 paper 3.2:1,只够图注与日期;正文一律 ink。
- **line (#DCD5C9)**:1px 分栏线与表格线。
- **bordeaux (#6E1B24)**:**仅用于整块底色**(一屏一块封顶),上面压 paper 字 9.8:1;不做文字色、不做小色块、不做边框。

⚠ 如实标注:爱马仕从未发布过官方 Pantone 值,网上并行流传 `#F37021` 与 `#FD5E0F` 两个数,本档取前者。它的来源是二战期间纸板短缺、供应商只剩橙色盒子的偶然——**它天生是包装的颜色**,用在边框、标签、页码、一条线上最对,铺满就错。

## Typography

- **标题走 Didone**(Didot / Bodoni 72,中文思源宋体),400 字重、字距 0.04em。两条硬指标:① **横竖笔画对比 ≥1:8**;② **只在 ≥40px 出现**——Didone 的 hairline 字号一小就在屏幕上消失,这是**物理约束不是审美偏好**,14px 的 Didot 通篇发虚,读者只会觉得「这站没做完」。
- **正文交给 Antique Olive**(Roger Excoffon,1962-66)。用它排正文是这套风格里最「法」的一步棋——它是法国人对 Helvetica 的正面回应,重心偏上、字腔饱满,与 Didot 并置时不争。
- **label 字距 0.22em** 全大写,是这个风格的签名;中文用同等字距代偿。
- 层级只有三档:巨标题 64px / 正文 16px / 标签 11px。**不存在 24px、32px 这种中间档。**
- 参照人物:**Roger Excoffon**(1910-1983),马赛 Fonderie Olive 艺术总监,作品含 Mistral(1953)、Antique Olive(1962-66),另做过法国航空与 1968 格勒诺布尔冬奥的视觉。

## Layout

- 8px 基准网格、12 栏;版心 1200px,外边距 48px 起。
- 图**出血到版面边缘**,标题**压在图上**——这是与静奢的分界(静奢的字与图互不重叠)。
- 文字压图时只压在图的低反差区,且**不加半透明遮罩**;找不到低反差区就换图,不要盖布。
- 分栏线 1px、line 色;页码、栏头、日期贴在版心外沿。

## Elevation & Depth

`elevation.mode: flat`——没有阴影,也没有「卡片」这一层。景深由两件事制造:

1. **图片出血压满 + 文字压在图片上**:图是最底层的「地」,字是浮在地上的一层,两层就够,不需要第三层。
2. **明度悬崖**:paper 与 ink 约 17:1、整块 bordeaux 与 paper 约 9.8:1——前后关系靠明度跳档读出来,不靠模糊和投影。

Don't:投影、渐变遮罩、毛玻璃、把橙色做成发光;任何「浮起」的暗示都会把卡纸变成塑料。

## Shapes

- **圆角恒 0**,包含图片、标签、输入框、头像。
- 边框默认 0;需要框时只用 1px 橙线或 1px line 色,**四边等宽**,不用双线、不用粗细混排。
- 允许的形状只有矩形与直线;不用圆点装饰、不用切角,箭头写成「→」字符而不是画一个图形。
- 图标 1px 线性、平头、直角,与 label 同高。

## Components

- **按钮**:ink 实底 + paper 字 + label 排版(全大写 0.22em),直角、44px 高;hover 换 bordeaux 底,**不位移、不变圆角**。一屏最多一个。
- **标签**:橙底黑字,小而扁,像贴在包装上的那一枚;一屏 ≤2 个。
- **整块 bordeaux 面板**:切分章节用,内部只放 paper 色标题与一行正文。
- **输入框**:底部 1px line,聚焦换 ink;无底色、无圆角、无外发光。

## Do's and Don'ts

- Do:强调色面积 <1%,并且只出现在「包装」位置(边、角、标签、页码)。
- Do:标题 ≥40px;小于这个尺寸就换成正文字族,别缩 Didot。
- Do:一屏一个视觉入口,图与字比例悬殊到不需要犹豫看哪个。
- Don't:**莫兰迪色**——Giorgio Morandi 是意大利画家,「莫兰迪 = 法式高级」是中文营销号的错配;这套风格的底色逻辑是**高反差**,和莫兰迪的低反差灰调正好相反。
- Don't:Didone 排正文,或用在 ≤14px 的小字上(hairline 在屏幕上直接消失,通篇发虚)。
- Don't:埃菲尔铁塔、法棍、蓝白条纹衫、手写体的 Bonjour——那是旅游纪念品不是法式。
- Don't:橙色铺满、做渐变、做发光,或者拿橙色当正文色。
- Don't:把 ink 调成灰黑「让它柔和一点」——那一步就是掉价的全部原因。

## Composition

- 封面:一张 4:5 出血图 + 压在下三分之一的巨标题 + 版心外沿一行 0.22em 小标签。
- 内页:左图右字或整版通栏;正文 58 字符栏宽,行距 1.7。
- 橙色出现的地方是**页码旁那条 1px 短线**,不是标题。

## Image Prompt Templates

- base: "parisian couture editorial photograph, ivory card-stock paper tone (#F2EDE4), single model or single object, hard directional studio light with deep true-black shadows (#100D0B), extreme tonal contrast, no mid-grey haze, 4:5 vertical full-bleed crop, matte silk and wool textures, one small orange packaging detail (#F37021), high-fashion magazine cover framing"
- negative: "muted morandi palette, low contrast grey tones, soft hazy lighting, eiffel tower, baguette, striped shirt, handwritten script, gradient, glow, rounded corners, drop shadow, cluttered props"
- 注:最容易翻车的一步是模型自动把「法式」理解成低反差灰调——prompt 里必须明写 "extreme tonal contrast" 与 "true black shadows",并在 negative 里点名 morandi;文字宁可后期排,别让模型生成 Didone 标题(它画不出正确的 hairline)。
