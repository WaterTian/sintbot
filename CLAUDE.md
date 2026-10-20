# SintBot — 给 Claude Code 的项目说明

从聊天群(飞书 / Slack / 企业微信)驱动无头 Claude Code / Codex 的 Node 守护进程。一个群绑一个项目目录;sbot 只做确定性的编排,所有智能都在它 spawn 出来的 `claude` / `codex` 进程里。

- 开发约定、代码地图、测试要求:[CONTRIBUTING.zh-CN.md](./CONTRIBUTING.zh-CN.md)(必读,尤其「约定」一节;英文版 [CONTRIBUTING.md](./CONTRIBUTING.md))
- 架构与设计决策:[DESIGN.md](./DESIGN.md)
- 用户文档:英文 [README.md](./README.md) 与 [docs/](./docs/),中文 [README.zh-CN.md](./README.zh-CN.md) 与 [docs/zh-CN/](./docs/zh-CN/)(第一批已双语,其余 docs/ 下的仍只有中文);改文档时中英两份一起改

常用:`npm test`(全量单测)· `node --test tests/unit/<模块>.test.js`(单个)· `node bin/sbot.js chat -C <目录>`(本地驱动引擎)。

改动 `bin/sbot.js` 的接线后必须真起一次进程;改控制台交互后用 headless Chrome 点一遍。
