---
name: 热带现代
description: 巴西现代主义——混凝土白底、高对比黑白照片、一点纯红,曲线大到跨过整个版面;反民俗符号
suits: "活动推广 · 品牌门面"
colors:
  paper: "#EDEAE3"
  ink: "#14110F"
  accent: "#D8202A"
  cobalto: "#2C5F9E"
  verde: "#1F7A4C"
  muted: "#6E6A63"
  line: "#CFC9BE"
fonts:
  latin: "'Archivo', 'Helvetica Neue'"
  cjk: sans
typography:
  headline:
    latin: "'Archivo Black', 'Archivo', 'Helvetica Neue'"
    fontSize: "46px"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  body:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    measure: "62ch"
  label:
    latin: "'Archivo Narrow', 'Archivo'"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.14em"
border:
  width: "0px"
  style: none
  emphasis: "0px"
rounded:
  none: 0px
  circle: 999px
spacing:
  unit: "8px"
  gutter: "24px"
  margin: "32px"
  maxWidth: "1200px"
  columns: 12
elevation:
  mode: flat
  levels: "0"
imagery:
  ratio: "1:1"
  treatment: grayscale
  crop: hard
icon:
  style: solid
  strokeWidth: "2px"
  linecap: butt
  corner: sharp
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "48px"
    padding: "24px"
  dot-mark:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.circle}"
    size: "24px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "24px"
  tag:
    backgroundColor: "{colors.cobalto}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px"
---

## Overview

参照物:César Villela 为 Elenco 唱片做的封面系统(1960 年代里约,摄影 Francisco Pereira);**Athos Bulcão**(1918-2008)与 Niemeyer 长期合作的巴西利亚模块化釉砖壁面;Roberto Burle Marx 的 Avenida Atlântica 人行道(1969-72)。
Niemeyer 说过:「我不被直角吸引……我被自由流动的、性感的曲线吸引——我在祖国的群山里、河流的蜿蜒里、海浪里、爱人的身体上找到的那种曲线。」
但要注意这句话的**上下文是混凝土**:巴西现代主义是**反民俗符号**的,它的语言是混凝土、模数与几何,不是羽毛与国旗色。手法一句话概括:**恒定的几何标记 + 可变的照片**。

## Colors

