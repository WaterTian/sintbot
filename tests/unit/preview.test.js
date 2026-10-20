// 群预览服务(src/preview.js)—— 纯逻辑六块:
//   preferredPort/portCandidates  端口段内确定性分配(同群恒同端口;环形扫全段)
//   resolveServeTarget            serveRoot 五条围栏(相对路径/../越界/软链逃逸/拒项目根/index.html)
//   resolveRequestPath            每请求路径裁决(token 前缀 + 段级 denylist + 编码穿越 + 无目录列表)
//   记录族                        newRecord/writeRecord/listRecords/findLive/markStopped/pruneRecords
//   reapDecision/createPreviewReaper  回收判定与 daemon 侧收割器(注入 now/isAlive/kill/notify)
//   文案                          buildStartedText/buildStoppedMessage/buildStatusLines
// 真实文件系统只在 serveRoot/请求裁决两处用(围栏正确性必须过真 realpath),其余全注入。
//
// ⚠ 本文件里带「反模式」字样的断言是有历史的:v0.8.1 禁了 agent 装常驻服务,它当天就改用
// 「故意不结束本轮」给服务续命(占群锁,群成员消息全排队)。受理文案是本技能的主要交付物,
// 措辞退化即产品缺陷 ⇒ 用单测钉住。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const preview = require('../../src/preview')
const {
  preferredPort, portCandidates, isDeniedSegment, isDenied, resolveServeTarget, verifyRecordFence, resolveRequestPath,
  newRecord, writeRecord, listRecords, findLive, markStopped, pruneRecords, isLive, recordFile,
  buildUrl, reapDecision, createPreviewReaper, buildStoppedMessage, buildStartedText, buildStatusLines,
  normalizeOptions,
} = preview

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-preview-'))
const RANGE = { from: 4610, to: 4629 }

// ── 端口分配 ─────────────────────────────────────────────────────────────────

test('preferredPort:同 chatId 恒同端口(「同项目固定复用一个端口」的机制兑现)', () => {
  const a = preferredPort('oc_abc', RANGE)
  for (let i = 0; i < 20; i++) assert.equal(preferredPort('oc_abc', RANGE), a)
})

test('preferredPort:恒落在段内(含单端口段)', () => {
  for (const id of ['oc_1', 'oc_2', 'x', '', '很长的中文群id'.repeat(9)]) {
    const p = preferredPort(id, RANGE)
    assert.ok(p >= 4610 && p <= 4629, `${id} → ${p}`)
  }
  assert.equal(preferredPort('oc_any', { from: 4610, to: 4610 }), 4610)
})

test('preferredPort:不同 chatId 散得开(20 端口段里 40 个群至少占到 10 个不同端口)', () => {
  const seen = new Set()
  for (let i = 0; i < 40; i++) seen.add(preferredPort('oc_group_' + i, RANGE))
  assert.ok(seen.size >= 10, '实际 ' + seen.size)
})

test('portCandidates:首选端口起环形扫全段,不重不漏', () => {
  const c = portCandidates('oc_abc', RANGE)
  assert.equal(c.length, 20)
  assert.equal(c[0], preferredPort('oc_abc', RANGE))
  assert.equal(new Set(c).size, 20)
  assert.deepEqual([...c].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => 4610 + i))
})

test('portCandidates:--port 显式 ⇒ 候选只有它(占用就报人话,不悄悄换端口)', () => {
  assert.deepEqual(portCandidates('oc_abc', { ...RANGE, only: 4615 }), [4615])
})

test('normalizeOptions:缺省给默认;非法值回默认(fail-safe);idleMin:0 = 不按闲置回收', () => {
  const d = normalizeOptions(undefined)
  assert.equal(d.from, 4610); assert.equal(d.to, 4629)
  assert.equal(d.idleMin, 30); assert.equal(d.idleMs, 30 * 60_000)
  assert.equal(d.maxMs, 8 * 3_600_000); assert.equal(d.host, '0.0.0.0')
  assert.equal(normalizeOptions({ portFrom: 'abc' }).from, 4610)
  assert.equal(normalizeOptions({ portFrom: 99999 }).from, 4610)
  assert.equal(normalizeOptions({ idleMin: 0 }).idleMs, 0)
  assert.equal(normalizeOptions({ maxHours: 0 }).maxMs, 0)
  assert.equal(normalizeOptions({ host: '127.0.0.1' }).host, '127.0.0.1')
})

// ── denylist(段级:任何层级的 .git / node_modules / 密钥都挡)────────────────

test('isDeniedSegment:点文件/点目录一律拒(.git/.env/.ssh 都被这一条覆盖)', () => {
  for (const s of ['.git', '.env', '.env.local', '.ssh', '.DS_Store', '.claude']) assert.equal(isDeniedSegment(s), true, s)
})

test('isDeniedSegment:node_modules / 密钥扩展名 / sbot.config*.json / 私钥文件名', () => {
  for (const s of ['node_modules', 'NODE_MODULES', 'server.pem', 'a.key', 'x.p12', 'sbot.config.json', 'sbot.config.local.json', 'id_rsa', 'id_ed25519']) {
    assert.equal(isDeniedSegment(s), true, s)
  }
})

test('isDeniedSegment:正常原型资源放行(拍板 B:denylist 起步,不用扩展名白名单)', () => {
  for (const s of ['index.html', 'app.js', 'style.css', 'logo.svg', 'f.woff2', 'demo.wasm', 'data.json', 'clip.mp4', 'noext']) {
    assert.equal(isDeniedSegment(s), false, s)
  }
})

test('isDenied:任何一层命中即拒', () => {
  assert.equal(isDenied('assets/img/logo.svg'), false)
  assert.equal(isDenied('assets/node_modules/x.js'), true)
  assert.equal(isDenied('a/.git/config'), true)
})

// ── resolveServeTarget(围栏五条)──────────────────────────────────────────────

function proto() {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'design', 'prototype'), { recursive: true })
  fs.writeFileSync(path.join(root, 'design', 'prototype', 'index.html'), '<h1>hi</h1>')
  fs.writeFileSync(path.join(root, 'design', 'prototype', 'app.js'), 'console.log(1)')
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>root</h1>')
  return root
}

test('resolveServeTarget:给单文件 ⇒ serveRoot=父目录,entry=文件名', () => {
  const root = proto()
  const t = resolveServeTarget({ cwd: root, rel: 'design/prototype/index.html' })
  assert.equal(t.entry, 'index.html')
  assert.equal(t.serveRoot, fs.realpathSync(path.join(root, 'design', 'prototype')))
  assert.equal(t.projectRoot, false)
})

test('resolveServeTarget:给目录 ⇒ entry=index.html', () => {
  const root = proto()
  const t = resolveServeTarget({ cwd: root, rel: 'design/prototype' })
  assert.equal(t.entry, 'index.html')
  assert.equal(t.serveRoot, fs.realpathSync(path.join(root, 'design', 'prototype')))
})

test('resolveServeTarget:目录里没有 index.html ⇒ 报人话(不做目录列表、不猜首页)', () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, 'sub', 'page.html'), 'x')
  assert.throws(() => resolveServeTarget({ cwd: root, rel: 'sub' }), /index\.html/)
})

test('resolveServeTarget:默认拒绝项目根(v0.8.1 事故:整个项目目录被暴露一周)', () => {
  const root = proto()
  assert.throws(() => resolveServeTarget({ cwd: root, rel: '.' }), /整个项目目录/)
  assert.throws(() => resolveServeTarget({ cwd: root, rel: 'index.html' }), /整个项目目录/)
})

test('resolveServeTarget:--project-root 显式才放行,并如实标 projectRoot(供 bin 发群告知)', () => {
  const root = proto()
  const t = resolveServeTarget({ cwd: root, rel: 'index.html', projectRoot: true })
  assert.equal(t.projectRoot, true)
  assert.equal(t.serveRoot, fs.realpathSync(root))
})

