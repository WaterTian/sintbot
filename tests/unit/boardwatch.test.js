// boardwatch(画布自动感知)—— 事件去抖 / 轮询静默期 / 基线 diff / 自编辑抑制(operator + ops)/ 失败容错
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createBoardWatch } = require('../../src/platform/boardwatch')
const { nodeText } = require('../../src/platform/board') // 真实文字抽取(改文字/删除感知的指纹源)

// 可控计时器:捕获回调手动触发,不真等
function fakeTimers() {
  const pending = []
  return {
    pending,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; pending.push(t); return t },
    clearTimer: (t) => { if (t) t.cleared = true },
    fire: async () => { const live = pending.filter((t) => !t.cleared); pending.length = 0; for (const t of live) await t.fn() },
  }
}

function makeWatch(over = {}) {
  const timers = fakeTimers()
  const sent = []
  const state = {
    nodes: [],
    listCalls: 0,
    watch: null,
    timers,
    sent,
  }
  state.ops = [] // 可变 ops journal(轮询自编辑抑制;测试直接 push)
  state.watch = createBoardWatch({
    debounceMs: 60_000,
    pollMs: over.pollMs || 0,
    holdRounds: over.holdRounds !== undefined ? over.holdRounds : 5,
    listNodes: over.listNodes || (async () => { state.listCalls++; return state.nodes }),
    digest: (nodes) => ({ lines: nodes.map((n) => `[${n.type || '?'}] ${n.id}`) }),
    nodeText: over.nodeText || nodeText, // 真实文字指纹 ⇒ 改文字/删除可感知(不注入则只感知新增)
    lookupGroup: over.lookupGroup || ((wb) => (wb === 'wb1' ? { chatId: 'oc_g1' } : null)),
    listBoards: over.listBoards || (() => ['wb1']),
    readOps: over.readOps !== undefined ? over.readOps : (() => state.ops),
    notify: async (chatId, text) => { sent.push({ chatId, text }); return 'om_mock_' + sent.length }, // 返回消息 id(点表情触发的锚点)
    botOpenId: 'ou_bot',
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    log: () => {},
  })
  return state
}

test('boardwatch: 未知画板事件不设去抖计时器', () => {
  const s = makeWatch()
  s.watch.onEvent({ whiteboardId: 'wb_unknown', operatorIds: ['ou_user'] })
  assert.equal(s.timers.pending.length, 0)
})

test('boardwatch: 连续事件重置去抖,只触发一次 flush', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'n1', type: 'image' }]
  await s.watch.prime('wb1') // 基线 n1
  s.watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  s.watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  assert.equal(s.timers.pending.filter((t) => !t.cleared).length, 1) // 前一个被 clear
  s.nodes = [{ id: 'n1', type: 'image' }, { id: 'c1', type: 'connector' }]
  await s.timers.fire()
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /1 处标注/)
  assert.match(s.sent[0].text, /\[connector\] c1/)
  assert.equal(s.sent[0].chatId, 'oc_g1')
})

test('boardwatch: 纯 bot 操作者 → 静默刷新基线不播报;随后用户新增按新基线 diff', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'n1', type: 'image' }]
  await s.watch.prime('wb1')
  // bot 自己放图(id 变多)—— 不播报,但基线要吸收
  s.nodes = [{ id: 'n1', type: 'image' }, { id: 'n2', type: 'image' }]
  s.watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_bot'] })
  await s.timers.fire()
  assert.equal(s.sent.length, 0)
  // 用户随后画箭头 —— 只播报箭头,不把 n2 当新增
  s.nodes = [{ id: 'n1', type: 'image' }, { id: 'n2', type: 'image' }, { id: 'c9', type: 'connector' }]
  s.watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  await s.timers.fire()
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /c9/)
  assert.doesNotMatch(s.sent[0].text, /n2/)
})

test('boardwatch: 空 operator_ids 保守当用户处理(播报)', async () => {
  const s = makeWatch()
  s.nodes = []
  await s.watch.prime('wb1')
  s.nodes = [{ id: 'x1', type: 'sticky_note' }]
  s.watch.onEvent({ whiteboardId: 'wb1', operatorIds: [] })
  await s.timers.fire()
  assert.equal(s.sent.length, 1)
})

test('boardwatch: 无基线(prime 失败)首次 flush 静默建线,不重放整板', async () => {
  const s = makeWatch()
  // 不 prime —— baseline 为 null
  s.nodes = [{ id: 'old1', type: 'image' }, { id: 'old2', type: 'text_shape' }]
  s.watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  await s.timers.fire()
  assert.equal(s.sent.length, 0) // 静默建线
  s.nodes = [...s.nodes, { id: 'new1', type: 'connector' }]
  s.watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  await s.timers.fire()
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /new1/)
})

test('boardwatch: prime 失败(开机网络没就绪)退避重试,成功后补上基线 —— 之后第一批标注照常播报', async () => {
  let fails = 2
  const s = makeWatch({ listNodes: async () => { if (fails > 0) { fails--; throw new Error('getaddrinfo ENOTFOUND open.feishu.cn') } return s.nodes } })
  s.nodes = [{ id: 'old1', type: 'image' }]
  await s.watch.prime('wb1')
  assert.equal(s.watch._boards.get('wb1').baseline, null)
  assert.deepEqual(s.timers.pending.filter((t) => !t.cleared).map((t) => t.ms), [15_000])
  await s.timers.fire() // 第 2 次仍失败 → 排第 3 次
  assert.deepEqual(s.timers.pending.filter((t) => !t.cleared).map((t) => t.ms), [30_000])
  await s.timers.fire() // 第 3 次成功
  assert.ok(s.watch._boards.get('wb1').baseline.has('old1'))
  assert.equal(s.timers.pending.filter((t) => !t.cleared).length, 0)
  s.nodes = [...s.nodes, { id: 'new1', type: 'connector' }]
  s.watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  await s.timers.fire()
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /new1/)
})

