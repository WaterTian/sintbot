---
name: 乌尔姆功能
description: 器物的可操作感——机身白外壳、4px 栅格无例外、信号红只标"能按的地方",有薄影就等于能碰
suits: "工具产品"
colors:
  shell: "#F0EDE5"
  ink: "#2B2B29"
  muted: "#8A8A87"
  signal: "#C02820"
  ciel: "#7FB2D4"
  line: "#D6D2C8"
fonts:
  latin: "'Rotis Sans Serif', 'Frutiger'"
  cjk: sans
typography:
  headline:
    latin: "'Rotis Semi Sans', 'Univers', 'Frutiger'"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
    measure: "68ch"
  label:
    latin: "'IBM Plex Mono', 'SF Mono', 'Noto Sans Mono'"
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0.06em"
border:
  width: "1px"
  style: solid
  emphasis: "2px"
rounded:
  sm: 2px
  md: 4px
spacing:
  unit: "4px"
  gutter: "16px"
  margin: "24px"
  maxWidth: "1080px"
  columns: 12
elevation:
  mode: shadow
  levels: "1"
imagery:
  ratio: "3:2"
  treatment: grayscale
  crop: hard
icon:
  style: line
  strokeWidth: "1.5px"
  linecap: butt
  corner: sharp
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.shell}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "16px"
  button-secondary:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "16px"
  input-field:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "12px"
  card:
    backgroundColor: "{colors.shell}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "16px"
  toggle-track:
    backgroundColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    height: "24px"
    width: "40px"
  toggle-on:
    backgroundColor: "{colors.signal}"
  tag:
    backgroundColor: "{colors.ciel}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: "24px"
    padding: "8px"
  status-dot:
    backgroundColor: "{colors.signal}"
    rounded: "{rounded.sm}"
    size: "8px"
---

## Overview

参照物:**Dieter Rams**(Braun 设计负责人 1961-1995;Vitsœ 606 通用搁架系统 1960,MoMA 永久馆藏)与 **Otl Aicher**(1953 年与 Inge Scholl、Max Bill 共同创办 HfG Ulm;1972 慕尼黑奥运视觉系统与象形符号;**Rotis** 字体家族 1988,四个变体 serif / semi-serif / semi-sans / sans,至今 bulthaup 在用)。
它产出的不是版面,是**器物**。判断标准也不是"好不好看",而是三个能逐元素查的问题:**这个颜色表示什么?这个尺寸是 4 的几倍?这个东西能不能按?**

## Colors

**规则先于色值:每个颜色都必须能写出一行职责,写不出来的删掉。**

