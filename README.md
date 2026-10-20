# SintBot

> 在群聊里驱动无头 **Claude Code** —— 一个群绑一个项目,群里的人直接派活;背后的模型可以换。

[English](./README.en.md) · [官网](https://sintbot.com) · MIT

```
飞书 / Slack / 企业微信 群 ──► SintBot(本机常驻进程)──spawn──► claude CLI(无头)── Claude / DeepSeek / MiniMax / 火山 / Kimi / GLM …
                                   │                         └──► codex CLI(无头)── GPT
                                   └── 每群:项目目录 · 会话 · 排队 · 权限 · 定时任务
```

- **群即项目**:一个群绑一个本机项目目录。群里的人直接说要做什么 —— 改代码、跑脚本、查资料、出图、定时汇报 —— 机器人在那个目录里干活,做完回到群里。
- **只换脑,不换框架**:跑的是官方 `claude` / `codex` 命令行本身,工具、文件编辑、MCP、skills、子 agent、项目记忆都原样可用;模型按群选,群里发 `/model` 就能切。
- **数据留在本机**:项目、会话、记忆、账本都在你自己的机器上,不经过任何 SintBot 的服务器(提示词和它读到的代码照常发给你选的模型服务商,群消息经各聊天平台);出站消息自动脱敏;权限按群预设,没人值守也不会卡在审批上。
- **一台机器,三个平台**:飞书、Slack、企业微信可以同时在线。

## 快速开始

先按平台文档建好机器人、拉进一个群:[飞书](./docs/platforms/feishu.md)(在中国大陆推荐)· [Slack](./docs/platforms/slack.md) · [企业微信](./docs/platforms/wecom.md)。

**一键安装**(macOS / Linux,新用户推荐):

```bash
curl -fsSL https://sintbot.com/install.sh | bash
```

它会检查并装好 Node 22+、装 sintbot、接着跑配置向导,最后问要不要装成常驻服务。每一步先问再动,不用 sudo;连不上 npm 官方源会自动换国内镜像。想先看它做什么:脚本源码是仓库里的 [install.sh](./install.sh),也可以加 `--dry-run` 演练。

**手动安装**(前置:Node ≥ 22):

```bash
npm i -g sintbot          # 包名是 sintbot(npm 上的 sbot 是别人的包);装出命令 sbot,也叫 sintbot
sbot setup                # 向导:环境检查 → 地区 → 模型(当场试跑一轮)→ 聊天平台 → 项目根目录 → 绑第一个群,最后自动体检(✗ 先处理)
sbot service install      # 装成常驻服务:崩溃自动拉起、登录后自启(macOS;Linux 为实验性;Windows 打印托管命令)
```

然后在群里 @ 机器人说一句话。服务自带控制台:浏览器打开 http://127.0.0.1:4600,可以绑群、切模型、看实时活动。

### 选模型:没有 Claude 订阅也能用

向导先看这台机器上登录了什么,按这个顺序推荐:

| 你有 | 用 | 要做的 |
|---|---|---|
| Claude 订阅(Pro / Max) | Claude | 跑向导前先 `claude auth login` |
| ChatGPT 账号 | GPT(经 Codex) | `npm i -g @openai/codex`,再 `codex login` |
| 都没有 | **DeepSeek**(推荐) | 到 [platform.deepseek.com](https://platform.deepseek.com) 注册、充值、创建 API key,在向导里粘贴,当场试跑一轮 |

也可以选智谱 GLM、MiniMax、火山方舟,Kimi 等其他 Anthropic 兼容端点在控制台「模型 · 库 → 添加模型 → 自定义」添加,见 [models.md](./docs/models.md)。没有 Claude 订阅时,Claude Code 只是执行框架,不用登录;用不了的只有 GPT 群和生图(这两样借的是 Codex)。

### 在中国大陆

- **聊天平台用飞书。**
- **模型**:没有 Claude 订阅就用 DeepSeek(或智谱 / MiniMax / 火山的中国大陆站),直连,不用代理。向导问「这台机器在中国大陆吗」时答是:只有用到 Claude / ChatGPT 才会问代理。
- **开着全局代理(梯子)的话**,把模型域名设成直连,否则请求绕到境外再回来,又慢又可能触发风控,见 [install.md「代理」](./docs/install.md#代理)。
- **npm 慢**:一键安装和向导会自动换 `registry.npmmirror.com`;手动装加 `--registry https://registry.npmmirror.com`。
- **GitHub 打不开**:这份 README 在 [npmmirror 的包页](https://npmmirror.com/package/sintbot)上也能看到。

完整安装说明(Claude Code 安装与登录、向导每一步问什么、Windows、代理、无头 Mac mini、常见问题)见 [docs/install.md](./docs/install.md);各家模型的端点、国际站、计费方式见 [docs/models.md](./docs/models.md)。

## 能做什么

| | |
|---|---|
| **群内命令** | `/help` · `/status` · `/model <名字>` · `/stop`(全停)· `/skip`(跳过当前这件)· `/new`(新会话)· `/hud` · `/issue`(Slack 里 `/` 被占,用 `!` 前缀) |
| **流式回复** | 飞书卡片打字机式更新;长任务卡上实时显示做到哪一步;Slack 带原生「Working…」与 Stop 按钮 |
| **定时任务** | `sbot cron`:让机器人按时做事、按时说话,或只跑一个脚本 |
| **模型** | Claude(本机 `claude` 登录,或给 `ANTHROPIC_API_KEY`)· DeepSeek / 智谱 GLM / MiniMax / 火山方舟(预设,填 API key)· Kimi 等任意 Anthropic 兼容端点(控制台自定义)· GPT(经 Codex CLI);额度用完自动切备用 |
| **设计与出图** | 飞书画板上的标注迭代、项目级设计风格档与交付前验收、四套图标库、生图 |
| **预览与浏览器** | 把 HTML 原型挂到局域网给群成员看;机器人的浏览器碰到登录 / 验证码时,群成员用一次性链接接管 |
| **控制台** | 本地网页控制台:概览 · 群与项目 · 模型与插件库 · 设置(含版本历史),中英文切换;可选经反代开到公网(用飞书账号登录) |
| **运维** | `sbot doctor` 体检 · 运维告警群 · 被打断的轮次重启后自动重做 · 版本升级群内播报 |

## 安全须知

- 机器人能在绑定的项目目录里**执行命令**。权限按群设:默认只读;「完全访问」只给你信任的群。详见 [docs/security.md](./docs/security.md)。
- 控制台默认只听本机。要给局域网用,先 `sbot ui --set-password`。
- **订阅条款**:用个人的 Claude / ChatGPT 订阅登录来服务多人群聊,可能不符合提供方的使用条款。团队使用请改用 API key 或企业账号,并自行确认合规。

## 常用命令

```bash
sbot doctor                    # 体检:配置 / claude / 各模型 / 平台 / 群绑定;配了飞书还会用凭据调一次接口,核对 bot 身份与权限
sbot ui                        # 控制台(不接守护进程)
sbot start --ui                # 前台跑守护进程(调试用;常驻请用 sbot service)
sbot service status|restart|logs|uninstall
sbot chat -C <项目目录>        # 不接聊天平台,在终端里模拟群消息
sbot agent run "说一句话"      # 单轮试跑(只读,在当前目录;-C 指定目录)
sbot help                      # 全部命令
```

配置在 `~/.sbot/config.json`,字段说明见 [docs/config.md](./docs/config.md),带注释的完整示例见 [sbot.config.example.json](./sbot.config.example.json)(`sbot setup` 写出的配置保留这些注释)。

## 验证现状与反馈

macOS 上飞书与 Slack 的主流程(收发消息、流式进度、换模型、定时任务)已真机验过。下面这些有单元测试,但真实环境里用得还少,欢迎试用后反馈:

- Slack 的 `!status`、「Working…」旁的原生 Stop、线程里的「停止 / 跳过 / 状态」按钮;
- 企业微信(三个平台里最新接入的);
- Linux(实验性)与 Windows(未验证)。

碰到问题请到 [GitHub Issues](https://github.com/WaterTian/sintbot/issues) 提,附上 `sbot --version`、系统与聊天平台、`sbot doctor` 输出和复现步骤(贴日志前先遮掉密钥)。安全问题请按 [SECURITY.md](./SECURITY.md) 私下报告,别发公开 issue。

## 文档

- [安装](./docs/install.md) · [配置](./docs/config.md) · [模型](./docs/models.md) · [功能详解](./docs/features.md) · [安全](./docs/security.md)
- 平台:[飞书](./docs/platforms/feishu.md) · [Slack](./docs/platforms/slack.md) · [企业微信](./docs/platforms/wecom.md)
- 功能:[画板](./docs/BOARD.md) · [预览](./docs/PREVIEW.md) · [浏览器](./docs/BROWSER.md) · [图标](./docs/ICONS.md) · [Codex 后端](./docs/CODEX-RUNNER.md) · [控制台公网访问](./docs/PUBLIC-ACCESS.md)
- 架构与设计:[DESIGN.md](./DESIGN.md) · 参与开发:[CONTRIBUTING.md](./CONTRIBUTING.md)

## 许可

[MIT](./LICENSE) © WaterTian
