// StateStore — crash-safe per-group JSON state (session / provider / watermark).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { StateStore, atomicWriteJSON } = require('../../src/core/store')

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-store-'))
  return { dir, file: path.join(dir, 'state.json') }
}

test('store: session get / set / clear is per-group', () => {
  const { file } = tmp()
  const s = new StateStore(file)
  assert.equal(s.getSession('g1'), null)
  s.setSession('g1', 'sess-1')
  assert.equal(s.getSession('g1'), 'sess-1')
  assert.equal(s.getSession('g2'), null) // isolated
  s.clearSession('g1')
  assert.equal(s.getSession('g1'), null)
})

test('store: provider get / set', () => {
  const { file } = tmp()
  const s = new StateStore(file)
  assert.equal(s.getProvider('g1'), null)
  s.setProvider('g1', 'glm')
  assert.equal(s.getProvider('g1'), 'glm')
})

test('store: sessionStats put / get / clear,重载后仍在(v0.11.17 会话规模账)', () => {
  const { file } = tmp()
  const s = new StateStore(file)
  assert.equal(s.getSessionStats('G'), null)
  s.putSessionStats('G', { sessionId: 'sid', turns: 3, in: 1200, out: 40, ctx: 900 })
  assert.deepEqual(new StateStore(file).getSessionStats('G'), { sessionId: 'sid', turns: 3, in: 1200, out: 40, ctx: 900 })
  s.clearSessionStats('G')
  assert.equal(s.getSessionStats('G'), null)
  assert.equal(new StateStore(file).getSessionStats('G'), null)
})

test('store: watermark only moves forward', () => {
  const { file } = tmp()
  const s = new StateStore(file)
  assert.equal(s.getWatermark('g1'), 0)
  s.setWatermark('g1', 100)
  assert.equal(s.getWatermark('g1'), 100)
  s.setWatermark('g1', 50) // older → ignored
  assert.equal(s.getWatermark('g1'), 100)
  s.setWatermark('g1', 200)
  assert.equal(s.getWatermark('g1'), 200)
})

test('store: state survives a reload (persisted to disk)', () => {
  const { file } = tmp()
  const s1 = new StateStore(file)
  s1.setSession('g1', 'sess-x')
  s1.setProvider('g1', 'deepseek')
  s1.setWatermark('g1', 123) // debounced — flush forces it out (shutdown path)
  s1.flush()
  const s2 = new StateStore(file) // fresh load
  assert.equal(s2.getSession('g1'), 'sess-x')
  assert.equal(s2.getProvider('g1'), 'deepseek')
  assert.equal(s2.getWatermark('g1'), 123)
})

test('store: watermark writes are debounced but land on disk after the window (P2)', async () => {
  const { file } = tmp()
  const s1 = new StateStore(file)
  s1.setWatermark('g1', 777)
  assert.equal(s1.getWatermark('g1'), 777) // in-memory immediately
  await new Promise((r) => setTimeout(r, 700)) // > 500ms debounce
  assert.equal(new StateStore(file).getWatermark('g1'), 777) // persisted without flush()
})

test('store: recovers from a corrupt file instead of throwing', () => {
  const { file } = tmp()
  fs.writeFileSync(file, '{not valid json')
  const s = new StateStore(file)
  assert.deepEqual(s.data, { groups: {} })
  s.setSession('g1', 'ok')
  assert.equal(s.getSession('g1'), 'ok')
})

test('atomicWriteJSON: writes valid JSON and leaves no .tmp files behind', () => {
  const { dir, file } = tmp()
  atomicWriteJSON(file, { a: 1, b: [2, 3] })
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1, b: [2, 3] })
  const leftovers = fs.readdirSync(dir).filter((f) => f.startsWith('.tmp-'))
  assert.equal(leftovers.length, 0)
})

