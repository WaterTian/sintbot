# SintBot 设计文档

[English](./DESIGN.md) · 简体中文

> 写给要改代码的人:架构、模块边界和关键机制的「为什么」。怎么用见 [README.zh-CN.md](./README.zh-CN.md)(英文 [README.md](./README.md))与 [docs/zh-CN/](./docs/zh-CN/);开发约定见 [CONTRIBUTING.md](./CONTRIBUTING.zh-CN.md)。

## 0. 核心思路

一个 Node 守护进程,把聊天平台(飞书 / Slack / 企业微信)桥接到**无头 Claude Code / Codex CLI**。SintBot 只做**确定性的编排**;所有智能都在它 spawn 出来的 `claude` / `codex` 进程里。

> **保留 agent 框架,只换模型大脑。** 工具、agentic 循环、MCP、skills、项目记忆都是 CLI 自己的;SintBot 只决定这一轮由谁的模型来回答、在哪个目录、带什么权限。

这与 Claude Code 插件相反:插件活在会话**内部**;SintBot 活在**外部**,把 CLI 当子进程驱动,所以不需要人守着交互会话,各家模型在同一套机制下平权。

## 1. 技术选型

| 决策 | 选择 | 原因 |
|---|---|---|
| 语言 | Node.js(≥ 22) | JSON-over-stdio 是 Node 主场;聊天平台官方 SDK 齐全 |
| 驱动 CLI | stream-json / `--json` over stdio | 不走 PTY 抓屏,也不嵌 SDK —— CLI 升级时改动面最小 |
| 进程模型 | **每轮 spawn + 续接会话** | 没有长命子进程要管,崩一轮不影响下一轮;代价是每轮 1–2 秒冷启动 |
| 换模型 | 给 `claude` 注入 Anthropic 兼容端点的 env | GPT 不兼容这套协议 ⇒ 走第二个 runner(`codex exec`),见下 |
| 平台连接 | 全部**只出站**:飞书长连接 · Slack Socket Mode · 企业微信长连接 | 不需要公网入口、零空闲成本 |
| 状态 | JSON 文件 + 原子写(`store.js`) | 单机够用,崩溃安全 |
| 常驻 | `sbot service`:macOS launchd · Linux systemd 用户服务 | Windows 只打印 NSSM / pm2 命令 |

- **每轮怎么跑**:`claude -p … --resume <sid> --output-format stream-json`,从首个 `system/init` 事件拿到会话 id 存下,下一轮续接;codex 同理(`codex exec … resume <thread_id> --json`,见 [docs/CODEX-RUNNER.md](./docs/zh-CN/CODEX-RUNNER.md))。
- **GPT 为什么走 codex 后端**:另写一个 runner 直接跑官方 `codex exec`,用的是原生协议、零翻译损耗,认证就是本机的 ChatGPT 订阅;把 GPT 经协议翻译代理塞进 `claude` 虽然能复用全部机制,但推理 + 工具 + 流式叠在一起时保真度打折,还要单独的平台 API key。代价是 codex 群的权限只有两档沙箱(§4.1)。
- **长会话压缩**:续接的会话历史只增不减。每轮把 `agent.autocompactTokens`(默认 40 万,0 = 关)交给 runner:claude 翻成 `--autocompact`,codex 翻成 `-c model_auto_compact_token_limit=`,超限由 CLI 原地压缩,会话 id 不变。
- **token 记账**一律记**本轮增量**;codex 报的是会话累计值,runner 声明 `usageCumulative` 后由 store 按基线求差(core 不认 runner 名)。

**模型**(确切端点、model id 和每家的调优 env 以 [sbot.config.example.json](./sbot.config.example.json) 为准):

| provider | 方式 | 说明 |
|---|---|---|
| `claude` | 订阅登录 | 不填端点也不填 key;model 不写 = 跟随 CLI 默认 |
| `glm` / `deepseek` / `minimax` / `volcano` | Anthropic 兼容端点 + API key | GLM-5.2 两个预设带 `vision:false` |
| `codex` | `runner:"codex"` | 本机 `codex login` 的 ChatGPT 订阅;也是 claude 额度用完时的默认备用 |
| `gpt` / `kimi` | 隐藏模板 | 翻译代理路线([docs/GPT-ROUTER.md](./docs/zh-CN/GPT-ROUTER.md))/ 在控制台「自定义」里加 |

