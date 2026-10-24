# SintBot design

English · [简体中文](./DESIGN.zh-CN.md)

> For people who are going to change the code: the architecture, module boundaries and the "why" behind the key mechanisms. For usage, see [README.md](./README.md) and [docs/](./docs/); for development conventions, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## 0. Core idea

A Node daemon that bridges chat platforms (Feishu / Slack / WeCom) to **headless Claude Code / Codex CLI**. SintBot does only **deterministic orchestration**; all the intelligence lives in the `claude` / `codex` processes it spawns.

> **Keep the agent framework; swap only the model brain.** Tools, the agentic loop, MCP, skills and project memory all belong to the CLI. SintBot only decides whose model answers this turn, in which directory, with which permissions.

This is the opposite of a Claude Code plugin: a plugin lives **inside** a session, while SintBot lives **outside** and drives the CLI as a child process. Nobody has to keep an interactive session open, and every vendor's model gets equal footing under the same mechanics.

## 1. Technology choices

| Decision | Choice | Why |
|---|---|---|
| Language | Node.js (≥ 22) | JSON-over-stdio is Node's home turf; the chat platforms' official SDKs are all available |
| Driving the CLI | stream-json / `--json` over stdio | No PTY screen scraping and no embedded SDK, which keeps the surface affected by CLI upgrades as small as possible |
| Process model | **Spawn per turn + resume the session** | No long-lived child processes to manage, and one crashed turn doesn't affect the next; the cost is a 1–2 second cold start per turn |
| Swapping models | Inject env for an Anthropic-compatible endpoint into `claude` | GPT doesn't speak this protocol ⇒ it uses a second runner (`codex exec`); see below |
| Platform connections | All **outbound only**: Feishu long connection · Slack Socket Mode · WeCom long connection | No public entry point needed, zero idle cost |
| State | JSON files + atomic writes (`store.js`) | Enough for a single machine, crash-safe |
| Running as a service | `sbot service`: macOS launchd · Linux systemd user service | On Windows it only prints NSSM / pm2 commands |

- **How each turn runs:** `claude -p … --resume <sid> --output-format stream-json`; the session id is taken from the first `system/init` event and stored for resuming next turn. Codex works the same way (`codex exec … resume <thread_id> --json`; see [docs/CODEX-RUNNER.md](./docs/CODEX-RUNNER.md)).
- **Why GPT uses the Codex runner:** a separate runner that runs the official `codex exec` directly uses the native protocol with zero translation loss, and authenticates with the machine's ChatGPT subscription. Squeezing GPT into `claude` through a protocol-translation router would reuse every mechanism, but fidelity suffers when reasoning, tools and streaming combine, and it needs a separate platform API key. The cost is that Codex groups have only two sandbox levels (§4.1).
- **Compacting long sessions:** a resumed session's history only grows. Each turn passes `agent.autocompactTokens` (default 400,000; 0 = off) to the runner: claude turns it into `--autocompact`, codex into `-c model_auto_compact_token_limit=`. Past the limit, the CLI compacts in place and the session id stays the same.
- **Token accounting** always records **this turn's increment**. Codex reports session totals; once a runner declares `usageCumulative`, the store computes the difference against a baseline (core doesn't know runner names).

