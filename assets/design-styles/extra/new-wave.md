---
name: 新浪潮
description: 精确计算过的失序——阶梯式错位、极端字距并置、洋红与青的套印重影,瑞士网格的叛逆版
suits: "活动推广 · 内容阅读"
colors:
  ground: "#E9E6DF"
  ink: "#141414"
  accent: "#E6007E"
  cyan: "#00AEEF"
  silver: "#B9BCC0"
  muted: "#57544E"
  line: "#141414"
fonts:
  latin: "'IBM Plex Sans'"
  cjk: sans
typography:
  headline:
    latin: "'Archivo', 'Univers', 'Helvetica Neue'"
    fontSize: "54px"
    fontWeight: 700
    lineHeight: 1.0
    letterSpacing: "-0.03em"
  body:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    measure: "60ch"
  label:
    latin: "'IBM Plex Mono', 'Noto Sans Mono CJK SC'"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.24em"
border:
  width: "1px"
  style: solid
  emphasis: "1px"
rounded:
  none: 0px
spacing:
  unit: "4px"
  gutter: "16px"
  margin: "32px"
  maxWidth: "1100px"
  columns: 12
elevation:
  mode: flat
  levels: "0"
imagery:
  ratio: "3:2"
  treatment: halftone
  crop: hard
icon:
  style: line
  strokeWidth: "1px"
  linecap: butt
  corner: sharp
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "40px"
    padding: "20px"
  tag:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    height: "24px"
  card:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "24px"
---

## Overview

参照物:**Wolfgang Weingart** 1972-73 年在巴塞尔设计学院为《Typografische Monatsblätter》做的 **15 张封面**(银墨、阶梯式挖空、字距与倾斜实验)。当时它被视为对瑞士现代主义原则的公然冒犯,因而得名 **Swiss Punk**;他的美国学生 **April Greiman** 与 Dan Friedman 把它带回美国,定名 New Wave。
Greiman 1986 年为 Walker Art Center 做的《Design Quarterly》133 期《Does It Make Sense?》—— 把 32 页刊物改成 2×6 英尺的双面折页,用 Macintosh 加 MacDraw 完成,被视为第一件全数字印刷设计,现藏 MoMA。同期的 **Emigre** 杂志(Rudy VanderLans + Zuzana Licko,1984-2005 共 69 期,MoMA 藏;出品 Matrix 1986、Template Gothic 1990)把这套语言变成了一代人的字体与版式底本。
一句话:**它是精确计算过的失序** —— 网格还在,只是被故意撬开了两处。

## Colors

