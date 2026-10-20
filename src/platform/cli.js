// CLI platform — a stub that satisfies the Platform contract (interfaces.js)
// so the engine can be driven from the terminal with no Feishu/credentials.
// Each stdin line becomes one InboundMessage; replies print to stdout.
//
// Lets us validate the whole engine loop (routing, per-group session/lock/queue,
// dedup/watermark, slash commands, resume) before the real WS adapter exists.

const readline = require('node:readline')

function createCliPlatform({ chatId = 'cli', userId = 'local', senderName = 'you', prompt = 'sbot> ' } = {}) {
  let seq = 0
  let rl = null
  let onMessage = null

  return {
    async start(cb) {
      onMessage = cb
      rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt })
      rl.prompt()
      rl.on('line', async (line) => {
        const text = line.trim()
        if (!text) return rl.prompt()
        if (text === '/exit' || text === '/quit') return rl.close()
        const msg = {
          chatId,
          userId,
          senderName,
          text,
          msgId: `cli-${++seq}`,
          createTimeMs: Date.now(),
          replyCtx: { chatId },
        }
        try { await onMessage(msg) } catch (e) { process.stderr.write('err: ' + (e && e.message) + '\n') }
        rl.prompt()
      })
      rl.on('close', () => process.exit(0))
    },

    async reply(_ctx, content) { process.stdout.write('\n' + content + '\n') },
    async send(_chatId, content) { process.stdout.write('\n' + content + '\n') },
    async stop() { if (rl) rl.close() },
  }
}

module.exports = { createCliPlatform }
