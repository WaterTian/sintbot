// 生图基础技能(`sbot imagen`)— 任何模型的群借机器的 codex 订阅生图(零 API key)。
//
// 形态 = 异步 detached worker(2026-07-22 拍板):受理进程写任务文件、spawn 脱离进程树的
// worker 后**立即返回** ⇒ agent 的 Bash 调用秒回、群锁不被生图占用(主对话可并行);
// worker spawn `codex exec --json` 用**固定生图模板**(非自由指令 —— 这不是嵌套 agent,
// 是确定性专用任务,与「群内多 agent 并行不做」的拍板不冲突),成图后自动上板+发群通知,
// 全程确定性零模型成本(「按这张改」的下一步烧额度决定留给群里的人,boardwatch 同哲学)。
//
// 本模块只放可单测的纯逻辑(prompt 模板 / 任务文件 / 并发计数 / 产物校验 / 通知文案);
// spawn codex、上板、发群等接线在 bin(项目纪律:src 可测,bin 接线)。
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { atomicWriteJSON } = require('../core/store')

const IMAGEN_MAX_CONCURRENT = 2 // 全局并发上限(2026-07-22 拍板)— 烧的是与交互式共享的订阅额度
const IMAGEN_WALL_MS = 10 * 60_000 // worker 墙钟:超时树杀 codex,任务标失败

function imagenDir() {
  return path.join(os.homedir(), '.sbot', 'imagen')
}