test('resolveServeTarget:绝对路径 / .. / 越界一律拒(镜像 resolveSendPath)', () => {
  const root = proto()
  assert.throws(() => resolveServeTarget({ cwd: root, rel: '/etc/passwd' }), /绝对路径/)
  assert.throws(() => resolveServeTarget({ cwd: root, rel: '../x/index.html' }), /\.\./)
  assert.throws(() => resolveServeTarget({ cwd: root, rel: 'nope/index.html' }), /不存在/)
})

test('resolveServeTarget:软链逃逸被拒 —— resolveSendPath 不解析软链,这是本模块多出的那一层', (t) => {
  const root = proto()
  const outside = tmp()
  fs.writeFileSync(path.join(outside, 'secret.html'), 'secret')
  // ⚠ 建不了软链时必须**显式 skip**,不能 return —— 静默通过会让绿色结果分不出「围栏验过」和「没跑」
  try { fs.symlinkSync(outside, path.join(root, 'design', 'linked'), 'dir') } catch { return t.skip('无符号链接权限') }
  assert.throws(() => resolveServeTarget({ cwd: root, rel: 'design/linked' }), /符号链接/)
})

test('resolveServeTarget:workdir 自身带软链不误判越界(两边都 realpath 后再比)', (ctx) => {
  const real = proto()
  const link = path.join(tmp(), 'proj')
  try { fs.symlinkSync(real, link, 'dir') } catch { return ctx.skip('无符号链接权限') }
  const got = resolveServeTarget({ cwd: link, rel: 'design/prototype/index.html' })
  assert.equal(got.serveRoot, fs.realpathSync(path.join(real, 'design', 'prototype')))
})

// ⚠ 回归:此前只查 entry 的 basename ⇒ `start .private/proto` 能把点目录下整棵子树挂上局域网,
// 而文档承诺 denylist「无论在哪一层」。isDenied 那时写了、导出了、只有单测在用 —— 生产路径一次没调
// (典型的假覆盖:测试看着像覆盖了受理侧的多层围栏,实际没有)。
test('resolveServeTarget:路径中间层命中 denylist 也拒(不只看 entry 文件名)', () => {
  const root = tmp()
  for (const mid of ['.private', 'node_modules']) {
    fs.mkdirSync(path.join(root, mid, 'proto'), { recursive: true })
    fs.writeFileSync(path.join(root, mid, 'proto', 'index.html'), '<h1>x</h1>')
    assert.throws(() => resolveServeTarget({ cwd: root, rel: `${mid}/proto` }), /不在可服务范围/, mid)
    assert.throws(() => resolveServeTarget({ cwd: root, rel: `${mid}/proto/index.html` }), /不在可服务范围/, mid + ' 文件形态')
  }
})

test('resolveServeTarget:正常子目录不受整串围栏影响(别把好路径也挡了)', () => {
  const root = proto()
  const t = resolveServeTarget({ cwd: root, rel: 'design/prototype' })
  assert.equal(t.entry, 'index.html')
})

test('resolveServeTarget:点文件/密钥当 entry 也拒', () => {
  const root = tmp()
  fs.mkdirSync(path.join(root, 'sub'))
  fs.writeFileSync(path.join(root, 'sub', '.env'), 'SECRET=1')
  assert.throws(() => resolveServeTarget({ cwd: root, rel: 'sub/.env' }), /不在可服务范围/)
})

// ── single(文件形态只服务那一个文件)────────────────────────────────────────
// ⚠ 真机由来(2026-07-30 反向诱导测试):agent 把原型放 design/ 下、传的是文件 ⇒ 整个 design 目录
// (20 个文件:board-history.jsonl、diagrams 全部源码、十几张历史图)都上了局域网,而它对用户说的是
// 「仅暴露 design 目录中的原型文件」—— 不只是暴露面问题,是**让 agent 对用户说了假话**。

test('resolveServeTarget:文件形态 ⇒ single=true;目录形态 ⇒ single=false', () => {
  const root = proto()
  assert.equal(resolveServeTarget({ cwd: root, rel: 'design/prototype/index.html' }).single, true)
  assert.equal(resolveServeTarget({ cwd: root, rel: 'design/prototype' }).single, false)
})

test('resolveRequestPath:single 模式下只有 entry 可取,兄弟文件 404', () => {
  const { serveRoot, token } = served()
  const ok = resolveRequestPath({ serveRoot, token, urlPath: `/${token}/index.html`, entry: 'index.html', single: true })
  assert.equal(ok.ok, true)
  const sib = resolveRequestPath({ serveRoot, token, urlPath: `/${token}/app.js`, entry: 'index.html', single: true })
  assert.equal(sib.ok, false)
  assert.equal(sib.reason, 'not-entry')
  // 裸访问 /<token> 仍给 entry(首页照常打开)
  assert.equal(resolveRequestPath({ serveRoot, token, urlPath: `/${token}`, entry: 'index.html', single: true }).ok, true)
})

test('resolveRequestPath:目录形态(single=false)兄弟文件照常可取(带 assets 的原型不受影响)', () => {
  const { serveRoot, token } = served()
  assert.equal(resolveRequestPath({ serveRoot, token, urlPath: `/${token}/app.js`, entry: 'index.html', single: false }).ok, true)
})

// ⚠ 这里曾经写错过一条断言:以为「记录把 single 改成 false」该被拒。其实目录形态是**合法可选**的
// (agent 直接 start <目录> 就能拿整个目录),改 single 拿不到本来拿不到的东西 ⇒ single 不是安全边界,
// 是最小暴露的默认值。真正要钉的是「两种形态都必须能通过复核,且各自自洽」。
test('verifyRecordFence:文件形态与目录形态都必须通过(退回「一律拼 serveRoot+entry」会让目录预览全挂)', () => {
  const root = proto()
  const dir = fs.realpathSync(path.join(root, 'design', 'prototype'))
  assert.equal(verifyRecordFence({ workdir: root, serveRoot: dir, entry: 'index.html', single: true }).single, true)
  assert.equal(verifyRecordFence({ workdir: root, serveRoot: dir, entry: 'index.html', single: false }).single, false)
})

test('verifyRecordFence:形态必须自洽 —— 文件形态的 entry 不存在 / 目录形态缺 index.html 都拒', () => {
  const root = proto()
  const dir = fs.realpathSync(path.join(root, 'design', 'prototype'))
  assert.throws(() => verifyRecordFence({ workdir: root, serveRoot: dir, entry: 'nope.html', single: true }), /不存在/)
  const bare = path.join(root, 'bare'); fs.mkdirSync(bare); fs.writeFileSync(path.join(bare, 'x.html'), 'x')
  assert.throws(() => verifyRecordFence({ workdir: root, serveRoot: fs.realpathSync(bare), entry: 'index.html', single: false }), /index\.html/)
})

// ── 按群覆盖(operator 的正规入口)──────────────────────────────────────────
// 真机由来:群里要求「随时都能打开」,agent 自造配置用 --config 把回收全关。禁掉那条通道之后,
// 「长期开放」必须有正规入口 —— 否则合理需求无法满足,它还会再找别的绕法。

test('normalizeOptions:按群覆盖优先于顶层,未覆盖的项沿用顶层/默认', () => {
  const o = normalizeOptions({ idleMin: 20, maxHours: 4, host: '127.0.0.1' }, { idleMin: 0, maxHours: 0 })
  assert.equal(o.idleMs, 0); assert.equal(o.maxMs, 0)
  assert.equal(o.host, '127.0.0.1')       // 群没覆盖 host ⇒ 沿用顶层
  assert.equal(o.from, 4610)              // 端口段也沿用默认
})

