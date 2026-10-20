// 项目长期记忆探测(跨模型记忆交接)。四块:
//  ① 探测式 —— 项目里没有的东西一个字都不报(清单每轮付 token)
//  ② 档位而非精确条数 —— 清单指纹要跨轮稳定,否则记忆一天长一条就白重注入一次清单
//  ③ ⭐ slug 规则(realpath + `/` 和 `_` 都压成 `-`)与归属校验 —— 报错对象比不报更糟
//  ④ 接线 —— 读取器由 bin 注入,漏注入/路径写错都会被 catch 静默吞掉
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { probeProjectMemory, probeMemoryDir, memorySlug, slugOwners, hasHandover, countBucket, CONVENTION_FILES } = require('../../src/projectmemory')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-projmem-'))
const mkdir = (p) => (fs.mkdirSync(p, { recursive: true }), p)

// ⚠ slug 必须按 **realpath** 算 —— macOS 的 os.tmpdir() 是 /var/folders/…(软链到 /private/var/…)。
// ⚠ 这个 helper 与生产**同源** ⇒ 它**不构成独立基准**:slug 规则若改坏,种和探会一起错、自洽,
//   这些用例照样绿(实测:漏掉 `_` 那个变异对本 helper 的用例毫无影响)。slug 规则由下面那条
//   **字面量**断言守住 —— 基准必须来自被测代码之外。
function seedMemory(cfgDir, workdir, n, withIndex = true) {
  const dir = mkdir(path.join(cfgDir, 'projects', memorySlug(fs.realpathSync(workdir)), 'memory'))
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(dir, `m${i}.md`), '# m')
  if (withIndex) fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# index')
  return dir
}
// 归属权威源:claude.json 的 projects 以真实绝对路径为键
const seedClaudeJson = (cfgDir, keys) =>
  fs.writeFileSync(path.join(mkdir(cfgDir), '.claude.json'), JSON.stringify({ projects: Object.fromEntries(keys.map((k) => [k, {}])) }))

test('探测式:约定文件与记忆都没有 ⇒ 返回 null(清单里一个字都不出现)', () => {
  const root = tmp(), wd = mkdir(path.join(root, 'proj'))
  assert.equal(probeProjectMemory(wd, { configDir: path.join(root, 'cfg') }), null)
})

test('约定文件:只点名真实存在的,顺序固定(拿字面量断言,不拿常量自己当期望)', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg'), wd = mkdir(path.join(root, 'proj'))
  fs.writeFileSync(path.join(wd, 'AGENTS.md'), '#')
  assert.deepEqual(probeProjectMemory(wd, { configDir: cfgDir }).convention, ['AGENTS.md'])
  // 两份都在 ⇒ 都点名(codex 不读 CLAUDE.md、claude 不读 AGENTS.md,这一行不按 runner 分流)。
  // ⚠ 顺序有语义:清单按 convention[0] 兜底挑落点 ⇒ 必须用字面量钉死,拿 CONVENTION_FILES
  //   当期望的话顺序怎么改都恒真(那是一条实质空断言)。
  fs.writeFileSync(path.join(wd, 'CLAUDE.md'), '#')
  assert.deepEqual(probeProjectMemory(wd, { configDir: cfgDir }).convention, ['CLAUDE.md', 'AGENTS.md'])
  assert.deepEqual(CONVENTION_FILES, ['CLAUDE.md', 'AGENTS.md']) // 常量本身也钉一次
  // 目录同名不算数(必须是文件)
  const wd2 = mkdir(path.join(root, 'p2', 'CLAUDE.md'))
  assert.equal(probeProjectMemory(path.join(root, 'p2'), { configDir: cfgDir }), null)
  assert.ok(fs.statSync(wd2).isDirectory()) // 对照组:那个同名目录确实建出来了
})

