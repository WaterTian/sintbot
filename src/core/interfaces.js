// The two contracts the engine talks to. Keeping these explicit (even as
// JSDoc) is what lets the core stay agnostic: it never references "feishu" or
// "claudecode" by name, only these shapes. Adding a platform or an agent =
// a new file that satisfies one of these — engine untouched.
//
// See DESIGN.md §2 (module boundaries) and §4 (subsystem detail).

/**
 * A normalized event emitted by an AgentRunner turn.
 * @typedef {Object} AgentEvent
 * @property {'system'|'assistant'|'tool_result'|'result'|string} type
 * @property {string} [subtype]      - e.g. 'init' for system, 'success' for result
 * @property {string} [text]         - assistant text or final result text
 * @property {string} [thinking]     - assistant reasoning, when present
 * @property {Array<{name:string,input:any}>} [tools]   - tool_use blocks on an assistant event
 * @property {Array<any>} [results]  - tool_result blocks on a user event
 * @property {boolean} [isError]
 * @property {string} [transient]    - 出错结果上的一句群面人话,只在失败是服务端瞬时状况(过载 / 限流 / 网关错)时有;
 *                                    由 runner 判(src/agent/transienterr.js,两个 runner 共用一份签名表),引擎只负责
 *                                    显示它并附「过一会儿发一句「继续」」的下一步。`text` 仍留服务端原话 —— 账本的失败
 *                                    原因靠它对号,人话不能顶掉它。没有这个字段 = 不是瞬时错
 * @property {{kind:'quota'|'account', window:'weekly'|'session'|null}} [quota]
 *                                  - 出错结果是额度用尽(quota)或账号 / 登录态不可用(account)时有;由 runner 判
 *                                    (src/agent/quotaerr.js,两个 runner 共用),引擎据此自动切到 providers[*].fallback
 *                                    指定的备用模型(v0.11.107)。`text` 同样留原话。没有这个字段 = 不是这两类
 * @property {string} [sessionId]    - agent-side session id (used for --resume)
 * @property {any} [usage]
 * @property {boolean} [usageCumulative] - result usage is SESSION-cumulative, not per-turn
 *                                    (codex reports totals); the engine baselines it into
 *                                    a per-turn delta via the store — never ledger it raw
 * @property {number} [contextTokens] - size of the LAST request's input side (fresh +
 *                                    cache read + cache write) ≈ current context size;
 *                                    runners report it when their stream exposes it
 * @property {number} [preTokens]    - 压缩事件(system · subtype 含 compact)上:压缩前的上下文量,runner 从 CLI 的
 *                                    压缩元数据取。引擎优先用它报「此前上下文约 X」—— contextTokens 是上一条
 *                                    assistant 的 usage,尚未回给模型的工具结果不在里面,真机少报过 5 倍
 * @property {number} [postTokens]   - 同上,压缩后的量;有就一并报
 * @property {any} [raw]             - unrecognized event passthrough
 */

/**
 * AgentRunner — drives an AI coding agent CLI. Two implementations, picked per
 * provider (the engine stays agnostic — it only ever calls `runner.runTurn`):
 *   src/agent/claudecode.js — Claude Code, model swapped via env (default backend).
 *   src/agent/codexcode.js  — OpenAI Codex CLI for GPT (provider.runner === 'codex';
 *                             DESIGN §1). Both spawn-per-turn over stream-json.
 *
 * @typedef {Object} RunTurnOptions
 * @property {string} prompt
 * @property {Object} provider                 - { baseUrl?, apiKey?, model?, env?, runner? } — runner:'codex' routes to codexcode (no baseUrl/apiKey; auth is the machine's `codex login`)
 * @property {string} [model]                  - per-turn override of provider.model
 * @property {string} [workdir]                - agent working directory (confinement)
 * @property {string} [sessionId]              - resume an existing agent session
 * @property {string} [permissionMode]
 * @property {number} [autocompactTokens]      - context ceiling: past it the CLI compacts in place (claude --autocompact / codex model_auto_compact_token_limit); 0/absent ⇒ CLI default (window-edge only)
 * @property {{mcp?: string[], skills?: string[]}} [plugins] - per-group plugin enablement; absent ⇒ runner default loading
 * @property {string} [appendSystemPrompt]     - appended to the agent's system prompt (NO_REPLY / sender-tag contract; keep ASCII-safe — travels as argv)
 * @property {Object} [extraEnv]                - non-provider env merged into the spawn (SBOT_*-namespaced, e.g. SBOT_CHAT_ID for the feishu base skill); both runners apply it
 * @property {(ev: AgentEvent) => void} [onEvent]
 *
 * @typedef {Object} RunTurnResult
 * @property {string|null} sessionId
 * @property {AgentEvent|null} result
 * @property {number} code
 *
 * interface AgentRunner {
 *   runTurn(opts: RunTurnOptions): Promise<RunTurnResult>
 * }
 */

/**
 * Platform — a messaging platform adapter. M2 implementation: src/platform/feishu.js.
 *
 * interface Platform {
 *   start(onMessage: (msg: InboundMessage) => void,
 *         hooks?: { onRecall?: (r: {chatId: string, msgId: string}) => void }): Promise<void>
 *     // hooks.onRecall: platform saw an inbound message get RECALLED — engine drops it from
 *     // the queue / aborts the running solo turn (撤回即停). Optional; stubs may ignore it.
 *   reply(replyCtx, content: string): Promise<void>
 *   send(chatId: string, content: string): Promise<string|null|void>
 *     // resolves null when the platform confirmed the message was NOT delivered (API rejected /
 *     // network down); anything else (message_id / undefined) = delivered or not tracked.
 *     // Callers that must not lose a message (cron say / script-failure notice) key their retry on null.
 *   createStreamingCard?(replyCtx): Promise<StreamingCard>   // optional
 *   stop(): Promise<void>
 *   sendCard?(chatId, card): Promise<any>        // 静态卡片(各平台自己的形状;bin 侧按平台用)
 *   connHealth?(): object                        // 连接健康快照(控制台用)
 *   // 平台自描述(可选;engine 据此改写自知清单,core 不认识任何平台名):
 *   skillCmd?: string          // 基础技能命令名,默认 'sbot feishu';清单末尾整体替换
 *   chatLabel?: string         // 「飞书群」/「企业微信群」这类称呼,清单开头与短语里用
 *   features?: {               // 某项 === false ⇒ 清单不教它(教了 agent 就会去调不存在的动作)
 *     history?, editRecall?, react?, download?, boards?, imagen?, cardPinned?, plainSend?: boolean,
 *     mediaMarker?: 'path'     // 入站图片 / 文件已由平台落盘,标记里给的是本机路径(默认是「先下载」的坐标)
 *   }
 * }
 *
 * interface StreamingCard {
 *   update(text: string): void        // 累积全量文本(打字机);引擎已把 `>> ` 里程碑行换成 ▶
 *   finish(text: string, opts?: { milestones?: string[] }): Promise<void>
 *     // 收尾正文(已剔掉里程碑行)+ 本轮里程碑整批;平台可收进默认收起的折叠区,不认的平台忽略 opts 即可
 *   recall?(): Promise<boolean>       // 撤回整张卡(ack 后转静默);不支持就没有这个方法
 * }
 *
 * @typedef {Object} InboundMessage
 * @property {string} chatId
 * @property {string} userId
 * @property {string} text
 * @property {string} msgId
 * @property {Array<{key:string,name?:string}>} [images]
 * @property {number} createTimeMs
 * @property {any} replyCtx           - opaque token the platform uses to reply
 */

module.exports = {} // types only; no runtime exports yet