test('normalizeOptions:没有按群覆盖时行为与从前完全一致(零回归)', () => {
  const a = normalizeOptions({ idleMin: 20 })
  const b = normalizeOptions({ idleMin: 20 }, undefined)
  const c = normalizeOptions({ idleMin: 20 }, null)
  assert.deepEqual(a, b); assert.deepEqual(a, c)
})

// ── 回收策略必须逐项如实(agent 照着 stdout 对用户说话)────────────────────
test('buildStartedText:idleMin=0 但时长上限仍在 ⇒ 必须明说会在 N 小时后停', () => {
  const t = buildStartedText(rec(), 'http://x/y', { idleMin: 0, maxHours: 8 })
  assert.match(t, /仍会在运行满 8 小时后自动停止/)
  assert.doesNotMatch(t, /不会自动停止/)
})

test('buildStartedText:两个上限都关 ⇒ 明说不会自动停、必须手动 stop(别谎报有兜底)', () => {
  const t = buildStartedText(rec(), 'http://x/y', { idleMin: 0, maxHours: 0 })
  assert.match(t, /不会自动停止/)
  assert.match(t, /用完必须自己停掉/) // 断言的是「要它自己动手」这层意思,不绑死具体命令措辞
  assert.match(t, /别把它一直挂在局域网上/)
})

test('buildStartedText:有闲置回收时也把时长上限一并说清', () => {
  const t = buildStartedText(rec(), 'http://x/y', { idleMin: 30, maxHours: 8 })
  assert.match(t, /闲置 30 分钟后自动停止/)
  assert.match(t, /最长运行 8 小时/)
})

// ── verifyRecordFence(worker 侧记录复核)─────────────────────────────────────
// ⚠ 这一组钉住的是一个**实测过的真洞**:`--_worker` 名义内部,但 BASE_SKILL_ALLOWS 放行了
// `Bash(sbot preview *)` ⇒ agent 够得着,而 worker 原本对记录内容一字不校验。自造
// `{serveRoot:"$HOME", projectRoot:true}` 喂进去,整个家目录就上了局域网(实测 200)。

test('verifyRecordFence:正常记录通过', () => {
  const root = proto()
  const serveRoot = fs.realpathSync(path.join(root, 'design', 'prototype'))
  const t = verifyRecordFence({ workdir: root, serveRoot, entry: 'index.html', single: true })
  assert.equal(t.serveRoot, serveRoot)
  assert.equal(t.entry, 'index.html')
  assert.equal(t.single, true)
})

// ⚠ 误杀回归:锚点来自 operator 手写的配置,可能走软链;serveRoot 是 realpath 过的。
// 不先 realpath 锚点,path.relative 会吐 `../../..` 把**合法**预览也拒掉(实现时被这条抓到)。
test('verifyRecordFence:锚点走软链时合法记录仍通过(不误杀)', (ctx) => {
  const real = proto()
  const link = path.join(tmp(), 'proj')
  try { fs.symlinkSync(real, link, 'dir') } catch { return ctx.skip('无符号链接权限') }
  const serveRoot = fs.realpathSync(path.join(real, 'design', 'prototype'))
  const t = verifyRecordFence({ workdir: link, serveRoot, entry: 'index.html', single: true }, { anchorWorkdir: link })
  assert.equal(t.serveRoot, serveRoot)
})

test('verifyRecordFence:serveRoot 在锚点之外 ⇒ 拒(伪造记录挂任意目录的主路径)', () => {
  const root = proto()
  const outside = proto() // 另一个项目目录,自带 index.html
  assert.throws(() => verifyRecordFence({ workdir: root, serveRoot: fs.realpathSync(outside), entry: 'index.html', single: true }), /超出项目目录|不得包含/)
})

test('verifyRecordFence:锚点优先用 anchorWorkdir，记录自称的 workdir 不作数(它同样可写)', () => {
  const root = proto()
  const evil = proto()
  // 伪造记录:workdir 自称 evil、serveRoot 指向 evil 里的子目录 ⇒ **只看记录完全自洽**
  const evilServe = fs.realpathSync(path.join(evil, 'design', 'prototype'))
  const forged = { workdir: evil, serveRoot: evilServe, entry: 'index.html', single: true }
  // 反面:不给锚点(只信记录)就会通过 —— 这正是锚点必须来自 operator 配置的理由
  assert.equal(verifyRecordFence(forged).serveRoot, evilServe)
  // 正面:锚点是真正的群 workdir ⇒ 拒
  assert.throws(() => verifyRecordFence(forged, { anchorWorkdir: root }), /超出项目目录|不得包含/)
})

test('verifyRecordFence:伪造 projectRoot 也不能挂锚点之外的目录', () => {
  const root = proto()
  const evil = proto()
  assert.throws(() => verifyRecordFence({ workdir: root, serveRoot: fs.realpathSync(evil), entry: 'index.html', projectRoot: true, single: true }, { anchorWorkdir: root }), /超出项目目录|不得包含/)
})

test('verifyRecordFence:整串 denylist 同样复核(点目录/node_modules)', () => {
  const root = tmp()
  for (const mid of ['.private', 'node_modules']) {
    fs.mkdirSync(path.join(root, mid, 'proto'), { recursive: true })
    fs.writeFileSync(path.join(root, mid, 'proto', 'index.html'), 'x')
    const serveRoot = fs.realpathSync(path.join(root, mid, 'proto'))
    assert.throws(() => verifyRecordFence({ workdir: root, serveRoot, entry: 'index.html', single: true }), /不在可服务范围/, mid)
  }
})

test('verifyRecordFence:未标 projectRoot 却把 serveRoot 指到项目根 ⇒ 拒', () => {
  const root = proto()
  assert.throws(() => verifyRecordFence({ workdir: root, serveRoot: fs.realpathSync(root), entry: 'index.html', single: true }), /整个项目目录/)
})

test('verifyRecordFence:缺字段 / 缺锚点都拒,不放行', () => {
  assert.throws(() => verifyRecordFence(null), /缺 serveRoot/)
  assert.throws(() => verifyRecordFence({ serveRoot: '/x' }), /缺 serveRoot\/entry/)
  assert.throws(() => verifyRecordFence({ serveRoot: '/x', entry: 'i.html' }), /缺 workdir 锚点/)
})

// ── resolveRequestPath(worker 热路径)───────────────────────────────────────

function served() {
  const root = proto()
  const serveRoot = fs.realpathSync(path.join(root, 'design', 'prototype'))
  return { root, serveRoot, token: 'ab12cd34ef' }
}

test('resolveRequestPath:token 正确 ⇒ 命中文件', () => {
  const { serveRoot, token } = served()
  const r = resolveRequestPath({ serveRoot, token, urlPath: `/${token}/app.js` })
  assert.equal(r.ok, true)
  assert.equal(r.abs, path.join(serveRoot, 'app.js'))
})

test('resolveRequestPath:裸访问 /<token> 与 /<token>/ 都给 entry(首页)', () => {
  const { serveRoot, token } = served()
  for (const u of [`/${token}`, `/${token}/`]) {
    const r = resolveRequestPath({ serveRoot, token, urlPath: u, entry: 'index.html' })
    assert.equal(r.ok, true, u)
    assert.equal(r.abs, path.join(serveRoot, 'index.html'))
  }
})

test('resolveRequestPath:token 不符 / 缺失 ⇒ 404(局域网扫到端口也拿不到内容)', () => {
  const { serveRoot, token } = served()
  for (const u of ['/', '/index.html', '/wrongtoken/index.html']) {
    const r = resolveRequestPath({ serveRoot, token, urlPath: u })
    assert.equal(r.ok, false, u)
    assert.equal(r.code, 404)
  }
})