test('记忆目录:条数不含索引 · 索引报出 · 路径是 stat 过的真路径', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg'), wd = mkdir(path.join(root, 'proj'))
  const dir = seedMemory(cfgDir, wd, 4)
  const m = probeMemoryDir(wd, { configDir: cfgDir })
  assert.equal(m.dir, dir)
  assert.equal(m.count, 4)          // 5 个 .md 里有 1 个是索引
  assert.equal(m.index, 'MEMORY.md')
  assert.equal(m.bucket, '不到 10 条')
  assert.equal(fs.statSync(m.dir).isDirectory(), true) // 报出去的路径必须真的存在
})

test('记忆目录:不存在 / 空 / 只剩索引 ⇒ null(没东西可交接就不占清单篇幅)', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg'), wd = mkdir(path.join(root, 'proj'))
  assert.equal(probeMemoryDir(wd, { configDir: cfgDir }), null)      // 目录不存在
  seedMemory(cfgDir, wd, 0, false)
  assert.equal(probeMemoryDir(wd, { configDir: cfgDir }), null)      // 空目录
  seedMemory(cfgDir, wd, 0, true)
  assert.equal(probeMemoryDir(wd, { configDir: cfgDir }), null)      // 只有索引
  // 对照组:放进一条真记忆就报得出来 —— 证明上面三个 null 不是探测本身失灵
  seedMemory(cfgDir, wd, 1, true)
  assert.equal(probeMemoryDir(wd, { configDir: cfgDir }).count, 1)
})

test('记忆目录:只数 .md 文件 —— 非 md 文件与「.md 结尾的子目录」都不算', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg'), wd = mkdir(path.join(root, 'proj'))
  const dir = seedMemory(cfgDir, wd, 2)
  assert.equal(probeMemoryDir(wd, { configDir: cfgDir }).count, 2)   // 对照组:先确认基线是 2
  // 真实记忆库里就有这些:_archive/ 子目录、.consolidate-lock 之类的非 md 文件
  mkdir(path.join(dir, 'archive.md'))                                // 「.md 结尾」的目录
  fs.writeFileSync(path.join(dir, '.consolidate-lock'), '')
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x')
  assert.equal(probeMemoryDir(wd, { configDir: cfgDir }).count, 2)   // 仍是 2,一个都没混进来
})

test('索引缺失也照报(index=null),只是不教它先读索引', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg'), wd = mkdir(path.join(root, 'proj'))
  seedMemory(cfgDir, wd, 3, false)
  const m = probeMemoryDir(wd, { configDir: cfgDir })
  assert.equal(m.count, 3); assert.equal(m.index, null)
})

// ⭐⭐ 本模块最贵的一条,真事故:claude 的 slug 把 `_` 也压成 `-`。
// 漏掉它 ⇒ `…/Doc-TTS`(不存在)命中 `…/Doc_TTS` 的记忆,agent 照着**别的项目**的结论干活;
// 而真主人自己反而永远探不到。两头都坏,且「没有记忆」与「slug 算错了」长得一模一样。
test('slug:`_` 与 `/` 都压成 `-`(真实规则,从实物反推)', () => {
  assert.equal(memorySlug('/Users/x/Projects/Doc_TTS'), '-Users-x-Projects-Doc-TTS')
  assert.equal(memorySlug('/a/b_c/d'), '-a-b-c-d')
  // ⚠ Windows 规则**无样本**,这条只是记录当前实现会算成什么;算错的后果是 stat 不到 ⇒ null
  //   (fail-safe,不会报出错路径),别把它读成「Windows 已覆盖」。
  assert.equal(memorySlug('C:\\proj\\app_v2'), 'C:-proj-app-v2')
})

test('slug:带 `_` 的项目探得到自己的记忆;同形带 `-` 的**不存在**路径拿不到它', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg')
  const real = mkdir(path.join(root, 'Doc_TTS'))
  seedMemory(cfgDir, real, 3)
  assert.equal(probeMemoryDir(real, { configDir: cfgDir }).count, 3)          // 真主人拿得到
  assert.equal(fs.existsSync(path.join(root, 'Doc-TTS')), false)              // 对照组:这个路径确实不存在
  assert.equal(probeMemoryDir(path.join(root, 'Doc-TTS'), { configDir: cfgDir }), null) // 冒名者拿不到
})

