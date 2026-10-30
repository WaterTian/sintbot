const test = require('node:test')
const assert = require('node:assert/strict')
const { maskReadlineEcho, createReadlineSecretMask } = require('../../src/cli-secret')

test('maskReadlineEcho masks printable input and preserves terminal control sequences', () => {
  assert.equal(maskReadlineEcho('sk-secret-123'), '•••••••••••••')
  assert.equal(maskReadlineEcho('\x1b[2D\x08 \x08'), '\x1b[2D\x08 \x08')
})

test('secret mask preserves the prompt, masks typed text, then restores ordinary echo', () => {
  const output = []
  const rl = { _writeToOutput(text) { output.push(String(text)) } }
  const mask = createReadlineSecretMask(rl)

  rl._writeToOutput('? API key: ')
  mask.start('? API key: ')
  rl._writeToOutput('? API key: sk-secret-123')
  rl._writeToOutput('\x08 \x08')
  mask.stop()
  rl._writeToOutput('ordinary input')
  mask.restore()

  assert.deepEqual(output, [
    '? API key: ',
    '? API key: •••••••••••••',
    '\x08 \x08',
    'ordinary input',
  ])
})
