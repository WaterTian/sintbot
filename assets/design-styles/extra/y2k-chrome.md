---
name: 千禧未来
description: 液态铬字、果冻高光与 Bondi 蓝——1998-2002 那种半透明塑料的乐观未来感,克制着用才好看
suits: "活动推广 · 生图插画"
colors:
  ice: "#E6F2F7"
  steel: "#2A3340"
  accent: "#0095B6"
  citrus: "#FF6A00"
  magenta: "#FF2E9A"
  chrome: "#C7D2DB"
  muted: "#5F7183"
  line: "#9FB3C0"
fonts:
  latin: "'Rubik'"
  cjk: sans
typography:
  headline:
    latin: "'Eurostile', 'Michroma'"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.06em"
  body:
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
    measure: "62ch"
  label:
    latin: "'Share Tech Mono', 'Noto Sans Mono CJK SC'"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.10em"
border:
  width: "1px"
  style: solid
  emphasis: "2px"
rounded:
  sm: 8px
  md: 12px
  pill: 999px
spacing:
  unit: "8px"
  gutter: "24px"
  margin: "32px"
  maxWidth: "1120px"
  columns: 12
elevation:
  mode: shadow
  levels: "2"
imagery:
  ratio: "4:3"
  treatment: duotone
  crop: rounded
icon:
  style: solid
  strokeWidth: "2px"
  linecap: round
  corner: round
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ice}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "20px"
  button-secondary:
    backgroundColor: "{colors.chrome}"
    textColor: "{colors.steel}"
    rounded: "{rounded.pill}"
    height: "44px"
  tag:
    backgroundColor: "{colors.citrus}"
    textColor: "{colors.steel}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "26px"
  card:
    backgroundColor: "{colors.ice}"
    textColor: "{colors.steel}"
    rounded: "{rounded.md}"
    padding: "24px"
---

## Overview

