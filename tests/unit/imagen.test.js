// imagen(生图基础技能纯逻辑)—— prompt 模板 / 任务文件往返 / 并发计数 / 产物校验 / 通知文案
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const imagen = require('../../src/agent/imagen')
const { imageSize } = require('../../src/platform/board')

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-imagen-'))

test('imagen: prompt 模板钉死输出路径与「只做这一件事」约束', () => {
  const p = imagen.buildImagenPrompt('一只橘猫,水彩风', '/proj/design/cat.png')
  assert.match(p, /\/proj\/design\/cat\.png/)
  assert.match(p, /一只橘猫,水彩风/)
  assert.match(p, /只做「生成图片并保存到上述路径」这一件事/)
  assert.match(p, /不要执行任何其他任务/)
})

test('imagen: prompt 模板带设计底线与保存前自查(用户要求优先,底线在其前提下生效)', () => {
  const p = imagen.buildImagenPrompt('登录页界面设计', '/proj/design/login.png')
  assert.match(p, /设计底线/)
  assert.match(p, /在满足上述图片要求的前提下遵守/)
  assert.match(p, /配色克制/)
  assert.match(p, /紫蓝渐变/)          // 反「一眼 AI」套路色
  assert.match(p, /拼写正确/)          // 图中文字质量
  assert.match(p, /不用占位假词假指标/) // 界面/图表类真实数据感
  assert.match(p, /保存前自查一遍/)
  // 顺序:用户的图片要求在设计底线之前(底线是前提下的补充,不覆盖用户意图)
  assert.ok(p.indexOf('图片要求') < p.indexOf('设计底线'))
})

test('imagen: 有风格档则插入其路径(在图片要求之后、设计底线之前;冲突以图片要求优先),没有则零回归', () => {
  const p = imagen.buildImagenPrompt('产品海报', '/proj/design/p.png', '/proj/DESIGN.md')
  assert.match(p, /项目风格档/)
  assert.match(p, /\/proj\/DESIGN\.md/)
  assert.match(p, /与图片要求冲突时以图片要求优先/)
  assert.ok(p.indexOf('图片要求') < p.indexOf('项目风格档'))
  assert.ok(p.indexOf('项目风格档') < p.indexOf('设计底线'))
  assert.match(p, /保存前自查一遍.*风格档的色板\/字体一致.*Don't/) // 自查行兑现「先读并遵循」的承诺
  // 不传/空串 = 老行为,一个字不多(生图对无风格档的项目零影响)
  assert.equal(imagen.buildImagenPrompt('产品海报', '/proj/design/p.png'), imagen.buildImagenPrompt('产品海报', '/proj/design/p.png', ''))
  assert.doesNotMatch(imagen.buildImagenPrompt('产品海报', '/proj/design/p.png'), /项目风格档/)
})

test('imagen: 任务文件 write→read→list 往返一致,按 createdAt 排序', () => {
  const dir = tmpDir()
  const t1 = imagen.newTask({ chatId: 'oc_1', workdir: '/w', out: '/w/a.png', outRel: 'a.png', label: '方案1', prompt: 'x', configPath: '/cfg.json' })
  const t2 = { ...imagen.newTask({ chatId: 'oc_1', workdir: '/w', out: '/w/b.png', outRel: 'b.png', prompt: 'y' }), createdAt: t1.createdAt + 5 }
  imagen.writeTask(dir, t2)
  imagen.writeTask(dir, t1)
  const back = imagen.readTask(imagen.taskFile(dir, t1.id))
  assert.equal(back.label, '方案1')
  assert.equal(back.status, 'running')
  assert.equal(back.configPath, '/cfg.json')
  assert.deepEqual(imagen.listTasks(dir).map((t) => t.id), [t1.id, t2.id])
})

test('imagen: listTasks 跳过 stream/log/损坏文件', () => {
  const dir = tmpDir()
  const t = imagen.newTask({ chatId: 'oc_1', workdir: '/w', out: '/w/a.png', outRel: 'a.png', prompt: 'x' })
  imagen.writeTask(dir, t)
  fs.writeFileSync(path.join(dir, t.id + '.stream.jsonl'), '{"raw":1}\n')
  fs.writeFileSync(path.join(dir, t.id + '.log'), 'log')
  fs.writeFileSync(path.join(dir, 'deadbeef00.json'), '{broken')
  assert.deepEqual(imagen.listTasks(dir).map((x) => x.id), [t.id])
})

test('imagen: countRunning — 活任务占位,完结/死 pid/超龄僵尸不占位', () => {
  const dir = tmpDir()
  const mk = (patch) => { const t = { ...imagen.newTask({ chatId: 'c', workdir: '/w', out: '/w/x.png', outRel: 'x.png', prompt: 'p' }), ...patch }; imagen.writeTask(dir, t); return t }
  const now = Date.now()
  mk({ status: 'running', pid: 111 })                      // 活(isAlive 认 111)
  mk({ status: 'running', pid: null })                     // 刚受理未接手 → 占位
  mk({ status: 'running', pid: 222 })                      // worker 崩了(pid 死)→ 不占位
  mk({ status: 'ok', pid: 111 })                           // 完结 → 不占位
  mk({ status: 'running', pid: null, createdAt: now - imagen.IMAGEN_WALL_MS - 120_000 }) // 超龄僵尸 → 不占位
  const n = imagen.countRunning(dir, { isAlive: (pid) => pid === 111, now: () => now })
  assert.equal(n, 2)
})

test('imagen: checkImageOut — 不存在/空/非图判失败,真 PNG 判成功带尺寸', () => {
  const dir = tmpDir()
  assert.equal(imagen.checkImageOut(path.join(dir, 'none.png'), imageSize).ok, false)
  const empty = path.join(dir, 'empty.png'); fs.writeFileSync(empty, '')
  assert.equal(imagen.checkImageOut(empty, imageSize).ok, false)
  const text = path.join(dir, 'text.png'); fs.writeFileSync(text, 'not an image at all')
  assert.match(imagen.checkImageOut(text, imageSize).reason, /不是可识别的图片/)
  // 最小合法 PNG 头(IHDR 8×4)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
    Buffer.from([0, 0, 0, 8, 0, 0, 0, 4, 8, 6, 0, 0, 0]),
  ])
  const good = path.join(dir, 'good.png'); fs.writeFileSync(good, png)
  const r = imagen.checkImageOut(good, imageSize)
  assert.equal(r.ok, true)
  assert.equal(r.width, 8)
  assert.equal(r.height, 4)
})

