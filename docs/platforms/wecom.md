# WeCom

English · [简体中文](../zh-CN/platforms/wecom.md)

SintBot connects as a WeCom smart bot in API mode over a long connection. No public address is needed, and the organization does not need to be verified.

> **Status:** WeCom is the newest of the three platforms and has seen the least real-world use. If something does not work, please [open an issue](https://github.com/sintlab/sintbot/issues).

The WeCom client and admin console are in Chinese; the menu names are given in Chinese with English translations.

## Create the bot

1. **Register an organization.** Registration is free and needs no business license. An unverified organization can have up to 200 members, and internal groups and smart bots both work.
2. **Create the bot** (desktop client only). Either go to 工作台 → 智能机器人 → 创建机器人 → 手动创建 → API 模式 (Workbench → Smart bots → Create bot → Create manually → API mode), or use the admin console: 安全与管理 → 管理工具 → 智能机器人 (Security & management → Management tools → Smart bots).
   - For usage, choose 多人使用 (used by multiple people).
   - On the API configuration page, choose **使用长连接 (use long connection)**, and note the **Bot ID** and **Secret**.
3. **Add it to a group** from the group menu.
   - ⚠ The bot does not appear in the contacts member list. Search for its name in the top search bar, or open it from 工作台 → 智能机器人.
   - Members who sign in to WeCom through the WeChat plugin cannot see smart bots; they need the full WeCom app.
4. **Install the official CLI** (recommended). It is needed to show senders' names, read group history, and let the bot post images and files in the group.
   ```bash
   npm i -g @wecom/cli
   wecom-cli auth init --manual       # enter the same Bot ID / Secret
   ```
   Without it the bot still works, but the group shows userids and the bot cannot post images or files.

## Connect SintBot

Fill it in on the console (`sintbot ui`, or http://127.0.0.1:4600 once the service runs) under Settings → WeCom bot. The console's precheck covers the credentials, the CLI, and whether the CLI is authorized for the same bot. On a server without a browser, use the terminal instead:

```bash
sintbot setup --full   # choose wecom, enter the Bot ID / Secret and the bot's name in WeCom (used to strip the @ from message text)
```

```jsonc
"wecom": {
  "botId": "aib…",
  "secret": "env:WECOM_BOT_SECRET",
  "botName": "SintBot",            // strips "@SintBot" from message text
  "names": { "zhangsan": "张三" }   // optional: manual userid → display name mapping
}
```

**Binding a group:** pick the group ID in the console under Groups & projects. The list shows groups where the bot has been @-mentioned, so in a new group, @ the bot once first.

## Behavior and limits

- **It only replies when @-mentioned.** By the platform's design, the long connection only delivers messages that @ the bot.
  - Replying without an @ can be turned on (by polling group history, gated by rules or a cheap model), but it is **off by default**.
  - It runs into the official usage rules, and the API it needs is not yet open to organizations with more than 10 members.
  - Details: [WECOM.md](../WECOM.md).
- **Proactive messages** (scheduled tasks, upgrade notices) require someone to have messaged the bot in that conversation before.
- **One bot per machine.** If two machines use the same Bot ID / Secret, the newer connection replaces the older one. After being replaced twice within 10 minutes, SintBot stops reconnecting, so the two machines do not keep kicking each other off; a restart brings it back.
- **Not available:** recall events (so recalling a message does not stop its turn), whiteboards and emoji reactions.
- **Markdown limits:** tables and multi-line code blocks do not render, so replies are rewritten automatically into a format that does.
- **Long replies:** each streaming reply can last up to 10 minutes; a longer reply continues in a new message automatically.

Full integration details, configuration and limits: [WECOM.md](../WECOM.md).
