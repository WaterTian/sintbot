# Slack 适配器:机制与平台事实

[English](../SLACK.md) · 简体中文

> 怎么建 App、怎么接入见 [platforms/slack.md](./platforms/slack.md);本文讲适配器怎么工作,以及写它时必须知道的 Slack 平台事实(均来自 [docs.slack.dev](https://docs.slack.dev) 官方文档,并在免费版 workspace 上实测过)。
> 实现:`src/platform/slack.js`(适配器,零 Slack SDK)· `src/core/proxy.js`(出网代理)· `tests/unit/slack.test.js`。端到端自测:`node docs/slack-probe.js echo`(只跑适配器,不经引擎)。

## 形态

- **Socket Mode 长连接,不需要公网入口**。官方更推荐生产用 HTTP,但明说「在防火墙后、不能暴露 HTTP 端点」时用 Socket Mode;它是正式通道,只是要按「会周期性掉线」来设计重连。
- **零 Slack SDK**:Web API 全是 POST,原生 `fetch` 就够;WebSocket 用飞书 SDK 已经带进来的 `ws`。SDK 不管我们真正要处理的坑(ack 先行、去重、年龄闸门、回环丢弃、错误分类),而它管的重连,本仓 `src/platform/wswatchdog.js` 的状态机更可信。所有出站都走唯一入口 `createSlackApi()`:`ok:false` 显式抛、warning 一律上报、重试短而有界(默认 ≤2 次、总等待 ≤10 秒,而不是 SDK 默认的「10 次 / 约 30 分钟」—— 那会造成重复发消息、进度冻住)。
- 挂在多平台路由器 `src/platform/multi.js` 上,与飞书 / 企业微信可同时在线。群归属看 `groups[<chatId>].platform`;没写时按 id 形态推断(Slack 是 `C|G|D` + 大写字母数字,只在配了 Slack 时才认)。
- **故障隔离**:凭据错误(`invalid_auth` 等)不在 `start()` 里抛,只让 Slack 这一路停在「连接失败」并发运维告警 —— 否则同进程的飞书 / 企微也会一起起不来。

## 必须一开始就定对的三件事

1. **每个用户自己建 App,不给共享安装链接**。非 Marketplace 的「商业分发」App,`conversations.history` / `replies` 被限到 1 次/分钟、每次 15 条;**内部自建 App 豁免**(Tier 3,50+ 次/分钟,limit 1000)。Real-time Search API 与 MCP 也只对上架 App 和内部 App 开放。所以 SintBot 给的是 manifest 模板,由用户在自己的 workspace 建。
2. **一台机器一个 App**。Socket Mode 一个 App 最多 10 条连接,但每条事件**随机交给其中一条**,不是广播 ⇒ 两台机器共用一个 App,消息会随机落到其中一台,表现得像「时灵时不灵」。
3. **不把正确性建立在 `conversations.history` 上**:以事件流为唯一真相源,history 只做补偿。Socket Mode **不为断线期间补发事件**;`message_deleted` 是 hidden 事件,不进 history ⇒ 断线期间的撤回永久丢失。免费 workspace 有 90 天历史窗口,超出部分静默不返回(`is_limited: true`)。

## 收消息

- **先 ack 再入队**,ack 之前不 await 任何东西。60 分钟内 ack 失败率超 95%,事件订阅会被临时禁用。
- **`event_id` 去重**(TTL 10 分钟,覆盖 Slack 的重投点;Socket Mode 的帧里没有「这是重投」的标记)· **事件年龄闸门**(默认丢弃 10 分钟前的事件,防延迟投递在很久之后触发一轮)。
- **三重回环丢弃**:带 `bot_id` 的(判 bot 看这个字段,不看 `subtype === 'bot_message'`)· 自己的 user id · `message_changed`(自己的 `chat.update` 会产生它,Slack 的自动语言检测也会)。
- **撤回即停**:`message_deleted` 走 `onRecall`。要用 `deleted_ts`(被删消息),不是 `ts`(删除动作);事件里没有是谁删的;**自己 `chat.delete` 也会触发** ⇒ 先滤掉自己删的。另有原生 Stop 按钮(见下)。
- 被 @ 的判定:有 `channels:history` 就收得到频道里每一条消息,自己比对 bot user id;**不订阅 `app_mention`**(同时订阅会让 @ 消息投递两次)。
- 附件:`file_share` 放行,文件转成 `[图片 … file_id=…]` 标记交给 agent。下载 `url_private` 要带 `Authorization: Bearer xoxb-`;**认证不对时返回 HTTP 200 + HTML 登录页而不是 401** ⇒ 嗅探内容,别把 HTML 存成 .png。
- `onlyWhenMentioned: true` 时频道里只回 @ 机器人的消息;私信永远回。

## 群内控制面:`/` 被 Slack 自己占了

Slack 把 `/` 开头的输入当成它的斜杠命令处理掉,`/status` 根本到不了机器人(未注册的命令报错还只有发起人看得见)。而且**应用注册的斜杠命令在线程里调不出来**(官方明文),进度与答案又都在线程里。所以三层入口:

| 入口 | 在哪用 | 说明 |
|---|---|---|
| **`!` 前缀**(主入口) | 任何地方,含线程 | 适配器把 `!stop` 还原成 `/stop` 交给引擎;只还原引擎命令清单里真有的(否则一句以 `!` 开头的话会被回「未知命令」);命令词统一转小写 |
| 进度消息上的按钮「停止 / 跳过 / 状态」 | 线程里 | 「停止」带确认;不放「开新」(连会话一起清,留给手打的 `!new`) |
| 总入口 `/sint <命令>` | 只在频道里 | manifest 注册一个命令(有自动补全)。斜杠命令**不分命名空间**,后装的同名命令会静默顶掉先装的 ⇒ 前缀与总入口名都可配置(`commandAlias` / `umbrellaCommand`) |

- App Home 页签只讲这三个入口,不放命令表(命令按群不同,用 `!help` 看)。
- 出站方向:引擎自己的提示语里写死了 `/model` 之类,在 Slack 群里照做发不出去 ⇒ 适配器把**引擎自己说的话**本地化成 `!model`;**不碰 agent 的答案**(答案里的 `/status` 可能是一条 HTTP 路由),代码块整段跳过。
- 斜杠命令与按钮的回执用 `chat.postMessage` 发进频道(否则别人不知道谁停了什么);它们没有平台时间戳,标成合成消息,不推水位线。

## 进度表达

```
收到消息 → 用户消息上打 ⏳
        → 线程里建一条进度消息(带顶层 text)
        → agents.sessions.setStatus(processing) —— 原生「Working…」+ Stop 按钮;每 5 分钟续一次(1 小时超时)
        → 节流 chat.update 刷新进度(默认 20 秒,撞 429 自动翻倍,封顶 60 秒)
        → 答案用独立的 chat.postMessage 发出
        → 删掉进度消息 → setStatus(active) → ⏳ 换成 ✅
```

- 原生状态 + Stop 按钮、逐字流式、就地重写进度,是三件**互不依赖**的事。Agent Sessions 不要求用流式 API;**流式在公开频道根本不可用**(`channel_type_not_supported`,DM 里可用),所以群里走「编辑消息」那条。免费版实测可用,开关是 manifest 的 `features.agent_view` + 订阅 `agent_session_stopped`(缺订阅时 Stop 按钮是一个点不了的转圈)。
- **答案必须独立发**:进度可以丢,答案不能丢;而且编辑不推通知,新消息才推 —— 「跑完 40 分钟推我一下」要靠新消息。
- **每条消息都带顶层 `text`**:手机推送只读 `text`;只发 blocks 的话推送是空的。
- `setStatus(active)` 放在收尾路径里无条件执行:官方明说发消息不会清掉 loading,不转就一直转圈到 1 小时超时。用户点了 Stop,状态也不会自己变。
- 节流不用官方建议的 3 秒:`chat.update` 是 Tier 3(50+ 次/分钟),**整个 App 共享、不按频道拆** —— 3 秒一次,一个任务就吃掉 40% 配额。
- 删进度消息前先记下它的 ts,否则删除事件回来会被「撤回即停」当成用户撤回。拿不到原生状态(如 App 没开 `agent_view`)只降级、不影响这一轮,并且记住不再反复尝试。
- 原生 Stop → `agent_session_stopped` → `engine.stop(chatId)`;它不经确认、不清队列。
- 带 `bot_id` 的消息编辑后**不显示「已编辑」标记**,反复刷新进度不会留下一串痕迹。

## 静默失败:返回 `ok:true` 但什么都没发生

对策写死在 `createSlackApi()` 里:**任何响应都查 `warning` / `response_metadata.warnings`**;「送达」以副作用为准(发消息看返回的 `ts`,发文件看 `shares` 非空);需要时用 `chat.getPermalink` 反查消息是否真的在频道里。最要紧的几条:

| 陷阱 | 后果 |
|---|---|
| 用 JSON body 调读类方法(`users.list` 等) | 参数被**整体忽略**,`ok:true`,分页 / 过滤全失效 ⇒ 出站一律 form 编码 |
| `Content-Type` 带 `charset` | 每个响应都带 `superfluous_charset` warning,真 warning 被淹没 |
| `chat.update` 只传 `text` 不传 `blocks` | 原有 blocks 被静默清空 ⇒ 两者永远同发 |
| `files.completeUploadExternal` 不传 `channel_id` | 文件只私有托管,群里什么都不出现 |
| `text` 超 40,000 字符 / blocks 超 50 个 | 尾部被静默截掉 / 丢弃,只给 warning ⇒ 正文自己截断并标注 |
| `conversations.list` 的 `types` 默认只有公开频道;过滤是后置的 | 私有频道整体缺席;某页条数少于 limit 不代表结束,要看 `next_cursor` |
| 新增事件订阅但没重装 App | 事件静默无效 |
| `chat.postEphemeral` | 投递不保证 ⇒ 绝不用来承载答案 |

## 可靠性

- 错误码分四类处置:可重试(`ratelimited` / `internal_error` / `service_unavailable` …)· **致命**(`token_revoked` / `invalid_auth` / `account_inactive` / `missing_scope` …,停止一切重试并告警)· 频道级(`channel_not_found` / `not_in_channel` / `is_archived` …)· 更新失败(`edit_window_closed` / `message_not_found` / `cant_update_message` …,立刻改发新消息并切换进度消息指针)。
- 重连:指数退避 + 抖动,间隔不低于 1.2 秒(`apps.connections.open` 是 Tier 3,崩溃循环会撞 429);候补连接同时只允许一条。`hello` 帧的 `approximate_connection_time`(实测约 5 小时)到 90% 时主动换连接。disconnect 的 `warning` 会在断开前约 10 秒预告;社区还报告过文档里没有的 `too_many_websockets`。调试时在 wss URL 后加 `&debug_reconnects=true`,连接寿命缩到 360 秒。
- `goodbye` / `reconnect_url` 是旧 RTM 的东西,Socket Mode 不发。
- Slack **没有按天 / 按月的调用总量配额**(不同于飞书),限流全是每分钟档位;超限后继续硬发,App 有被停用的风险。
- 出网代理:Node 的 `fetch` 与 `ws` 都不读 `http_proxy`,所以 REST 与 WebSocket 共用 `src/core/proxy.js` 的 CONNECT 隧道(只认 `http://` 代理;没配就走直连)。代理没生效时的症状是 `UND_ERR_CONNECT_TIMEOUT`,或「连上了但一直没有 hello」,都不会直说「没走代理」。

## scope 与 manifest

- 完整可粘的 manifest 在 [`slack-app-manifest.yaml`](../slack-app-manifest.yaml)(细节与理由写在它的注释里,这里不复制一份):17 个 bot scope(含斜杠命令要的 `commands`);事件是 4 个 `message.*` + `agent_session_stopped`(原生 Stop)+ `app_home_opened`(App Home);`socket_mode_enabled: true`、`features.agent_view`、总入口 `/sint`。
- 前缀语义:`channels:` 公开频道 · `groups:` 私有频道 · `im:` 单聊 · `mpim:` 多人私聊,**四者互不覆盖** —— 被拉进私有频道却没有 `groups:history`,一条消息都收不到。`mpim:history` 也不蕴含 `mpim:read`。
- 故意不要的:`app_mentions:read`(见上)。`im:write` 只在主动发起新的私信会话时才需要,收 / 回私信用 `im:history` + `chat:write` 就够。**不开 token rotation**:它是单向开关,开了关不掉,且 access token 12 小时过期。
- App-level token(`xapp-`)要带 `connections:write`,并且必须放在 `Authorization` 头里。
- 新 App 只能用 `agent_view`(`assistant_view` 已宣布废弃)。系统通知已改由 `USLACK` 用户发出,不再是 Slackbot。
- 控制台绑群时列频道用 `users.conversations`(只回机器人在里面的频道),不用 `conversations.list` —— 列出机器人不在的频道,等于让人绑一个死群。

## 富文本

- 用 **`markdown` block**:接受标准 Markdown,agent 的输出基本原样发。表格(≤100 行 × 20 列,一条消息里的表格合计 ≤10,000 字符)、任务列表、嵌套列表、带语言标签的代码块、分级标题都实测正常 —— 不像飞书那样要专门转换表格。
- `markdown_text` 参数与顶层 `text` **互斥**(`markdown_text_conflict`),而两者都需要(`text` 管推送)⇒ 走 `blocks:[{type:'markdown', text}]` + 顶层 `text`,可以共存。
- `![图](url)` 只渲染成链接;要显示图片得先上传,再用 `image` block(只支持 png / jpg / gif)。
- 旧的 `mrkdwn` 语法(`*粗体*`、没有列表和表格)不用。
- 链接与媒体预览(unfurl)一律关掉:被注入的内容可以借预览把数据外带出去。

## 还不支持 / 没验过

- **群内上传文件**还没接(`files.getUploadURLExternal` → POST 原始字节 → `completeUploadExternal` 三步;第三步不幂等、只能调一次,超时要从第一步重来)。在那之前,Slack 群的自知清单不教 `sbot feishu` 那族动作,`sbot feishu …` 在 Slack 群里会直接拦下并说明。
- 画板是飞书独有的。
- 进度消息上的按钮、App Home、原生 Stop 按钮的点击链路,代码与单元测试都在,真机上还没点过;代理隧道也没在真机上跑过。
- 延迟投递 / 事件重试 / 自动禁用这套机制是否作用于 Socket Mode,官方没写;年龄闸门已经在,阈值待定。
- `message` + `file_share` 事件的真实形态未实测。