test('workdir 必须是真实存在的目录(挡掉填错路径 / 项目被移走 / 盘没挂上)', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg'), wd = mkdir(path.join(root, 'proj'))
  seedMemory(cfgDir, wd, 3)
  assert.equal(probeMemoryDir(wd, { configDir: cfgDir }).count, 3)   // 对照组
  assert.equal(probeMemoryDir(path.join(root, 'gone'), { configDir: cfgDir }), null)  // 不存在(realpath 抛)
  // ⚠ 「是文件不是目录」这一条必须**单独可观测** —— 光写个 afile 是测不出来的:它的 slug 下
  //   本来就没有记忆目录,去掉这道检查照样返回 null(判据没有分辨力)。所以刻意在那个 slug 下
  //   种一份记忆:唯一还能让它返回 null 的,就只剩「workdir 不是目录」这道检查本身。
  const afile = path.join(root, 'afile'); fs.writeFileSync(afile, 'x')
  const stale = mkdir(path.join(cfgDir, 'projects', memorySlug(fs.realpathSync(afile)), 'memory'))
  fs.writeFileSync(path.join(stale, 'm.md'), '# m')
  assert.equal(probeMemoryDir(afile, { configDir: cfgDir }), null)
})

test('路径归一:尾斜杠 / 重复斜杠 / `.` / `..` 都指向同一份记忆', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg'), wd = mkdir(path.join(root, 'proj'))
  seedMemory(cfgDir, wd, 2)
  for (const v of [wd, wd + '/', wd + '//', path.join(root, '.', 'proj'), path.join(root, 'proj', '..', 'proj')]) {
    assert.equal(probeMemoryDir(v, { configDir: cfgDir }).count, 2, v)
  }
})

test('路径归一:workdir 是软链时也认得出(claude 记的是 realpath)', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg'), wd = mkdir(path.join(root, 'proj'))
  seedMemory(cfgDir, wd, 2)
  const link = path.join(root, 'link-to-proj')
  fs.symlinkSync(wd, link, 'dir')
  assert.equal(probeMemoryDir(link, { configDir: cfgDir }).count, 2)
})

// ── 归属校验:claude.json 的 projects 以真实绝对路径为键,是权威源(但不完备) ──
test('归属:记忆目录被别的项目认领 ⇒ 不报(带对照组)', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg')
  const mine = mkdir(path.join(root, 'x-y')), other = mkdir(path.join(root, 'x_y'))
  seedMemory(cfgDir, mine, 5) // 两者同 slug,这份记忆两边都指得到
  assert.equal(memorySlug(fs.realpathSync(mine)), memorySlug(fs.realpathSync(other))) // 前提成立
  seedClaudeJson(cfgDir, [other])                                   // 权威源说:它是 x_y 的
  assert.equal(probeMemoryDir(mine, { configDir: cfgDir }), null)
  seedClaudeJson(cfgDir, [mine])                                    // 对照组:改成我的就报得出来
  assert.equal(probeMemoryDir(mine, { configDir: cfgDir }).count, 5)
})

test('归属:两个项目撞同一 slug ⇒ 谁都不报', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg')
  const a = mkdir(path.join(root, 'x-y')), b = mkdir(path.join(root, 'x_y'))
  seedMemory(cfgDir, a, 5)
  seedClaudeJson(cfgDir, [a, b])
  assert.equal(probeMemoryDir(a, { configDir: cfgDir }), null)
  assert.equal(probeMemoryDir(b, { configDir: cfgDir }), null)
})

test('归属:没人认领 / 读不到权威源 ⇒ 照报(权威但不完备,实测 20 个目录有 6 个无主)', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg'), wd = mkdir(path.join(root, 'proj'))
  seedMemory(cfgDir, wd, 5)
  assert.equal(probeMemoryDir(wd, { configDir: cfgDir }).count, 5)  // 压根没有 claude.json
  seedClaudeJson(cfgDir, [])                                        // 有 claude.json 但没人认领
  assert.equal(probeMemoryDir(wd, { configDir: cfgDir }).count, 5)
  fs.writeFileSync(path.join(cfgDir, '.claude.json'), '{ 坏 JSON')  // 权威源损坏 ⇒ 不阻断
  assert.equal(probeMemoryDir(wd, { configDir: cfgDir }).count, 5)
})