- **shell (#F0EDE5)**:机身白,微灰微暖,全部底色——是**灰**不是纸白,这是它的底子。
- **ink (#2B2B29)**:文字与图标,配 shell 12.1:1。层级靠字号与字重,不靠变浅。
- **muted (#8A8A87)**:**非文字元素专用**——分隔加重、开关轨道、禁用态、图标次级笔画。⚠ 配 shell 只有 2.96:1,**任何字号都不达标**,所以它不承载文字;次级文字一律用 ink 降字号/降字重,这正是 Rams 的做法。
- **signal (#C02820)**:**信号红,只标"可按 / 正在发生 / 出错"三件事**,配 shell 白字 5.0:1。一屏最多一处——有两个红点就等于没有信号。
- **ciel (#7FB2D4)**:慕尼黑浅蓝,用于**中性状态标记**(标签、信息提示、选中态底),配 ink 6.2:1 可承载文字。它永远不表示"可按"。
- **line (#D6D2C8)**:1px 分隔线与输入框边。
- **1972 的「去政治」色板**:Aicher 为慕尼黑奥运定的浅蓝/绿/银/橙里**刻意不放红与黑**(避开 1936 年的联想),主色定为"非政治的浅蓝,和平的颜色",整套色相取自巴伐利亚阿尔卑斯。**这说明色板是可以被决定出来的**——先写清每个颜色的职责与禁忌,再选色值。本档就照此写。
- ⚠ 出处如实标注:Braun 的三个色值来自二手聚合站点、不是官方色卡;慕尼黑 1972 的官方 hex 规范未找到,`#7FB2D4` 是按文献定性描述校准的值。

## Typography

- 标题 Rotis Semi Sans 600 / 26px——**标题不大**。这套风格里标题是标签,不是海报字。正文 Rotis Sans 400 / 15px,行距 1.55,行宽 68ch,信息密度可以高。
- 小标签走**等宽**(IBM Plex Mono)500 + 0.06em:参数、单位、编号、状态码一律等宽,数字要能上下对齐——这是仪表盘的基本要求,也是这套的签名细节。
- 标题正文反差只有 26/15 ≈ 1.7 倍。**反差小是故意的**:器物界面靠位置与分组分层,不靠字号轰炸。

## Layout

- **4px 栅格无例外**:所有间距、尺寸、位置都是 4 的整数倍;控件高度只有 **32 / 40 / 48** 三档。这条最容易破也最该守——出现一个 13px 就说明有人在凭手感调。
- 12 列网格、齐左;标签在控件上方或左侧,固定一种、全站不混用。分组用 16px 间距 + 一条 1px line,不用卡片套卡片。图片 3:2 灰度硬裁,不加圆角不加影(它是资料,不是装饰)。

## Elevation & Depth

`shadow` 模式,但**极薄**,而且带一条硬规则:

1. **Level 0**:shell 底 + 1px line 分区。不可操作的区域**一律无影**。
2. **Level 1**:`0 1px 2px rgba(0,0,0,.10)`——**只出现在可操作元件上**(按钮、开关、可点卡片)。

**这条规则本身就是信息:有影 = 能碰。** 于是阴影从装饰变成了功能编码,用户不读文案也知道哪里能按——和信号红是同一套逻辑的两个通道。
没有 Level 2:弹层用 1px 边 + shell 底解决,不靠加厚阴影。
Don't:大投影、多层投影、玻璃拟态、渐变高光、外发光聚焦环(聚焦用 `border.emphasis` 2px signal 描边解决)。

## Shapes

- 圆角只有两档:`sm 2px`(按钮、输入框、标签、状态点)与 `md 4px`(卡片),**没有第三档**。2-4px 的倒角是**注塑件脱模的痕迹**,不是"柔和一点",所以它小到几乎看不见才对。
- 描边 1px 全站统一,强调态(聚焦/选中)2px。允许的形:矩形、圆角矩形(2/4px)、正圆(仅状态点与旋钮)、等宽线段。图标走线性、**1.5px 等宽笔画**、平头端点、直角:**要像仪表符号,缩到 16px 仍可辨**。

## Components

- **主按钮**:signal 实底 + shell 字 + 2px 圆角 + Level 1 薄影,40px 高,**一屏一个**。**次按钮**:shell 底 + 1px line 边 + ink 字,同 40px;它同样有薄影,因为它也能按。
- **输入框**:shell 底 + 1px line 边,40px 高;聚焦 = 边框换 2px signal,不加发光。**卡片**:shell 底 + 4px 圆角 + 1px line;**可点的卡片才加薄影**,纯展示卡不加。
- **开关**:40×24 轨道,关 = muted,开 = signal;位置变化与颜色变化同时发生。
- **标签**:ciel 底 + ink 等宽小字,24px 高——它是状态不是按钮,**所以不加影**。**状态点**:8px signal 方点,只表示"正在发生"或"有异常"。

## Do's and Don'ts

- Do:**信号色即功能编码**。Rams 的 Braun 产品里颜色只出现在操作点——T3 口袋收音机只有电源键是红的,ET44 计算器只有一个黄色指示。**颜色一旦不表示功能,就该删掉。**
- Do:先写职责表再选色值(见 Colors 里 1972 那段的做法);4px 栅格逐元素查,控件高度只用 32/40/48;等宽字放一切数字与参数。
- Don't:做成瑞士网格的翻版(见下节);用颜色去"好看"——不表示功能就删;让 muted 承载文字(见 Colors)。
- Don't:大投影、玻璃拟态、渐变高光。
- Don't:图标画成插画。图标是符号不是配图。

## 与「瑞士网格」「精密仪表」的分界

**对瑞士网格**——最需要警惕的一对:两者都冷静、都无装饰,但目标物不同。瑞士网格是纸白底 #F4F3EF、圆角恒 0、一律禁影、8px + 列网格,重点在**版面构成**;这一套是**灰**机身白 #F0EDE5 + 中灰 #8A8A87、**2px/4px 两档倒角**、**1px 薄影且只在可操作元件上**、**4px 栅格无例外**(控件高 32/40/48),重点在**器物的可操作感**。
一句话:**它产出的是控件,瑞士网格产出的是版面。** 交付物若是一张海报或一页文章,选瑞士网格;若是一台机器的面板,选这一套。

**对精密仪表**——同为「工具产品」档,4px 单位与小圆角几乎一样,分界在三处:①底色**冷白 #FAFAFA 对暖灰 #F0EDE5**;②强调是**蓝**(链接与主操作,可反复出现)对**信号红**(只标可按/正在发生/出错,一屏一处);③精密仪表 `elevation: flat` 完全无影、层次靠发丝线与密度,这一套**用 1px 薄影编码"能碰"**。
选法:做**屏幕原生的数据密排**(表格、日志、指标墙)用精密仪表;做**一台机器的操作面板**(少量控件、每个都要一眼看出能不能按)用这一套。

## Composition

- 一屏一任务:主控件居左上,参数区成列排下,状态区固定在同一位置。
- 视觉重量分布均匀,不做戏剧性焦点——唯一的焦点是那处 signal 红。配图走 3:2 灰度实拍(器物、结构、剖面),不用插画、不用氛围图。
- 版面里可以出现刻度、编号、单位;它们是内容不是装饰,一律等宽字。

## Image Prompt Templates

- base: "Ulm School functional design, industrial product interface, warm grey machine-white housing (#F0EDE5), near-black type (#2B2B29), one single signal red accent used only on the active control (#C02820), pale Munich blue status tag (#7FB2D4), strict 4px modular grid, tiny 2-4px corner radii, 1px hairlines, extremely thin 1px shadow only under interactive parts, Braun product aesthetic, Otl Aicher pictogram system, monospaced technical labels and numerals, flat, matte, no gradient"
- negative: "large soft shadow, glassmorphism, gradient glow, neon, decorative color, illustrative icon, hand-drawn, gold, pill-shaped button, big rounded corners, 3D render, glossy plastic, lens flare, colorful dashboard"
- 注:模型默认会给"现代 SaaS 仪表盘"(紫蓝渐变、大圆角、彩色图表),提示词必须写 "matte, no gradient, monochrome except one red";出图后按三条指标验收:**颜色是否都能说出职责 / 尺寸是否都是 4 的倍数 / 有影的地方是否都能按**。
