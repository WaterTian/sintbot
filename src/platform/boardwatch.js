// 画布自动感知(B3;docs/BOARD.md):画板变化 → 与基线 diff 出「新增 / 改文字 / 删除」→ 群里播报摘要。
// 全程纯 API + 纯函数,**不 spawn agent** —— 读取和播报是确定性操作零模型成本,
// 「要不要执行修改」这个烧额度的决定留给群里的人。
//
// 检测范围(v0.7.1 拍板扩到「改/删」):新增节点 + 改了已有节点的文字内容 + 删除节点都播报;
// 纯挪动/缩放/改样式视作整理,静音吸收(防噪)。为此基线从「id 集(Set)」升级成「id→文字指纹
// (Map)」—— 指纹 = nodeText(node)(注入,与 digest 同一抽取);sig=undefined 表示「文字未知」
// (来自 bot ops 的 add/rewrite,只带 id 不带文字)⇒ 静默采纳当前文字,不算编辑,是 bot 自建内容
// 不被误播的关键。
//
// 两路触发共享同一基线(天然幂等 —— 谁先播完,另一路 diff 为空自动 no-op):
// ① 事件路径(onEvent):board.whiteboard.updated_v1 → 60s 去抖 → flush。真机事实
//    (2026-07-21):该事件不投递到 WS 长连接,此路保留仅作「飞书哪天修好投递」的加速通道。
// ② 轮询路径(startPoll,主触发):每 pollMs 对所有有画布的群 listNodes 一次。
//    静默期门槛(2026-07-22 拍板):画板无 presence API,「用户已停止编辑」只能靠变更静默
//    推断 —— 发现变化不立即播报,押后到下一个 poll 周期指纹不再变化才播累计变化;连续编辑
//    持续押后(播报打断创作无意义),holdRounds 上限兜底防永不播报。指纹 = 全量节点 JSON
//    (拖动/改样式也算「仍在编辑」,只影响押后节奏,不进播报范围)。
//
// 自编辑抑制两套(按触发路径):事件路径靠 operator_ids(去抖窗内全 bot 则静默刷新基线);
// 轮询路径靠 ops journal(boardops.js)—— CLI 写动作留痕服务端返回的持久 id,poll/flush
// 先重放到基线再 diff:add 并入基线,rewrite(del-node 的 overwrite,id 全变)整体重置基线。
// 已知边界:留痕写失败(概率极低)时 bot 的编辑会被当用户新增多播一次,可接受。
//
// 纯工厂:全部依赖注入(listNodes/digest/lookupGroup/notify/readOps/listBoards/timer/log),
// 可单测;与 wswatchdog.js 同款纪律,不 import 任何飞书/引擎模块。
function createBoardWatch({
  debounceMs = 60_000,
  pollMs = 0, // 0 = 不轮询(纯事件模式);daemon 默认也是 0,feishu.board.pollSec 填正数才开
  holdRounds = 5, // 连续编辑最多押后 N 个 poll 周期,之后强制播报(防饿死)
  listNodes, // async (whiteboardId) => nodes[]
  listComments = null, // async (docToken) => comments[](评论第二通道;缺省=只感知节点)
  digest, // (nodes) => { lines: string[] }
  nodeText = () => undefined, // (node) => string —— 节点文字指纹(board.nodeText);缺省 undefined = 只感知新增/不追踪改删(安全降级,bin 注入真实抽取启用改/删)
  lookupGroup, // (whiteboardId) => { chatId, docToken } | null(每次现查 ⇒ 自动跟随配置热重载)
  listBoards = null, // () => [whiteboardId…](轮询清单;每 tick 现查 ⇒ 跟随热重载)
  readOps = null, // (whiteboardId) => [{ts,op,ids}…](bot 侧留痕;boardops.readBoardOps)
  notify, // (chatId, text) => Promise<msgId> —— 文本播报(fallback);调用方负责 redact
  notifyCard = null, // (chatId, cardJson) => Promise<{msgId,cardId}> —— 播报卡(button 确认,2026-07-22);缺则退回 notify 文本
  previewImage = null, // async (whiteboardId) => image_key|null —— 画板整板预览图进卡(卡里直接看画板);失败/缺省降级无图卡
  redact = (s) => s, // 卡片内标注文本逐条脱敏(卡是 JSON 无法整体 redact ⇒ 构卡时逐字段过)
  // 静默期信号(样式/位置变化也算在编辑)。⚠ 必须顺序无关:飞书 GET nodes 返回顺序不稳定
  // (2026-07-22 真机实锤,同批节点两次请求乱序)—— 直接 stringify 指纹恒变 ⇒ 静默期永不
  // 满足,每批新增都押满 holdRounds 才被防饿死兜底播出(2-4 分钟劣化成 10+ 分钟)。
  fingerprint = (nodes) => JSON.stringify([...(nodes || [])].sort((a, b) => String(a && a.id).localeCompare(String(b && b.id)))),
  log = () => {},
  botOpenId = null,
  now = () => Date.now(), // 注入时钟:建线时推进 ops 游标用(单测可控)
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  // prime 失败后的退避重试间隔。开机时网络常常还没就绪(DNS 解析不到),只试一次就会让基线一直空着:
  // 不轮询时(默认)要等第一次画布事件才静默补线,用户重启后画的第一批标注就被吞掉。
  primeRetryMs = [15_000, 30_000, 60_000, 120_000, 300_000],
}) {
  const boards = new Map() // whiteboardId → { timer, baseline:Map<id,sig>|null, commentBaseline:Set|null, sawUser, opsCursor, lastFp, pendingRounds }
  const st = (id) => {
    let s = boards.get(id)
    if (!s) { s = { timer: null, baseline: null, commentBaseline: null, sawUser: false, opsCursor: 0, lastFp: undefined, pendingRounds: 0 }; boards.set(id, s) }
    return s
  }

  // 全量节点 → 基线 Map(id→文字指纹)。id 一律 String 归一(与 diff/ops 键一致)。
  function baselineMap(nodes) {
    const m = new Map()
    for (const n of nodes || []) { if (n && n.id != null) m.set(String(n.id), nodeText(n)) }
    return m
  }

  // 共享 diff 助手(poll/flush 共用,消除重复):prevMap(id→sig)对当前节点求「新增/改文字/删除」。
  //   added   = 当前 id 不在 prevMap
  //   edited  = id 两边都有、prevMap 旧值非 undefined(未知文字不算编辑)、且 sig 变了
  //   deleted = prevMap 里 sig 非 undefined 的 id 不在当前(未知文字的删除不播,边角可接受)
  // undefined 旧值(bot ops add/rewrite 只带 id)⇒ 既不算新增也不算编辑,静默采纳当前文字。
  // editedOld = Map(id→旧文字),供工单摘要标「原文字」;curMap = 当前全量 id→sig(播报后作新基线)。
  function diffBaseline(prevMap, curNodes) {
    const nodes = Array.isArray(curNodes) ? curNodes : []
    const curMap = new Map()
    for (const n of nodes) { if (n && n.id != null) curMap.set(String(n.id), nodeText(n)) }
    const added = []
    const edited = []
    const editedOld = new Map()
    for (const n of nodes) {
      if (!n || n.id == null) continue
      const id = String(n.id)
      if (!prevMap || !prevMap.has(id)) { added.push(n); continue }
      const oldSig = prevMap.get(id)
      if (oldSig === undefined) continue // 文字未知 ⇒ 静默采纳,不算编辑
      if (oldSig !== curMap.get(id)) { edited.push(n); editedOld.set(id, oldSig) }
    }
    const deleted = []
    if (prevMap) for (const [id, sig] of prevMap) { if (sig !== undefined && !curMap.has(id)) deleted.push({ id, oldText: sig }) }
    return { added, edited, deleted, editedOld, curMap }
  }

  // 工单摘要行(喂 agent,takeNotice 返回):新增=digest 行;改文字=digest 行 +(原文字:"旧");
  // 删除=[已删除] id "旧文字"。合并为一个字符串数组。
  function changeDigestLines(changes) {
    const added = (changes && changes.added) || []
    const edited = (changes && changes.edited) || []
    const deleted = (changes && changes.deleted) || []
    const editedOld = (changes && changes.editedOld) || new Map()
    const lines = []
    for (const ln of digest(added).lines) lines.push(ln)
    const eLines = digest(edited).lines
    // 以已截断的行数为准(edited 超 digest 上限时静默丢尾,与 added 分支一致 —— 按原数组遍历会
    // 越界拼出 "undefined",审查证实的真 bug)
    eLines.forEach((ln, i) => {
      const n = edited[i]
      const old = editedOld.get(n && n.id != null ? String(n.id) : '')
      lines.push(ln + (old ? ` (原文字:"${old}")` : ' (文字有改动)'))
    })
    for (const d of deleted) lines.push(`[已删除] ${d.id}${d.oldText ? ` "${d.oldText}"` : ''}`)
    return lines
  }

  // 未解决评论的 id 集(与 digestComments 同款 !is_solved 过滤;字段 comment_id,兜底 id)。
  function unresolvedCommentIds(comments) {
    const out = new Set()
    for (const c of comments || []) {
      if (!c || typeof c !== 'object' || c.is_solved) continue
      const id = c.comment_id || c.id
      if (id) out.add(String(id))
    }
    return out
  }
  // 拉未解决评论 id + 相对基线的新评论(listComments 缺省 / 无 docToken / 失败 ⇒ 空,退化为只感知节点)。
  async function fetchComments(s, group) {
    if (!listComments || !group || !group.docToken) return { all: null, fresh: [] }
    let comments
    try { comments = await listComments(group.docToken) } catch (e) { log('boardwatch comments: ' + (e && e.message)); return { all: null, fresh: [] } }
    const all = unresolvedCommentIds(comments)
    const fresh = s.commentBaseline ? [...all].filter((id) => !s.commentBaseline.has(id)) : []
    return { all, fresh }
  }

  // bot 侧留痕重放到基线(diff 前必调):add 并入,rewrite 重置。游标防重复消费。
  function syncOps(s, whiteboardId) {
    if (!readOps) return
    let ops
    try { ops = readOps(whiteboardId) } catch { return }
    for (const o of ops || []) {
      if (!o || !(Number(o.ts) > s.opsCursor)) continue
      s.opsCursor = Number(o.ts)
      // rewrite(del-node overwrite,id 全变):基线整体重置为新 id 集,文字未知(undefined)⇒ 下一轮
      // 读到真实文字静默采纳,不误报编辑/删除。add:并入新 id(文字未知),bot 放图不自问自答。
      if (o.op === 'rewrite') s.baseline = new Map((o.ids || []).map((id) => [String(id), undefined]))
      else if (o.op === 'add' && s.baseline) for (const id of o.ids || []) { if (!s.baseline.has(String(id))) s.baseline.set(String(id), undefined) }
    }
  }

  // 建基线(daemon 启动时对已有画布调用)。失败按 primeRetryMs 退避重试;重试前基线已被 flush/poll
  // 补上、或画板已不归任何群,就不再试。重试都用完仍失败时,首次 flush/poll 会静默补基线 —— 代价是
  // 错过基线缺失窗口内的第一批标注,好过重启后把整块画布当「新增」重放一遍。
  async function prime(whiteboardId, attempt = 0) {
    const s0 = st(whiteboardId)
    if (s0.primeTimer) { clearTimer(s0.primeTimer); s0.primeTimer = null } // 手动再调一次 = 取代挂着的重试
    try {
      const nodes = await listNodes(whiteboardId)
      const s = st(whiteboardId)
      s.baseline = baselineMap(nodes) // id→文字指纹(不再是纯 id 集)
      s.lastFp = fingerprint(nodes)
      // ⚠ 基线 = 此刻真实全量读取 ⇒ 此前的历史 ops 已尽在其中,游标必须推进到当下。
      // 不推的话 daemon 重启后 cursor 归零重放历史 rewrite,会把新鲜基线拽回旧快照,
      // 用户早已播报过的节点变回「新增」重复播报(2026-07-22 真机踩过:o20:13 重播)。
      s.opsCursor = now()
      const { all } = await fetchComments(s, lookupGroup(whiteboardId)) // 评论基线:现有未解决评论不算新
      if (all) s.commentBaseline = all
    } catch (e) {
      const delay = primeRetryMs[attempt]
      log(`boardwatch prime(${whiteboardId}): ` + (e && e.message) + (delay ? ` · ${Math.round(delay / 1000)}s 后重试` : ''))
      if (!delay) return
      const s = st(whiteboardId)
      s.primeTimer = setTimer(() => {
        s.primeTimer = null
        if (s.baseline || !lookupGroup(whiteboardId)) return
        return prime(whiteboardId, attempt + 1)
      }, delay)
      if (s.primeTimer && s.primeTimer.unref) s.primeTimer.unref() // 不为重试拖住进程退出
    }
  }

  // 事件入口(feishu dispatcher → hooks.onBoardUpdated → 这里)。同一画板连续编辑重置
  // 去抖计时器 —— 等用户画完一批再一次性播报,而不是每一笔都响。
  function onEvent({ whiteboardId, operatorIds = [] } = {}) {
    if (!whiteboardId) return
    const group = lookupGroup(whiteboardId)
    if (!group) return // 不认识的画板(已换新 / 群已解绑)—— 静默忽略
    const s = st(whiteboardId)
    // 空 operator 保守当用户(宁多播一次,不吞用户反馈);出现任何非 bot 操作者即标记
    if (!operatorIds.length || operatorIds.some((id) => id && id !== botOpenId)) s.sawUser = true
    if (s.timer) clearTimer(s.timer)
    s.timer = setTimer(() => {
      s.timer = null
      flush(whiteboardId).catch((e) => log('boardwatch flush: ' + (e && e.message)))
    }, debounceMs)
  }

  // 有啥说啥的数量串(人话):「N 处标注(2 新增·1 修改) · M 条评论」。纯新增沿用「标注」,含改/删
  // 用中性「反馈」;单一变更类型不重复括号明细。changes = {added,edited,deleted}。
  function feedbackCount(changes, freshComments) {
    const added = (changes && changes.added) || []
    const edited = (changes && changes.edited) || []
    const deleted = (changes && changes.deleted) || []
    const nodeTotal = added.length + edited.length + deleted.length
    const parts = []
    if (nodeTotal) {
      const bd = []
      if (added.length) bd.push(`${added.length} 新增`)
      if (edited.length) bd.push(`${edited.length} 修改`)
      if (deleted.length) bd.push(`${deleted.length} 删除`)
      // 纯新增=标注;单一改/删=直说类型(「2 处修改」比「2 处反馈」一眼知性质);混合=反馈+括号明细
      if (bd.length > 1) parts.push(`${nodeTotal} 处反馈(${bd.join('·')})`)
      else if (edited.length) parts.push(`${nodeTotal} 处修改`)
      else if (deleted.length) parts.push(`${nodeTotal} 处删除`)
      else parts.push(`${nodeTotal} 处标注`)
    }
    if ((freshComments || []).length) parts.push(`${freshComments.length} 条评论`)
    return parts.join(' · ')
  }

  function buildMsg(changes, freshComments = [], boardUrl = null, kind = 'apply') {
    const lines = changeDigestLines(changes)
    const cnt = feedbackCount(changes, freshComments) || `${lines.length} 项`
    const sync = kind === 'sync'
    // sync = 用户直接改/删了画布内容(画布已是终态,只需源码收敛);apply = 有新标注/评论(要 agent 产出新版)
    const head = sync ? `✏️ 画布内容已修改(${cnt}):` : `📋 画布有新反馈(${cnt}):`
    const tail = sync ? '\n同步回源码的话给这条消息点 👍' : '\n处理的话给这条消息点 👍,或群里直接说需求'
    return head + '\n' + lines.join('\n') +
      (boardUrl ? `\n画布:${boardUrl}` : '') +
      tail
  }

  // 画布播报卡(Card JSON 2.0;2026-07-22 产品决定:纯文本+点👍 → 卡+点按钮)。callback 按钮点击
  // → card.action.trigger 走 WS → onCardAction → takeNotice(卡片 msgId)命中 → 合成消息喂 engine
  // (与 onReaction 同款工单)。人看的卡只给数量 + 人话引导,**不怼机器摘要**(digest 的
  // `[type] id at(x,y)` 是给 agent 读的工单,人看只觉丑 —— v0.6.8 踩过);技术清单经 noticeDigest 流给
  // agent,评论 agent 现拉。标注+评论合一张卡(避免刷屏)。⚠ 2.0 button:样式=type、文字=text 对象。
  function buildNoticeCard(changes, freshComments = [], { imgKey = null, boardUrl = null, kind = 'apply' } = {}) {
    const nn = (((changes && changes.added) || []).length) + (((changes && changes.edited) || []).length) + (((changes && changes.deleted) || []).length)
    const nc = (freshComments || []).length
    const nAdded = ((changes && changes.added) || []).length
    // sync(v0.7.4)= 用户直接改/删了画布内容(画板已是终态,只需把改动同步回源码,不新增画板版本);
    // 其余为 apply(有新标注/评论 = 要 agent 产出新版)。sync 卡语义完全不同,标题/正文/按钮各走一套。
    const sync = kind === 'sync'
    // 纯新增才叫「新标注」;含改/删(nAdded < nn)用中性「新反馈」,标题不撒谎
    const title = sync ? '✏️ 画布内容已修改' : (nn && !nc ? (nAdded === nn ? '🖌 画布有新标注' : '🖌 画布有新反馈') : (!nn && nc ? '💬 画布有新评论' : '🖌 画布有新反馈'))
    const btnText = sync ? '🔄 同步到源码' : (nc && !nn ? '✅ 按评论处理' : '✅ 按标注改图')
    const bodyText = sync ? '你直接改了画布内容 —— 点下方按钮我把改动同步回源码(不会在画板上新增版本)。' : '点下方按钮确认,我按标注和评论逐条处理,新图放在原图右侧方便对比。'
    const confirmBtn = { tag: 'button', type: 'primary', width: 'fill', text: { tag: 'plain_text', content: btnText }, behaviors: [{ type: 'callback', value: { a: 'boardgo' } }] }
    const elements = []
    // 画板整板预览图:群里不点开也能看到新标注长什么样;点击放大细看
    if (imgKey) elements.push({ tag: 'img', img_key: imgKey, scale_type: 'fit_horizontal', corner_radius: '8px', preview: true, alt: { tag: 'plain_text', content: '画板当前内容' } })
    elements.push({ tag: 'markdown', content: bodyText })
    // 有画板链接 ⇒ 双按钮并排(主=确认开工,次=去画布细看);无 ⇒ 单确认按钮
    if (boardUrl) {
      elements.push({ tag: 'column_set', horizontal_spacing: 'medium', columns: [
        { tag: 'column', width: 'weighted', weight: 1, elements: [confirmBtn] },
        { tag: 'column', width: 'weighted', weight: 1, elements: [{ tag: 'button', type: 'default', width: 'fill', text: { tag: 'plain_text', content: '👀 去画布查看' }, behaviors: [{ type: 'open_url', default_url: boardUrl }] }] },
      ] })
    } else {
      elements.push(confirmBtn)
    }
    elements.push({ tag: 'markdown', text_size: 'notation', content: "<font color='grey'>不急的话可以继续标注/评论,或直接在群里说想法。</font>" })
    // 「忽略」低调次要按钮(v0.7.1):功能上「不点」已等于忽略(基线已推进不重播、标注保留),此按钮的价值
    // = 消歧(卡不再像活跃待办)+ 防误触(点它消费锚点,防日后误点老卡的 👍 意外触发整轮 agent)。
    elements.push({ tag: 'button', type: 'default', width: 'default', text: { tag: 'plain_text', content: '🙈 忽略' }, behaviors: [{ type: 'callback', value: { a: 'boardskip' } }] })
    return {
      schema: '2.0', config: { width_mode: 'default' },
      header: {
        title: { tag: 'plain_text', content: title },
        subtitle: { tag: 'plain_text', content: sync ? `你在画布上直接改了 ${feedbackCount(changes, freshComments)}` : `你在设计画布上留了 ${feedbackCount(changes, freshComments)} 的反馈` },
        template: 'blue',
      },
      body: { padding: '16px', vertical_spacing: '12px', elements },
    }
  }

  // 「已忽略」静默灰卡(v0.7.1):点「🙈 忽略」后翻卡定格,无按钮 —— 明确这批反馈已消歧、不再是待办。
  function buildSkippedCard() {
    return {
      schema: '2.0', config: { width_mode: 'default' },
      header: { title: { tag: 'plain_text', content: '🙈 已忽略画布反馈' }, template: 'grey' },
      body: { padding: '16px', vertical_spacing: '8px', elements: [
        { tag: 'markdown', content: '已跳过这批反馈,标注仍保留在画布上。想处理随时在群里说一声;在画布上新加标注或改动文字会再次提醒。' },
      ] },
    }
  }

  // 「处理中」态卡 —— 按钮点击后经 WS 回传的 3s 响应更新播报卡(去掉按钮防重复点)。
  // digestLines 只含标注(节点)—— 纯评论轮为空,副标题退成通用「画布反馈」,不谎报「标注」。
  function buildAckCard(digestLines, kind = 'apply') {
    const n = (digestLines || []).length
    const sync = kind === 'sync'
    return {
      schema: '2.0', config: { width_mode: 'default' },
      header: {
        title: { tag: 'plain_text', content: sync ? '🔄 同步源码中…' : '🖌 处理画布反馈中…' },
        subtitle: { tag: 'plain_text', content: sync ? (n ? `正在同步 ${n} 处画布改动` : '正在同步画布改动') : (n ? `正在处理 ${n} 处画布反馈(评论一并处理)` : '正在处理画布反馈') },
        template: 'blue',
      },
      body: { padding: '16px', vertical_spacing: '8px', elements: [
        { tag: 'markdown', content: sync ? '正在把你在画布上的改动同步回源码 —— 不会新增画板版本,完成后群里复述。' : '已开工,处理完会把结果更新到这张卡,并在群里逐条复述改动。' },
      ] },
    }
  }

  // 播报送达后记消息 id + 本轮标注摘要 ⇒ 按钮/表情确认的锚点与工单内容(触发消息自带标注清单,
  // agent 明确知道这轮处理哪几条 —— 不靠删除标注区分新旧,2026-07-22 产品决定「不删标注」后的
  // 机制)。新播报覆盖旧锚点(只认最新一条)。发卡优先(notifyCard),失败/未注入退回文本。
  // 通知形态分流(v0.7.4):纯「改文字/删除」且无新增、无新评论 ⇒ 'sync'(用户直接改了画布,画板已是
  // 终态,确认后只把改动同步回源码、不重渲不新增版本);其余 ⇒ 'apply'(有新标注/评论 = 要 agent 产出新版)。
  // 内容节点类型:图表框/图片 —— 用户直接改这些 = 改「成品内容」,该 sync(收敛回源码不出新版)。
  // 标注类型(sticky_note/connector/自由 text_shape/paint)不在内:改它们是在**细化意见**,该走 apply
  // 产出新版(审查 M1:纯结构判据会把「改一条便签」误当 sync 丢掉意图)。text_shape 有歧义(可能是
  // 图表标签也可能是自由批注)⇒ 保守归 apply —— applyText 已教 agent 分辨图表内容 vs 便签措辞,不损。
  const CONTENT_TYPES = new Set(['composite_shape', 'mind_map', 'image'])
  function noticeKindOf(changes, freshComments) {
    const edited = (changes && changes.edited) || []
    const deleted = (changes && changes.deleted) || []
    const added = (changes && changes.added) || []
    if (added.length || (freshComments || []).length) return 'apply' // 有新增/新评论 = 要产出新版
    if (!edited.length && !deleted.length) return 'apply' // 无变化(不应走到发卡)
    // 纯删除(edited 空)= 用户删定了内容,同步语义;有编辑则要求**全部**是内容节点才 sync
    return edited.every((n) => n && CONTENT_TYPES.has(n.type)) ? 'sync' : 'apply'
  }

  async function notifyAndTrack(s, whiteboardId, group, changes, freshComments = []) {
    const chatId = group.chatId
    const kind = noticeKindOf(changes, freshComments)
    // 预览聚焦用「有几何」的变更(新增+编辑);删除无几何跳过。
    const geoNodes = ((changes && changes.added) || []).concat((changes && changes.edited) || [])
    // notifyCard 返回 { msgId, cardId }(cardId=实体卡回填锚点);旧式/文本 notify 返回裸 msgId 字符串。
    let mid = null
    let cardId = null
    if (notifyCard) {
      // 画板预览图尽力而为(导出+裁剪+上传约 1-3s,轮询后台无感;失败/无注入 ⇒ 无图卡照发,绝不
      // 阻断播报)。geoNodes 传下去 ⇒ 预览聚焦到新标注附近而非整板。
      let imgKey = null
      if (previewImage) imgKey = await Promise.resolve(previewImage(whiteboardId, geoNodes)).catch((e) => { log('boardwatch preview: ' + (e && e.message)); return null })
      const r = await Promise.resolve(notifyCard(chatId, buildNoticeCard(changes, freshComments, { imgKey, boardUrl: group.url || null, kind }))).catch((e) => { log('boardwatch notifyCard: ' + (e && e.message)); return null })
      if (r) { mid = (typeof r === 'object') ? r.msgId : r; cardId = (typeof r === 'object' && r.cardId) || null }
    }
    if (!mid) mid = await Promise.resolve(notify(chatId, buildMsg(changes, freshComments, group.url || null, kind))).catch((e) => { log('boardwatch notify: ' + (e && e.message)); return null })
    if (mid) { s.noticeMsgId = mid; s.noticeCardId = cardId; s.noticeDigest = changeDigestLines(changes); s.noticeKind = kind }
  }

  // 确认入口(bin 的 onReaction/onCardAction → 这里):msgId 命中某画布最新播报 → 消费并返回归属
  // + 该轮标注摘要 + 播报卡实体 cardId(单卡回填锚点)。消费即清 ⇒ 多人点/重复点只触发一次;
  // 未命中返回 null(不相干消息)。opts.peek=true 只查不消费 —— 暂停群检查等「先看后拒」场景用
  // (拒绝时不消费,恢复后用户再点仍有效)。
  function takeNotice(msgId, opts = {}) {
    if (!msgId) return null
    for (const [wb, s] of boards) {
      if (s.noticeMsgId && s.noticeMsgId === msgId) {
        const digestLines = s.noticeDigest || []
        const cardId = s.noticeCardId || null
        const kind = s.noticeKind || 'apply' // 'sync'(直接改画布,只同步源码)/ 'apply'(有新标注/评论,出新版)
        if (!opts.peek) { s.noticeMsgId = null; s.noticeDigest = null; s.noticeCardId = null; s.noticeKind = null }
        const g = lookupGroup(wb)
        return g ? { whiteboardId: wb, chatId: g.chatId, digestLines, cardId, kind } : null
      }
    }
    return null
  }

  async function flush(whiteboardId) {
    const group = lookupGroup(whiteboardId)
    const s = st(whiteboardId)
    const sawUser = s.sawUser
    s.sawUser = false
    syncOps(s, whiteboardId)
    let nodes
    try {
      nodes = await listNodes(whiteboardId)
    } catch (e) {
      log(`boardwatch read(${whiteboardId}): ` + (e && e.message))
      return // 基线保持不动 —— 下次事件重试,不丢用户这批改动的可播报性
    }
    const prev = s.baseline
    const changes = diffBaseline(prev, nodes)
    s.baseline = changes.curMap
    s.lastFp = fingerprint(nodes)
    s.pendingRounds = 0 // 事件路径播完即结算,轮询侧不再押这批
    if (!group || !sawUser || !prev) { if (!prev) s.opsCursor = now(); return } // 无归属 / 纯 bot 编辑 / 无基线(静默建线防重放;游标同步推进)
    if (!changes.added.length && !changes.edited.length && !changes.deleted.length) return // 纯移动/改样式 —— 不进播报范围(事件路径不拉评论)
    await notifyAndTrack(s, whiteboardId, group, changes)
  }

  // 轮询主入口(每 pollMs 对单画板跑一次)。
  async function poll(whiteboardId) {
    const group = lookupGroup(whiteboardId)
    if (!group) return
    const s = st(whiteboardId)
    syncOps(s, whiteboardId)
    let nodes
    try {
      nodes = await listNodes(whiteboardId)
    } catch (e) {
      log(`boardwatch poll(${whiteboardId}): ` + (e && e.message))
      return // 基线/pending 不动,下轮重试
    }
    const fp = fingerprint(nodes)
    const { all: allComments, fresh: freshComments } = await fetchComments(s, group) // 评论第二通道(缺省=空)
    if (!s.baseline) { s.baseline = baselineMap(nodes); s.lastFp = fp; s.opsCursor = now(); if (allComments) s.commentBaseline = allComments; return } // 静默建线(冷启动不重放整板;游标推进防历史 ops 重放,同 prime)
    const changed = s.lastFp !== fp
    s.lastFp = fp
    const changes = diffBaseline(s.baseline, nodes)
    const meaningful = changes.added.length || changes.edited.length || changes.deleted.length
    if (!meaningful && !freshComments.length) { s.baseline = changes.curMap; if (allComments) s.commentBaseline = allComments; s.pendingRounds = 0; return } // 纯移/样式 + 无新评论 → 静默吸收
    // 仍在编辑节点 → 押后一轮(评论一起等,避免节点半途 + 评论各发一张卡);评论是离散帖,无节点变化时
    // 指纹不变 changed=false ⇒ 不押、立即播(只加评论也能被感知,不受节点静默期拖累)。
    if (changed && s.pendingRounds < holdRounds) { s.pendingRounds++; return }
    // 安静满一周期(或押满 holdRounds)→ 播累计变化(新增/改文字/删除 + 评论),推进两条基线
    s.baseline = changes.curMap
    if (allComments) s.commentBaseline = allComments
    s.pendingRounds = 0
    await notifyAndTrack(s, whiteboardId, group, changes, freshComments)
  }

  async function pollAll() {
    for (const wb of (listBoards && listBoards()) || []) {
      try { await poll(wb) } catch (e) { log(`boardwatch poll(${wb}): ` + (e && e.message)) }
    }
  }

  let pollTimer = null
  let polling = false
  function startPoll() {
    if (!pollMs || !listBoards || polling) return
    polling = true
    const loop = () => {
      if (!polling) return
      // 回调返回 promise 链:真 timer 不在乎,注入的测试 timer 可 await 到整轮完成
      pollTimer = setTimer(() => pollAll().catch(() => {}).then(loop), pollMs)
      if (pollTimer && pollTimer.unref) pollTimer.unref() // 不为轮询拖住进程退出
    }
    loop()
  }
  function stopPoll() {
    polling = false
    if (pollTimer) { clearTimer(pollTimer); pollTimer = null }
  }

  return { prime, onEvent, startPoll, stopPoll, takeNotice, buildNoticeCard, buildAckCard, buildSkippedCard, _flush: flush, _poll: poll, _pollAll: pollAll, _boards: boards } // _ 前缀仅供单测
}

module.exports = { createBoardWatch }