test('slugOwners:realpath 之后再比(键写成软链路径也认得出)', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg'), wd = mkdir(path.join(root, 'proj'))
  const link = path.join(root, 'lnk'); fs.symlinkSync(wd, link, 'dir')
  seedClaudeJson(cfgDir, [link])
  assert.deepEqual(slugOwners(cfgDir, memorySlug(fs.realpathSync(wd))), [fs.realpathSync(wd)])
  assert.equal(slugOwners(path.join(root, 'nocfg'), 'whatever'), null) // 无权威源 ⇒ null
})

// ⚠ 「幽灵键」:claude.json 的键**不随目录删除而清理**(本机实测 18 个键里 6 个是幽灵键)。
// 留着它参与匹配,会让一个早就删掉的老项目**压制住一个活着的项目**的记忆,而且不出任何声。
test('slugOwners:目录已不存在的幽灵键认领不了任何东西', () => {
  // ⚠ 幽灵键必须写成 **realpath 形态** —— tmpdir 是软链(/var → /private/var),写成软链路径的话
  //   它与 live 的 slug 天然就不同,「跳不跳过幽灵键」两种实现都能让本条绿(判据为零,实测过)。
  const root = fs.realpathSync(tmp()), cfgDir = path.join(root, 'cfg')
  const live = mkdir(path.join(root, 'x-y'))
  const ghost = path.join(root, 'x_y')            // 同 slug,但从没建过 ⇒ 幽灵键
  assert.equal(memorySlug(ghost), memorySlug(fs.realpathSync(live))) // 前提:两者确实同 slug
  seedMemory(cfgDir, live, 5)
  seedClaudeJson(cfgDir, [ghost])
  assert.deepEqual(slugOwners(cfgDir, memorySlug(fs.realpathSync(live))), []) // 幽灵键被跳过
  assert.equal(probeMemoryDir(live, { configDir: cfgDir }).count, 5)          // 活项目照报
  // 对照组:同一个键指向的目录**真的存在**时,它确实认领得了(证明不是这条扫描恒空)
  mkdir(ghost)
  assert.equal(probeMemoryDir(live, { configDir: cfgDir }), null)
})

// ⚠ 生产命中的是 `<cfgDir>.json`(即 ~/.claude.json),而测试此前只种 `<cfgDir>/.claude.json`
// ⇒ **生产唯一会走的那条分支一次都没被执行过**。砍掉第一候选,233 条测试照样全绿(实测)。
// 后果:整轮最核心的归属校验若在生产里走不通,会全程静默 fail-open,而单测全绿、doctor 不报。
test('claudeJsonPath:两个候选都认,且 `<cfgDir>.json` 优先', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg')
  const live = mkdir(path.join(root, 'x-y')), other = mkdir(path.join(root, 'x_y'))
  seedMemory(cfgDir, live, 5)
  // ① 只有第一候选(生产形态):它必须被读到 —— 内容说「归 other」⇒ 闭嘴
  mkdir(cfgDir)
  fs.writeFileSync(cfgDir + '.json', JSON.stringify({ projects: { [other]: {} } }))
  assert.equal(probeMemoryDir(live, { configDir: cfgDir }), null)
  // ② 两个候选都在、内容相反 ⇒ 第一候选说了算(仍闭嘴),证明优先级不是碰巧
  seedClaudeJson(cfgDir, [live])                       // 第二候选说「归 live」
  assert.equal(probeMemoryDir(live, { configDir: cfgDir }), null)
  // ③ 去掉第一候选 ⇒ 换第二候选生效,报得出来(对照组:证明②的 null 是第一候选造成的)
  fs.unlinkSync(cfgDir + '.json')
  assert.equal(probeMemoryDir(live, { configDir: cfgDir }).count, 5)
})

