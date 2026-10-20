// `--help` 必须每个子命令都答得出用法 —— 而且清单是**从派发表里读出来的**,
// 不是手写的:以后新增一个子命令却忘了给它 help,这里会自己红,不必靠人记得。
//
// 由来:2026-08-25 照派发表逐个数,13 个子命令里 11 个不认 `--help`,坏成四种形状
// (报「缺少目标群」/ 报 unknown action / 漏出 node parseArgs 内部报错 / 静默吞掉直接
// 跑了命令)。真机事实与 v0.11.50 治 design 一族时同源:**agent 拿到没用过的命令,
// 第一反应就是先敲 --help**。
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const BIN = path.join(__dirname, '..', '..', 'bin', 'sbot.js')
const SRC = fs.readFileSync(BIN, 'utf8')

// 派发表 = 权威清单。完整性由这个正则保证,不由我记性保证。
function dispatchedSubcommands() {
  const body = SRC.slice(SRC.indexOf('async function main()'))
  const out = new Set()
  for (const m of body.matchAll(/\bsub === '([a-z][a-z-]*)'/g)) out.add(m[1])
  out.delete('help') // 顶层 help 自己就是 help
  return [...out]
}

// 每次都在空目录里跑,且把配置指向一个不存在的路径 —— 否则万一拦截回归了,
// `sbot start` 会读到真配置去连飞书。带超时,回归时是超时失败而不是挂死。
function runHelp(...args) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-help-'))
  try {
    const r = spawnSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: 'utf8',
      timeout: 20000,
      // ⚠ HOME 也指到临时目录:`issue close 3 --help` 这类用例万一拦截回归,会真去动 ~/.sbot/issues.jsonl
      //   (关掉开发机上真实的 #3)再变红 —— 测试不许有碰真实数据的失败路径
      env: { ...process.env, HOME: cwd, SBOT_CONFIG: path.join(cwd, 'nope.json'), NO_COLOR: '1' },
    })
    return { code: r.status, stdout: r.stdout || '', out: (r.stdout || '') + (r.stderr || '') }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
}

const hasUsage = (s) => /用法|USAGE/.test(s)

test('派发表里每个子命令都答得出 --help', () => {
  const subs = dispatchedSubcommands()
  // 对照组:清单本身得是真读出来的。为 0 或少得离谱 = 正则失效,后面全绿也没意义。
  assert.ok(subs.length >= 10, `派发表只解析出 ${subs.length} 个子命令,正则多半失效了`)
  assert.ok(subs.includes('feishu') && subs.includes('start'), '派发表解析漏了已知命令')

  for (const sub of subs) {
    const r = runHelp(sub, '--help')
    assert.ok(hasUsage(r.out), `sbot ${sub} --help 没打印用法,而是:${r.out.slice(0, 120)}`)
  }
})

// ⚠ 上一条钉的是「问它用法它答得出」,**钉不住「顶层清单里有没有它」** —— `cron` 就是从这条缝里
// 漏掉的:它答得出 `--help`,却在 `sbot --help` 里一次都不出现,等于**能力没被列出来**。
// 与 v0.11.55 同一族(那次治的是「认不认 --help」),而这次更隐蔽:agent 得先知道有这个命令,
// 才会去问它用法。清单同样从**派发表**读出来,不靠人记得。
test('派发表里每个子命令都出现在顶层 --help 的清单里', () => {
  const subs = dispatchedSubcommands()
  assert.ok(subs.length >= 10, `派发表只解析出 ${subs.length} 个子命令,正则多半失效了`)
  const top = runHelp('--help').out
  // 对照组:顶层 help 本身得是真读出来的,否则下面全绿也没意义
  assert.ok(/sbot feishu/.test(top) && top.length > 600, '顶层 --help 没读到内容,这条断言失去分辨力')
  // 给人用的写 sintbot、agent 用的基础技能写 sbot(权限白名单是 Bash(sbot …)),两种写法都算列出
  const missing = subs.filter((s) => !new RegExp(`\\b(?:sintbot|sbot) ${s}\\b`).test(top))
  assert.deepEqual(missing, [], `这些命令在顶层 --help 里没列出来(agent 无从知道它们存在):${missing.join(', ')}`)
})

