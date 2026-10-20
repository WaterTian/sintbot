---
name: 北欧物性
description: 未漂白亚麻底、炭褐字、黄铜一点——不用纯白纯黑不用硬光,最贵的是一张有材质的照片
suits: "内容阅读 · 品牌门面"
colors:
  paper: "#F0EBE3"
  ink: "#2A2724"
  muted: "#9A968D"
  line: "#DDD6CB"
  accent: "#A88C4A"
  oak: "#C6A780"
  pine: "#2E4438"
fonts:
  latin: "'Adobe Caslon Pro', 'EB Garamond'"
  cjk: serif
typography:
  headline:
    fontSize: "40px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "0.02em"
  body:
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.75
    measure: "62ch"
  label:
    latin: "'Founders Grotesk', 'Neue Haas Grotesk'"
    cjk: sans
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.24em"
border:
  width: "1px"
  style: solid
  emphasis: "1px"
rounded:
  sm: 2px
spacing:
  unit: "8px"
  gutter: "32px"
  margin: "48px"
  maxWidth: "1160px"
elevation:
  mode: shadow
  levels: "1"
imagery:
  ratio: "4:5"
  treatment: none
  crop: hard
icon:
  style: line
  strokeWidth: "1.25px"
  linecap: round
  corner: round
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "44px"
    padding: "20px"
  button-primary-hover:
    backgroundColor: "{colors.pine}"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "32px"
  input-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "44px"
  tag:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
  panel-pine:
    backgroundColor: "{colors.pine}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "48px"
---

## Overview

参照物:**Poul Henningsen** 与 Louis Poulsen 的 PH 系列灯具;**Kinfolk**(2011 创刊于波特兰,2015 总部迁哥本哈根;《The Kinfolk Table》正文用 Adobe Caslon,2021 十周年改版由 Schick Toikka 定制了一套字体家族,简报要求是「三角楔形衬线」)。
这个风格的底色不是「性冷淡」,是**物性**:亚麻、橡木、羊毛、黄铜,以及不刺眼的光。版面里最贵的东西应该是一张有材质的照片,不是任何图形。

⚠ 如实标注:Kinfolk 那套定制字体的**具体名称在公开报道里没有给出**,本档 fontFamily 是可得的近似替代——Caslon 那一位可换任何 flared / wedge serif(楔形衬线),骨相对了就行。

## Colors

