# 发版(维护者)

[English](../RELEASE.md) · 简体中文

包名 `sintbot`,发到公开 npm;运行时依赖只有飞书 SDK 与 `ws`。

## 检查清单

1. `package.json` 的 `version` 加一版;`CHANGELOG.json` 顶部加同版本条目,`CHANGELOG.en.json` 补英文(按 `version` 对应,缺了控制台英文界面回退中文)。
   - 条目是**群成员看的**:控制台「版本历史」与升级后的群内播报都读它。写人话,不出现命令名、内部路径和 HTML 标记(单测会挡标记)。
   - `date` 按产品时区(默认北京)当天写。
2. `npm test` 全绿(CI 在 Node 22 / 24 / 26 上跑同一套)。
3. 动过控制台交互的,用 headless Chrome 实际点一遍。
4. `npm pack --dry-run`,逐项看文件清单:只应有 `bin/ src/ assets/ CHANGELOG*.json sbot.config.example.json docs/slack-app-manifest.yaml README.md README.zh-CN.md LICENSE THIRD-PARTY-NOTICES.md package.json`。白名单在 `package.json` 的 `files`;新增运行时要读的资源文件,记得加进去。

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

`main` 与 `v*` 标签受仓库规则集保护:不能删除、不能强推,标签推上去就不能再移动。所以先等 CI 全绿再打标签;标签打错了只能发下一个版本号。

发布后:

- 建 GitHub Release:标签 `v<版本>`,英文说明(本版改了什么 + 升级命令),设为 Latest。
- 官网仓库 [sintbot-site](https://github.com/WaterTian/sintbot-site) **自动跟上**:每小时一次的工作流发现 npm 出了新版,就改官网版本号、换上该版标签的 `install.sh`(`https://sintbot.com/install.sh` 是它的副本)、重新生成页面并上线;失败会发邮件。不想等整点:`gh workflow run version-sync.yml -R WaterTian/sintbot-site`。

## 部署到在跑的机器

```bash
npm i -g sintbot@latest && sintbot service restart
```

重启会中止正在跑的轮次(重启后自动重做)。挑各群空闲时做;有多台机器就逐台来,每台重启后看一眼 `sintbot service logs` 与 `sintbot doctor`。

不想让这次升级在群里播报:重启前把 `~/.sbot/state.json` 的 `lastVersion` 改成新版本号。