test('resolveRequestPath:query/fragment 不影响命中', () => {
  const { serveRoot, token } = served()
  assert.equal(resolveRequestPath({ serveRoot, token, urlPath: `/${token}/app.js?v=2` }).ok, true)
  assert.equal(resolveRequestPath({ serveRoot, token, urlPath: `/${token}/app.js#top` }).ok, true)
})

test('resolveRequestPath:编码穿越(..%2f / %2e%2e)拒 —— 解码后才过段级围栏', () => {
  const { serveRoot, token } = served()
  for (const u of [`/${token}/..%2f..%2fetc%2fpasswd`, `/${token}/%2e%2e/%2e%2e/x`, `/${token}/../../etc/passwd`]) {
    const r = resolveRequestPath({ serveRoot, token, urlPath: u })
    assert.equal(r.ok, false, u)
  }
})

// 这条走的是**另一道**防线:`%2f` 解码出的段是 `/etc/passwd` —— 不含 `..`、不是点文件、扩展名也不在
// denylist 里,段级围栏**放它过**;真正挡住它的是 path.resolve 后的容器判定(绝对路径会覆盖 base)。
test('resolveRequestPath:编码出的绝对路径覆盖(%2f…)被容器判定挡住,不是靠 denylist', () => {
  const { serveRoot, token } = served()
  assert.equal(isDeniedSegment('/etc/passwd'), false, '前提:段级围栏确实放它过')
  const r = resolveRequestPath({ serveRoot, token, urlPath: `/${token}/%2fetc%2fpasswd` })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'escape')
})

test('resolveRequestPath:null 字节 / 反斜杠穿越都拒(不同分支,都不许炸)', () => {
  const { serveRoot, token } = served()
  assert.equal(resolveRequestPath({ serveRoot, token, urlPath: `/${token}/x%00.html` }).ok, false)
  assert.equal(resolveRequestPath({ serveRoot, token, urlPath: `/${token}/..%5c..%5cetc` }).ok, false)
})

test('resolveRequestPath:坏编码 ⇒ 400 不炸', () => {
  const { serveRoot, token } = served()
  assert.equal(resolveRequestPath({ serveRoot, token, urlPath: `/${token}/%E0%A4%A` }).code, 400)
})

test('resolveRequestPath:目录 ⇒ 404(无目录列表)', () => {
  const { root, token } = served()
  const serveRoot = fs.realpathSync(path.join(root, 'design'))
  const r = resolveRequestPath({ serveRoot, token, urlPath: `/${token}/prototype` })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'directory')
})

test('resolveRequestPath:serveRoot 内的软链指向外部 ⇒ 404', (t) => {
  const { root, serveRoot, token } = served()
  const outside = tmp()
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
  try { fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'design', 'prototype', 'leak.txt'), 'file') } catch { return t.skip('无符号链接权限') }
  const r = resolveRequestPath({ serveRoot, token, urlPath: `/${token}/leak.txt` })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'symlink-escape')
})

test('resolveRequestPath:点文件 / 密钥 / node_modules 一律 404,即使真实存在', () => {
  const { root, serveRoot, token } = served()
  fs.writeFileSync(path.join(root, 'design', 'prototype', '.env'), 'SECRET=1')
  fs.mkdirSync(path.join(root, 'design', 'prototype', 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(root, 'design', 'prototype', 'node_modules', 'x.js'), '1')
  fs.writeFileSync(path.join(root, 'design', 'prototype', 'server.key'), 'k')
  for (const u of ['.env', 'node_modules/x.js', 'server.key']) {
    const r = resolveRequestPath({ serveRoot, token, urlPath: `/${token}/${u}` })
    assert.equal(r.ok, false, u)
    assert.equal(r.reason, 'denied', u)
  }
})

test('resolveRequestPath:不存在的文件 ⇒ 404', () => {
  const { serveRoot, token } = served()
  assert.equal(resolveRequestPath({ serveRoot, token, urlPath: `/${token}/nope.html` }).ok, false)
})

// ── URL ──────────────────────────────────────────────────────────────────────

test('buildUrl:token 作路径前缀(让页面里的相对资源引用照常工作)', () => {
  const rec = { port: 4612, token: 'abc123', entry: 'index.html', host: '0.0.0.0' }
  assert.equal(buildUrl(rec, '192.168.1.75'), 'http://192.168.1.75:4612/abc123/index.html')
})

test('buildUrl:没给 LAN 地址时退 127.0.0.1(绑定地址是 0.0.0.0 时不能拿它当可点链接)', () => {
  assert.equal(buildUrl({ port: 4612, token: 'abc', entry: 'i.html', host: '0.0.0.0' }), 'http://127.0.0.1:4612/abc/i.html')
  assert.equal(buildUrl({ port: 4612, token: 'abc', entry: 'i.html', host: '127.0.0.1' }), 'http://127.0.0.1:4612/abc/i.html')
})

// ── hostForUrl / displayRoot(CLI·doctor·控制台三处共用,此前是三份内联复制)──────

test('hostForUrl:环回绑定恒 127.0.0.1(不能拿 LAN IP 拼出一个打不开的链接)', () => {
  for (const h of ['127.0.0.1', 'localhost', '::1', 'LOCALHOST']) {
    assert.equal(preview.hostForUrl({ host: h }, ['192.168.1.76']), '127.0.0.1', h)
  }
})

test('hostForUrl:绑 0.0.0.0 取本机第一个 LAN IP;无网卡退 127.0.0.1', () => {
  assert.equal(preview.hostForUrl({ host: '0.0.0.0' }, ['192.168.1.76', '10.0.0.2']), '192.168.1.76')
  assert.equal(preview.hostForUrl({ host: '0.0.0.0' }, []), '127.0.0.1')
  assert.equal(preview.hostForUrl({ host: '0.0.0.0' }), '127.0.0.1')
})

test('displayRoot:项目内给相对路径,项目根给 `.`', () => {
  const noRp = { realpathSync: (p) => p }
  assert.equal(preview.displayRoot({ workdir: '/a/proj', serveRoot: '/a/proj/design/prototype' }, noRp), 'design/prototype')
  assert.equal(preview.displayRoot({ workdir: '/a/proj', serveRoot: '/a/proj' }, noRp), '.')
})

test('displayRoot:前缀比对带分隔符守卫(/a/proj 不得把 /a/project-x 当自己的子目录)', () => {
  const noRp = { realpathSync: (p) => p }
  assert.equal(preview.displayRoot({ workdir: '/a/proj', serveRoot: '/a/project-x/sub' }, noRp), '/a/project-x/sub')
})

test('displayRoot:workdir 带软链时经 realpath 仍给相对路径(serveRoot 是 realpath 过的)', () => {
  const rec = { workdir: '/link/proj', serveRoot: '/real/proj/design' }
  assert.equal(preview.displayRoot(rec, { realpathSync: (p) => (p === '/link/proj' ? '/real/proj' : p) }), 'design')
})

test('displayRoot:realpath 抛错 / 字段缺失都不炸', () => {
  assert.equal(preview.displayRoot({ workdir: '/a', serveRoot: '/b/c' }, { realpathSync: () => { throw new Error('ENOENT') } }), '/b/c')
  assert.equal(preview.displayRoot({}), '')
  assert.equal(preview.displayRoot({ serveRoot: '/x' }), '/x')
})

test('displayServed:single ⇒ 显示到文件;目录形态 ⇒ 显示到目录(只显示 serveRoot 会让单文件模式看着像在服务整个目录)', () => {
  const noRp = { realpathSync: (p) => p }
  const base = { workdir: '/a/proj', serveRoot: '/a/proj/design' }
  assert.equal(preview.displayServed({ ...base, entry: 'x.html', single: true }, noRp), 'design/x.html')
  assert.equal(preview.displayServed({ ...base, entry: 'index.html', single: false }, noRp), 'design')
  // 项目根 + 单文件
  assert.equal(preview.displayServed({ workdir: '/a/proj', serveRoot: '/a/proj', entry: 'i.html', single: true }, noRp), 'i.html')
})

test('buildStatusLines:常驻(两个上限都关)必须明说不会自动停', () => {
  const l = buildStatusLines([rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0, idleMs: 0, maxMs: 0 })], { now: T0 + 60_000, isAlive: () => true })
  assert.match(l[0], /⚠ 常驻\(不会自动停\)/)
})

