# Features

English · [简体中文](./zh-CN/features.md)

> What each group's agent can do, and how to use the console. For the full options of any command, run `sintbot <command> --help`.

<p align="center"><img src="https://raw.githubusercontent.com/sintlab/sintbot/main/docs/assets/slack-thread.svg" alt="A turn in a Slack thread: Lin asks SintBot to look into a 500 on staging; it acknowledges, reports progress in the thread from reading logs to running tests, then posts the cause and the pull request it opened" width="760"></p>

## What every group project gets

**The self-briefing.** Every turn, each group's agent receives a **self-briefing** that covers:

- who it is;
- the project directory and repository state;
- its model and execution permissions;
- the console address and the plugins enabled for the group;
- how to use the abilities listed below.

When an ability or the config changes, the briefing is re-injected on the next turn **without resetting the session**. The command names in it are for the agent to run; when it talks to group members, it follows a "no tool names" rule and speaks plainly.

The built-in skills allow list (`Bash(sbot feishu|wecom|cron|imagen|design|preview *)`) is allowed at every permission level. In a Codex group's read-only sandbox there is no network access, so these need full access there.

- **Feishu skills**, `sbot feishu`:
  - send files, images and messages;
  - read the group history, where each message carries its `message_id` and is tagged `→@someone·not @bot` or `→@bot`;
  - reply to, edit or recall the bot's own messages;
  - download group attachments;
  - react with emoji.

  Paths are confined to the project directory, and outgoing text is redacted: secrets always, phone numbers and emails per the group's `redactPii` setting.
- **Design canvas (Feishu whiteboards).** When someone in the group says "draw a …", the agent creates a whiteboard and posts the link. Images and diagrams go on the board; group members draw arrows, add sticky notes or comment there, then say so in the group, and the agent revises according to the annotations.
  - **Diagrams:** Mermaid or PlantUML source written by the agent (`design/diagrams/*.mmd`, committed to the repo) becomes editable nodes that can be annotated and deleted.
  - **Auto-detection** is off by default. Setting `feishu.board.pollSec: 120` makes groups that have a canvas poll every 120 seconds (about 2 API calls each time). New annotations then bring up a "new feedback on the canvas" card in the group; one button applies the changes, and the result lands in the same card.
  - Feishu's monthly API quota is a hard limit per tenant, so check your quota before turning this on.

  Full mechanics and tested behavior: [BOARD.md](./BOARD.md).
- **Design style file**, `sbot design`. `DESIGN.md` at the project root holds the design tokens: palette, typography (a Latin family plus Chinese fallbacks), radii, status colors, gradients, shadows and icons, plus Do's and Don'ts.
  - **Several surfaces:** a project can keep several files as `design/styles/<surface>.md`, where the front matter's `platform:` says whether a file covers a mini program or an admin panel.
  - **Presets and library:** there are sixteen built-in presets. In the console you can create your own, copy one, distill one from a reference URL or a local directory (it reads the page's stylesheets, CDN-hosted ones included, through the configured proxy; what it finds comes back with its evidence, and anything it cannot read leaves the form as it was), or ingest a project's file into the global library.
  - **Delivery to the agent:** the tokens go straight into the briefing every turn, rather than as a path to read.
  - **Four independent checks:**
    - `check` compares the page against the style file: palette, radii, fonts, font availability, and icon parameters and sources.
    - `doctor` checks the style file itself: semantic colors in the wrong section, contrast, non-standard font weights, Chinese fallbacks, and whether the primary font ships with the system.
    - `layout` measures the rendered geometry at several widths: overlapping or clipped text, tap targets under 24px, tiny Chinese text and contrast. It needs the long-running Chrome.
    - `icon-assets` checks icon files: whether colors inherit, duplicate copies of the same icon, and drifting parameters.
  - **Report only, never block:** deviations exit with code 3, which is not a command failure. Deviations judged acceptable are recorded in `design/check-accepted.md`.
  - **Naming the file:** with several style files, every command must name one with `--as <surface>` (`--style` for image generation). Without a name it uses the first file and says so.
- **Icon system**, the fourth dimension of the design system after palette, typography and radii.
  - **Choosing a system:** the project's `design/icons.md` picks one of four: Lucide or Tabler (outline, each the other's fallback), Phosphor or Pixelarticons (filled).
  - **Fetching icons:** `sbot design icon <name…>` fetches icons by semantic name, normalizes stroke and size to the style file and adds accessible names; `--sprite` outputs a sprite sheet.
  - **Fingerprints:** fetched icons carry a source fingerprint, so `check` catches icons from another set, or ones not re-fetched after a system change.
  - **Installation:** the four icon packages are about 160 MB and **do not ship with the package**. Install them separately on the machine; without them, the feature degrades gracefully.

  Contract: [ICONS.md](./ICONS.md).