test('imagen: 完成/失败通知文案 — 标签优先,上板与否如实', () => {
  const t = { label: '方案1', outRel: 'design/a.png' }
  assert.match(imagen.buildDoneMessage(t, true), /方案1/)
  assert.match(imagen.buildDoneMessage(t, true), /已上画布/)
  assert.doesNotMatch(imagen.buildDoneMessage(t, false), /已上画布/)
  assert.match(imagen.buildFailMessage({ outRel: 'a.png' }, '生图超时(10 分钟)'), /a\.png.*生图超时/)
})

test('imagen: 完成通知带画板入口;无画布不带;beside 字段随任务落盘', () => {
  const t = { label: '方案1', outRel: 'a.png' }
  assert.match(imagen.buildDoneMessage(t, true, 'https://f.example/wiki/xx'), /画板:https:\/\/f\.example\/wiki\/xx/)
  assert.doesNotMatch(imagen.buildDoneMessage(t, false, null), /画板:/)
  const task = imagen.newTask({ chatId: 'c', workdir: '/w', out: '/w/x.png', outRel: 'x.png', prompt: 'p', beside: 'd1:27' })
  assert.equal(task.beside, 'd1:27')
})

test('imagen: 交付卡(buildDoneCard)— 图在卡内 / 元信息带耗时 / 打开画布 open_url 按钮 / 上板徽章', () => {
  const t = { label: '方案1', outRel: 'design/hero.png' }
  const c = imagen.buildDoneCard(t, { boardOk: true, boardUrl: 'https://f.example/x', imgKey: 'img_k', elapsedMs: 191000 })
  assert.equal(c.schema, '2.0')
  assert.match(c.header.title.content, /方案1/)
  assert.equal(c.header.template, 'green')
  assert.equal(c.header.text_tag_list[0].text.content, '已上画布') // 上板 → 徽章
  assert.equal(c.body.elements.find((e) => e.tag === 'img').img_key, 'img_k') // 图在卡内
  const btn = c.body.elements.find((e) => e.tag === 'button')
  assert.equal(btn.type, 'primary') // ⚠ 样式字段是 type,不是 button_style
  assert.equal(btn.text.tag, 'plain_text') // ⚠ 文字是 text 对象,不是 content 字符串(写错渲染空白)
  assert.ok(btn.text.content && !('content' in btn))
  assert.equal(btn.behaviors[0].type, 'open_url') // 无回调无 3s 约束
  assert.equal(btn.behaviors[0].default_url, 'https://f.example/x')
  assert.match(JSON.stringify(c), /191s/) // 耗时
})

test('imagen: 交付卡 — 未上板无徽章 / 无画板URL无按钮 / 无imgKey无图 / redact 过标签文件名', () => {
  const t = { label: 'AKIAABCDEFGHIJKLMNOP', outRel: 'a.png' }
  const c = imagen.buildDoneCard(t, { boardOk: false, boardUrl: null, imgKey: null, redact: (s) => s.replace(/AKIA[0-9A-Z]{12,}/, '[redacted]') })
  assert.equal(c.header.text_tag_list, undefined) // 未上板 → 无徽章
  assert.equal(c.body.elements.find((e) => e.tag === 'button'), undefined) // 无 URL → 无按钮
  assert.equal(c.body.elements.find((e) => e.tag === 'img'), undefined) // 无 key → 无图
  assert.match(c.header.title.content, /\[redacted\]/) // redact 生效
  assert.doesNotMatch(JSON.stringify(c), /AKIAABCDEFGHIJKLMNOP/)
})

test('imagen: 失败卡(buildFailCard)— 红头 / 原因 / redact', () => {
  const c = imagen.buildFailCard({ label: '方案1' }, '生图超时(10 分钟)', {})
  assert.equal(c.header.template, 'red')
  assert.match(JSON.stringify(c), /生图超时/)
})

test('imagen: noBoard 进任务记录 —— 与设计流程无关的单张图只发群,不进画布', () => {
  const base = { chatId: 'G', workdir: '/w', out: '/w/a.png', outRel: 'a.png', prompt: '一只猫' }
  assert.equal(imagen.newTask(base).noBoard, false, '默认仍上板(设计流程是主用途,不能因忘记加标志就丢板)')
  assert.equal(imagen.newTask({ ...base, noBoard: true }).noBoard, true)
  // 对照组:beside/deliver 这两个「属于设计流程」的信号照旧独立存在,没被这次改动波及
  assert.equal(imagen.newTask({ ...base, beside: 'n1', deliver: true }).beside, 'n1')
  assert.equal(imagen.newTask({ ...base, beside: 'n1', deliver: true }).deliver, true)
})

// ── 设计图 → 网页 的资产管线:编辑/遮罩/透明三通道(v0.11.27)────
// codex 内置 image_gen 本就支持编辑、多参考图、透明背景 —— 缺口一直在这座桥只会说
// 「生成一张图片」。意图不设 --mode,由参数推断:无 ref = 生成 · 有 ref = 编辑 · 再有 mask
// = 局部重绘。⚠ 头一条是**零回归**:老的纯生图路径必须逐字节不变。