test('buildStatusLines:只关闲置时报时长上限(别让 operator 以为完全不回收)', () => {
  const l = buildStatusLines([rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0, idleMs: 0, maxMs: 8 * 3_600_000 })], { now: T0 + 60_000, isAlive: () => true })
  assert.match(l[0], /最长运行 8 小时/)
})

// ── 记录族 ───────────────────────────────────────────────────────────────────

const rec = (over = {}) => ({ ...newRecord({ chatId: 'oc_1', workdir: '/w', serveRoot: '/w/p', entry: 'index.html', label: 'L', port: 4612, host: '0.0.0.0', idleMs: 30 * 60_000, maxMs: 8 * 3_600_000 }), ...over })

test('newRecord:id 与 token 各自随机、互不相同(token 是能力凭据不能等于 id)', () => {
  const a = newRecord({ chatId: 'oc_1' }); const b = newRecord({ chatId: 'oc_1' })
  assert.notEqual(a.id, b.id)
  assert.notEqual(a.token, b.token)
  assert.match(a.token, /^[0-9a-f]{10}$/)
  assert.equal(a.status, 'starting')
})

test('listRecords:跳过损坏条目与非记录文件,按 startedAt 升序', () => {
  const dir = tmp()
  writeRecord(dir, rec({ id: 'aaaaaaaaaa', startedAt: 200 }))
  writeRecord(dir, rec({ id: 'bbbbbbbbbb', startedAt: 100 }))
  fs.writeFileSync(path.join(dir, 'cccccccccc.json'), '{ 坏 json')
  fs.writeFileSync(path.join(dir, 'abc.log'), 'log')
  const got = listRecords(dir)
  assert.deepEqual(got.map((r) => r.id), ['bbbbbbbbbb', 'aaaaaaaaaa'])
})

test('listRecords:目录不存在 ⇒ 空数组不抛', () => {
  assert.deepEqual(listRecords(path.join(tmp(), 'nope')), [])
})

test('isLive:starting 也算活(防受理竞态起两个);pid 死则不活;stopped 不活', () => {
  assert.equal(isLive(rec({ status: 'starting', pid: null })), true)
  assert.equal(isLive(rec({ status: 'running', pid: 42 }), { isAlive: () => true }), true)
  assert.equal(isLive(rec({ status: 'running', pid: 42 }), { isAlive: () => false }), false)
  assert.equal(isLive(rec({ status: 'stopped', pid: 42 }), { isAlive: () => true }), false)
})

test('findLive:只认本群、多条残留取最新', () => {
  const dir = tmp()
  writeRecord(dir, rec({ id: 'aaaaaaaaaa', chatId: 'oc_1', startedAt: 100, status: 'running', pid: 1 }))
  writeRecord(dir, rec({ id: 'bbbbbbbbbb', chatId: 'oc_1', startedAt: 300, status: 'running', pid: 2 }))
  writeRecord(dir, rec({ id: 'cccccccccc', chatId: 'oc_2', startedAt: 400, status: 'running', pid: 3 }))
  writeRecord(dir, rec({ id: 'dddddddddd', chatId: 'oc_1', startedAt: 500, status: 'stopped' }))
  const hit = findLive(dir, 'oc_1', { isAlive: () => true })
  assert.equal(hit.id, 'bbbbbbbbbb')
  assert.equal(findLive(dir, 'oc_none', { isAlive: () => true }), null)
})

test('markStopped:写 reason + notifyPending(「谁杀谁写」的落点)', () => {
  const dir = tmp()
  const r = writeRecord(dir, rec({ status: 'running', pid: 9 }))
  const s = markStopped(dir, r, 'idle', { notify: true })
  assert.equal(s.status, 'stopped')
  assert.equal(s.stoppedReason, 'idle')
  assert.equal(s.notifyPending, true)
  assert.equal(JSON.parse(fs.readFileSync(recordFile(dir, r.id), 'utf8')).stoppedReason, 'idle')
})

test('pruneRecords:只删多余的已停条目,活的一概不动', () => {
  const dir = tmp()
  for (let i = 0; i < 25; i++) writeRecord(dir, rec({ id: String(i).padStart(10, '0'), status: 'stopped', startedAt: i }))
  writeRecord(dir, rec({ id: 'ffffffffff', status: 'running', pid: 7, startedAt: 999 }))
  const dropped = pruneRecords(dir, { keep: 20, isAlive: () => true })
  assert.equal(dropped, 5)
  const left = listRecords(dir)
  assert.equal(left.length, 21)
  assert.ok(left.some((r) => r.id === 'ffffffffff'))
})

test('pruneRecords:连带删 worker 的 .log(只删记录会留一堆日志)', () => {
  const dir = tmp()
  for (let i = 0; i < 22; i++) {
    const r = writeRecord(dir, rec({ id: String(i).padStart(10, '0'), status: 'stopped', startedAt: i }))
    fs.writeFileSync(path.join(dir, r.id + '.log'), 'log')
  }
  pruneRecords(dir, { keep: 20, isAlive: () => true })
  assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.log')).length, 20)
})

// ── reapDecision ─────────────────────────────────────────────────────────────

const T0 = 1_000_000_000_000

test('reapDecision:健康且刚被访问 ⇒ null(不动它)', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0 + 1000 })
  assert.equal(reapDecision(r, { now: T0 + 60_000, isAlive: () => true }), null)
})

test('reapDecision:闲置超过 idleMs ⇒ idle + 要通知', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0 })
  const d = reapDecision(r, { now: T0 + 31 * 60_000, isAlive: () => true })
  assert.deepEqual(d, { reason: 'idle', notify: true })
})

test('reapDecision:从未被访问也按 startedAt 起算闲置(没人点开的预览同样要回收)', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: null })
  assert.equal(reapDecision(r, { now: T0 + 31 * 60_000, isAlive: () => true }).reason, 'idle')
})

test('reapDecision:idleMs=0 ⇒ 不按闲置回收,但 maxMs 仍到点即收', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0, idleMs: 0 })
  assert.equal(reapDecision(r, { now: T0 + 5 * 3_600_000, isAlive: () => true }), null)
  assert.equal(reapDecision(r, { now: T0 + 9 * 3_600_000, isAlive: () => true }).reason, 'max')
})

test('reapDecision:maxMs=0 ⇒ 无总时长顶(仍受闲置管)', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0 + 100 * 3_600_000, maxMs: 0 })
  assert.equal(reapDecision(r, { now: T0 + 100 * 3_600_000, isAlive: () => true }), null)
})

test('reapDecision:进程已死 ⇒ dead(且要通知 —— 链接打不开了该说一声)', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0 })
  assert.deepEqual(reapDecision(r, { now: T0 + 1000, isAlive: () => false }), { reason: 'dead', notify: true })
})

test('reapDecision:dead 判定优先于 idle/max(先看死没死,其余才有意义)', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0 })
  assert.equal(reapDecision(r, { now: T0 + 99 * 3_600_000, isAlive: () => false }).reason, 'dead')
})

