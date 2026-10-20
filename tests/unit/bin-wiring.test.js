// 接线断言(泛化版):调用方文件里每一处 `const {a,b} = require('模块')` 与 `const X = require('模块')`,
// 都对着模块的真实导出核一遍 —— 解构了不存在的名字、用了没解构的名字、`X.name(` 里 name 不存在,三种都红。
//
// 由来:v0.11.68 在 feishu.js 里导出了 historyAtMark 却没在 bin 里解构,`node --check` 只查语法、
// 纯函数单测测不到调用方,生产机上 `feishu history` 当场 ReferenceError。v0.11.69 为此钉了一条断言,
// 但只覆盖 feishu 一个模块;bin 对 board.js 的解构有 28 个名字、design / preview / imagen 走命名空间,
// 形状一模一样、一个都没保护。这里把判据做成通用的,新模块自动进网。
//
// ⚠ 判据必须带对照组:「一处问题都没有」和「一处都没扫到」输出一样 —— 末尾断言扫描规模。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const CALLERS = ['bin/sbot.js', 'src/ui/server.js', 'src/health.js', 'src/agent/claudecode.js', 'src/agent/codexcode.js']
const REQ_RE = /^const (\{([^}]+)\}|([A-Za-z_$][\w$]*)) = require\('(\.[^']+)'\)/gm