test('imagen: 不给 refs 时 prompt 与「加通道之前那一版」逐字节相同(纯生图零回归)', () => {
  // ⚠ 基准是**当时旧版的实际输出快照**,不是「新代码自己跟自己比」—— 我第一版就写成了后者
  //   (三种等价写法互比),结果我把风格档那行措辞从「与图片要求冲突」改成「与上述要求冲突」,
  //   它一声不吭全绿,是既有的风格档用例把我拦下的。**零回归的基准必须来自外部,不能来自被测
  //   代码本身**;下面这份快照取自 git HEAD 的真实输出。
  const SNAP = [
    '使用你的图像生成能力生成一张图片,并保存为这个文件(绝对路径,格式按扩展名):',
    '/proj/design/p.png',
    '',
    '图片要求:',
    '产品海报',
    '',
    '项目风格档(先读并遵循;与图片要求冲突时以图片要求优先):',
    '/proj/DESIGN.md',
    '',
    '设计底线(在满足上述图片要求的前提下遵守):',
    '- 构图有明确主体与视觉层级,不要把元素无重点地平铺堆砌',
    '- 配色克制:一个主色加少量辅助色;除非明确要求,避免俗套的紫蓝渐变',
    '- 图中文字宁少勿多、必须拼写正确,禁止乱码感文字;界面/图表类的数据要像真实业务(量级合理、有单位),不用占位假词假指标',
    '- 有参照图或既定系列风格时与之保持一致',
    '',
    "保存前自查一遍:主体清晰?层级分明?配色克制?文字正确?与风格档的色板/字体一致?没踩它的 Don'ts?不满足就先重新生成,满意再保存。",
    '',
    '只做「生成图片并保存到上述路径」这一件事,不要执行任何其他任务、不要修改其他文件。',
    '若无法生成图片,直接说明原因后结束。',
  ].join('\n')
  assert.equal(imagen.buildImagenPrompt('产品海报', '/proj/design/p.png', '/proj/DESIGN.md'), SNAP)
  // 三种「等价于没给」的写法都不得改变它
  for (const opts of [{}, { refs: [] }, { refs: null, mask: '', transparent: false }]) {
    assert.equal(imagen.buildImagenPrompt('产品海报', '/proj/design/p.png', '/proj/DESIGN.md', opts), SNAP)
  }
})

test('imagen: 给了 refs 就切到编辑语义,并按编号列出输入图', () => {
  const p = imagen.buildImagenPrompt('把 [1] 里的人物抠出来', '/proj/assets/person.png', '', { refs: ['/proj/design/hero.png', '/proj/design/bg.png'] })
  assert.match(p, /图像编辑能力/)
  assert.doesNotMatch(p, /生成一张图片/, '编辑不是生成 —— 说成生成会诱导它把素材重画一遍')
  assert.match(p, /\[1\] \/proj\/design\/hero\.png/)
  assert.match(p, /\[2\] \/proj\/design\/bg\.png/, '多参考图按顺序编号,要求里才好指代')
  assert.match(p, /处理要求:/)
})

test('imagen: 编辑用的是「保持一致」的底线,不是生成那套构图美学', () => {
  // 把「构图有明确主体/配色克制」套到抠素材上,等于请它重新创作 —— 这是最容易出的错。
  const edit = imagen.buildImagenPrompt('去掉背景', '/o.png', '', { refs: ['/a.png'] })
  assert.match(edit, /保持一致/)
  assert.match(edit, /不要改变主体的形状、比例、颜色、光影和风格/)
  assert.doesNotMatch(edit, /构图有明确主体与视觉层级/, '生成底线不该出现在编辑路径')
  // 反向:生成路径仍保有它自己的底线
  assert.match(imagen.buildImagenPrompt('海报', '/o.png'), /构图有明确主体与视觉层级/)
})

test('imagen: mask 讲清「透明处重绘、不透明处逐像素保原样」', () => {
  const p = imagen.buildImagenPrompt('补全被挡住的手臂', '/o.png', '', { refs: ['/a.png'], mask: '/m.png' })
  assert.match(p, /遮罩\(mask\):\/m\.png/)
  assert.match(p, /透明.*区域/)
  assert.match(p, /逐像素保持原样/, '不写死这句,它会顺手把整张图美化一遍')
  // 没给 mask 就不该出现遮罩段(免得它去找一个不存在的文件)
  assert.doesNotMatch(imagen.buildImagenPrompt('x', '/o.png', '', { refs: ['/a.png'] }), /遮罩/)
})

test('imagen: --transparent 要求真 alpha,并点名禁止白底/棋盘格冒充', () => {
  const p = imagen.buildImagenPrompt('抠出图标', '/o.png', '', { refs: ['/a.png'], transparent: true })
  assert.match(p, /背景真透明/)
  assert.match(p, /alpha/)
  assert.match(p, /棋盘格/, '棋盘格假透明是这类模型的典型翻车方式,必须点名')
  assert.match(p, /边缘干净吗/, '自查行也要带上透明相关的检查')
  assert.doesNotMatch(imagen.buildImagenPrompt('抠出图标', '/o.png', '', { refs: ['/a.png'] }), /背景真透明/)
})

test('imagen: 透明/风格档可与编辑叠加,自查行按实际给的东西拼', () => {
  const p = imagen.buildImagenPrompt('抠出主体', '/o.png', '/proj/DESIGN.md', { refs: ['/a.png'], mask: '/m.png', transparent: true })
  assert.match(p, /项目风格档/)
  assert.match(p, /遮罩/)
  assert.match(p, /背景真透明/)
  assert.match(p, /该改的改了吗/)
  assert.match(p, /与风格档一致吗/)
})

test('imagen: newTask 把输入图/遮罩/透明落进任务(worker 跨进程要读)', () => {
  const t = imagen.newTask({ chatId: 'oc_a', workdir: '/p', out: '/p/o.png', outRel: 'o.png', prompt: 'x', refs: ['/p/a.png'], mask: '/p/m.png', transparent: true })
  assert.deepEqual(t.refs, ['/p/a.png'])
  assert.equal(t.mask, '/p/m.png')
  assert.equal(t.transparent, true)
  // 不给就是 null/false —— 老任务文件读起来也是这个形状(worker 里 opts 恒可解构)
  const plain = imagen.newTask({ chatId: 'oc_a', workdir: '/p', out: '/p/o.png', outRel: 'o.png', prompt: 'x' })
  assert.equal(plain.refs, null)
  assert.equal(plain.mask, null)
  assert.equal(plain.transparent, false)
})