// codex 收到的固定模板 —— 把自由发挥空间压到「画什么」一项,其余(存哪、只做这件事、
// 画得好的底线)钉死。设计底线管的是生成图像最常见的「一眼 AI」通病(套路渐变、假数据、
// 乱码文字、无层级堆砌),与项目风格档(DESIGN.md)互补:那管系列风格一致,这管单张质量;
// 用户明确要求的风格永远优先(底线只在「满足图片要求的前提下」生效)。
// styleAbs(可选)= 项目风格档绝对路径:给路径不给内容 —— 生图后端自己读文件,省得受理侧
// 把整份风格档塞进 prompt;冲突时以本轮图片要求优先(风格档是缺省,不是枷锁)。
// opts(v0.11.27,设计图→网页资产管线):
//   refs        输入图绝对路径数组 —— 有它就从「生成」切到「编辑」语义(codex 内置 image_gen
//               本就支持编辑/多参考图,此前桥这边没通道喂给它,能力等于埋着)
//   mask        遮罩绝对路径:透明处重绘、不透明处逐像素保原样(局部重绘/补全被遮挡部分)
//   transparent 要求输出真 alpha 的透明底 PNG(抠素材给网页用的关键)
// ⚠ 意图不设 --mode 而由参数推断(参数即意图):无 refs = 生成 · 有 refs = 编辑 · 再有 mask
//   = 局部重绘。少一个要记的模式名,也少一处「模式与参数打架」的状态。
// ⚠ 无 refs 时整段文案**逐字节沿用旧版** —— 老的纯生图路径零回归(单测钉死)。
function buildImagenPrompt(userPrompt, outAbs, styleAbs, opts = {}) {
  const style = String(styleAbs || '').trim()
  const refs = (opts && Array.isArray(opts.refs) ? opts.refs : []).filter(Boolean)
  const mask = String((opts && opts.mask) || '').trim()
  const transparent = !!(opts && opts.transparent)
  const editing = refs.length > 0
  const L = []

  if (editing) {
    L.push('使用你的图像编辑能力处理下面的输入图片,把结果保存为这个文件(绝对路径,格式按扩展名):', outAbs, '',
      '输入图片(已按顺序编号,下面的要求按编号指代):',
      ...refs.map((p, i) => `  [${i + 1}] ${p}`), '')
    if (mask) {
      L.push('遮罩(mask):' + mask,
        '- 只重绘遮罩中**透明**的区域;不透明区域必须**逐像素保持原样**,不要顺手美化、不要重新构图。', '')
    }
  } else {
    L.push('使用你的图像生成能力生成一张图片,并保存为这个文件(绝对路径,格式按扩展名):', outAbs, '')
  }

  L.push(editing ? '处理要求:' : '图片要求:', String(userPrompt || '').trim(), '')
  if (transparent) {
    L.push('输出必须是**背景真透明**的 PNG(保留 alpha 通道)——',
      '不要用白底、纯色底或棋盘格图案冒充透明;边缘要干净,不留原背景的残色描边。', '')
  }
  // ⚠ 措辞按路径分叉:生成路径这一行**逐字节沿用旧版**(「图片要求」是它上面那个小标题的原词)。
  // 我曾图省事把两条路统一成「上述要求」—— 既有单测当场报红,那正是「纯生图零回归」的守卫。
  if (style) L.push(editing ? '项目风格档(先读并遵循;与上述处理要求冲突时以处理要求优先):' : '项目风格档(先读并遵循;与图片要求冲突时以图片要求优先):', style, '')

  if (editing) {
    // 编辑的底线与生成完全不同:生成图求「好看」,编辑求「除了要改的地方一模一样」——
    // 把生成那套「构图有主体/配色克制」套到抠素材上,会诱导它把素材重新画一遍。
    L.push('编辑底线(比画得好看更重要):',
      '- 除了要求改的部分,其余内容与输入图**保持一致**:不要改变主体的形状、比例、颜色、光影和风格',
      '- 不要自作主张裁剪、缩放、旋转或补画要求之外的元素',
      '- 需要补全被遮挡的部分时,依据周围可见部分合理续接,材质与光影要接得上',
      '- 图中文字保持原样,除非要求明确说了要改',
      // ⚠ 2026-09-05 实测:不写死这条,它会在自评「达不到逐像素一致」后**改用 Swift/CoreGraphics
      //   手工补像素**,反复迭代到撞墙钟,产物是旧指针残影 + 灰色补丁块。
      '- **必须用你自己的图像生成/编辑能力出图**:不要改用脚本逐像素修补或手工重画' +
        '(Swift、Python、ImageMagick、canvas 一律不行)—— 那样出来的边缘、光影、质感接不上,一眼就看得出。' +
        '图像能力用不了就直接说明原因结束,不要绕路自己画。')
    // 达标口径只在**没有遮罩**时给:有遮罩时「不透明处逐像素保原样」由遮罩机制保证、本来就做得到,
    // 再说一句「不必逐像素相同」反而自相矛盾。
    if (!mask) {
      L.push('- 达标看的是**看不出被动过**,不是与输入图逐像素相同:生成式编辑必然带来细微的像素差异,' +
        '只要主体、构图、配色、光影、质感没变就算达标。处理要求里即使写了「逐像素一致」「完全不变」' +
        '也按这把尺子量 —— **不要因为做不到字面的逐像素一致就放弃图像编辑能力**。')
    }
    L.push('')
    L.push('保存前自查一遍:该改的改了吗?不该动的地方看上去还和输入图一样吗?' +
      (transparent ? '背景是真透明吗(不是白底)?边缘干净吗?' : '') +
      (style ? '与风格档一致吗?' : '') +
      // ⚠ 旧文案是「不满足就重做」无上限 —— 配上一个达不到的验收条件就是死循环。给上限并要求保底交付:
      //   一版可用的图 + 一句「还差在哪」,比反复重做到超时什么都交不出好。
      '不满足可以重做,但**最多重做两次**;到上限仍不完美就保存当前最好的一版,并说明还差在哪。')
  } else {
    L.push('设计底线(在满足上述图片要求的前提下遵守):',
      '- 构图有明确主体与视觉层级,不要把元素无重点地平铺堆砌',
      '- 配色克制:一个主色加少量辅助色;除非明确要求,避免俗套的紫蓝渐变',
      '- 图中文字宁少勿多、必须拼写正确,禁止乱码感文字;界面/图表类的数据要像真实业务(量级合理、有单位),不用占位假词假指标',
      '- 有参照图或既定系列风格时与之保持一致', '')
    // 自查行按有无风格档分叉:给了风格档就必须查到风格档上,否则「先读并遵循」只是句空话
    // (无风格档时逐字节沿用老文案 —— 生图对无风格档的项目零回归)
    L.push('保存前自查一遍:主体清晰?层级分明?配色克制?文字正确?' + (style ? "与风格档的色板/字体一致?没踩它的 Don'ts?" : '') + '不满足就先重新生成,满意再保存。')
  }

  L.push('', `只做「${editing ? '处理图片并保存' : '生成图片并保存'}到上述路径」这一件事,不要执行任何其他任务、不要修改其他文件。`,
    editing ? '若无法完成,直接说明原因后结束。' : '若无法生成图片,直接说明原因后结束。')
  return L.join('\n')
}

