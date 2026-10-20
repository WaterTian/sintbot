# SintBot

> Drive headless **Claude Code** from your group chat — one group, one project; people in the group just ask, and the model behind it is swappable.

[中文](./README.md) · [Website](https://sintbot.com) · MIT

```
Feishu / Slack / WeCom group ──► SintBot (daemon on your machine) ──spawn──► claude CLI (headless) ── Claude / DeepSeek / MiniMax / Volcano / Kimi / GLM …
                                       │                                └──► codex CLI (headless) ── GPT
                                       └── per group: project dir · session · queue · permissions · scheduled tasks
```

- **A group is a project.** Bind a group to a project directory on your machine. Group members say what they need — change code, run a script, research, generate images, send a daily report — and the bot works in that directory and replies in the group.
- **Swap the brain, keep the framework.** It runs the official `claude` / `codex` CLIs, so tools, file edits, MCP, skills, sub-agents and project memory all just work. Pick a model per group; switch with `/model` in the chat.
- **Your data stays on your machine.** Projects, sessions, memory and logs live on your disk and never pass through any SintBot server (prompts and the code the model reads still go to the model provider you choose, and chat messages go through the chat platform); outgoing messages are redacted; permissions are preset per group, so unattended turns never hang on an approval prompt.
- **Three platforms, one machine.** Feishu, Slack and WeCom can be online at the same time. (Feishu means the China edition at open.feishu.cn; the international Lark has not been tested.)

> Chinese first: the bot's built-in chat messages (cards, notices) and the instructions it receives are in Chinese, so its replies lean Chinese. `sbot setup` / `sbot doctor` print Chinese, while the daemon log of `sbot start` mixes Chinese and English. Most docs are in Chinese; only the web console has an English mode.

## Quick start

First create the bot and add it to a group: [Feishu](./docs/platforms/feishu.md) · [Slack](./docs/platforms/slack.md) · [WeCom](./docs/platforms/wecom.md).

**One-line install** (macOS / Linux, recommended for new users):

```bash
curl -fsSL https://sintbot.com/install.sh | bash
```

It checks for and installs Node 22+, installs sintbot, runs the setup wizard, and finally asks whether to run it as a service. It asks before every change and never uses sudo; if the official npm registry is unreachable (common in mainland China) it switches to a mirror. To see what it does first, read [install.sh](./install.sh) or run it with `--dry-run`.

**Manual install** (requires Node ≥ 22):

```bash
npm i -g sintbot          # the package is `sintbot` (`sbot` on npm is someone else's); installs the `sbot` command (alias: `sintbot`)
sbot setup                # wizard: environment → region → model (with a live trial turn) → chat platforms → projects root → first group, then a health check (fix any ✗ first)
sbot service install      # run as a service: restarted on crash, started at login (macOS launchd; Linux systemd is experimental; on Windows it prints NSSM / pm2 commands)
```

Then @ the bot in your group. The service includes the console: open http://127.0.0.1:4600 to bind groups, switch models and watch live activity.

### Pick a model — no Claude subscription needed

The wizard checks what this machine is logged in to and recommends in this order:

| You have | Use | What to do |
|---|---|---|
| A Claude subscription (Pro / Max) | Claude | run `claude auth login` before the wizard |
| A ChatGPT account | GPT (via Codex) | `npm i -g @openai/codex`, then `codex login` |
| Neither | **DeepSeek** (recommended) | sign up at [platform.deepseek.com](https://platform.deepseek.com), top up, create an API key, paste it into the wizard — it runs a trial turn on the spot |

Zhipu GLM (international site: Z.ai), MiniMax (international site: minimax.io) and Volcano Ark are presets too; the wizard asks which site your key belongs to. Kimi and any other Anthropic-compatible endpoint can be added in the console under Models → Add model → Custom; see [docs/models.md](./docs/models.md) (Chinese). Without a Claude subscription, Claude Code is only the agent framework and needs no login; the only things you lose are GPT groups and image generation, both of which borrow Codex.

Full install guide (installing and logging in to Claude Code, what each wizard step asks, Windows, proxies, headless Mac mini, troubleshooting): [docs/install.md](./docs/install.md) (Chinese). In mainland China, see the "在中国大陆" section of the [Chinese README](./README.md#在中国大陆).

## What it does

| | |
|---|---|
| **In-chat commands** | `/help` · `/status` · `/model <name>` · `/stop` · `/skip` · `/new` · `/hud` · `/issue` (in Slack use the `!` prefix — Slack swallows `/`) |
| **Streaming replies** | Live-updating cards on Feishu with progress milestones for long tasks; Slack shows the native "Working…" status and a Stop button |
| **Scheduled tasks** | `sbot cron`: run an agent turn, post a message, or just run a script on a schedule |
| **Models** | Claude (local `claude` login, or `ANTHROPIC_API_KEY`) · DeepSeek / Zhipu GLM / MiniMax / Volcano Ark presets (API key) · Kimi or any other Anthropic-compatible endpoint (custom, in the console) · GPT via Codex CLI; automatic fallback when a quota runs out |
| **Design & images** | Annotate-and-iterate on Feishu whiteboards, per-project design style files with pre-delivery checks, four icon sets, image generation |
| **Previews & browser** | Serve HTML prototypes on the LAN for the group; when the bot's browser hits a login or captcha, a group member takes over through a one-time link |
| **Console** | Local web console: overview · groups & projects · models & plugins · settings (with release history), Chinese/English; optionally exposed publicly behind a reverse proxy with Feishu login |
| **Operations** | `sbot doctor` · an ops alert group · interrupted turns are redone after a restart · upgrade notices in groups |

## Security

- The bot **executes commands** in the bound project directory. Permissions are per group: read-only by default; give "full access" only to groups you trust. See [docs/security.md](./docs/security.md).
- The console listens on localhost only. Set a password (`sbot ui --set-password`) before exposing it to your LAN.
- **Subscription terms:** serving a multi-person group chat from a personal Claude / ChatGPT subscription login may violate the provider's terms. For team use, use an account type or API billing that permits it, and check compliance yourself.

## Common commands

```bash
sbot doctor                    # health check: config / claude / models / platforms / group bindings; with Feishu configured it also calls the API once to check the bot identity and permissions
sbot ui                        # console only (no daemon)
sbot start --ui                # run the daemon in the foreground (for debugging; use sbot service to keep it running)
sbot service status|restart|logs|uninstall
sbot chat -C <project dir>     # simulate group messages in the terminal, no chat platform
sbot agent run "say something" # a single read-only trial turn in the current dir (-C to pick one)
sbot help                      # all commands
```

Config lives in `~/.sbot/config.json`; fields are described in [docs/config.md](./docs/config.md), and [sbot.config.example.json](./sbot.config.example.json) is a fully commented example (the config `sbot setup` writes keeps those comments).

## Status and feedback

The main flows on macOS with Lark and Slack (messaging, streaming progress, switching models, scheduled tasks) have been verified on real workspaces. The following have unit tests but little real-world use so far — please try them and tell us how they behave:

- Slack's `!status`, the native Stop next to "Working…", and the Stop / Skip / Status buttons in the thread;
- WeCom (the most recently added platform);
- Linux (experimental) and Windows (not yet verified).

Found a problem? Open a [GitHub issue](https://github.com/WaterTian/sintbot/issues) with `sbot --version`, your OS and chat platform, the `sbot doctor` output and steps to reproduce (mask secrets before pasting logs). Report security issues privately as described in [SECURITY.md](./SECURITY.md), not in a public issue.

## Docs

- [Install](./docs/install.md) · [Config](./docs/config.md) · [Models](./docs/models.md) · [Features](./docs/features.md) · [Security](./docs/security.md)
- Platforms: [Feishu](./docs/platforms/feishu.md) · [Slack](./docs/platforms/slack.md) · [WeCom](./docs/platforms/wecom.md)
- Features: [Whiteboard](./docs/BOARD.md) · [Previews](./docs/PREVIEW.md) · [Browser](./docs/BROWSER.md) · [Icons](./docs/ICONS.md) · [Codex backend](./docs/CODEX-RUNNER.md) · [Public console access](./docs/PUBLIC-ACCESS.md)
- Architecture: [DESIGN.md](./DESIGN.md) · Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)

(Docs are in Chinese.)

## License

[MIT](./LICENSE) © WaterTian