- **ground (#E9E6DF)**:纸灰底。这个风格从印刷来,底色必须有纸的温度;**ink (#141414)** 是文字与线,14.8:1,正文永远是它。
- **accent (#E6007E)**:洋红。**实测 ground 上 3.64:1 ⇒ 仅限 ≥24px 大字**,做色块、标题、重影层。
- **cyan (#00AEEF)**:⚠ **装饰专用**。ground 上只有 **2.05:1** —— **绝不做文字色**,只能做色块、网点、线。这条不是建议,是硬规矩。
- **silver (#B9BCC0)**:银墨的替身,做底层的大面积浅色块与网点(Weingart 的 TM 封面正是银墨印的)。
- **muted (#57544E)** 次级文字 / 图注(6.2:1);**line (#141414)** 发丝线与规矩线,1px。
- 洋红 × 青重叠处会压出深紫蓝 —— 那是**套印**的结果,允许;但**不许直接画一条紫蓝渐变**。

## Typography

- 标题 Archivo / Univers 700,-0.03em,行高 1.0 —— 紧、方、冷,底子仍是瑞士的。
- 正文 IBM Plex Sans 400,16px / 1.6,**永远左对齐**;小标签 IBM Plex Mono 500 + **0.24em** 字距、全大写,做编号、栏目名、日期。
- **签名细节 ②:字距的极端并置** —— 同一版面里既有 -0.03em 的紧排大标题,又有 0.24em 的稀排小标签。中间值越少,张力越强。
- 允许单个词被拉开字距顶满一行,允许某个词换成洋红,但**同一段文字里不换两次**。

## Layout

- 12 列网格立着,栏线是**看得见的参与者**:可以直接把 1px 线画出来,让读者看到规矩的存在。
- **spacing.unit = 4px**(不是 8px)。这个风格的精度在小刻度上:1-2px 的错位是可见的手法,8px 栅格太粗,错位会变成"排错了"。
- **签名细节 ①:阶梯式错位** —— 多行标题按行逐级横移一个**固定量**(如每行 +24px),形成楼梯。移动量全站复用同一个数,不能这行 17px 下行 23px。
- 破格只发生在指定位置:一处越栏、一处极端字距,其余严格守网格;倾斜用 ≤10° 的整数角度,一版最多一处。

## Elevation & Depth

`flat` —— 没有投影,也没有 z 轴。深度来自印刷的三种手段:

1. **半透明色层**:洋红 / 青的色块以 `mix-blend-mode: multiply` 叠在图与字上,重叠区自动变深。
2. **半调网点层**:大面积浅色块换成网点(40-60%),它比实色轻,能压在文字下而不吃掉文字。
3. **文字 / 图片的"重影"**:同一元素错位 4-8px 复制一层,用另一色(洋红或青),模拟套印没对准。⚠ 错位量取 **4 / 8** 两个固定值,不随手拖。

**签名细节 ③** 就落在 2 与 3 上:洋红与青分离产生的套印重影 + 网点层,是这套语言最快的辨认点。
Don't:`box-shadow`、渐变、玻璃模糊 —— 任何"浮起来"的东西都不属于这里。

## Shapes

- 圆角全 0;描边 1px,端点 butt,直角相交;图标是**线性**的,不是实心。
- 词汇:细线、矩形色块、网点面、被切断的圆、箭头、坐标刻度式的短线组。
- 图片 3:2 硬裁 + 半调网点处理;允许把图切成两三条横带错位重排。
- 允许元素部分出血、部分被裁掉一个角 —— 但**只能一处**。

## Components

- **主按钮**:ink 底 + ground 字 + 直角 + 等宽稀排标签体;hover 换洋红底。
- **标签**:ground 底 + 1px ink 边,极稀字距的编号与栏目名,成排出现像目录。
- **卡片**:ground 底 + 1px 线框,**允许内容越出框边 4-8px**(这是这个风格的"破格点"之一)。
- **输入框**:直角 + 只画下边线(像稿纸);聚焦态 = 底线换洋红并加粗到 2px。

## Do's and Don'ts

- Do:一版只挑 **1-2 个破格点**(一处越栏 + 一处极端字距),其余严格守网格 —— **失序是调味,不是主食**。
- Do:错位量取固定值(4 / 8 / 24px),全站复用同一组数;角度也只用一个值。
- Do:正文永远回到左对齐、≥16px、行高 1.6 —— **Weingart 从没牺牲过正文可读性**。
- Do:cyan 只做色块 / 网点 / 线,洋红只做 ≥24px 大字与块面(对比度实测见 Colors)。
- Don't:随机旋转、随机位置、随机字号 —— 这是 AI 最容易犯的错,见下节。
- Don't:把整段正文做成实验对象(倾斜、字距拉开、彩色底)。
- Don't:紫蓝渐变。紫只能是洋红叠青**压**出来的,不能是拉出来的。
- Don't:投影、圆角、玻璃感。

## 怎么做才不像"随机乱排"

这个风格最容易被做坏,且做坏的方式只有一种:**用随机冒充实验**。
Weingart 的每一张封面都能画出网格与位移量 —— 他是在**已知规矩**的前提下精确地破一处;新手与模型做出来的是每个元素都歪一点、每处字距都不同,看着像文件损坏。四条硬约束:

1. **先把规矩版排出来**(严格网格、统一字距),再挑 1-2 处破格,破格点要能说出理由。
2. **所有位移量来自同一组数**(4 / 8 / 24px),所有角度来自同一个值。数值一多就是随机。
3. **正文不参与实验**:实验只发生在标题、图注、装饰层、色块。
4. **每处失序都留下"原本该在哪"的证据** —— 越栏的元素旁边保留那条栏线,重影下面保留没错位的那一层。看得见参照,失序才读作故意。

**与「复古印刷」(Riso)分界**(不点破就会被做成一个样):两者都有"套印错位",但 **Riso 的错位是工艺限制**(两色油墨、纸感、网点),核心在**油墨**;**新浪潮的错位是故意失控**,核心在**排版结构被拆解**。判据:把颜色全换成黑白 —— Riso 会失去大半魅力,新浪潮不会,因为它的手法在版式里。**与「瑞士网格」**:同一个爹,瑞士是守规矩的那个,新浪潮是知道规矩之后故意破一处的那个;破格超过两处,它就既不是瑞士也不是新浪潮,只是乱。
⚠ 如实标注:纯正的**产品级**当代实例很少,这套语言主要活在设计工作室官网、音乐 / 文化活动页与出版物里 —— 拿它做后台系统或电商详情页会翻车,选它之前先确认场合。

## Composition

- 活动页:一个阶梯错位的大标题 + 一张网点化的 3:2 图 + 一条看得见的栏线 + 一组稀排等宽小字。
- 内容阅读:严格的双栏正文,实验全部让给标题区、图注与页边的装饰层。
- 版面允许留一大块空 —— 破格之所以读得出来,是因为周围足够安静。

## Image Prompt Templates

- base: "Swiss punk new wave graphic design, Weingart and April Greiman influenced, warm grey paper background (#E9E6DF), black text with magenta (#E6007E) and cyan (#00AEEF) overprint offset by a few pixels, halftone dot layers, stepped staircase offset headline lines, extreme letter-spacing contrast between tight display type and very wide tracked mono labels, visible 12-column grid lines, one element breaking the grid, flat print aesthetic, 1980s Basel typography experiment"
- negative: "random rotation, chaotic scattered elements, drop shadow, gradient, purple blue gradient, rounded corners, 3D, glossy, centered symmetric layout, tilted body text, grunge texture"
- 注:必须写 "everything on a strict grid except one deliberate break",否则模型会理解成"乱排";位移量写死("consistent 8px offset");紫色只能通过 "magenta over cyan overprint" 出现。中文版面补 "clean CJK sans-serif, left aligned body text"。
