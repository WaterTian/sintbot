# Feishu

English · [简体中文](../zh-CN/platforms/feishu.md)

SintBot supports the China edition of Feishu (open.feishu.cn). The international Lark (larksuite.com) runs on a separate open platform and is not supported yet. The Feishu developer console can be switched to English; the Chinese labels are given in parentheses where they help you find your way.

## Create the app

1. On the [Feishu developer console](https://open.feishu.cn/app), create a **custom app** (企业自建应用) and add the **Bot** capability under Add features (添加应用能力).
2. Under **Permissions & Scopes** (权限管理 → 权限配置), enable:

   | Scope | Used for |
   |---|---|
   | `im:message.group_msg` | receiving group messages |
   | `im:message:readonly` | reading group history, downloading attachments, receiving recall events |
   | `im:message:send_as_bot` | sending, replying to, editing and recalling its own messages |
   | `im:resource` | uploading images and files |
   | `im:message.reactions:write_only` | emoji reactions (it reacts as soon as a message arrives) |
   | `im:chat` | creating groups, adding people, reading group info |
   | `cardkit:card:write` | streaming cards (falls back to plain text without it) |
   | `contact:contact.base:readonly` | senders' real names; picking admins from the directory |
   | `contact:user.base:readonly` | directory members' names (without it, lists and senders show open_ids) |
   | `contact:department.base:readonly` | reading departments from the directory |
   | `contact:user.id:readonly` (optional) | looking people up by email or phone number |

   The whiteboard features need whiteboard scopes as well; see [BOARD.md](../BOARD.md) (in Chinese).

3. Under **Data permissions** (权限管理 → 数据权限), set the contacts scope to **all members**. Otherwise listing people and showing real names fails with `40004`.
4. Under **Events & callbacks → Event configuration** (事件与回调 → 事件配置), choose the **long connection** mode (no public address needed) and subscribe to:
   - `im.message.receive_v1` (receive messages)
   - `im.message.recalled_v1` (message recalled; recommended, so that recalling a message stops its turn)

   **Callback configuration** is a separate tab and a separate channel. If you use the whiteboard features, subscribe to the card action callback `card.action.trigger` there, also in long-connection mode; the buttons on feedback cards depend on it.
5. Under **App release → Availability** (应用发布 → 可用范围), add the people who will use the bot, at least the admins. People outside this scope cannot be added to groups the bot creates; Feishu reports `232043 bot invisible`.
6. **Create a version and publish it.** ⚠ Any change to scopes or event subscriptions takes effect only after you **publish another version**.

> Feishu has three separate permission layers. **Scopes** decide which APIs the app can call, **data permissions** decide whose data it can read, and **availability** decides whom the bot is visible to and whom it can add to groups. When you get an error, first work out which layer it comes from.

## Connect SintBot

```bash
sintbot setup       # choose feishu, enter the App ID / App Secret; the precheck finds the bot's open_id and checks each permission
```

Or fill it in on the console under Settings → Feishu app, which has a setup guide and a one-click precheck that translates error codes into plain language.

Add the bot to a group, then bind the project directory in the console under Groups & projects (or run `sintbot setup` again).

## Configuration

```jsonc
"feishu": {
  "appId": "cli_…",
  "appSecret": "env:FEISHU_APP_SECRET",   // plain text works too; the config file is 600
  "botOpenId": "ou_…",                    // filled in by the precheck, used to tell exactly when the bot is @-mentioned; if the precheck did not run or failed, fill it in by hand or run the precheck under Settings → Feishu app
  "onlyWhenMentioned": false,              // true = reply only to messages that @ the bot
  "admins": [{ "openId": "ou_…", "name": "…" }]   // admins: added automatically to groups the bot creates; the only people allowed into the public console
}
```

- **@-mention gating.** With `onlyWhenMentioned: false` (the default), the bot replies to messages that @ nobody, but not to messages that @ someone else without @-mentioning the bot.
  - This relies on `botOpenId` to recognize which @ is the bot. Without it, messages that @ someone else are handled too.
  - With `onlyWhenMentioned: true` and no `botOpenId`, the bot replies to nothing in the group.
- **One app per machine.** One app can hold several long connections (up to 50), but Feishu does **not broadcast**: each message goes to one of the connections at random. If two machines share one app, messages land on either machine at random and the other never sees them. Create a separate app for each machine.
- **Whiteboard auto-detection.** The Feishu API has a **monthly call quota per tenant**, so whiteboard auto-detection is **off by default**; say so in the group and the bot reads the whiteboard on demand.
  - To turn it on, set `feishu.board.pollSec` to `120` (minimum 30). **Groups that have a canvas** are then polled every 120 seconds.
  - Each poll costs about 2 calls, so one group uses about 40,000 calls a month.