test('imagen: 旧任务文件(无这三个字段)喂进 prompt 仍走生成路径', () => {
  // 部署跨版本时磁盘上会有老任务;worker 解构出 undefined 不能把它当编辑。
  const old = { prompt: '海报', out: '/o.png' }
  const p = imagen.buildImagenPrompt(old.prompt, old.out, '', { refs: old.refs, mask: old.mask, transparent: old.transparent })
  assert.match(p, /生成一张图片/)
  assert.doesNotMatch(p, /输入图片/)
})

// ── 僵尸任务自愈 + 等图三态(v0.11.28)──────────────────────
// 真机根因:旧 `--sync` 在**当前进程**跑 worker,而那是 agent 的 Bash 子进程 —— 生图实测
// 91~516s 远超 Bash 超时,被杀后任务永远卡 running、图从未生成,agent 只看到「命令结束了」
// 就当成功,把不存在的文件写进了页面。证据是那条任务**没有 .log 文件**(detached 路径必然
// 有),证明它走的是 sync 那条路。

test('imagen: 有 pid 但进程已死的 running = 僵尸(收尾成失败)', () => {
  const t = { id: 'a', status: 'running', pid: 33257, createdAt: 1000 }
  const why = imagen.staleReason(t, { isAlive: () => false, now: () => 2000 })
  assert.match(why, /中断/)
  // 进程还活着就不是僵尸 —— 正常长任务不能被误杀
  assert.equal(imagen.staleReason(t, { isAlive: () => true, now: () => 2000 }), null)
})

test('imagen: 超龄的 running 也算僵尸(worker 从未接手,pid 恒 null)', () => {
  const t = { id: 'a', status: 'running', pid: null, createdAt: 0 }
  assert.equal(imagen.staleReason(t, { isAlive: () => true, now: () => 1000 }), null, '刚受理不算')
  assert.match(imagen.staleReason(t, { isAlive: () => true, now: () => imagen.IMAGEN_WALL_MS + 61_000 }), /超时/)
})

test('imagen: 已收尾的任务不会被再判一次僵尸', () => {
  for (const st of ['ok', 'fail']) {
    assert.equal(imagen.staleReason({ id: 'a', status: st, pid: 1, createdAt: 0 }, { isAlive: () => false, now: () => 9e9 }), null)
  }
})

test('imagen: reapStale 把僵尸落成 fail 并留下原因,健康任务一个不碰', () => {
  const dir = tmpDir()
  const dead = { ...imagen.newTask({ chatId: 'c', workdir: '/w', out: '/w/a.png', outRel: 'a.png', prompt: 'x' }), pid: 33257 }
  const live = { ...imagen.newTask({ chatId: 'c', workdir: '/w', out: '/w/b.png', outRel: 'b.png', prompt: 'y' }), pid: 42 }
  const done = { ...imagen.newTask({ chatId: 'c', workdir: '/w', out: '/w/c.png', outRel: 'c.png', prompt: 'z' }), status: 'ok' }
  for (const t of [dead, live, done]) imagen.writeTask(dir, t)
  const reaped = imagen.reapStale(dir, { isAlive: (p) => p === 42, now: () => Date.now() })
  assert.deepEqual(reaped, [dead.id], '只收尾那条进程已死的')
  const byId = Object.fromEntries(imagen.listTasks(dir).map((t) => [t.id, t]))
  assert.equal(byId[dead.id].status, 'fail')
  assert.match(byId[dead.id].error, /中断/)
  assert.ok(byId[dead.id].finishedAt > 0, '收尾必须留时间戳,否则 --list 显示不出耗时')
  assert.equal(byId[live.id].status, 'running', '在跑的任务绝不能被误杀')
  assert.equal(byId[done.id].status, 'ok')
})

test('imagen: 等图文案把「还没好 ≠ 失败」说死(不说死会白烧一次额度)', () => {
  const p = imagen.WAIT_TEXT.pending('assets/hero.png', 90)
  assert.match(p, /仍在后台跑/)
  assert.match(p, /没有失败/)
  assert.match(p, /不用重试/, 'agent 拿到非零退出码的默认反应就是重试 —— 必须当场拦住')
  assert.match(p, /还不存在/)
  assert.match(p, /先别把它写进页面/, '这正是真机上把 404 写进页面的那一步')
  // 完成/失败两态各自说清下一步
  assert.match(imagen.WAIT_TEXT.ok('assets/hero.png'), /可以引用这个文件了/)
  assert.match(imagen.WAIT_TEXT.fail('assets/hero.png', '网络超时'), /网络超时/)
})

test('imagen: 等图轮询三态 —— 成功/失败/还没好各自返回什么', async () => {
  const mk = (seq) => { let i = 0; return () => seq[Math.min(i++, seq.length - 1)] }
  const sleep = async () => {} // 不真睡
  // ① 中途转 ok:先读到 running,第三次读到 ok
  assert.deepEqual(
    await imagen.waitForTask({ read: mk([{ status: 'running' }, { status: 'running' }, { status: 'ok' }]), now: () => 0, deadlineMs: 9e9, sleep }),
    { status: 'ok' })
  // ② 转 fail:带上原因(给用户看的文案要用)
  assert.deepEqual(
    await imagen.waitForTask({ read: mk([{ status: 'running' }, { status: 'fail', error: 'codex 不可用' }]), now: () => 0, deadlineMs: 9e9, sleep }),
    { status: 'fail', error: 'codex 不可用' })
  // ③ 到点仍 running ⇒ pending(退出码 2 那一态)
  let t = 0
  assert.deepEqual(
    await imagen.waitForTask({ read: () => ({ status: 'running' }), now: () => (t += 50), deadlineMs: 100, sleep }),
    { status: 'pending' })
})

