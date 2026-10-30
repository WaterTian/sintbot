const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const update = require('../../src/updater')

async function withDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sintbot-update-test-'))
  try { return await fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('updater: accepts only stable semver and compares numeric components', () => {
  assert.equal(update.stableVersion('v1.10.2'), '1.10.2')
  assert.equal(update.stableVersion('1.10.2-beta.1'), null)
  assert.equal(update.stableVersion('01.10.2'), null)
  assert.equal(update.stableVersion('latest'), null)
  assert.ok(update.compareVersion('1.10.0', '1.9.9') > 0)
  assert.ok(update.compareVersion('999999999999999999999.0.0', '2.0.0') > 0)
  assert.equal(update.compareVersion('1.0.0', 'v1.0.0'), 0)
})

test('updater: queue gate includes active work and queued messages', () => {
  assert.equal(update.hasPendingWork({ running: true, queue: 0, groups: { a: { busy: true } } }), true)
  assert.equal(update.hasPendingWork({ running: true, queue: 1, groups: {} }), true)
  assert.equal(update.hasPendingWork({ running: true, queue: 0, groups: { a: { busy: false, queue: 0 } } }), false)
  assert.equal(update.hasPendingWork({ running: false, queue: 0, groups: {} }), true)
  assert.equal(update.hasPendingWork(null), true)
  assert.equal(update.hasPendingWork({ running: true, queue: 0 }), true)
})

test('updater: unknown live state keeps the update queued', async () => withDir(async (dir) => {
  const manager = update.createUpdater({ currentVersion: '1.0.0', stateFile: path.join(dir, 'update.json'), checkIntervalMs: 60_000,
    waitMs: 10, fetchImpl: async () => ({ ok: true, async json() { return { version: '1.1.0' } } }),
    getLiveState: () => { throw new Error('engine unavailable') } })
  try {
    await manager.check()
    manager.startUpgrade({ version: '1.1.0' })
    await pause(25)
    assert.equal(manager.status().job.state, 'queued')
  } finally { manager.close() }
}))

test('updater: falls back to mirror and installs only the checked exact version after queues drain', async () => withDir(async (dir) => {
  const calls = []; const baselines = []; let busy = true; let installed = null
  const manager = update.createUpdater({
    currentVersion: '1.0.13', stateFile: path.join(dir, 'update.json'), checkIntervalMs: 60_000, waitMs: 10,
    fetchImpl: async (url) => {
      calls.push(url)
      if (url.includes('registry.npmjs.org')) throw new Error('unavailable')
      return { ok: true, async json() { return { version: '1.2.0' } } }
    },
    getLiveState: () => ({ running: true, queue: 0, groups: { chat: { busy, queue: 0 } } }),
    isGlobalInstall: async () => ({ ok: true, globalRoot: dir, globalPackage: path.join(dir, 'sintbot') }),
    installExact: async (name, version) => { installed = [name, version]; return { ok: true } },
    readInstalledVersion: async () => '1.2.0',
    getManagedService: async () => false,
    setAnnouncementBaseline: (v) => baselines.push(v),
  })
  try {
    let status = await manager.check()
    assert.equal(status.latestVersion, '1.2.0')
    assert.equal(status.source, 'mirror')
    assert.equal(calls.length, 2)
    manager.startUpgrade({ version: '1.2.0', announce: false })
    await pause(20)
    assert.equal(manager.status().job.state, 'queued')
    assert.equal(installed, null)
    busy = false
    await pause(40)
    status = manager.status()
    assert.equal(status.job.state, 'restart-needed')
    assert.deepEqual(installed, ['sintbot', '1.2.0'])
    assert.deepEqual(baselines, ['1.2.0'])
  } finally { manager.close() }
}))

test('updater: managed restart handoff is recovered by the new process and failure asks for manual restart', async () => withDir(async (dir) => {
  const file = path.join(dir, 'update.json')
  const make = (restartManagedService) => update.createUpdater({
    currentVersion: '1.0.0', stateFile: file, checkIntervalMs: 60_000,
    fetchImpl: async () => ({ ok: true, async json() { return { version: '1.1.0' } } }),
    getLiveState: () => ({ running: true, queue: 0, groups: {} }),
    isGlobalInstall: async () => ({ ok: true, globalRoot: dir, globalPackage: path.join(dir, 'sintbot') }),
    installExact: async () => ({ ok: true }),
    readInstalledVersion: async () => '1.1.0',
    getManagedService: async () => true,
    restartManagedService,
  })
  const manager = make(async () => ({ ok: true }))
  await manager.check()
  manager.startUpgrade({ version: '1.1.0' })
  await pause(20)
  assert.equal(manager.status().job.state, 'restarting')
  manager.close()
  const restarted = update.createUpdater({ currentVersion: '1.1.0', stateFile: file, checkIntervalMs: 60_000 })
  try { assert.equal(restarted.status().job.state, 'done') } finally { restarted.close() }

  const failedFile = path.join(dir, 'restart-failed.json')
  const failed = update.createUpdater({
    currentVersion: '1.0.0', stateFile: failedFile, checkIntervalMs: 60_000,
    fetchImpl: async () => ({ ok: true, async json() { return { version: '1.1.0' } } }),
    getLiveState: () => ({ running: true, queue: 0, groups: {} }),
    isGlobalInstall: async () => ({ ok: true, globalRoot: dir, globalPackage: path.join(dir, 'sintbot') }),
    installExact: async () => ({ ok: true }),
    readInstalledVersion: async () => '1.1.0',
    getManagedService: async () => true,
    restartManagedService: async () => ({ ok: false, err: 'service unavailable' }),
  })
  try {
    await failed.check()
    failed.startUpgrade({ version: '1.1.0' })
    await pause(20)
    assert.equal(failed.status().job.state, 'restart-needed')
  } finally { failed.close() }
}))

test('updater: startup checks run automatically and failures preserve the last successful result', async () => withDir(async (dir) => {
  const file = path.join(dir, 'update.json')
  fs.writeFileSync(file, JSON.stringify({ latestVersion: '1.1.0', checkedAt: 123, source: 'npm' }))
  let calls = 0
  const manager = update.createUpdater({ currentVersion: '1.0.0', stateFile: file,
    checkIntervalMs: 60_000, fetchImpl: async () => { calls++; throw new Error('offline') } })
  try {
    await manager.start()
    assert.equal(calls, 2, 'startup check tries the primary registry and mirror')
    assert.equal(manager.status().available, true)
    assert.equal('autoCheck' in manager.status(), false, 'automatic checking is not a user setting')
    const status = await manager.check()
    assert.equal(status.latestVersion, '1.1.0')
    assert.equal(status.checkedAt, 123)
    assert.equal(status.source, 'npm')
    assert.equal(calls, 4)
  } finally { manager.close() }
}))

test('updater: rejects a version other than the current checked stable latest', async () => withDir(async (dir) => {
  const manager = update.createUpdater({ currentVersion: '1.0.0', stateFile: path.join(dir, 'update.json'), checkIntervalMs: 60_000,
    fetchImpl: async () => ({ ok: true, async json() { return { version: '1.1.0' } } }) })
  try {
    await manager.check()
    assert.throws(() => manager.startUpgrade({ version: '1.2.0' }), /重新检查/)
  } finally { manager.close() }
}))