- **paper (#EDEAE3,concreto)**:混凝土白,微灰微暖,全部底色,不用纯白。
- **ink (#14110F)**:近黑,文字与色块主色。配 paper 15.7:1。
- **accent (#D8202A,vermelho)**:红圆点专用。⚠ 配 paper 4.2:1、配 ink 3.7:1 ⇒ **只放 ≥24px 的字,正文级小字一律不放**;它本来就不是按钮底,是**标记**。
- **cobalto (#2C5F9E)**:Athos Bulcão 釉砖的钴蓝。配 paper 白字 5.4:1,可承载文字。
- **verde (#1F7A4C)**:釉绿,后期加入的第三色。配 paper 4.4:1 ⇒ ≥18px。
- **muted (#6E6A63)**:次级文字,配 paper 4.48:1(擦边)⇒ 最小 15px。
- **line (#CFC9BE)**:极少用的分隔线——这套风格基本不画线,靠色块自己的边。
- **纪律:黑白之外的纯色一屏不超过 2 个。** 红几乎总在场,那就只剩一个名额给蓝或绿。

## Typography

- 标题 **Archivo Black**(Héctor Gatti,Omnibus-Type,布宜诺斯艾利斯 2012,开源)700 + 字距 -0.02em + 行距 1.02——标题要挤成一个实心块,与照片的色块对话。
- 正文 Archivo 常规;小标签走 Archivo Narrow 600 + 0.14em,**窄体是这套的签名**。
- 标题正文反差 46/16 ≈ 2.9 倍,中间号只在长文里出现;中文用思源黑体补位,标题字重拉到 700 才压得住。

## Layout

- **系统性优先于单页好看**:同一个几何标记必须出现在**每一页的同一位置**(左上角、页脚右侧,选定就不动)。整套物料的识别力全从这一条来。
- 12 列网格;照片占整栏或整版,色块压住照片一角(压 1/6 到 1/4)。
- 大曲线可以出血、可以横跨全版,**曲线半径 ≥ 版面宽度的 1/3**——小于这个数它就退化成"亲和风圆角"。
- 留白集中在一侧,不四周均匀分布。

## Elevation & Depth

**零阴影**。层次靠**高对比黑白照片 + 纯色块叠压**:

1. 底:混凝土白。
2. 黑白照片(反差拉到近乎二值,中灰尽量少),硬裁,不加框不加圆角。
3. 纯色块压在照片上,**实色不透明**,直接吃掉照片的一角。
4. 红圆点压在最上层,永远完整、永远不被裁。

没有投影、没有毛玻璃、没有渐变。深度是**遮挡**,和印刷一样。

## Shapes

- **矩形 + 正圆 + 超大曲线**,三样,没有第四样。
- 圆角:`none 0px` 用于一切矩形;`circle 999px` **只用于圆点与图标按钮,绝不用于卡片**。
- 曲线只有一种画法:大到跨过版面的自由曲线(见 Layout 的 1/3 判据),两端出血或与直边相切,中间不做小转折。
- 图标走实心(solid)、2px 笔画、平头端点、直角。

## Components

- **按钮**:近黑实底 + 混凝土白字,直角,48px 高;次级按钮 = 白底黑字,同尺寸。
- **红圆点**:24px 正圆,纯标记元件,**不放字、不可点击**;一屏出现 1 个或 4 个。
- **卡片**:混凝土白底,直角,无边无影,靠间距分区。**标签**:钴蓝实底 + 白字,小而横排。

## Do's and Don'ts

- Do:**四个红圆点**——Villela 给 Elenco 定的系统是白底 + 四个红圆 + 高对比黑白人像。**一个不变的几何标记加一张会变的照片,就撑起了整个厂牌的识别。** 这是可以直接搬进界面的系统方法,不是装饰:把"标记"做成固定组件,照片当内容槽位。
- Do:**黑白 + 一点红 + 大尺度自由曲线**是有出处的组合——Burle Marx 1969-72 年重做 Copacabana 大道人行道,保留海边原有的葡萄牙碎石黑白波浪并强化其曲线,在对侧与中央岛用同样的黑白石**加入红石**,拼成四公里长的抽象马赛克。
- Do:照片先转黑白再进版面,反差拉满。
- Don't:桑巴羽毛、狂欢节面具、国旗黄绿蓝直接上版。**巴西现代主义恰恰是反民俗符号的**——这是本档最大的误用风险。
- Don't:满屏彩色渐变。"热带"不是彩虹,是黑白打底加一到两个纯色。
- Don't:**把曲线做成小圆角**。曲线要大到跨过整个版面;小圆角会把它变成"圆融亲和",两个风格的气质因此完全颠倒。
- Don't:拿 Niemeyer 的建筑照片当背景贴图——用它的**几何**,不用它的**照片**。
- Don't:投影、渐变、玻璃质感、彩色照片。

## 与「构成主义」的分界

⚠ 这两档的色板几乎撞车(构成主义 paper #F0EBE1 / ink #111111 / red #D6202A / muted **同为 #6E6A63**),`suits` 也完全相同,所以**必须靠构图区分**,不能靠颜色:
- **轴**:构成主义是一条**斜轴**(对角动势,元素沿斜线装配);这一套是**正交 + 一条大曲线**,曲线是唯一的非直线。
- **照片**:构成主义把照片剪碎做**蒙太奇**;这一套的照片**保持完整**,只被色块压掉一角。
- **字**:构成主义 Druk Condensed Super 900 / 72px 超窄超粗;这一套 Archivo Black 700 / 46px 正常字宽,标题是实心块不是巨型标语。
- **系统**:构成主义每版重新构成,没有恒定标记;这一套的核心恰恰是**恒定几何标记(四红圆点)在每页同一位置**。
- **第二色**:构成主义只有红与套印暗红;这一套允许一个钴蓝或釉绿(来自釉砖传统)。

## Composition

- 一版一照片:高对比黑白人像/场景占主体,一块纯色压角,红圆点在固定位置。
- 标题实心块贴着照片边缘排、齐左;正文另起一块白区。
- 曲线若出现,它就是版面的骨架——照片与文字沿曲线两侧分布,不再另加分割。
- 一版内红只出现一处(可以是四个圆点组成的一处)。

## Image Prompt Templates

- base: "Brazilian modernist graphic design, high contrast black and white photograph, flat solid color blocks overlapping the photo, four small red dots as a fixed geometric mark, concrete-white ground (#EDEAE3), pure vermilion red (#D8202A), one cobalt blue (#2C5F9E), heavy grotesque display type set tight, one huge sweeping curve spanning the entire layout, modular glazed tile wall logic, 1960s Rio record sleeve, flat printing, hard edges, no gradient, no shadow"
- negative: "carnival feathers, samba costume, brazilian flag green and yellow, tropical leaves, palm tree clip art, toucan, rainbow gradient, small rounded corners, soft shadow, glassmorphism, 3D render, glossy, beach stock photo, colorful photography"
- 注:模型一听 "tropical" 就会加棕榈叶和彩虹渐变,提示词必须同时写 "modernist, concrete, no tropical foliage";照片元素明写 "black and white only";曲线明写 "one single large curve, radius larger than one third of the canvas width",否则它会给一堆小圆角。
