// 遗留进程(src/leftover.js):解析 / 判据 / 摘要是纯函数,ps 与 kill 注入。
// 判据三条各有一个「差一点就不算」的反例 —— 这一层最怕的是漏报(漏报看起来和「没有」一模一样)。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const L = require('../../src/leftover')

// 真机形态(2026-10-09 在生产机上翻出的那条):Claude Code 的 Bash 工具起 shell 的前导 + eval '<命令>'
const SNAP = '/Users/me/.claude/shell-snapshots/snapshot-zsh-1788488045084-mdeh7h.sh'
const WRAP = (cmd) => `/bin/zsh -c source ${SNAP} 2>/dev/null || true && setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL 2>/dev/null || true && { \\builtin unalias -a 2>/dev/null || true } && eval '${cmd}' < /dev/null && pwd -P >| /tmp/claude-f9ed-cwd`
const LOOP = `until node -e "const s=require('"'"'fs'"'"')"; do sleep 5; done`

test('leftover: parseEtime 认 ps 的三种形态,认不出返回 null 而不是 0', () => {
  assert.equal(L.parseEtime('44-14:55:15'), 44 * 86400 + 14 * 3600 + 55 * 60 + 15)
  assert.equal(L.parseEtime('04:27:17'), 4 * 3600 + 27 * 60 + 17)
  assert.equal(L.parseEtime('00:03'), 3)
  assert.equal(L.parseEtime(''), null)
  assert.equal(L.parseEtime('garbage'), null)
})

test('leftover: parsePs 按前三列切,命令里的空白原样保留', () => {
  const rows = L.parsePs(`    1     0 44-14:55:15 /sbin/launchd\n 4914     1 34-23:15:17 ${WRAP(LOOP)}\nbad line\n`)
  assert.equal(rows.length, 2)
  assert.deepEqual([rows[1].pid, rows[1].ppid], [4914, 1])
  assert.ok(rows[1].command.includes('do sleep 5; done'))
})

test('leftover: 判据 = ppid 1 + 快照标记 + 存活够久,缺任一条都不算', () => {
  const ok = { pid: 1, ppid: 1, ageSec: 7200, command: WRAP(LOOP) }
  assert.equal(L.isLeftover(ok), true)
  assert.equal(L.isLeftover({ ...ok, ppid: 43278 }), false, '父进程还在 = 轮还没结束,不算')
  assert.equal(L.isLeftover({ ...ok, command: '/bin/zsh -c while true; do sleep 5; done' }), false, '没有快照标记 = 不是 agent 起的')
  assert.equal(L.isLeftover({ ...ok, ageSec: 3599 }), false, '默认门槛 1 小时,差 1 秒不算')
  assert.equal(L.isLeftover({ ...ok, ageSec: 3600 }), true)
  assert.equal(L.isLeftover({ ...ok, ageSec: null }), false, '年龄解析不出 = 不算(别当 0)')
  assert.equal(L.isLeftover({ ...ok, ageSec: 10 }, 5), true, '门槛可注入')
})

test('leftover: summarizeCommand 剥掉前导只留 agent 写的那条命令,机器路径不露', () => {
  const s = L.summarizeCommand(WRAP(LOOP))
  assert.ok(s.startsWith('until node -e'), s)
  assert.ok(s.includes("require('fs')"), '两种嵌套单引号写法都还原:' + s)
  assert.ok(!s.includes('shell-snapshots') && !s.includes('/tmp/claude'), s)
  // 没有 eval 形态时退回粗剪:快照前导之后的最后一段
  const s2 = L.summarizeCommand(`/bin/zsh -c source ${SNAP} 2>/dev/null || true && npm run dev < /dev/null && pwd -P >| /tmp/x`)
  assert.equal(s2, 'npm run dev')
  // 完全认不出的原样截断
  assert.equal(L.summarizeCommand('x'.repeat(200), 20).length, 20)
})

test('leftover: list 过滤 + 按最老排序 + win32 不支持', async () => {
  const ps = async () => [
    `    1     0 44-14:55:15 /sbin/launchd`,
    ` 4914     1 34-23:15:17 ${WRAP(LOOP)}`,
    `69703     1 42-23:11:07 ${WRAP('while ! nc -z 127.0.0.1 9420; do sleep 1; done')}`,
    `70725  4914       00:01 sleep 5`,
    `88888     1       00:20 ${WRAP('npm run build')}`, // 刚起 20 秒,不到门槛
  ].join('\n')
  const r = await L.list({ ps })
  assert.equal(r.supported, true)
  assert.deepEqual(r.rows.map((x) => x.pid), [69703, 4914], '最老在前;子 sleep 与 20 秒的不算')
  assert.equal(r.rows[0].age, '42 天')
  assert.ok(r.rows[1].summary.startsWith('until node'))
  const w = await L.list({ ps, isWin: true })
  assert.deepEqual(w, { supported: false, rows: [] })
  const e = await L.list({ ps: async () => { throw new Error('ps: boom') } })
  assert.equal(e.supported, true); assert.equal(e.rows.length, 0); assert.match(e.error, /boom/)
})

