# 浏览器基础能力(chrome-devtools MCP)— 接入与运维

[English](../BROWSER.md) · 简体中文

> 群 agent 需要开浏览器、登录网站账号、做长时间重度页面操作。方案:**常驻 Chrome + CDP 连接**,codex / claude 两侧 MCP 同源连同一实例 —— 登录一次永续、每轮免冷启动;控制台「浏览器」页经同一个 CDP 端口把画面推给人远程接管(见「远程接管」)。

## 架构(一屏)

```
launchd: com.sbot.chrome ──► 常驻 Chrome(headed,KeepAlive)
        --user-data-dir=~/.sbot/chrome-profile   ← 登录态唯一落点
        --remote-debugging-port=9222(仅 localhost)
                    ▲                       ▲
   codex 每轮 spawn MCP ──CDP──┘             └──CDP── claude 每轮 spawn MCP
   (~/.codex/config.toml)                   (~/.claude.json,用户级)
                    ▲
   daemon 控制台 /browser(src/cdp.js)──CDP──┘   截屏推流 + 输入转发 ⇒ 人远程接管(登录 / 验证码 / 扫码)
```

- **独立 profile 是硬要求**:Chrome 136+ 禁止 CDP 挂默认 profile;`~/.sbot/chrome-profile` 与本机个人 Chrome 双实例并存互不干扰。
- **headed 不 headless**:便于人肉首登/扫码/救场/旁观;真实带头 Chrome + 持久 profile 抗反爬也更好。要求机器有 GUI 登录会话(配套:自动登录 + `pmset` 防休眠)。
- **反节流参数必须自带**:MCP 自起 Chrome 时 Puppeteer 会附带,`--browserUrl` 连现成实例就丢了,须写进 launchd 参数(见下),否则窗口被挡/显示器休眠时长任务被节流卡死。
- 代理:Chrome 跟随系统代理,不写死 `--proxy-server`。

## 参考配置

**launchd** `~/Library/LaunchAgents/com.sbot.chrome.plist`(RunAtLoad + KeepAlive):

```
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  --user-data-dir=/Users/me/.sbot/chrome-profile
  --remote-debugging-port=9222 --window-size=1280,720
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding --no-first-run --no-default-browser-check
  --hide-crash-restore-bubble
```

**MCP 两侧同一套 args**(command 钉绝对路径 `/opt/homebrew/bin/chrome-devtools-mcp`,launchd 环境无 brew PATH;包全局安装并钉一个版本,如 `npm i -g chrome-devtools-mcp@1.6.0`,升级手动 —— 不用 `npx @latest`,免每轮过代理查 registry):

```
--browserUrl=http://127.0.0.1:9222
--screenshotFormat=jpeg --screenshotQuality=70 --screenshotMaxWidth=1280
--categoryPerformance=false --usageStatistics=false --allowUnrestrictedPaths
```

`--allowUnrestrictedPaths` 是截图落盘的关键:codex/claude 都不协商 MCP roots,缺它时
`take_screenshot` 的 `filePath` 只准写系统临时目录,写项目目录直接报 Access denied ——
agent 就没法走「截图存项目目录 → `sbot feishu send-image` 发群」的正道(实测 15038px
整页长图 jpeg 仅 168KB,落盘无压力)。

- codex 侧另加 `startup_timeout_sec = 30`、`tool_timeout_sec = 300`(默认 10/60 扛不住长操作)。
- claude 侧对等:provider `env` 加 `MCP_TOOL_TIMEOUT: "300000"`(毫秒)。
- 工具面裁到 26 个(performance 类剔除,extensions/memory 默认关);截图 JPEG 比 PNG 省 3-5 倍上下文。
- 权限:codex 群须完全访问档;claude 群在控制台群卡勾选 chrome-devtools(启用即放行 `mcp__chrome-devtools__*`)。

## 登录 runbook

