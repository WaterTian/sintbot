# Connecting GPT / OpenAI (translation router, with a platform API key)

English · [简体中文](./zh-CN/GPT-ROUTER.md)

> ⚠️ **This is the "platform API key" route** (CCR calls `api.openai.com` with an `sk-` key, billed per token).
> **If you only have a Codex / ChatGPT subscription (coding plan) and no platform API key, you don't need this document.** This project's GPT path is the **Codex CLI runner** (sbot spawns `codex exec` on your subscription, authorized by `codex login`, with no key in the config); see [CODEX-RUNNER.md](./CODEX-RUNNER.md). This document is for users who **have a platform key** (subscription-driven Codex is rate-limited, and use by several people raises questions under the subscription terms, so a pay-as-you-go platform key is more reliable).

> Work through it from top to bottom. Goal: switch one group's main model to **GPT-5.5** and complete one real task.
> Why GPT defaults to the Codex runner is explained in [DESIGN.md §1](../DESIGN.md#1-technology-choices); this document only covers **how to install, configure, verify and troubleshoot**.

## Why GPT needs an extra router

The other third parties (GLM / DeepSeek / MiniMax / Volcano Ark) all offer **Anthropic Messages-compatible** endpoints, which `claude` reaches directly through `ANTHROPIC_BASE_URL`. **OpenAI has no Anthropic endpoint**, so `claude` can't call it. GPT therefore goes through a **translation router**: `claude` → a local router (translating Anthropic Messages ↔ OpenAI Responses) → OpenAI.

```
claude ──Anthropic Messages──► local translation router (CCR/LiteLLM) ──OpenAI Responses──► api.openai.com
   ▲                                                                                          │
   └─────────────────────────  streamed response translated back to Anthropic format  ◄───────┘
```

On the sbot side there is **no special logic**: the `gpt` provider's `baseUrl` points at the local router, and the model is swapped through env like any other provider.

---

## 1. Prerequisites

| Requirement | Check | Notes |
|---|---|---|
| sbot already runs | the `claude` row in `sintbot doctor` is ✓ | First get the basics green with [install.md](./install.md) |
| Node ≥ 22 | `node -v` | SintBot itself needs it |
| An OpenAI **platform** API key | you have an `sk-...` | Issued by platform.openai.com and **billed per token**; it goes in the CCR config, not in sbot |

> **Don't confuse it with a Codex / ChatGPT subscription (coding plan).** CCR calls `api.openai.com` and accepts a **platform API key** (`sk-...`). **A Codex subscription is something else:** it is an OAuth login to the ChatGPT backend with usage included in the monthly fee, and it **can't be put in CCR's `api_key`**. To use the subscription you already pay for, take the **Codex CLI runner** route, which is this project's default for GPT (see [CODEX-RUNNER.md](./CODEX-RUNNER.md); `codex login` uses the subscription directly, with no extra API spending). The translation-router route in this document needs a separately funded platform key. Third-party proxies that "borrow" a subscription to call the API risk getting the account banned; not recommended.

---

## 2. Install and configure the translation router (claude-code-router / CCR as the example)

CCR is built around Claude Code and written in Node, so it is the first choice. Install:

```bash
npm i -g @musistudio/claude-code-router
```

The config is at **`~/.claude-code-router/config.json`** (Windows: `%USERPROFILE%\.claude-code-router\config.json`). (Note: newer CCR versions have moved the runtime config to SQLite and read `config.json` only once, for migration, when there is no SQLite config; the classic `ccr` CLI still uses it.) **The following is a representative shape; take the exact field names and paths from the README of the CCR version you installed** (CCR ships daily and its schema changes, especially the names of the Responses-related transformers):

```jsonc
{
  // (Optional) A gate token for the local router. Unset = callers aren't checked; the router binds only
  // 127.0.0.1 (this machine), so it is usually unnecessary. If set, sbot's gpt.apiKey must match it exactly.
  // Recommended default: leave it out (omit this line).
  // "APIKEY": "your-router-token",

  "Providers": [
    {
      "name": "openai-responses",
      // ★ Key point: use the Responses API, not chat/completions —
      //   only Responses keeps reasoning continuous across tool calls (essential for agentic GPT)
      "api_base_url": "https://api.openai.com/v1/responses",
      "api_key": "sk-your-real-OpenAI-key",           // ← the only real credential, and it lives only here
      "models": ["gpt-5.5"],
      "transformer": { "use": ["openai-responses"] }   // check the name against the CCR docs
    }
  ],

  "Router": {
    "default": "openai-responses,gpt-5.5"
  }
}
```

Start the service (verify by hand in the foreground first; make it start at boot once it works):

```bash
ccr start          # or: claude-code-router start
```

> **Use the port that `ccr start` actually prints.** The classic CLI usually uses `127.0.0.1:3456`; the newer desktop gateway defaults to `:8080`. sbot's `gpt.baseUrl` must match it. If it doesn't, the `router:gpt` row in `sintbot doctor` reports it as unreachable right away; it never fails silently.

> **Be sure to pick the Responses route.** chat/completions also produces text, but GPT then loses its reasoning after every tool call, and tools are disabled with `reasoning:none`, which weakens the multi-step tool loop sbot relies on. DESIGN.md §1 explains this.

> **LiteLLM works too** (more enterprise-grade, heavier, Python). If you already use LiteLLM to govern multiple models, give it an Anthropic `/v1/messages` entry point bridged to OpenAI Responses. The sbot side is configured exactly the same way (only `baseUrl` becomes LiteLLM's address).

---

## 3. Configure sbot's `gpt` provider

`sbot.config.example.json` already has a `gpt` template. Copy it into your real `sbot.config.json` and match the port and token:

```jsonc
"gpt": {
  "baseUrl": "http://127.0.0.1:3456",   // ← match CCR's actual port
  "apiKey": "sk-local-dummy",            // ← a dummy placeholder is fine; see below
  "model": "gpt-5.5",
  "toolQuality": "medium"                // complex code changes still route to Claude
}
```

> **There is only one real key, and it lives in CCR; sbot holds no real credential.** Without a token, `claude` falls back to your **logged-in (OAuth) credential**, which a custom endpoint rejects with an error. Putting a **dummy** in `gpt.apiKey` just **overrides** the login credential, and **any non-empty string works** (such as `sk-local-dummy`), because a loopback router has no gate by default and doesn't check it.
> **Only if** you deliberately configured `APIKEY` in CCR above do the two need to match. In that case, set `gpt.apiKey` to that string (or read it from the environment with `"env:CCR_API_KEY"` rather than hard-coding it in the config).

---

## 4. Verify (three steps, light to heavy)

**1) doctor: is the router up?** sbot probes the local router port (triggered automatically by a loopback baseUrl):

```bash
sintbot doctor
```

doctor prints in Chinese:

- `router:gpt  在线 127.0.0.1:3456` (online) → the router is up; carry on.
- `router:gpt  连不上 ...` (unreachable) → the router isn't running, or the port is wrong. **While this row is red, the gpt provider fails fast (failing quickly with a hint) and never hangs.** Get CCR running and the port matched first.

**2) A single turn directly**, without Feishu, for the fastest loop:

```bash
sintbot agent run --provider gpt "Introduce yourself in one sentence and say your model name"
```

A sensible one-line reply means the translation chain works. If it errors, see section 5.

**3) A group round trip:** switch a group to gpt. On the console's Groups · Projects page, choose `gpt` for the group (switching resets the session), post a message in the group and check that it replies normally. Or set `"provider": "gpt"` in the group's config directly.

---

## 5. Two known traps (read when you hit them)

### Trap A: `claude` rejects non-Claude model names

**Symptom:** agent run immediately reports an invalid / unknown model, without ever reaching the router.
**Cause:** in some cases `claude` blocks a non-Claude name in `ANTHROPIC_MODEL` (such as `gpt-5.5`).
**Fix:** put a **Claude-safe alias** (such as `claude-sonnet-4`) in sbot's `gpt.model`. `Router.default` above already routes **every** request to `gpt-5.5` (regardless of the model name passed in), so there is **no need** to map the alias to the real name; `claude` just has to let the alias through.
> GLM / DeepSeek names like `glm-5.2[1m]` are fine, so this trap may never trigger; **change it only if it does**.

### Trap B: image input fails the turn with a 400

**Symptom:** when someone posts an image in the group, the agent Reads a `.png`, or an MCP server returns an image, the turn fails with a 400.
**Cause:** gpt-5.5 itself can see images, but the router's Anthropic → OpenAI conversion of multimodal blocks may be unreliable.
**Fix:** add `"vision": false` to the `gpt` provider. sbot then uses its local strip proxy to replace image blocks with placeholder text **before** they reach the router (the same mechanism as for text-only models), so the turn doesn't fail; the cost is that GPT on this route can't see images.

```jsonc
"gpt": { "...": "...", "vision": false }
```

### Other troubleshooting

- **The router's log is the first place to look:** CCR's foreground window / log prints the translation of every request; tool-call, reasoning and streaming problems all show up there. sbot only sees "this turn failed"; the details are in the router.
- **Garbled Chinese text / connection problems:** see the Windows and proxy sections of [install.md](./install.md).
- **Don't put the router behind the system proxy:** the local `127.0.0.1` should be in `NO_PROXY` (sbot `setup` includes loopback automatically); otherwise requests take a detour through the HTTP proxy.

---

## 6. What this route is for (don't misread it)

- On this route, GPT is an **optional brain**: it appears among the per-group models like GLM does, and it is **not** the main model for code changes. For complex work or code changes, Claude is still recommended (that is what `toolQuality:medium` means).
- The translation layer loses some fidelity when reasoning, tools and streaming are combined. That is a **known cost**, not a bug. For the full GPT experience, use the Codex runner (see [CODEX-RUNNER.md](./CODEX-RUNNER.md)).
