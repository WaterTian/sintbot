# Browser (chrome-devtools MCP): setup and operations

English · [简体中文](./zh-CN/BROWSER.md)

> Group agents need to open a browser, sign in to website accounts and do long, heavy page work. The approach: **a long-running Chrome plus CDP connections**. The Codex and Claude MCP servers both connect to the same instance, so a login lasts and no turn pays for a cold start. The console's Browser page streams the screen over the same CDP port so a person can take over remotely (see [Remote takeover](#remote-takeover-the-console-browser-page)).

## Architecture (one screen)

```
launchd: com.sbot.chrome ──► long-running Chrome (headed, KeepAlive)
        --user-data-dir=~/.sbot/chrome-profile   ← the only place logins are stored
        --remote-debugging-port=9222 (localhost only)
                    ▲                       ▲
   codex spawns MCP each turn ──CDP──┘       └──CDP── claude spawns MCP each turn
   (~/.codex/config.toml)                   (~/.claude.json, user level)
                    ▲
   daemon console /browser (src/cdp.js) ──CDP──┘   screen streaming + input forwarding ⇒ a person takes over remotely (login / CAPTCHA / QR code)
```

- **A separate profile is mandatory.** Chrome 136+ refuses CDP on the default profile; `~/.sbot/chrome-profile` and your personal Chrome run as two instances side by side without interfering.
- **Headed, not headless:** a person can do the first login, scan a QR code, rescue a stuck task or just watch. A real headed Chrome with a persistent profile also holds up better against anti-bot checks. The machine needs a GUI login session (along with automatic login and `pmset` to prevent sleep).
- **The anti-throttling flags must be passed explicitly.** When the MCP server launches Chrome itself, Puppeteer adds them; connecting to an existing instance with `--browserUrl` loses them. Put them in the launchd arguments (below), or long tasks get throttled and stall when the window is covered or the display sleeps.
- Proxy: Chrome follows the system proxy; don't hard-code `--proxy-server`.

## Reference configuration

**launchd** `~/Library/LaunchAgents/com.sbot.chrome.plist` (RunAtLoad + KeepAlive):

```
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  --user-data-dir=/Users/me/.sbot/chrome-profile
  --remote-debugging-port=9222 --window-size=1280,720
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding --no-first-run --no-default-browser-check
  --hide-crash-restore-bubble
```

**The same args on both MCP sides.** Pin the command to the absolute path `/opt/homebrew/bin/chrome-devtools-mcp`, because the launchd environment has no Homebrew PATH. Install the package globally at a pinned version, such as `npm i -g chrome-devtools-mcp@1.6.0`, and upgrade by hand. Don't use `npx @latest`, which would query the registry through the proxy every turn.

```
--browserUrl=http://127.0.0.1:9222
--screenshotFormat=jpeg --screenshotQuality=70 --screenshotMaxWidth=1280
--categoryPerformance=false --usageStatistics=false --allowUnrestrictedPaths
```

`--allowUnrestrictedPaths` is what makes saving screenshots work. Neither Codex nor Claude negotiates MCP roots, so without it the `filePath` of `take_screenshot` may only point to the system temp directory, and writing to the project directory fails with Access denied. The agent then cannot take the proper route of "save the screenshot in the project directory → post it with `sbot feishu send-image`" (in testing, a 15,038 px full-page JPEG was only 168 KB, so saving to disk is no burden).

