# Slack

[English](../../platforms/slack.md) · 简体中文

走 Socket Mode 长连接,不需要公网地址;免费版 workspace 可用。

> 现状:`!status`、原生 Stop 与线程里的「停止 / 跳过 / 状态」按钮有单元测试,但还没在真实工作区里被真人用过。用着不对请[提 issue](https://github.com/WaterTian/sintbot/issues)。

## 建 App

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From a manifest** → 选 workspace → 粘贴 [`docs/slack-app-manifest.yaml`](../../slack-app-manifest.yaml)(npm 安装的在 `$(npm root -g)/sintbot/docs/slack-app-manifest.yaml`)。`display_information.name` 可以改成你想要的名字。
2. **Basic Information → App-Level Tokens → Generate**,勾 `connections:write`,得到 `xapp-…`。
3. **OAuth & Permissions → Install to Workspace**,得到 Bot Token `xoxb-…`。
4. 把机器人请进频道:在频道里发 `/invite @你的机器人名`。**不请进去就收不到任何消息。**

⚠ 一台机器一个 App。Socket Mode 的多条连接是**随机分发**、不是广播,两台机器共用一个 App 会让消息随机落到其中一台。

⚠ 改过 manifest 之后要在 App Manifest 页保存,并 **Reinstall to Workspace**。

## 接入 SintBot

```bash
sintbot setup     # 选 slack,填 xoxb- 与 xapp-;预检会核对凭据、权限、Socket Mode 与已加入的频道
```

或在控制台「设置 → Slack 应用」里填。绑群时选 Slack 频道(只列出机器人已加入的)。

```jsonc
"slack": {
  "botToken": "env:SLACK_BOT_TOKEN",     // xoxb-…
  "appToken": "env:SLACK_APP_TOKEN",     // xapp-…
  "onlyWhenMentioned": true,             // true = 频道里只回 @ 机器人的消息(setup 写 true);不写 = 频道里每条都回。私信永远回
  "replyInThread": true,                 // 回复挂在线程里(不写 = true)
  "commandAlias": "!",                   // 群内命令前缀,见下(不写 = !)
  "umbrellaCommand": "/sint"             // manifest 里注册的总入口斜杠命令(不写 = /sint)
}
```

需要代理才能连 Slack 的机器:配置里的 `proxy` 块对 Slack 的 REST 与 WebSocket 同样生效。

## 在 Slack 里用

- **群内命令用 `!` 开头**:`!stop` · `!skip` · `!new` · `!status` · `!help` · `!model <名字>` · `!hud` · `!issue <一句话>`。Slack 会自己吃掉 `/` 开头的输入,`/status` 根本到不了机器人。
- 频道里也可以用总入口 `/sint stop`(有自动补全)。注册的斜杠命令在**线程里调不出来**,所以线程里只能用 `!`。
- 进度:收到即打 ⏳ → 线程里一条进度消息随执行刷新,并显示 Slack 原生的「Working…」状态与 **Stop** 按钮 → 答案单独发出 → ✅。
- 线程里的「状态」等按钮,与 `!status` 等价。
- App Home 页签讲怎么用;命令表按频道不同,用 `!help` 看。

## 现在还不支持

- 群内收发文件(上传还没接):机器人生成的文件会告诉你项目里的路径。
- 画板(飞书专有)与表情回应以外的反馈方式。
- 公开频道里的流式消息(Slack 只在私信里支持),所以进度靠编辑消息实现。

实现细节与踩坑记录见 [SLACK.md](../../SLACK.md)。
