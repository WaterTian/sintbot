# GPT 群:Codex CLI 后端

[English](../CODEX-RUNNER.md) · 简体中文

> 群的 provider 设成 `runner: "codex"` 时,这个群的每一轮由官方 `codex exec` 来跑,认证用本机的 `codex login`(ChatGPT 订阅),配置里不放任何 key。实现:`src/agent/codexcode.js`(轮次)· `src/agent/codexstatus.js`(登录态与额度)。

## 配置

```jsonc
"codex": { "runner": "codex", "reasoningEffort": "medium", "toolQuality": "high" }
```

- `model` 不写 = codex 自己的默认(`~/.codex/config.toml` 里的 `model`,没有就是官方默认)。示例有意不钉:钉死的型号会随新模型发布过时,而且有的型号 ChatGPT 账号登录用不了(报「model is not supported when using Codex with a ChatGPT account」)。要钉就先用 `codex debug models` 核对这个账号能用哪些。
- `reasoningEffort` → `-c model_reasoning_effort=<档>`;不写 = 模型默认。
- 群里 `/model codex` 即可切到这个后端;切回 Claude 同理。

## 认证(机器上一次性配好,SintBot 不碰)

- `codex login` 走浏览器 OAuth,要图形界面;没有的话用 `codex login --device-auth`,或在有浏览器的机器上登录后把 `~/.codex/auth.json` 拷过来。
- 凭据可能存在文件里,也可能在系统钥匙串里(`cli_auth_credentials_store`,默认 auto)—— 判断登录态用 `codex login status`(已登录退出码 0),不要看 `auth.json` 在不在。
- SintBot 不写 `~/.codex/` 下的任何文件,不设 `CODEX_HOME`;spawn 时还会**清掉继承来的 `OPENAI_API_KEY`**,保证用的一定是订阅登录,不会悄悄走按量计费。
- GPT 群和你自己在终端里用的 Codex **共用同一份订阅额度**(5 小时 / 每周窗口)。GPT 群宜少而精;额度用完时这一轮干净地失败并在群里说明,不会挂起。

## 每一轮怎么跑

```
首轮:codex exec --skip-git-repo-check --sandbox <档> -c approval_policy=never [-c model_reasoning_effort=…] [-c model_auto_compact_token_limit=…] [--model …] --json --cd <项目目录> -
续接:codex exec resume <thread_id> --skip-git-repo-check -c sandbox_mode=<档> -c approval_policy=never […] --json -
```

- 提示词走 stdin(末尾的 `-`)。codex 没有 `--append-system-prompt`,所以群的项目说明拼在首轮提示词前面。
- `exec` 不认交互式的 `--ask-for-approval`,只能用 `-c approval_policy=never`;永不弹审批。
- **续接不继承沙箱**:裸 `resume` 会掉回只读,所以每一轮都用 `-c sandbox_mode=` 重新给档。`thread_id` 在续接后不变。
- 不用 `--ephemeral`(它不保存会话,就续接不了)。非 git 目录也要带 `--skip-git-repo-check`,否则报 "Not inside a trusted directory"。
- `autocompactTokens`(见 [config.md](./config.md))对 codex 同样生效:会话超过阈值就让 codex 原地压缩。

## 权限:只有两档

| 群的 `permissionMode` | codex 沙箱 | 含义 |
|---|---|---|
| `dontAsk`(默认) | `read-only` | 只读,沙箱里也不能联网 |
| `bypassPermissions` | `danger-full-access` | 完全访问:无目录围栏,只给可信的私群 |

- 没有中间档:codex 的 `workspace-write` 依赖系统沙箱组件,Windows 上没有、设了也不生效。为了各平台行为一致,统一只给两档。
- Claude 那套逐工具白名单 / 黑名单、按群 MCP 门控、识图代理**都不作用于 codex 群**。codex 的 MCP 来自 `~/.codex/config.toml`,对所有 codex 群全局生效。
- 机器人的基础能力(发消息、定时任务、生图、预览)要联网,只读档的沙箱里用不了,要完全访问档。

## 事件映射(`--json`,每行一个 JSON)

| codex 事件 | SintBot 里 |
|---|---|
| `thread.started` | 记下 `thread_id`,下一轮续接用 |
| `item.*` · `agent_message` | 回复正文(可能分成几条) |
| `item.*` · `command_execution` | 显示成 Bash 工具调用与结果 |
| `item.*` · `file_change` | 显示成 Write / Delete |
| `item.*` · `web_search` / `mcp_tool_call` | WebSearch / MCP |
| `turn.completed` | 用量(含 `reasoning_output_tokens`)记进账本 |
| `turn.failed` / `error` | 原始 JSON 报错翻成人话再回群 |

**推理强度被套餐拒绝时自动降档**:`model/list` 报的是模型支持的全部档位,但运行时按订阅套餐收窄(低档套餐可能不收最高几档)。服务端返回 `reasoning.effort` 参数错误时,这一轮去掉推理强度、用模型默认值重跑一次,群里照常拿到回答,日志留一行。

## 登录态与额度(控制台 codex 卡、`/hud`、doctor)

- 登录态:`codex login status`。`sintbot doctor` 也查它:没登录时 codex 那一行和指向 codex 的备用模型行都标黄。
- 额度:临时起一个 `codex app-server`(换行分隔的 JSON-RPC,走 stdio):`initialize` → `initialized` → `account/rateLimits/read` → 退出。
- 返回里的窗口**按 `windowDurationMins` 认**(300 = 5 小时,10080 = 一周),不按 `primary` / `secondary` 的位置 —— 这两个位置放哪个窗口,服务端变过。显示的百分比是**已用**。

## Windows

- npm 装的 codex 实际是 `codex.cmd` 垫片;SintBot 与 `claude` 用同一套解析(`src/agent/winexec.js`),不会误选无扩展名的 sh 脚本。
- 在 PowerShell 里手测时,`2>&1 | Set-Content` 会把 codex 的 UTF-8 输出按系统代码页解码,中文乱码;SintBot 直接读子进程输出,不受影响。