**Models** (for exact endpoints, model ids and each vendor's tuning env, [sbot.config.example.json](./sbot.config.example.json) is authoritative):

| Provider | How | Notes |
|---|---|---|
| `claude` | Subscription login | No endpoint and no key; leave model out to follow the CLI default |
| `glm` / `deepseek` / `minimax` / `volcano` | Anthropic-compatible endpoint + API key | The two GLM-5.2 presets carry `vision:false` |
| `codex` | `runner:"codex"` | The ChatGPT subscription from the machine's `codex login`; also the default fallback when Claude's quota runs out |
| `gpt` / `kimi` | Hidden templates | The translation-router route ([docs/GPT-ROUTER.md](./docs/GPT-ROUTER.md)) / added under "Custom" in the console |

Third-party models generally make worse tool calls than Claude, which providers note with `toolQuality`; `--effort` / thinking are often ignored by non-Claude endpoints.

## 2. Architecture and module boundaries

```
bin/sbot.js                CLI entry point and wiring (setup / start / ui / doctor / service / built-in skill subcommands …)
src/config.js · health.js · service.js   config loading and validation · health checks shared by doctor and the console · service units
src/installdeps.js         setup installs claude / codex for new users (switching to a mirror when the npm registry is unreachable); install.sh at the repo root is the one-line installer
src/setupmodels.js         rules for setup's model step: recommended order (Claude subscription → Codex → DeepSeek), where each vendor issues keys and its international endpoints, plain-language trial-run failures
src/core/                  — knows only interfaces, never specific platforms or models —
  interfaces.js            Platform / AgentRunner contracts (type notes)
  engine.js                message routing, per-group sessions / locks / queues, de-duplication and watermarks, slash commands, the self-briefing
  store.js · ledger.js · redact.js     atomic JSON state · one-line-per-turn ledger (turns.jsonl) · outbound redaction
  scheduler.js · cron*.js              scheduled tasks: scheduling / time syntax / actions when due / running scripts
  pending.js · instancelock.js         redoing interrupted turns · single-instance lock
  quota*.js · opsalert.js              quota alerts and reset times · the ops alert group
  time.js · proxy.js · issues.js · mdtable.js   time zone rules · outbound proxy · in-group feedback log · table detection
src/agent/
  claudecode.js · codexcode.js · runner.js     the two AgentRunners · dispatch by provider.runner
  visionproxy.js · winexec.js                  image fallback for text models · Windows executable resolution
  quotaerr.js · transienterr.js                criteria for the two error classes: "only switching models helps" and "try again later"
  *status.js · claudeusage.js · claudemodels.js   login state · subscription quota · Claude model candidates
  imagen.js · askonce.js                       the image bridge · one-off model questions (no CLI, no session)
src/platform/
  feishu.js · slack.js · wecom*.js · wswatchdog.js   the three platform adapters · the Feishu long-connection watchdog
  multi.js · cli.js                            several platforms combined into one Platform · a stub platform for driving the engine from a terminal
  board*.js · takeovercard.js                  Feishu whiteboards · browser takeover cards
src/ui/                    the console: server.js (HTTP + REST + SSE) · console.html / browser.html (self-contained single files) · dashboard.js ("Needs you" and the ledger backfill) · auth and sessions
src/*.js                   design style files · preview servers · plugins · repository linking · project-root fence · project memory · leftover processes · upgrade announcements · usage · CDP
```

**Rule: `core/` never refers to a specific platform or model by name.** Platforms tell the engine how they differ through a few self-describing fields (`skillCmd`, the built-in skill command name; `features`, which abilities are missing; `chatLabel`, what to call a group), and runners through contract flags (such as `usageCumulative`). Adding a platform or backend = adding one file that satisfies the contract, with no engine changes. Any decision that touches the file system, git or specific CLI behavior gets a reader injected by bin; core only decides and prints.

## 3. Message flow

```
platform event → adapter normalizes → InboundMessage{chatId, userId, text, msgId, media, ts}
  → multi merges all platforms into one entry point (outbound is routed back to each group's platform) → engine
  → de-duplicate (msgId) + drop messages older than the startup time + watermark (drop stale redeliveries)
  → slash commands (/model /new /stop /skip /status /hud /issue /help) handled on the spot
  → per-group lock: busy ⇒ enqueue and reply "queued"; on dequeue, the accumulated messages are combined into one batch prompt
  → look up the group's provider / workdir / session id; inject the self-briefing only if it changed
  → runner.runTurn → normalized event stream
  → lazily create the card (only on the first output that can't be NO_REPLY) + cumulative updates; every exit path wraps up
  → persist the session id, advance the watermark, record usage, dispatch the next message
```

One session per group, shared by its members. **The watermark belongs only to platform messages:** synthetic messages such as scheduled tasks and canvas buttons use the local clock, and mixing them with the platform server's clock would swallow real people's messages, so they bypass it entirely.

## 4. Subsystems

### 4.1 Runners and permissions (the top risk of having nobody to approve)

- Running headless, nobody clicks "Allow", so it is **policy-driven and never hangs**. claude uses `--permission-mode dontAsk` plus each group's `allowedTools` / `disallowedTools`: allow-listed tools run automatically, everything else is refused automatically. The CLI framework enforces it, so it behaves the same whichever model backend is used.
- Permissions are **set per group only**; there is no global allow list. `groups[].permissionMode` has only two levels: `dontAsk` (default, fail-closed) and `bypassPermissions` (full access); other modes hang when headless. Allow / deny lists also have three presets (read only / development / full trust).
- The child process's cwd is the group's project directory, and `--add-dir` grants only that directory ⇒ file tools are confined to the project. Bash has no OS-level directory fence; its boundary is the allow list. **Allow / deny lists prevent accidents, not circumvention**; the real boundary is the scope of the credentials themselves.
- Built-in skills (§4.6) are allowed at every permission level: `BASE_SKILL_ALLOWS` is appended to every group's allow list.
- Codex has no per-tool allow list, only two sandbox levels: `read-only` (no network inside the sandbox) / `danger-full-access`. For consistent behavior across platforms, `workspace-write` isn't used.

### 4.2 Switching models

- Two entry points: the console's group card and `/model <name>` in the group, and any group member can switch. When a model's quota runs out, the backend tells people to "try another model", and at that moment only the people in the group are around.
- **Both entry points use the same write action, which does four things together:** persist the config + the runtime override + clear the session + clear the session's usage account. Skip persisting ⇒ it snaps back after a restart; skip the override ⇒ this turn still uses the old model; skip clearing the session ⇒ a Codex thread id gets fed to claude's `--resume` and breaks on the spot.
- Names match exactly (only case is relaxed); `hidden` providers are neither listed nor switchable; while the group is busy, the switch is refused with the next step to take.

### 4.3 Image fallback for text-only models

A model that can't read images (a provider marked `vision:false`) fails the whole turn with a 400 when it receives one. SintBot can't intercept the request body between `claude` and the upstream, so it puts a **zero-dependency local proxy** in between (`visionproxy.js`). The upstream address is encoded in the proxy's path prefix (so one stateless proxy serves every group); the proxy replaces image blocks in requests with placeholder text and passes auth headers and streaming responses through untouched. Only `vision:false` goes through the proxy. At the same time, the self-briefing tells the agent "you can't read images", and the browser screenshot convention switches to saving to disk plus text snapshots, so the agent doesn't talk to itself about placeholder text.

### 4.4 Turn lifecycle: a group never gets stuck

- **Settle as soon as the answer arrives:** the runner's `result` event wraps up the card, records usage and releases the concurrency slot.
- After settling, a hard timeout `agent.hardReleaseMs` (default 20 seconds) is armed: if the process still hasn't exited, the group lock is force-released, the process tree is killed and the next message is dispatched. `/stop` / `/new` release immediately.
- After the answer, claude gets only 3 seconds (its session is saved continuously, so MCP child processes lingering on the pipes can be killed quickly). Codex saves its session record only on a **clean exit**, and a hard kill makes the next resume fail, so it gets the full 20 seconds.
- Session ids are persisted by **turn identity**, so a force-released turn returning late can't revive a session that has been cleared.
- **When a session can't be resumed, the turn is redone once in a new session.** Two shapes:
  1. An empty turn (no output): first retry once in the same session; if the previous turn was interrupted, or resuming came back empty twice in a row, switch to a new session.
  2. The resumed session's record is gone (Claude Code deletes session records untouched for 30 days by default, and the CLI fails at startup with "No conversation found"): no error; switch to a new session directly.

  Both say why in the group: what is lost is the chat context, while project conventions and long-term memory on disk are unaffected. Each message switches at most once.

### 4.5 Queues, recalls and redos

- **Merging on dequeue:** messages accumulated during a turn are combined into one prompt on dequeue (each keeping its own `[time sender]`) and handled in one turn. "Is this one task or several?" is a judgment call, left to the agent. There is no true parallelism within a group (the session is linear, writes would race in the same directory, replies would arrive out of order).
- **Recalling a message stops its turn:** when the platform reports a message recalled (Feishu's `im.message.recalled_v1`) ⇒ if it is still queued, it is removed; if it is running and is this turn's only source, the turn is aborted: the user took the request back, and carrying on might repeat the recalled content. Messages already merged into a batch don't abort it.
- **Turns cut off by a release are redone after the restart** (`pending.js`): recorded only on graceful shutdown (the crash path never gets there, so it never "crashes and then starts working by itself"); not recorded for turns that already sent an answer, turns stopped or recalled by someone, or synthetic messages; valid for 2 hours and consumed when read; before redoing, it says so in the group, and `/stop` is the way to change your mind.

### 4.6 Built-in abilities of group projects

- **The self-briefing** (`engine._buildManifest`): identity, group / project / model / permissions, the console address, built-in skills, enabled plugins, plugins the project brings, repository link status, time conventions, and where the project's long-term memory is.
  - It is injected only when the briefing **changes** (compared by fingerprint), and a change **doesn't reset the session**, so the briefing can't contain anything that changes every turn (the time of day, exact counts).
  - Abilities a platform lacks are left out entirely; if they were taught, the agent would call an action that doesn't exist.
- **Memory handoff across models:** it names `CLAUDE.md` / `AGENTS.md` at the project root and the long-term memory directory, giving only coordinates without moving content. The memory directory is outside the project directory, so Claude groups without full access can't read it, and it isn't pointed out to them; pointing it out would teach them that "this project has no memory".
- **Built-in skills are CLIs, not plugins:**
  - `sbot feishu`: send files / images / messages, fetch history, reply / edit / recall, download attachments, emoji reactions;
  - `sbot wecom`: send messages / files / images, fetch history;
  - `sbot cron` · `sbot imagen` · `sbot design` · `sbot preview`.

  Slack groups have no built-in skill command for now, and that whole part of the briefing is replaced. The target group is the `SBOT_CHAT_ID` injected every turn; paths accept only relative paths inside the project; outbound text is redacted. Codex's MCP servers load globally, can't be gated per group and can't get the per-turn group id, so going through the shell is what works for both backends.
- **How it talks to people:** group messages and the console never show command names, tool names or machine paths; the command names in the briefing are only for the agent to run.

### 4.7 Scheduled tasks

- Two ways to write them: standard 5-field cron (including `@daily` and Chinese shorthands such as 「每天 09:00」 every day at 09:00 or 「工作日 8:30」 weekdays at 8:30), matched in the **product time zone**; one-off tasks with `--at "YYYY-MM-DD HH:mm"` (cron has no year and would repeat every year), deleted after firing.
- Three actions: `--do` builds a synthetic message for the engine and goes through the full group pipeline; `--say` just posts a message; `--run` runs a command in the project root directly, without starting the agent or taking the group lock, and speaks in the group only on failure. Messages posted directly are retried after 1 / 5 / 15 / 30 minutes if they can't be delivered.
- The scheduler works at minute granularity, aligned to minute boundaries, and **doesn't fire missed minutes** at startup; every tick re-reads the config (following hot reloads).
- Tasks are stored in `groups[chatId].crons`; the de-duplication key is `(group, id)`, so tasks never cross groups; agents in several groups writing the config at once are serialized by a file lock.

### 4.8 Quota

- **Alerts:** a message in the group when Claude's 5-hour window passes 90% used or Codex's weekly window passes 95%. Model account problems, exhausted quota, automatic switches and lost platform connections also go to the ops alert group (`alerts.chatId`, optional).
- **Automatic switching:** `providers.<primary>.fallback = "<backup>"`. Errors are first split into two classes (`quotaerr`, where only switching models helps / `transienterr`, try again later). Quota or account errors switch to the backup with an explanation in the group, and once a reset time can be parsed, it switches back at that time.

### 4.9 The console and access security

- Binding only to 127.0.0.1 isn't safe by itself (cross-site POSTs, DNS rebinding): each process injects a random token into the page, every `/api/*` checks it, and there is a loopback Host check on top. A broken config file is never written back.
- Opening it to the LAN (`--ui-host`) **requires setting a password first**, or it refuses to start. The password is only exchanged for a session token (no cookies ⇒ no CSRF); local loopback needs no password, and loopback requests carrying `X-Forwarded-*` don't count as local.
- The public entry point uses **Feishu sign-in** (the OAuth authorization code flow) and admits only the people on the `feishu.admins` list. Sessions are stored on disk for 30 days; removing someone from the list or changing the password voids old sessions immediately, based on identity hints recorded when they were issued. See [docs/PUBLIC-ACCESS.md](./docs/PUBLIC-ACCESS.md).
- Live activity goes over SSE. SSE doesn't replay, so the server keeps recent turn events, and the page fetches and merges them on load and on every reconnect. That buffer lives in memory, so on start it is seeded from the most recent turns in the turn ledger (scheduled scripts excluded); otherwise every restart, including each upgrade, would leave the feed empty. The page refreshes itself every 60 seconds, without interrupting a form being filled in, an open dialog or a drag.
- **"Needs you" sits at the top of Overview and appears only when something does.** It gathers what is waiting on a person: turns that failed in the last 72 hours (with the same reason the ledger records; one disappears by itself once the same person gets an answer in that group, or can be dismissed), takeover links an agent posted that nobody has claimed, open feedback, leftover background processes, previews serving a whole project, and failing health checks (listed first, since they are broken right now). It only summarizes: nothing new is sent to any group, and the items that already have their own section link to it rather than being handled twice. When a turn finishes, the console fetches just this list and redraws just this block, not the whole Overview.

### 4.10 Other mechanisms

- **The Feishu long-connection watchdog** (`wswatchdog.js`): turns on the SDK's pong keepalive; takes over connection events to maintain a health snapshot; when the SDK gives up reconnecting or stays stuck reconnecting too long, it forces a rebuild with exponential backoff. It cures "the SDK thinks it is connected but receives no events".
- **Time conventions:** the top-level `timezone` (default `Asia/Shanghai`) is the single convention for the whole product, independent of the host's time zone. Every message carries `[YYYY-MM-DD HH:mm sender]` as the turn's time anchor; child processes get `TZ` injected; the console's top bar also shows the server host's own time zone.
- **Repository linking** (`gitrepo.js`): does only two idempotent things, `git init` and setting `origin`; it doesn't clone, and doesn't commit or push for the agent. Addresses are accepted only in SSH form (transports like `ext::` execute commands); git is always called with `execFile` + `BatchMode`, so it never waits for interactive input when headless; status is read straight from `.git/config` and reported honestly as "missing / inconsistent".
- **The design canvas, style files and icons, preview servers:** each has its own document: [docs/BOARD.md](./docs/BOARD.md) · [docs/ICONS.md](./docs/ICONS.md) · [docs/PREVIEW.md](./docs/PREVIEW.md). The general rule from previews deserves its own line: **any input at an entry point the agent can reach is untrusted**, so the fence on the accepting side must be run again on the executing side.
- **Single-instance lock:** only one daemon per state directory; a second one errors and exits, since two daemons would fight over the same platform's messages.
- **Upgrade announcements:** at startup, the daemon compares the version recorded in state; if it changed, the new CHANGELOG entries are posted to every group. Pre-writing `lastVersion` suppresses it.
- **Leftover processes:** background shells still alive after their turn ended (parent exited and alive ≥ 1 hour) are listed by doctor and the console, and can be ended with one click.
- **Spawning child processes on Windows:** `claude` / `codex` are resolved through PATH + PATHEXT (npm's `.cmd` shims run through `cmd.exe`, native `.exe` files take precedence, and extensionless sh scripts are never picked by mistake); the prompt goes through stdin to avoid command-line escaping; aborting uses `taskkill /T /F` to kill the whole process tree. All of it lives in win32 branches; POSIX paths are unchanged.
- **The console** is a self-contained single file (hand-written CSS + vanilla JS, no build step) with two forms: `sbot ui` runs standalone (config + trial runs, not connected to the daemon); `sbot start --ui` shares the daemon's process for live state, SSE streaming and run controls. Config changes hot-reload; changed platform credentials need a daemon restart (long connections are bound at startup).

## 5. Known limits and risks

| Risk | Mitigation |
|---|---|
| Headless permissions with nobody to approve | Policy-based allow lists, never hanging; read only by default |
| Long connections that look alive behind proxies or networks but aren't | Watchdog keepalives + forced rebuilds |
| Weak agentic ability in third-party models | `toolQuality` labels; Claude for complex tasks |
| A long command locking the session | The `agent.maxTurnTimeMins` wall-clock limit (default 30 minutes) |
| Drift in `claude` CLI arguments | Spawn arguments managed in one place; the version and argument support are probed at startup |
| Exhausted subscription quota | Quota alerts + automatic switching to a backup model |
| Platforms redelivering old messages | Dropped by the watermark |
| Synthetic messages advancing the watermark | The watermark belongs only to platform messages (§3) |
| Serving group chats for several people on a personal subscription | May not comply with the provider's terms; setup points this out at the end, and teams should use API keys or business accounts |

## 6. Naming

- The project is **SintBot**; the npm package is **`sintbot`**; the command is **`sbot`** (alias `sintbot`). `sbot` on npm is someone else's package.
- The bot's default name in groups is `SintBot`, configurable with `brand`.