test('boardwatch: prime 重试有上限;基线已被别的路径补上、或画板已解绑,就不再重试', async () => {
  const s = makeWatch({ listNodes: async () => { throw new Error('ENOTFOUND') } })
  await s.watch.prime('wb1')
  for (let i = 0; i < 10; i++) await s.timers.fire()
  assert.equal(s.timers.pending.filter((t) => !t.cleared).length, 0) // 5 次重试后停

  let calls = 0
  let bound = true
  const s2 = makeWatch({ listNodes: async () => { calls++; throw new Error('ENOTFOUND') }, lookupGroup: (wb) => (bound && wb === 'wb1' ? { chatId: 'oc_g1' } : null) })
  await s2.watch.prime('wb1')
  bound = false
  await s2.timers.fire()
  assert.equal(calls, 1) // 解绑后到点的重试直接放弃,不再读

  let calls3 = 0
  const s3 = makeWatch({ listNodes: async () => { calls3++; throw new Error('ENOTFOUND') } })
  await s3.watch.prime('wb1')
  s3.watch._boards.get('wb1').baseline = new Map() // 模拟 flush / poll 已静默建线
  await s3.timers.fire()
  assert.equal(calls3, 1)
})

test('boardwatch: flush 读取失败 → 不播报、基线不动、不抛', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'n1', type: 'image' }]
  await s.watch.prime('wb1')
  const goodList = async () => s.nodes
  let failOnce = true
  s.watch._boards.get('wb1') // 存在性
  // 注入一次性失败
  const s2 = makeWatch({ listNodes: async () => { if (failOnce) { failOnce = false; throw new Error('4003101') } return s2.nodes } })
  s2.nodes = [{ id: 'n1', type: 'image' }]
  // prime 会吃掉第一次失败 → baseline null;再 prime 成功建线
  await s2.watch.prime('wb1')
  await s2.watch.prime('wb1')
  s2.nodes = [{ id: 'n1', type: 'image' }, { id: 'c1', type: 'connector' }]
  s2.watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  await s2.timers.fire()
  assert.equal(s2.sent.length, 1)
  void goodList
})

test('boardwatch: 纯移动(改坐标不改文字)不播报', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'n1', type: 'text_shape', text: { text: '保持' }, x: 0, y: 0 }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 'n1', type: 'text_shape', text: { text: '保持' }, x: 200, y: 100 }] // 只挪位置,文字不变
  s.watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  await s.timers.fire()
  assert.equal(s.sent.length, 0) // 挪动视作整理,不打扰
})

// ───────────────────────── 轮询路径(静默期门槛 + ops 自编辑抑制) ─────────────────────────

test('poll: 无基线首次轮询静默建线,不重放整板', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'old1', type: 'image' }, { id: 'old2', type: 'text_shape' }]
  await s.watch._poll('wb1')
  assert.equal(s.sent.length, 0)
})

test('poll: 静默期门槛 —— 发现新增押后一轮,下一轮安静才播报', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'n1', type: 'image' }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 'n1', type: 'image' }, { id: 'c1', type: 'connector' }] // 用户画箭头
  await s.watch._poll('wb1')
  assert.equal(s.sent.length, 0) // 变化刚发现,可能还在编辑 → 押后
  await s.watch._poll('wb1') // 一整轮没再变 → 编辑已停
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /c1/)
  assert.equal(s.sent[0].chatId, 'oc_g1')
  await s.watch._poll('wb1') // 播过即入基线,不重播
  assert.equal(s.sent.length, 1)
})

test('poll: 连续编辑持续押后,累计新增一次播;押满 holdRounds 强制播(防饿死)', async () => {
  const s = makeWatch({ holdRounds: 3 })
  s.nodes = [{ id: 'n1', type: 'image' }]
  await s.watch.prime('wb1')
  // 用户每轮都在加新节点 —— 每轮指纹都变,持续押后
  for (let i = 1; i <= 3; i++) {
    s.nodes = [...s.nodes, { id: 'c' + i, type: 'connector' }]
    await s.watch._poll('wb1')
    assert.equal(s.sent.length, 0, `第 ${i} 轮仍在押后`)
  }
  s.nodes = [...s.nodes, { id: 'c4', type: 'connector' }] // 第 4 轮仍在编辑,但押满上限
  await s.watch._poll('wb1')
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /4 处标注/) // 累计的 c1-c4 一次播出
})

test('poll: ops add 留痕 → bot 放图不播报;混窗时只播用户新增', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'n1', type: 'image' }]
  await s.watch.prime('wb1')
  // bot add-image(CLI 留痕)+ 用户同窗画了箭头
  s.nodes = [{ id: 'n1', type: 'image' }, { id: 'bot1', type: 'image' }, { id: 'u1', type: 'connector' }]
  s.ops.push({ ts: Date.now() + 50, op: 'add', ids: ['bot1'] }) // ts 在 prime 之后(建线会推进游标)
  await s.watch._poll('wb1') // 押后
  await s.watch._poll('wb1') // 安静 → 播
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /u1/)
  assert.doesNotMatch(s.sent[0].text, /bot1/) // bot 自己的图被留痕吸收
})

