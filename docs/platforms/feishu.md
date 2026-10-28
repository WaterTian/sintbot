# Feishu

English · [简体中文](../zh-CN/platforms/feishu.md)

SintBot supports the China edition of Feishu (open.feishu.cn). The international Lark (larksuite.com) runs on a separate open platform and is not supported yet. The Feishu developer console can be switched to English; the Chinese labels are given in parentheses where they help you find your way.

## Create the app

1. On the [Feishu developer console](https://open.feishu.cn/app), create a **custom app** (企业自建应用) and add the **Bot** capability under Add features (添加应用能力).
2. Under **Permissions & Scopes** (权限管理), enable everything in one go with **Batch import/export scopes** (批量导入/导出权限; on an app that already has scopes it sits in the Batch actions (批量处理) menu). Choose Import (导入), paste the whole JSON below (the console's Settings → Feishu app card copies the same JSON in one click), then:
   - click Next to confirm the new scopes (下一步，确认新增权限);
   - click Next to set the data scope (下一步，配置可访问数据范围) and set the contacts scope to **all members**, otherwise listing people and showing real names fails with `40004`;
   - click Enable (确定开通).

   If you don't use the design canvas, first remove the `docx:` / `docs:` / `board:` / `drive:` scopes and `im:chat.tabs:write_only` (see [BOARD.md](../BOARD.md)).

   ```json
   { "scopes": { "user": [], "tenant": [
     "im:message.group_msg",
     "im:message:readonly",
     "im:message:send_as_bot",
     "im:resource",
     "im:message.reactions:write_only",
     "im:chat",
     "cardkit:card:write",
     "contact:contact.base:readonly",
     "contact:department.base:readonly",
     "contact:user.base:readonly",
     "contact:department.organize:readonly",
     "contact:user.id:readonly",
     "application:application:self_manage",
     "docx:document:create",
     "docx:document:write_only",
     "docs:document.media:upload",
     "board:whiteboard:node:read",
     "board:whiteboard:node:create",
     "board:whiteboard:node:delete",
     "docs:permission.member:create",
     "drive:drive.metadata:readonly",
     "im:chat.tabs:write_only",
     "docs:document.comment:read",
     "docs:document.comment:update",
     "docs:document.media:download"
   ] } }
   ```

   What each scope is for:

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
   | `contact:department.organize:readonly` (optional) | the full department tree when picking people |
   | `contact:user.id:readonly` (optional) | looking people up by email or phone number |
   | `application:application:self_manage` (optional) | showing the app description in the console |

3. Under **Events & callbacks → Event configuration** (事件与回调 → 事件配置), choose the **long connection** mode (no public address needed; you can save it before SintBot is running). In Add events (添加事件), search for each event name and tick it:
   - `im.message.receive_v1` (receive messages)
   - `im.message.recalled_v1` (message recalled; recommended, so that recalling a message stops its turn)

   **Callback configuration** is a separate tab and a separate channel. If you use the whiteboard features, subscribe to the card action callback `card.action.trigger` there, also in long-connection mode; the buttons on feedback cards depend on it.
4. Under **App release → Availability** (应用发布 → 可用范围), add the people who will use the bot, at least the admins. People outside this scope cannot be added to groups the bot creates; Feishu reports `232043 bot invisible`.
5. **Create a version and publish it.** If the release page says no review is needed (本次发布免审核), the version goes live as soon as you confirm; otherwise a tenant admin has to approve it. ⚠ Any change to scopes or event subscriptions takes effect only after you **publish another version**.

### A second machine: copy an existing app

Each machine needs its own app (see Configuration below for why). Copy the existing app instead of ticking scopes one by one:

1. Create a custom app with a name that tells the two apart (for example `SintBot-93`), reuse the same icon if you like, and add the **Bot** capability.
2. In the old app, open Permissions & Scopes → Batch actions → Batch import/export scopes → Export (导出) and click Copy (一键复制). In the new app choose Import and paste, then continue as in step 2 above (contacts scope: all members again).
3. Add the same events and callbacks as the old app, again in long-connection mode.
4. Set the availability and publish.
5. Connect the new app on the new machine and run the precheck again. The bot's and the admins' open_ids are **different for every app**, so `botOpenId` has to be detected again and the admins picked again.
6. Add the new bot to the groups the new machine takes over, then remove the old bot from those groups; otherwise the old bot replies that the chat is not bound to a project.

> Feishu has three separate permission layers. **Scopes** decide which APIs the app can call, **data permissions** decide whose data it can read, and **availability** decides whom the bot is visible to and whom it can add to groups. When you get an error, first work out which layer it comes from.

## Connect SintBot

Fill it in on the console (`sintbot ui`, or http://127.0.0.1:4600 once the service runs) under Settings → Feishu app, which has a setup guide and a one-click precheck that translates error codes into plain language. On a server without a browser, use the terminal instead:

```bash
sintbot setup --full   # choose feishu, enter the App ID / App Secret; the precheck finds the bot's open_id and checks each permission
```

Add the bot to a group, then bind the project directory in the console under Groups & projects (or run `sintbot setup --full`).

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
- **One app per machine.** One app can hold several long connections (up to 50), but Feishu does **not broadcast**: each message goes to one of the connections at random. If two machines share one app, messages land on either machine at random and the other never sees them. Create a separate app for each machine; see "A second machine: copy an existing app" above.
- **Whiteboard auto-detection.** The Feishu API has a **monthly call quota per tenant**, so whiteboard auto-detection is **off by default**; say so in the group and the bot reads the whiteboard on demand.
  - To turn it on, set `feishu.board.pollSec` to `120` (minimum 30). **Groups that have a canvas** are then polled every 120 seconds.
  - Each poll costs about 2 calls, so one group uses about 40,000 calls a month.
