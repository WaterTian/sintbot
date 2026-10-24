# Slack adapter: mechanics and platform facts

English · [简体中文](./zh-CN/SLACK.md)

> How to create the app and connect it: [platforms/slack.md](./platforms/slack.md). This document covers how the adapter works and the Slack platform facts you must know when writing it (all from the official [docs.slack.dev](https://docs.slack.dev) documentation, and tested on a free workspace).
> Implementation: `src/platform/slack.js` (the adapter, no Slack SDK) · `src/core/proxy.js` (outbound proxy) · `tests/unit/slack.test.js`. End-to-end self-test: `node docs/slack-probe.js echo` (runs only the adapter, without the engine).

## Shape

- **A Socket Mode long connection, with no public entry point.** Slack recommends HTTP for production, but says explicitly to use Socket Mode "behind a firewall, when you can't expose an HTTP endpoint". It is an official channel; reconnects just have to be designed around "it drops periodically".
- **No Slack SDK.** The Web API is all POSTs, so native `fetch` is enough; the WebSocket uses `ws`, which the Feishu SDK already brings in. The SDK doesn't handle the traps we actually need to deal with (ack first, de-duplication, the age gate, loopback filtering, error classification), and for the reconnects it does handle, this repo's state machine in `src/platform/wswatchdog.js` is more trustworthy. All outbound calls go through a single entry point, `createSlackApi()`: `ok:false` is thrown explicitly, every warning is reported, and retries are short and bounded (by default ≤2 retries and ≤10 seconds of total waiting, not the SDK default of "10 retries / about 30 minutes", which causes duplicate messages and frozen progress).
- It sits on the multi-platform router `src/platform/multi.js` and can be online alongside Feishu / WeCom. Group ownership comes from `groups[<chatId>].platform`; when that isn't set, it is inferred from the id's shape (Slack ids are `C|G|D` followed by uppercase letters and digits, recognized only when Slack is configured).
- **Fault isolation:** credential errors (`invalid_auth` and the like) are not thrown in `start()`. Only the Slack connection stops in "connection failed", with an ops alert; otherwise Feishu / WeCom in the same process would fail to start as well.

## Three things to get right from the start

1. **Each user creates their own app; no shared install link.** For non-Marketplace "commercially distributed" apps, `conversations.history` / `replies` are limited to 1 call per minute and 15 messages per call; **internal custom apps are exempt** (Tier 3, 50+ calls per minute, limit 1000). The Real-time Search API and MCP are also open only to Marketplace apps and internal apps. So SintBot provides a manifest template, and users create the app in their own workspace.
2. **One app per machine.** Socket Mode allows up to 10 connections per app, but each event is **handed to one of them at random**, not broadcast. If two machines share an app, messages land on one or the other at random, which looks like "it works sometimes".
3. **Correctness is not built on `conversations.history`.** The event stream is the only source of truth; history is only for compensation. Socket Mode **doesn't redeliver events missed during a disconnect**, and `message_deleted` is a hidden event that never appears in history, so recalls during a disconnect are lost for good. Free workspaces have a 90-day history window, and anything older is silently not returned (`is_limited: true`).

## Receiving messages

- **Ack first, then enqueue**, with no await before the ack. If more than 95% of acks fail within 60 minutes, the event subscription is temporarily disabled.
- **De-duplication by `event_id`** (TTL 10 minutes, covering Slack's redelivery points; Socket Mode frames carry no "this is a redelivery" flag) · **an event age gate** (events older than 10 minutes are dropped by default, so a delayed delivery can't start a turn long after the fact).
- **Three loopback filters:** anything with `bot_id` (detect bots by this field, not by `subtype === 'bot_message'`) · the bot's own user id · `message_changed` (produced by its own `chat.update`, and also by Slack's automatic language detection).
- **Recalling a message stops its turn:** `message_deleted` goes to `onRecall`. Use `deleted_ts` (the deleted message), not `ts` (the delete action). The event doesn't say who deleted it, and **the bot's own `chat.delete` triggers it too**, so filter out its own deletions first. There is also a native Stop button (see below).
- Detecting an @: with `channels:history`, every message in the channel arrives, and the adapter compares against the bot user id itself. **`app_mention` is not subscribed** (subscribing to both delivers @ messages twice).
- Attachments: `file_share` is let through, and files become `[图片 … file_id=…]` markers handed to the agent. Downloading `url_private` needs `Authorization: Bearer xoxb-`; **with bad authentication it returns HTTP 200 and an HTML login page, not a 401**, so sniff the content and never save HTML as a .png.
- With `onlyWhenMentioned: true`, the bot replies in channels only to messages that @ it; direct messages always get a reply.

## In-group controls: Slack owns `/`

Slack treats input starting with `/` as its own slash commands, so `/status` never reaches the bot (and the error for an unregistered command is visible only to the sender). On top of that, **slash commands registered by apps can't be invoked inside threads** (stated in the official docs), while progress and answers all live in threads. Hence three layers of entry points:

| Entry point | Where it works | Notes |
|---|---|---|
| **The `!` prefix** (main entry point) | Anywhere, including threads | The adapter turns `!stop` back into `/stop` for the engine; only commands actually in the engine's command list are converted (otherwise a sentence starting with `!` would get an "unknown command" reply); command words are lowercased |
| Buttons on the progress message: Stop / Skip / Status | In threads | Stop asks for confirmation; there is no "New" button (it clears the session too, so it is left to a typed `!new`) |
| The umbrella command `/sint <command>` | Channels only | The manifest registers one command (with autocomplete). Slash commands **have no namespaces**, and a later-installed command with the same name silently replaces the earlier one, so both the prefix and the umbrella name are configurable (`commandAlias` / `umbrellaCommand`) |

- The App Home tab only explains these three entry points and has no command table (commands differ per group; use `!help`).
- In the outbound direction, the engine's own prompts hard-code things like `/model`, which wouldn't work if followed in a Slack group. So the adapter localizes **what the engine itself says** to `!model`. It **doesn't touch the agent's answers** (a `/status` in an answer may be an HTTP route), and code blocks are skipped entirely.
- Acknowledgements of slash commands and buttons are posted to the channel with `chat.postMessage` (otherwise others wouldn't know who stopped what). They have no platform timestamp, so they are marked as synthetic messages and don't advance the watermark.

## Progress

```
message received → ⏳ on the user's message
                 → a progress message in the thread (with top-level text)
                 → agents.sessions.setStatus(processing): native "Working…" + Stop button; renewed every 5 minutes (1-hour timeout)
                 → throttled chat.update refreshes the progress (20 seconds by default, doubling on a 429, capped at 60 seconds)
                 → the answer goes out as a separate chat.postMessage
                 → the progress message is deleted → setStatus(active) → ⏳ becomes ✅
```

- The native status plus Stop button, character-by-character streaming, and rewriting progress in place are three **independent** things. Agent Sessions doesn't require the streaming API, and **streaming isn't available in public channels at all** (`channel_type_not_supported`; it works in DMs), so groups use the "edit the message" route. It works on the free plan in testing; the switches are `features.agent_view` in the manifest plus a subscription to `agent_session_stopped` (without the subscription, the Stop button is a spinner that can't be clicked).
- **The answer must be sent separately:** progress can be lost, the answer can't. Also, edits don't push notifications and new messages do; "ping me when the 40-minute job is done" depends on a new message.
- **Every message carries top-level `text`:** mobile pushes read only `text`; a message with only blocks pushes an empty notification.
- `setStatus(active)` runs unconditionally on the wrap-up path. The official docs say plainly that posting a message doesn't clear the loading state; without the call, it spins until the 1-hour timeout. Clicking Stop doesn't change the status by itself either.
- The throttle isn't the officially suggested 3 seconds: `chat.update` is Tier 3 (50+ calls per minute), **shared across the whole app, not split per channel**. At one call every 3 seconds, a single task uses 40% of the quota.
- The progress message's ts is recorded before deleting it; otherwise the returning delete event would be taken by "recall stops the turn" as a user recall. If the native status isn't available (for example, the app doesn't have `agent_view`), it just degrades without affecting the turn, and remembers not to keep trying.
- Native Stop → `agent_session_stopped` → `engine.stop(chatId)`; it asks for no confirmation and doesn't clear the queue.
- Messages with `bot_id` **don't show an "edited" label** after edits, so refreshing progress repeatedly leaves no trail.

## Silent failures: `ok:true`, but nothing happened

The countermeasures are built into `createSlackApi()`: **every response is checked for `warning` / `response_metadata.warnings`**, and "delivered" is judged by side effects (the returned `ts` for messages, non-empty `shares` for files); when needed, `chat.getPermalink` confirms the message really is in the channel. The most important ones:

| Trap | Consequence |
|---|---|
| Calling read methods (`users.list` and others) with a JSON body | Parameters are **ignored entirely**, `ok:true`, and pagination / filters all stop working ⇒ everything outbound is form-encoded |
| `Content-Type` with a `charset` | Every response carries a `superfluous_charset` warning, drowning out real warnings |
| `chat.update` with `text` but no `blocks` | The existing blocks are silently cleared ⇒ always send both |
| `files.completeUploadExternal` without `channel_id` | The file is only hosted privately; nothing appears in the group |
| `text` over 40,000 characters / more than 50 blocks | The tail is silently truncated / dropped, with only a warning ⇒ the adapter truncates the text itself and says so |
| `conversations.list` `types` defaults to public channels only; filtering is applied afterwards | Private channels are missing entirely; a page with fewer items than the limit doesn't mean the end; check `next_cursor` |
| Adding event subscriptions without reinstalling the app | The events silently have no effect |
| `chat.postEphemeral` | Delivery isn't guaranteed ⇒ never used to carry an answer |

## Reliability

- Error codes are handled in four classes: retryable (`ratelimited` / `internal_error` / `service_unavailable` …) · **fatal** (`token_revoked` / `invalid_auth` / `account_inactive` / `missing_scope` …: stop all retries and alert) · channel-level (`channel_not_found` / `not_in_channel` / `is_archived` …) · update failures (`edit_window_closed` / `message_not_found` / `cant_update_message` …: immediately post a new message instead and switch the progress-message pointer).
- Reconnects: exponential backoff with jitter, at least 1.2 seconds apart (`apps.connections.open` is Tier 3, and a crash loop would hit 429s); only one standby connection at a time. When 90% of the `hello` frame's `approximate_connection_time` (about 5 hours in testing) has passed, it switches connections proactively. A disconnect `warning` arrives about 10 seconds before the disconnect; the community has also reported an undocumented `too_many_websockets`. For debugging, append `&debug_reconnects=true` to the wss URL to shrink the connection lifetime to 360 seconds.
- `goodbye` / `reconnect_url` belong to the old RTM API; Socket Mode doesn't send them.
- Slack **has no daily or monthly total call quota** (unlike Feishu); rate limits are all per-minute tiers. Pushing on after hitting a limit risks getting the app disabled.
- Outbound proxy: Node's `fetch` and `ws` don't read `http_proxy`, so REST and WebSocket share the CONNECT tunnel in `src/core/proxy.js` (only `http://` proxies; with none configured, it connects directly). When the proxy isn't taking effect, the symptom is `UND_ERR_CONNECT_TIMEOUT`, or "connected, but no hello ever arrives"; neither says "the proxy wasn't used".

## Scopes and the manifest

- A complete, paste-ready manifest is in [`slack-app-manifest.yaml`](./slack-app-manifest.yaml) (details and reasons are in its comments, not duplicated here): 17 bot scopes (including `commands` for the slash command); the events are 4 `message.*` events + `agent_session_stopped` (native Stop) + `app_home_opened` (App Home); `socket_mode_enabled: true`, `features.agent_view` and the umbrella command `/sint`.
- Prefix meanings: `channels:` public channels · `groups:` private channels · `im:` direct messages · `mpim:` group DMs. **None of the four covers another.** Invited into a private channel without `groups:history`, the bot receives not a single message. `mpim:history` doesn't imply `mpim:read` either.
- Deliberately left out: `app_mentions:read` (see above). `im:write` is needed only to start a new DM conversation proactively; receiving and replying to DMs only needs `im:history` + `chat:write`. **Token rotation is not turned on:** it is a one-way switch that can't be turned off once on, and access tokens then expire after 12 hours.
- The app-level token (`xapp-`) needs `connections:write` and must go in the `Authorization` header.
- New apps can only use `agent_view` (`assistant_view` has been announced as deprecated). System notifications are now sent by the `USLACK` user, no longer by Slackbot.
- When binding a group, the console lists channels with `users.conversations` (which returns only channels the bot is in), not `conversations.list`; listing channels the bot isn't in would invite people to bind a dead group.

## Rich text

- It uses the **`markdown` block**, which accepts standard Markdown, so the agent's output is sent basically as is. Tables (≤100 rows × 20 columns, ≤10,000 characters for all tables in a message combined), task lists, nested lists, code blocks with language tags and heading levels all work in testing; unlike Feishu, tables need no special conversion.
- The `markdown_text` parameter and top-level `text` are **mutually exclusive** (`markdown_text_conflict`), yet both are needed (`text` drives push notifications), so it uses `blocks:[{type:'markdown', text}]` plus top-level `text`, which can coexist.
- `![image](url)` renders only as a link; to show an image, upload it first and use an `image` block (png / jpg / gif only).
- The old `mrkdwn` syntax (`*bold*`, no lists or tables) is not used.
- Link and media previews (unfurls) are always turned off: injected content could use a preview to exfiltrate data.

## Not supported yet / not verified

- **Uploading files in groups** isn't wired up yet (three steps: `files.getUploadURLExternal` → POST the raw bytes → `completeUploadExternal`; the third step isn't idempotent and can be called only once, so a timeout means starting over from step one). Until then, the Slack group's self-briefing doesn't teach the `sbot feishu` family of actions, and `sbot feishu …` in a Slack group is blocked with an explanation.
- Whiteboards are Feishu-only.
- The buttons on progress messages, App Home and the native Stop button's click path have code and unit tests, but haven't been clicked on a real workspace yet; the proxy tunnel hasn't run on a real machine either.
- Whether delayed delivery / event retries / automatic disabling apply to Socket Mode isn't documented officially; the age gate is in place, and its threshold is still to be decided.
- The real shape of `message` + `file_share` events hasn't been tested.
