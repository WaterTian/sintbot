// Runner dispatch — selects the AgentRunner by provider so the rest of sbot (engine,
// CLI, UI server) only ever calls one `runTurn` and stays backend-agnostic. A provider
// with `runner: "codex"` drives OpenAI Codex CLI (GPT; DESIGN §1); everything
// else drives Claude Code. The caller's `bin` is the Claude bin (cfg.agent.bin) — override
// it to the codex bin when routing there. probeVersion (the Claude-bin startup probe) is
// re-exported; codex has its own probe via codexcode.probeVersion (used by health.js).

const claudeAgent = require('./claudecode')
const codexAgent = require('./codexcode')

function runTurn(opts) {
  if (opts && opts.provider && opts.provider.runner === 'codex') {
    return codexAgent.runTurn({ ...opts, bin: (opts.provider && opts.provider.bin) || 'codex' })
  }
  return claudeAgent.runTurn(opts)
}

module.exports = { runTurn, probeVersion: claudeAgent.probeVersion }