第三方模型的工具调用质量普遍不如 Claude,provider 用 `toolQuality` 标注;`--effort` / thinking 常被非 Claude 端点忽略。

## 2. 架构与模块边界

```
bin/sbot.js                CLI 入口与接线(setup / start / ui / doctor / service / 基础技能子命令 …)
src/config.js · health.js · service.js   配置加载与校验 · doctor 与控制台共用的健康检查 · 常驻服务单元
src/installdeps.js         setup 替新用户装 claude / codex(npm 源连不上换镜像);仓库根目录 install.sh 是一键安装入口
src/setupmodels.js         setup 模型步的规则:推荐顺序(Claude 订阅 → Codex → DeepSeek)、各家拿 key 的地方与国际站端点、试跑失败的人话
src/core/                  —— 只认接口,不认具体平台与模型 ——
  interfaces.js            Platform / AgentRunner 契约(类型说明)
  engine.js                消息路由、每群会话 / 锁 / 队列、去重与水位线、斜杠命令、自知清单
  store.js · ledger.js · redact.js     原子 JSON 状态 · 每轮一行的账本(turns.jsonl)· 出站脱敏
  scheduler.js · cron*.js              定时任务:调度 / 时间语法 / 到点动作 / 跑脚本
  pending.js · instancelock.js         被掐断轮次的重做 · 单实例锁
  quota*.js · opsalert.js              额度告警与重置时刻 · 运维告警群
  time.js · proxy.js · issues.js · mdtable.js   时区口径 · 出网代理 · 群内反馈本 · 表格识别
src/agent/
  claudecode.js · codexcode.js · runner.js     两个 AgentRunner · 按 provider.runner 派发
  visionproxy.js · winexec.js                  文本模型图片降级 · Windows 可执行解析
  quotaerr.js · transienterr.js                「换模型才有用」与「过一会儿再来」两类错误的判据
  *status.js · claudeusage.js · claudemodels.js   登录态 · 订阅额度 · Claude 型号候选
  imagen.js · askonce.js                       生图桥 · 一次性问模型(不起 CLI、不带会话)
src/platform/
  feishu.js · slack.js · wecom*.js · wswatchdog.js   三个平台适配器 · 飞书长连接看门狗
  multi.js · cli.js                            多个平台合成一个 Platform · 终端里驱动引擎的桩平台
  board*.js · takeovercard.js                  飞书画板 · 接管浏览器卡片
src/ui/                    控制台:server.js(HTTP + REST + SSE)· console.html / browser.html(自包含单文件)· dashboard.js(「需要你处理」与账本回填)· 鉴权与会话
src/*.js                   设计风格档 · 预览服务 · 插件 · 仓库关联 · 项目根围栏 · 项目记忆 · 遗留进程 · 升级播报 · 用量 · CDP
```

**纪律:`core/` 绝不按名字引用具体平台或模型。** 平台用几个自描述字段告诉引擎差异(`skillCmd` 基础技能命令名、`features` 哪些能力没有、`chatLabel` 怎么称呼群),runner 用契约旗标(如 `usageCumulative`);加一个平台或后端 = 新增一个满足契约的文件,引擎不动。凡是要碰文件系统、git、具体 CLI 行为的判断,都由 bin 注入读取器,core 只判断与打印。

## 3. 消息流

```
平台事件 → 适配器归一化 → InboundMessage{chatId, userId, text, msgId, media, ts}
  → multi 把各平台汇成一个入口(出站按群路由回所属平台)→ engine
  → 去重(msgId)+ 丢弃早于启动时刻的消息 + 水位线(丢陈旧重投)
  → 斜杠命令(/model /new /stop /skip /status /hud /issue /help)就地处理
  → 每群锁:忙 ⇒ 入队并回「已排队」;出队时把攒下的多条合成一个批量 prompt
  → 取该群的 provider / workdir / 会话 id;自知清单有变化才注入
  → runner.runTurn → 归一化事件流
  → 懒建卡(首个不可能是 NO_REPLY 的输出才建)+ 累积更新;每条退出路径都收尾
  → 落盘会话 id、推进水位线、记账、派发下一条
```

一群一会话,群成员共享。**水位线只归平台消息**:定时任务、画布按钮这类合成消息用本机时钟,和平台服务器时钟混推会吞掉真人消息,所以整体绕开。

## 4. 子系统

### 4.1 runner 与权限(无人审批的头号风险)