- **paper (#F0EBE3)**:未漂白亚麻。**不用 #FFFFFF**——纯白在屏幕上就是眩光。
- **ink (#2A2724)**:炭褐,**不用纯黑**。与 paper 12.5:1,足够锐利又不刺。
- **muted (#9A968D)**:与 paper 只有 2.5:1,**它不是文字色**,是线与面的色(表格底纹、失效态、图注下的细线)。真要排图注,用 **ink 70% 不透明(≈5.1:1)**,别用 muted。
- **line (#DDD6CB)**:1px 分隔线与描边。
- **accent (#A88C4A)**:黄铜。与 paper 2.7:1,**不作文字色**,只做一条线、一个小图标、一枚圆点。
- **oak (#C6A780)**:橡木。大面积衬底或图片旁的色块。
- **pine (#2E4438)**:松绿。整块底色用,上面压 paper 字 8.9:1。

**可验证的指标(全写成数,不写形容词)**:① 留白 **≥50%**(按整屏面积算,图片不计入留白);② 正文栏宽 **≤62 字符**、行高 **1.7-1.8**;③ 全色板 HSL 饱和度 **≤35%**,例外只有两个材质色——accent 黄铜 38.8%、oak 橡木 38.0%,上限 45%(pine 松绿实测只有 19.3%,不需要例外);④ **不出现 `#FFFFFF` 与 `#000000`**,一次都不要。

## Typography

- 标题与正文**同一族衬线**(Adobe Caslon / EB Garamond,中文思源宋体),字重都是 400。层级只靠字号(40 / 17)与留白拉开,不靠字重也不靠颜色。
- 正文 17px、行高 1.75、栏宽 62ch——这三个数最容易被偷懒省掉,也最影响观感。中文标题字距取 0.02-0.05em;段落首行不缩进、段间空一行(西式),更贴近参照物。
- **label 是唯一的无衬线**:Founders Grotesk 500、11px、字距 0.24em、全大写。它只出现在栏头、日期、页码上,数量极少,正因为少才成为对比。

## Layout

- 8px 基准、12 栏,版心 1160px。**偏置构图是签名**:照片放右上、文字块落左下,两者不对齐、不居中——Kinfolk 极少居中。
- 做法是**「先排满再一层层删」,不是「从空白开始加」**:从满版开始删,留下的东西才有理由;从空白开始加,加出来的永远是居中三段式。
- 图片硬裁 4:5,四边留白不等宽(上窄下宽),图注紧贴图片下沿。

## Elevation & Depth

`elevation.mode: shadow`,但**没有硬投影**——只有一片极大模糊、极低透明度的漫射影:`box-shadow: 0 12px 32px rgba(42, 39, 36, .06)`。它的作用不是「浮起来」,是让卡片边缘不至于和底色焊死。**只有一档,没有 level 2。**

这条阴影是**无眩光原则**在深度上的落点:光被三层灯罩挡过,落到桌面时已经没有边界,所以影子也不该有边界。配套的另外两种深度手段:① **paper 与 oak / pine 的色块分层**(换材质,不换高度);② **1px line 描边**——大多数时候一条线就够了,阴影是备选不是默认。

Don't:硬边投影、多层阴影、任何 blur < 8px 的阴影、任何「按下去」的位移。

## Shapes

- 圆角只有 **2px**(`rounded.sm`)——不是直角,也远不到「圆润」;它读起来像纸被裁过的边。
- 边框 1px、line 色;卡片优先用边框,阴影是次选。
- 图标线性、**1.25px、圆头端点、圆角转角**——这是全档唯一「柔」的地方,呼应无眩光。
- 允许的形状只有矩形、极小圆角矩形、正圆(仅图标点);不用斜切、不用多边形装饰。

## Components

- **按钮**:ink 实底 + paper 字 + label 排版,2px 圆角、44px 高;hover 落到 pine。一屏最多一个实心按钮,其余都是带下划线的文字链。
- **卡片**:paper 底 + 1px line 边 + 2px 圆角 + 32px 内边距;要浮起时才加那条漫射影。
- **标签**:paper 底 + 1px line 边 + ink 字,极扁极小。
- **整块 pine 面板**:章节分隔用,内部只放 paper 色标题与一行正文。
- **输入框**:paper 底 + 1px line 边;聚焦时边框换 accent 黄铜,**不加外发光**。

## Do's and Don'ts

- Do:**无眩光原则**——Poul Henningsen 1925 年基于 lituus 螺线做的三层灯罩系统,目标是「从任何角度都看不到灯泡」(1958 年定型为 PH 5)。落到界面上是硬规则:不用纯白底、不用纯黑字、不用硬边高光,任何「发光」的东西都要有一层遮挡。
- Do:**物性优先于图形**——版面里最贵的应该是一张有材质的照片(橡木纹、羊毛织物、黄铜边),图形装饰接近于零;找不到好照片时宁可留空。
- Do:把上面四条数值指标当验收项逐条量。
- Don't:做成「白墙 + 一根绿植 + 莫兰迪灰」的样板间——**北欧的底色是未漂白的亚麻与木,不是灰**,灰调是这套风格最常见的误读。
- Don't:纯白底 + 纯黑字 + 硬投影(直接违反无眩光原则,三条全犯)。
- Don't:驯鹿、雪花、北欧针织提花、维京符文——那是圣诞包装纸不是北欧设计。
- Don't:高饱和色、荧光色、彩色渐变。
- Don't:居中对称的三段式版面;那会把「偏置构图」这个签名整条抹掉。

## Composition

- 一屏 = 一张 4:5 材质照(右上)+ 一个衬线标题与两行正文(左下)+ 一行 0.24em 小标签。
- 图与字**不重叠**;它们靠对角线的张力发生关系,不靠压叠。页脚只有一条 1px line 与一行 label。

## Image Prompt Templates

- base: "scandinavian interior still life, unbleached linen and oiled oak surfaces, soft diffused north-facing daylight with no visible light source and no specular highlight, warm off-white ground (#F0EBE3), charcoal-brown accents (#2A2724), a single brass detail (#A88C4A), low saturation, matte wool and ceramic textures, 4:5 vertical crop, generous empty space, quiet and material"
- negative: "pure white background, pure black, hard shadow, specular highlight, glossy surface, morandi grey palette, reindeer, snowflake, nordic knit pattern, plastic, neon, high saturation, centered symmetrical composition"
- 注:关键词是 **"diffused" 与 "no visible light source"**——这两个词直接对应无眩光原则,漏掉它们模型会给硬光和高光点,整张图立刻不是这个风格;另外把材质名(亚麻 / 上油橡木 / 羊毛 / 未上釉陶 / 黄铜)写全,材质就是这个风格本身。