- **Image bridge**, `sbot imagen`. A group on any model can generate images through the machine's Codex subscription, with no API key.
  - **Asynchronous by default:** a request returns as soon as it is accepted, and a detached worker posts the result to the group, with a progress card that updates itself.
  - **Waiting in place:** `--wait [seconds]` waits and exits 0 when done, 1 on failure, and **2 if it is still running, which is not a failure**.
  - **Editing options:** `--ref <image>` edits that image instead of redrawing from the description; `--mask` repaints only the transparent part of a mask; `--transparent` gives a real transparent background.
  - **Safeguards:** resubmitting to the same output path is refused (exit code 2). A partial result left by a failure moves to `.partial`, so the real path stays absent.
  - **Whiteboard placement:** images that belong to a design flow go on the board automatically; add `--no-board` for one-off images.
  - **Optional:** install rembg for high-fidelity background removal.
- **Group previews**, `sbot preview start <dir or file>`, the **managed** way to show group members an HTML prototype.
  - **How it serves:** a detached static server on a port fixed per group, in the range 4610–4629. The URL has a token prefix.
  - **What it serves:** by default only a subdirectory of the project. Serving the project root needs an explicit `--project-root`, and the group is told.
  - **Cleanup:** servers are reclaimed automatically when idle, too old, when the group is paused or unbound, and the group is told. They are visible and stoppable on the console's Overview.
  - **Why it exists:** the agent no longer has to start its own long-running server or keep a turn open.

  See [PREVIEW.md](./PREVIEW.md).
- **Scheduled tasks**, `sbot cron` or the group card in the console. Three kinds of task:
  - **`--do "<instruction>"`** builds a synthetic message at the scheduled time and starts an agent turn through the full group pipeline.
  - **`--say "<text>"`** just posts a message, without starting the agent.
  - **`--run "<command>"`** runs a command in the project root without starting the agent or taking the group lock.
    - Exit code 0 only leaves a log line and a ledger entry. On failure, the group gets a note with the end of the output.
    - `--escalate` hands failures to the agent instead.
    - `--timeout <minutes>` defaults to 15.
    - Use it for checks and daily reports where the script sends the report itself and the agent only confirms the exit code.

  If a `--say` message or a failure note cannot be delivered, it is retried after 1, 5, 15 and 30 minutes, marked with the original time, and dropped only after four failures.

  Times accept standard cron, Chinese shorthands such as `每天 09:00` (every day at 09:00) or `工作日 8:30` (weekdays at 8:30), or `--at "YYYY-MM-DD HH:mm"` for a one-off task that deletes itself after firing. All times use the product time zone. ⚠ A `--do` task is a hidden competitor for the group lock; review frequent ones as an ongoing cost.
- **Group feedback log**, `/issue <one sentence>`. Any group member can report a problem, not only admins. Reports go to the local event stream `~/.sbot/issues.jsonl`, **with the last turn's technical fingerprint attached**: status, duration, tokens, model and failure reason.
  - In the console's Overview, the feedback log can mark a report and tell the original group in one click.
  - `sintbot issue list --json` supports collecting reports across machines.
  - Each machine keeps its own log and numbering, unrelated to issues on the code host.
- **Memory handoff across models.** After a `/model` switch, the project's accumulated knowledge is kept.
  - The briefing names `CLAUDE.md` and `AGENTS.md` if they exist at the project root. Both are named because claude and codex each read only one of them automatically.
  - It also gives the location of the long-term memory directory and a **rough count** of its entries, and pins a single place to write new memory. It gives coordinates only and copies no content.
  - Claude groups without full access are not pointed at the memory directory: they cannot reach it, and pointing them there would teach them that "this project has no memory".

## The console

The daemon includes a **local web console**: Node `http` plus SSE, bound to `127.0.0.1` by default, with a self-contained single-file front end.

```bash
sintbot ui           # config mode: config / health / provider tests / group bindings (no daemon attached)
sintbot start --ui   # daemon + console: adds live activity, config hot reload and live per-group model switching
```

The default address is `http://127.0.0.1:4600` (`--ui-port` changes the port; `--no-open` skips opening the browser). There are four tabs plus a trial page:

- **Overview**
  - health: are models and groups usable, are MCP servers reachable;
  - the concurrency gauge and each group's busy/idle state;
  - **per-group run controls** when the daemon is attached: ■ stop, ↺ new session, or interject a message into the group. A new session on a busy group interrupts the current task, clears the queue and starts fresh;
  - the live activity stream: streaming turns, tokens and duration, expandable to the full content;
  - the **feedback log**, with pending reports on top and one-click marking that notifies the group;
  - **previews**: running servers, visible and stoppable.
