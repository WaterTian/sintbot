# Configuration

English · [简体中文](./zh-CN/config.md)

**Location.** SintBot uses the first config it finds, in this order:

1. `--config <path>`
2. `$SBOT_CONFIG`
3. `sbot.config.json` in the current directory
4. `~/.sbot/config.json`

`sintbot setup` creates the last one when there is none. The second line of `sintbot doctor` shows which file is in use.

**Changes take effect immediately.** The daemon hot-reloads the config file, so no restart is needed. For day-to-day changes such as binding groups, switching models and setting permissions, prefer the console (`sintbot ui`): it validates your changes before writing them back.

**Secrets.** Any secret field can be written as `"env:NAME"` to read it from the environment. A service does not see your shell's variables: `sintbot service install` names the ones it cannot read, and `--pass-env` writes their values into the service definition (see [install.md](./install.md#3-run-as-a-service-sintbot-service-install)).

A fully annotated example: [sbot.config.example.json](../sbot.config.example.json). Keys starting with `_` are comments and are ignored.

## Top level

| Key | Meaning |
|---|---|
| `providers` / `defaultProvider` | Models; see [models.md](./models.md) |
| `feishu` / `slack` / `wecom` | Chat platforms. Each one you configure is connected, and you can configure several. See [platforms/](./platforms/) |
| `groups` | Groups → projects; see below |
| `projectsRoots` | Projects folder(s): a string or an array, `~` allowed, default `~/Projects`. The console only lets you bind directories inside them |
| `agent` | Settings for agent turns; see the list below the table |
| `proxy` | `{ http, https, noProxy }`: proxy routing; see [install.md](./install.md#proxies-mainland-china) |
| `timezone` | The product time zone as an IANA name (default `Asia/Shanghai`). Message timestamps, scheduled tasks and the console clock follow it, whatever the host's time zone |
| `brand` | The bot's name in the group (default: SintBot) |
| `alerts` | `{ chatId }`: the ops alert group (do not bind it to a project) |
| `ui` | The console: `publicUrl` is the public entry point (see [PUBLIC-ACCESS.md](./PUBLIC-ACCESS.md)); `auth` is written by `sintbot ui --set-password` |
| `preview` | Group preview servers: port range, idle cleanup and listen address. See [PREVIEW.md](./PREVIEW.md) |
| `browser` | `{ cdpUrl, takeoverMinutes }`: the address of the long-running browser and how long takeover links stay valid. See [BROWSER.md](./BROWSER.md) |
| `instance` | How this machine names itself in the feedback log, to tell machines apart when several report together |

The `agent` keys:

- `maxTurnTimeMins`: wall-clock limit per turn, default 30.
- `maxConcurrent`: how many turns run at once across all groups, default 2.
- `autocompactTokens`: compact a session once it passes this many tokens; default 400,000, and 0 turns compaction off.
- `bin`: the name of the claude executable.

The example's `agent.permissionMode` has no effect; it is also the value shown on that row of the doctor output. The execution mode is set per group; see below.

## Groups

```jsonc
"groups": {
  "oc_xxxxxxxx": {                        // group / channel id
    "workdir": "/Users/me/Projects/app",  // project directory (absolute path)
    "provider": "claude",                 // omitted = defaultProvider
    "platform": "feishu",                 // feishu | slack | wecom; may be omitted when the id's shape tells
    "permissionMode": "dontAsk",          // dontAsk (default: anything outside the allow list is refused) | bypassPermissions (allow everything)
    "allowedTools": ["Read", "Grep", "Glob", "Edit", "Write", "Bash(npm *)"],
    "disallowedTools": [],
    "plugins": { "mcp": ["chrome-devtools"] },  // optional: enable user-level MCP servers per group (if set, only these plus the project's own are loaded)
    "redactPii": true,                    // mask phone numbers / emails in outgoing messages (default on)
    "paused": false                       // paused: no messages handled, no scheduled tasks, no announcements
  }
}
```

For what each permission means and the risks, see [security.md](./security.md). The three presets on the console's group card (read-only, developer, full trust) simply fill in `allowedTools` / `disallowedTools`.