test('poll: ops rewrite(del-node overwrite,id 全变)→ 基线重置不重放整板;此后用户新增照播', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'a1', type: 'image' }, { id: 'a2', type: 'connector' }]
  await s.watch.prime('wb1')
  // bot del-node:删 a2,overwrite 后保留节点 id 全变(a1→z1)
  s.nodes = [{ id: 'z1', type: 'image' }]
  s.ops.push({ ts: Date.now() + 50, op: 'rewrite', ids: ['z1'] }) // ts 在 prime 之后
  await s.watch._poll('wb1')
  await s.watch._poll('wb1')
  assert.equal(s.sent.length, 0) // id 全变但有留痕 → 静默
  // 用户随后画新箭头
  s.nodes = [{ id: 'z1', type: 'image' }, { id: 'u9', type: 'connector' }]
  await s.watch._poll('wb1')
  await s.watch._poll('wb1')
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /u9/)
})

test('poll: 服务端返回顺序乱序不算「仍在编辑」— 指纹顺序无关(真机实锤:飞书 GET nodes 顺序不稳定)', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'n1', type: 'image' }, { id: 'n2', type: 'text_shape' }]
  await s.watch.prime('wb1')
  // 用户画了箭头;且服务端这次把节点乱序返回 —— 乱序不该触发押后累加
  s.nodes = [{ id: 'c1', type: 'connector' }, { id: 'n2', type: 'text_shape' }, { id: 'n1', type: 'image' }]
  await s.watch._poll('wb1') // 真变化(新增 c1)→ 押后一轮
  s.nodes = [{ id: 'n2', type: 'text_shape' }, { id: 'n1', type: 'image' }, { id: 'c1', type: 'connector' }] // 又乱序,内容没变
  await s.watch._poll('wb1') // 指纹顺序无关 ⇒ 视为安静 → 播报
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /c1/)
})

test('poll: 纯样式/位置变化(指纹变、无新增)不播报、静默吸收', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'n1', type: 'image', x: 0 }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 'n1', type: 'image', x: 100 }] // 用户拖动了图
  await s.watch._poll('wb1')
  await s.watch._poll('wb1')
  assert.equal(s.sent.length, 0)
})

test('poll: 读失败不播报不抛,pending 保留下轮重试', async () => {
  let fail = false
  const s = makeWatch({ listNodes: async () => { if (fail) throw new Error('4003101'); return s.nodes } })
  s.nodes = [{ id: 'n1', type: 'image' }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 'n1', type: 'image' }, { id: 'c1', type: 'connector' }]
  await s.watch._poll('wb1') // 押后(pendingRounds=1)
  fail = true
  await s.watch._poll('wb1') // 读失败 → 静默
  assert.equal(s.sent.length, 0)
  fail = false
  await s.watch._poll('wb1') // 恢复且安静 → 播
  assert.equal(s.sent.length, 1)
})

test('poll↔事件共享基线幂等:事件 flush 播过后轮询不重播', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'n1', type: 'image' }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 'n1', type: 'image' }, { id: 'c1', type: 'connector' }]
  s.watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  await s.timers.fire() // 事件路径先播
  assert.equal(s.sent.length, 1)
  await s.watch._poll('wb1')
  await s.watch._poll('wb1')
  assert.equal(s.sent.length, 1) // 轮询 diff 为空,no-op
})

test('takeNotice: 播报消息被点表情 → 命中归属并消费(防重);未知 id 不相干;新播报覆盖旧锚点', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'n1', type: 'image' }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 'n1', type: 'image' }, { id: 'c1', type: 'connector' }]
  await s.watch._poll('wb1'); await s.watch._poll('wb1') // 播报 #1 → om_mock_1
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /点 👍/) // 文案引导点表情
  assert.equal(s.watch.takeNotice('om_other'), null) // 别的消息被点表情,不相干
  const hit = s.watch.takeNotice('om_mock_1')
  assert.equal(hit.whiteboardId, 'wb1')
  assert.equal(hit.chatId, 'oc_g1')
  assert.deepEqual(hit.digestLines, ['[connector] c1']) // 触发自带本轮标注清单(agent 据此不碰旧标注)
  assert.equal(s.watch.takeNotice('om_mock_1'), null, '消费即清 — 多人点/重复点只触发一次')
  // 新播报覆盖旧锚点:旧播报 id 失效,只认最新一条
  s.nodes = [...s.nodes, { id: 'c2', type: 'connector' }]
  await s.watch._poll('wb1'); await s.watch._poll('wb1') // 播报 #2 → om_mock_2
  s.nodes = [...s.nodes, { id: 'c3', type: 'connector' }]
  await s.watch._poll('wb1'); await s.watch._poll('wb1') // 播报 #3 → om_mock_3
  assert.equal(s.watch.takeNotice('om_mock_2'), null, '旧播报锚点已被覆盖')
  const hit3 = s.watch.takeNotice('om_mock_3')
  assert.equal(hit3.chatId, 'oc_g1')
  assert.deepEqual(hit3.digestLines, ['[connector] c3']) // 摘要跟随最新播报
})

test('poll: 重启后历史 ops 不重放 — prime 建线推进游标,历史 rewrite 不拽回基线(真机:o20:13 重复播报)', async () => {
  // 场景还原:重启前 ops 文件里躺着历史 rewrite(旧节点集快照);重启后 prime 从当前
  // 真实节点建线(含用户早已播报过的 o1);若历史 rewrite 被重放,基线被拽回旧快照,o1 重播。
  const s = makeWatch()
  s.ops.push({ ts: Date.now() - 60_000, op: 'rewrite', ids: ['old1'] }) // 历史快照(不含 o1)
  s.nodes = [{ id: 'old1', type: 'image' }, { id: 'o1', type: 'composite_shape' }] // 当前真实画布
  await s.watch.prime('wb1') // 建线含 o1,游标推进
  await s.watch._poll('wb1')
  await s.watch._poll('wb1')
  assert.equal(s.sent.length, 0, '历史 ops 不得重放 — o1 已在基线,不重复播报')
})

