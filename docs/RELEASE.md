# Releasing (maintainers)

English · [简体中文](./zh-CN/RELEASE.md)

The package is `sintbot`, published to the public npm registry. Its only runtime dependencies are the Feishu SDK and `ws`.

## Checklist

1. Bump `version` in `package.json`. Add an entry for the same version at the top of `CHANGELOG.json`, and the English one in `CHANGELOG.en.json` (matched by `version`; if it is missing, the console's English interface falls back to Chinese).
   - Entries are **read by group members**: the console's version history and the group announcement after an upgrade both use them. Write plainly, with no command names, internal paths or HTML markup (a unit test rejects markup).
   - Set `date` to the current day in the product time zone (Beijing by default).
2. `npm test` passes in full (CI runs the same suite on Node 22 / 24 / 26).
3. If console interactions changed, click through them in headless Chrome.
4. Run `npm pack --dry-run` and check the file list item by item. It should contain only `bin/ src/ assets/ CHANGELOG*.json sbot.config.example.json docs/slack-app-manifest.yaml README.md README.zh-CN.md LICENSE THIRD-PARTY-NOTICES.md package.json`. The allow list is `files` in `package.json`; when you add a resource file that is read at run time, add it there.

## Isolated check

Install into a temporary prefix and run it, to catch "works in the source tree, files missing once installed":

```bash
npm pack
P=$(mktemp -d) && npm i -g --prefix "$P" ./sintbot-*.tgz
"$P/bin/sbot" version
HOME=$(mktemp -d) "$P/bin/sbot" doctor      # empty HOME: expect "not configured" warnings, never module-not-found errors
```

## Publishing

```bash
git tag v$(node -p "require('./package.json').version") && git push --tags
npm publish
```

`main` and the `v*` tags are protected by repository rulesets: they can't be deleted or force-pushed, and a tag can't be moved once pushed. So wait for CI to pass before tagging; a wrong tag can only be fixed by releasing the next version number.

After publishing:

- Create a GitHub Release: tag `v<version>`, English notes (what changed in this version + the upgrade command), marked as Latest.
- The website repo [sintbot-site](https://github.com/WaterTian/sintbot-site) **follows automatically**: an hourly workflow notices the new version on npm, updates the site's version number, swaps in that tag's `install.sh` (`https://sintbot.com/install.sh` is a copy of it), regenerates the pages and deploys them; failures send an email. To skip the wait: `gh workflow run version-sync.yml -R WaterTian/sintbot-site`.

## Deploying to running machines

```bash
npm i -g sintbot@latest && sintbot service restart
```

A restart aborts turns in progress (they are redone automatically after the restart). Do it when the groups are idle. With several machines, go one at a time and check `sintbot service logs` and `sintbot doctor` after each restart.

To keep this upgrade from being announced in the groups: before restarting, set `lastVersion` in `~/.sbot/state.json` to the new version number.
