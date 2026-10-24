# `sbot preview`: group preview servers

English · [简体中文](./zh-CN/PREVIEW.md)

> Someone in the group had the agent build an HTML prototype, and group members want to **open it on their phones**. This is a **managed, deterministic action**: a port fixed per group, a directory fence, a link with a token, a server that outlives the turn, automatic cleanup when idle, and visibility and a stop button in the console. The agent never has to keep a turn open to keep a link alive, or touch any system autostart mechanism.
> Implementation: `src/preview.js` (pure functions) · `bin/sbot.js` (the three actions, the worker and the reaper in the daemon).

## Why it exists

Left unmanaged, the agent finds all sorts of ways to keep a link alive: it starts its own static server, installs it as a system service (which is then forgotten, leaving the whole project directory exposed on the LAN for good), or simply **keeps the turn from ending** (holding the group lock, so every later message in the group is pushed into "queued"). A ban in the prompt is not enough; a ban needs a proper alternative to go with it. This skill is that alternative, and it remembers to shut things down on the agent's behalf.

## Shape: the worker owns the port, the daemon owns the lifecycle

- **The HTTP server runs in a detached worker** (the same pattern as `sbot imagen`). The daemon is a single point for every group, so a handler that takes LAN requests does not go into its process; a daemon restart (including an upgrade) does not interrupt previews either.
- **Lifecycle policy lives in the daemon:** bookkeeping, idle cleanup, orphan cleanup, following group pauses, and showing previews in the console.
- **The worker also exits on its own when its time is up**, so cleanup still works without the daemon installed, with only `sintbot ui` running, or after the daemon crashes. Two safeguards, each effective on its own.

```
group agent ──Bash──► sbot preview start design/prototype/index.html
                         │ accept: fence check + write record + detached spawn ⇒ read back the actual port, then return the URL (no group lock)
                         ▼
                 ~/.sbot/preview/<id>.json ◄──── worker heartbeat (lastReqAt / pid / port)
                         │                              │
       daemon reaper (every 60 s)                      worker (node http, exits on its own when idle)
       idle / too old / group paused ⇒ stop + notify   serves only static files inside the fence
       orphaned record (pid dead) ⇒ clean up           GET /<token>/… → serveRoot/…
                         │
       console Overview "Preview servers" (port / last access / idle time left + Stop) · sintbot doctor lists them as they are
```

## Commands

```
sbot preview start <relative path> [--label "Expense prototype"] [--port <n>] [--idle-min <n>] [--project-root]
sbot preview stop [<id>|--all]
sbot preview status [--json]
```

- `start` takes a **file** (a self-contained HTML file, the main use: **only that one file is served**) or a **directory** (a prototype with assets: serveRoot is that directory and the entry point is `index.html`; without it the request is refused, and there is no directory listing).
- **It returns as soon as it is accepted.** The output gives the URL and states plainly: "do not wait, do not poll, and above all do not keep this turn open to keep the link valid". When the server binds to loopback, it says instead that "group members on the LAN cannot open it", and offers sending the file with `send-file` as the alternative.
- **At most one preview per group.** Starting the same serveRoot again returns the original URL unchanged; a different serveRoot stops the old one, starts the new one and says "replaced the previous preview". The whole "check → stop old → write new record" sequence takes a per-group file lock, so even concurrent starts leave only one alive.
- `stop` without arguments stops this group's preview. **Inside a group** (with group context), `--all` is refused outright, stopping by id only works for this group's preview, and `status` lists only this group's. `--all` is reserved for an admin in a terminal.
- **`--config` is forbidden inside a group**; otherwise the agent could write its own config that turns cleanup off. An admin who needs a different config uses the `SBOT_CONFIG` environment variable.

## Ports

- The range is **4610–4629** (20 ports), right next to the console's 4600, so one firewall rule covers it. It avoids 3000 / 5173 / 8000 / 8080 / 9222.
- The starting point comes from a hash of the group id, so **a group always gets the same port** when there is no conflict; if it is taken, the next one in the range is tried, wrapping around. The worker tries the candidates in order and writes the port it actually bound back to the record, and the accepting side prints the URL only after reading it back, so the printed link is always live.
- `--port` can choose one, but it must be within the range.

## Directory fence

1. **Relative paths plus a project-directory fence:** absolute paths, `..` and anything outside the project directory are refused.
2. **A second check with realpath:** at accept time, the real path of serveRoot must still be inside the project directory; the resolved path of **every request** is checked again too (a symlink pointing outside ⇒ refused).
3. **The project root is refused by default:** if serveRoot is the project directory itself, it errors and tells the agent to put the prototype in a subdirectory (such as `design/prototype/`). To really do it, pass `--project-root` explicitly, and the group gets a one-line notice.
4. **A deny list** (checked both at accept time and on every request, case-insensitive): files and directories starting with a dot (`.git`, `.env`, `.ssh`…), `node_modules`, `*.pem|key|p12|keystore`, `sbot.config*.json`. At accept time it checks **the whole path from the project root down to serveRoot**, so a whole subtree under a dot directory cannot be served.
5. **Read only:** only `GET` / `HEAD`; everything else gets 405. No directory listing, uploads or writes.