test('poll: 不认识的画板静默忽略;pollAll 单板失败不拖累其余', async () => {
  const calls = []
  const s = makeWatch({
    listBoards: () => ['wb_unknown', 'wb1'],
    listNodes: async (wb) => { calls.push(wb); if (wb === 'wb_bad') throw new Error('boom'); return s.nodes },
  })
  s.nodes = [{ id: 'n1', type: 'image' }]
  await s.watch._pollAll()
  assert.deepEqual(calls, ['wb1']) // unknown 连 list 都不调
})

test('poll: startPoll 周期驱动 pollAll,stopPoll 后停止', async () => {
  const s = makeWatch({ pollMs: 120_000 })
  s.nodes = [{ id: 'n1', type: 'image' }]
  s.watch.startPoll()
  assert.equal(s.timers.pending.filter((t) => !t.cleared).length, 1)
  await s.timers.fire() // 第一轮 poll(静默建线)+ 排下一轮
  assert.equal(s.listCalls, 1)
  assert.equal(s.timers.pending.filter((t) => !t.cleared).length, 1)
  s.watch.stopPoll()
  assert.equal(s.timers.pending.filter((t) => !t.cleared).length, 0)
})

// 播报卡 + 按钮确认(v0.6.8;真机修:按钮字段 type/text 对象、卡不怼机器摘要)。
// ⚠ 2.0 button:样式=type(非 button_style)、文字=text 对象(非 content 字符串)—— 写错渲染空白按钮。
test('boardwatch: 播报卡 buildNoticeCard(按钮 type+text 正确 / callback boardgo / 数量入副标题)', () => {
  const timers = fakeTimers()
  const watch = createBoardWatch({
    listNodes: async () => [], digest: () => ({ lines: [] }), lookupGroup: () => null, notify: async () => 'm',
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {},
  })
  const nc = watch.buildNoticeCard({ added: [{ id: 'a', type: 'connector' }, { id: 'b', type: 'text' }] })
  assert.equal(nc.schema, '2.0')
  assert.equal(nc.header.template, 'blue')
  assert.match(nc.header.subtitle.content, /2 处/) // 数量在副标题
  const btn = nc.body.elements.find((e) => e.tag === 'button')
  assert.equal(btn.type, 'primary') // 样式字段是 type,不是 button_style
  assert.equal(btn.text.tag, 'plain_text') // 文字是对象,不是 content 字符串
  assert.ok(btn.text.content && !('content' in btn)) // 有 text.content、没有裸 content
  assert.equal(btn.behaviors[0].type, 'callback')
  assert.deepEqual(btn.behaviors[0].value, { a: 'boardgo' })
  const ack = watch.buildAckCard(['[connector] a'])
  assert.match(ack.header.title.content, /处理画布反馈中/)
  assert.match(ack.header.subtitle.content, /1 处画布反馈/) // v0.7.1 审查后改中性词(digestLines 可含改/删行,不再谎称「标注」)
  assert.equal(ack.body.elements.find((e) => e.tag === 'button'), undefined) // 处理中态去按钮
  const ackEmpty = watch.buildAckCard([]) // 纯评论轮:digestLines 空,不谎报「标注」
  assert.doesNotMatch(ackEmpty.header.subtitle.content, /标注/)
})

test('boardwatch: 播报卡不怼机器摘要(digest 的 [type] id at(x,y) 只给 agent,不进人看的卡)', () => {
  const timers = fakeTimers()
  const watch = createBoardWatch({
    listNodes: async () => [], digest: (nodes) => ({ lines: nodes.map((n) => `[composite_shape] ${n.id} at(672,3968)`) }),
    lookupGroup: () => null, notify: async () => 'm',
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {},
  })
  const nc = watch.buildNoticeCard({ added: [{ id: 'o29:14' }] })
  assert.doesNotMatch(JSON.stringify(nc), /composite_shape|at\(672/) // 机器摘要不出现在卡里
  assert.doesNotMatch(JSON.stringify(nc), /o29:14/)
})

test('boardwatch: notifyCard 发卡 → noticeMsgId=卡 msgId,takeNotice 命中并消费', async () => {
  const timers = fakeTimers()
  let nodes = [{ id: 'n1' }]
  const watch = createBoardWatch({
    debounceMs: 1, pollMs: 0,
    listNodes: async () => nodes,
    digest: (n) => ({ lines: n.map((x) => `[t] ${x.id}`) }),
    lookupGroup: (wb) => (wb === 'wb1' ? { chatId: 'oc_g1' } : null),
    notify: async () => 'om_text',
    notifyCard: async () => 'om_card_1',
    botOpenId: 'ou_bot', setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {},
  })
  await watch.prime('wb1') // 基线 {n1}
  nodes = [{ id: 'n1' }, { id: 'n2' }] // 用户加了 n2
  watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] }) // 置 sawUser
  await watch._flush('wb1') // 直接 flush(避免去抖回调 fire-and-forget 的微任务竞态)→ notifyCard
  const hit = watch.takeNotice('om_card_1')
  assert.ok(hit, '卡片 msgId 命中')
  assert.equal(hit.chatId, 'oc_g1')
  assert.equal(watch.takeNotice('om_card_1'), null, '消费即清 — 重复点/多人点只触发一次')
})

