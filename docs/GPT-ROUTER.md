# 接入 GPT / OpenAI(翻译代理路线,用平台 API key)

> ⚠️ **这是「平台 API key」路线**(CCR 打 `api.openai.com`,`sk-` key、按 token 付费)。
> **只有 Codex / ChatGPT 订阅(coding plan)、没有平台 API key 的话,不用本文** —— 本项目的 GPT 走
> **Codex CLI runner**(sbot spawn `codex exec` 吃订阅,`codex login` 授权、配置不放 key),见
> [CODEX-RUNNER.md](./CODEX-RUNNER.md)。本文给**有平台 key** 的用户
> (订阅驱动的 Codex 有额度限制,多人使用还涉及订阅条款;按量付费的平台 key 更可靠)。

> 照着这份从上往下跑。目标:让某个群把主模型切成 **GPT-5.5** 并完成一轮真实任务。
> GPT 为什么默认走 codex 后端见 [DESIGN.md §1](../DESIGN.md#1-技术选型);这里只讲**怎么装、怎么配、怎么验、坑怎么排**。

## 为什么 GPT 要多一层代理

其它第三方(GLM / DeepSeek / MiniMax / 火山)都提供 **Anthropic Messages 兼容**端点,`claude` 靠
`ANTHROPIC_BASE_URL` 直连即可。**OpenAI 没有 Anthropic 端点**,`claude` 打不进去。所以 GPT 走
**翻译代理**:`claude` → 本机代理(Anthropic Messages ↔ OpenAI Responses 翻译)→ OpenAI。

```
claude ──Anthropic Messages──► 本机翻译代理(CCR/LiteLLM) ──OpenAI Responses──► api.openai.com
   ▲                                                                                    │
   └──────────────────────────  流式回包翻回 Anthropic 格式  ◄──────────────────────────┘
```

sbot 侧**零特殊逻辑**:`gpt` provider 的 `baseUrl` 指向本机代理,和别的 provider 一样按 env 换脑。

---

## 一、前置

| 要求 | 检查 | 说明 |
|---|---|---|
| sbot 已能跑 | `sbot doctor` 里 `claude` 那行 ✓ | 先照 [install.md](./install.md) 把基础跑绿 |
| Node ≥ 22 | `node -v` | SintBot 本身就要 |
| OpenAI **平台** API key | 有 `sk-...` | platform.openai.com 签发、**按 token 付费**;放 CCR 配置里,别放 sbot |

> **别把它和 Codex / ChatGPT 订阅(coding plan)搞混。** CCR 走 `api.openai.com`,认的是**平台 API key**
> (`sk-...`)。**Codex 订阅是另一回事** —— 它是 ChatGPT 后端的 OAuth 登录、用量含在月费里,**塞不进 CCR 的
> `api_key`**。想用你已在付的订阅,那是 **Codex CLI 后端**的路 —— 它就是本项目 GPT 的默认方式(见 [CODEX-RUNNER.md](./CODEX-RUNNER.md);`codex login` 直接吃订阅,
> 不另花 API 钱);本文的翻译代理路线需要单独充值一个平台 key。第三方代理「借」订阅打 API 有封号风险,不建议。

---

## 二、装并配翻译代理(以 claude-code-router / CCR 为例)

CCR 贴 Claude Code、Node 写的,首选。装:

```bash
npm i -g @musistudio/claude-code-router
```

配置在 **`~/.claude-code-router/config.json`**(Windows:`%USERPROFILE%\.claude-code-router\config.json`)(注:新版 CCR 已把运行配置迁到 SQLite,
`config.json` 仅在无 SQLite 配置时首次读取迁移;经典 `ccr` CLI 仍认它)。**下面是代表性形状,确切
字段名/路径以你装到的 CCR 版本 README 为准**(CCR 日更、schema 会变;尤其 Responses 相关的 transformer 名):

```jsonc
{
  // (可选)给本机代理加门禁口令。不填 = 不校验来访者;代理只绑 127.0.0.1(本机),
  // 通常无需。填了的话,sbot 的 gpt.apiKey 必须跟它一模一样。默认建议留空(不填这行)。
  // "APIKEY": "自定义-router-token",

  "Providers": [
    {
      "name": "openai-responses",
      // ★ 关键:走 Responses API,不是 chat/completions ——
      //   Responses 才保住跨工具调用的 reasoning 连续性(GPT agentic 的命根)
      "api_base_url": "https://api.openai.com/v1/responses",
      "api_key": "sk-你的真-OpenAI-key",              // ← 唯一的真凭据,只在这里
      "models": ["gpt-5.5"],
      "transformer": { "use": ["openai-responses"] }   // 名称以 CCR 文档为准
    }
  ],

  "Router": {
    "default": "openai-responses,gpt-5.5"
  }
}
```

起服务(前台先手动验,通了再做成开机自启):

```bash
ccr start          # 或 claude-code-router start
```

> **端口以 `ccr start` 实际打印的为准** —— 经典 CLI 多是 `127.0.0.1:3456`,新版桌面网关默认 `:8080`。
> sbot 的 `gpt.baseUrl` 要对上它;对不上 `sbot doctor` 的 `router:gpt` 行会直接报「连不上」,不会静默错。

> **务必选 Responses 路由**。走 chat/completions 也能出字,但 GPT 每次工具调用后会丢 reasoning、
> 且 `reasoning:none` 时禁用工具 → sbot 依赖的多步工具循环会变弱。DESIGN §1 有说明。

> **LiteLLM 也可以**(更企业级、更重,Python)。若你已在用 LiteLLM 做多模型治理,给它配一个
> Anthropic `/v1/messages` 入口桥到 OpenAI Responses 即可,sbot 侧配法完全一样(只是 `baseUrl` 换成
> LiteLLM 的地址)。

---

## 三、配 sbot 的 `gpt` provider

`sbot.config.example.json` 已带 `gpt` 模板。复制到你的真实 `sbot.config.json`,对齐端口与 token:

```jsonc
"gpt": {
  "baseUrl": "http://127.0.0.1:3456",   // ← 对上 CCR 实际端口
  "apiKey": "sk-local-dummy",            // ← dummy 占位即可,见下
  "model": "gpt-5.5",
  "toolQuality": "medium"                // 复杂改码仍路由 Claude
}
```

> **就一个真 key,在 CCR 里 —— sbot 这边不放真凭据。** 不填 token 时 `claude` 会退回用你的**登录态
> (OAuth)凭据**,自定义端点不认、直接报错;`gpt.apiKey` 填个 **dummy** 就是把登录态**覆盖**掉,
> **任意非空串即可**(如 `sk-local-dummy`),loopback 代理默认不设门禁、不校验它。
> **仅当**你上面主动给 CCR 配了 `APIKEY` 时,这俩才需一致 —— 那时把 `gpt.apiKey` 换成那串
> (或用 `"env:CCR_API_KEY"` 从环境变量取,别写死进配置)。

---

## 四、验证(三步,从轻到重)

**1) doctor 看代理起没起** —— sbot 会探本机代理端口(loopback baseUrl 自动触发):