test('reapDecision:starting 卡 60s 以上按 dead 收(worker 没起来,别永久占着本群那一个)', () => {
  const r = rec({ status: 'starting', pid: null, startedAt: T0 })
  assert.equal(reapDecision(r, { now: T0 + 30_000 }), null)
  const d = reapDecision(r, { now: T0 + 61_000 })
  assert.equal(d.reason, 'dead')
  assert.equal(d.notify, false) // 起都没起来过,群里没人拿到过链接
})

// 「暂停 = 群里安静」是既有口径(cron 到点跳过、画布轮询跳过)⇒ 暂停触发的回收**不发消息**
test('reapDecision:群暂停 ⇒ paused 且不通知(暂停即安静);群已解绑 ⇒ unbound 也不通知(群都没了)', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0 })
  assert.deepEqual(reapDecision(r, { now: T0 + 1000, paused: true, isAlive: () => true }), { reason: 'paused', notify: false })
  assert.deepEqual(reapDecision(r, { now: T0 + 1000, bound: false, isAlive: () => true }), { reason: 'unbound', notify: false })
})

test('reaper:群暂停时待发的通知被清掉而不是攒着(恢复瞬间不倒出一堆陈旧消息)', async () => {
  const f = reaperFixture([rec({ id: 'aaaaaaaaaa', status: 'stopped', stoppedReason: 'idle', notifyPending: true })], { paused: true })
  f.reaper.tick()
  await new Promise((r) => setImmediate(r))
  assert.equal(f.notes.length, 0)
  assert.equal(listRecords(f.dir)[0].notifyPending, false)
})

test('reapDecision:已 stopped/fail 的记录 ⇒ null(不重复收割)', () => {
  assert.equal(reapDecision(rec({ status: 'stopped' }), { now: T0 }), null)
  assert.equal(reapDecision(rec({ status: 'fail' }), { now: T0 }), null)
  assert.equal(reapDecision(null, { now: T0 }), null)
})

// ⚠ 回归(真机 2026-07-31):operator 在控制台勾了「常驻」、群里也收到「已设为常驻」,预览却照样
// 按闲置 30 分钟停了 —— idleMs/maxMs 是 start 那一刻快照进记录的,改配置没人回头改它。同一个
// 判定函数里 paused 一直是现读配置的,漏的就是这一半。policy = 把配置带进来。
test('reapDecision:policy 覆盖记录快照 —— 勾「常驻」对已在跑的预览立刻生效', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0 }) // 记录里还是 30 分钟
  const at = { now: T0 + 31 * 60_000, isAlive: () => true }
  assert.equal(reapDecision(r, at).reason, 'idle', '不给 policy = 旧行为(按记录快照)')
  assert.equal(reapDecision(r, { ...at, policy: { idleMs: 0, maxMs: 0 } }), null, '常驻配置下不该被收')
})

test('reapDecision:policy 反向同样生效 —— 取消常驻后,记录里 idleMs=0 的老预览重新受管', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0, idleMs: 0, maxMs: 0 })
  const at = { now: T0 + 31 * 60_000, isAlive: () => true }
  assert.equal(reapDecision(r, at), null)
  assert.equal(reapDecision(r, { ...at, policy: { idleMs: 30 * 60_000, maxMs: 0 } }).reason, 'idle')
})

// fail-safe 的方向:坏配置要倒向「会停」,不能倒向「永不回收」—— 后者会把一个目录永久挂在
// 局域网上,正是这套机制存在的理由。(同类教训见 memory:一个「好心」的 try/catch 把
// host:127.0.0.1 静默变成绑 0.0.0.0。)
test('reapDecision:policy 字段写坏 ⇒ 退回记录快照,绝不当成 0(0 的语义是永不回收)', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0 })
  const at = { now: T0 + 31 * 60_000, isAlive: () => true }
  for (const bad of [{}, { idleMs: null }, { idleMs: undefined }, { idleMs: NaN }, { idleMs: 'x' }, { idleMs: Infinity }]) {
    assert.equal(reapDecision(r, { ...at, policy: bad }).reason, 'idle', `坏 policy ${JSON.stringify(bad)} 不该变成常驻`)
  }
  assert.equal(reapDecision(r, { ...at, policy: 'nonsense' }).reason, 'idle')
})

test('reapDecision:常驻也拦不住 dead/unbound/paused(这三条与回收上限无关)', () => {
  const r = rec({ status: 'running', pid: 5, startedAt: T0, lastReqAt: T0 })
  const pol = { idleMs: 0, maxMs: 0 }
  assert.equal(reapDecision(r, { now: T0 + 1000, isAlive: () => false, policy: pol }).reason, 'dead')
  assert.equal(reapDecision(r, { now: T0 + 1000, isAlive: () => true, bound: false, policy: pol }).reason, 'unbound')
  assert.equal(reapDecision(r, { now: T0 + 1000, isAlive: () => true, paused: true, policy: pol }).reason, 'paused')
})

// ── createPreviewReaper ──────────────────────────────────────────────────────

function reaperFixture(records, { paused = false, bound = true, notify } = {}) {
  const dir = tmp()
  for (const r of records) writeRecord(dir, r)
  const killed = []
  const notes = []
  const reaper = createPreviewReaper({
    dir,
    groupState: () => ({ bound, paused }),
    kill: (pid) => killed.push(pid),
    notify: notify || ((chatId, text) => { notes.push({ chatId, text }); return Promise.resolve() }),
    now: () => T0 + 31 * 60_000,
    isAlive: () => true,
  })
  return { dir, reaper, killed, notes }
}

test('reaper:闲置到点 ⇒ kill + 写 stopped;通知留到下一 tick(一个动作只做一件事)', async () => {
  const f = reaperFixture([rec({ id: 'aaaaaaaaaa', status: 'running', pid: 77, startedAt: T0, lastReqAt: T0 })])
  f.reaper.tick()
  assert.deepEqual(f.killed, [77])
  assert.equal(listRecords(f.dir)[0].stoppedReason, 'idle')
  assert.equal(f.notes.length, 0)
  f.reaper.tick()
  await new Promise((r) => setImmediate(r))
  assert.equal(f.notes.length, 1)
  assert.match(f.notes[0].text, /预览已停止/)
  assert.equal(listRecords(f.dir)[0].notifyPending, false)
})

// ⚠ 回归:**先落判定再杀**。反过来则 worker 在收到信号前的 in-flight 请求会把 status 写回 'running'
// 并抹掉 notifyPending ⇒ 群里收不到「预览已停止」(v0.9.0 实现期实测复现过,不是推测)。
test('reaper:kill 之前记录必须已经落成 stopped(否则 worker 的 in-flight 写会复活它)', () => {
  const dir = tmp()
  writeRecord(dir, rec({ id: 'aaaaaaaaaa', status: 'running', pid: 77, startedAt: T0, lastReqAt: T0 }))
  let statusAtKill = null
  const reaper = createPreviewReaper({
    dir, groupState: () => ({ bound: true, paused: false }),
    kill: () => { statusAtKill = listRecords(dir)[0].status }, // 被杀那一刻磁盘上是什么
    notify: () => Promise.resolve(), now: () => T0 + 31 * 60_000, isAlive: () => true,
  })
  reaper.tick()
  assert.equal(statusAtKill, 'stopped', 'kill 时记录还是 running ⇒ 顺序反了')
})

