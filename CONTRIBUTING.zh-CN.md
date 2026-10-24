# 参与开发

[English](./CONTRIBUTING.md) · 简体中文

参与本项目请遵守[行为准则](./CODE_OF_CONDUCT.md)(英文)。报问题、提建议请用 [issue 表单](https://github.com/sintlab/sintbot/issues/new/choose)。

## 跑起来

```bash
git clone https://github.com/sintlab/sintbot.git && cd sintbot
npm install
npm test                                   # 零依赖 node --test,CI 跑 Node 22 / 24 / 26
node bin/sbot.js chat -C /path/to/project  # 不接聊天平台,终端里模拟群消息
node bin/sbot.js agent run "say hi"        # 单轮无头试跑
```

前置:Node ≥ 22,`claude` 在 PATH 上。

## 代码地图

```
bin/sbot.js            CLI 入口与所有子命令的接线(setup / start / ui / service / feishu / cron …)
src/core/              引擎:群 → 会话 / 锁 / 队列 / 去重 / slash 命令 / 自知清单 / 定时任务 / 脱敏 / 账本
src/agent/             runner:claudecode.js(spawn claude)· codexcode.js(spawn codex)· 额度 / 登录态探测
src/platform/          聊天平台适配器:feishu.js · slack.js · wecom.js · multi.js(多平台路由)
src/ui/                控制台:server.js(http + SSE)· console.html(单文件前端)
src/*.js               配置、体检、插件、设计风格档、预览、服务安装等
tests/unit/            单测(一个模块一个文件)
```

架构与关键设计决策见 [DESIGN.md](./DESIGN.zh-CN.md);接口契约在 `src/core/interfaces.js`。

## 约定

- **core 不认具体平台和 agent 的名字**:`src/core/` 里不出现 "feishu" / "slack" / "claudecode",只认 `interfaces.js` 里的契约。新平台 = 新适配器 + 在 `bin/sbot.js` 里接线。
- **用户面零工具名**:控制台与群消息里不出现 `sbot` 等命令名、也不出现机器内部路径(`~/.sbot/…`、安装目录)。群成员面前产品只有一个名字(`brand`)。注入给 agent 的自知清单里的命令名不受此限,那是执行指令,群成员看不见。新增用户可见文案前先问:这句话里的东西,群成员需要知道它叫什么吗?
- **无头 = 永不挂起**:任何可能等交互输入的地方(审批、git 密码、host key 确认)都要有策略或超时兜底。
- **不硬编码密钥**,示例里用 `"env:VAR"`。
- **出货物里不点名其他同类产品**(README、文档、注释、package.json)。
- 每个 `sbot <子命令>` 都要能答 `--help`,并出现在 `sbot help` 的清单里(`tests/unit/cli-help.test.js` 会检查)。
- **文档双语**:英文在原路径,中文在 `docs/zh-CN/`;仓库根目录的中文文件用 `.zh-CN.md` 后缀。改了中英都有的文档,两份一起改。
- `bin/sbot.js` 顶部统一解构 require(`tests/unit/bin-wiring.test.js` 会检查调用与导出是否对得上);改了 bin 的接线,务必真起一次进程。

## 测试与验证

- 新逻辑尽量写成纯函数再单测;涉及网络的用注入的假实现,单测里不发真请求。
- **否定结论要带对照组**:「页面上没有 X」「扫描没发现问题」这类断言,同时断言一个必然存在的东西,它为 0 就说明这次根本没扫到。
- 改控制台交互:推之前用 headless Chrome 实际点一遍。

## 提交

- 一个提交一件事;说明写清「为什么」。
- 版本历史条目(`CHANGELOG.json` / `.en.json`)是写给群成员看的,见 [docs/RELEASE.md](./docs/zh-CN/RELEASE.md)。

## 许可

SintBot 采用 [PolyForm Shield 1.0.0 许可](./LICENSE)。提交贡献即表示你同意它按同一许可提供,并同意维护者日后可以改换许可(包括改为开源许可)。