参照物:**The Designers Republic**(Ian Anderson 1986 年在谢菲尔德创立;Warp Records 的 globe 标与 "Warp purple"、LFO / Aphex Twin / Autechre 的封套、1995 年 WipEout 的全套游戏美术);
**iMac G3 Bondi Blue**(1998,Jonathan Ive 领衔的苹果工业设计组,半透明聚碳酸酯外壳;Bondi Blue ≈ #0095B6,名字取自悉尼 Bondi 海滩的水色);**Apple Aqua**(2000,Jobs 说"设计目标就是让你看到它就想舔一口");当代实现看 Poolsuite FM(poolsuite.net)—— 复古壳里装真功能,这条路上做得最扎实的一个。
一句话:**光打在物体表面上**。铬是抛光的、按钮是果冻做的、蓝是海水的青绿蓝,不是紫。

## Colors

- **ice (#E6F2F7)**:冰蓝白底,比纯白更有塑料透光感;**steel (#2A3340)** 是主文字色,ice 上 11.2:1 —— 这个风格不用纯黑,纯黑不反光。
- **accent (#0095B6)**:Bondi Blue,整套风格的身份色,按钮 / 链接 / 主图形都归它。
- **citrus (#FF6A00)** / **magenta (#FF2E9A)**:对冲色。青绿蓝要有橙和品红顶着,才不塌成"科技蓝页面"。
- **chrome (#C7D2DB)**:铬的基色,只做渐变与高光的底,不当色块;**muted (#5F7183)** 次级文字(4.4:1);**line (#9FB3C0)** 1px 分隔线,比文字轻两档。
- ⚠ 三支彩色**同屏最多两支**,且面积比要悬殊(一支大面积、另一支只做点缀)。

## Typography

- 标题 Eurostile / Michroma,700,**正字距 0.06em** —— 这个风格的字是拉开的,不是挤的(与酸性荧光正相反,这是它们最快的辨认点)。
- 正文 Rubik 400,16px / 1.6。Rubik 的圆角末端与果冻按钮同源,但正文不做任何特效。
- 小标签走等宽 Share Tech Mono + 0.10em,做编号、状态、"SYSTEM READY" 这类仪表感文字。
- 标题与正文 3 倍反差(48/16);标题可全大写(拉丁),中文标题靠字重与字距撑。

## Layout

- 12 列网格,面板化布局:内容装在有边框的"窗口"里,窗口有标题条、有状态栏。
- 允许一层嵌套面板(外壳 + 内屏),**不许第三层** —— 再套就是控制面板不是设计。
- 大圆角只给面板(12px),小圆角给输入框(8px)。⚠ **`pill` 只给按钮与标签,不许污染面板** —— 整块面板做成胶囊,立刻变成 2015 年的卡通 app。
- 半透明是允许的(白色 `rgba` 10-20% 叠在色块上),但它是**塑料的透光**,不是玻璃的折射:不加背景模糊。

## Elevation & Depth

深度来自**表面反射**:物体是有厚度的塑料,光从左上打下来。

1. **Level 0**:ice 底。**Level 1**(卡片 / 面板):`0 6px 16px rgba(0,120,150,0.22)` —— 阴影带蓝味,不是灰。
2. **Level 2**(按钮 / 悬浮件):同上再叠内高光 `inset 0 1px 0 rgba(255,255,255,0.80)`。这行 inset 就是"果冻"的全部秘密:上沿有一道白,元素立刻鼓起来。

**三个签名细节**(这个风格好不好看,全在这三处的克制上):

① **液态铬字** —— 字面被多段明暗渐变切分,中间一条水平明暗分界(上冷下暖),`background-clip: text` 实现,**只用在大标题与图标**。
② **果冻 / 水滴按钮** —— 上半强高光、下半淡影、边缘 1px 白描边,按下时高光收窄。
③ **四角星形闪光与镜头光晕** —— **每屏 ≤2 处**,只落在铬物件或主图的边角上。

Don't:铬渐变用在正文或小字(字面被切碎就没法读);阴影用纯灰;背景模糊(那是液态玻璃的语言)。

## Shapes

- 圆角三档:`sm 8px`(输入框)、`md 12px`(面板 / 卡片)、`pill 999px`(按钮 / 标签)。
- 图标实心 + 2px 圆头描边 + 圆角转角 —— 这个风格里没有尖角,尖的东西不像塑料;允许的形状:圆角矩形、胶囊、椭圆、四角星、水滴、同心圆(仪表 / 刻度);图片 4:3 圆角裁切 —— 4:3 是那个年代显示器的画幅,16:9 会立刻当代化。

## Components

- **按钮**:accent 胶囊 + 果冻高光 + 冰白字。⚠ 小字反白要换深一档的底,见下面的对比度实测。
- **次级按钮**:chrome 底 + steel 字 + 1px 白内高光;**标签**:citrus 胶囊 + **近黑字**(不是白字),做状态与分类。
- **面板 / 卡片**:ice 底 + 1px line 边 + 12px 圆角 + 蓝味投影,可带一条标题栏。
- **输入框**:8px 圆角 + 1px line 边;聚焦态 = 边框换 accent + 外发光 `0 0 0 3px rgba(0,149,182,.25)`。

## Do's and Don'ts

- Do:**对比度实测值照着用** —— `#0095B6` 上白字只有 **3.56:1**(仅够 ≥18px 大字);小字要反白,把底压到 **#007391(5.5:1)**。
- Do:`#FF6A00` 上必须用近黑字(**6.4:1**);白字在它上面只有 **2.9:1**,是错的。`#FF2E9A` 只做大字与点缀,别承载正文。
- Do:半透明塑料感靠"白色 inset 高光 + 轻微透光",不靠加模糊。
- Don't:**紫蓝渐变**。那是 AI-slop 的签名,不是 Y2K —— **Y2K 的蓝是青绿向的 Bondi / 冰蓝,用橙与品红对冲**。想加第二个颜色时往暖色走,别往紫走。
- Don't:满屏光晕 + 闪光 + 噪点 + 铬字全上(TDR 的克制才是这风格好看的原因)。
- Don't:`pill` 用在面板上;三层以上嵌套面板;纯黑与纯白大面积出现。

## 怎么做才不像廉价怀旧贴图

图库里的"Y2K"通常长这样:紫蓝渐变 + 满屏星光 + 液态铬字堆到正文 + 随机 3D 环形。
那是**素材包**不是设计。TDR 的封套现在还耐看,靠的是**克制**:一版里通常只有一个铬物件、一组网格化的数字标签、一两块高饱和色。四条硬约束:

1. **签名细节每屏 ≤2 处**(铬字 / 闪光 / 光晕合计),其余地方老老实实排版。
2. **蓝必须是青绿向**(#0095B6 这类);偏紫的蓝一出现,整屏立刻滑进 AI 通稿。
3. **正文区零特效**:16px / 1.6 / steel 字 / 无渐变无发光。特效只发生在标题、按钮、图形。
4. **画面里要有真信息**:编号、日期、版本号、状态词 —— TDR 的画面永远像一台设备的说明,不是装饰。

**与「酸性荧光」分界**:酸性是灰白纸底 + 荧光二次色 + 2px 硬黑边 + 零模糊,平的、贴纸式的;千禧是冰蓝底 + 金属反射 + 柔高光与投影,鼓的、有厚度的。酸性挤字,千禧拉字距。
**与「液态玻璃」分界**(最容易混的一对):**千禧是不透明的金属反射 + 高饱和(光打在物体表面上);液态玻璃是透明层 + 折射模糊 + 中性色(光穿过物体)**。一个像抛光的铬与塑料,一个像磨砂玻璃片。判据很简单:**背后的东西能不能透过来看见** —— 能就是玻璃,只有反射就是千禧。

## Composition

- 活动页:一个铬质大标题 + 一块 Bondi 蓝主视觉(4:3 圆角图)+ 一排等宽小标签 + 一个果冻按钮;重心稳定,元素排成有秩序的网格 —— 未来感来自"被设计过的设备",不是来自混乱。
- 插画 / 生图:半透明塑料机身、水滴、同心圆刻度、悬浮的圆角矩形屏,背景是青绿向的冰蓝渐层。

## Image Prompt Templates

- base: "Y2K futurism design, translucent polycarbonate plastic and polished chrome, Bondi blue (#0095B6) and ice blue (#E6F2F7) palette with orange (#FF6A00) accents, glossy jelly buttons with white inset highlight, liquid chrome lettering with a horizontal light-dark split, soft blue-tinted drop shadows, wide-tracked squarish techno sans-serif type, 4:3 framing, one four-point star sparkle, 1999 Apple iMac and WipEout aesthetic, clean and restrained"
- negative: "purple to blue gradient, violet, matte flat design, grunge texture, heavy noise, chrome text on body copy, dozens of sparkles, frosted glass blur, 16:9 widescreen, dark mode"
- 注:一定要写 "restrained, only one chrome object, at most two sparkles",否则模型会把闪光铺满;蓝色必须点名 "teal-leaning blue, not purple"。中文版面补 "clean CJK sans-serif with wide letter spacing"。
