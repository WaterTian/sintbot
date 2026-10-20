---
name: 新粗野主义
description: 粗黑描边配零模糊硬投影,元素像贴纸压在纸上——拒绝一切柔化,要被一眼记住
suits: "活动推广 · 品牌门面"
colors:
  paper: "#FFFDF5"
  ink: "#0A0A0A"
  muted: "#4F4B45"
  accent: "#FFD23F"
  coral: "#FF6B6B"
  sky: "#74B9FF"
  line: "#0A0A0A"
fonts:
  latin: "'Space Grotesk'"
  cjk: sans
typography:
  headline:
    latin: "'Syne', 'Archivo Black'"
    fontSize: "52px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  body:
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1.6
    measure: "62ch"
  label:
    latin: "'Space Mono', 'Noto Sans Mono CJK SC'"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.08em"
border:
  width: "3px"
  style: solid
  emphasis: "3px"
rounded:
  none: 0px
spacing:
  unit: "8px"
  gutter: "24px"
  margin: "32px"
  maxWidth: "1120px"
  columns: 12
elevation:
  mode: offset
  levels: "2"
imagery:
  ratio: "1:1"
  treatment: duotone
  crop: hard
icon:
  style: solid
  strokeWidth: "3px"
  linecap: butt
  corner: sharp
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "44px"
    padding: "16px"
  button-primary-hover:
    backgroundColor: "{colors.coral}"
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "24px"
  input-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "44px"
  tag:
    backgroundColor: "{colors.sky}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
---

## Overview

参照物:Gumroad 2021 年那次重设计、Tony's Chocolonely 的包装与官网。
底子是建筑的粗野主义(*béton brut*,粗混凝土)——不掩饰材料、不修饰接缝。
落到界面上就一句话:**每个元素都是一张贴纸,硬边、平涂、压在纸上有影子。**
气质是「不装」——它不追求高级,追求被记住。

## Colors

