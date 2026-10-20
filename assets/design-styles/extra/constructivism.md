---
name: 构成主义
description: 一条斜轴、一个红、超窄超粗的大字与摄影蒙太奇——像装配工业品一样把版面搭起来
suits: "活动推广 · 品牌门面"
colors:
  paper: "#F0EBE1"
  ink: "#111111"
  red: "#D6202A"
  overprint: "#8E1418"
  muted: "#6E6A63"
  line: "#111111"
fonts:
  latin: "'Archivo Narrow'"
  cjk: sans
typography:
  headline:
    latin: "'Druk Condensed Super', 'Anton'"
    fontSize: "72px"
    fontWeight: 900
    lineHeight: 0.92
    letterSpacing: "-0.01em"
  body:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
    measure: "58ch"
  label:
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.12em"
border:
  width: "3px"
  style: solid
  emphasis: "4px"
rounded:
  none: 0px
  circle: 999px
spacing:
  unit: "8px"
  gutter: "24px"
  margin: "40px"
  maxWidth: "1080px"
  columns: 12
elevation:
  mode: flat
  levels: "0"
imagery:
  ratio: "3:4"
  treatment: duotone
  crop: hard
icon:
  style: solid
  strokeWidth: "3px"
  linecap: butt
  corner: sharp
components:
  button-primary:
    backgroundColor: "{colors.red}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "46px"
    padding: "20px"
  tag:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "26px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "24px"
---

## Overview

参照物:1920 年代苏俄,三条原则撑起全部形式 —— **tectonics**(暴露结构)、**faktura**(暴露材料本性)、**construction**(作品要像工业品一样被装配出来)。
**Rodchenko《书籍!》**(1924,为 Lengiz 出版社做的广告,模特 Lilya Brik,呐喊手势 + 摄影蒙太奇 + 几何切分)是这套语言最出名的一张,**El Lissitzky《用红楔子攻打白军》**(1919)是最纯的一张,Stenberg 兄弟的电影海报把它推到极致。
**当代传承链条**:Barbara Kruger 的白字红底 Futura Bold Oblique 直接继承这套语言 → Supreme 1994 年的 box logo,James Jebbia 交给设计师时参考的正是一本 Kruger 作品集。
一句话:**斜轴 + 一个红 + 超窄超粗的字 + 高反差照片**,四件东西被装配在一起,不是被排版出来的。

## Colors