- On the Codex side, also set `startup_timeout_sec = 30` and `tool_timeout_sec = 300` (the defaults of 10 / 60 can't handle long operations).
- The Claude equivalent: add `MCP_TOOL_TIMEOUT: "300000"` (milliseconds) to the provider's `env`.
- The tool surface is trimmed to 26 tools (the performance category removed; extensions and memory are off by default). JPEG screenshots use 3–5 times less context than PNG.
- Permissions: Codex groups need full access; for Claude groups, tick chrome-devtools on the group card in the console (enabling it allows `mcp__chrome-devtools__*`).

## Login runbook

1. First login: on this machine's screen (or over screen sharing), sign in to each site in the bot's Chrome window; once saved to disk, it lasts. If nobody is near the machine, use [remote takeover](#remote-takeover-the-console-browser-page): the agent sends a one-time link and the person does it on their phone. ⚠ Don't relay verification codes or passwords through the group.
2. **The Google account trap:** with CDP on, Google's sign-in page may say "This browser may not be secure" and refuse. Temporarily drop `--remote-debugging-port`, start Chrome once with the same profile, sign in, then switch back to the long-running config.
3. Expired login sessions are normal. When the agent finds it has been signed out, it posts a takeover link in the group and a group member signs in again on their phone. The headed window by the machine can also be taken over by hand at any time.
4. Some sites sign you out when the exit IP changes. Give that domain a fixed exit in your proxy tool.

## Screenshots (especially long pages)

- **Screenshots for the group always go through a file:** `take_screenshot` with `filePath` (saved in the project directory) → `sbot feishu send-image` to the group. Pasting into the reply context costs tokens and may not even be visible (text-model providers strip images).
- **Groups on text-only models** (providers marked `vision:false`, such as glm-5.2): this is a hard constraint, not "saving some tokens". A screenshot without `filePath` reaches the model as a single line of placeholder text, yet the model believes it has seen the page. Once the flag is set, the self-briefing puts this into the agent's self-knowledge (screenshots always with filePath; read pages only with take_snapshot). Without the flag, the whole turn crashes with a 400 ([DESIGN.md §4.3](../DESIGN.md#43-image-fallback-for-text-only-models)).
- **For long pages, add `fullPage: true`** to capture everything in one image (native CDP full-page capture, not stitched); 15,000 px tall works fine in testing. For especially long or large images (Feishu image messages are limited to 10 MB and a maximum resolution), send the original with `send-file` instead.
- **Floating elements leave artifacts:** `position: fixed/sticky` top bars and bottom navigation are drawn in a full-page screenshot at the scroll position when the screenshot was taken, so a screenshot taken mid-page freezes the bottom navigation in the middle of the long image. Fix it first with `evaluate_script`:
  ```js
  window.scrollTo(0, 0)
  for (const el of document.querySelectorAll('*')) {
    const p = getComputedStyle(el).position
    if (p === 'fixed' || p === 'sticky') el.style.setProperty('position', 'absolute', 'important')
  }
  ```
  (After fixed → absolute, the bottom navigation falls back to its place in the document flow; use `display:none` if you don't want it at all. A `navigate_page` reload afterwards restores the page, so later operations are unaffected.)
- For a detail, the `uid` parameter captures a single element (mutually exclusive with fullPage).
- The default format, quality and width come from the startup flags (jpeg · 70 · ≤1280 wide) and can be overridden per call.
- For extremely long pages (over about 16,000 px, close to Chrome's texture limit), consider scrolling with evaluate_script and taking several images in sections.

## Long-running maintenance

- **Memory growth:** after a few days of heavy work, restart Chrome while it is idle with `launchctl kickstart -k gui/$(id -u)/com.sbot.chrome` (one second; logins are on disk and survive). There is no automatic nightly restart, because it would kill batch jobs running overnight.
- **Tab discipline:** the agent is told to open pages with `new_page` and `close_page` when done. For getting information, `take_snapshot` / `evaluate_script` come first (text, cheap); screenshots only when something must be seen.
- **Concurrency:** each turn has its own MCP process and its own tabs, and CDP input injection does not take OS focus, so several groups at once is basically safe. If they ever really step on each other, add `--experimentalPageIdRouting` (the official multi-agent approach) to both sides' args; the architecture stays the same.
- **Jobs longer than 2 hours:** split them across turns (browser state survives between turns) or schedule them overnight with `sbot cron --do`. The wall-clock limit `maxTurnTimeMins` **defaults to 30 minutes**; machines that run long browser jobs should raise it in their own config (to 120, for example).

## Troubleshooting

| Symptom | Check / fix |
|---|---|
| Tools say they can't connect to the browser | `curl http://127.0.0.1:9222/json/version`; if it fails → `launchctl kickstart -k gui/$(id -u)/com.sbot.chrome` |
| Chrome didn't start | The machine needs a GUI login session (automatic login); `launchctl list \| grep sbot.chrome` |
| MCP startup times out | Make sure `/opt/homebrew/bin/chrome-devtools-mcp` exists (it comes back if the global package is removed); on the Codex side, `startup_timeout_sec` |
| Browser tools unavailable in a group | Claude groups: tick the plugin on the group card; Codex groups: full access is required |
| A whole turn fails with 400 "Model only support text input" after a screenshot | The group uses a **text-only model** that isn't flagged. In the console, go to Models · Library → that model's card ⚙ and tick "This model does not support images" (glm-5.2 and others; ⚠ the option only appears for third-party providers, since Claude uses the subscription login panel and the whole lineup supports images). Images then degrade to placeholder text automatically, and the agent's self-briefing tells it "you can't see images; screenshots must use filePath" |
| Several accounts on the same site | Start a second Chrome instance (different profile and port) and point groups at different `--browserUrl`s (not built; do it when needed) |

## Remote takeover (the console `/browser` page)

**Why it exists:** a login, CAPTCHA, slider or QR code is **a step only a real person can do**. Without takeover, the only options are relaying codes through the group turn after turn (slow, and it puts passwords in the group; the agent simply cannot drag a rotating slider) or finding someone next to the machine. Now the bot Chrome's screen is streamed to the console, and a person taps, drags and types directly on a phone or computer.

**Shape:** `/browser` is a standalone page (it does not load the whole console). Tabs are chosen at the top; the screen is in the middle (frames are pushed when the page repaints, so a still page uses no traffic; about 12 KB per frame at phone size); below are a text field plus Enter / Backspace / Tab / Esc / arrow keys. A "Tap / Scroll" toggle sets what a finger gesture means (in tap mode, dragging drags a slider). Input goes in as trusted CDP events, indistinguishable from a real person; Chinese is inserted as text, so phone input methods work.

**Who can get in** (two doors, both decided in `src/ui/server.js`):

- **Console admins:** open `<console root>/browser` directly, with their own token. There is no entry in the navigation bar for now (the feature is still being refined).
- **One-time links:** the agent runs `sbot browser link --tab <URL fragment>` in the group (or an admin clicks "Takeover link" on the page) to mint `<console root>/browser#k=<ticket>`.
  - **The ticket is in the URL fragment**, which browsers never send to the server, so it stays out of nginx access logs, and the bare GETs of link previews and security scanners can't take it. The page reads the fragment, a person clicks "Start takeover", and a POST exchanges the ticket for an HttpOnly cookie, voiding the ticket (**single use**).
  - It is valid for **10 minutes** by default (`browser.takeoverMinutes`, 1–60). The cookie **is accepted only by `/api/browser/*`**; every other console API returns 401. Cookie holders cannot mint tickets or open new URLs.
  - **`--tab` binds the ticket to one tab** (the other person can see and operate only that page; always pass it). "Sign out all devices" revokes takeovers too.
  - Minting a ticket requires either an admin token, or local loopback with no reverse-proxy headers plus an `X-Sbot-Local: 1` header. The custom header forces a CORS preflight, so cross-site POSTs from web pages on this machine can't get through.
  - The link's root: the public address, else the LAN address, else 127.0.0.1 when only loopback is bound (the command says plainly that "only this computer can open it", so a dead link is never posted to the group).
- Audit (`~/.sbot/audit.jsonl`): minting `takeover-mint` (with the bound tab and reach) · using a ticket `takeover-use` (including refused second attempts) · each stream ending `takeover-stream` (frames / seconds / input count) · an explicit end `takeover-end`. Frame contents and input contents are not written to disk.
- Several people watching one tab: one stream with several subscribers; a frame is acknowledged to the browser only after everyone has received it (the slowest viewer sets the frame rate), and the stream stops when the last person leaves.
- **A taker's stream follows their session:** clicking "End takeover", an admin's "Sign out all devices" or the ticket expiring ⇒ the server cuts that stream on the spot (the admin's own stream is unaffected); the page switches to "expired" when its reconnect hits a 401. Without this, the picture would keep streaming after the session ended: input would already get 401s, but a 10-minute ticket could keep watching indefinitely.

**Page layout (modes by identity × stage):**

- A group member opening the link first sees **one full-screen sentence and a button** ("The bot is asking for your help … Start takeover") and enters takeover mode only after clicking.
- Takeover mode has only that page's title (no tab dropdown, no new tab, no way into the console), the screen, "Tap / Scroll" and "End takeover", and the keyboard. A hint floats over the first frame ("Tap and drag right on the screen; use the box below to type") and disappears at the first touch. For group members, the status bar only says "Ready"; size and frame counts are troubleshooting info shown to admins.
- Ended, expired and no-ticket each get a full-screen panel whose text points back to the group ("ask the bot in the group to send a new one"), never the server's raw "unauthorized".

**Zooming and panning:** the bot's page is usually a 1280-wide desktop page, unreadable when shrunk to a 390-wide phone screen.

- Two-finger pinch zooms and two-finger drag pans (one finger still belongs to the page). The mode toggle has three states, "Tap / Scroll / Move"; in Move, one finger drags the view and the wheel zooms. On desktop, ctrl+wheel (trackpad pinch) zooms. Top right: − / percentage (click to reset) / +.
- Only the CSS transform changes; coordinate mapping reads the transformed rectangle, so it needs no changes. Zooming in by more than 30% restarts the stream at the new size (without clearing the screen); otherwise a 780 px frame blown up three times is a blur.
- ⚠ A one-finger press sends its down event after a 120 ms delay; if a second finger lands in that window for a pinch, the press is dropped, so the page never receives a stray tap.

**A ticket takes precedence over a console token stored in the browser.** **If there is a ticket, or the person is already in a takeover session, it is always handled as a takeover** (ignoring any console token stored in that browser). Otherwise, clicking the group's link on a computer that has a stored console token would open the admin layout, and if that token had expired the whole page would fail to load. The same link behaves identically on phone and computer; opening `/browser` without a ticket still gives the admin layout. When the admin token is invalid, the page clears it and asks the person to sign in again, rather than leaving a dead page that can't connect.

⚠ **Measured latency** (public tunnel · desktop size · no token): tunnel round trip averages **254 ms** · scroll to visible change **544 ms** · tap/type round trip **about 400 ms** · **0 frames** while still for 3 seconds · **27 KB** per frame. Usable, but it doesn't feel local.

⚠ Two rules for the page implementation:

- **Once an overlay has pointer-events:none, every clickable thing inside it must be re-enabled individually.** Re-enabling only `a` and not `button` meant a finger tap on "Start takeover" passed straight through with no effect, which a programmatic click() on desktop cannot catch.
- **The hidden attribute is overridden by any display rule**, so a global `[hidden]{display:none!important}` is the backstop.

**The agent side:** the self-briefing teaches: "on hitting a login wall / CAPTCHA / slider / QR code ⇒ `sbot browser link --tab <fragment> --send` ⇒ **the command posts a card to the group itself** (a screenshot of the current page + a 'Take over browser' button + the validity period; ⚠ the text doesn't single out phones, since a computer works just as well) ⇒ let a person do it on a phone or computer ⇒ the login stays on this side, and you carry on afterwards; never ask for passwords or codes in the group; on login pages, use fill / click for real input".

- The daemon flips the card through four states: someone clicks "Start takeover" ⇒ "Takeover in progress" (blue); "End takeover" or time up ⇒ "Takeover ended" (green); the ticket expires with nobody coming ⇒ "Expired" (grey).
- The wording is fixed in code (`src/platform/takeovercard.js`, no tool names), not improvised by the agent each time. If the screenshot or image upload fails, the card is still sent, just without an image.
- The engine injects the console address through `SBOT_UI_URL`. Without the console (`sintbot start` without `--ui`), the command explains why, and the self-briefing does not teach this route.

**Configuration** (top level of `sbot.config.json`, optional): `"browser": { "cdpUrl": "http://127.0.0.1:9222", "takeoverMinutes": 10 }`. `sintbot doctor` gains a `browser` row: ok when reachable; a warning when unreachable, but only if a browser block is configured.

**Costs and limits:**

- Passkeys (which need this machine's biometrics) can't be done through takeover either; a QR code needs a person looking at the page on a computer and scanning it with a phone.
- Over the public internet, the screen travels through the console's existing tunnel and HTTPS. The risk of a link being forwarded to a third party is contained by "opens only once + short-lived", but still confirm who the recipient is before sending.
- Implementation: `src/cdp.js` (CDP client + streaming + input translation) · `src/ui/takeover.js` (tickets / cookies) · `src/ui/browserroutes.js` (APIs) · `src/ui/browser.html` (the page).

## Security position

Port 9222 is bound to localhost only, but any process on the machine can use it to control the signed-in browser. That is acceptable on a single-user dedicated machine; don't copy this setup to a shared machine, and sign in to only the accounts the work needs in the bot's Chrome. `--allowUnrestrictedPaths` is the same: MCP file writes (saved screenshots) are not path-fenced, which relies on the premise that group agents already have execution rights on this machine.