// ⚠ 回归(2026-07-31 真机事故的另一半):收割方用配置判定还不够 —— worker 那侧**只认磁盘上
// 这份记录**、不认配置。不把新策略写进记录,就会变成「daemon 这边不收了,worker 自己到点
// 还是把它停掉」,operator 勾的常驻照样不生效。
test('reaper:配置策略变了 ⇒ 写进记录,好让 worker 侧的自尽判定也跟上', () => {
  const dir = tmp()
  writeRecord(dir, rec({ id: 'aaaaaaaaaa', status: 'running', pid: 77, startedAt: T0, lastReqAt: T0 }))
  const reaper = createPreviewReaper({
    dir,
    groupState: () => ({ bound: true, paused: false, idleMs: 0, maxMs: 0 }), // operator 勾了「常驻」
    kill: () => { throw new Error('常驻了还去 kill —— 判定没用上配置') },
    notify: () => Promise.resolve(),
    now: () => T0 + 31 * 60_000, isAlive: () => true,
  })
  reaper.tick()
  const after = listRecords(dir)[0]
  assert.equal(after.status, 'running')
  assert.equal(after.idleMs, 0, '记录没跟上 ⇒ worker 还会自己把它停掉')
  assert.equal(after.maxMs, 0)
})

test('reaper:策略与记录一致时不重写(每 tick 都写等于把记录文件磨成热点)', () => {
  const dir = tmp()
  writeRecord(dir, rec({ id: 'aaaaaaaaaa', status: 'running', pid: 77, startedAt: T0, lastReqAt: T0 }))
  const file = recordFile(dir, 'aaaaaaaaaa')
  const before = fs.readFileSync(file, 'utf8')
  const reaper = createPreviewReaper({
    dir,
    groupState: () => ({ bound: true, paused: false, idleMs: 30 * 60_000, maxMs: 8 * 3_600_000 }), // 与记录一致
    kill: () => {}, notify: () => Promise.resolve(),
    now: () => T0 + 60_000, isAlive: () => true,
  })
  reaper.tick()
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})

// 策略对齐必须**回读磁盘**:worker 一直在写 lastReqAt/reqCount,若拿 tick 开头那份内存快照
// 覆盖,访问计数就被抹回去了 —— 下一 tick 反而会据此误判「一直没人访问」而收掉它。
test('reaper:策略对齐是回读合并,不冲掉 worker 期间写入的 lastReqAt/reqCount', () => {
  const dir = tmp()
  writeRecord(dir, rec({ id: 'aaaaaaaaaa', status: 'running', pid: 77, startedAt: T0, lastReqAt: T0, reqCount: 1 }))
  const reaper = createPreviewReaper({
    dir,
    groupState: () => {
      // 模拟:本 tick 读完记录之后,worker 又服务了一个请求并落了盘
      const cur = listRecords(dir)[0]
      writeRecord(dir, { ...cur, lastReqAt: T0 + 20 * 60_000, reqCount: 42 })
      return { bound: true, paused: false, idleMs: 0, maxMs: 0 }
    },
    kill: () => {}, notify: () => Promise.resolve(),
    now: () => T0 + 21 * 60_000, isAlive: () => true,
  })
  reaper.tick()
  const after = listRecords(dir)[0]
  assert.equal(after.reqCount, 42, 'worker 的写被策略对齐冲掉了')
  assert.equal(after.lastReqAt, T0 + 20 * 60_000)
  assert.equal(after.idleMs, 0, '策略也要落上')
})

test('reaper:worker 自己闲置停下的记录(notifyPending)也会被代发 —— worker 不带飞书 SDK', async () => {
  const f = reaperFixture([rec({ id: 'aaaaaaaaaa', status: 'stopped', stoppedReason: 'idle', notifyPending: true, pid: 77 })])
  f.reaper.tick()
  await new Promise((r) => setImmediate(r))
  assert.equal(f.notes.length, 1)
  assert.deepEqual(f.killed, [], '已停的不再 kill')
  assert.equal(listRecords(f.dir)[0].notifyPending, false)
})

test('reaper:发送慢时下一 tick 不重发同一条(清标志是异步的,靠 in-flight 去重)', async () => {
  const dir = tmp()
  writeRecord(dir, rec({ id: 'aaaaaaaaaa', status: 'stopped', stoppedReason: 'idle', notifyPending: true }))
  let sent = 0
  let release
  const reaper = createPreviewReaper({
    dir, groupState: () => ({ bound: true, paused: false }),
    kill: () => {}, notify: () => { sent++; return new Promise((r) => { release = r }) }, // 卡住不 resolve
    now: () => T0, isAlive: () => true,
  })
  reaper.tick(); reaper.tick(); reaper.tick()
  assert.equal(sent, 1, '慢发送期间重复 tick 只应发一条')
  release()
  await new Promise((r) => setImmediate(r))
  assert.equal(listRecords(dir)[0].notifyPending, false)
})

// platform.send 永不 settle(SDK 卡住)时,只用 Set 去重会让这条 id 永久占位 ⇒ 通知既不重试也不
// 上报、群里永远收不到。项目其它等待都有兜底,这里同理:超过 NOTIFY_STUCK_MS 放行重试。
test('reaper:通知永不 settle 时,超过卡死阈值放行重试(不永久占位)', () => {
  const dir = tmp()
  writeRecord(dir, rec({ id: 'aaaaaaaaaa', status: 'stopped', stoppedReason: 'idle', notifyPending: true }))
  let sent = 0
  let clock = T0
  const reaper = createPreviewReaper({
    dir, groupState: () => ({ bound: true, paused: false }), kill: () => {},
    notify: () => { sent++; return new Promise(() => {}) }, // 永不 settle
    now: () => clock, isAlive: () => true,
  })
  reaper.tick()
  assert.equal(sent, 1)
  clock += 60_000; reaper.tick()
  assert.equal(sent, 1, '阈值内不重发')
  clock += preview.NOTIFY_STUCK_MS; reaper.tick()
  assert.equal(sent, 2, '超过卡死阈值应放行重试')
})

test('reaper:通知失败 ⇒ 不清 notifyPending(下轮重试),不炸 tick', async () => {
  const f = reaperFixture([rec({ id: 'aaaaaaaaaa', status: 'stopped', stoppedReason: 'idle', notifyPending: true })], { notify: () => Promise.reject(new Error('网络炸了')) })
  f.reaper.tick()
  await new Promise((r) => setImmediate(r))
  assert.equal(listRecords(f.dir)[0].notifyPending, true)
})

test('reaper:健康的预览一个都不动', () => {
  const f = reaperFixture([rec({ id: 'aaaaaaaaaa', status: 'running', pid: 77, startedAt: T0, lastReqAt: T0 + 30 * 60_000 })])
  f.reaper.tick()
  assert.deepEqual(f.killed, [])
  assert.equal(listRecords(f.dir)[0].status, 'running')
})

test('reaper:kill 抛错不影响记录落地与后续条目', () => {
  const dir = tmp()
  writeRecord(dir, rec({ id: 'aaaaaaaaaa', status: 'running', pid: 1, startedAt: T0, lastReqAt: T0 }))
  writeRecord(dir, rec({ id: 'bbbbbbbbbb', status: 'running', pid: 2, startedAt: T0, lastReqAt: T0 }))
  const reaper = createPreviewReaper({
    dir, groupState: () => ({ bound: true, paused: false }),
    kill: () => { throw new Error('ESRCH') }, notify: () => Promise.resolve(),
    now: () => T0 + 31 * 60_000, isAlive: () => true,
  })
  reaper.tick()
  assert.deepEqual(listRecords(dir).map((r) => r.status), ['stopped', 'stopped'])
})