- **paper (#F0EBE1)**:毛边纸白,微黄。纸感是 faktura 的一部分,纯白会把整件事变成 PPT。
- **ink (#111111)**:文字、粗线、几何块,paper 上 15.9:1。**line** 与它同值。
- **red (#D6202A)**:**唯一的彩色**,面积占 15-30% 且**集中成块**,不打散成一堆小红点。实测红底白字 5.1:1(AA 通过),但**正文别用红底** —— 红是喊口号的,不是读文章的。
- **overprint (#8E1418)**:红块与黑块重叠处压出来的叠印色。它是被"算"出来的,不是被"选"出来的。
- **muted (#6E6A63)**:次级文字 / 图注,paper 上 4.5:1。
- ⚠ 加第二个彩色就滑向孟菲斯。想加颜色时,先问是不是构图没搭好。

## Typography

- 标题 Druk Condensed Super(Commercial Type,Berton Hasebe 2014;Condensed 一支是为 *Bloomberg Businessweek* 2011 年度特刊而画),**需授权**;免费回退 **Anton** —— 超窄超粗、x-height 极高,是最接近的替身。中文用思源黑体 Heavy 适度压窄。
- 正文 Archivo Narrow 400;小标签同族 700 + 0.12em 字距、全大写。
- **标题与正文字号拉开 ≥6 倍**(72/16)。构成主义的张力来自尺度悬殊 —— 中间字号是它的敌人。
- 大字要**咬合**:字距 -0.01em、行高 0.92,字与字几乎无空隙,整块字读作一个几何体;文字可沿斜轴排、可竖排、可被色块切断,但**永远保持可读**,不做镜像与扭曲。

## Layout

- 版面是**装配**出来的:先定斜轴,再挂上大字块、照片、色块、细节文字,每件都露出接缝。
- **一条贯穿版面的斜轴**,全站只用**一个**角度,从 15° / 30° / 45° 里选定一个(30° 最典型)。⚠ **不允许"随便转几度"** —— 多个角度并存的那一刻,它就从构成主义变成杂乱。
- 不对称是纪律:重心刻意偏离中线,靠一块大红或一张大照片压住另一侧;允许出血,允许元素被版心切断(切断本身就是"结构"的证据)。
- 分隔用 **2-4px 粗线**,**不用 1px 细线** —— 细线是瑞士网格的语言,进不了这套。

## Elevation & Depth

`flat`。没有投影、没有渐变、没有模糊,层次只有一个合法来源:**叠印**。

- 红块压在黑块上,重叠处变成 **overprint (#8E1418)**,黑压红同理。这是印刷的物理事实,也是这个风格唯一承认的"第三个颜色"。
- 照片与色块的关系也是叠印式的:照片做高反差单色,直接压在红块上,交界不留白边。
- 需要更多层次时,加的是**尺度差**与**方向差**(大 vs 小、正 vs 斜),不是加 z 轴。Don't:任何 `box-shadow`、任何渐变、任何"浮起来"的卡片 —— 这里所有东西都贴在纸上。

## Shapes

- **圆角恒 0**。唯一的圆是**实心红圆盘**,它是构件(标记、节点、句点),不是圆角。
- 基本词汇:矩形条、三角楔、实心圆盘、粗线、箭头,全部实心平涂,不描边;线宽 3px 起(强调 4px),端点 butt,直角相交,图标同规格。
- 图片 3:4 竖构图硬裁 —— 竖版是海报的画幅,也让斜轴有地方跑。

## Components

- **主按钮**:红底 paper 字、直角、全大写窄体标签;一屏一个,它就是那句口号。
- **标签**:黑底 paper 字,小而紧,成组出现做编号与分类。
- **卡片 / 输入框**:paper 底 + 3px 黑边 + 直角,**无投影**;卡片可以被斜轴切过,输入框聚焦时边框换红、不加发光。

## Do's and Don'ts

- Do:彩色只有一个红,面积 15-30% 且集中成块;一个角度贯穿全站,所有斜的东西共用它。
- Do:照片先做高反差单色化(黑 + 纸,或红 + 纸)再进版面,不用原色照片。
- Do:留出纸的呼吸区,大字块附近尤其要空。
- Don't:加第二个彩色(加了就滑向孟菲斯);用渐变或投影模拟层次 —— **叠印是唯一合法层次**。
- Don't:让斜轴变成多个角度并存,不要"随手转 7°";不用 1px 细线、圆角、居中对称构图。
- **与「几何构成」的分界**(这两者常被混为一谈,但纪律完全相反):包豪斯是**静态、正交、三原色平衡**,形状为形状本身服务,**不用照片**;构成主义是**动态、斜轴、单一红色的政治性不对称**,而**摄影蒙太奇正是它的核心手法**。看到照片被切碎压在色块上,基本就是构成主义。
- **与「瑞士网格」的分界**:瑞士可以看成构成主义的**降温版** —— 抽掉斜轴与政治性,只留下秩序、网格与无衬线。反过来说:给瑞士网格加一条 30° 斜轴和一块大红,它就往回走了 30 年。

## Composition

- 海报:一条 30° 斜轴 + 一个占满 2/3 的窄粗大字块 + 一张高反差人像 + 一块红,重心偏向一侧。
- 图解:粗线连接实心几何块,标注用全大写窄体小字,编号用实心红圆盘;文字量少而重 —— 一句口号 + 几个数据,不写段落。

## Image Prompt Templates

- base: "Russian constructivist poster, 1920s Rodchenko and Lissitzky style, off-white paper (#F0EBE1) with pure black (#111111) and a single bold red (#D6202A), one strong 30-degree diagonal axis, ultra-condensed heavy sans-serif type locked tightly together, high-contrast duotone photo montage of a figure, solid red circle and triangular wedge as constructed elements, thick 3px rules, flat overprint where red meets black, asymmetric composition, no shadows"
- negative: "gradient, drop shadow, 3D render, multiple accent colors, pastel, rounded corners, centered symmetric layout, thin hairlines, glossy, Memphis style, random rotation angles"
- 注:角度要写死("one single 30-degree diagonal"),不写模型会到处乱转;颜色写成 "exactly one red, everything else black and paper";照片必须点名 "high-contrast duotone photomontage",否则会给你一张全彩摄影。中文版面补 "heavy condensed CJK sans-serif"。