1. 首登:在这台机器的屏幕(或屏幕共享)上,在 bot Chrome 窗口里逐站登录,落盘即永续;人不在机器旁就走「远程接管」(agent 发一次性链接,手机上做)。⚠ 别让验证码 / 密码在群里接力。
2. **Google 账号坑**:CDP 开着时 Google 登录页可能报「此浏览器不安全」拒登 → 临时去掉 `--remote-debugging-port` 用同 profile 起一次 Chrome 登完,再换回常驻配置。
3. 登录会话过期是常态:agent 发现掉登录会在群里发接管链接,群成员手机上补一次即可;机器旁的 headed 窗口也随时能人工接管。
4. 部分网站换出口 IP 就踢登录 → 在代理工具里给该域名固定出口。

## 截图(尤其长页面)

- **给群里看的截图一律走文件**:`take_screenshot` 带 `filePath`(存项目目录)→ `sbot feishu
  send-image` 发群。贴在回复上下文里又费 token 又未必看得到(文本模型 provider 会把图剥掉)。
- **纯文本模型的群**(provider 标了 `vision:false`,如 glm-5.2):这不是"省点 token"而是硬约束 ——
  不带 `filePath` 的截图到模型那儿只剩一句占位文本,它却会以为自己看过了。标记打上后,
  自知清单会把这条写进 agent 的自我认知(截图必带 filePath、看页面只用 take_snapshot)。
  没标记 = 整轮直接 400 崩(DESIGN §4.3)。
- **长页面加 `fullPage: true`** 一张截全(CDP 原生整页,非拼接);实测 1.5 万像素高无压力。
  特别长/大的图(飞书图片消息 10MB / 分辨率上限)改 `send-file` 发原文件。
- **悬浮元素脏点**:`position: fixed/sticky` 的顶栏/底部导航在整页截图里
  按截图时的滚动位置绘制 —— 页面滚在中间截,底部导航就冻在长图中央。截前用
  `evaluate_script` 处理:
  ```js
  window.scrollTo(0, 0)
  for (const el of document.querySelectorAll('*')) {
    const p = getComputedStyle(el).position
    if (p === 'fixed' || p === 'sticky') el.style.setProperty('position', 'absolute', 'important')
  }
  ```
  (fixed→absolute 后底部导航落回文档流位置;不想要它出现就 `display:none`。截完
  `navigate_page` 刷新即复原,不污染后续操作。)
- 局部细节可用 `uid` 参数截单个元素(与 fullPage 互斥)。
- 默认格式/质量/宽度已由启动 flags 控制(jpeg·70·≤1280 宽),调用时可按需覆盖。
- 极端超长页(> ~1.6 万像素,近 Chrome 纹理上限)再考虑 evaluate_script 滚动分段多张。

## 长时运行保养

- **内存膨胀**:跑几天重活后空闲时 `launchctl kickstart -k gui/$(id -u)/com.sbot.chrome` 重启 Chrome(一秒,登录态在盘不损)。不设自动夜间重启 —— 会误杀夜里跑的批量任务。
- **标签页纪律**:约定 agent 开页用 `new_page`、完事 `close_page`;信息获取优先 `take_snapshot`/`evaluate_script`(文本,便宜),截图只在需目视时用。
- **并发**:每轮各自 MCP 进程、各管各的 tab、CDP 注入不抢 OS 焦点,多群并发基本安全;真互踩再给两侧 args 加 `--experimentalPageIdRouting`(官方多 agent 方案),架构不动。
- **超 2 小时巨活**:拆多轮(浏览器状态跨轮不丢)或 `sbot cron --do` 排夜里;墙钟 `maxTurnTimeMins` **默认 30 分钟**,跑浏览器长作业的机器需在自己配置里调高(比如 120)。

## 故障速查

| 症状 | 查/治 |
|---|---|
| 工具报连不上浏览器 | `curl http://127.0.0.1:9222/json/version`;不通 → `launchctl kickstart -k gui/$(id -u)/com.sbot.chrome` |
| Chrome 没起来 | 机器须有 GUI 登录会话(自动登录);`launchctl list \| grep sbot.chrome` |
| MCP 启动超时 | 确认 `/opt/homebrew/bin/chrome-devtools-mcp` 存在(全局包被清会复发);codex 侧 `startup_timeout_sec` |
| 群里用不了浏览器工具 | claude 群:群卡勾选插件;codex 群:权限须完全访问档 |
| 截图后整轮报 400「Model only support text input」 | 该群用的是**纯文本模型**却没标 —— 控制台「模型 · 库 → 该模型卡 ⚙」勾上「此模型不支持识图」(glm-5.2 等;⚠ 该勾选项只对第三方 provider 显示 —— Claude 走订阅登录面板,全系支持识图故无此项),图片自动降级成占位文本;勾上后 agent 的自知清单也会告诉它「你看不到图,截图必须带 filePath」 |
| 同站多账号需求 | 起第二个 Chrome 实例(不同 profile+端口),按群配不同 `--browserUrl`(未做,按需) |

