# 发版(维护者)

包名 `sintbot`,发到公开 npm;运行时依赖只有飞书 SDK 与 `ws`。

## 检查清单

1. `package.json` 的 `version` 加一版;`CHANGELOG.json` 顶部加同版本条目,`CHANGELOG.en.json` 补英文(按 `version` 对应,缺了控制台英文界面回退中文)。
   - 条目是**群成员看的**:控制台「版本历史」与升级后的群内播报都读它。写人话,不出现命令名、内部路径和 HTML 标记(单测会挡标记)。
   - `date` 按产品时区(默认北京)当天写。
2. `npm test` 全绿(CI 在 Node 22 / 24 / 26 上跑同一套)。
3. 动过控制台交互的,用 headless Chrome 实际点一遍。
4. `npm pack --dry-run`,逐项看文件清单:只应有 `bin/ src/ assets/ CHANGELOG*.json sbot.config.example.json docs/slack-app-manifest.yaml README.md README.en.md LICENSE THIRD-PARTY-NOTICES.md package.json`。白名单在 `package.json` 的 `files`;新增运行时要读的资源文件,记得加进去。

## 隔离验证

装到临时前缀跑一遍,防止「源码树里能跑、装出来缺文件」:

```bash
npm pack
P=$(mktemp -d) && npm i -g --prefix "$P" ./sintbot-*.tgz
"$P/bin/sbot" version
HOME=$(mktemp -d) "$P/bin/sbot" doctor      # 空 HOME:应报「没配置」类 warn,不应有模块找不到之类的报错
```

## 发布

```bash
git tag v$(node -p "require('./package.json').version") && git push --tags
npm publish
```

改过根目录的 `install.sh` 的话,发布后把它原样拷到官网仓库 [sintbot-site](https://github.com/WaterTian/sintbot-site) 根目录并推送(`https://sintbot.com/install.sh` 是那份副本)。

## 部署到在跑的机器

```bash
npm i -g sintbot@latest && sbot service restart
```

重启会中止正在跑的轮次(重启后自动重做)。挑各群空闲时做;有多台机器就逐台来,每台重启后看一眼 `sbot service logs` 与 `sbot doctor`。

不想让这次升级在群里播报:重启前把 `~/.sbot/state.json` 的 `lastVersion` 改成新版本号。
