# Public console access: SSH reverse tunnel + nginx + Feishu sign-in

English · [简体中文](./zh-CN/PUBLIC-ACCESS.md)

> How to open the LAN-only console to the public internet safely: a server with a public IP serves as the entry point, and sign-in uses Feishu accounts (no more passwords to remember).
> This document covers only the mechanics, constraints and acceptance checks. Keep your own instance's addresses, usernames and ports in a separate local document, and **never commit them to any repository**.
> How LAN access, the access password and Feishu sign-in work: [DESIGN.md §4.9](../DESIGN.md#49-the-console-and-access-security). Installation: [install.md](./install.md).

## 1. Topology

```
phone/computer ──HTTPS──► public server nginx ──► 127.0.0.1:1417x ──SSH reverse tunnel──► the Mac's 192.168.x.x:4600 (console)
                          TLS · rate limits · two APIs blocked                              the only door: "Sign in with Feishu"
```

- A Mac at home or in an office usually sits behind NAT with no public entry point, so the tunnel can only be built **outbound**: each Mac runs `ssh -N -R` as a long-running launchd job, forwarding its console port to a loopback port on the server.
- nginx on the server terminates HTTPS (reusing an existing certificate), applies rate limits, returns 403 for two APIs outright, and reverse-proxies to the tunnel port. **nginx does no authentication**; authentication happens in the console itself.
- One subdomain per Mac: the console front end calls its APIs at root paths, so it can't be mounted under a subpath.

## 2. Sign-in: Feishu accounts, admins only

The first time: click "Sign in with Feishu" → the Feishu app takes over on your phone and you tap once to authorize (on a computer, scan with Feishu or click in the signed-in client) → back to the console. After that, **you type nothing for 30 days**, and restarting the daemon doesn't sign you out.

- **Who can get in:** only the people on the admin list under Settings → Feishu app. That list already means "who may speak for this machine", and sign-in reuses it. Someone not on the list is refused even after a successful authorization, and it goes into the audit log.
- **How to turn it on:**
  - In "Sign in to the console with Feishu" on the Settings page, enter the public address (`https://domain`, no path). The page shows a callback URL; add it in the Feishu Open Platform under that app's Security settings → Redirect URLs (the full path; it must be HTTPS).
  - Several machines means several Feishu apps, each configured on its own.
  - Registration **takes effect immediately, with no new app version**. Without it, "Sign in with Feishu" stops on Feishu's error page (error code 20029, "redirect_uri 请求不合法", invalid redirect_uri). curl against the authorization endpoint tells you too: unregistered returns a 200 error page, registered returns a 302.
- **When the entry appears:** only when the public address, the app credentials and the admin list are all present; the Settings page says which is missing. Until then, the login page shows only the password field, so nobody gets locked out.
- **Password login still exists** on the machine itself and on LAN IPs. On the public domain, the login page shows no password field, and nginx returns 403 for the password-login API outright, so **there is no password to guess on the public internet**.
- **Signing out:** "Sign out" on the Settings page voids only this device's session; "Sign out all devices" revokes every sign-in this machine has issued (use it if a phone is lost).
- **Removing someone from the list or changing the password takes effect immediately.** Sessions are stored on disk, so they outlive the process. Each session therefore records identity hints from when it was issued; when the config changes (admin list / password), old sessions fail on their next request, without waiting 30 days.

Flow details (standard OAuth 2.0 authorization code):

1. The start endpoint issues a one-time state (10 minutes, at most ten thousand outstanding; too small a cap would let someone flood it and push out other people's).
2. 302 to Feishu's authorization page.
3. The callback checks the state, exchanges it for a `user_access_token` and fetches the `open_id`.
4. The `open_id` is checked against the list, and a session is issued.
5. A landing page writes the token into browser storage and goes back to the home page.

The login token never travels in a URL. The event stream's token does go in the URL query, which is contained by turning off nginx access logging for that path and lowering its error log to the crit level (when the tunnel drops, nginx writes the request line to the error log).

## 2b. Setting it up from scratch (each step verifiable on its own)

1. **DNS:** give each Mac a subdomain, with an A record pointing to the public server.
2. **Server** (per §4, only adding, never changing existing things):
   - create the tunnel user, then install the two restricted public keys;
   - the sshd `Match User` snippet: `sshd -t` → compare the two views → `reload`;
   - the two nginx site files: `nginx -t` → check for other people's unfinished changes → `reload`, then verify with a forged Host that the default site hasn't changed.
3. **Mac** (per §5):
   - generate the tunnel key;
   - seed `known_hosts` and compare the fingerprint with the other Mac;
   - try `ssh -N -R` once by hand: the port is listening on the server, the login page comes through the tunnel with no injected token, and a wrong Host gets 403;
   - install the long-running launchd job, then kill it once and watch it reconnect.
4. **Console:** enter the public address on the Settings page; copy the callback URL shown on the page into the Feishu Open Platform under Security settings → Redirect URLs; confirm the Settings page shows that Feishu sign-in is ready.
5. **Acceptance:** run §6 row by row, then go through "Sign in with Feishu → authorize → into the console" from the public internet with a real person's Feishu account, and try it once on a phone.
6. **Record it:** leave a README on the server (what was added, how to check it is alive, how to remove it), and keep the instance values in a private document on this machine.

## 3. Hard constraints from the console code (breaking them is a security incident)

| Constraint | Source | Consequence |
|---|---|---|
| **The tunnel's far end must be the Mac's LAN address, never 127.0.0.1:4600** | The console **injects a token without a password** for requests from local loopback (judged by the TCP source address) | Pointing it wrong = everyone on the internet gets in without a password. The code has one more safeguard: loopback requests carrying `X-Forwarded-*` headers don't count as local (a local browser never sends them; nginx always does) |
| **nginx must rewrite `Host` to `192.168.x.x:4600`** | The console's Host allow list accepts only loopback and private IPv4 (against DNS rebinding) | Not rewriting = the console returns 403 |
| **`/api/events` must stay out of the access log** | The event stream's token travels in the URL query | In the log = the token is written to disk |
| **The browser-takeover stream `/api/browser/stream` sends its token in a request header** | It is read as a fetch stream, not with EventSource, so the token never enters the URL and the access log needs no further exclusion | — |
| **A one-time link's ticket is in the URL fragment (`/browser#k=<ticket>`)** | Fragments are never sent to the server, so the access log has no tickets; the page POSTs to redeem it only when someone clicks "Start takeover" | Bare GETs (link previews / scanners) can't capture the ticket |
| **nginx must pass `X-Forwarded-Proto: https`** | The takeover cookie adds `Secure` based on it; the console uses it to tell "not local" | Not passing it = the cookie lacks `Secure` |

Also: the console **doesn't check Origin/Referer** (so behind the reverse proxy, a browser sending the public domain as Origin isn't refused); the request body limit is 1 MB (matching nginx's default `client_max_body_size 1m` exactly); and the only unauthenticated APIs are password login and the Feishu sign-in start and callback (the last two accept only GET).

## 4. What to add on the server (and only this)

| Type | Content | Key points |
|---|---|---|
| System user | A tunnel-only user with no shell | `useradd -m -s /usr/sbin/nologin` |
| Public keys | One line per Mac | `restrict,port-forwarding,permitlisten="127.0.0.1:1417x" ssh-ed25519 …`: it can only listen on the given loopback port and can't open a shell |
| sshd snippet | One **`Match User <tunnel user>`** block in `sshd_config.d/` | Password login off, `AllowTcpForwarding remote`, `PermitTTY no`, **`ClientAliveInterval 30` + `ClientAliveCountMax 3`** |
| nginx sites | One separate file per Mac | 80 → 301 https; 443 = certificate + HSTS + `X-Frame-Options DENY` + `Referrer-Policy same-origin` + reverse proxy; `= /api/plugins/exec` and `= /api/login` return 403 outright; `^~ /api/auth/feishu/` rate-limited; `= /api/events` with access logging off and the error log lowered to crit; **`^~ /api/browser/` not rate-limited** (see below; it must come before `/`); `/` with a loose rate limit |

**Why the keepalive settings go in `Match User` rather than globally:** the classic reverse-tunnel failure is that after the Mac loses its network, a dead session on the server keeps holding the port, and the new tunnel keeps exiting because of `ExitOnForwardFailure`. Keepalives get the dead session kicked within about 90 seconds. Setting them globally would affect every session on the server; in `Match User` they affect only the tunnel user, which you can prove by comparing `sshd -T -C user=root` with `user=<tunnel user>`. In testing: after freezing the ssh process on the Mac, the server released the port in 121 seconds, and the port came back once launchd restarted the tunnel.

**The nginx file name must sort last in `conf.d`** (for example with a `zz-` prefix). For an "unknown Host", nginx uses the **first** server block on that port as the default site. A new file that sorts earlier alphabetically takes over the existing default site, and what other people see when connecting by IP changes. A control request with `Host: evil.example` reveals it.

**Browser takeover needs its own block, and it must come before `location /`.** The takeover page sends input events in batches every 33 ms, about **30 r/s**, which runs into `/`'s `120r/m burst=60`: dragging a slider returns 503 after about two seconds (group members see "input didn't get through"). The stream is also a long-lived connection, which `/`'s short read timeout can't handle.

```
# Top of the site file (outside the server block, still in the http context; no need to touch nginx.conf)
# ⚠ With several machines, name the zones per machine (sbot_conn_a / sbot_conn_b): the same zone name in two site files makes nginx -t report a duplicate
limit_conn_zone $binary_remote_addr zone=sbot_conn_17x:1m;
# Upstream connection reuse: without it, every request opens a new channel in the SSH tunnel and pays about 100 ms for nothing (measured: new connection 130–160 ms / reused 40 ms).
# It takes effect only together with server-level proxy_http_version 1.1 + proxy_set_header Connection ""; keepalive_timeout must be shorter than the
# console's Node-side idle timeout (5 seconds by default), or nginx will send a request on a connection the other end has just closed. Every proxy_pass below points at it.
upstream sbot_up_17x { server 127.0.0.1:1417x; keepalive 8; keepalive_timeout 4s; }

location ^~ /api/browser/ {
    # This block deliberately has no limit_req; it only blocks concurrency abuse. 16 is enough even for two viewers sharing one exit IP:
    # HTTP/1.1 browsers open at most 6 connections per host, plus 1 for the stream, so one viewer uses ≤ 7.
    limit_conn sbot_conn_17x 16;
    proxy_pass http://sbot_up_17x;
    # proxy_buffering off · proxy_read_timeout 1h · the Host rewrite · X-Forwarded-Proto are all at server level
    # and inherited here; no need to repeat them (repeating them would only drift from the server level).
}
```

Acceptance (hitting the public entry point from another machine with `curl -Z`): `/api/browser/tabs` at 6 concurrent × 100 gives all 401s and zero 503s; 12 concurrent × 100 still gives zero 503s (proving the 16 is in effect); the control, `/api/state` at 6 concurrent × 100, gives 50 503s (proving `/`'s rate limit is still there); other sites on the server still return 200 after the reload. ⚠ **The concurrency in the acceptance test must be below `limit_conn`**; otherwise you are measuring the concurrency cap, not the rate-limit exemption (20 concurrent, for example, produces a burst of 503s that looks like "it didn't take effect").

## 5. The Mac side

`~/Library/LaunchAgents/com.sbot.tunnel.plist` with `KeepAlive` + `RunAtLoad` + `ThrottleInterval 15`, managed the same way as the daemon:

```
/usr/bin/ssh -N -i ~/.ssh/sbot_tunnel -p <port> \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20 \
  -R 127.0.0.1:1417x:192.168.x.x:4600 <tunnel user>@<server>
```

- Seed `known_hosts` first with `ssh-keyscan -p <port>`, and **compare the fingerprint with the one the other Mac recorded** (the same key means the same machine).
- Logs go to the plist's `StandardErrorPath` (ssh -N prints nothing when all is well). For a timestamp on every line, make the first ProgramArguments item a wrapper script that pipes its own output into a timestamping child process and then `exec`s ssh. ssh stays the main process in launchd's eyes, so kickstart / bootout signals reach it directly. To stop it: `launchctl bootout gui/$(id -u)/com.sbot.tunnel`.
- The tunnel's `-R` far end is pinned to the Mac's LAN IP: **if the IP drifts, the tunnel points at a dead address, the public side returns 502, and it doesn't heal itself**. Give the Mac a fixed IP on the router (a DHCP reservation).
- **Recycle the tunnel once a day** with another LaunchAgent (such as `com.sbot.tunnel-recycle.plist`): use `StartCalendarInterval` to run `launchctl kickstart -k gui/$(id -u)/com.sbot.tunnel` at a time nobody uses it.
  - **Why:** KeepAlive only reconnects after a disconnect. A TCP connection that stays alive for about a week can have its congestion window collapse to single digits, with thousands of retransmissions.
  - The symptom isn't "won't open" but **the takeover stream filling the send queue as soon as it starts, so each input event takes 1–2 seconds and sliders won't drag**. One kick fixes it immediately.
  - Evidence: on the server, `ss -tin state established "( sport = :<sshd port> )"` shows cwnd / retrans; on the Mac, `netstat -an -p tcp | grep <server>.<port>` shows Send-Q (stuck at 131072 = full).
  - The cost is that the public console drops for about 2 seconds, and the takeover page reconnects its view by itself.

## 6. Acceptance (always with a control)

| Check | Expected | Control |
|---|---|---|
| Bare request to `/` from the public internet | 200 login page; the page **doesn't contain** an injected 32-character token, and has only "Sign in with Feishu" with no password field | Opened from a LAN IP: both the button and the password field |
| Public `POST /api/login` | 403 (from nginx) | The same request on the LAN: 200/401 (from the console) |
| Public `GET /api/auth/feishu/start` | 302, with Location set to Feishu's authorization page and the registered callback URL | A machine with no public address configured: 400, saying what is missing |
| A forged `Host` against the server | Lands on the existing default site (200) | Not the console page |
| `POST /api/plugins/exec` | 403 (from nginx) | `/api/state` without a token: 401 (from the console) |
| Callback after Feishu authorization | Landing page 200, a 48-character token in browser storage, `/api/state` 200 | An account not on the list: 403 and no token; replaying the same state: 400 |
| `/api/events?token=` | `event: hello` within 5 seconds | The access log has 0 lines for `api/events` and ≥1 for `api/state` |
| Rate limits let `/api/browser/` through. **This needs `curl -Z` (concurrent, reusing connections) sending N requests**; opening a new TLS connection each time is too slow to reach the threshold, and the control would falsely pass | N requests to `/api/browser/input`, zero 503s | The same N to `/api/state` should produce 503s (proving the rate limit is still there) |
| Restart the daemon | The token is still valid | 401 after "Sign out" |
| Remove someone from the admin list | That person's session gets 401 on the next request | People not removed still get 200 |
| Change / remove the console password | Sessions issued by password get 401 | Those issued by Feishu still get 200 |
| "Sign out all devices" | Every token gets 401 | — |
| A local loopback request with `X-Forwarded-For` | No password-free token is injected | Local requests without that header still get one, as before |
| Freeze ssh on the Mac (`kill -STOP`) | The server releases the port in ≈90–120 seconds | After `kill -CONT` and a kill, launchd restarts it and the port comes back |
| Upstream connection reuse | 4 consecutive `/api/state` requests through nginx: the first about 150–200 ms (new channel), each later one about 80 ms; `ss -tnp` shows idle nginx→1417x connections | 8 rounds each of mixed GETs and POSTs at intervals of 0 / 3.5 / 4.5 / 5.5 seconds: only 401 / 410 allowed, never 502 (the stale-connection race) |
| `sintbot doctor` / the console's Access address card | Unaffected | — |
| Requests from an overseas exit (proxy) | Same results as from the server itself | — |

## 7. When the server is shared

- **Only add files; change no existing file:** don't touch the `sshd_config` itself, `nginx.conf`, any existing site, certificates, the firewall or anyone else's keys.
- **Don't enable ufw:** take stock with `ss -ltnp` first. Other projects often listen on public ports directly, and enabling it would cut them all off.
- **Don't restrict other projects' deploy keys;** the tunnel uses its own user and key.
- **Don't touch root's password login:** check `auth.log` first for who logs in with a password; it may be another user of the server.
- **Before reloading nginx, check whether someone else has unfinished changes that weren't reloaded.** The test is to compare **the worker processes' start time** (a reload respawns the workers; the master process's time is useless) with the mtime of `conf.d/*`. If `nginx -t` fails because of someone else's file, stop.
- **For sshd, use `systemctl reload ssh`, not restart.** Open a second session as a fallback before changing anything, and reload only after `sshd -t` passes.
- **The first two lines of every added file say who it belongs to and what breaks if it is deleted,** and a README stays on the server (what was added, how to check it is alive, how to remove it). Only if others can see this will they not clean it up as junk.
- Give the server's other users a heads-up before you start.

## 8. Passwords, sessions and upgrade paths

- There is no password on the public internet. LAN password login remains; keep that password in a password manager and **never write it into a repository or any document**.
- **Settings → Server** has separate controls for LAN listening and Feishu sign-in on the public entry. Enabling LAN access requires an access password; the listener changes immediately, while the system firewall remains an operator setting. Turning off public Feishu sign-in revokes existing Feishu sessions, but does not edit nginx or the SSH tunnel.
- This setup's tunnel forwards to the Mac's LAN address, so turning off LAN listening also makes that public tunnel unable to reach the console. To pause public sign-in only, keep LAN listening enabled and turn off **Public Feishu sign-in**.
- Session tokens are stored on disk (`~/.sbot/ui-sessions.json`, 0600) for a fixed 30 days; "Sign out" on the Settings page voids this device's, and "Sign out all devices" revokes them all.
- Known limitation: if a separately started console process (`sintbot ui`) and the daemon's built-in console are open **at the same time**, each keeps its own in-memory table and overwrites the same session file in full. That only loses sign-ins and never grants extra access; running only the daemon's console, as usual, avoids it.
- For more security: add **client certificates** at the nginx layer (a private CA signs a certificate for each device; without one, a device can't even knock on the door), with Feishu sign-in unchanged. It is one change in nginx and nothing else.
- An optional small sbot change (not done): `ui.trustProxy`, which would allow given Hosts, turn off password-free access for the same machine, and take audit IPs from `X-Forwarded-For`. With it, the tunnel's far end could point to loopback, which would also cure the "IP drift" issue above.
- An optional second phase: add the console to the Feishu Workbench as a web app, so opening it from inside Feishu skips even the one authorization click (Feishu's docs confirm this seamless sign-in only works inside the client).

## 9. Uninstalling (in order; each step independently reversible)

Server: delete the two nginx files → `nginx -t` → reload; delete the sshd snippet → `sshd -t` → reload; `userdel -r` the tunnel user; delete the logs.
Mac: `launchctl bootout gui/$(id -u)/com.sbot.tunnel` → delete the plist → delete `~/.ssh/sbot_tunnel*`; clear the public address on the Settings page.
