// Mask characters echoed by a terminal readline prompt while a secret is being entered.
// Readline's _writeToOutput is the single output path for terminal echo; prompts and
// cursor-control sequences stay intact so paste, backspace and arrow-key editing work.

const CONTROL = /(\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\x08 \x08|[\x00-\x1f\x7f])/g
const CONTROL_TOKEN = /^(?:\x1b\[[0-?]*[ -/]*[@-~]|\x1b[()][A-Za-z0-9]|\x08 \x08|[\x00-\x1f\x7f])$/

function maskReadlineEcho(text) {
  return String(text).split(CONTROL).map((part) => {
    if (!part || CONTROL_TOKEN.test(part)) return part
    return '•'.repeat(Array.from(part).length)
  }).join('')
}

function createReadlineSecretMask(rl) {
  if (!rl || typeof rl._writeToOutput !== 'function') throw new TypeError('readline interface required')
  const original = rl._writeToOutput
  let activePrompt = null

  rl._writeToOutput = function (text) {
    if (activePrompt === null) return original.call(this, text)
    text = String(text)
    const promptAt = text.lastIndexOf(activePrompt)
    if (promptAt < 0) return original.call(this, maskReadlineEcho(text))
    const promptEnd = promptAt + activePrompt.length
    return original.call(this, text.slice(0, promptEnd) + maskReadlineEcho(text.slice(promptEnd)))
  }

  return {
    start(prompt) { activePrompt = String(prompt) },
    stop() { activePrompt = null },
    restore() { activePrompt = null; rl._writeToOutput = original },
  }
}

module.exports = { maskReadlineEcho, createReadlineSecretMask }
