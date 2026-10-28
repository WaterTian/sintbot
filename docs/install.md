# Install

English · [简体中文](./zh-CN/install.md)

The [one-line install](#one-line-install) is the easiest path for new users. A manual install takes three steps: install the package, run `sintbot setup`, then run `sintbot service install`. The sections below add platform-specific details.

The package installs two equivalent commands, `sintbot` and `sbot`.

## One-line install

On macOS and Linux (Linux support is experimental):

```bash
curl -fsSL https://sintbot.com/install.sh | bash
```

The script runs four numbered steps. Each step checks first and skips work that is already done, and anything that changes your system asks first (Enter means yes). The terminal only installs SintBot and sets up a model: it does not ask where you are or for a proxy, a projects folder or chat platform credentials. You set those in the console afterwards.

1. **Environment: Node.js 22+.** If Node is missing or too old, the script installs or upgrades it with Homebrew on a Mac that has Homebrew. Otherwise (no Homebrew, or Linux), it prints the [nodejs.org](https://nodejs.org) download link and stops; install Node, then run the script again.
   **npm registry.** If you have configured a registry, the script uses it. If you are on the official registry, it first tests the connection. If the official registry is unreachable (common in mainland China), it uses the `registry.npmmirror.com` mirror for this run.
2. **Install sintbot.** It runs `npm i -g sintbot`. If the latest version is already installed, it says so and moves on; an older version asks whether to upgrade. If the global npm directory is not writable, it does not fall back to `sudo`; it prints the commands that move the global directory into your home folder.
3. **Model**, `sintbot setup`. The wizard checks for Claude Code and offers to install it if it is missing (see the next section), then sets up a model with a live trial turn. See [section 2](#2-configure-sintbot-setup).
4. **Background service.** It asks whether to run `sintbot service install`, which starts SintBot at login and restarts it on crash. The console then stays up at `http://127.0.0.1:4600`, even before a chat platform is connected, and the script opens it in your browser (not over SSH). If the service is already running and nothing was upgraded, the step is skipped; after an upgrade it asks whether to restart the service, which announces the upgrade in connected groups.

The script ends with the console address and what to do next: connect Slack, Feishu or WeCom under Settings, bind a group under Groups, then @mention the bot in that group. `sintbot chat` lets you try it in the terminal first.

- To see what the script would do without changing anything, run `curl -fsSL https://sintbot.com/install.sh | bash -s -- --dry-run`. The script source is [install.sh](../install.sh) at the root of the repository.
- Without an interactive terminal (for example in CI), the wizard and service steps are skipped and only the package is installed.
- The script and the wizard print Chinese if your locale is Chinese (`LANG` starting with `zh`) or, on macOS, the system language is Chinese; otherwise English. Set `SINTBOT_LANG=en` or `SINTBOT_LANG=zh` to choose, for example `curl -fsSL https://sintbot.com/install.sh | SINTBOT_LANG=en bash`.
- The one-line install does not support Windows; follow the manual steps below.

## Claude Code: install and sign in

SintBot runs every turn through the `claude` CLI on this machine (Codex groups use `codex`), so Claude Code must be installed. This is true even if you only use DeepSeek or another API-key model: Claude Code is the agent framework, and in that case it needs no login.

**Install it** in any of these ways:

- **Let the wizard do it.** If `sintbot setup` finds no Claude Code, it asks "Install Claude Code now?"; press Enter. It runs the npm command below and switches to the mirror when the official registry is unreachable.
- **npm:** `npm i -g @anthropic-ai/claude-code`. If the official registry is unreachable, add `--registry https://registry.npmmirror.com`.
- **The official installer:** see the [Claude Code setup guide](https://code.claude.com/docs/en/setup).

When `claude --version` prints a version, you are done. Upgrade with `claude update` (or `npm i -g @anthropic-ai/claude-code@latest` for an npm install).

**Authenticate** according to the model you plan to use:

| Model | What to do |
|---|---|
| DeepSeek, Zhipu GLM, MiniMax, Volcano Ark and other API-key models | **No login.** Paste the key in the wizard; see [models.md](./models.md#use-deepseek-or-another-api-key-model-in-three-steps) |
| Claude, on a subscription (Pro / Max) | Run `claude auth login` and sign in in the browser that opens. `claude auth status` shows whether you are signed in |
| Claude, on an Anthropic API key (pay as you go) | Run `claude auth login --console`, or put `ANTHROPIC_API_KEY` in the daemon's environment |

- **Headless machines** (such as a Mac mini used as a server): use Screen Sharing (`vnc://<machine-ip>`) to reach the desktop and run `claude auth login` once. The login is saved to disk, so the daemon keeps working unattended.
- For the terms-of-service question around serving a group from a personal subscription, see [Security in the README](../README.md#security).
- **To verify:** run `claude --version`, then `claude auth status` (subscription only), then `sintbot agent run "introduce yourself in one sentence"`, a read-only trial turn in the terminal.

## Requirements

| Requirement | Check | Notes |
|---|---|---|
| Node.js ≥ 22 | `node -v` | The current LTS is fine. The browser takeover page needs Node's built-in WebSocket |
| Claude Code | `claude --version` | `sintbot setup` can install it for you; see the previous section. With API-key models only, it can stay signed out |
| Codex CLI (optional) | `codex --version` | Needed only with a ChatGPT account, for GPT groups and image generation. Run `npm i -g @openai/codex`, then `codex login` (browser OAuth, needs a desktop) |
| Design icon libraries (optional) | `sintbot doctor` (the `design.icons` row) | Lucide, Tabler, Phosphor and Pixelarticons, about 170 MB in all. The agent takes icons from them by name when it draws a design; without them it draws its own, which may not match the design |

The first step of `sintbot setup` checks all of these. If Claude Code is missing, it offers to install it (default: yes); if Codex is missing, it offers too (default: no); if any design icon library is missing, it offers to install the missing ones in one go (default: yes). The login status of Claude and Codex is shown in the model step.

## 1. Install the package

```bash
npm i -g sintbot
sintbot version
```

The package is **`sintbot`**. The `sbot` package on npm belongs to someone else, so do not install that one by mistake.

> ⚠ If the machine has both a Homebrew node and an nvm node, `npm i -g` installs into **the one your current shell uses**. The service uses whichever node was active when you ran `sintbot service install`, because that path is written into the service. When the two differ, you get "I upgraded but the old version is still running". Run `sintbot service install --dry-run` to see which node the service uses.

To run from source:

```bash
git clone https://github.com/sintlab/sintbot.git && cd sintbot
npm install
npm link            # optional: link the sintbot / sbot commands globally
```

## 2. Configure: `sintbot setup`

This is an interactive wizard; Enter accepts the default (the value in brackets, or the capital letter in `(Y/n)`). It only covers what SintBot needs to run on this machine:

1. **Environment.** Claude Code, Codex and the design icon libraries; anything missing is offered for install (see [Requirements](#requirements)).
2. **Model.** The wizard first shows the login status of Claude and ChatGPT (Codex), plus any models whose keys are already set, then recommends in this order:
   - If Claude is signed in, the default is Claude; otherwise, if Codex is signed in, the default is Codex. In either case it only asks whether to add an API-key model as well.
   - If neither is signed in, it **recommends DeepSeek**: it tells you to get a key at platform.deepseek.com and **runs a trial turn** as soon as you paste it. You can also pick another provider (Zhipu GLM, MiniMax, Volcano Ark), sign in to Claude or Codex in another terminal and come back to re-check, or skip for now.
   - Zhipu GLM and MiniMax have international sites (Z.ai and minimax.io), and a key only works on the site that issued it. The wizard tries one site and, if the key is rejected, tries the other one automatically. Without Claude Code it cannot run a trial, so it asks which site issued the key.
   - If the trial turn fails, the wizard tells you why: a wrong key, an empty balance or missing identity verification, a network problem (is a global proxy on?), or a wrong model name. You can paste the key again and retry.
   - If more than one model is usable, it asks which one is the default; groups can switch any time with `/model`. If the default model has not had a trial turn yet, it offers one.
   - If Codex is not installed or not signed in, the Codex preset and the automatic fallback to Codex are left out of the config. Kimi is not a preset; add it in the console under Models → Add model → Custom. See [models.md](./models.md).

The config is written to `~/.sbot/config.json` with permissions 600. If the current directory already has a `sbot.config.json`, that file is updated instead. Running `sintbot setup` again only fills in what is missing and leaves existing values alone.

The wizard ends with a short health check that lists only failures; `sintbot doctor` shows the full list. If your terminal uses a proxy and the config has none, it suggests carrying the proxy into the service (see the next section) or setting it in the console.

**Everything else is in the console** (`sintbot ui`, or `http://127.0.0.1:4600` once the service runs):

| What | Where in the console |
|---|---|
| Chat platform credentials (Slack, Feishu, WeCom), precheck, Feishu admins | Settings; each platform has a step-by-step guide. See [platforms/](./platforms/) |
| Binding groups to project folders | Groups |
| Bot name, network proxy | Settings → Bot & network |
| Projects folder | Read-only in the console (it is the fence for what the console may bind). The default is `~/Projects`; to change it, edit `projectsRoots` in the config or run `sintbot setup --full` |

**`sintbot setup --full`** asks the old full set of questions in the terminal, for servers without a browser: proxy routing, bot name, chat platform credentials with precheck, projects folder and a first group. This part of the wizard is in Chinese only.

## 3. Run as a service: `sintbot service install`

```bash
sintbot service install                      # write and start the service
sintbot service install --ui-host 0.0.0.0    # open the console to the LAN (run sintbot ui --set-password first)
sintbot service status | restart | logs | uninstall
```

- **macOS:** writes `~/Library/LaunchAgents/com.sbot.daemon.plist`, a LaunchAgent that starts at login and restarts 15 seconds after a crash.
- **Linux** (experimental: in 1.0 the generated unit is covered by unit tests but has not been installed on a real machine): writes `~/.config/systemd/user/sbot.service`. To start at boot without logging in, also run `loginctl enable-linger $USER`.
- **Logs:** `~/.sbot/logs/err.log`; `sintbot service logs` shows the tail.
- **What the service pins:** the node path, the sintbot entry point, the absolute config path, and the PATH of your current shell (with the directories of `claude` and `codex` first). **After changing node, moving the config or newly installing claude, run `sintbot service install` again.**
- **Node path:** a Homebrew node really lives in a versioned directory that disappears on upgrade, so install switches to an unversioned path to the same program (such as `/opt/homebrew/bin/node`). For nvm, volta and other managers without a stable path, it keeps the original path and reminds you to reinstall the service after changing node versions.
- **Environment variables:** the service does **not** inherit your shell's variables. For every `"env:NAME"` in the config, install names the ones the service cannot see; if the config has no proxy but your shell has `https_proxy` and similar variables, they are listed too. You have two options:
  - write their values into the service definition (the file is set to 600, and `--dry-run` masks the values). Run in a terminal, install asks whether to do this (default yes); `--pass-env` does it without asking. After changing a key, run install again;
  - put the values directly in the config, which is itself 600 (for the proxy: the console's Settings → Bot & network).
- **Console exposure:** if the console is opened beyond this machine (`--ui-host` set to a non-loopback address) without a password, install refuses; otherwise the service would exit on every start.
- **No chat platform yet:** the service still installs and runs the console only. Connect a platform under Settings and save; the service restarts itself within seconds and connects. (Versions 1.0.10 and 1.0.11 refused to install in this case.)
- **`sintbot ui` while the service runs** opens the service's console instead of failing on the busy port.
- ⚠ **Do not start a second daemon.** Once the service is installed, do not also run `sintbot start` by hand: only one daemon is allowed per OS user (lock file `~/.sbot/daemon.lock`), and a second one reports the running one's pid and exits. If another machine or OS user starts a daemon with **the same bot app**, Feishu and Slack hand each message **to one of the connections at random**, so the other never sees it. WeCom lets the new connection replace the old one, and a connection replaced twice within 10 minutes stops reconnecting.

### Upgrade

```bash
npm i -g sintbot@latest && sintbot service restart
```

A restart aborts turns in progress. An aborted turn is redone automatically after the restart, and the group is told. The safest time to restart is when every group is idle on the console's Overview page.

## macOS: a Mac mini as a server

Unattended use needs three things: no sleep, automatic restart after a power cut, and automatic login to the desktop after a reboot.

```bash
sudo pmset -a sleep 0 disablesleep 1 autorestart 1 powernap 0
```

Then turn on **automatic login** in System Settings → Users & Groups. A LaunchAgent only starts inside a user session, because it reads the logins in `~/.claude` and `~/.codex` and the keychain; without automatic login, the service does not come back after a reboot.

`codex login` needs a browser. Do it once over Screen Sharing (`vnc://<machine-ip>`); the credentials are saved to disk and work unattended afterwards.

## Windows

> 1.0 has not been verified on a real Windows machine (CI runs Linux only). The notes below follow the code's behavior; please open an issue if something does not work.

- If `claude` was installed with npm, it is really a `claude.cmd` shim. This is handled automatically; just write `claude` in the config.
- **Service:** on Windows, `sintbot service install` does not install anything. Instead it prints ready-made commands for [NSSM](https://nssm.cc/) and pm2; run them. With NSSM, pass API keys and proxy variables into the service environment with `nssm set SintBot AppEnvironmentExtra …`.
- The default projects folder is `D:\Projects` (or `%USERPROFILE%\Projects` if there is no D: drive).

## Proxies (mainland China)

In mainland China, official Claude, ChatGPT / Codex and Slack need a proxy, while domestic model endpoints, Feishu and WeCom connect directly. Set the proxy in the console under Settings → Bot & network (or with `sintbot setup --full`); the config's `proxy` block is then applied in two places:

- It is injected into every spawned `claude` / `codex` process, without overriding values already set in your shell.
- The daemon also uses it for its own Slack connection. Node's `fetch` and WebSocket ignore `HTTP_PROXY`, so this is handled separately.

**Domestic model endpoints should connect directly.** Routing DeepSeek, Zhipu, MiniMax or Volcano Ark through a server abroad and back is slow and can trip the provider's risk controls. When the proxy is set in the console or by setup, `noProxy` is generated from the providers you enabled. If you set the proxy in your shell yourself, add these hosts to `NO_PROXY`:

```bash
export NO_PROXY=api.deepseek.com,open.bigmodel.cn,api.minimaxi.com,ark.cn-beijing.volces.com,localhost,127.0.0.1
```

To check that the proxy works, run `curl -I https://chatgpt.com/`. A 403 means it works (Cloudflare blocks bare curl); a timeout or a refused connection means it does not.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The health check or the group says "not logged in" / `Not logged in` | The default model is still `claude`, but this machine is not signed in to Claude. If you only use DeepSeek or another API-key model, run `sintbot setup` again and pick the model, send `/model deepseek` in the group, or change the group's model in the console. To use Claude, run `claude auth login` |
| The trial turn says the key is wrong (401) | The key was not copied in full. For Zhipu and MiniMax the wizard already tried both the mainland and the international site, so the key itself is wrong. Run `sintbot setup` again and paste it |
| Insufficient balance / identity not verified | Top up or complete identity verification in the provider's console, then retry |
| Domestic models are slow or unreachable | With a global proxy on, requests go abroad and back. Set the model hosts to connect directly; see [Proxies](#proxies-mainland-china) above |
| npm installs are slow or fail | Add `--registry https://registry.npmmirror.com`; the one-line install and the wizard switch automatically |
| A permission error (EACCES) on global install | Do not use `sudo`. Move the global npm directory into your home folder; see step 3 of [One-line install](#one-line-install) |
| GitHub is unreachable | The Chinese introduction and install steps are on [the website](https://sintbot.com/zh/); the README is also on the [npmmirror package page](https://npmmirror.com/package/sintbot) |
| No reply after @-mentioning the bot | Check the platform rows of `sintbot doctor`, and the latest errors in `sintbot service logs` |

## Uninstall

```bash
sintbot service uninstall
npm rm -g sintbot
rm -rf ~/.sbot          # config, session ledger and logs live here; project directories are untouched
```
