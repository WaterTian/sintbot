# 模型

[English](../models.md) · 简体中文

每一轮,SintBot 都 spawn 一个官方命令行工具来干活。**用哪个模型 = 给它什么环境变量**:

- 跑 `claude` 时,设 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL`;
- 跑 GPT 时,改 spawn `codex`。

工具、权限、MCP、skills 这套框架始终是 Claude Code(或 Codex)自己的。

模型在 `providers` 里定义,按群选(`groups[].provider`,不写用 `defaultProvider`);群里发 `/model <名字>` 当场切。

## 三步接上 DeepSeek 等模型

没有 Claude 订阅、也没有 ChatGPT 账号时,**推荐 DeepSeek**。SintBot 照样跑 `claude` 命令行,只是让它连这些厂商的 Anthropic 兼容接口,认证用各家的 API key,**不用登录 Claude 账号**。

1. **拿 API key**:到下表的平台注册、充值、创建 key。智谱和 MiniMax 分中国大陆站与国际站,两边的 key 互不通用。
2. **填进 SintBot**,任选一种:
   - `sbot setup`:没检测到 Claude / Codex 登录时会直接推荐 DeepSeek,粘贴 key 后当场试跑一轮;要用别家选「用别家」。默认模型自动设成跑通的那家。
   - 控制台「模型 · 库 → 添加模型」选对应预设,填 key(国际站把端点改成下表那一列)。
   - 环境变量:`export DEEPSEEK_API_KEY=…`(示例配置里写的是 `env:DEEPSEEK_API_KEY`)。装成常驻服务时,服务拿不到 shell 里的变量,要 `sbot service install --pass-env`,见 [install.md](./install.md)。
3. **在群里切换**:发 `/model deepseek`,或在控制台给这个群选模型。

| provider 名 | 在哪拿 key | 端点 `baseUrl` | 国际站端点 | 默认模型 | key 变量 |
|---|---|---|---|---|---|
| `deepseek` | DeepSeek(platform.deepseek.com),按量 | `https://api.deepseek.com/anthropic` | (同一个) | `deepseek-v4-pro[1m]` | `DEEPSEEK_API_KEY` |
| `glm` | 智谱(open.bigmodel.cn / 国际站 z.ai),按量或包月 | `https://open.bigmodel.cn/api/anthropic` | `https://api.z.ai/api/anthropic` | `glm-5.2[1m]`(纯文本) | `ZHIPU_API_KEY` |
| `minimax` | MiniMax(platform.minimaxi.com / 国际站 platform.minimax.io),按量或包月 | `https://api.minimaxi.com/anthropic` | `https://api.minimax.io/anthropic` | `MiniMax-M3[1m]` | `MINIMAX_API_KEY` |
| `volcano` | 火山方舟(console.volcengine.com/ark),包月 | `https://ark.cn-beijing.volces.com/api/coding` | (没有) | `glm-5.2[1m]`(纯文本) | `ARK_API_KEY` |

- 模型名后的 `[1m]` 让 Claude Code 按 100 万 token 的上下文处理,发请求前会自动去掉。
- 标「纯文本」的不能看图:图片会换成占位文字,不会让整轮失败(见下文 `vision`)。
- 国际站端点已核实可访问,模型名按与中国大陆站相同配置,还没用国际站的 key 实测过。
- Kimi 等不在预设里的:控制台「添加模型 → 自定义」,填端点、key 和模型名;[示例配置](../../sbot.config.example.json)里有 Kimi 的模板(未验证)。
- 在中国大陆用中国大陆站的端点要直连、不要走代理,见 [install.md「代理」](./install.md#代理)。

### 没有 Claude 订阅 / ChatGPT 时能用什么

| 功能 | 情况 |
|---|---|
| 群里派活、改代码、跑命令、定时任务、设计验收、预览、控制台 | 都能用:执行框架是 Claude Code,不用登录 |
| 看图 | 看模型:标「纯文本」的看不了;DeepSeek 按官方兼容说明支持图片 |
| 联网搜索 | 看服务商是否支持 Claude Code 的搜索工具:DeepSeek 按官方兼容说明支持,其他家以各自文档为准 |
| GPT 群、生图 | 用不了:都要本机 Codex 的 ChatGPT 登录 |
| 额度用完自动切换 | 默认的备用是 codex,没登录就不切 |

## 三类 provider

### 1. Claude(本机登录)

```jsonc
"claude": { "toolQuality": "high", "fallback": "codex" }
```

不写 `baseUrl` / `apiKey` = 用本机 `claude` 的登录态(先在终端跑一次 `claude` 登录)。不写 `model` = 跟随 CLI 的默认模型;要钉某个型号,在控制台「模型」页选。守护进程环境里有 `ANTHROPIC_API_KEY` 时,CLI 会直接用它。

### 2. Anthropic 兼容端点(DeepSeek / MiniMax / 火山 / Kimi / GLM …)

```jsonc
"deepseek": {
  "baseUrl": "https://api.deepseek.com/anthropic",
  "apiKey": "env:DEEPSEEK_API_KEY",
  "model": "deepseek-v4-pro[1m]",
  "toolQuality": "medium",
  "env": { "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash" }
}
```

- 跑的仍是 `claude` 二进制,认证走各家的 API key,**不需要登录 Claude 账号**。
- `env` 叠加在 spawn 环境之上,放各家的调优项(快慢模型分工、关遥测等)。Kimi 等不在预设里的端点,在控制台「模型 · 库 → 添加模型 → 自定义」填端点、key 和模型名。[sbot.config.example.json](../../sbot.config.example.json) 里有几家已验证过的端点与调优参数,`sbot setup` 从那里起步。
- **纯文本模型**(不能看图)标 `"vision": false`:图片输入会经本地代理换成占位文字,避免整轮因 `400` 失败。不确定就别标。

### 3. GPT(经 Codex CLI)

```jsonc
"codex": { "runner": "codex", "reasoningEffort": "medium" }
```

`runner: "codex"` ⇒ spawn `codex exec`。认证是本机的 `codex login`(ChatGPT 订阅),配置里不放 key。**用 ChatGPT 订阅就选这个。** 示例配置里另有一个隐藏的 `gpt` 模板,是给有 OpenAI **平台 API key** 的人准备的(要另装本机翻译代理,见 [GPT-ROUTER.md](../GPT-ROUTER.md)),setup 不会问它。权限只有「只读 ⇄ 完全访问」两档。机制见 [CODEX-RUNNER.md](../CODEX-RUNNER.md)。

## 其他字段

| 字段 | 含义 |
|---|---|
| `toolQuality` | `high` / `medium`:提示这个模型做复杂改码任务靠不靠谱(控制台展示用) |
| `hidden` | `true` = 不出现在控制台与 `/model` 里,配置保留 |
| `fallback` | 额度用到 95% 或撞上限 / 账号不可用时,下一轮起自动切到这个 provider;窗口重置或探测恢复后切回。群里有人手动 `/model` 过就不再自动切 |
| `reasoningEffort` | codex 专用:推理强度 |

## 额度与告警

- Claude 订阅 5 小时窗口用到 90% 以上、Codex 7 天窗口用到 95% 以上,群里会提醒一次;`/hud` 随时看。
- 配了 `alerts.chatId`(一个**不绑项目**的群)的话,账号异常、额度用完、自动切换都会发到这个群。

## 订阅条款

用个人订阅(Claude Pro/Max、ChatGPT Plus/Pro)的登录态服务多人群聊,可能不符合提供方的条款。团队使用请选用允许这种用法的账号类型或 API 计费,并自行确认合规。