test('imagen: 轮询每轮都先自愈 —— 否则会等一个永远不会变的 running', async () => {
  // 真机就是这样卡死的:worker 被杀、状态永远 running,而等待方一直等下去。
  // ⚠ 必须给时钟一个出口:变异检验时把 reap 改成「只做一次」,若 deadline 永不到达,
  //   坏实现会让测试**挂死**而不是报红(实测超时 5 分钟被杀,比失败更难诊断)。
  //   让时钟推进 ⇒ 坏实现走到 pending 而报红,好实现在那之前就 reap 出 fail。
  let reaped = 0, t = 0
  const r = await imagen.waitForTask({
    read: () => (reaped >= 2 ? { status: 'fail', error: '生成进程已中断(未留下结果)' } : { status: 'running' }),
    reap: () => { reaped++ },
    now: () => (t += 10), deadlineMs: 500, sleep: async () => {},
  })
  assert.equal(r.status, 'fail', '只在开头 reap 一次的话,这里会等到 pending')
  assert.match(r.error, /中断/)
  assert.ok(reaped >= 2, '每轮都要 reap,不能只在开头做一次')
})

test('imagen: 读任务抛异常不中断轮询(写入竞态),下一轮接着读', async () => {
  let n = 0
  const r = await imagen.waitForTask({
    read: () => { n++; if (n < 3) throw new Error('EBUSY'); return { status: 'ok' } },
    now: () => 0, deadlineMs: 9e9, sleep: async () => {},
  })
  assert.deepEqual(r, { status: 'ok' })
})

test('imagen: 缺 error 字段的 fail 也给得出话(不吐 undefined 给用户)', async () => {
  const r = await imagen.waitForTask({ read: () => ({ status: 'fail' }), now: () => 0, deadlineMs: 9e9, sleep: async () => {} })
  assert.equal(r.error, '未知原因')
  assert.doesNotMatch(imagen.WAIT_TEXT.fail('a.png', r.error), /undefined/)
})

// ── 2026-09-05 改图连续超时的三条守卫 ────────────────────────────────────────
// 现场:9 张挂钟改图,12 个任务撞满 10 分钟墙钟。codex 并非不会用出图能力(流里它读了
// imagegen 的 SKILL.md、也真调了一次),是自评「达不到要求里的逐像素一致」后**改用 Swift
// 手工补像素**,反复迭代到被杀。模板要拆掉的正是这条推理链。
test('imagen: 编辑路径禁止改用脚本手工画(这是超时那次真正跑偏的地方)', () => {
  const p = imagen.buildImagenPrompt('把指针改到 9 点', '/o.png', '', { refs: ['/a.png'] })
  assert.match(p, /必须用你自己的图像生成\/编辑能力出图/)
  assert.match(p, /Swift/, '点名最容易被抓起来用的那几样,泛泛说「不要写代码」拦不住')
  assert.match(p, /图像能力用不了就直接说明原因结束/, '堵死绕路的同时要给一条正当出口')
  // 生成路径不受影响(纯生图没有输入图可保,不会走上手工修补那条路)
  assert.doesNotMatch(imagen.buildImagenPrompt('海报', '/o.png'), /必须用你自己的图像生成\/编辑能力出图/)
})

test('imagen: 编辑路径给出可达的达标口径,并明说不必逐像素一致', () => {
  const p = imagen.buildImagenPrompt('只改指针,其余逐像素保持不变', '/o.png', '', { refs: ['/a.png'] })
  assert.match(p, /看不出被动过/)
  assert.match(p, /不要因为做不到字面的逐像素一致就放弃图像编辑能力/)
  // ⚠ 有遮罩时不给这条 —— 遮罩外「逐像素保原样」由遮罩机制保证、本来就做得到,
  //   再说「不必逐像素相同」是自相矛盾
  const masked = imagen.buildImagenPrompt('补全手臂', '/o.png', '', { refs: ['/a.png'], mask: '/m.png' })
  assert.doesNotMatch(masked, /看不出被动过/)
  assert.match(masked, /逐像素保持原样/, '遮罩语义不变')
})

test('imagen: 自查给重做上限并要求保底交付(旧文案「不满足就重做」无上限=死循环)', () => {
  const p = imagen.buildImagenPrompt('去掉角标', '/o.png', '', { refs: ['/a.png'] })
  assert.match(p, /最多重做两次/)
  assert.match(p, /保存当前最好的一版/)
  assert.doesNotMatch(p, /不满足就重做,满意再保存/, '无上限的旧措辞不能留')
  // 生成路径的自查行逐字节不动
  assert.match(imagen.buildImagenPrompt('海报', '/o.png'), /不满足就先重新生成,满意再保存/)
})

test('imagen: 失败提示按原因分叉 —— 超时不劝原样重试', () => {
  const timeout = imagen.failHint('生图超时(10 分钟)')
  assert.match(timeout, /逐像素完全一致/, '要点名那个做不到的硬条件,否则人不知道改哪')
  assert.match(timeout, /原样重试大概率还是超时/)
  assert.doesNotMatch(timeout, /codex 登录态/, '超时与登录态无关,混进来会把人指错方向')
  // 其它原因保持老指引
  assert.match(imagen.failHint('未生成图片文件'), /codex 登录态\/网络/)
  // 两条通道都用它,且卡里不出现重复句号
  assert.match(imagen.buildFailMessage({ outRel: 'a.png' }, '生图超时(10 分钟)'), /原样重试大概率还是超时/)
  const card = imagen.buildFailCard({ label: '9点整' }, '生图超时(10 分钟)', {})
  const hint = card.body.elements.map((e) => e.content || '').join('\n')
  assert.match(hint, /原样重试大概率还是超时。/)
  assert.doesNotMatch(hint, /。。/)
})

