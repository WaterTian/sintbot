# Contributing

English · [简体中文](./CONTRIBUTING.zh-CN.md)

Everyone taking part is expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Bugs and feature requests go through the [issue forms](https://github.com/sintlab/sintbot/issues/new/choose).

## Getting it running

```bash
git clone https://github.com/sintlab/sintbot.git && cd sintbot
npm install
npm test                                   # zero-dependency node --test; CI runs Node 22 / 24 / 26
node bin/sbot.js chat -C /path/to/project  # simulate group messages in the terminal, no chat platform needed
node bin/sbot.js agent run "say hi"        # a single headless trial turn
```

Requirements: Node.js ≥ 22, with `claude` on the PATH.

## Code map

```
bin/sbot.js            CLI entry point and the wiring of every subcommand (setup / start / ui / service / feishu / cron …)
src/core/              the engine: group → session / lock / queue / dedup / slash commands / self-briefing / scheduled tasks / redaction / ledger
src/agent/             runners: claudecode.js (spawns claude) · codexcode.js (spawns codex) · quota and login probes
src/platform/          chat platform adapters: feishu.js · slack.js · wecom.js · multi.js (multi-platform router)
src/ui/                the console: server.js (http + SSE) · console.html (single-file front end)
src/*.js               config, health checks, plugins, design style files, previews, service install and more
tests/unit/            unit tests, one file per module
```

Architecture and key design decisions: [DESIGN.md](./DESIGN.md) (in Chinese). Interface contracts live in `src/core/interfaces.js`.

## Conventions

- **The core does not know platform or agent names.** `src/core/` never mentions "feishu", "slack" or "claudecode"; it only knows the contracts in `interfaces.js`. A new platform means a new adapter plus wiring in `bin/sbot.js`.
- **No tool names in front of users.**
  - The console and group messages show no command names such as `sbot`, and no internal machine paths (`~/.sbot/…`, the install directory). In front of group members, the product has one name only (`brand`).
  - Command names inside the agent's self-briefing are exempt: they are instructions to execute, and group members never see them.
  - Before adding user-visible text, ask: do group members need to know what this thing is called?
- **Headless means never hang.** Anything that might wait for interactive input, such as an approval, a git password or a host-key confirmation, must have a policy or a timeout as a fallback.
- **Never hard-code secrets.** Use `"env:VAR"` in examples.
- **Shipped material does not name other products in the same space.** This covers the README, docs, comments and package.json.
- **CLI help.** Every `sbot <subcommand>` must answer `--help` and appear in the `sbot help` list; `tests/unit/cli-help.test.js` checks this.
- **Bin wiring.** `bin/sbot.js` destructures its requires at the top, and `tests/unit/bin-wiring.test.js` checks that calls match exports. After changing the bin's wiring, always start the process for real once.
- **Docs are bilingual.** English lives at the original path and Chinese under `docs/zh-CN/`; at the repo root, Chinese files use the `.zh-CN.md` suffix. When you change a doc that exists in both languages, update both. Some feature docs are still Chinese only.

## Testing and verification

- Write new logic as pure functions where possible and unit-test them. Anything that touches the network uses injected fakes; unit tests never make real requests.
- **Negative results need a control.** An assertion such as "X is not on the page" or "the scan found no problems" must also assert something that is certainly there. If that comes out as 0, the scan never actually ran.
- **Console changes:** before pushing, click through the change in headless Chrome.

## Commits

- One commit, one change; explain the "why" in the message.
- Release-history entries (`CHANGELOG.json` / `.en.json`) are written for group members; see [docs/RELEASE.md](./docs/RELEASE.md) (in Chinese).

## License

SintBot is licensed under the [PolyForm Shield License 1.0.0](./LICENSE). By submitting a contribution, you agree that it is licensed under the same terms and that the maintainer may relicense it, including under an open-source license.