**The worker checks again too.** `sbot preview *` is allowed at every permission level, so the worker cannot trust the record it reads. The record file must be inside `~/.sbot/preview/`, and the fence is re-run anchored on **the group's project directory from the config** (not the directory the record claims). Otherwise forging a record would be enough to put any directory on the LAN.

## Links with a token

URLs look like `http://192.168.1.75:4612/<token>/index.html`, where `token` is 10 random hex characters.

- A LAN scanner that finds the port still gets nothing (any wrong prefix is a 404), while the link in the group **just opens**, with no login.
- The token is a path prefix rather than a query parameter, so **relative** resource references in the HTML keep working; absolute references starting with `/` break, which is why a self-contained single file is preferred.
- It listens on `0.0.0.0` by default (otherwise group members could not open it); set `preview.host` to `127.0.0.1` to keep it local to the machine. HTTP is plain text, so use it only on a trusted internal network.

## Cleanup

| Trigger | Default | Done by |
|---|---|---|
| Idle with no requests | **30 minutes** | the worker exits · the daemon reaper as a backstop |
| Total running time | **8 hours** | same as above |
| Group paused / unbound / disbanded | immediately | the daemon reaper |
| `stop` / the console button | immediately | right away |
| Daemon shutdown (including upgrades) | **left alone** | previews are meant to outlive turns |

- **An automatic stop always posts a one-line notice in the group** ("Preview stopped … say so in the group if you want to see it again"); otherwise group members would find the link dead and think the bot is broken. The exception is cleanup caused by a group pause (paused means the group stays quiet): notices pending during the pause are dropped, not saved up.
- All four stop points (reaper / replacement / CLI / console) **write the decision into the record before killing the process**. The worker reads the record back from disk before every write; if it has been marked stopped, the worker writes nothing and exits. This keeps a request in progress from writing the record back to "running" and swallowing the stop notice.
- The cleanup policy **re-reads the config every round**. A setting changed in the console for a group (for example, ticking "always on") takes effect immediately on a preview that is already running. An invalid value falls back to the snapshot taken at startup rather than being read as 0 (0 means "never clean up").
- Known ceiling: a static page stops making requests once loaded, so if someone stares at a page for 40 minutes, the idle timer still runs out (the open page is unaffected; only clicking internal links breaks). Heartbeats are not injected into the user's HTML.

## Configuration

Top-level `preview` (everything optional):

```jsonc
"preview": { "idleMin": 30, "maxHours": 8, "portFrom": 4610, "portTo": 4629, "host": "0.0.0.0" }
```

- `idleMin: 0` turns off idle cleanup (`maxHours` still applies); `maxHours: 0` removes the total time limit; both 0 means always on, which `status` and doctor flag.
- **Per-group overrides:** `groups[<chatId>].preview` can override any of the above. The "Preview: always on (no automatic stop)" checkbox on the console's group card writes here (`idleMin: 0` + `maxHours: 0`). It asks for confirmation and posts a notice in the group. Whether to keep a directory exposed on the LAN for good is an admin's decision; a single message in the group should not be able to talk anyone into it.

## How the agent is taught

The self-briefing keeps exactly one proper route: **when online LAN access is needed, use `sbot preview start`** (for a self-contained HTML file, `send-file` straight to the group is still preferred); put prototypes in a subdirectory; never start a long-running server of its own, never install anything as a system service or autostart job, and **never keep a turn open to keep a link alive**. The briefing gives no specific ports or minutes (ports shift and values are configurable, so stating them could be untrue). The exact wording is in `src/core/engine.js`, and the key sentences are pinned by unit tests.

⚠ This is a soft constraint in the briefing, not enforcement at the permission layer: an agent at the full-access level can still get around it. The real defense is that a proper route exists, the console shows what is running, and the briefing spells it out.

## Console and doctor

- The console Overview's "Preview servers" section: label / group / port / directory / started / last access / idle time left, plus a Stop button.
- `sintbot doctor` lists running previews and flags those that serve the project root or are always on.

## Deliberately not done

- **Starting arbitrary processes with `--cmd "npm run dev"`:** that just repackages "the agent starts its own server", with no control over cleanup, ports or exposure.
- **HTTPS / tunnelling to the public internet / reverse proxies:** public exposure is a security question of a different order.
- **Login authentication:** opening the link and seeing the page is the whole point; the token in the link already stops scanners.
- **Directory listings / uploads / arbitrary writes**, and **more than one preview per group**.

## Known constraints

- A symlink inside serveRoot returns 404 even when it points elsewhere inside the project directory (the rule is "must be inside serveRoot"); put shared assets inside the prototype directory.
- The console's preview list does not refresh on live events, so a preview that stopped automatically disappears only on the next refresh; clicking Stop on a preview that is already gone says it "may have just been cleaned up".
- A preview that dies while the daemon is down is reported in the group as "stopped unexpectedly" only in the first cleanup round after the daemon next starts.
- Range requests are not supported, so video prototypes cannot seek.