test('claudeJsonPath:cfgDir 带尾斜杠也找得到(否则两个候选双双落空、静默 fail-open)', () => {
  const root = tmp(), cfgDir = path.join(root, 'cfg')
  const live = mkdir(path.join(root, 'x-y')), other = mkdir(path.join(root, 'x_y'))
  seedMemory(cfgDir, live, 5); mkdir(cfgDir)
  fs.writeFileSync(cfgDir + '.json', JSON.stringify({ projects: { [other]: {} } }))
  assert.equal(probeMemoryDir(live, { configDir: cfgDir + '/' }), null)   // 尾斜杠仍读得到权威源
  assert.equal(probeMemoryDir(live, { configDir: cfgDir + '//' }), null)
})

// ── probeHandover:⭐ 消费者唯一入口(自知清单与控制台切模型通知都调它) ──
// 门控之前两个消费者天然一致;加了门控就多出第三种状态「探到了但这一轮一条都给不出去」。
// 各写各的判据 ⇒ 群里说「之前交代过的都还在」而清单一个字都没给。
const { probeHandover } = require('../../src/projectmemory')
const seedBoth = (root, { conv = [], mem = 0 } = {}) => {
  const cfgDir = path.join(root, 'cfg'), wd = mkdir(path.join(root, 'proj'))
  for (const f of conv) fs.writeFileSync(path.join(wd, f), '#')
  if (mem) seedMemory(cfgDir, wd, mem)
  return { cfgDir, wd }
}

test('probeHandover:记忆目录按「完全访问 或 codex」门控(四种群各验一次)', () => {
  const { cfgDir, wd } = seedBoth(tmp(), { conv: ['CLAUDE.md'], mem: 5 })
  const at = (o) => probeHandover(wd, { configDir: cfgDir, ...o })
  assert.ok(at({ full: true, isCodex: false }).memory)    // claude 完全访问 ⇒ 给
  assert.ok(at({ full: true, isCodex: true }).memory)     // codex 完全访问 ⇒ 给
  assert.ok(at({ full: false, isCodex: true }).memory)    // codex 只读(只读策略非路径牢笼)⇒ 给
  assert.equal(at({ full: false, isCodex: false }).memory, null) // claude 白名单 ⇒ --add-dir 够不着
  assert.equal(at({ full: false, isCodex: false }).landing, 'CLAUDE.md') // 对照组:约定档照给
})

test('probeHandover:落点选它自己会自动加载的那一份;只有一份就用那份', () => {
  const { cfgDir, wd } = seedBoth(tmp(), { conv: ['CLAUDE.md', 'AGENTS.md'], mem: 5 })
  const at = (o) => probeHandover(wd, { configDir: cfgDir, full: true, ...o })
  assert.equal(at({ isCodex: false }).landing, 'CLAUDE.md')
  assert.equal(at({ isCodex: true }).landing, 'AGENTS.md')
  assert.deepEqual(at({}).convention, ['CLAUDE.md', 'AGENTS.md'])  // 点名仍是两份
  const only = seedBoth(tmp(), { conv: ['CLAUDE.md'], mem: 5 })    // codex 群但只有 CLAUDE.md
  assert.equal(probeHandover(only.wd, { configDir: only.cfgDir, full: true, isCodex: true }).landing, 'CLAUDE.md')
})

// ⭐ 这一条就是两个消费者分叉的那个组合。它必须返回 null,两边才会一致地闭嘴。
test('probeHandover:探到了但这一轮一条都给不出去 ⇒ null(消费者不会说假话)', () => {
  const { cfgDir, wd } = seedBoth(tmp(), { conv: [], mem: 5 }) // 有记忆、零约定档
  // 对照组:够得着的群拿得到 —— 证明 null 不是「压根没探到」
  assert.ok(probeHandover(wd, { configDir: cfgDir, full: true, isCodex: false }).memory)
  assert.equal(probeHandover(wd, { configDir: cfgDir, full: false, isCodex: false }), null)
})

test('probeHandover:项目里什么都没有 ⇒ null', () => {
  const { cfgDir, wd } = seedBoth(tmp())
  assert.equal(probeHandover(wd, { configDir: cfgDir, full: true }), null)
})