// 评论第二通道(v0.6.9):轮询也拉未解决评论 → 新评论也触发播报(只加评论也感知),合并进反馈卡计数。
test('poll: 只加评论(节点不变)也触发播报 —— 评论离散不受节点静默期拖累,标题/计数按评论走', async () => {
  const timers = fakeTimers()
  const nodes = [{ id: 'n1' }]
  let comments = [{ comment_id: 'cm1', is_solved: false }]
  const cards = []
  const watch = createBoardWatch({
    pollMs: 0,
    listNodes: async () => nodes,
    listComments: async () => comments,
    digest: (n) => ({ lines: n.map((x) => `[t] ${x.id}`) }),
    lookupGroup: (wb) => (wb === 'wb1' ? { chatId: 'oc_g1', docToken: 'doc1' } : null),
    notify: async () => 'om_text',
    notifyCard: async (chatId, card) => { cards.push(card); return 'om_card_' + cards.length },
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {},
  })
  await watch.prime('wb1') // 基线:节点 {n1} + 评论 {cm1}
  comments = [{ comment_id: 'cm1', is_solved: false }, { comment_id: 'cm2', is_solved: false }] // 只加一条新评论
  await watch._poll('wb1')
  assert.equal(cards.length, 1, '只加评论也播报')
  assert.match(cards[0].header.title.content, /评论/)
  assert.match(cards[0].header.subtitle.content, /1 条评论/)
})

test('poll: 已解决评论不算新;评论基线消费后不重播', async () => {
  const timers = fakeTimers()
  const nodes = [{ id: 'n1' }]
  let comments = [{ comment_id: 'cm1', is_solved: false }]
  const cards = []
  const watch = createBoardWatch({
    pollMs: 0, listNodes: async () => nodes, listComments: async () => comments,
    digest: () => ({ lines: [] }),
    lookupGroup: (wb) => (wb === 'wb1' ? { chatId: 'oc_g1', docToken: 'doc1' } : null),
    notify: async () => 'm', notifyCard: async (c, card) => { cards.push(card); return 'om_' + cards.length },
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {},
  })
  await watch.prime('wb1')
  comments = [{ comment_id: 'cm1', is_solved: false }, { comment_id: 'cm2', is_solved: false }]
  await watch._poll('wb1') // 播 cm2
  assert.equal(cards.length, 1)
  await watch._poll('wb1') // cm2 已进基线 → 不重播
  assert.equal(cards.length, 1, '消费后不重播')
  comments = [{ comment_id: 'cm1', is_solved: false }, { comment_id: 'cm2', is_solved: false }, { comment_id: 'cm3', is_solved: true }]
  await watch._poll('wb1') // cm3 已解决 → 不算新
  assert.equal(cards.length, 1, '已解决评论不触发')
})

test('boardwatch: buildNoticeCard 标注+评论合一张卡(计数各列,标题按有啥说啥)', () => {
  const timers = fakeTimers()
  const w = createBoardWatch({ listNodes: async () => [], digest: () => ({ lines: [] }), lookupGroup: () => null, notify: async () => 'm', setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {} })
  const both = w.buildNoticeCard({ added: [{ id: 'a' }, { id: 'b' }] }, [{ comment_id: 'c1' }])
  assert.match(both.header.title.content, /反馈/)
  assert.match(both.header.subtitle.content, /2 处标注/)
  assert.match(both.header.subtitle.content, /1 条评论/)
  const onlyNodes = w.buildNoticeCard({ added: [{ id: 'a' }] }, [])
  assert.match(onlyNodes.header.title.content, /标注/)
  const onlyComments = w.buildNoticeCard({ added: [] }, [{ comment_id: 'c1' }])
  assert.match(onlyComments.header.title.content, /评论/)
  assert.equal(onlyComments.body.elements.find((e) => e.tag === 'button').text.content, '✅ 按评论处理')
})

// takeNotice peek 模式(暂停群「先看后拒」)+ cardId 透传(实体卡回填锚点;v0.6.9 修正)
test('takeNotice: peek 只查不消费;notifyCard 返回 {msgId,cardId} 时 cardId 随命中透出', async () => {
  const timers = fakeTimers()
  let nodes = [{ id: 'n1' }]
  const watch = createBoardWatch({
    debounceMs: 1, pollMs: 0,
    listNodes: async () => nodes,
    digest: (n) => ({ lines: n.map((x) => `[t] ${x.id}`) }),
    lookupGroup: (wb) => (wb === 'wb1' ? { chatId: 'oc_g1' } : null),
    notify: async () => 'om_text',
    notifyCard: async () => ({ msgId: 'om_card_1', cardId: 'crd_abc' }), // 新返回形状
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {},
  })
  await watch.prime('wb1')
  nodes = [{ id: 'n1' }, { id: 'n2' }]
  watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  await watch._flush('wb1')
  const p1 = watch.takeNotice('om_card_1', { peek: true })
  assert.ok(p1 && p1.cardId === 'crd_abc', 'peek 命中且带 cardId')
  const p2 = watch.takeNotice('om_card_1', { peek: true })
  assert.ok(p2, 'peek 不消费 — 再 peek 仍命中')
  const hit = watch.takeNotice('om_card_1')
  assert.equal(hit.cardId, 'crd_abc', '真消费也带 cardId')
  assert.equal(watch.takeNotice('om_card_1'), null, '消费后清空')
})