test('leftover: describe 三态(无 / 有 / 查不了),零工具名', () => {
  assert.equal(L.describe({ supported: false, rows: [] }), null, '不支持 = 不占行')
  const none = L.describe({ supported: true, rows: [] })
  assert.equal(none.status, 'ok')
  const some = L.describe({ supported: true, rows: [{ pid: 1, ageSec: 3e6, age: '35 天', summary: 'until node -e …; do sleep 5; done' }] })
  assert.equal(some.status, 'warn')
  assert.match(some.text, /1 个后台进程/); assert.match(some.text, /35 天/)
  assert.ok(!/sbot |~\/\.sbot|shell-snapshots/.test(some.text + none.text), '健康行进控制台,不许带命令名 / 机器路径')
  assert.equal(L.describe({ supported: true, rows: [], error: 'ps 失败' }).status, 'warn')
})

test('leftover: kill 动手前按身份复核;整组 SIGTERM → SIGKILL;组杀失败连后代一起;ESRCH 不算失败', async () => {
  // 动手前的 ps 快照:4914 是真孤儿(组杀会失败 ⇒ 要连 70725 / 70800 两代后代);69703 是真孤儿且组杀可行;
  // 777 已经不在;888 是别的活进程顶了旧号(ppid 不是 1)—— 后两者绝不能收到信号
  const ps = async () => [
    ` 4914     1 34-23:15:17 ${WRAP(LOOP)}`,
    `70725  4914       00:01 sleep 5`,
    `70800 70725       00:01 node -e x`,
    `69703     1 42-23:11:07 ${WRAP('while true; do sleep 1; done')}`,
    `  888 43278       00:09 ${WRAP('npm test')}`,
  ].join('\n')
  const calls = []
  const kill = (pid, sig) => {
    calls.push([pid, sig])
    if (pid === -4914) throw new Error('EPERM') // 组杀不行 ⇒ 本体 + 后代逐个
    if (pid === 70800) { const e = new Error('gone'); e.code = 'ESRCH'; throw e }
  }
  const r = await L.kill([4914, 69703, 777, 888, 'x', 1], { ps, kill, sleep: async () => {}, graceMs: 1 })
  assert.deepEqual(r.killed, [4914, 69703])
  assert.deepEqual(r.skipped, [777, 888], '不在 / 被别的进程顶了号的 pid 只记 skipped')
  assert.deepEqual(r.failed, [])
  const sigs = (sig) => calls.filter(([, s]) => s === sig).map(([p]) => p)
  assert.deepEqual(sigs('SIGTERM'), [-4914, 4914, 70725, 70800, -69703], '组杀失败后本体与两代后代都收到;可行的只打组')
  assert.deepEqual(sigs('SIGKILL'), [4914, 70725, 70800, -69703], '兜底一轮同样覆盖后代(expect 不理 SIGTERM)')
  assert.ok(!calls.some(([p]) => [777, -777, 888, -888, 1, -1].includes(p)), '复核没过的、pid 1、非法值绝不发信号')
  // ps 本身跑不了 ⇒ 一个都不杀,全部记 failed
  const e = await L.kill([4914], { ps: async () => { throw new Error('no ps') }, kill })
  assert.deepEqual(e.killed, []); assert.match(e.failed[0].error, /no ps/)
})

test('leftover: descendants 按 ppid 链取全部后代', () => {
  const rows = [{ pid: 1, ppid: 0 }, { pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 12, ppid: 11 }, { pid: 20, ppid: 1 }]
  assert.deepEqual(L.descendants(rows, 10), [11, 12])
  assert.deepEqual(L.descendants(rows, 20), [])
})

test('leftover: command 与 summary 都过出站脱敏', async () => {
  const ps = async () => ` 4914     1 34-23:15:17 ${WRAP('curl -H "x-api-key: sk-abcdefghijklmnopqrstuvwxyz" https://api.example')}`
  const r = await L.list({ ps })
  assert.ok(!r.rows[0].summary.includes('sk-abcdef') && !r.rows[0].command.includes('sk-abcdef'), r.rows[0].summary)
  assert.match(r.rows[0].summary, /redacted/)
})

test('leftover: cachedList 30 秒内复用,clearCache 后重查', async () => {
  let n = 0
  const ps = async () => { n++; return '' }
  let now = 1_000_000
  L.clearCache()
  await L.cachedList({ ps, now: () => now })
  await L.cachedList({ ps, now: () => now + 10_000 })
  assert.equal(n, 1)
  await L.cachedList({ ps, now: () => now + 40_000 })
  assert.equal(n, 2)
  L.clearCache()
  await L.cachedList({ ps, now: () => now + 40_000 })
  assert.equal(n, 3)
})