// ── 同一张图的重复提交(2026-09-05 事故:22 个任务里同一个 outRel 投了 3 次,每次烧满墙钟)──

test('imagen: findRunningForOut 认出「这张图正在生成」——按 out 绝对路径 + 同群', () => {
  const now = () => 1_000_000
  const live = { id: 'a1', chatId: 'oc_1', out: '/w/design/clock-01.png', status: 'running', pid: 11, createdAt: now() - 60_000 }
  const other = { id: 'b2', chatId: 'oc_1', out: '/w/design/clock-02.png', status: 'running', pid: 12, createdAt: now() - 60_000 }
  const opts = { isAlive: () => true, now }
  assert.equal(imagen.findRunningForOut([other, live], '/w/design/clock-01.png', opts).id, 'a1')
  assert.equal(imagen.findRunningForOut([other, live], '/w/design/clock-09.png', opts), null, '别的图不该被挡')
  // 同名文件在另一个项目里 ⇒ 绝对路径不同 ⇒ 不算同一张(受理侧 cwd 与 worker 不同,拿 outRel 比会串)
  assert.equal(imagen.findRunningForOut([{ ...live, out: '/w2/design/clock-01.png' }], '/w/design/clock-01.png', opts), null)
  // 另一个群的同路径任务不挡(群与群的 workdir 本就各自独立)
  assert.equal(imagen.findRunningForOut([live], '/w/design/clock-01.png', { ...opts, chatId: 'oc_2' }), null)
  assert.equal(imagen.findRunningForOut([live], '/w/design/clock-01.png', { ...opts, chatId: 'oc_1' }).id, 'a1')
  assert.equal(imagen.findRunningForOut([live], '', opts), null, '没给 out 一律不挡')
})

test('imagen: 僵尸任务不许挡住新任务(死 pid / 超龄 / 已完结三种)', () => {
  const now = () => 1_000_000
  const base = { chatId: 'oc_1', out: '/w/a.png', status: 'running', createdAt: now() - 60_000 }
  const find = (t, isAlive = () => false) => imagen.findRunningForOut([t], '/w/a.png', { isAlive, now })
  assert.equal(find({ ...base, id: 'dead', pid: 99 }), null, 'worker 崩了没来得及写状态 —— 不能挡')
  assert.equal(find({ ...base, id: 'stale', pid: null, createdAt: now() - imagen.IMAGEN_WALL_MS - 120_000 }, () => true), null, '超龄僵尸不能挡')
  assert.equal(find({ ...base, id: 'done', status: 'ok', pid: 7 }, () => true), null, '已完成的不能挡')
  assert.equal(find({ ...base, id: 'failed', status: 'fail', pid: 7 }, () => true), null, '失败过的不能挡(否则重投永远被拒)')
  // 刚受理、worker 还没接手(pid 恒 null 且未超龄)⇒ 要挡,否则受理竞态会放进第二个
  assert.equal(find({ ...base, id: 'fresh', pid: null }, () => true).id, 'fresh')
})

test('imagen: 「算不算在跑」只有一份判据 —— countRunning 与 findRunningForOut 同源', () => {
  const dir = tmpDir()
  const now = () => 1_000_000
  const mk = (o) => imagen.writeTask(dir, { chatId: 'oc_1', status: 'running', createdAt: now() - 60_000, ...o })
  mk({ id: 'aaaa1', out: '/w/a.png', pid: 11 })
  mk({ id: 'bbbb2', out: '/w/b.png', pid: 99 }) // 死 pid
  mk({ id: 'cccc3', out: '/w/c.png', pid: null, createdAt: now() - imagen.IMAGEN_WALL_MS - 120_000 }) // 超龄
  const isAlive = (pid) => pid === 11
  const tasks = imagen.listTasks(dir)
  assert.equal(imagen.countRunning(dir, { isAlive, now }), 1)
  assert.equal(tasks.filter((t) => imagen.isLiveTask(t, { isAlive, now })).length, 1)
  // 判据分叉的后果就是「僵尸占着并发位,却挡不住/或反过来挡住新任务」⇒ 两边必须逐条一致
  for (const t of tasks) {
    assert.equal(!!imagen.findRunningForOut(tasks, t.out, { isAlive, now }), imagen.isLiveTask(t, { isAlive, now }), t.id)
  }
})

test('imagen: 重复提交的挡板文案说全三件事(在跑多久 / 别重投 / 还能做什么)', () => {
  const msg = imagen.buildDupMessage({ id: 'ce7cfc', createdAt: 1_000_000 }, { now: () => 1_123_000 })
  assert.match(msg, /正在生成中/)
  assert.match(msg, /ce7cfc/)
  assert.match(msg, /已跑 123s/)
  assert.match(msg, /不要重投/)
  assert.match(msg, /超时/, '要说清「上次报失败可能只是超时」,否则 agent 觉得重投天经地义')
  assert.match(msg, /--list/, '给得出下一步动作才拦得住空转')
  assert.match(msg, /--out/)
  // ⚠ 这条是 CLI stdout(读它的是 agent),按纪律的例外条款**保留命令名**
  assert.match(msg, /sbot imagen/)
})

// ── 失败时半成品不许留在正式路径上 ──────────────────────────────────────────────────

test('imagen: partialPath —— 半成品挪到同目录的 .partial 同扩展名', () => {
  assert.equal(imagen.partialPath('design/clocks/clock-01.png'), 'design/clocks/clock-01.partial.png')
  assert.equal(imagen.partialPath('/w/design/a.jpeg'), '/w/design/a.partial.jpeg')
  assert.equal(imagen.partialPath('/w/noext'), '/w/noext.partial')
  assert.equal(imagen.partialPath(''), '.partial')
})