test('atomicWriteJSON: 保留原文件权限位(0600 的配置不该被写回 0644)', () => {
  const { dir, file } = tmp()
  fs.writeFileSync(file, '{}')
  fs.chmodSync(file, 0o600) // operator 手动收紧过(里面有 appSecret)
  atomicWriteJSON(file, { appSecret: 's3cr3t' })
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, '覆盖写不该放宽权限')
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { appSecret: 's3cr3t' })
  // 对照组:此前不存在的新文件行为不变 —— 仍照 umask 走(与同目录普通写出的文件同权限)
  const fresh = path.join(dir, 'fresh.json')
  const ref = path.join(dir, 'ref.json')
  fs.writeFileSync(ref, '{}') // 同一 umask 下的基准
  atomicWriteJSON(fresh, { a: 1 })
  assert.deepEqual(JSON.parse(fs.readFileSync(fresh, 'utf8')), { a: 1 })
  assert.equal(fs.statSync(fresh).mode & 0o777, fs.statSync(ref).mode & 0o777, '新文件不受影响')
})

test('atomicWriteJSON: opts.mode 只管新建文件(setup 新建配置直接 0600,不留默认权限的空窗)', { skip: process.platform === 'win32' }, () => {
  const { dir } = tmp()
  const fresh = path.join(dir, 'new.json')
  atomicWriteJSON(fresh, { appSecret: 's' }, { mode: 0o600 })
  assert.equal(fs.statSync(fresh).mode & 0o777, 0o600, '新文件按 opts.mode 落盘')
  // 对照组:已有文件沿用它自己的权限,opts.mode 不去改它(放宽或收紧都是 operator 的事)
  const old = path.join(dir, 'old.json')
  fs.writeFileSync(old, '{}'); fs.chmodSync(old, 0o640)
  atomicWriteJSON(old, { a: 1 }, { mode: 0o600 })
  assert.equal(fs.statSync(old).mode & 0o777, 0o640, '已有文件不受 opts.mode 影响')
})

test('store: lastVersion 顶层记录(升级播报基线)— 落盘且重载存活', () => {
  const { file } = tmp()
  const s = new StateStore(file)
  assert.equal(s.getLastVersion(), null)
  s.setLastVersion('0.3.6')
  assert.equal(s.getLastVersion(), '0.3.6')
  const s2 = new StateStore(file) // 重载
  assert.equal(s2.getLastVersion(), '0.3.6')
  assert.equal(s2.getSession('g1'), null) // 不污染群状态
})

// ── 额度告警去重(v0.11.8):窗口身份 = resetsAt,按 provider 存,落盘跨重启 ──

test('store: 额度告警同窗口只播一次,窗口滚动后放行', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-quota-'))
  const file = path.join(dir, 'state.json')
  const s = new StateStore(file)
  const R1 = Date.now() + 3600e3
  assert.equal(s.wasQuotaAlerted('claude', 'claude-session', R1), false)
  s.markQuotaAlerted('claude', 'claude-session', R1)
  assert.equal(s.wasQuotaAlerted('claude', 'claude-session', R1), true, '同一窗口不该重播')
  // 窗口滚动(resetsAt 变)⇒ 放行
  assert.equal(s.wasQuotaAlerted('claude', 'claude-session', R1 + 5 * 3600e3), false)
  // 不同 provider / 不同档互不影响
  assert.equal(s.wasQuotaAlerted('codex', 'codex-weekly', R1), false)
  assert.equal(s.wasQuotaAlerted('claude', 'codex-weekly', R1), false)
  // ⚠ 落盘:发版频繁,内存态每次重启都会重播 —— 换个实例读同一文件必须仍是「已播」
  const s2 = new StateStore(file)
  assert.equal(s2.wasQuotaAlerted('claude', 'claude-session', R1), true, '重启后仍不该重播')
})

test('store: 额度告警记录会清掉过期窗口(state 不无限长胖)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-quota2-'))
  const s = new StateStore(path.join(dir, 'state.json'))
  const now = Date.now()
  s.markQuotaAlerted('old', 'claude-session', now - 10 * 3600e3, now) // 早已过期的窗口
  s.markQuotaAlerted('cur', 'claude-session', now + 3600e3, now)      // 这次写入顺带清扫
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'))
  assert.equal(raw.quotaAlerts['old:claude-session'], undefined, '过期条目该被清掉')
  assert.ok(raw.quotaAlerts['cur:claude-session'])
})

test('store: resetsAt 为 null(拿不到重置时刻)也能去重', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-quota3-'))
  const s = new StateStore(path.join(dir, 'state.json'))
  assert.equal(s.wasQuotaAlerted('codex', 'codex-weekly', null), false)
  s.markQuotaAlerted('codex', 'codex-weekly', null)
  assert.equal(s.wasQuotaAlerted('codex', 'codex-weekly', null), true)
})