- **Models & library** holds four kinds of global resource:
  1. **Providers:**
     - ➕ add, from a preset or custom;
     - ⚙ configure: endpoint, key and reasoning depth for third-party providers. **Claude gets a subscription-login panel without endpoint or key fields**, with a live login check, a model dropdown and the CLI default as the default;
     - one-click test;
     - **balance and subscription quota**: the percentage is **used** quota, and the ↻ on the right refreshes a single provider;
     - hide, and drag to reorder. Unconfigured providers are not shown.
  2. **Plugin library:** install MCP servers for Claude (`~/.claude.json`) and Codex (`~/.codex/config.toml`) from a command line, with instant refresh. Plugins are not part of the drag order.
  3. **Design style library:** a preview grid of the sixteen built-in presets plus your own, for groups to choose from. You can create one with a form and live preview, distill one from a reference URL or directory, copy one as a new style, or edit in place.
  4. **Icon library:** real samples and names from the four icon systems. The group card picks a system and outline or filled per project.
- **Groups & projects**, a **configuration-only** page. Run controls (stop, new session, interject) live on Overview.
  - **Create a group project:** create a group and add people, browse for a directory (limited to the projects folder, `~/Projects` or `D:\Projects` on Windows, where you can also **create a new project folder**), or dissolve a group.
  - **Switch the model per group.** Switching resets the group's session and takes effect with the next message.
  - **Execution mode per group,** a "restricted ⇄ full access" toggle. Restricted means allow list / `dontAsk` for Claude and `read-only` for Codex; full access means `bypassPermissions` / `danger-full-access`.
  - **Tool permissions per project:** three presets (read-only, developer, full trust) plus hand-edited allow and deny lists, limited to the project directory.
  - **Everything else on the card:** plugins checked per group, scheduled tasks, the repository URL (SSH, with an idempotent init + origin and a connectivity probe), the design style and icon system, always-on preview, the plaintext data switch, pause / resume and unbind.
- **Trial**: a web version of `agent run` / `chat`. Pick a provider and working directory and chat with streaming output.
- **Browser takeover page**, a separate page at `<console address>/browser` with no link in the navigation. It lets you **take over the bot's long-running browser**: the screen is streamed to the page, and you can click, drag and type on a phone or computer for steps only a human can do, such as logins, captchas, sliders and QR codes. Group members can reach this page, and nothing else in the console, through a **single-use link** the agent posts in the group (it opens once and is valid for 10 minutes by default). See "Remote takeover" in [BROWSER.md](./BROWSER.md).
- **Settings**
  - **Run limits:** concurrency cap and per-turn timeout. **Execution permissions are per group; there is no global setting.**
  - **Access addresses:** local, LAN and public URLs with a password hint. When signed in, you can sign out or sign out of all devices.
  - **The Feishu app card:**
    - a collapsible **setup guide** covering the bot capability, the long-connection subscription, the scope list, **data permission scope** and publishing a version;
    - a one-click **precheck** that ticks off the bot identity and each permission, translating error codes into plain language;
    - **multiple admins** (`admins` can hold several): **search the organization directory**, look people up by email or phone, or paste an openId. Admins can be checked to join groups the bot creates;
    - the botOpenId and the response scope.

  Tool permissions and per-group execution modes are on each card in Groups & projects.

Config changes are hot-reloaded under `start --ui`; a running daemon picks them up on its next turn.

### Access from the LAN (phone or another computer)

By default the console binds only to `127.0.0.1` (this machine). To open it from other devices on the LAN, you **must set an access password first**, then bind beyond loopback:

```bash
sintbot ui --set-password        # set the console password (stored with scrypt in config.ui.auth, never in plain text)
sintbot ui --host 0.0.0.0        # open to the LAN (refuses to start without a password; prints the detected LAN URLs on start)
# with the daemon attached: sintbot start --ui --ui-host 0.0.0.0
```