// 档位存在的唯一理由 = 清单指纹跨轮稳定。这条钉的是「记忆天天长,清单不能天天变」。
test('countBucket:每一档都被断言到,档位内部条数变化不改变文本', () => {
  assert.equal(countBucket(1), '不到 10 条')
  assert.equal(countBucket(9), '不到 10 条')
  assert.equal(countBucket(10), '10+ 条')
  assert.equal(countBucket(19), '10+ 条')
  assert.equal(countBucket(20), '20+ 条')     // 这一档曾漏测
  assert.equal(countBucket(49), '20+ 条')
  assert.equal(countBucket(50), '50+ 条')
  assert.equal(countBucket(100), '100+ 条')
  assert.equal(countBucket(164), '100+ 条')
  assert.equal(countBucket(199), '100+ 条')   // 真实项目四天涨 1 条,文本一个字都不变
  assert.equal(countBucket(200), '200+ 条')   // 这一档曾漏测
  assert.equal(countBucket(499), '200+ 条')
  assert.equal(countBucket(500), '500+ 条')
  assert.equal(countBucket(9999), '500+ 条')
})

test('hasHandover:两个消费者共用的判据', () => {
  assert.equal(hasHandover(null), false)
  assert.equal(hasHandover({ convention: [], memory: null }), false)
  assert.equal(hasHandover({ convention: ['CLAUDE.md'], memory: null }), true)
  assert.equal(hasHandover({ convention: [], memory: { dir: '/m' } }), true)
})

test('配置目录:opts.configDir 优先于 env,env 优先于 home', () => {
  const root = tmp(), a = path.join(root, 'cfgA'), b = path.join(root, 'cfgB')
  const wd = mkdir(path.join(root, 'proj'))
  seedMemory(a, wd, 2); seedMemory(b, wd, 7)
  // configDir 赢过 env(两边都有记忆但条数不同 ⇒ 分得出是哪一边生效)
  assert.equal(probeMemoryDir(wd, { configDir: a, env: { CLAUDE_CONFIG_DIR: b } }).count, 2)
  // 不给 configDir 时 env 生效
  assert.equal(probeMemoryDir(wd, { env: { CLAUDE_CONFIG_DIR: b } }).count, 7)
  // env 也没有时落回 home(此处 home 下没有 ⇒ null),对照组见上两行
  assert.equal(probeMemoryDir(wd, { env: {}, home: path.join(root, 'nohome') }), null)
})

test('workdir 为空 / 未设 ⇒ null,不抛', () => {
  for (const v of [null, undefined, '', '   ']) assert.equal(probeProjectMemory(v), null)
})

// ── 接线(⭐ 本项目最贵的一类漏:判断写在调用方,单测只测得到被调用的那个纯函数) ──
// core 不碰 fs ⇒ 读取器由 bin 注入。漏注入的话探测器再对也到不了清单,而单测全绿。
const BIN = fs.readFileSync(path.join(__dirname, '..', '..', 'bin', 'sbot.js'), 'utf8')
const countOf = (s) => (BIN.match(new RegExp('engine\\.' + s + '\\s*=', 'g')) || []).length

test('接线:bin 每个注入 styleDocs 的地方都注入了 projectMemory', () => {
  const styles = countOf('styleDocs')
  assert.ok(styles >= 2, `对照组:bin 里应有 ≥2 处清单读取器注入点,实际 ${styles} —— 为 0 说明这条扫描本身失效了`)
  assert.equal(countOf('projectMemory'), styles)
})

// ⚠ bin 的注入包在 try/catch 里(读取失败不该拖垮一轮)⇒ **require 路径写错会被静默吞掉**,
// 永远返回 null,而「项目里没有记忆」和「模块根本没加载成功」在清单里长得一模一样。
test('接线:bin 里 projectMemory 的 require 路径解析得到(路径写错不会被 catch 吞掉)', () => {
  const m = BIN.match(/require\((['"])([^'"]*projectmemory)\1\)/i)
  assert.ok(m, 'bin 里没找到 require(.../projectmemory) —— 接线没了')
  assert.equal(require.resolve(m[2], { paths: [path.join(__dirname, '..', '..', 'bin')] }),
    path.join(__dirname, '..', '..', 'src', 'projectmemory.js'))
})