function scan() {
  const problems = []
  let destructured = 0, namespaced = 0, modules = 0
  for (const rel of CALLERS) {
    const file = path.join(ROOT, rel)
    const src = fs.readFileSync(file, 'utf8')
    // 先按模块汇总:同一个模块可能被解构两次(server.js 对 core/store 就是:一次 atomicWriteJSON、一次 withFileLock),
    // 逐条 require 单独核会把第二次当成「漏了」。
    const byTarget = new Map() // target → { imported:Set, aliases:Set }
    for (const m of src.matchAll(REQ_RE)) {
      const names = m[2], alias = m[3], target = m[4]
      const rec = byTarget.get(target) || { imported: new Set(), aliases: new Set() }
      if (names) for (const n of names.split(',').map((s) => s.trim().split(/\s*:\s*/).pop()).filter(Boolean)) rec.imported.add(n)
      if (alias) rec.aliases.add(alias)
      byTarget.set(target, rec)
    }
    for (const [target, rec] of byTarget) {
      let exported
      try { exported = new Set(Object.keys(require(path.resolve(path.dirname(file), target)))) } catch (e) { problems.push(`${rel}: require('${target}') 加载失败:${e.message}`); continue }
      modules++
      for (const n of rec.imported) { destructured++; if (!exported.has(n)) problems.push(`${rel}: 解构了 ${target} 里不存在的导出 ${n}`) }
      if (rec.imported.size) {
        // 「调用了没导入」:模块的某个导出在本文件里以裸名被调用,却不在解构里 ⇒ 运行到那行才 ReferenceError。
        // 本文件自己定义的同名函数不算(`function name(` / `const name =`)。
        for (const e of exported) {
          if (rec.imported.has(e)) continue
          const selfDefined = new RegExp(`(?:function\\s+${e}\\s*\\(|(?:const|let|var)\\s+${e}\\s*=)`).test(src)
          if (!selfDefined && new RegExp(`(?<![\\w.$])${e}\\s*\\(`).test(src)) problems.push(`${rel}: 调用了 ${target} 的 ${e} 但没解构(运行时 ReferenceError)`)
        }
      }
      for (const alias of rec.aliases) {
        for (const u of src.matchAll(new RegExp(`(?<![\\w.$])${alias}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g'))) {
          namespaced++
          if (!exported.has(u[1])) problems.push(`${rel}: 调用了 ${alias}.${u[1]} 但 ${target} 没有这个导出`)
        }
      }
    }
  }
  return { problems, destructured, namespaced, modules }
}

test('接线:调用方对每个模块的解构 / 命名空间调用,都对得上模块的真实导出', () => {
  const r = scan()
  assert.deepEqual(r.problems, [], r.problems.join('\n'))
  // 对照组:扫描规模要有分辨力 —— 正则一失效这里先红,而不是「零问题」假绿。
  assert.ok(r.modules >= 30, `模块数 ${r.modules} 太少,扫描可能失效`)
  assert.ok(r.destructured >= 100, `解构名 ${r.destructured} 太少`)
  assert.ok(r.namespaced >= 80, `命名空间调用 ${r.namespaced} 太少`)
})

test('接线:判据有分辨力 —— 人为造一处「调用了没解构」必须被抓到', () => {
  // 不动真文件:把扫描逻辑套在一段合成源码上跑一遍(与 scan 同一套正则与判据)。
  const src = "const { imageSize } = require('../src/platform/board')\nconst x = digestNodes([])\n"
  const exported = new Set(Object.keys(require('../../src/platform/board.js')))
  const imported = new Set(['imageSize'])
  const missing = [...exported].filter((e) => !imported.has(e) && new RegExp(`(?<![\\w.$])${e}\\s*\\(`).test(src))
  assert.deepEqual(missing, ['digestNodes'])
})


// ── imagen worker 必须把配置路径传给子命令 ─────────────────────────────────────────
// 2026-09-08 真机:从终端手投一张生图,图出来了、群也发了,但**上板整段哑掉** —— worker 的
// `board-add-image` 子命令 cwd 是项目目录,那儿没有 sbot.config.json,`loadConfig` 读到内置
// 默认后 die('feishu 未配置');而上板失败只记一行日志、任务照落 ok,所以从任何一侧都看不出来。
// 群里发起时 agent 环境恰好有 SBOT_CONFIG、worker 继承了它 —— 洞平时就藏在这个巧合后面。
// ⚠ 断言相对位置:光有赋值不够,它必须发生在 spawn 之前才有意义。
test('bin: imagen worker 把 SBOT_CONFIG 注进 env,且在 spawn 子命令之前', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin/sbot.js'), 'utf8')
  const setAt = src.indexOf('process.env.SBOT_CONFIG = cfg._path')
  const spawnAt = src.indexOf("[__filename, 'feishu', 'board-add-image', task.outRel]")
  assert.ok(setAt > 0, 'imagen worker 没把 cfg._path 写进 SBOT_CONFIG —— 上板会在项目目录里找不到配置')
  assert.ok(spawnAt > 0, '对照组:没扫到 worker 里那处 board-add-image spawn —— 断言可能已经失效')
  assert.ok(setAt < spawnAt, 'SBOT_CONFIG 必须在 spawn board-add-image 之前设好')
})

// cmdStart 里 `const engine = new Engine(…)` 之前,函数体顶层(两格缩进)不许出现 `engine.` 语句 —— v0.11.107 第一版把
// `engine.quotaStatus = …` 写在声明前,daemon 一启动就 TDZ 崩,而 1660 例单测没有一条跑 cmdStart。闭包体里引用 engine
// 是允许的(调用发生在声明之后),所以只看两格缩进的顶层语句;对照组 = 声明之后必须真的有顶层 `engine.` 语句被扫到。
test('bin-wiring: cmdStart 里 engine 声明之前没有顶层 engine.* 语句(TDZ 守卫)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'bin/sbot.js'), 'utf8')
  const r = tdzScan(src)
  assert.ok(r.declAt > 0, '没找到 cmdStart 里的 engine 声明 —— 断言可能已失效')
  assert.deepEqual(r.before, [], 'engine 声明之前的顶层 engine.* 语句:\n' + r.before.join('\n'))
  assert.ok(r.after > 0, '对照组:声明之后一处顶层 engine.* 都没扫到 —— 扫描方式可能已失效')
})
function tdzScan(src) {
  const start = src.indexOf('async function cmdStart(')
  const body = src.slice(start)
  const declAt = body.indexOf('  const engine = new Engine(')
  if (start < 0 || declAt < 0) return { declAt: -1, before: [], after: 0 }
  const top = /^  engine\.[^\n]*/gm
  const before = [...body.slice(0, declAt).matchAll(top)].map((m) => m[0].trim())
  const after = [...body.slice(declAt).matchAll(top)].length
  return { declAt, before, after }
}
module.exports.tdzScan = tdzScan
