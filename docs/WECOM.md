# WeCom integration (smart bot · long connection)

English · [简体中文](./zh-CN/WECOM.md)

> The second chat-platform adapter: `src/platform/wecom.js`. The engine reads only three extra self-describing fields from a platform (`skillCmd` / `features` / `chatLabel`; see src/core/interfaces.js). It **can run alongside Feishu** (the router is `src/platform/multi.js`; the group-level `platform` field decides which side a group belongs to).
> This document covers only **integration facts and limits** (running online together with Feishu has been tested item by item).

The WeCom client and admin console are in Chinese; menu names are given in Chinese with English translations.

## 1. Setup (no verification, no public address)

1. **Registering an organization** is free and needs no business license: organization name / industry / size, plus a scan with the admin's real-name WeChat. Unverified organizations are capped at 200 members, and internal groups and smart bots both work. Verification (300 CNY a year) only affects external-facing features and is **not needed**.
2. **Create the bot** in the desktop client: 工作台 → 智能机器人 → 创建机器人 → 手动创建 → API 模式 (Workbench → Smart bots → Create bot → Create manually → API mode). It can't be created on mobile; the admin console's 安全与管理 → 管理工具 → 智能机器人 (Security & management → Management tools → Smart bots) is the same entry point. Fill in the name / description / visibility; **for usage, choose 多人使用 (used by multiple people)**; on the API configuration page choose **使用长连接 (use long connection)** and note the Bot ID and Secret. Saving shows a usage-rules confirmation once.
3. **Permission management** (the 权限管理 tab on the same page): "bot creation permission" and "API mode management → members who can configure long connections" default to the whole organization; leave them alone.
4. **Finding it in the app:** it is not in the contacts member list. Search for its name at the top, or go to 工作台 → 智能机器人; in a group, add it from the group menu. ⚠ Members who sign in to WeCom through the WeChat plugin can't see smart bots; they need the full WeCom app.
5. **The official CLI** (needed for sender names, group history and the assistant posting images and files): `npm i -g @wecom/cli` → `wecom-cli auth init --manual` with the same Bot ID / Secret. In a non-interactive environment, give it a TTY (expect); the prompts are 「请输入企业微信机器人 Bot ID」 (enter the WeCom bot's Bot ID) and 「◆  Secret」. Credentials are stored encrypted in `~/.config/wecom/`.

## 2. Configuration (both platforms side by side)

**Whichever platform is configured gets connected.** With a `feishu` block (appId / appSecret) it connects to Feishu; with a `wecom` block (botId / secret) it connects to WeCom; with both, it connects to both. Each group says which side it belongs to with `platform`. The old top-level `platform` field is deprecated (it is ignored if present, and doctor mentions it).

```jsonc
{
  "wecom": {
    "botId": "aib…",                         // from the API configuration page
    "secret": "env:WECOM_BOT_SECRET",        // the long-connection Secret; registered for redaction by value
    "botName": "SintBot",                     // strips "@SintBot" from message text; unset = strip only the leading @
    "names": { "WangWu": "王五" },         // manual mapping (highest priority); then a CLI people search; otherwise the userid is shown
    "welcome": "",                           // welcome message for the first direct chat; empty = no reply
    "cli": "wecom-cli",                       // the official CLI's executable name; false = no name lookups, built-in skills off
    "throttleMs": 800,                       // throttle window for streaming frames
    "inboxDir": "~/.sbot/wecom-inbox",       // where incoming images / files are saved (default)
    "pollSec": 0,                            // "reply without an @": the **normal** interval in seconds for fetching group history; **default 0 = off** (by platform design the bot answers only when @-mentioned; polling runs into the official usage rules, and organizations with >10 members get 853006); a small test group can use 20. Tiered per group: just chatted 8s · normally pollSec · nobody spoke for 10 minutes max(6×pollSec, 120)s
    "followSec": 300,                        // follow-up window in seconds: for this long after an @ / a reply, messages without an @ also go to the model; 0 = every message in the group goes to the model (burns quota)
    "keywords": ["机器人", "助手"],          // call words ("bot", "assistant"): messages containing them or the bot's name go to the model (optional)
    "gatekeeper": { "provider": "deepseek", "model": "deepseek-v4-flash", "maxPerMin": 6 }
                                             // a second gate (optional; unset = none): messages the rules don't let through are first put to this cheap model, asking whether to answer (a direct HTTP YES/NO question, no CLI);
                                             // it can only point at a model with baseUrl+apiKey (subscription-login claude / codex can't; doctor's wecom.gate row says so); a plain string like "deepseek" also works;
                                             // model is optional (that provider's default model; the cheapest is recommended); maxPerMin = max questions per group per minute (default 6)
  },
  "groups": {
    "wrXXXXXX…": { "workdir": "…", "platform": "wecom" },   // the group chatid: binding in the console writes platform; a direct chat's chatId = the other person's userid
    "oc_…":      { "workdir": "…", "platform": "feishu" }
  }
}
```

**When a group has no `platform`**, it is inferred from the shape of the chatId (`oc_` Feishu / `wr` WeCom; the two never collide).

- WeCom direct-chat ids have no recognizable shape. With only one platform configured, they belong to it. With both configured and no way to tell, the id belongs to neither side and doctor warns; at run time only the adapter that last delivered an incoming message for that conversation is used (replies go back where the message came from), and synthetic messages for a conversation with no incoming message yet are not sent, only logged.
- Inference only updates in-memory state; it is written to the file only when the group is saved again in the console. If an explicit `platform` contradicts the id's shape (an `oc_` id marked as WeCom), the console refuses it outright.

⚠ **Configured means connected.** A bot allows only one long connection, so **if two machines' configs use the same Bot ID / Secret, they keep kicking each other off** (the new connection kicks the old one, which grabs it back 60 seconds later, in a loop). Create a separate bot for each machine; the startup banner names the bot it connects to.

**At run time**, `src/platform/multi.js` wraps the adapters into a single Platform.

- An incoming message enters the engine carrying its own adapter (the self-briefing is chosen per adapter).
- `send / sendCard / reply` look up the group config by chatId to dispatch (scheduled tasks, upgrade announcements, ops alerts and console group notices all go through it). If ownership can't be determined and there are several platforms, nothing is sent and it is logged.
- Feishu-only subsystems (canvas / in-place updates of takeover cards / emoji acknowledgements) are installed only when Feishu is configured.

**`sintbot doctor`:**

- `feishu` / `wecom` each report according to the config (complete = ok / missing fields = fail; neither configured = a single warn row).
- The `wecom.cli` row: the tool not installed is only a warning; the fallback is that the group shows userids and the assistant can't post images.
  - ⚠ The tool has **separate 7-day capability grants** for "messages" and "contacts", which `auth show` doesn't reveal. The precheck probes the "contacts grant" separately, and hitting 850003 at run time goes to the ops alert group (the creator clicks the renewal link).
  - 853006 means the official API hasn't opened chat.* to organizations with more than 10 members; it is not a configuration error.
- The `platform` row (the deprecated top-level field) · the `groups.platform` row (how many were inferred / which couldn't be determined) · a group row marked with a platform that isn't configured ⇒ a warning that "it will receive no messages".

**The console:**

- On the Settings page, the "WeCom bot" card sits next to the "Feishu app" card. Both are collapsed by default, with a one-line summary in the card header. The WeCom card covers:
  - credentials;
  - a precheck: credential shape / whether the tool is installed / **whether the tool is authorized for the same bot** / how many groups can be bound. It only calls the local CLI and opens no extra long connection;
  - identity and connection: bot name / Bot ID / live long-connection status;
  - bot name / welcome message / member display names;
  - reply without an @: interval / follow-up window / cheap-model gate / call words;
  - the CLI on/off switch.
- In Groups · Projects → Configure group project, when both platforms are configured, the first step is choosing the platform. The WeCom flow is guidance + refresh + candidates (**groups where the bot has been @-mentioned**, merged from two official CLI sources, with group names written back along the way) + manual entry. Saving writes `platform`.
- Group cards show a platform badge, and WeCom groups don't get the canvas row. The Overview has one row each for "Feishu connection" and "WeCom connection".
- WeCom has no API for creating or disbanding groups or adding people, so a new group has to be created in WeCom, the bot added and @-mentioned once, and then chosen in the console.

## 3. Behavior and limits (tested)

### Receiving group messages

**WeCom:** **the long connection only pushes messages that @ the bot.**

**The adapter:** strips the @ from the text and runs **two lanes**.

- **@ messages take the long-connection fast lane.** When the group is busy, they jump ahead of every polled message in the queue; they are never batched with polled messages when dequeued; global concurrency reserves a slot for them; and 4 seconds after answering, the group's history is fetched once more.
- **Messages without an @ take the polling slow lane.** Queuing shows no notice; several messages let through in the same round are batched and answered in one turn; and a pushed reply starts with a quoted line, 「回复 某某:原话」 ("Reply to X: original words"). Pushes don't quote automatically, so this is the only way the group can tell who is being answered. A batch is noted as 「(连同前 N 条)」 ("together with the previous N"), and several people as 「某某 等 N 人」 ("X and N others").

**"Reply without an @"** (**off by default**; to turn it on, set `pollSec` to about 20):

- The official tool fetches the history of bound groups (zero tokens), tiered per group: every 8s inside the follow-up window · normally every `pollSec` · after 10 minutes of silence every max(6×pollSec, 120)s.
- On 850003 / 853006 it pauses entirely for 30 minutes before retrying, and alerts the ops group.
- New human messages pass a **rule gate** before going to the model:
  - messages that name the bot or say 「机器人」 / 「助手」 ("bot" / "assistant") always go through;
  - follow-ups within `followSec` (300) seconds after an @ or after the bot speaks also go through;
  - everything else stays in history without going to the model. Each message fed in is a turn carrying the whole session, which burns quota; `followSec:0` = feed everything, `pollSec:0` = off.
- Polled messages have no req_id, so replies go out as proactive pushes, without streaming.
- They are de-duplicated against @ messages already delivered over the long connection by **plain text** within a 3-minute window (when someone @-mentions the bot with only an image, both sides are empty strings, which is what makes them match).
- The first round after startup only builds a baseline; old messages are not replayed.

**The second gate (optional, `gatekeeper`):**

- For messages the rules don't let through, the last 8 group messages plus this one are put to a cheap model, asking "should the bot take this?"; only YES feeds it to the main model.
- Each check costs tens to a little over a hundred tokens, carries no session and starts no CLI.
- It errs on the side of missing rather than misfiring: unreachable / unparseable / too short / rate-limited all count as NO. Pure media with no text isn't asked about.
- Configuring it in the console, switching its model or turning it off all take effect live.

### Other behavior

| Item | WeCom | What the adapter does |
|---|---|---|
| Receiving direct chats | Everything | chatId = the other person's userid |
| Sender | Only the userid (plain for a bot created by a super admin; otherwise encrypted, like woA2…, and the daemon warns once) | Name: the `names` mapping > cache > a tool people search (waits up to 5 seconds the first time someone is seen; searching by userid uses the name → ID API backwards, so a hit is luck). With polling on, it **bridges from group history**: the moment the same message is seen on both sides, the plain account ↔ `user_name` pair goes into the cache, with zero extra calls |
| Images / files | Links expire in 5 minutes and are AES-encrypted; in a group, images can only come as mixed image-and-text messages | Downloaded, decrypted and saved on arrival (failure to decrypt is reported as a download failure); the text gets an `[图片 path=…]` marker. Serial and in order within a conversation; conversations don't wait for each other. **Images / files from group history (polled):** once the gate lets them through, the content is fetched by media_id through the tool (two response shapes: the framework saved it and returns a path / short content inline), moved into the inbox and renamed with an extension sniffed from the content, and the text gets the same `[图片 path=…]` marker. If it can't be fetched, the text gets 「[图片 下载失败]」 (image download failed) so the agent knows there was an image it didn't get (the reason goes only to the log, since the raw message contains tool names / paths that the agent would repeat) |
| Streaming replies | The same stream.id replaces the content in full; **must finish within 10 minutes of the first frame**; each frame ≤ 20480 bytes | When it reaches the age or size limit, the part already sent is frozen and a new stream.id continues with only the text after the break (「接上条」, "continued"); if the final text doesn't start with the frozen text (milestones stripped), the whole thing is resent; frames are throttled |
| Multiple replies | The same req_id can be replied to several times within 24 hours | Queue notices / progress / the final text all go as replies; synthetic messages (scheduled tasks / console interjections) go as proactive pushes |
| Proactive pushes | Someone must have messaged the bot in that conversation first; only markdown / cards / media are accepted | @ the bot once in a new group; version announcements / alerts / `cron --say` work as usual |
| Markdown | ≤ 20480 bytes; tables, multi-line code blocks and HTML tags are not rendered (`<font>` shows up literally) | Tables become lists (bold headers; with ≥4 columns each cell carries its header name) · code blocks lose their fences and each line becomes inline code · headings become bold lines · tags keep only their text · the footer (time / tokens) becomes a quote line; overlong text is split by line into several messages |
| Cards | button_interaction; button events come over the long connection; updates must reuse the original task_id | `sendCard({title,desc,buttons})`; events go to `hooks.onCardAction`, and returning `{card}` updates it within 5 seconds |
| Recall | No event | "Recalling a message stops its turn" isn't available |
| Disconnects | Messages during the outage are not redelivered; **TCP ESTABLISHED ≠ the subscription is alive** | Ping every 30s; no response for 75s ⇒ drop the connection; a watchdog rebuilds it with backoff. After being kicked by another connection it waits 60s and reconnects once; **kicked a second time within 10 minutes ⇒ it stops connecting and sends an ops alert** (the official line: avoid multiple connections; two machines with the same Bot ID kick each other every minute), reconnecting only after a daemon restart. **Any platform connection not connected for 5 straight minutes ⇒ an alert to the ops group** (`alerts.chatId`, with another message on recovery; the 2 minutes at boot before DNS is ready don't raise false alarms; if the broken platform is the one the alert group is on, it can't be sent and is only logged) |
| Canvas / reactions / editing and recalling | None | The self-briefing doesn't teach these actions, based on `platform.features` |

## 3b. Three paths already split by platform

- **Image-generation notices:** in WeCom groups, the official CLI posts the image plus markdown, with no progress message (messages sent by the tool can't be edited); Feishu groups still get a card. The self-briefing teaches `sbot imagen` as usual.
- **The browser takeover entry:** in WeCom groups, `sbot browser link --send` posts "a page screenshot (when there is a page) + markdown with the link", with no button card or three-state card updates; the takeover page itself reports redemption and expiry.
- **Sender names:** the first time someone is seen, it waits for one people search (up to 5 seconds) before delivering, so even the first message shows a name; manual `names` take precedence. ⚠ Group history can't be used to warm this up: the `userid` in history is the tool's own `woA2…` form, which doesn't match the long connection's plain id. When the alert group is a WeCom group, doctor reminds you that the bot must have been @-mentioned there first.
- ⚠ **The tool interprets time literals as Beijing time** (regardless of the host's time zone; formatting in the host's time zone shifts the window and returns nothing). The window is 6 days (a full 7 days is refused).

## 4. Built-in skill `sbot wecom`

`send-msg "<text>"` · `send-image <path>` · `send-file <path>` · `history [n]` (history returns the tool's list of "human messages"; in testing it excludes the bot's own). It goes through the official CLI (as the bot, over direct HTTP). It **must not** open another long connection of its own; doing so would kick the daemon offline. Direct-chat ids live in two spaces (the long connection gives the plain userid; the tool only accepts its own woA2… form), so a target in a command that doesn't start with `wr` is first converted through a people search.

## 5. Known limits and open items

- **"@all" doesn't count as an @ of the bot.** The long connection doesn't deliver it, so the bot doesn't respond. Group members may think the bot will answer when everyone is called, but it won't; make this clear in the group.
- "Reply without an @", the cheap-model gate, media downloads from group history and the name bridge only work while polling is on (`pollSec` > 0).
- The gate only handles messages **outside** the follow-up window. Chatter inside the window is still let through by the rules, and the model decides on its own not to reply (at the cost of a turn). Pure images (no text) outside the window aren't fed in, by design.
- Officially there is no switch / event / parameter for "receive without an @". Quoting the bot's message without an @ doesn't trigger it either. `last_msg_time` in the conversation list isn't updated for messages without an @, so it can't serve as a probe. Getting every message requires session archiving (a fixed public IP plus per-seat fees), which isn't done. For an ongoing conversation, a direct chat with the bot is recommended.
- The canvas report card is Feishu-shaped and isn't sent in WeCom groups.
- Decrypting images / files in direct chats is covered only by unit tests; incoming messages haven't been verified on a real machine yet.
- The three ops alerts (connection lost / stopped after being displaced / tool grant expired) have code and unit tests in place but haven't fired on a real machine yet.
- After a power-loss restart, an event saying "another connection signed in with the same bot" occasionally appears while the connection is actually fine and pings normally. It looks like the server's cleanup notice for the old connection; whether @ messages keep arriving afterwards is still being watched.
- Not done:
  - periodically checking that bound groups still exist (`sessions list` doesn't return groups the bot was removed from, which is the only "removed" signal);
  - a `<think></think>` placeholder instead of blank space for the first streaming frame;
  - showing "the last 850003 time" on the console's WeCom card;
  - whether `<@userid>` in the bot's markdown can @ a member (to be verified).
