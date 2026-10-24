# GPT groups: the Codex CLI runner

English · [简体中文](./zh-CN/CODEX-RUNNER.md)

> When a group's provider is set to `runner: "codex"`, every turn in that group is run by the official `codex exec`. Authentication uses the machine's `codex login` (a ChatGPT subscription), and the config holds no key. Implementation: `src/agent/codexcode.js` (turns) · `src/agent/codexstatus.js` (login state and quota).

## Configuration

```jsonc
"codex": { "runner": "codex", "reasoningEffort": "medium", "toolQuality": "high" }
```

- Leave `model` out to use Codex's own default (the `model` in `~/.codex/config.toml`, otherwise the official default). The example deliberately does not pin one: a pinned model goes stale as new models ship, and some models can't be used with a ChatGPT account login (the error is "model is not supported when using Codex with a ChatGPT account"). To pin one, first check which ones this account can use with `codex debug models`.
- `reasoningEffort` → `-c model_reasoning_effort=<level>`; leave it out for the model default.
- In a group, `/model codex` switches to this runner; switching back to Claude works the same way.

## Authentication (set up once on the machine; SintBot doesn't touch it)

- `codex login` uses browser OAuth and needs a graphical session. Without one, use `codex login --device-auth`, or sign in on a machine with a browser and copy `~/.codex/auth.json` over.
- Credentials may be stored in a file or in the system keychain (`cli_auth_credentials_store`, auto by default). Check the login state with `codex login status` (exit code 0 when signed in), not by whether `auth.json` exists.
- SintBot writes nothing under `~/.codex/` and doesn't set `CODEX_HOME`. When spawning, it also **clears any inherited `OPENAI_API_KEY`**, so the subscription login is always what gets used and nothing quietly switches to pay-as-you-go billing.
- GPT groups and the Codex you use in your own terminal **share the same subscription quota** (5-hour and weekly windows). Keep GPT groups few and focused. When the quota runs out, the turn fails cleanly with an explanation in the group; it never hangs.

## How each turn runs

```
first turn: codex exec --skip-git-repo-check --sandbox <level> -c approval_policy=never [-c model_reasoning_effort=…] [-c model_auto_compact_token_limit=…] [--model …] --json --cd <project dir> -
resume:     codex exec resume <thread_id> --skip-git-repo-check -c sandbox_mode=<level> -c approval_policy=never […] --json -
```

- The prompt goes in on stdin (the trailing `-`). Codex has no `--append-system-prompt`, so the group's project briefing is prepended to the first turn's prompt.
- `exec` doesn't accept the interactive `--ask-for-approval`; only `-c approval_policy=never` works, so it never asks for approval.
- **Resuming does not inherit the sandbox:** a bare `resume` falls back to read-only, so every turn passes the level again with `-c sandbox_mode=`. The `thread_id` stays the same across resumes.
- `--ephemeral` is not used (it doesn't save the session, so it can't be resumed). Non-git directories also need `--skip-git-repo-check`, otherwise it fails with "Not inside a trusted directory".
- `autocompactTokens` (see [config.md](./config.md)) applies to Codex too: once the session passes the threshold, Codex compacts it in place.

## Permissions: only two levels

| The group's `permissionMode` | Codex sandbox | Meaning |
|---|---|---|
| `dontAsk` (default) | `read-only` | Read only; no network access inside the sandbox either |
| `bypassPermissions` | `danger-full-access` | Full access: no directory fence; only for trusted private groups |

- There is no middle level: Codex's `workspace-write` depends on an OS sandbox component that Windows lacks, and setting it there has no effect. To behave the same on every platform, only two levels are offered.
- Claude's per-tool allow and deny lists, per-group MCP gating and the vision proxy **do not apply to Codex groups**. Codex's MCP servers come from `~/.codex/config.toml` and apply globally to every Codex group.
- The bot's built-in abilities (sending messages, scheduled tasks, image generation, previews) need network access, so they don't work in the read-only sandbox; they need full access.

## Event mapping (`--json`, one JSON object per line)

| Codex event | In SintBot |
|---|---|
| `thread.started` | Records the `thread_id` for resuming next turn |
| `item.*` · `agent_message` | Reply text (possibly split across several messages) |
| `item.*` · `command_execution` | Shown as a Bash tool call and its result |
| `item.*` · `file_change` | Shown as Write / Delete |
| `item.*` · `web_search` / `mcp_tool_call` | WebSearch / MCP |
| `turn.completed` | Usage (including `reasoning_output_tokens`) goes into the ledger |
| `turn.failed` / `error` | The raw JSON error is turned into plain language before replying to the group |

**Reasoning effort steps down automatically when the plan refuses it.** `model/list` reports every level the model supports, but at run time the subscription plan narrows that (lower plans may not accept the top levels). When the server returns a `reasoning.effort` parameter error, the turn is rerun once without the reasoning effort, using the model default. The group gets its answer as usual, and the log keeps one line about it.

## Login state and quota (the console's Codex card, `/hud`, doctor)

- Login state: `codex login status`. `sintbot doctor` checks it too: when not signed in, the Codex row and any fallback-model rows pointing to Codex turn yellow.
- Quota: a temporary `codex app-server` is started (newline-delimited JSON-RPC over stdio): `initialize` → `initialized` → `account/rateLimits/read` → exit.
- The windows in the response **are identified by `windowDurationMins`** (300 = 5 hours, 10080 = one week), not by the `primary` / `secondary` position: which window goes in which position has changed on the server side before. The percentage shown is **the amount used**.

## Windows

- The npm-installed codex is really a `codex.cmd` shim. SintBot resolves it the same way as `claude` (`src/agent/winexec.js`), so it never picks the extensionless sh script by mistake.
- When testing by hand in PowerShell, `2>&1 | Set-Content` decodes Codex's UTF-8 output with the system code page and garbles Chinese text. SintBot reads the child process output directly and is unaffected.