- 无头运行时没有人点「允许」,所以**策略驱动、绝不挂起**。claude 用 `--permission-mode dontAsk` + 每群的 `allowedTools` / `disallowedTools`:白名单内自动放行,其余自动拒绝。由 CLI 框架执行,换模型后端也一致。
- 权限**只按群设**,没有全局白名单。`groups[].permissionMode` 只有两档:`dontAsk`(默认,fail-closed)与 `bypassPermissions`(完全访问);其余模式在无头下会挂起。allow / deny 另有三档预设(只读 / 开发 / 全信任)。
- 子进程 cwd = 该群项目目录,`--add-dir` 也只给这个目录 ⇒ 文件工具锁在项目内;Bash 没有系统级目录围栏,边界靠白名单。**allow / deny 防误操作,不防绕过**,真边界在凭据本身的授权范围。
- 基础技能(§4.6)在任何权限档都放行:`BASE_SKILL_ALLOWS` 追加进每个群的白名单。
- codex 没有逐工具白名单,只有两档沙箱:`read-only`(沙箱里不能联网)/ `danger-full-access`。各平台行为一致起见不用 `workspace-write`。

### 4.2 换模型

- 两个入口:控制台群卡与群里的 `/model <名>`,群成员都能切 —— 模型额度跑满时后端会让人「换个模型试试」,而这时只有群里的人在场。
- **两个入口走同一套写入动作,四件事一起做**:配置落盘 + 运行时覆盖 + 清会话 + 清会话账。漏落盘 ⇒ 重启弹回;漏覆盖 ⇒ 这一轮还用旧的;漏清会话 ⇒ 把 codex 的 thread id 喂给 claude 的 `--resume`,当场坏掉。
- 名字精确匹配(只放宽大小写);`hidden` 的不列也不让切;群里正忙时拒绝并给出下一步。

### 4.3 文本模型的图片降级

不支持识图的模型(provider 标 `vision:false`)收到图片会让整轮 400。SintBot 拦不到 `claude` 与上游之间的请求体,所以在中间接一个**零依赖的本机代理**(`visionproxy.js`):上游地址编进代理路径前缀(一个代理无状态地服务所有群),把请求里的图片块换成占位文本,鉴权头与流式响应原样透传。只有 `vision:false` 才走代理。同时自知清单告诉 agent「你没有识图能力」,浏览器截图约定改成落盘 + 取文本快照,免得它对着占位文本自说自话。

### 4.4 轮次生命周期:群永不卡死

- **答案到达即结算**:runner 的 `result` 事件就收尾卡片、记账、释放并发槽。
- 结算后武装硬超时 `agent.hardReleaseMs`(默认 20 秒):进程还不退就强制释放群锁、杀进程树、派发下一条。`/stop` / `/new` 立即释放。
- claude 答案后只等 3 秒(会话持续落盘,快杀赖着管道的 MCP 子进程);codex 只在**干净退出**时落盘会话记录,硬杀会让下轮续接失败,所以给足 20 秒。
- 会话 id 按**轮次身份**持久化:被强制释放的轮次迟到返回,不会复活已清掉的会话。
- **会话接不上就换新会话重做一次**,两种形状:① 空轮(零产出)—— 先同会话重试一次;上一轮被掐断过,或续接连空两次,就换新会话;② 续接的会话记录已经不在(Claude Code 默认清掉 30 天没动过的会话记录,CLI 起步即报「No conversation found」)—— 不报错,直接换新会话。两种都在群里说一句为什么:丢的是聊天上下文,项目约定与长期记忆在磁盘上不受影响。每条消息最多换一次。

### 4.5 排队、撤回与重做

- **出队合并**:一轮进行中攒下的多条消息,出队时合成一个 prompt(每条保留自己的 `[时间 发送者]`)一轮处理完。「是一件事还是几件事」是判断题,交给 agent。群内不做真并行(会话线性、同目录竞写、回复乱序)。
- **撤回即停**:平台报某条消息被撤回(飞书 `im.message.recalled_v1`)⇒ 还在排队就剔除;正在跑且是这一轮唯一的来源就中止 —— 用户收回了请求,继续处理可能复述已撤回的内容。已合并进批量的不中止。
- **发版掐断的轮次,重启后重做**(`pending.js`):只在优雅关停时记账(崩溃路径走不到,所以不会「崩完自己开工」);不记已发出答案的、被人叫停或撤回的、合成消息;2 小时内有效、读到即消费;重做前在群里说一声,`/stop` 就是反悔阀。

