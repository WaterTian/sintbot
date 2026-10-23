# Models

English · [简体中文](./zh-CN/models.md)

For every turn, SintBot spawns an official CLI to do the work, and **the model you get depends on the environment it is given**:

- for `claude`, SintBot sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_MODEL`;
- for GPT, it spawns `codex` instead.

The framework itself (tools, permissions, MCP, skills) is always Claude Code's or Codex's own.

Models are defined under `providers` and chosen per group (`groups[].provider`, falling back to `defaultProvider`). Send `/model <name>` in a group to switch on the spot.

## Use DeepSeek or another API-key model in three steps

With no Claude subscription and no ChatGPT account, we **recommend DeepSeek**. SintBot still runs the `claude` CLI but points it at the provider's Anthropic-compatible API. Authentication uses the provider's API key, and **no Claude login is needed**.

1. **Get an API key.** Sign up on the provider's platform in the table below, top up and create a key. Zhipu and MiniMax have separate mainland-China and international sites whose keys are not interchangeable.
2. **Give it to SintBot**, in any of these ways:
   - **`sintbot setup`.** When it finds no Claude or Codex login, it recommends DeepSeek and runs a trial turn as soon as you paste the key; choose "another provider" for the others. The default model is set to whichever one passed the trial.
   - **The console.** Go to Models → Add model, pick the preset and enter the key. For an international site, change the endpoint to the one in the table.
   - **An environment variable**, such as `export DEEPSEEK_API_KEY=…` (the example config reads `env:DEEPSEEK_API_KEY`). A service does not see your shell's variables, so use `sintbot service install --pass-env`; see [install.md](./install.md).
3. **Switch in the group.** Send `/model deepseek`, or pick the model for that group in the console.

| Provider | Where to get a key | Endpoint (`baseUrl`) | International endpoint | Default model | Key variable |
|---|---|---|---|---|---|
| `deepseek` | DeepSeek (platform.deepseek.com), pay as you go | `https://api.deepseek.com/anthropic` | (same) | `deepseek-v4-pro[1m]` | `DEEPSEEK_API_KEY` |
| `glm` | Zhipu (open.bigmodel.cn; international: z.ai), pay as you go or monthly | `https://open.bigmodel.cn/api/anthropic` | `https://api.z.ai/api/anthropic` | `glm-5.2[1m]` (text only) | `ZHIPU_API_KEY` |
| `minimax` | MiniMax (platform.minimaxi.com; international: platform.minimax.io), pay as you go or monthly | `https://api.minimaxi.com/anthropic` | `https://api.minimax.io/anthropic` | `MiniMax-M3[1m]` | `MINIMAX_API_KEY` |
| `volcano` | Volcano Ark (console.volcengine.com/ark), monthly | `https://ark.cn-beijing.volces.com/api/coding` | (none) | `glm-5.2[1m]` (text only) | `ARK_API_KEY` |

- The `[1m]` suffix tells Claude Code to treat the model as having a one-million-token context. It is stripped before the request is sent.
- Models marked "text only" cannot read images. Images are replaced with placeholder text, so the turn does not fail; see `vision` below.
- The international endpoints have been checked to be reachable. They are configured with the same model names as the mainland sites but have not yet been tested with an international key.
- For Kimi and other providers without a preset, go to Add model → Custom in the console and enter the endpoint, key and model name. The [example config](../sbot.config.example.json) has an unverified Kimi template.
- In mainland China, the mainland-site endpoints should connect directly rather than through a proxy; see [Proxies in install.md](./install.md#proxies-mainland-china).

### What works without a Claude subscription or ChatGPT

| Feature | Status |
|---|---|
| Handing out work in the group, code changes, shell commands, scheduled tasks, design checks, previews, the console | All work: the agent framework is Claude Code, which needs no login |
| Reading images | Depends on the model: "text only" models cannot. DeepSeek supports images according to its official compatibility notes |
| Web search | Depends on whether the provider supports Claude Code's search tool. DeepSeek does according to its official compatibility notes; for other providers, check their documentation |
| GPT groups, image generation | Not available: both need a ChatGPT login in Codex on this machine |
| Automatic fallback when a quota runs out | The default fallback is Codex; without a Codex login, there is no switch |

## The three kinds of provider

### 1. Claude (local login)

```jsonc
"claude": { "toolQuality": "high", "fallback": "codex" }
```

With no `baseUrl` or `apiKey`, the provider uses the local `claude` login (run `claude` once in a terminal to sign in). With no `model`, it follows the CLI's default model; to pin a model, pick it on the console's Models page. If the daemon's environment has `ANTHROPIC_API_KEY`, the CLI uses it directly.

### 2. Anthropic-compatible endpoints (DeepSeek, MiniMax, Volcano, Kimi, GLM …)

```jsonc
"deepseek": {
  "baseUrl": "https://api.deepseek.com/anthropic",
  "apiKey": "env:DEEPSEEK_API_KEY",
  "model": "deepseek-v4-pro[1m]",
  "toolQuality": "medium",
  "env": { "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash" }
}
```

- It still runs the `claude` binary, authenticating with the provider's API key; **no Claude login is needed**.
- `env` is layered on top of the spawn environment and carries each provider's tuning, such as the fast/slow model split or turning off telemetry. [sbot.config.example.json](../sbot.config.example.json) has endpoints and tuning for several verified providers, and `sintbot setup` starts from it.
- For an endpoint without a preset, such as Kimi, use Models → Add model → Custom in the console and enter the endpoint, key and model name.
- Mark **text-only models** (those that cannot read images) with `"vision": false`. Image input then goes through a local proxy that swaps it for placeholder text, so the turn does not fail with a `400`. If you are not sure, leave it unset.

### 3. GPT (via the Codex CLI)

```jsonc
"codex": { "runner": "codex", "reasoningEffort": "medium" }
```

`runner: "codex"` makes SintBot spawn `codex exec`. Authentication is the machine's `codex login` (a ChatGPT subscription), so no key goes in the config. **Choose this if you have a ChatGPT subscription.**

- Permissions have only two levels: read-only and full access.
- The example config also has a hidden `gpt` template for people with an OpenAI **platform API key**. It needs a local translation router (see [GPT-ROUTER.md](./GPT-ROUTER.md), in Chinese), and setup does not ask about it.
- How it works: [CODEX-RUNNER.md](./CODEX-RUNNER.md) (in Chinese).

## Other fields

| Field | Meaning |
|---|---|
| `toolQuality` | `high` / `medium`: a hint, shown in the console, of how reliable the model is for complex code changes |
| `hidden` | `true` hides the provider from the console and `/model`; the config is kept |
| `fallback` | When this provider's quota reaches 95%, hits its limit or the account becomes unusable, turns switch to the named provider from the next turn on. They switch back when the window resets or a probe succeeds. If someone in the group has switched with `/model`, there is no automatic switch |
| `reasoningEffort` | Codex only: reasoning effort |

## Quotas and alerts

- The group is warned once when a Claude subscription's 5-hour window passes 90%, or Codex's 7-day window passes 95%. `/hud` shows quota at any time.
- If `alerts.chatId` is set to a group **not bound to a project**, account problems, exhausted quotas and automatic switches are reported there.

## Subscription terms

Personal Claude Pro/Max or ChatGPT Plus/Pro subscriptions may not permit multi-user groups. Check the provider's terms before team use.