// 播报卡预览图 + 去画布按钮(卡里直接看画板 + 查看入口)
test('boardwatch: 播报卡内嵌画板预览图 + 双按钮(确认 callback / 查看 open_url);无 url 降级单按钮', () => {
  const timers = fakeTimers()
  const w = createBoardWatch({ listNodes: async () => [], digest: () => ({ lines: [] }), lookupGroup: () => null, notify: async () => 'm', setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {} })
  const nc = w.buildNoticeCard({ added: [{ id: 'a' }] }, [], { imgKey: 'img_prev', boardUrl: 'https://f/x' })
  const img = nc.body.elements.find((e) => e.tag === 'img')
  assert.equal(img.img_key, 'img_prev')
  assert.equal(img.preview, true) // 点击放大细看
  const cs = nc.body.elements.find((e) => e.tag === 'column_set')
  assert.equal(cs.columns[0].elements[0].behaviors[0].type, 'callback') // 主=确认开工
  assert.equal(cs.columns[1].elements[0].behaviors[0].type, 'open_url') // 次=去画布查看
  assert.equal(cs.columns[1].elements[0].behaviors[0].default_url, 'https://f/x')
  assert.ok(cs.columns.every((c) => c.width === 'weighted' && c.weight === 1)) // 等分
  const bare = w.buildNoticeCard({ added: [{ id: 'a' }] }, [], {})
  assert.equal(bare.body.elements.find((e) => e.tag === 'img'), undefined)
  assert.equal(bare.body.elements.find((e) => e.tag === 'column_set'), undefined)
  assert.ok(bare.body.elements.find((e) => e.tag === 'button')) // 降级单按钮
})

test('boardwatch: previewImage 注入 → 播报卡带图;previewImage 失败 → 无图卡照发不阻断', async () => {
  const timers = fakeTimers()
  const cards = []
  let previewFail = false
  const mk = () => createBoardWatch({
    debounceMs: 1, pollMs: 0,
    listNodes: async () => nodes,
    digest: (n) => ({ lines: n.map((x) => `[t] ${x.id}`) }),
    lookupGroup: (wb) => (wb === 'wb1' ? { chatId: 'oc_g1', url: 'https://f/x' } : null),
    notify: async () => 'om_text',
    notifyCard: async (c, card) => { cards.push(card); return { msgId: 'om_' + cards.length, cardId: 'crd' } },
    previewImage: async () => { if (previewFail) throw new Error('403'); return 'img_prev' },
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {},
  })
  let nodes = [{ id: 'n1' }]
  let w = mk()
  await w.prime('wb1')
  nodes = [{ id: 'n1' }, { id: 'n2' }]
  w.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  await w._flush('wb1')
  assert.equal(cards[0].body.elements.find((e) => e.tag === 'img').img_key, 'img_prev', '预览图进卡')
  // 失败降级
  previewFail = true
  nodes = [{ id: 'n1' }]
  w = mk()
  await w.prime('wb1')
  nodes = [{ id: 'n1' }, { id: 'n3' }]
  w.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  await w._flush('wb1')
  assert.equal(cards.length, 2, '预览失败播报照发')
  assert.equal(cards[1].body.elements.find((e) => e.tag === 'img'), undefined, '降级无图')
})

// ───────────────── 修改也播报(v0.7.1:新增 + 改文字 + 删除;挪动/样式仍静音) ─────────────────

test('poll: 改已有节点的文字 → 停笔后播报,digest 带原文字标记', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 't1', type: 'text_shape', text: { text: '旧文案' } }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 't1', type: 'text_shape', text: { text: '新文案' } }] // 只改文字,id 不变
  await s.watch._poll('wb1') // 变化发现 → 押后一轮
  assert.equal(s.sent.length, 0)
  await s.watch._poll('wb1') // 安静 → 播
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /原文字/)
  assert.match(s.sent[0].text, /旧文案/) // 工单带上旧文字,agent 知道改了什么
  await s.watch._poll('wb1') // 播过入基线,不重播
  assert.equal(s.sent.length, 1)
})

test('poll: 删除有文字的节点 → 播报 [已删除] 带旧文字', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'k1', type: 'sticky_note', text: { text: '要删的便签' } }, { id: 'k2', type: 'image' }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 'k2', type: 'image' }] // 删了 k1
  await s.watch._poll('wb1') // 押后
  await s.watch._poll('wb1') // 播
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /已删除/)
  assert.match(s.sent[0].text, /要删的便签/)
})

test('poll: 纯挪动(同 id 同文字异坐标)不播报、基线仍更新', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'm1', type: 'text_shape', text: { text: '不动的字' }, x: 0, y: 0 }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 'm1', type: 'text_shape', text: { text: '不动的字' }, x: 500, y: 300 }] // 只挪位置
  await s.watch._poll('wb1')
  await s.watch._poll('wb1')
  assert.equal(s.sent.length, 0) // 挪动=整理,静默
  // 基线已更新到新坐标 ⇒ 后续再挪也不误当新变化(此处再改文字验证基线活着)
  s.nodes = [{ id: 'm1', type: 'text_shape', text: { text: '改了' }, x: 500, y: 300 }]
  await s.watch._poll('wb1'); await s.watch._poll('wb1')
  assert.equal(s.sent.length, 1) // 改文字才播
})

test('poll: ops add 的 undefined 旧值 → bot 加的带文字节点不误报新增/编辑', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'n1', type: 'image' }]
  await s.watch.prime('wb1')
  // bot 加了一个带说明文字的图形节点(CLI 留痕 add,基线记 id 但文字未知=undefined)
  s.nodes = [{ id: 'n1', type: 'image' }, { id: 'bot1', type: 'composite_shape', composite_shape: { text: { text: 'bot 生成' } } }]
  s.ops.push({ ts: Date.now() + 50, op: 'add', ids: ['bot1'] })
  await s.watch._poll('wb1') // syncOps: bot1→undefined;diff:bot1 在基线(不新增)、旧值 undefined(不编辑)
  await s.watch._poll('wb1')
  assert.equal(s.sent.length, 0, 'bot 自建带文字节点被留痕吸收,不误播')
})