test('-h 短写同样认', () => {
  for (const sub of ['doctor', 'feishu', 'issue']) {
    assert.ok(hasUsage(runHelp(sub, '-h').out), `sbot ${sub} -h 没打印用法`)
  }
})

// 全部子命令口径一致:help 走 stdout + 退出码 0。走 die() 的话 agent 收到的是
// 红色 stderr + 退出码 1,会判定「这条命令失败了」——「把 help 读成失败」正是本 bug
// 最伤的地方,所以 design / imagen 这两个"内容本来就对"的也一并抹平了。
test('每个子命令的 --help 都走 stdout + 退出码 0', () => {
  for (const sub of dispatchedSubcommands()) {
    const r = runHelp(sub, '--help')
    assert.strictEqual(r.code, 0, `sbot ${sub} --help 退出码应为 0,实际 ${r.code}`)
    assert.ok(hasUsage(r.stdout), `sbot ${sub} --help 的用法应走 stdout,实际 stdout=${r.stdout.slice(0, 80)}`)
  }
})

// design / imagen 的 help 是**按动作**分的,派发处那道统一拦截够不着 —— 单独钉住。
// ⚠ 清单从 cmdDesign 的分支里读出来(见下面 actionsOf),不手写:2026-09-08 对账发现 styles / use /
//   extract-colors / swatch 四条从来没接 --help(styles 静默把命令跑了,另三条退出码 1),而手写的
//   清单恰好只列了接了的那六条 —— 手写清单只会记得已经做对的。
test('design 各动作与 imagen 的 --help 同样是 stdout + 0', () => {
  const designActions = actionsOf('cmdDesign')
  assert.ok(designActions.length >= 10, `对照组:cmdDesign 应解析出 ≥10 个动作,实际 ${designActions.length}`)
  const cases = [...designActions.map((a) => ['design', a]), ['imagen']]
  for (const args of cases) {
    const r = runHelp(...args, '--help')
    assert.strictEqual(r.code, 0, `sbot ${args.join(' ')} --help 退出码应为 0,实际 ${r.code}`)
    assert.ok(hasUsage(r.stdout), `sbot ${args.join(' ')} --help 的用法应走 stdout,实际 stdout=${r.stdout.slice(0, 80)}`)
  }
})

// 从某个 cmdX 函数体里读出它认的动作名(`action === 'xxx'` / `action !== 'xxx'`)。
// 函数体 = 从 `async function cmdX(` 到下一个顶格 function。名字以 '-' 开头的是 --help 之类,不算动作。
function actionsOf(fnName) {
  const start = SRC.indexOf(`async function ${fnName}(`)
  assert.ok(start >= 0, `找不到 ${fnName}`)
  const after = SRC.slice(start + 1)
  const end = after.search(/\n(?:async )?function /)
  const body = end >= 0 ? after.slice(0, end) : after
  const out = new Set()
  for (const m of body.matchAll(/\baction (?:===|!==) '([a-z][a-z-]*)'/g)) out.add(m[1])
  return [...out]
}