function newTask({ chatId, workdir, out, outRel, label, prompt, configPath, model, beside, deliver, noBoard, styleDoc, refs, mask, transparent }) {
  return {
    id: crypto.randomBytes(5).toString('hex'),
    chatId, workdir, out, outRel,
    label: label || '', prompt, configPath: configPath || null, model: model || null,
    // 设计图→网页资产管线(v0.11.27):输入图/遮罩落**绝对路径** —— worker 是另一个进程、
    // cwd 与受理侧不同,存相对路径到那边会解析到别的地方(风格档选档踩过同款)。
    refs: Array.isArray(refs) && refs.length ? refs.slice() : null,
    mask: mask || null,
    transparent: !!transparent,
    styleDoc: styleDoc || null, // 受理侧定下的风格档(多份档时不让 worker 再猜一次)
    beside: beside || null, // 参照节点 id:上板放它右侧(改图场景,透传 board-add-image --beside)
    deliver: !!deliver, // 按标注改图交付:worker 上板带 --deliver(结果回填进播报卡),done 兜底让位给 worker
    // 画布是**设计演变档案**(原图→标注→新版的链条),不是图片收纳箱。与设计/产品流程无关的
    // 单张图(「给我画只猫」)堆上去只会稀释那条链、还占着要长期保留的版面 ⇒ 只发群。
    // ⚠ --beside/--deliver 本身就是「这张图在设计流程里」的显式信号,与它们同时给没有意义,
    // 由调用侧判为矛盾并忽略 noBoard(见 bin 的解析):留着更容易让改图交付悄悄丢板。
    noBoard: !!noBoard,
    createdAt: Date.now(), status: 'running', pid: null,
  }
}

const taskFile = (dir, id) => path.join(dir, id + '.json')

function writeTask(dir, task) {
  fs.mkdirSync(dir, { recursive: true })
  atomicWriteJSON(taskFile(dir, task.id), task)
}