test('poll: ops rewrite 后基线全 undefined,下轮读到真实文字不误报编辑/删除', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'a1', type: 'text_shape', text: { text: 'A' } }, { id: 'a2', type: 'text_shape', text: { text: 'B' } }]
  await s.watch.prime('wb1')
  // bot del-node overwrite:节点 id 全变,新节点带文字
  s.nodes = [{ id: 'z1', type: 'text_shape', text: { text: 'A' } }]
  s.ops.push({ ts: Date.now() + 50, op: 'rewrite', ids: ['z1'] })
  await s.watch._poll('wb1') // syncOps rewrite → 基线={z1:undefined};diff:z1 旧值 undefined ⇒ 不算编辑,a1/a2 删除被 rewrite 掩盖
  await s.watch._poll('wb1')
  assert.equal(s.sent.length, 0, 'rewrite 后 undefined 旧值 → 无假编辑无假删除')
  // 用户随后真改 z1 文字 → 照播
  s.nodes = [{ id: 'z1', type: 'text_shape', text: { text: 'A改' } }]
  await s.watch._poll('wb1'); await s.watch._poll('wb1')
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /原文字/)
})

// ───────────────── 忽略按钮(v0.7.1:消歧 + 防误触) ─────────────────

test('boardwatch: 播报卡带低调「忽略」次要按钮(callback boardskip)', () => {
  const timers = fakeTimers()
  const w = createBoardWatch({ listNodes: async () => [], digest: () => ({ lines: [] }), lookupGroup: () => null, notify: async () => 'm', setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {} })
  const nc = w.buildNoticeCard({ added: [{ id: 'a' }] }, [], { boardUrl: 'https://f/x' })
  const skip = nc.body.elements.find((e) => e.tag === 'button' && e.behaviors && e.behaviors[0] && e.behaviors[0].value && e.behaviors[0].value.a === 'boardskip')
  assert.ok(skip, '有 boardskip 忽略按钮')
  assert.equal(skip.type, 'default') // 次要样式(非 primary)
  assert.equal(skip.text.content, '🙈 忽略') // 文字=text 对象(非裸 content)
  assert.ok(!('content' in skip))
})

test('boardwatch: buildSkippedCard 灰卡无按钮(忽略后翻卡定格)', () => {
  const timers = fakeTimers()
  const w = createBoardWatch({ listNodes: async () => [], digest: () => ({ lines: [] }), lookupGroup: () => null, notify: async () => 'm', setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {} })
  const sk = w.buildSkippedCard()
  assert.equal(sk.schema, '2.0')
  assert.equal(sk.header.template, 'grey')
  assert.match(sk.header.title.content, /已忽略/)
  assert.equal(sk.body.elements.find((e) => e.tag === 'button'), undefined) // 无按钮 = 不再像活跃待办
  assert.match(sk.body.elements[0].content, /标注仍保留/)
})

test('takeNotice: 忽略消费锚点后再取为 null(防日后误点老卡触发整轮 agent)', async () => {
  const timers = fakeTimers()
  let nodes = [{ id: 'n1' }]
  const watch = createBoardWatch({
    debounceMs: 1, pollMs: 0,
    listNodes: async () => nodes,
    digest: (n) => ({ lines: n.map((x) => `[t] ${x.id}`) }),
    lookupGroup: (wb) => (wb === 'wb1' ? { chatId: 'oc_g1' } : null),
    notify: async () => 'om_text',
    notifyCard: async () => 'om_card_1',
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {},
  })
  await watch.prime('wb1')
  nodes = [{ id: 'n1' }, { id: 'n2' }]
  watch.onEvent({ whiteboardId: 'wb1', operatorIds: ['ou_user'] })
  await watch._flush('wb1')
  // 模拟 onCardAction 的 boardskip 分支:peek 命中 → 消费锚点
  assert.ok(watch.takeNotice('om_card_1', { peek: true }), '忽略前 peek 命中')
  assert.ok(watch.takeNotice('om_card_1'), '消费成功')
  assert.equal(watch.takeNotice('om_card_1'), null, '消费后再取为 null — 老卡的 👍/按钮不再触发')
})

// ───────────────── 同步模式分流(v0.7.4:直接改画布=同步源码 vs 提意见=出新版) ─────────────────

test('boardwatch: 纯改图表内容(composite_shape)→ 通知 kind=sync;takeNotice 带出 kind', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 't1', type: 'composite_shape', composite_shape: { text: { text: '旧文案' } } }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 't1', type: 'composite_shape', composite_shape: { text: { text: '新文案' } } }] // 用户直接改了图表框文字
  await s.watch._poll('wb1'); await s.watch._poll('wb1')
  assert.equal(s.sent.length, 1)
  assert.match(s.sent[0].text, /画布内容已修改/) // 文本兜底首行走 sync
  assert.match(s.sent[0].text, /同步回源码/)
  const hit = s.watch.takeNotice('om_mock_1')
  assert.equal(hit.kind, 'sync')
})

// 审查 M1:改「用户自己贴的便签/箭头文字」是在细化意见,该走 apply 产出新版,不能当 sync 丢意图
test('boardwatch: 纯改便签文字 → kind=apply(细化意见,不是改成品内容)', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 's1', type: 'sticky_note', text: { text: '配色改蓝' } }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 's1', type: 'sticky_note', text: { text: '配色改深蓝' } }] // 改自己的便签措辞
  await s.watch._poll('wb1'); await s.watch._poll('wb1')
  assert.equal(s.sent.length, 1)
  const hit = s.watch.takeNotice('om_mock_1')
  assert.equal(hit.kind, 'apply') // 不误当同步
})