// ⚠ 分辨力:上面几条只证明「help 答得出来」,不证明「答得全」。每个命令认的动作名从它自己的分支里
//   读出来,逐个查它出现在 `sbot <cmd> --help` 里;顶层清单同样要列全(别名除外 —— 别名是给手快的人
//   兜底的,不是能力)。由来:顶层清单曾只列 feishu 18 个动作里的 7 个,agent 看不见就不会用。
const ALIASES = { feishu: ['delete'], cron: ['rm', 'delete', 'edit'] }
test('每个命令认的动作都列在它的 --help 与顶层清单里(清单从分支里读,不手写)', () => {
  const top = runHelp('--help').out
  assert.ok(top.length > 600 && /sbot feishu/.test(top), '对照组:顶层 help 没读到内容')
  // 对照组阈值按命令给:browser 只有 link 一个动作,阈值 1;其余 ≥3(正则失效时会掉到 0)
  for (const [cmd, fn, min] of [['feishu', 'cmdFeishu', 3], ['wecom', 'cmdWecom', 3], ['cron', 'cmdCron', 3], ['design', 'cmdDesign', 3], ['preview', 'cmdPreview', 3], ['issue', 'cmdIssue', 3], ['browser', 'cmdBrowser', 1]]) {
    const actions = actionsOf(fn)
    assert.ok(actions.length >= min, `对照组:${fn} 只解析出 ${actions.length} 个动作,正则多半失效了`)
    const sub = runHelp(cmd, '--help').out
    const missingSub = actions.filter((a) => !new RegExp(`(^|[^a-z-])${a}([^a-z-]|$)`, 'm').test(sub))
    assert.deepEqual(missingSub, [], `sbot ${cmd} --help 没列这些动作:${missingSub.join(', ')}`)
    // ⚠ 只在**这条命令自己的那一块**里找(从「sbot <cmd>」起到下一条「sbot 」为止):整份顶层 help 里
    //   `list` / `start` / `doctor` 这些词别的命令也有,整体匹配会让 cron 行删掉 list 也照样绿
    const head = top.match(new RegExp(`\\b(?:sintbot|sbot) ${cmd}\\b`))
    assert.ok(head, `顶层 --help 里找不到「sbot ${cmd}」或「sintbot ${cmd}」`)
    const rest = top.slice(head.index + head[0].length)
    const nextCmd = rest.search(/\n {2}(?:sintbot|sbot) /)
    const block = nextCmd >= 0 ? rest.slice(0, nextCmd) : rest
    const missingTop = actions.filter((a) => !(ALIASES[cmd] || []).includes(a)).filter((a) => !new RegExp(`(^|[^a-z-])${a}([^a-z-]|$)`, 'm').test(block))
    assert.deepEqual(missingTop, [], `顶层 --help 的「sbot ${cmd}」那块没列这些动作:${missingTop.join(', ')}`)
  }
})

// ⚠ `--help` 的位置规则分两类:feishu / agent 的尾部是自由文本,只认头两个位置(上一条钉住);
//   其余命令的位置参数是 id / 路径 / 时间,`--help` 放哪儿都该是求助。由来:`sbot issue close 3 --help`
//   曾真去关 #3、`sbot preview stop x --help` 真去停 —— 「问怎么用」变成「照做了一遍」。
test('id / 路径之后的 --help 仍是求助(issue / preview / cron / design),不执行命令', () => {
  for (const args of [['issue', 'close', '3'], ['preview', 'stop', 'x'], ['cron', 'add', '0 9 * * *'], ['design', 'styles']]) {
    const r = runHelp(...args, '--help')
    assert.strictEqual(r.code, 0, `sbot ${args.join(' ')} --help 退出码应为 0,实际 ${r.code}:${r.out.slice(0, 100)}`)
    assert.ok(hasUsage(r.stdout), `sbot ${args.join(' ')} --help 应打印用法,实际:${r.out.slice(0, 100)}`)
  }
})

// ⚠ 分辨力:上一条只证明"求助会成功"。**「参数给漏了」必须仍然是失败** —— 两者
// 原本共用一条 die(),抹平时若图省事一起改成 helpOut,漏参数就会报成功,
// 调用方会以为活干完了。正文相同、退出码必须不同。
test('漏了必填参数仍是错误(退出码 1),不能跟着 help 一起变成 0', () => {
  for (const args of [['design', 'layout'], ['design', 'icon'], ['imagen'], ['design']]) {
    const r = runHelp(...args)
    assert.strictEqual(r.code, 1, `sbot ${args.join(' ')}(缺参数)退出码应为 1,实际 ${r.code}`)
    assert.ok(hasUsage(r.out), `sbot ${args.join(' ')}(缺参数)仍应给出用法`)
  }
})

// ⚠ 分辨力:上面三条只证明"会拦",不证明"拦得准"。正文里出现 --help 不该被当成求助
// —— 而"正文以 '-' 开头"正是自知清单教给 agent 的写法(feishu 因此才手写参数解析)。
test('第三个位置往后的 --help 属于正文,不拦', () => {
  const r = runHelp('feishu', 'send-msg', 'hi', '--help')
  assert.ok(!hasUsage(r.out), `正文里的 --help 被误当成求助了:${r.out.slice(0, 120)}`)
  // 对照组:它确实走到了业务逻辑(没有配置 ⇒ 报未配置),而不是悄悄什么都没做
  assert.ok(/feishu/i.test(r.out), `期望走到 feishu 业务分支,实际:${r.out.slice(0, 120)}`)
})