function readTask(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function listTasks(dir) {
  let names
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out = []
  for (const n of names) {
    if (!/^[0-9a-f]+\.json$/.test(n)) continue // 跳过 .stream.jsonl / .log / 锁文件
    try { out.push(readTask(path.join(dir, n))) } catch { /* 损坏条目跳过 */ }
  }
  return out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

function pidAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

// 「这条任务此刻真的在跑吗」—— 并发计数与「同一张图是否已在生成」共用的唯一判据。
// 三种不算在跑的死态:①标了非 running;②worker 已起(有 pid)但进程已死(崩溃没来得及写
// 状态);③超龄(受理后 worker 从未起来,pid 恒 null,永远占位 → 按墙钟+宽限判过期)。
// ⚠ 收成一个函数而不是两处各写一遍:两处判据分叉的后果是**僵尸任务能挡住新任务**
// (占并发位那边认它死了、去重那边认它活着),而僵尸恰恰是最需要让路的那种。
function isLiveTask(t, { isAlive = pidAlive, now = Date.now } = {}) {
  if (!t || t.status !== 'running') return false
  if (now() - (t.createdAt || 0) > IMAGEN_WALL_MS + 60_000) return false // 超龄僵尸不算在跑
  if (t.pid != null) return isAlive(t.pid)
  return true // 刚受理、worker 未接手 —— 算在跑(防受理竞态超卖)
}

// 并发计数(受理时挡上限)。pid 探活与时钟可注入(单测)。
function countRunning(dir, { isAlive = pidAlive, now = Date.now } = {}) {
  return listTasks(dir).filter((t) => isLiveTask(t, { isAlive, now })).length
}

// 同一张图是不是已经在生成了(受理侧去重的判据)。out 用**绝对路径**比 —— 受理侧 cwd 与
// worker 不同,拿 outRel 比会把两个项目里的同名文件判成同一张。
// ⚠ 2026-09-05 事故:群里的 agent 见任务失败就原样重投,22 个任务里同一个 outRel 最多投了
//   3 次(每次烧满 10 分钟墙钟),而并发上限只有 2 ⇒ 队列被同一张图占死,别的图一张都排不进来。
//   全局并发上限拦不住这种「重复的同一件事」—— 它只数个数,不问是不是同一张图。
function findRunningForOut(tasks, out, { chatId = null, isAlive = pidAlive, now = Date.now } = {}) {
  if (!out) return null
  return (tasks || []).find((t) => t && t.out === out && (!chatId || t.chatId === chatId) && isLiveTask(t, { isAlive, now })) || null
}

// 撞上「同一张图正在生成」时给受理方的话。⚠ 这段是 **CLI stdout/stderr**,读它的是 agent 不是
// 群成员 ⇒ 按项目纪律的例外条款保留命令名(不保留它就不会去查 --list)。
// 三件事必须说全:①它在跑、跑了多久 ②别重投、为什么重投更糟 ③还能做什么(查进度 / 换路径)。
function buildDupMessage(dup, { now = Date.now } = {}) {
  const sec = Math.max(0, Math.round((now() - ((dup && dup.createdAt) || 0)) / 1000))
  return `这张图正在生成中(任务 ${dup && dup.id},已跑 ${sec}s)—— 同一个输出路径同时只允许一个任务。\n` +
    `⚠ 不要重投:重投不会更快,只会把生图队列(同时最多 ${IMAGEN_MAX_CONCURRENT} 个)占死;上一次报「失败」也可能只是超时,重投同样的要求大概率还是超时。\n` +
    `查进度:sbot imagen --list(完成会自动发群)。真要改需求,等这一张结束再提,或换一个 --out 路径。`
}

// 僵尸判定:任务标着 running,但它其实早就没了。两种死法 ——
//   ①worker 起来过(有 pid)而进程已不在:被杀/崩溃,没来得及落状态
//   ②受理后 worker 从未接手(pid 恒 null)且已超龄
// ⚠ 这两条与 isLiveTask 的判据同源(那边判「算不算在跑」,这边判「要不要落成失败」)。
// 2026-08-14 真机:一条 `--sync` 任务的进程被杀,状态永远停在 running —— `--list` 显示
// 「已中断」却没人给它收尾,而轮询等待的一方会一直等一个永远不会变的状态。
function staleReason(task, { isAlive = pidAlive, now = Date.now } = {}) {
  if (!task || task.status !== 'running') return null
  if (now() - (task.createdAt || 0) > IMAGEN_WALL_MS + 60_000) return '任务超时未完成(worker 可能被中断)'
  if (task.pid != null && !isAlive(task.pid)) return '生成进程已中断(未留下结果)'
  return null
}

// 把僵尸任务落成失败态。读侧调用(--list / 受理 / 轮询)⇒ 自愈,不需要额外的清理进程。
// 返回被收尾的任务 id 列表(调用方决定要不要说出来)。
function reapStale(dir, { isAlive = pidAlive, now = Date.now, write = writeTask } = {}) {
  const done = []
  for (const t of listTasks(dir)) {
    const why = staleReason(t, { isAlive, now })
    if (!why) continue
    try { write(dir, { ...t, status: 'fail', error: why, finishedAt: now() }); done.push(t.id) } catch { /* 单条失败不拖累其余 */ }
  }
  return done
}

// 产物校验:worker 等 codex 退出后凭这个判成败 —— 文件存在、非空、魔数是可识别图片格式。
// imageSizeFn = platform/board.js 的 imageSize(注入免循环依赖,单测可换)。
function checkImageOut(absPath, imageSizeFn) {
  let buf
  try { buf = fs.readFileSync(absPath) } catch { return { ok: false, reason: '未生成图片文件' } }
  if (!buf.length) return { ok: false, reason: '生成的文件是空的' }
  try {
    const { width, height } = imageSizeFn(buf)
    return { ok: true, width, height }
  } catch {
    return { ok: false, reason: '生成的文件不是可识别的图片格式(PNG/JPEG/WebP)' }
  }
}

// ── 失败时把半成品挪走 ───────────────────────────────────────────────────────────────
// 半成品旁路的落点:`design/clocks/clock-01.png` → `design/clocks/clock-01.partial.png`。
// 相对路径与绝对路径都能算(群消息里报相对、真正搬文件用绝对,两边同一套命名)。
function partialPath(p) {
  const s = String(p || '')
  const ext = path.extname(s)
  return (ext ? s.slice(0, s.length - ext.length) : s) + '.partial' + ext
}

// 起跑前给 out 拍个快照。**这是「旧文件」和「本次半成品」唯一的分界线** —— 失败时光看
// 「out 上有没有文件」是分不清的:那可能是上一版成功的图,一直好端端待在那儿。
function statOut(absPath, { stat = fs.statSync } = {}) {
  try { const s = stat(absPath); return { exists: true, size: s.size, mtimeMs: s.mtimeMs } }
  catch { return { exists: false, size: 0, mtimeMs: 0 } }
}

// 失败(含墙钟超时)时把 out 上的那一版挪到 .partial —— **正式路径必须保持「不存在」**。
// ⚠ 2026-09-05 实测:超时被树杀那一刻盘上常常已经落了一版中间产物(9 张改图全在盘上、群里
//   却报失败)。留在正式路径上的后果不是「多一个文件」,是**下一轮 agent 一看文件在就当图做好了**,
//   拿一张 codex 自己都没验收通过的半成品去交付(那版是旧指针残影 + 灰色补丁块)。
// ⚠ before 快照说「存在且 size/mtime 一个字节没变」⇒ 这一版根本不是本次任务写的,是上一版
//   成功的图 —— 挪走它等于因为这次失败把上次的成果弄丢。
// 只在失败路径调用;成功路径一个字节都不碰(调用方保证)。
function quarantinePartial(absPath, before, { stat = fs.statSync, rename = fs.renameSync } = {}) {
  let after
  try { after = stat(absPath) } catch { return { moved: false, to: null, reason: 'none' } } // 盘上什么都没有
  if (before && before.exists && after.size === before.size && after.mtimeMs === before.mtimeMs) {
    return { moved: false, to: null, reason: 'untouched' } // 本次一个字节没动过 = 上一版的图,留着
  }
  const to = partialPath(absPath)
  // 同名 .partial 已存在时直接覆盖:它本身就是上一次失败的残留,留两份没有意义(POSIX rename 语义)。
  try { rename(absPath, to) } catch { return { moved: false, to: null, reason: 'error' } }
  return { moved: true, to, reason: 'moved' }
}

// 失败原因里把半成品的去处说清楚 —— 不说,查的人就会对着「报失败但文件在」一脸问号(这正是
// 本次事故里发生的事);说了却不挪,下一轮 agent 会拿它当正式产物。两件事必须同时做。
function withPartialNote(reason, partialRel) {
  return partialRel ? `${reason}(盘上那版没画完的中间产物已挪到 ${partialRel},正式路径保持不存在)` : String(reason || '')
}

// 群通知文案(调用方过 redact 后出站)。boardUrl:画板入口直达(收到结果
// 不用翻群标签页,点链接即到)。
// opts.boards:false = 这个群的平台没有画布(企微),收尾那句别提「在画布标注」
function buildDoneMessage(task, boardOk, boardUrl, { boards = true } = {}) {
  const name = task.label || task.outRel
  return `✅ 生图完成:${name}` + (boardOk ? '(已上画布)' : '') + `\n文件:${task.outRel}` +
    (boardUrl ? `\n画板:${boardUrl}` : '') + (boards ? `\n要调整的话在画布标注或群里说一声即可` : `\n要调整的话在群里说一声即可`)
}

// 失败后该怎么办,按原因分叉 —— 超时那一族**原样重试必然再超时**(2026-09-05:同一张图连试三次、
// 每次烧满 10 分钟额度),给「原样重试」以外的出路才拦得住这种空转。
function failHint(reason) {
  return /超时/.test(String(reason || ''))
    ? '超时多半是要求里带了做不到的硬条件(例如「逐像素完全一致」「一模一样」)—— 换成「主体和配色不变」这类可达的说法再试;原样重试大概率还是超时'
    : '可以换个描述再试;连续失败请检查机器的 codex 登录态/网络'
}

function buildFailMessage(task, reason) {
  const name = task.label || task.outRel
  return `❌ 生图失败:${name} — ${reason}\n${failHint(reason)}`
}

// 画布交付卡(Card JSON 2.0 富卡;docs/BOARD.md)
// —— 图在卡内(合并卡,2026-07-22 用户选)+ 元信息 + open_url「打开画布」按钮,一张卡收拢原来
// 的「图 + 文」两条消息。imgKey = image_type:message 上传返回的 key(与原生图片消息同源,复用
// uploadImage);open_url 无回调无 3s 约束 ⇒ 零新基础设施。纯函数注入 redact(label/文件名是
// agent/用户输入,与文本交付同款脱敏 —— 卡是 JSON 无法整体 redact,故逐字段脱敏)。
function buildDoneCard(task, { boardOk = false, boardUrl = null, imgKey = null, elapsedMs = null, redact = (s) => s } = {}) {
  const name = redact(task.label || task.outRel)
  const meta = `📄 ${redact(task.outRel)}` + (elapsedMs ? `　·　⏱ ${Math.round(elapsedMs / 1000)}s` : '')
  const elements = []
  if (imgKey) elements.push({ tag: 'img', img_key: imgKey, scale_type: 'fit_horizontal', corner_radius: '8px', preview: true, alt: { tag: 'plain_text', content: name } })
  elements.push({ tag: 'markdown', text_size: 'notation', content: `<font color='grey'>${meta}</font>` })
  // 引导语按群有无画布门控 —— imagen 对无画布群也可用,不能把人指去不存在的画布(审查修正)
  elements.push({ tag: 'markdown', content: (boardOk || boardUrl)
    ? '想调整?在画布上标注,再点播报卡的「按标注改图」按钮 —— 新图会放在原图右侧方便对比。'
    : '想调整?在群里说一声要改哪里即可。' })
  // ⚠ 2.0 button:样式字段是 type(非 button_style),文字是 text 对象(非 content 字符串)—— 写成
  // content 会渲染成空白按钮(v0.6.8 真机踩过)。
  if (boardUrl) elements.push({ tag: 'hr' }, { tag: 'button', type: 'primary', width: 'fill', text: { tag: 'plain_text', content: '📋 打开设计画布' }, behaviors: [{ type: 'open_url', default_url: boardUrl }] })
  const header = { title: { tag: 'plain_text', content: `🎨 生图完成 · ${name}` }, template: 'green' }
  if (boardOk) header.text_tag_list = [{ tag: 'text_tag', text: { tag: 'plain_text', content: '已上画布' }, color: 'green' }]
  return { schema: '2.0', config: { width_mode: 'default' }, header, body: { padding: '16px', vertical_spacing: '12px', elements } }
}

function buildFailCard(task, reason, { redact = (s) => s } = {}) {
  const name = redact(task.label || task.outRel)
  return {
    schema: '2.0', config: { width_mode: 'default' },
    header: { title: { tag: 'plain_text', content: `⚠️ 生图失败 · ${name}` }, template: 'red' },
    body: { padding: '12px', vertical_spacing: '8px', elements: [
      { tag: 'markdown', content: `**原因**:${redact(String(reason || '未知'))}` },
      { tag: 'markdown', content: failHint(reason) + '。' },
    ] },
  }
}

// ── 生图进度(群里那条会自己更新的消息)────────────────────────────────────────────────
// 背景(实测):生图一跑 10 分钟,群里只看得到
// 「受理」和最后的「失败」,中间完全静默 —— 群成员分不清是在跑还是死了。
// ⚠ 只能做**粗阶段**:codex 生图走内部 imagegen skill,`--json` 流里它是普通 `command_execution`,
//   没有专门的生图 item、没有百分比、没有 partial 预览。硬凑百分比就是编数字。
const IMAGEN_STAGE_ORDER = ['start', 'prep', 'gen', 'save', 'wrap', 'ended']
const IMAGEN_STAGE_TEXT = {
  start: '正在启动绘图',
  prep: '正在读取绘图规范',
  gen: '绘制中 —— 一般 1~3 分钟,改图或复杂画面会更久',
  save: '画面已出,正在保存并自查',
  wrap: '收尾中 —— 校验产物、上画布',
  ended: '本次生成已结束,结果见下面的消息',
}

// codex 的 `--json` 流里混着非 JSON 的诊断行(真机抓到过 rmcp transport 的 ERROR 行)——
// 解析不了就跳过,一行脏数据不该把整条进度链拖垮。
function parseStreamLine(line) {
  const s = String(line || '').trim()
  if (!s || s[0] !== '{') return null
  try { const o = JSON.parse(s); return o && typeof o === 'object' && !Array.isArray(o) ? o : null } catch { return null }
}

// 一条流事件对应哪个阶段(认不出返回 null = 不推进)。判据取自真机流(见 docs/BOARD.md):
// ⭐ `generated_images` 是**唯一能确认「图真的画出来了」的信号** —— 内置 image_gen 把图落在
//    `~/.codex/generated_images/…`,codex 随后 `cp` 到 out;流里没有别的东西能证明这件事。
function stageOfEvent(ev) {
  if (!ev || typeof ev !== 'object') return null
  if (ev.type === 'thread.started' || ev.type === 'turn.started') return 'prep'
  if (ev.type === 'turn.completed' || ev.type === 'turn.failed') return 'wrap'
  const item = ev.item
  if (!item || typeof item !== 'object') return null
  if (item.type === 'command_execution') {
    const cmd = String(item.command || '')
    if (cmd.includes('generated_images')) return 'save' // 图已生成,正在落到 out
    if (cmd.includes('imagegen')) return 'prep' // 在读生图技能说明书 = 还在准备
    return 'gen' // 其余 shell 动作(探环境、查尺寸)一律算「在干活」
  }
  if (item.type === 'agent_message' || item.type === 'mcp_tool_call') return 'gen'
  return null
}

// 阶段只进不退:图落盘之后 codex 还会 `sips` 自查(那是 command_execution ⇒ 认成 'gen'),
// 不钉死单调就会出现「保存中 → 绘制中」来回跳,群里看着像出了问题。
function nextStage(cur, ev) {
  const s = stageOfEvent(ev)
  if (!s) return cur
  const a = IMAGEN_STAGE_ORDER.indexOf(cur)
  const b = IMAGEN_STAGE_ORDER.indexOf(s)
  return b > a ? s : cur
}

// 进度更新节流。⚠ 飞书接口是**租户级 100 万次/月**的共享额度(这台机器画布轮询也开着,单个
// 有画布的群就 ≈4.3 万/月)⇒ 每个流事件 edit 一次是不能接受的,而进度本来也不需要精确到秒。
// 两条闸各治一半:
//   ① 两次更新最少隔 MIN —— 阶段连着变(prep→gen→save 可能只差几秒)也不刷屏;
//   ② 阶段没变也每 HEARTBEAT 刷一次耗时 —— 不刷就又变回「一声不吭」,这正是要修的毛病。
// 账:一次跑满 10 分钟的任务最坏 = 1 次发卡 + 阶段变更 ≤4 次 + 心跳 ≤600/90≈6 次 + 1 次收尾
//     ≈ 12 次调用;并发上限 2、一天几十张图 ⇒ 月增量千级,与画布轮询不是一个量级。
const IMAGEN_PROGRESS_MIN_MS = 15_000
const IMAGEN_PROGRESS_HEARTBEAT_MS = 90_000
const IMAGEN_PROGRESS_TICK_MS = 5_000 // 心跳靠定时器驱动 —— 事件本身很稀(10 分钟才十来条),等事件等不来

function shouldPushProgress({ stage, pushedStage, lastPushAt } = {}, now = Date.now()) {
  if (lastPushAt == null) return true // 还没发过第一条
  const since = now - lastPushAt
  return stage !== pushedStage ? since >= IMAGEN_PROGRESS_MIN_MS : since >= IMAGEN_PROGRESS_HEARTBEAT_MS
}

function fmtElapsed(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

// 进度卡(会被原地更新的那一张)。⚠ 群成员看得到 ⇒ **零工具名、零机器内部路径**:只出现
// 项目内的相对路径(与完成卡同口径)。「不用重复提交」写在卡上是故意的 —— 事故里正是「见失败
// 就原样重投」把队列占死,受理侧的挡板只拦得住 agent,群里的人也该看得见这句。
function buildProgressCard(task, { stage = 'start', elapsedMs = 0, redact = (s) => s } = {}) {
  const name = redact(task.label || task.outRel)
  return {
    schema: '2.0', config: { width_mode: 'default' },
    header: { title: { tag: 'plain_text', content: `🎨 生成中 · ${name}` }, template: 'blue' },
    body: { padding: '12px', vertical_spacing: '8px', elements: [
      { tag: 'markdown', content: `**${IMAGEN_STAGE_TEXT[stage] || IMAGEN_STAGE_TEXT.start}**` },
      { tag: 'markdown', text_size: 'notation', content: `<font color='grey'>⏱ 已用 ${fmtElapsed(elapsedMs)}　·　📄 ${redact(task.outRel)}</font>` },
      { tag: 'markdown', text_size: 'notation', content: "<font color='grey'>生成期间不用重复提交,好了会在这里出图。</font>" },
    ] },
  }
}

// 等图的三态文案(`--wait`)。⚠ 「还没好」**不是失败** —— worker 是 detached 的,受理进程
// 就算被 agent 的 Bash 超时杀掉,图照样会生成、照样发群里。文案必须把这件事说死,否则
// agent 拿到非零退出码会以为要重试,白烧一次额度。
const WAIT_TEXT = {
  ok: (rel) => `✅ 图已生成:${rel}\n可以引用这个文件了。`,
  fail: (rel, why) => `❌ 生图失败:${rel} — ${why}\n换个描述再试;连续失败请检查机器的 codex 登录态/网络。`,
  pending: (rel, sec) => `⏳ 等了 ${sec}s 还没好 —— **任务仍在后台跑,没有失败,也不用重试**。\n` +
    `⚠ 此刻 ${rel} 还不存在,先别把它写进页面/引用它。\n` +
    `生成完会自动发到群里(要查进度:sbot imagen --list)。需要图才能继续的活,等图到了下一轮再做。`,
}

// 等图轮询(`--wait`)的状态机。**抽到这里纯粹为了可测** —— 留在 bin 里就只能靠真跑一次
// 生图来验,而那要烧额度、要等 90s+,结果就是「只验得起超时那一态」。三态各自的下一步差别
// 极大(能不能引用文件 / 要不要重试),恰恰是最该被钉死的地方。
// 依赖全注入(read/reap/now/sleep),不碰 fs 不碰时钟。
async function waitForTask({ read, reap = () => {}, now = Date.now, sleep, deadlineMs, pollMs = 2000 } = {}) {
  for (;;) {
    reap() // 僵尸任务当场落成失败,否则这里会一直等一个永远不会变的 running
    let cur = null
    try { cur = read() } catch { /* 写入竞态:下一轮再读 */ }
    if (cur && cur.status === 'ok') return { status: 'ok' }
    if (cur && cur.status === 'fail') return { status: 'fail', error: cur.error || '未知原因' }
    if (now() >= deadlineMs) return { status: 'pending' }
    await sleep(pollMs)
  }
}

module.exports = {
  IMAGEN_MAX_CONCURRENT, IMAGEN_WALL_MS, WAIT_TEXT, waitForTask,
  imagenDir, buildImagenPrompt, newTask, taskFile, writeTask, readTask, listTasks,
  pidAlive, isLiveTask, countRunning, findRunningForOut, buildDupMessage,
  staleReason, reapStale, checkImageOut, buildDoneMessage, buildFailMessage, buildDoneCard, buildFailCard, failHint,
  partialPath, statOut, quarantinePartial, withPartialNote,
  IMAGEN_STAGE_ORDER, IMAGEN_STAGE_TEXT, IMAGEN_PROGRESS_MIN_MS, IMAGEN_PROGRESS_HEARTBEAT_MS, IMAGEN_PROGRESS_TICK_MS,
  parseStreamLine, stageOfEvent, nextStage, shouldPushProgress, fmtElapsed, buildProgressCard,
}