### 4.6 群项目基础能力

- **自知清单**(`engine._buildManifest`):身份、群 / 项目 / 模型 / 权限、控制台地址、基础技能、已启用插件、项目自带插件、仓库关联状态、时间口径、项目长期记忆的位置。只在清单**变化**时注入(按指纹比对),变了也**不重置会话**;所以清单里不能有每轮都变的东西(钟点、精确条数)。平台缺的能力整段不教,教了 agent 就会去调一个不存在的动作。
- **跨模型记忆交接**:点名项目根的 `CLAUDE.md` / `AGENTS.md` 与长期记忆目录,只给坐标不搬内容。记忆目录在项目目录之外,非完全访问的 claude 群读不到,就不指给它 —— 指了反而教出「这项目没有记忆」。
- **基础技能是 CLI,不是插件**:`sbot feishu`(发文件 / 图片 / 消息、拉历史、回复编辑撤回、下载附件、表情)· `sbot wecom`(发消息 / 文件 / 图片、拉历史)· `sbot cron` · `sbot imagen` · `sbot design` · `sbot preview`。Slack 群暂时没有基础技能命令,清单里那一段整段换掉。目标群 = 每轮注入的 `SBOT_CHAT_ID`;路径只收项目内的相对路径;出站文本过脱敏。codex 的 MCP 是全局加载的,没法按群门控、拿不到每轮的群 id,所以走 shell 两个后端都通用。
- **对外怎么说**:群消息与控制台不出现命令名、工具名和机器路径;清单里的命令名只给 agent 执行用。

### 4.7 定时任务

- 两种写法:标准 5 段 cron(含 `@daily` 与「每天 09:00」「工作日 8:30」中文简写)按**产品时区**匹配;一次性用 `--at "YYYY-MM-DD HH:mm"`(cron 没有年份,会每年重复),触发后自删。
- 三种动作:`--do` 构造合成消息喂引擎,走全套群管线;`--say` 只发一句;`--run` 在项目根直接跑命令,不起 agent、不占群锁,失败才在群里说。直发的消息发不出去时按 1 / 5 / 15 / 30 分钟补发。
- 调度器分钟级、对齐分钟边界,启动时**不补触发**错过的分钟;每次 tick 现读配置(跟随热重载)。
- 存在 `groups[chatId].crons`;去重键是 `(群, id)`,永不串群;多个群的 agent 同时写配置由文件锁串行化。

### 4.8 额度

- **告警**:Claude 5 小时窗口已用 > 90%、codex 一周窗口 > 95% 时在群里说一声。模型账号异常、额度用完、自动切换、平台连接中断另发到运维告警群(`alerts.chatId`,可选)。
- **自动切换**:`providers.<主>.fallback = "<备用>"`。错误先分两类(`quotaerr` 换模型才有用 / `transienterr` 过一会儿再来);额度或账号类错误切到备用并在群里说明,解析出重置时刻后到点切回。

### 4.9 控制台与访问安全

- 只绑 127.0.0.1 不等于安全(跨站 POST、DNS rebinding):每个进程一枚随机令牌注入页面,所有 `/api/*` 都校验,外加环回 Host 校验。配置文件坏了拒绝写回。
- 对局域网开放(`--ui-host`)**必须先设密码**,否则拒绝启动。密码只用来换会话令牌(不用 cookie ⇒ 没有 CSRF);本机环回免密,带 `X-Forwarded-*` 的环回请求不算本机。
- 公网入口用**飞书账号登录**(OAuth 授权码流程),只放行 `feishu.admins` 名单里的人;会话落盘 30 天,名单删人或换密码时旧会话按签发时的身份线索立刻失效。见 [docs/PUBLIC-ACCESS.md](./docs/zh-CN/PUBLIC-ACCESS.md)。
- 实时活动走 SSE;SSE 不重放,所以服务端留最近的轮次事件,页面载入与每次重连都补拉合并。这份缓冲在内存里,启动时用账本最近的轮次垫底(定时脚本不算),否则每次重启(含每次升级)活动流都是空的。页面每 60 秒自动刷新,但不打断正在填的表、开着的弹窗和拖拽。
- **「需要你处理」放在概览最上面,有事才出现。** 汇总在等人的事:72 小时内失败的轮次(带账本里同一句原因;同群同一个人之后得到回答就自动消失,也可以手动忽略)、agent 发出去还没人认领的接管链接、没处理的反馈、残留的后台进程、服务整个项目目录的预览、没通过的健康检查(排最前:它是现在就坏着)。它只汇总:不往任何群多发一条消息;已经有自己区块的事项点了跳过去,不在两处各处理一遍。一轮结束时控制台只取这张单子、只重画这一块,不拉整份概览。