- **A password is required before going beyond loopback.** If `--host` is not loopback and no password is set, startup fails closed. Once a password is set, LAN visitors no longer get a token automatically: they enter the password on a login page, and only then receive a session token (stored for 30 days).
- **Local loopback never needs the password.** Even when the console is exposed (`0.0.0.0`) with a password, opening `http://127.0.0.1:4600` on the same machine goes straight in. The password exists to stop LAN visitors, not same-machine access. The check is whether the request's TCP source address is loopback, which LAN visitors cannot forge. **Exception:** a password set on a **loopback-only binding** (no `--host`) counts as deliberately locking the local console, so local access asks for a login too.
- **Only private address ranges are allowed.** When exposed, the Host allow list widens to `10.`, `192.168.`, `172.16–31.` and `169.254.`; DNS rebinding (an attacker's domain) is still blocked.
- **Public access** does not come from widening the allow list. It needs a server with a public IP as the entry point: an SSH reverse tunnel plus nginx terminating HTTPS. See [PUBLIC-ACCESS.md](./PUBLIC-ACCESS.md).
- **Sign in with Feishu on the public address.** Enter the public address (https://your-domain) in Settings, and add the displayed callback URL in the Feishu developer console under Security settings → Redirect URLs. The login page then shows "Sign in with Feishu".
  - **Only the admins listed under Settings → Feishu app are allowed in.**
  - On the public side, nginx answers the password login endpoint with a 403 outright, so there is no password to guess.
  - Login sessions last 30 days and survive daemon restarts; Settings has "Sign out".
- ⚠️ **Plain HTTP:** on the LAN, traffic can be sniffed, including the password and session in transit. **Use it only on trusted networks.** The console is the operator's full-control surface, including running commands in project directories, so treat it like an open terminal. For the safest setup, use **SSH port forwarding** instead: `ssh -L 4600:127.0.0.1:4600 you@host`, then open `http://127.0.0.1:4600` locally. Nothing is exposed and everything is encrypted.
- Failed logins are audited to `~/.sbot/audit.jsonl` (`ui-login`). To remove the password, delete `ui.auth` from the config.

**Who needs the password:**

| Bound host | Password set | This machine (`127.0.0.1`) | LAN visitor |
|---|---|---|---|
| Loopback (default) | No | ✅ straight in | 🚫 unreachable (not exposed) |
| Loopback (default) | Yes | 🔒 login required (deliberately locked) | 🚫 unreachable |
| `0.0.0.0` / LAN IP | Yes (**required**) | ✅ **straight in** | 🔒 login required |
| `0.0.0.0` / LAN IP | No | ⛔ refuses to start (fail closed) | ⛔ refuses to start |

## Browser automation (optional)

To let the bot in a group drive a browser, especially on real sites where you are **signed in**, we recommend a **long-running Chrome plus the chrome-devtools MCP**. A Chrome instance kept alive by launchd or a service runs with its own profile and a CDP port bound to localhost. Each turn's MCP server connects to that same instance with `--browserUrl`, so:

- you **sign in once** and it stays signed in;
- turns skip the cold start;
- Codex and Claude share one browser;
- SintBot's code needs no changes.

**Why not let the MCP start its own browser each turn?** The login state has to survive across turns and restarts, and Chrome 136+ forbids attaching CDP to the default profile, so a separate persistent profile is a hard requirement. A long-running instance can also carry anti-throttling flags in its launch arguments; the MCP does not add them when it connects to an existing instance with `--browserUrl`. Without them, long tasks get throttled to a halt when the window is covered or the display sleeps.

**The full recipe is in [BROWSER.md](./BROWSER.md).** It covers:

- keep-alive configuration;
- the same MCP arguments on both sides: JPEG screenshots with a width cap to save context, and `--allowUnrestrictedPaths` so screenshots can be saved into the project directory and posted to the group;
- matching timeouts (`tool_timeout_sec` for Codex, `MCP_TOOL_TIMEOUT` for Claude);
- first sign-in and recovery when a login expires;
- full-page screenshots of long pages;
- maintenance and troubleshooting.

**How to install:**

1. Go to **Models & library → Plugin library** in the console and use the **command-line add box**. Paste the **full install command** and click Add. Do not type just the plugin name; add one command at a time.
   - `--scope user` writes it to the user-level MCP config, independent of directories, and the library list refreshes on success.
   - Prefer a **pinned global install** over `npx @latest`, which would check the registry through the proxy on every turn.
2. On the group card under Groups & projects, **check it** in the Plugins section to enable it. Installing is a global action that belongs to the library page; the group card only gates per group. Checking it allows `mcp__chrome-devtools__*`. Codex groups need full access as well.

> **Machines without a long-running browser** (one-off scraping only, or no graphical login session) can let the MCP start a browser each turn: `chrome-devtools-mcp` starts Chrome itself when `--browserUrl` is not given, and `@playwright/mcp` does the same with `--user-data-dir <persistent profile path>`. The cost is a cold start every turn, and you have to handle the login state and anti-throttling flags yourself.
>
> On Windows, **Chinese error messages** from the command-line add box are converted to UTF-8 and no longer garbled. If you still see garbled text, upgrade to the latest version.
