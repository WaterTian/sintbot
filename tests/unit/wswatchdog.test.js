// wswatchdog — the WS liveness state machine (feishu.js L3). Pure + timing-injected,
// so the SDK-give-up → force-rebuild decisions are testable without a live Feishu link.

const { test } = require('node:test')
const assert = require('node:assert')
const { createWatchdog } = require('../../src/platform/wswatchdog')

// Test harness: a controllable clock + spies for rebuild() and onConn().
function harness(opts = {}) {
  let t = 10_000
  const rebuilds = []
  const conns = []
  const wd = createWatchdog({
    now: () => t,
    rebuild: () => { rebuilds.push(t) },
    onConn: (snap) => conns.push(snap),
    ...opts,
  })
  return { wd, rebuilds, conns, adv: (ms) => { t += ms }, at: () => t }
}

test('starts in connecting', () => {
  const { wd } = harness()
  assert.equal(wd.snapshot().state, 'connecting')
})

test('onReady → connected, records lastReadyAt, emits', () => {
  const { wd, conns, at } = harness()
  wd.onReady()
  const s = wd.snapshot()
  assert.equal(s.state, 'connected')
  assert.equal(s.lastReadyAt, at())
  assert.equal(conns.at(-1).state, 'connected')
})

test('onReconnecting counts; onReconnected returns to connected', () => {
  const { wd } = harness()
  wd.onReady()
  wd.onReconnecting()
  assert.equal(wd.snapshot().state, 'reconnecting')
  assert.equal(wd.snapshot().reconnects, 1)
  wd.onReconnected()
  assert.equal(wd.snapshot().state, 'connected')
})

test('onEvent bumps lastEventAt only (no state change)', () => {
  const { wd, adv, at } = harness()
  wd.onReady()
  adv(5000)
  wd.onEvent()
  assert.equal(wd.snapshot().lastEventAt, at())
  assert.equal(wd.snapshot().state, 'connected')
})

test('first onError force-rebuilds immediately (delay 0)', () => {
  const { wd, rebuilds } = harness()
  wd.onReady()
  wd.onError(new Error('reconnect exhausted'))
  assert.equal(rebuilds.length, 1)
  const s = wd.snapshot()
  assert.equal(s.rebuilds, 1)
  assert.equal(s.state, 'connecting') // a fresh client is coming up
  assert.equal(s.lastError, 'reconnect exhausted')
})

test('backoff throttles repeated failures; tick after the window rebuilds', () => {
  const { wd, rebuilds, adv } = harness({ backoffBaseMs: 2000 })
  wd.onReady()
  wd.onError(new Error('e1')) // immediate rebuild #1; next window = +2000
  assert.equal(rebuilds.length, 1)

  wd.onError(new Error('e2')) // still within backoff → no rebuild
  assert.equal(rebuilds.length, 1)
  wd.tick()                    // still within backoff
  assert.equal(rebuilds.length, 1)

  adv(2000)
  wd.tick()                    // window elapsed → rebuild #2
  assert.equal(rebuilds.length, 2)
  assert.equal(wd.snapshot().rebuilds, 2)
})

test('backoff grows exponentially and is capped', () => {
  // Each rebuild leaves state 'connecting' (fresh client coming up); in reality that
  // client reports failure via onError, which puts us back to 'failed' so the next
  // rebuild is backoff-gated. staleReconnectingMs is huge so only the backoff (not the
  // wedged path) drives the timing here.
  const { wd, rebuilds, adv } = harness({ backoffBaseMs: 2000, backoffCapMs: 8000, staleReconnectingMs: 10_000_000 })
  wd.onReady()
  wd.onError(new Error('x')) // #1 immediate; next window = base 2000
  assert.equal(rebuilds.length, 1)
  wd.onError(new Error('x')); adv(2000); wd.tick() // window elapsed → #2; next window = 4000
  assert.equal(rebuilds.length, 2)
  wd.onError(new Error('x')); adv(2000); wd.tick() // only 2000 of 4000 → no rebuild
  assert.equal(rebuilds.length, 2)
  adv(2000); wd.tick()                              // 4000 total → #3; next window = 8000 (cap)
  assert.equal(rebuilds.length, 3)
  wd.onError(new Error('x')); adv(8000); wd.tick()  // #4
  assert.equal(rebuilds.length, 4)
  wd.onError(new Error('x')); adv(8000); wd.tick()  // cap holds (not 16000) → #5
  assert.equal(rebuilds.length, 5)
})

test('onReady/onReconnected reset the backoff', () => {
  const { wd, rebuilds } = harness()
  wd.onReady()
  wd.onError(new Error('e')) // rebuild #1, consecFail now 1
  assert.equal(rebuilds.length, 1)
  wd.onReady()               // recovered → reset
  wd.onError(new Error('e')) // should be immediate again (delay 0)
  assert.equal(rebuilds.length, 2)
})

test('wedged: stuck reconnecting past the grace triggers a rebuild', () => {
  const { wd, rebuilds, adv } = harness({ staleReconnectingMs: 5000 })
  wd.onReady()
  wd.onReconnecting() // SDK retrying on its own — no onError
  wd.tick()
  assert.equal(rebuilds.length, 0) // within grace
  adv(5001)
  wd.tick()
  assert.equal(rebuilds.length, 1) // wedged → rebuild
})

test('a healthy connected state never rebuilds on tick', () => {
  const { wd, rebuilds, adv } = harness({ staleReconnectingMs: 1000 })
  wd.onReady()
  for (let i = 0; i < 5; i++) { adv(10_000); wd.tick() }
  assert.equal(rebuilds.length, 0)
})

test('stop() makes it inert — no rebuild, late callbacks ignored', () => {
  const { wd, rebuilds } = harness()
  wd.onReady()
  wd.stop()
  assert.equal(wd.snapshot().state, 'stopped')
  wd.onError(new Error('late')) // must not rebuild or leave 'failed'
  wd.tick()
  assert.equal(rebuilds.length, 0)
  assert.equal(wd.snapshot().state, 'stopped')
})

test('snapshot is a copy (callers cannot mutate internal state)', () => {
  const { wd } = harness()
  const s = wd.snapshot()
  s.state = 'hacked'
  assert.equal(wd.snapshot().state, 'connecting')
})