test('store: 「被掐断」标记随会话走 —— 清会话即清标记(v0.11.103)', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-store-')), 'state.json')
  const s = new StateStore(file)
  s.setSession('G', 's1')
  assert.equal(s.isTainted('G'), false)
  s.markTainted('G')
  assert.equal(s.isTainted('G'), true)
  assert.equal(new StateStore(file).isTainted('G'), true, '要落盘:关停也是一种掐断,重启后续做走的是同一段会话')
  s.clearTainted('G'); assert.equal(s.isTainted('G'), false)
  s.markTainted('G'); s.clearSession('G')
  assert.equal(s.isTainted('G'), false, '会话没了,标记跟着没')
  assert.equal(new StateStore(file).isTainted('G'), false)
})


// ===== 额度自动切换(v0.11.107):临时切换记录 + provider 不可用表 =====
test('store: failover 记录与运行时覆盖一起写、一起清;人切模型(setProvider / clearProvider)连带作废记录', () => {
  const { file } = tmp()
  const s = new StateStore(file)
  assert.equal(s.getFailover('G'), null)
  s.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: 123, at: 1 })
  assert.equal(s.getProvider('G'), 'codex', '切换 = 运行时覆盖到备用')
  assert.deepEqual(new StateStore(file).getFailover('G'), { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: 123, at: 1 }, '重载后记录仍在')
  s.touchFailover('G', { checkedAt: 9 })
  assert.equal(s.getFailover('G').checkedAt, 9)
  s.clearFailover('G')
  assert.equal(s.getFailover('G'), null)
  assert.equal(s.getProvider('G'), null, '切回 = 跟随配置(覆盖一并清)')
  s.clearFailover('G') // 幂等
  // 人切模型 ⇒ 记录作废
  s.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: null, at: 1 })
  s.setProvider('G', 'glm')
  assert.equal(s.getFailover('G'), null); assert.equal(s.getProvider('G'), 'glm')
  s.setFailover('G', { home: 'claude', from: 'claude', to: 'codex', kind: 'quota', until: null, at: 1 })
  s.clearProvider('G')
  assert.equal(s.getFailover('G'), null); assert.equal(s.getProvider('G'), null)
  // 别的群不受影响
  assert.equal(s.getFailover('H'), null)
})

test('store: exhausted 按 provider 存;until 过了自动失效;null 常驻直到清;写入时顺带清过期项', async () => {
  const { file } = tmp()
  const s = new StateStore(file)
  const now = 1_000_000
  assert.equal(s.isExhausted('claude', now), false)
  s.markExhausted('claude', { until: now + 1000, kind: 'quota' }, now)
  assert.equal(s.isExhausted('claude', now), true)
  assert.equal(s.isExhausted('claude', now + 1000), false, '到点即失效')
  assert.equal(new StateStore(file).isExhausted('claude', now), true, '落盘')
  s.markExhausted('codex', { until: null, kind: 'account' }, now)
  assert.equal(s.isExhausted('codex', now + 10 * 864e5), true, 'null = 常驻')
  s.clearExhausted('codex')
  assert.equal(s.clearExhausted('codex'), false, '已清过 ⇒ false')
  // 已过期的标:getExhausted 查不到,但 clear 仍报「之前有」(运维告警「已恢复」的判据)。⚠ markExhausted 写入时会顺带清掉
  // 已过期项(含刚写的这条),所以要先写一个将来的 until、等它过期,不能直接写过去的时刻
  s.markExhausted('glm', { until: Date.now() + 30 })
  await new Promise((r) => setTimeout(r, 45))
  assert.equal(s.getExhausted('glm'), null)
  assert.equal(s.clearExhausted('glm'), true)
  assert.equal(s.isExhausted('codex', now), false)
  // 写入时清过期项(防 state 长胖)
  s.markExhausted('glm', { until: now + 5000 }, now + 2000)
  assert.equal(s.data.exhausted.claude, undefined, 'claude 那条(until=now+1000)在 now+2000 写入时被清掉')
  assert.ok(s.data.exhausted.glm)
})