### 4.10 其它机制

- **飞书长连接看门狗**(`wswatchdog.js`):开 SDK 的 pong 探活;接管连接事件维护健康快照;SDK 放弃重连或卡在重连太久就强制重建,指数退避。治的是「SDK 以为还连着、其实收不到事件」。
- **时间口径**:顶层 `timezone`(默认 `Asia/Shanghai`)是全产品唯一口径,与主机时区无关。每条消息带 `[YYYY-MM-DD HH:mm 发送者]` 作为每轮的时间锚点;子进程注入 `TZ`;控制台顶栏另显示服务器主机自己的时区。
- **仓库关联**(`gitrepo.js`):只做 `git init` 与设 `origin` 两件幂等的事,不 clone、不替 agent 提交推送。地址只收 SSH 写法(`ext::` 这类传输会执行命令);git 调用一律 `execFile` + `BatchMode`,无头下绝不等交互输入;状态直接读 `.git/config`,如实报「缺失 / 不一致」。
- **设计画布、风格档与图标、预览服务**:各有独立文档 —— [docs/BOARD.md](./docs/zh-CN/BOARD.md) · [docs/ICONS.md](./docs/zh-CN/ICONS.md) · [docs/PREVIEW.md](./docs/zh-CN/PREVIEW.md)。预览的通则值得单列:**凡 agent 够得着的入口,输入一律不可信**,受理侧的围栏必须在执行侧再跑一遍。
- **单实例锁**:同一个状态目录只许一个 daemon,第二个直接报错退出 —— 两个 daemon 会抢同一个平台的消息。
- **升级播报**:daemon 启动时比对 state 里记的版本号,变了就把 CHANGELOG 里新增的条目发到各群;预写 `lastVersion` 可压掉。
- **遗留进程**:轮次结束后仍活着的后台 shell(父进程已退且存活 ≥ 1 小时)由 doctor 与控制台列出,可一键结束。
- **Windows 上启动子进程**:按 PATH + PATHEXT 解析 `claude` / `codex`(npm 的 `.cmd` 垫片经 `cmd.exe` 运行、原生 `.exe` 优先、不误选无扩展名的 sh 脚本);prompt 走 stdin 绕开命令行转义;中止用 `taskkill /T /F` 杀整棵进程树。全部在 win32 分支里,POSIX 路径不变。
- **控制台**是自包含单文件(手写 CSS + 原生 JS,无构建),有两种形态:`sbot ui` 独立运行(配置 + 试跑,不接 daemon);`sbot start --ui` 与 daemon 同进程,拿实时状态、SSE 推流和运行控制。改配置热重载;平台凭据变了要重启 daemon(长连接在启动时绑定)。

## 5. 已知限制与风险

| 风险 | 缓解 |
|---|---|
| 无人审批的无头权限 | 策略化白名单,永不挂起;默认只读 |
| 代理或网络下长连接假活 | 看门狗探活 + 强制重建 |
| 第三方模型 agentic 能力弱 | `toolQuality` 标注;复杂任务用 Claude |
| 长命令锁死会话 | `agent.maxTurnTimeMins` 墙钟上限(默认 30 分钟) |
| `claude` CLI 参数漂移 | spawn 参数集中管理;启动时探测版本与参数支持 |
| 订阅额度用尽 | 额度告警 + 自动切到备用模型 |
| 平台重投旧消息 | 水位线丢弃 |
| 合成消息推水位线 | 水位线只归平台消息(§3) |
| 用个人订阅服务多人群聊 | 可能不符合提供方条款 —— setup 结束时提示,团队请用 API key 或企业账号 |

## 6. 命名

- 项目名 **SintBot**;npm 包 **`sintbot`**;命令 **`sbot`**(别名 `sintbot`)。npm 上的 `sbot` 是别人的包。
- 机器人在群里的默认名 `SintBot`,配置 `brand` 可改。
