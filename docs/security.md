# Security

English · [简体中文](./zh-CN/security.md)

SintBot is a long-running process that **can execute commands on your machine**, and it takes orders from the people in a group. Think that through before you decide which group gets which permissions.

## Threat model

- **Group members are effectively operators of the project.** Anyone who can post in a bound group can make the bot read and write files and run commands in that project directory, within its permissions. Bind projects only to groups you trust.
- **"Full access" means running arbitrary commands as your OS user.** It is not limited to the project directory: Bash can reach everything your user can, including your home directory, unlocked keychain items and SSH keys.
- **Only the file tools are confined.** Read, Edit, Write, Grep and Glob are confined to the project directory. **Bash has no OS-level directory isolation**; its boundary is each project's command allow list. If you need real isolation, run SintBot under a separate OS user, in a VM or in a container.
- **Prompt injection.** The bot reads group messages, web pages and project files. Injected content can steer it into doing things **within the permissions it already has**, so the permission level, not the prompt, is the real boundary.

## Three layers of permissions (all per group, no global default)

1. **Execution mode**, `groups[].permissionMode`:
   - `dontAsk` (default): tools on the allow list run automatically and everything else is refused, so a turn never hangs on an approval prompt;
   - `bypassPermissions`: everything is allowed.

   Codex groups have two matching levels: read-only and full access.
2. **Tool allow and deny lists**, `allowedTools` / `disallowedTools`. The console offers three presets: read-only, developer and full trust. With neither list set, the group is read-only. The deny list wins.
3. **Directory.** Each turn runs in the group's bound project directory, with no other directories mounted. The console only lets you bind directories inside `projectsRoots` (default `~/Projects`). The check uses the real path, so symlinks cannot escape it.

The bot's built-in abilities are allowed at every level: posting messages, scheduled tasks, image generation, previews and style-file checks. In Codex's read-only level, the sandbox has no network access, so these abilities need full access there.

## Credentials

- A new `~/.sbot/config.json` is created with permissions 600. Every secret field can be written as `"env:NAME"` to read it from the environment.
- Outgoing messages are redacted automatically:
  - secrets from the config are masked by value;
  - other secrets are masked by shape (API keys, tokens and so on);
  - phone numbers and emails are masked by default too; turn this off per group with `redactPii: false`.
- A spawned `claude` / `codex` process only receives the environment variables its provider needs, so `ANTHROPIC_*` variables exported in your shell do not leak into another provider.

## Where data goes

SintBot has no server of its own and collects no data. Only the following leaves this machine:

- **Model providers.** Each turn's prompt, the group messages, and the files and command output the model reads are sent by the `claude` / `codex` CLI to the model you chose for that group: Anthropic, OpenAI or a compatible endpoint you configured. Telemetry and other behavior of those CLIs are up to their providers.
- **Chat platforms.** Group messages, files and cards go through Feishu, Slack or WeCom.
- **Quota and balance lookups.** When the console or `/hud` shows quota, it asks the provider using the logins or API keys already on this machine. Claude subscription quota reads the local `claude` credentials (read-only, never refreshed); DeepSeek, GLM and MiniMax are queried for their balance.
- **Console fonts.** The console page loads fonts from Google Fonts (`fonts.googleapis.com` / `fonts.gstatic.com`). The request comes from the browser that opens the page; if it fails, the page falls back to system fonts and works the same.

## The console

- **Listen address.** By default it listens only on `127.0.0.1:4600`, and local access carries a token automatically.
- **LAN access.** Before opening it to the LAN (`--ui-host 0.0.0.0`), you must run `sintbot ui --set-password`; otherwise it refuses to start. The password is stored with scrypt and is only exchanged for a session token.
- **Public access** (optional; see [PUBLIC-ACCESS.md](./PUBLIC-ACCESS.md), in Chinese) runs through an SSH reverse tunnel and a reverse proxy that terminates HTTPS. On the public side, only Feishu sign-in is accepted, and only for the people listed in `feishu.admins`; the password login endpoint is refused there outright.
- **Treat console access as the bot's highest privilege.** The console can change permissions, bind groups and read sessions.

## Other features that open a door

- **Group previews** (`sintbot preview`) open an HTTP port on the LAN so group members can see prototypes. It is plain HTTP without authentication; the URL has a random prefix. By default it only serves a subdirectory of the project and is reclaimed when idle. If you do not need it, set `preview.host` to `127.0.0.1`.
- **Browser takeover links** are single-use and short-lived (10 minutes by default). Whoever has the link can operate the bot's browser.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