// text_shape 有歧义(可能图表标签也可能自由批注)⇒ 保守归 apply(applyText 教 agent 分辨)
test('boardwatch: 纯改 text_shape 文字 → kind=apply(歧义保守)', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'x1', type: 'text_shape', text: { text: '旧' } }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 'x1', type: 'text_shape', text: { text: '新' } }]
  await s.watch._poll('wb1'); await s.watch._poll('wb1')
  assert.equal(s.sent.length, 1)
  assert.equal(s.watch.takeNotice('om_mock_1').kind, 'apply')
})

test('boardwatch: 纯删除 → 通知 kind=sync', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 'k1', type: 'sticky_note', text: { text: '删我' } }, { id: 'k2', type: 'image' }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 'k2', type: 'image' }] // 删了 k1
  await s.watch._poll('wb1'); await s.watch._poll('wb1')
  assert.equal(s.sent.length, 1)
  const hit = s.watch.takeNotice('om_mock_1')
  assert.equal(hit.kind, 'sync')
})

test('boardwatch: 改文字 + 新增混合 → kind=apply(有新增=要出新版,不是纯同步)', async () => {
  const s = makeWatch()
  s.nodes = [{ id: 't1', type: 'text_shape', text: { text: '旧' } }]
  await s.watch.prime('wb1')
  s.nodes = [{ id: 't1', type: 'text_shape', text: { text: '新' } }, { id: 'c1', type: 'connector' }] // 改文字 + 加箭头
  await s.watch._poll('wb1'); await s.watch._poll('wb1')
  assert.equal(s.sent.length, 1)
  const hit = s.watch.takeNotice('om_mock_1')
  assert.equal(hit.kind, 'apply')
})

test('boardwatch: 改文字 + 新评论 → kind=apply(评论=要 agent 产出)', async () => {
  const timers = fakeTimers()
  let nodes = [{ id: 't1', type: 'text_shape', text: { text: '旧' } }]
  let comments = [{ comment_id: 'cm1', is_solved: false }]
  const watch = createBoardWatch({
    pollMs: 0,
    listNodes: async () => nodes,
    listComments: async () => comments,
    nodeText,
    digest: (n) => ({ lines: n.map((x) => `[t] ${x.id}`) }),
    lookupGroup: (wb) => (wb === 'wb1' ? { chatId: 'oc_g1', docToken: 'doc1' } : null),
    notify: async () => 'om_text',
    notifyCard: async () => 'om_card_1',
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {},
  })
  await watch.prime('wb1') // 基线:节点 {t1:旧} + 评论 {cm1}
  nodes = [{ id: 't1', type: 'text_shape', text: { text: '新' } }] // 改文字
  comments = [{ comment_id: 'cm1', is_solved: false }, { comment_id: 'cm2', is_solved: false }] // 且加了新评论
  await watch._poll('wb1') // 节点变化 → 押后一轮
  await watch._poll('wb1') // 安静 → 播(改文字 + 新评论)
  const hit = watch.takeNotice('om_card_1')
  assert.equal(hit.kind, 'apply') // 有新评论 ⇒ 不是纯同步
})

test('boardwatch: buildNoticeCard sync 变体(标题/按钮文案/回调仍 boardgo);apply 不回归', () => {
  const timers = fakeTimers()
  const w = createBoardWatch({ listNodes: async () => [], digest: () => ({ lines: [] }), lookupGroup: () => null, notify: async () => 'm', setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {} })
  const findConfirm = (card) => {
    const btns = []
    const walk = (els) => { for (const e of els || []) { if (e.tag === 'button') btns.push(e); if (e.tag === 'column_set') for (const c of e.columns) walk(c.elements) } }
    walk(card.body.elements)
    return btns.find((b) => b.behaviors && b.behaviors[0] && b.behaviors[0].type === 'callback' && b.behaviors[0].value && b.behaviors[0].value.a === 'boardgo')
  }
  const sync = w.buildNoticeCard({ edited: [{ id: 't1' }], added: [], deleted: [] }, [], { kind: 'sync', boardUrl: 'https://f/x' })
  assert.match(sync.header.title.content, /画布内容已修改/)
  assert.match(sync.body.elements.find((e) => e.tag === 'markdown').content, /同步回源码/)
  const sConfirm = findConfirm(sync)
  assert.equal(sConfirm.text.content, '🔄 同步到源码')
  assert.deepEqual(sConfirm.behaviors[0].value, { a: 'boardgo' }) // 回调通道不变(仍 boardgo)
  // apply(缺省 kind)不回归
  const apply = w.buildNoticeCard({ added: [{ id: 'a' }] }, [], { boardUrl: 'https://f/x' })
  assert.match(apply.header.title.content, /标注/)
  assert.equal(findConfirm(apply).text.content, '✅ 按标注改图')
})

test('boardwatch: buildAckCard sync/apply 两态(缺省 apply)', () => {
  const timers = fakeTimers()
  const w = createBoardWatch({ listNodes: async () => [], digest: () => ({ lines: [] }), lookupGroup: () => null, notify: async () => 'm', setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {} })
  const sync = w.buildAckCard(['[已删除] t1 "旧"'], 'sync')
  assert.match(sync.header.title.content, /同步源码中/)
  assert.match(sync.body.elements[0].content, /同步回源码/)
  const apply = w.buildAckCard(['[connector] a'], 'apply')
  assert.match(apply.header.title.content, /处理画布反馈中/)
  const dflt = w.buildAckCard(['x']) // 缺省 = apply
  assert.match(dflt.header.title.content, /处理画布反馈中/)
})
