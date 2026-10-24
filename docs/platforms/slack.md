# Slack

English · [简体中文](../zh-CN/platforms/slack.md)

SintBot connects over Socket Mode, so no public address is needed, and it works on free Slack workspaces.

> **Status:** `!status`, the native Stop button and the Stop / Skip / Status buttons in threads have unit tests but have not yet been used by real people in a real workspace. If something does not work, please [open an issue](https://github.com/sintlab/sintbot/issues).

## Create the app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From a manifest**, choose the workspace and paste [`docs/slack-app-manifest.yaml`](../slack-app-manifest.yaml). For an npm install, the file is at `$(npm root -g)/sintbot/docs/slack-app-manifest.yaml`. You can change `display_information.name` to any name you like.
2. Go to **Basic Information → App-Level Tokens → Generate**, check `connections:write`, and copy the `xapp-…` token.
3. Go to **OAuth & Permissions → Install to Workspace** and copy the Bot Token, `xoxb-…`.
4. Invite the bot to a channel by sending `/invite @your-bot-name` there. **Until it is invited, it receives no messages at all.**

⚠ **One app per machine.** Socket Mode **distributes messages across connections at random** rather than broadcasting them, so if two machines share one app, each message lands on one of them at random.

⚠ After changing the manifest, save it on the App Manifest page and **Reinstall to Workspace**.

## Connect SintBot

```bash
sintbot setup     # choose slack, enter the xoxb- and xapp- tokens; the precheck verifies the tokens, scopes, Socket Mode and the channels the bot has joined
```

Or fill it in on the console under Settings → Slack app. When binding a group, pick a Slack channel; only channels the bot has joined are listed.

```jsonc
"slack": {
  "botToken": "env:SLACK_BOT_TOKEN",     // xoxb-…
  "appToken": "env:SLACK_APP_TOKEN",     // xapp-…
  "onlyWhenMentioned": true,             // true = in channels, reply only to messages that @ the bot (setup writes true); omitted = reply to every message. Direct messages always get a reply
  "replyInThread": true,                 // reply in a thread (default true)
  "commandAlias": "!",                   // in-chat command prefix, see below (default !)
  "umbrellaCommand": "/sint"             // the umbrella slash command registered in the manifest (default /sint)
}
```

On machines that need a proxy to reach Slack, the config's `proxy` block applies to both Slack's REST API and its WebSocket.

## Using it in Slack

- **Start in-chat commands with `!`:** `!stop` · `!skip` · `!new` · `!status` · `!help` · `!model <name>` · `!hud` · `!issue <one sentence>`. Slack consumes input that starts with `/`, so `/status` never reaches the bot.
- **The umbrella command.** In a channel you can also use `/sint stop`, with autocomplete. Registered slash commands **cannot be invoked inside a thread**, so in threads only `!` works.
- **Progress:**
  1. ⏳ as soon as the message arrives;
  2. a progress message in the thread that refreshes as the work runs, alongside Slack's native "Working…" status and a **Stop** button;
  3. the answer, posted separately;
  4. ✅.
- **Buttons.** The Status and other buttons in the thread are equivalent to `!status` and friends.
- **Help.** The App Home tab explains how to use the bot. The command list differs by channel; use `!help` to see it.

## Not supported yet

- Sending and receiving files in the channel (uploads are not wired up yet). For files the bot generates, it tells you their path in the project.
- Whiteboards (Feishu only), and any form of feedback other than emoji reactions.
- Streaming messages in public channels (Slack supports them only in direct messages), so progress is shown by editing a message.

Implementation details and lessons learned: [SLACK.md](../SLACK.md).