test('imagen: 失败时本次写下的半成品被挪走,正式路径回到「不存在」', () => {
  const dir = tmpDir()
  const out = path.join(dir, 'clock-01.png')
  const before = imagen.statOut(out)
  assert.equal(before.exists, false, '起跑前 out 不存在')
  fs.writeFileSync(out, 'half-drawn') // codex 被树杀那一刻落下的中间产物
  const q = imagen.quarantinePartial(out, before)
  assert.equal(q.moved, true)
  assert.equal(q.to, path.join(dir, 'clock-01.partial.png'))
  assert.equal(fs.existsSync(out), false, '正式路径必须不存在 —— 留着下一轮就会被当成做好的图交付')
  assert.equal(fs.readFileSync(q.to, 'utf8'), 'half-drawn', '半成品本身要留着,人可以自己看一眼')
})

test('imagen: out 上原本就有的旧文件(本次一个字节没动过)绝不被误挪', () => {
  const dir = tmpDir()
  const out = path.join(dir, 'clock-01.png')
  fs.writeFileSync(out, 'last-good-version') // 上一版成功的图
  const before = imagen.statOut(out)
  assert.equal(before.exists, true)
  const q = imagen.quarantinePartial(out, before) // 本次任务超时,但它压根没碰这个文件
  assert.equal(q.moved, false)
  assert.equal(q.reason, 'untouched')
  assert.equal(fs.readFileSync(out, 'utf8'), 'last-good-version', '因为这次失败把上次的成果弄丢 = 比不修更糟')
  assert.equal(fs.existsSync(path.join(dir, 'clock-01.partial.png')), false)
})

test('imagen: 旧文件被本次覆盖过(大小或 mtime 变了)仍要挪走', () => {
  const dir = tmpDir()
  const out = path.join(dir, 'a.png')
  fs.writeFileSync(out, 'old')
  const before = imagen.statOut(out)
  fs.writeFileSync(out, 'brand-new-partial') // 大小变了
  assert.equal(imagen.quarantinePartial(out, before).moved, true)
  assert.equal(fs.existsSync(out), false)
  // 大小相同、只有 mtime 变(codex 原地重写同尺寸的一版)也算动过
  fs.writeFileSync(out, 'sizeX')
  const b2 = imagen.statOut(out)
  fs.utimesSync(out, new Date(b2.mtimeMs + 5000), new Date(b2.mtimeMs + 5000))
  assert.equal(imagen.quarantinePartial(out, b2).moved, true)
})

test('imagen: 盘上什么都没有时不做任何事(失败但确实零产出)', () => {
  const dir = tmpDir()
  const out = path.join(dir, 'nothing.png')
  const q = imagen.quarantinePartial(out, imagen.statOut(out))
  assert.deepEqual(q, { moved: false, to: null, reason: 'none' })
})

test('imagen: 挪走了就必须在失败原因里说清去处(不说 = 报失败但文件在,查的人一脸问号)', () => {
  const withNote = imagen.withPartialNote('生图超时(10 分钟)', 'design/clocks/clock-01.partial.png')
  assert.match(withNote, /生图超时/)
  assert.match(withNote, /design\/clocks\/clock-01\.partial\.png/)
  assert.match(withNote, /正式路径保持不存在/)
  // 没挪 ⇒ 原因逐字不变(零回归)
  assert.equal(imagen.withPartialNote('未生成图片文件', null), '未生成图片文件')
  // 失败卡/失败消息吃的是加工后的原因,两条通道都要带上去处
  assert.match(imagen.buildFailMessage({ outRel: 'a.png' }, withNote), /clock-01\.partial\.png/)
})

// ── 生图 10 分钟不再一声不吭:流事件 → 粗阶段 ───────────────────────────────────────

test('imagen: parseStreamLine 只吃 JSON 对象,跳过 codex 混在流里的诊断行', () => {
  assert.equal(imagen.parseStreamLine('2026-09-05T08:29:53.508541Z ERROR rmcp::transport::worker: worker quit'), null)
  assert.equal(imagen.parseStreamLine(''), null)
  assert.equal(imagen.parseStreamLine('{ 坏掉的 json'), null)
  assert.equal(imagen.parseStreamLine('[1,2]'), null)
  assert.deepEqual(imagen.parseStreamLine('{"type":"turn.started"}'), { type: 'turn.started' })
})

test('imagen: 事件→阶段映射(判据取自真机流)', () => {
  const S = imagen.stageOfEvent
  assert.equal(S({ type: 'thread.started', thread_id: 'x' }), 'prep')
  assert.equal(S({ type: 'turn.started' }), 'prep')
  // 读生图技能说明书 = 还在准备
  assert.equal(S({ type: 'item.started', item: { type: 'command_execution', command: "/bin/zsh -lc \"sed -n '1,240p' /Users/x/.codex/skills/.system/imagegen/SKILL.md\"" } }), 'prep')
  // ⭐ generated_images 是流里唯一能确认「图真的画出来了」的信号
  assert.equal(S({ type: 'item.started', item: { type: 'command_execution', command: "cp /Users/x/.codex/generated_images/abc/exec-1.png /w/design/a.png" } }), 'save')
  assert.equal(S({ type: 'item.started', item: { type: 'command_execution', command: 'sips -g pixelWidth /w/a.png' } }), 'gen')
  assert.equal(S({ type: 'item.completed', item: { type: 'agent_message', text: '首张结果已通过目视自查' } }), 'gen')
  assert.equal(S({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'cua_repl', tool: 'js' } }), 'gen')
  assert.equal(S({ type: 'turn.completed' }), 'wrap')
  // 认不出的一律不推进(宁可停在原阶段,也不要瞎跳)
  assert.equal(S({ type: 'item.completed', item: { type: 'error', message: 'Code Mode is unavailable' } }), null)
  assert.equal(S({ type: 'item.started' }), null)
  assert.equal(S(null), null)
  assert.equal(S('turn.started'), null)
})

