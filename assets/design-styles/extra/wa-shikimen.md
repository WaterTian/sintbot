---
name: 和・色面
description: 伝統色的大块平涂,色面拼出形体、不描轮廓;和文ベタ組み贴身排——战后日本平面的骨相,不是留白性冷淡
suits: "品牌门面 · 内容阅读"
colors:
  paper: "#FBFAF5"
  ink: "#2A4073"
  muted: "#595857"
  line: "#6C848D"
  accent: "#EB6101"
  kakishibu: "#9F563A"
typography:
  headline:
    fontFamily: "'Ten Mincho', 'Yu Mincho', 'Hiragino Mincho ProN', 'Noto Serif JP', 'Noto Serif SC', serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  body:
    fontFamily: "'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Noto Sans SC', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.85
    letterSpacing: "0em"
    measure: "34em"
  label:
    fontFamily: "'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Noto Sans SC', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0.18em"
border:
  width: "0px"
  style: none
  emphasis: "0px"
rounded:
  none: 0px
spacing:
  unit: "8px"
  gutter: "24px"
  margin: "48px"
  maxWidth: "1080px"
  columns: 12
elevation:
  mode: flat
  levels: "0"
imagery:
  ratio: "1:1"
  treatment: duotone
  crop: hard
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
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "32px"
  tag:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px"
  color-plane:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.none}"
    size: "160px"
---

## Overview

参照物:田中一光 1981 年为 UCLA 亚洲表演艺术研究所做的《日本舞踊》海报——三个黑方块加两个深灰三角拼出发髻,一个红方块加两个亮色三角拼出和服(MoMA、V&A、悉尼 Powerhouse 三馆藏)。六个色值全部取自和色大辞典的日本伝統色官方色表,括号里即**伝統色名**。
一句话:**形体由色面拼出来,不由线画出来。** 这是它与所有「东方风」模板的分水岭——那些画细线、留白、配小字;这一套是大块平涂的伝統色,余白是留给色面呼吸的,不是为了显得空。
原研哉在《白》里区分过两个词:emptiness(受容的空)与 simplicity(西方的简)。白在这里是「有待填入」的状态,不是「什么都不放」的洁癖。

## Colors