- **paper (#FFFDF5)**:微暖白纸底。不用纯白 —— 纯白配纯黑太像未加样式的 HTML。
- **ink (#0A0A0A)**:文字、描边、投影**三者同一个值**。这是这个风格最省事也最关键的一条。
- **muted (#4F4B45)**:次级文字。
- **accent (#FFD23F)**:主强调。黄底黑字 12.6:1,是唯一能安全承载文字的强调色。
- **coral (#FF6B6B)** / **sky (#74B9FF)**:第二、第三色块。
  ⚠ **只做块面,不做文字底** —— coral 上放白字只有 2.6:1,必挂。
- **line (#0A0A0A)**:与 ink 同色。这个风格里"线"和"字"本来就是一回事。

## Typography

- 标题用 Syne 或 Archivo Black,字重 800,字距收到 -0.02em —— 字要挤、要重、要占满。
- 正文 Space Grotesk 500 —— 比常规正文重一档,才压得住粗描边。
- 小标签走等宽(Space Mono)+ 全大写 + 0.08em 字距,是这个风格的签名细节。
- **标题与正文反差 3 倍以上**(52/17)。这个风格没有中间字号,要么很大要么很小。

## Layout

- 12 列网格,但**允许元素越栏** —— 贴纸不会正好贴在格子里。
- 留白靠大间距(24/32/48 跳档),不靠细腻的行距微调。粗描边需要大留白才不糊。
- 卡片可以轻微重叠(压住彼此 8-16px),重叠处**不做半透明**,后来的直接盖住。

## Elevation & Depth

深度是**物理的**:元素有厚度,光是平行光,所以影子是实心的、不散。

1. **Level 0**:paper 纸底,所有内容落在上面。
2. **Level 1**(卡片/按钮/标签):`3px 3px 0 0 #0A0A0A` —— 零模糊、零扩散,投影色就是 ink。
3. **Level 2**(弹层/悬停):`5px 5px 0 0 #0A0A0A`。**最多到这里**,第三层就糊了。

**交互态是这个风格的灵魂**:hover 阴影涨到 `8px 8px 0`;按下时元素 `translate(3px, 3px)`
同时阴影归零 —— 「压下去」的物理感来自**位移**,不来自颜色变化。

Don't:任何带 blur 的阴影(哪怕 1px);多个方向的投影;阴影用灰色或半透明黑
(必须是 ink 纯色,这是"硬"的来源)。

## Shapes

形状语言 = **贴纸**。硬边、直角、粗轮廓。

- **圆角恒 0**(`rounded.none`),**无例外**,包括头像、图标底、输入框。
  圆角出现的那一刻这个风格就死了。
- **描边 3px 全站统一**,不按元素大小变。转角族 `rounded`(直角),不用切角。
- **线条**:3px 实线,端点 butt(平头),直角相交。不用虚线。
- **允许的形状**:矩形、正圆(仅作徽章与图标底)、45° 实心三角(仅作箭头)。

## Components

- **按钮**:accent 实色 + 3px 黑边 + 硬投影,一屏最多两个。次级按钮用 paper 底同款黑边。
- **输入框**:与按钮同规格(44px 高、3px 边、直角)。聚焦态 = 边框换 coral,**不加外发光**。
- **标签**:sky 或 coral 实色 + 黑边,小而密集地成排出现是这个风格的典型画面。
- **卡片**:paper 底 + 黑边 + 硬投影。**卡片里不再套卡片**(投影叠投影立刻脏)。

## Do's and Don'ts

- Do:描边宽度全站锁死一个值(这里是 3px),粗细统一比粗细讲究更重要。
- Do:正文区永远 paper 底 + ink 字(19:1);彩色只给块面、按钮、标签。
- Do:强调色一屏 ≤2 个。第三个想出现时,先删掉一个。
- Don't:任何圆角、任何模糊阴影、任何渐变。
- Don't:把 coral / sky 当文字底(对比度不够,见 Colors)。
- Don't:**做成那个烂大街的模板** —— 这是本风格最大的风险,单列一节说。

## 怎么做才不像那个模板

这个风格在 2022-2023 被组件库大量复制,已经有了一套「一眼看穿是套模板」的长相:
**黄底 + 黑边 + 圆角 12px + 卡片网格 + Inter 字体 + 到处都是彩色小方块**。
它现在反而是廉价感的信号 —— 收进本库是因为它的**手法**(硬投影、按压位移)有价值,
不是因为那个长相。四条硬约束把它和模板分开:

1. **圆角必须是 0**。模板几乎都用 8-12px 圆角配黑边 —— 那是「粗野的柔化版」,自相矛盾。
2. **不用 Inter / Roboto**。用 Syne 或 Archivo Black 这类有性格的显示字,标题才立得住。
3. **色块要大、要少**。模板的通病是满屏彩色小方块;这里的正解是一两块大色面。
4. **投影颜色 = 文字颜色**。模板常用灰色或半透明黑投影,那一步就软了。

## Composition

- 单主体、强对比:一个大标题 + 一块大色面 + 一个按钮,就是一屏。
- 元素可以出血、可以歪一点点(≤2°),但**绝不旋转超过 5°** —— 那是孟菲斯不是粗野。
- 图片处理成双色(duotone,ink + 一个强调色),硬裁成正方,加 3px 黑边。

## Image Prompt Templates

- base: "neo-brutalist web design, thick 3px solid black outlines, hard offset drop shadow with zero blur, flat solid color blocks, warm off-white paper background (#FFFDF5), pure black text (#0A0A0A), one bold yellow accent (#FFD23F), sharp 90-degree corners, no rounded corners, no gradients, sticker-like layered elements, bold condensed display typography"
- negative: "rounded corners, soft shadow, blur, gradient, glassmorphism, pastel, thin lines, drop shadow with spread, 3D render, glossy"
- 注:生成中文版面时补 "clean CJK sans-serif typography, heavy weight";文字宁少勿多,
  这个风格靠一两个大词撑场面。