// ⚠ 这条曾经是**零断言**的(只有抛异常才会红)—— 标题里「幂等」「unref」两个主张一个都没验,
// 把 `if (timer) return` 或 `timer.unref()` 删掉它照样绿。改成注入假定时器后才真的钉住。
test('reaper:start 幂等(只建一个定时器)、unref 过、stop 后不再 tick', () => {
  const dir = tmp()
  const created = []
  let cleared = 0
  const fake = { setIntervalFn: (fn, ms) => { const h = { fn, ms, unrefs: 0, unref() { this.unrefs++ } }; created.push(h); return h }, clearIntervalFn: () => { cleared++ } }
  const reaper = createPreviewReaper({
    dir, groupState: () => ({ bound: true, paused: false }), kill: () => {}, notify: () => Promise.resolve(),
    now: () => T0, isAlive: () => true, tickMs: 12_345, ...fake,
  })
  reaper.start(); reaper.start(); reaper.start()
  assert.equal(created.length, 1, 'start 幂等:重复调用只应建一个定时器')
  assert.equal(created[0].ms, 12_345)
  assert.equal(created[0].unrefs, 1, '定时器必须 unref,否则会吊住进程退出')
  reaper.stop(); reaper.stop()
  assert.equal(cleared, 1, 'stop 幂等:只清一次')
  reaper.start()
  assert.equal(created.length, 2, 'stop 之后应能重新 start')
})

// ── 文案 ─────────────────────────────────────────────────────────────────────

test('buildStartedText:钉住反模式措辞 —— 必须明说不要等待、不要拖轮次', () => {
  const t = buildStartedText(rec(), 'http://192.168.1.75:4612/abc/index.html', { idleMin: 30 })
  assert.match(t, /http:\/\/192\.168\.1\.75:4612\/abc\/index\.html/)
  assert.match(t, /不要等待/)
  assert.match(t, /不要为了让链接有效而拖着本轮不结束/)
  assert.match(t, /闲置 30 分钟后自动停止/)
  assert.match(t, /发到群里/)
})

test('buildStartedText:替换旧预览时如实报出来(破坏性动作不静默)', () => {
  const t = buildStartedText(rec(), 'http://x/y', { replaced: { label: '旧原型', port: 4611 }, idleMin: 30 })
  assert.match(t, /已替换上一个预览:旧原型 :4611/)
})

test('buildStartedText:环回绑定时不谎称「局域网都能打开」(承诺须与实际绑定一致)', () => {
  const t = preview.buildStartedText(rec(), 'http://127.0.0.1:4612/abc/i.html', { lan: false })
  assert.doesNotMatch(t, /同一局域网的手机\/电脑都能打开/)
  assert.match(t, /群成员打不开/)
  assert.match(t, /当文件发群里/) // 给出真正能用的替代路子(措辞不带工具名,见「对外表述」)
  assert.match(t, /不要为了让链接有效而拖着本轮不结束/) // 反模式警告不因绑定方式退化
})

test('buildStoppedMessage:各 reason 都给人话 + 复活指引', () => {
  const r = rec({ label: '记账原型' })
  assert.match(buildStoppedMessage(r, 'idle'), /闲置超过 30 分钟/)
  assert.match(buildStoppedMessage(r, 'idle'), /再起一个/)
  assert.match(buildStoppedMessage(r, 'max'), /已运行满 8 小时/)
  assert.match(buildStoppedMessage(r, 'paused'), /本群项目已暂停/)
  assert.match(buildStoppedMessage(r, 'dead'), /意外停止/)
  assert.match(buildStoppedMessage(r, 'console'), /控制台手动停止/)
  assert.match(buildStoppedMessage(r, 'whatever'), /预览已停止/)
  assert.match(buildStoppedMessage(r, 'idle'), /记账原型/)
})

test('buildStoppedMessage:无 label 退 entry,不出现空名字', () => {
  assert.match(buildStoppedMessage(rec({ label: '', entry: 'index.html' }), 'idle'), /index\.html/)
})

test('buildStatusLines:无运行中 ⇒ 一行人话;有则含端口/访问次数/闲置剩余', () => {
  assert.deepEqual(buildStatusLines([], { now: T0 }), ['(当前没有运行中的预览)'])
  const lines = buildStatusLines([rec({ id: 'aaaaaaaaaa', status: 'running', pid: 5, startedAt: T0, lastReqAt: T0 + 60_000, reqCount: 12 })], { now: T0 + 10 * 60_000, isAlive: () => true })
  assert.equal(lines.length, 1)
  assert.match(lines[0], /:4612/)
  assert.match(lines[0], /访问 12 次/)
  assert.match(lines[0], /闲置回收剩 21 分钟/)
})

test('buildStatusLines:已停的不列(status 只报活着的)', () => {
  assert.deepEqual(buildStatusLines([rec({ status: 'stopped' })], { now: T0, isAlive: () => true }), ['(当前没有运行中的预览)'])
})

test('buildStartedText:明确划线 —— 转告群里时不许带命令/工具名/机器路径', () => {
  // 这段 stdout 本就是「给 agent、由 agent 转述给群」的,所以划线必须写在文案里:
  // 命令留给它执行(功能需要),对外只说链接和何时自动关(产品对群成员只有一个身份)。
  const t = buildStartedText(rec(), 'http://x/y', { idleMin: 30 })
  assert.match(t, /不要把命令、工具名、机器上的目录路径写进群消息/)
})

// ── 单文件预览的关联素材(v0.11.29)────────────────────────
// 「单文件预览未校验关联素材,导致资源 404」。收紧本身是 v0.9.0 有意的最小暴露面,不推翻;
// 缺的是没人告诉用户素材会丢 —— 链接发出去,打开一看图全裂。

test('preview: 扫得出会 404 的本地引用(link/script/img/srcset/url())', () => {
  const html = [
    '<link rel="stylesheet" href="styles.css">',
    '<script src="app.js"></script>',
    '<img src="assets/hero.png">',
    '<img srcset="a@2x.png 2x, b.png 1x">',
    '<div style="background:url(bg.jpg)"></div>',
    '<video src="clip.mp4"></video>',
  ].join('\n')
  const refs = preview.scanLocalRefs(html)
  for (const r of ['styles.css', 'app.js', 'assets/hero.png', 'a@2x.png', 'b.png', 'bg.jpg', 'clip.mp4']) {
    assert.ok(refs.includes(r), `应扫到 ${r}`)
  }
})

test('preview: ⭐ 不会 404 的一律不报(误报会让人学会无视这段提示)', () => {
  const html = [
    '<link rel="stylesheet" href="https://cdn.x/y.css">',   // 外链:能取到
    '<script src="//cdn.x/z.js"></script>',                 // 协议相对
    '<link rel="icon" href="data:image/png;base64,AAAA">',  // 内联
    '<img src="/abs/x.png">',                               // 绝对路径,不归这个服务管
    '<img src="{{item.img}}">',                             // 模板占位,不是真路径
    '<a href="#top">top</a>',                               // 锚点
  ].join('\n')
  assert.deepEqual(preview.scanLocalRefs(html), [])
})

test('preview: 自包含的 HTML 不出提示(内联样式脚本 + data 图)', () => {
  const html = '<style>.a{color:red}</style><script>var a=1</script><img src="data:image/gif;base64,R0lGOD">'
  assert.deepEqual(preview.scanLocalRefs(html), [])
  assert.equal(preview.localRefsWarning([], { entry: 'x.html' }), '', '没有会丢的资源就一个字都不说')
})

test('preview: 提示说清后果 + 两条正路,并警示扩大暴露面', () => {
  const w = preview.localRefsWarning(['styles.css', 'assets/hero.png'], { entry: 'index.html', dirHint: 'design/proto' })
  assert.match(w, /404/)
  assert.match(w, /缺样式\/图片/, '要说后果,不能只说「有引用」')
  assert.match(w, /sbot preview start design\/proto/, '正路①:起目录')
  assert.match(w, /内联/, '正路②:内联')
  assert.match(w, /不该给人看的东西/, '起目录会扩大暴露面 —— 必须当场警示')
  assert.match(w, /别让人点开看到一个裂的页面/)
})

test('preview: 引用条数封顶(一个页面几十个引用不该刷屏)', () => {
  const many = Array.from({ length: 40 }, (_, i) => `<img src="a${i}.png">`).join('')
  assert.ok(preview.scanLocalRefs(many).length <= 12)
})