```bash
sbot doctor
```

- `router:gpt  在线 127.0.0.1:3456` → 代理在线,继续。
- `router:gpt  连不上 ...` → 代理没起 / 端口不对。**这行是红的时,gpt 这个 provider 会 fail-fast(快速失败给提示),
  不会挂起**——先把 CCR 起好、端口对上。

**2) 单轮直跑** —— 不经飞书,最快闭环:

```bash
sbot agent run --provider gpt "用一句话自我介绍,并说出你的模型名"
```

出一句合理回复 = 翻译链路通。若报错,看第五节。

**3) 群回环** —— 把某个群切到 gpt:控制台「群·项目」页给该群选 `gpt`(切即重置会话),
在群里发一条,看是否正常回。或直接改群配置 `"provider": "gpt"`。

---

## 五、两个已知坑(遇到再看)

### 坑 A:`claude` 拒绝非 Claude 模型名

**症状:** agent run 立刻报模型无效 / unknown model,根本没打到代理。
**原因:** 个别情况下 `claude` 会对 `ANTHROPIC_MODEL` 里的非 Claude 名(如 `gpt-5.5`)拦一道。
**解法:** 在 sbot 的 `gpt.model` 填一个 **Claude-safe 别名**(如 `claude-sonnet-4`)。上面 `Router.default`
已把**所有**请求固定路由到 `gpt-5.5`(与传入的模型名无关),所以**不用**再配别名→真名的映射 —— 只要让
`claude` 肯放行这个别名即可。
> GLM/DeepSeek 用 `glm-5.2[1m]` 这类名没事,所以这坑不一定触发;**触发了再改**。

### 坑 B:图片输入 400 崩轮

**症状:** 群里发图 / agent Read 了 `.png` / MCP 返回图片时,这一轮 400 失败。
**原因:** gpt-5.5 本身能看图,但翻译代理对多模态块的 Anthropic→OpenAI 转换可能不稳。
**解法:** 给 `gpt` provider 加 `"vision": false`。sbot 会在图片进代理**之前**用本地 strip-proxy 把图片块
换成占位文本(和文本模型一个机制),避免崩轮;代价是 GPT 这条链看不到图。

```jsonc
"gpt": { "...": "...", "vision": false }
```

### 其它排查

- **代理日志是第一现场:** CCR 前台窗口 / 日志会打印每次请求的翻译结果,tool-call、reasoning、流式出问题
  都在这里看。sbot 侧只看到「这一轮失败」,细节在代理。
- **中文乱码 / 连接问题:** 参考 [install.md](./install.md) 的 Windows 与代理两节。
- **别把代理挂到系统代理后面:** 本机 `127.0.0.1` 应在 `NO_PROXY` 里(sbot `setup` 自动含 loopback),
  否则请求会被 HTTP 代理再绕一圈。

---

## 六、这条路线的定位(别误解)

- 这条路线的 GPT 是**可选大脑**:让它像 GLM 一样出现在按群模型里,**不是**主力改码模型。
  复杂 / 改码任务仍建议用 Claude(`toolQuality:medium` 就是这个意思)。
- 翻译层对「推理 + 工具 + 流式」三者叠加有保真度损耗,是**已知代价**,不是 bug。要完整的 GPT 体验,用
  Codex 后端(见 [CODEX-RUNNER.md](./CODEX-RUNNER.md))。