## 远程接管(控制台的 `/browser` 页)

**为什么要有它**:登录 / 验证码 / 滑块 / 扫码这类**只有真人能做的一步**,没有它时只能在群里一轮轮接力验证码(慢,还会把密码贴进群;
旋转滑块 agent 根本拖不了),或者找机器旁边的人。现在把 bot Chrome 的画面推到控制台,人在手机或电脑上直接点、拖、输入。

**形态**:`/browser` 是独立页面(不加载整份控制台)。上方选标签页,中间是画面(按页面重绘推帧,静止零流量;
手机尺寸约 12 KB/帧),下方输入框 + 回车 / 退格 / Tab / Esc / 方向键;「点按 / 滚动」切换手指动作的含义
(点按模式下拖动就是拖滑块)。输入走 CDP 的受信事件,与真人无异;中文走文本插入,手机输入法可用。

**谁能进**(两扇门,都在 `src/ui/server.js` 那一层裁决):
- **控制台管理员**:直接打开 `<控制台根>/browser`,带自己的令牌。导航栏里暂时没有入口(功能还在完善)。
- **一次性链接**:agent 在群里跑 `sbot browser link --tab <网址片段>`(或管理员在页面上点「接管链接」)签一条
  `<控制台根>/browser#k=<票>`。**票在 URL 片段里**:浏览器不会把它发给服务器 ⇒ 不进 nginx 访问日志,链接预览 / 安全扫描的
  裸 GET 也拿不走;页面读片段后由人点「开始接管」再 POST 兑换成 HttpOnly cookie,票即作废(**只能用一次**)。默认 **10 分钟**
  有效(`browser.takeoverMinutes` 可调,1~60),cookie **只认 `/api/browser/*`**,控制台其它接口一律 401;持 cookie 的人不能再签票、
  不能新开网址;**`--tab` 把票绑在某个标签页上**(对方只看得到、只能操作那一页,推荐总是带)。「退出所有设备」连接管一起吊销。
  签票只认「管理员令牌」或「本机环回 + 不带反代头 + 带 `X-Sbot-Local: 1` 头」—— 自定义头逼出 CORS 预检,本机网页的跨站 POST 到不了。
  链接的根:公网地址 > 局域网地址 > 只绑环回时退成 127.0.0.1(命令会说清「只有这台电脑自己打得开」,别把死链接发进群)。
- 审计(`~/.sbot/audit.jsonl`):签票 `takeover-mint`(含绑定的标签页与 reach)· 用票 `takeover-use`(含第二次被拒)· 每次推流结束
  `takeover-stream`(帧数 / 秒数 / 输入次数)· 主动结束 `takeover-end`。帧内容与输入内容不落盘。
- 多人同看一个标签页:一条推流多人订阅,一帧等所有人写完才向浏览器 ack(慢的那个人决定帧率),最后一人离开才停流。
- **接管者的推流跟着会话走**:自己点「结束接管」/ 管理员「退出所有设备」/ 票到期 ⇒ 服务端当场断掉那路推流(管理员自己的不受影响);
  页面重连撞 401 才翻成「已到期」。不断的话会话作废了画面还在流 —— 输入早已 401,但一张 10 分钟的票能一直看下去。