- **paper (#FBFAF5,生成り kinari)**:未漂白生丝的白,微黄,全部底色。
- **ink (#2A4073,深縹 koki-hanada)**:主文字与主色面。它是**蓝**不是黑,整张图的调子由此偏冷;配 paper 9.7:1。
- **muted (#595857,墨 sumi)**:次级文字、小标签底。配 paper 6.8:1。
- **line (#6C848D,藍鼠 ai-nezu)**:第三色面与极少的分隔线。配 paper 3.8:1 ⇒ 只做面与线,不做文字底。
- **accent (#EB6101,朱色 shu)**:唯一的暖色,一版一处。⚠ **不承载任何文字**——白字 3.2:1、深縹字 3.0:1,两头都不够。它是一块**色面**。
- **kakishibu (#9F563A,柿渋色)**:第二色面,只用于图形。⚠ 它配 paper 其实有 5.2:1、放白字读得清,**禁它承载文字是构图纪律不是可读性问题**:色面一旦开始装字,色面構成就退化成普通彩色卡片。

## Typography

- 标题明朝体(首选 Adobe **Ten Mincho** 貂明朝,西塚凉子与 Robert Slimbach,骨相取自江户中后期瓦版印刷的手写笔势),正文黑体。**标题衬线、正文无衬线**是这套的常规。
- **ベタ組み**:和文与中文正文字距恒 `0em`,字身框贴字身框排——这是和文排版的默认制式,松一点点就散。
- **字距两极分化**是签名:正文 `0em` 贴身,拉丁小标签 `0.18em` 拉到极开,中间值不许出现。
- 标题正文字号比 40/16 = 2.5 倍;层级只走这两档,不设中间号。

## Layout

- **版面率低**是硬指标,三条都能量出来:文字块占版面 ≤40%、余白 ≥45%、单一色面占版面 ≥1/3。
- 12 列网格用来定色面的边,不用来切文字栏——色面可以横跨 5 列、7 列,但边必须落在格线上。
- **縦組(竖排)** 可用一栏且仅一栏。⚠ 竖排里的拉丁长词必须转横排小块(縦中横)或改全角,把半角单词竖着摞下来是错排。
- 分隔尽量不做;非做不可时用一条 1px 藍鼠细线,不用粗分割条。

## Elevation & Depth

**零阴影**。层次全部来自色面的**大小与叠压顺序**——这是丝网印刷的物理:先印的在下,后印的在上。

1. 底:paper 生成り。
2. 大色面(深縹/藍鼠/柿渋)直接压在底上,**边缘绝对硬**,不描边、不留缝。
3. 小色面(朱色)压在大色面上,面积比 ≤1/8。压住即遮挡,**不做半透明、不做混色叠印**。

判断层级只看一件事:谁盖住了谁。所以色面之间必须**有实打实的重叠**(至少 24px),擦边并置会让层次消失、整张变成拼贴。
Don't:任何 blur 阴影、任何投影、任何"浮起来"的卡片。这套风格里没有 Z 轴,只有先后。

## Shapes

形状语言 = **色面構成**:主体由 3-5 个几何块拼成,**不画轮廓线**。

- 允许的块只有四类:矩形、正圆、三角形、半圆——用它们拼出人、器物、山、花。**圆角恒 0**,无例外。
- 描边宽度 0——这套风格里没有"描边"这个概念,边界由两块颜色的交界产生;图标走 1px 细线、平头端点、直角相交,是唯一允许出现线条的地方。

## Components

- **按钮**:深縹实底 + 生成り字,直角无影;次级按钮 = 生成り底 + 深縹字,靠字色区分。
- **卡片**:就是一块 paper 色面,padding 32px,不加边框不加影——它靠周围的余白成立。**标签**:墨色实底 + 生成り小字 + 0.18em 字距,小而横排成列。
- **色面**:朱色方块,纯装饰元件,**不可放字、不可点击**;它在版面里的角色相当于印章。

## Do's and Don'ts

- Do:一版只用 2-3 个伝統色 + 生成り底;第四个想上场时先删一个。
- Do:把最大那块色面做到**跨过版心**——大到"有点过分"才是这个风格。
- Do:正文严格 `0em`、拉丁小标签严格 `0.18em`,这两个数是签名,不许调和。
- Don't:做成「纯白 + 细灰线 + 极小字」的性冷淡模板。**战后日本平面的主干是伝統色的大块平涂**,不是无色——这是本档最大的误读风险。
- Don't:樱花、富士山、鸟居、浮世绘浪花当背景贴图。要日本感就用色与构成,不用符号。
- Don't:书法字体排正文;毛笔字只允许作为单个大字出现。
- Don't:**假日文**——把汉字词拼成看起来像日文的「和风文案」。写不出正确日文就写中文或纯图形;**错一个假名整张废**,而这类错误母语者一眼可见。
- Don't:朱色或柿渋上放字(见 Colors)。

## 与「新中式」的分界

全库最容易撞的一对,方向其实是**相反**的:新中式是暖宣纸底 #F5F0E6 + 墨(暖黑)+ 朱砂印章,手法是**线描**、白描、木版水印,字距**松**(0.05-0.15em);
和・色面是灰调生成り #FBFAF5 + 深縹(蓝),手法是**色面平涂**、拼块、无轮廓,字距**零**(ベタ組み),朱色是压在大色面上的一块面而不是落款印。
判定口诀:看到"线描 + 松字距 + 暖墨"是新中式;"平涂 + 零字距 + 冷蓝"才是这一套。**不是近亲,别互相借元素。**

## Composition

- 一版一主体:主体由几块几何色面拼成,居版心偏上或偏左,四周大片生成り余白。
- 小字块(标题/署名)贴着某块色面的边排,与色面**对齐而不居中**。
- 图片处理成双色(生成り + 深縹),硬裁成正方,直接落在版面上不加框;一版内只出现一次竖排,只出现一处朱色。

## Image Prompt Templates

- base: "post-war Japanese graphic design poster, flat color-plane composition, subject assembled from 3-5 geometric blocks with no outlines, warm unbleached kinari paper ground (#FBFAF5), deep hanada indigo (#2A4073), sumi grey (#595857), ai-nezu blue-grey (#6C848D), one small vermilion shu block (#EB6101), large uninterrupted negative space, silkscreen flat printing, hard edges, no shading, mincho display type with tight CJK setting"
- negative: "outline drawing, line art contour, cherry blossom, Mount Fuji, torii gate, ukiyo-e wave, calligraphy brush script as body text, kawaii illustration, pure white background, gradient, drop shadow, 3D render, glossy, pastel palette, wide letter spacing on CJK"
- 注:版面里若要出现日文,**必须确认假名与汉字都写对**,拿不准就只放中文或纯图形;提示词补 "flat vector, no gradient" 压住模型自动加的光影,补 "tight CJK typesetting" 防它把中文排松。