test('imagen: 阶段只进不退 —— 出图后的 sips 自查不许把进度打回「绘制中」', () => {
  const evs = [
    { type: 'thread.started' },
    { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'agent_message', text: '我会使用图像生成技能' } },
    { type: 'item.started', item: { type: 'command_execution', command: 'sed -n 1,240p ~/.codex/skills/.system/imagegen/SKILL.md' } }, // prep,但已在 gen ⇒ 不退
    { type: 'item.started', item: { type: 'command_execution', command: 'cp ~/.codex/generated_images/a/exec.png /w/a.png' } },
    { type: 'item.started', item: { type: 'command_execution', command: 'sips -g format /w/a.png' } }, // gen,但已在 save ⇒ 不退
    { type: 'turn.completed' },
  ]
  const seen = []
  let stage = 'start'
  for (const ev of evs) { stage = imagen.nextStage(stage, ev); seen.push(stage) }
  assert.deepEqual(seen, ['prep', 'prep', 'gen', 'gen', 'save', 'save', 'wrap'])
  // 阶段顺序表本身是单调判据的依据,别被人随手重排
  assert.deepEqual(imagen.IMAGEN_STAGE_ORDER, ['start', 'prep', 'gen', 'save', 'wrap', 'ended'])
  assert.equal(imagen.nextStage('gen', { type: 'x' }), 'gen', '认不出的事件保持原阶段')
})

test('imagen: 进度节流 —— 阶段变了也要等最小间隔,阶段没变靠心跳(飞书额度是租户级共享)', () => {
  const P = imagen.shouldPushProgress
  assert.equal(P({ stage: 'start', pushedStage: null, lastPushAt: null }, 0), true, '第一条无条件发')
  // 阶段变了但离上次太近 ⇒ 压住(prep→gen→save 可能只差几秒,每次都 edit 就是刷屏+烧额度)
  assert.equal(P({ stage: 'gen', pushedStage: 'prep', lastPushAt: 0 }, imagen.IMAGEN_PROGRESS_MIN_MS - 1), false)
  assert.equal(P({ stage: 'gen', pushedStage: 'prep', lastPushAt: 0 }, imagen.IMAGEN_PROGRESS_MIN_MS), true)
  // 阶段没变 ⇒ 要等心跳窗;不刷就又变回「一声不吭」,这正是要修的毛病
  assert.equal(P({ stage: 'gen', pushedStage: 'gen', lastPushAt: 0 }, imagen.IMAGEN_PROGRESS_MIN_MS), false)
  assert.equal(P({ stage: 'gen', pushedStage: 'gen', lastPushAt: 0 }, imagen.IMAGEN_PROGRESS_HEARTBEAT_MS - 1), false)
  assert.equal(P({ stage: 'gen', pushedStage: 'gen', lastPushAt: 0 }, imagen.IMAGEN_PROGRESS_HEARTBEAT_MS), true)
  // 心跳窗必须严格大于最小间隔,否则两条闸退化成一条(节流就没了)
  assert.ok(imagen.IMAGEN_PROGRESS_HEARTBEAT_MS > imagen.IMAGEN_PROGRESS_MIN_MS)
  // 一次跑满墙钟的任务,更新次数上限在十几次这个量级(与画布轮询的万级不是一个数量级)
  assert.ok(Math.ceil(imagen.IMAGEN_WALL_MS / imagen.IMAGEN_PROGRESS_HEARTBEAT_MS) + imagen.IMAGEN_STAGE_ORDER.length <= 20)
})

test('imagen: 耗时文案分秒两档', () => {
  assert.equal(imagen.fmtElapsed(0), '0 秒')
  assert.equal(imagen.fmtElapsed(59_400), '59 秒')
  assert.equal(imagen.fmtElapsed(60_000), '1 分 0 秒')
  assert.equal(imagen.fmtElapsed(130_000), '2 分 10 秒')
  assert.equal(imagen.fmtElapsed(null), '0 秒')
})

test('imagen: 进度卡 —— 阶段一句话 + 耗时 + 「不用重复提交」,且零工具名零内部路径', () => {
  const task = { label: '9点整', outRel: 'design/clocks/clock-01.png' }
  const card = imagen.buildProgressCard(task, { stage: 'gen', elapsedMs: 130_000 })
  assert.equal(card.schema, '2.0')
  assert.equal(card.header.template, 'blue')
  assert.match(card.header.title.content, /生成中 · 9点整/)
  const body = JSON.stringify(card.body)
  assert.match(body, /绘制中/)
  assert.match(body, /已用 2 分 10 秒/)
  assert.match(body, /design\/clocks\/clock-01\.png/)
  assert.match(body, /不用重复提交/, '群里的人也该看得见这句 —— 受理侧的挡板只拦得住 agent')
  // ⚠ 群成员看得到 ⇒ 不许出现工具名/CLI 命令/机器内部路径(项目纪律「用户面零工具名」)
  const all = JSON.stringify(card)
  assert.doesNotMatch(all, /sbot/)
  assert.doesNotMatch(all, /codex/)
  assert.doesNotMatch(all, /\.sbot|imagen|--list/)
  // 六个阶段都给得出话(留一句空白的进度卡等于没修)
  for (const s of imagen.IMAGEN_STAGE_ORDER) {
    const c = imagen.buildProgressCard(task, { stage: s })
    assert.ok((c.body.elements[0].content || '').replace(/\*/g, '').trim().length > 3, s)
  }
  // 认不出的阶段回落到起始文案而不是 undefined
  assert.match(JSON.stringify(imagen.buildProgressCard(task, { stage: '???' })), /正在启动绘图/)
  assert.doesNotMatch(JSON.stringify(imagen.buildProgressCard(task, { stage: '???' })), /undefined/)
  // 标签/文件名是 agent 输入 ⇒ 与完成卡同款逐字段脱敏
  const red = imagen.buildProgressCard({ label: 'k-XYZ', outRel: 'a.png' }, { stage: 'gen', redact: (s) => String(s).replace('XYZ', '***') })
  assert.match(JSON.stringify(red), /k-\*\*\*/)
})