**页面形态(按「身份 × 阶段」切模式)**:群成员拿到链接先看到**整屏一句话 + 一个按钮**(「机器人请你帮它一把 … 开始接管」),
点了才进接管态;接管态只有那一页的标题(没有标签页下拉、没有新开、没有控制台入口)、画面、「点按 / 滚动」与「结束接管」、键盘;
首帧上飘一句「直接在画面上点、拖;要打字用下面的输入框」,手指一碰就收;状态栏对群成员只说「可以操作了」(尺寸与帧数是排障信息,管理员才显示)。
结束 / 到期 / 无票进来各是一张整屏面板,文案都指回群里(「回群里让机器人重新发一条」),不露服务端那句 unauthorized。
**缩放 / 移动**:bot 那边多半是 1280 宽的桌面页,手机一屏缩到 390 看不清 ⇒ 两指捏合缩放、两指拖动移动(一指仍归页面);模式键三态「点按 / 滚动 / 移动」,
「移动」下一指拖画面、滚轮缩放;桌面 ctrl+滚轮(触控板捏合)缩放;右上角 − / 百分比(点它还原)/ +。只动 CSS transform,坐标换算读变换后的矩形不用改;
放大超过三成就按新尺寸重开推流(画面不清空),否则 780px 的帧放大三倍就糊。⚠ 一指按下延迟 120ms 才发 down:捏合的第二指落在这窗口里就作废,页面不会收到一次误点。

**票优先于浏览器里存着的控制台令牌**:**有票、或人已经在接管会话里,就一律按接管走**(忽略这台浏览器里存着的控制台令牌)——
否则在存过控制台令牌的电脑上点群里的链接会进管理员布局,令牌过期时整页打不开。同一条链接在手机和电脑上完全一致;不带票直接进 `/browser` 的管理员布局不变。
管理员令牌失效时页面自己清掉它并请人重新登录,不再留一个连不上的死页面。
⚠ **延迟实测**(公网隧道 · 电脑尺寸 · 无令牌):隧道往返均值 **254ms** · 滚动到看见画面变化 **544ms** · 点击输入往返 **约 400ms** · 静止 3 秒 **0 帧** · 单帧 **27KB**。
能用,但不是本机手感。
⚠ 两条页面实现的规矩:**提示层 pointer-events:none 后,层里可点的东西要逐个放开**(只放 a 没放 button ⇒ 手指点「开始接管」穿透无反应,
桌面上程序化 click() 测不出);**hidden 属性会被任何一条 display 规则顶掉** ⇒ 全局 `[hidden]{display:none!important}` 兜底。

**agent 侧**:清单里教的是「撞到登录墙 / 验证码 / 滑块 / 扫码 ⇒ `sbot browser link --tab <片段> --send` ⇒ **命令自己把一张卡发进群**
(当前页面截图 + 「接管浏览器」按钮 + 有效期;⚠ 文案不点名手机,电脑上一样能接管)⇒ 让人在手机或电脑上做 ⇒ 登录态留在这边、之后自己接着干;不要在群里要密码或验证码;
登录页用 fill / click 真实输入」。卡片四态由 daemon 翻:有人点「开始接管」⇒「正在接管中」(蓝);点「结束接管」/ 到时 ⇒「接管已结束」(绿);票到期没人来 ⇒「已过期」(灰)。
文案由代码保证(`src/platform/takeovercard.js`,零工具名),不靠 agent 每次现编;截图 / 传图失败卡照发、只是没图。控制台地址由 engine 经
`SBOT_UI_URL` 注入;没开控制台(`sintbot start` 不带 `--ui`)时命令会说清缘由、清单也不教这条。

**配置**(`sbot.config.json` 顶层,可省):`"browser": { "cdpUrl": "http://127.0.0.1:9222", "takeoverMinutes": 10 }`。
`sintbot doctor` 多一行 `browser`:探到 ok;探不到且配了 browser 段才 warn。

**代价与边界**:通行密钥(要本机指纹)接管也做不了;扫码要人在电脑上看页面、拿手机扫。画面经公网走的是控制台
现有的隧道与 HTTPS;链接被转发给第三者的风险靠「只能打开一次 + 短命」兜住,发之前仍要确认对方是谁。
实现:`src/cdp.js`(CDP 客户端 + 推流 + 输入翻译)· `src/ui/takeover.js`(票据 / cookie)· `src/ui/browserroutes.js`(接口)· `src/ui/browser.html`(页面)。

## 安全口径

9222 仅绑 localhost,但本机任意进程可经它操控已登录浏览器 —— 单人专机可接受,勿在共用机器复制此方案;bot Chrome 里只登工作所需账号。`--allowUnrestrictedPaths` 同理:MCP 文件写入(截图落盘)不受路径围栏,依赖的是「群 agent 本就对本机有执行权」这一前提。
