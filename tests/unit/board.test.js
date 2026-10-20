// 画板纯函数(src/platform/board.js)—— 三个确定性、无 IO 的函数:
//   imageSize      从图片头的魔数解析像素尺寸(PNG/JPEG/WebP,手工构造最小头部)
//   digestNodes    把画板节点整形成给模型看的紧凑摘要(各类型行格式 + 防御式残缺 + 截断)
//   nextImagePosition  按现有节点右缘确定性摆放新图
// 尺寸解析是二进制字节游戏,测试里手工造出每种格式的最小合法头部,锁死偏移。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { imageSize, digestNodes, digestComments, nodeText, nextImagePosition } = require('../../src/platform/board')

// ── 构造最小图片头部 ─────────────────────────────────────────────────────────

function pngHeader(w, h) {
  const b = Buffer.alloc(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.writeUInt32BE(13, 8) // IHDR chunk length
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(w, 16)
  b.writeUInt32BE(h, 20)
  return b
}

// SOI + 一个 APP0 段(测 segment 跳过)+ SOF0(带真实宽高)
function jpegHeader(w, h) {
  const soi = Buffer.from([0xff, 0xd8])
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x11, 0x22]) // 段长 4 = 2B 长度 + 2B 数据
  const sof = Buffer.alloc(9)
  sof[0] = 0xff
  sof[1] = 0xc0 // SOF0
  sof.writeUInt16BE(17, 2) // 段长(名义)
  sof.writeUInt8(8, 4) // 精度
  sof.writeUInt16BE(h, 5) // height
  sof.writeUInt16BE(w, 7) // width
  return Buffer.concat([soi, app0, sof])
}

function webpVP8(w, h) {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(22, 4)
  b.write('WEBP', 8, 'ascii')
  b.write('VP8 ', 12, 'ascii')
  b.writeUInt32LE(10, 16)
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a // 起始码
  b.writeUInt16LE(w & 0x3fff, 26)
  b.writeUInt16LE(h & 0x3fff, 28)
  return b
}

function webpVP8L(w, h) {
  const b = Buffer.alloc(25)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(17, 4)
  b.write('WEBP', 8, 'ascii')
  b.write('VP8L', 12, 'ascii')
  b.writeUInt32LE(5, 16)
  b[20] = 0x2f // 签名
  const bits = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14)
  b.writeUInt32LE(bits >>> 0, 21)
  return b
}

function webpVP8X(w, h) {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(18, 4)
  b.write('WEBP', 8, 'ascii')
  b.write('VP8X', 12, 'ascii')
  b.writeUInt32LE(10, 16)
  b[20] = 0x00 // flags,reserved 21-23 留 0
  const w1 = w - 1
  const h1 = h - 1
  b[24] = w1 & 0xff; b[25] = (w1 >> 8) & 0xff; b[26] = (w1 >> 16) & 0xff
  b[27] = h1 & 0xff; b[28] = (h1 >> 8) & 0xff; b[29] = (h1 >> 16) & 0xff
  return b
}

// ── imageSize ───────────────────────────────────────────────────────────────

test('imageSize: PNG 头部 → 宽高', () => {
  assert.deepEqual(imageSize(pngHeader(1920, 1080)), { width: 1920, height: 1080 })
  assert.deepEqual(imageSize(pngHeader(1, 1)), { width: 1, height: 1 })
})

test('imageSize: JPEG 扫描 SOF 拿宽高(跳过前面的 APP0 段)', () => {
  assert.deepEqual(imageSize(jpegHeader(640, 480)), { width: 640, height: 480 })
  assert.deepEqual(imageSize(jpegHeader(4096, 2160)), { width: 4096, height: 2160 })
})

test('imageSize: WebP VP8(lossy)取低 14 位宽高', () => {
  assert.deepEqual(imageSize(webpVP8(800, 600)), { width: 800, height: 600 })
})

test('imageSize: WebP VP8L(lossless)位打包宽高(存储值 -1)', () => {
  assert.deepEqual(imageSize(webpVP8L(123, 456)), { width: 123, height: 456 })
  assert.deepEqual(imageSize(webpVP8L(16384, 16384)), { width: 16384, height: 16384 }) // 14 位上限
})

test('imageSize: WebP VP8X(extended)canvas 宽高(存储值 -1)', () => {
  assert.deepEqual(imageSize(webpVP8X(3000, 2000)), { width: 3000, height: 2000 })
})

test('imageSize: 不支持/损坏的数据抛中文错误', () => {
  const err = /不支持的图片格式\(仅 PNG\/JPEG\/WebP\)/
  assert.throws(() => imageSize(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])), err)
  assert.throws(() => imageSize(Buffer.from('hello world, not an image')), err)
  assert.throws(() => imageSize(Buffer.alloc(0)), err)
  assert.throws(() => imageSize(Buffer.from([0x89, 0x50])), err) // PNG 签名截断
  assert.throws(() => imageSize('not a buffer'), err)
  assert.throws(() => imageSize(null), err)
})

test('imageSize: 宽或高为 0 也抛错(拒绝退化尺寸)', () => {
  const err = /不支持的图片格式/
  assert.throws(() => imageSize(pngHeader(0, 100)), err)
  assert.throws(() => imageSize(pngHeader(100, 0)), err)
})

// ── digestNodes:各类型行格式 ─────────────────────────────────────────────────

test('digestNodes: image 行 = [图] id at(x,y) w×h,坐标四舍五入', () => {
  const r = digestNodes([{ id: 'img1', type: 'image', x: 10.4, y: 20.6, width: 200.5, height: 100 }])
  assert.deepEqual(r, { lines: ['[图] img1 at(10,21) 201×100'], total: 1, truncated: false })
})

test('digestNodes: text_shape / sticky_note 取文本,支持 text.text 与 rich_text', () => {
  const nodes = [
    { id: 't1', type: 'text_shape', x: 0, y: 0, text: { text: '你好世界' } },
    { id: 's1', type: 'sticky_note', x: 5, y: 6, rich_text: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] },
  ]
  const r = digestNodes(nodes)
  assert.deepEqual(r.lines, [
    '[文字] t1 at(0,0) "你好世界"',
    '[文字] s1 at(5,6) "abc"',
  ])
})

test('digestNodes: 文字超 80 字符截断加省略号', () => {
  const long = 'x'.repeat(200)
  const r = digestNodes([{ id: 't', type: 'text_shape', x: 0, y: 0, text: { text: long } }])
  assert.equal(r.lines[0], `[文字] t at(0,0) "${'x'.repeat(80)}…"`)
})

test('digestNodes: connector 自由端点 = from(x,y)→to(x,y)', () => {
  const r = digestNodes([{
    id: 'c1', type: 'connector',
    start_object: { x: 10, y: 10 }, end_object: { x: 90, y: 60 },
  }])
  assert.equal(r.lines[0], '[箭头] c1 from(10,10)→to(90,60)')
})

test('digestNodes: connector 端点吸附到节点 → from:<id> / →吸附:<id>', () => {
  const r = digestNodes([{
    id: 'c2', type: 'connector',
    start_object: { id: 'node-A' },
    end_object: { attached_object: 'node-B' }, // 兼容 attached_object 字段名
  }])
  assert.equal(r.lines[0], '[箭头] c2 from:node-A→吸附:node-B')
})

test('digestNodes: connector 一端吸附一端自由 + caption 追加引号文本', () => {
  const r = digestNodes([{
    id: 'c3', type: 'connector',
    start_object: { id: 'node-A' }, end_object: { x: 200, y: 50 },
    caption: { text: '依赖' },
  }])
  assert.equal(r.lines[0], '[箭头] c3 from:node-A→to(200,50) "依赖"')
})

test('digestNodes: paint 有点列 → 约(minX,minY)~(maxX,maxY)', () => {
  const r = digestNodes([{
    id: 'p1', type: 'paint',
    points: [{ x: 30, y: 40 }, { x: 10, y: 90 }, { x: 55, y: 12 }],
  }])
  assert.equal(r.lines[0], '[笔迹] p1 约(10,12)~(55,90)')
})

test('digestNodes: paint 支持 [x,y] 点对', () => {
  const r = digestNodes([{ id: 'p2', type: 'paint', points: [[5, 5], [25, 35]] }])
  assert.equal(r.lines[0], '[笔迹] p2 约(5,5)~(25,35)')
})

test('digestNodes: paint 无点列 → 退化为 at(x,y) w×h', () => {
  const r = digestNodes([{ id: 'p3', type: 'paint', x: 1, y: 2, width: 30, height: 40 }])
  assert.equal(r.lines[0], '[笔迹] p3 at(1,2) 30×40')
})

test('digestNodes: 未知类型 → [type] id at(x,y)', () => {
  // 样本从 group 换成 section:group 已有专属 [组] 行(移植打组后是画布常客),
  // 这里要的是「没有专属格式化的类型照样有一行」的兜底行为。
  const r = digestNodes([{ id: 'g1', type: 'section', x: 7, y: 8 }])
  assert.equal(r.lines[0], '[section] g1 at(7,8)')
})

// ── nodeText:各类型文字抽取 + 规范化 + 截断(digest 与 boardwatch 变更指纹的单一事实源)──────
test('nodeText: 各节点类型抽文字 + 空白折叠 + 截断 + 防御', () => {
  assert.equal(nodeText({ type: 'text_shape', text: { text: '你好' } }), '你好')
  assert.equal(nodeText({ type: 'sticky_note', rich_text: [{ text: 'a' }, { text: 'b' }] }), 'ab')
  assert.equal(nodeText({ type: 'connector', caption: { text: '依赖' } }), '依赖') // 顶层 caption
  assert.equal(nodeText({ type: 'connector', connector: { captions: [{ text: { text: '改成蓝色' } }] } }), '改成蓝色') // connector.captions
  assert.equal(nodeText({ type: 'composite_shape', composite_shape: { text: { text: '流程' } } }), '流程')
  assert.equal(nodeText({ type: 'mind_map', mind_map: { text: { text: '根' } } }), '根')
  assert.equal(nodeText({ type: 'image', x: 0, y: 0, width: 10, height: 10 }), '') // 图片无文字
  assert.equal(nodeText({ type: 'paint' }), '') // 笔迹无文字
  assert.equal(nodeText({ type: 'text_shape', text: { text: '  多  空\n白 \t 行 ' } }), '多 空 白 行') // 空白折叠
  assert.equal(nodeText({ type: 'text_shape', text: { text: 'x'.repeat(300) } }).length, 200) // 截断 200
  assert.equal(nodeText(null), '') // 防御:非对象
  assert.equal(nodeText({ type: 'text_shape' }), '') // 无文字字段
})

// ── digestNodes:防御式 + 截断 ────────────────────────────────────────────────

test('digestNodes: 字段全缺 / 非数坐标 → ? 占位,绝不抛错', () => {
  const nodes = [
    { type: 'image' }, // 无 id / 无坐标
    { id: 'x', type: 'image', x: 'abc', y: null, width: NaN, height: undefined },
    { id: 'c', type: 'connector' }, // 无端点
    { id: 'p', type: 'paint' }, // 无点无几何
    {}, // 无 type
    null, // 完全残缺
    'garbage', // 非对象
  ]
  let r
  assert.doesNotThrow(() => { r = digestNodes(nodes) })
  assert.equal(r.total, 7)
  assert.deepEqual(r.lines, [
    '[图] ? at(?,?) ?×?',
    '[图] x at(?,?) ?×?',
    '[箭头] c from(?,?)→to(?,?)',
    '[笔迹] p at(?,?) ?×?',
    '[unknown] ? at(?,?)',
    '[unknown] ? at(?,?)',
    '[unknown] ? at(?,?)',
  ])
})

test('digestNodes: 非数组入参 → 空结果', () => {
  assert.deepEqual(digestNodes(null), { lines: [], total: 0, truncated: false })
  assert.deepEqual(digestNodes(undefined), { lines: [], total: 0, truncated: false })
})

test('digestNodes: 超过 limit 只出前 limit 行并标 truncated', () => {
  const nodes = Array.from({ length: 305 }, (_, i) => ({ id: `n${i}`, type: 'image', x: i, y: 0, width: 1, height: 1 }))
  const def = digestNodes(nodes) // 默认 limit=300
  assert.equal(def.total, 305)
  assert.equal(def.truncated, true)
  assert.equal(def.lines.length, 300)
  assert.equal(def.lines[0], '[图] n0 at(0,0) 1×1')

  const small = digestNodes(nodes, { limit: 3 })
  assert.equal(small.lines.length, 3)
  assert.equal(small.total, 305)
  assert.equal(small.truncated, true)
})

test('digestNodes: 恰好等于 limit 不算截断', () => {
  const nodes = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, type: 'image', x: 0, y: 0, width: 1, height: 1 }))
  const r = digestNodes(nodes, { limit: 5 })
  assert.equal(r.truncated, false)
  assert.equal(r.lines.length, 5)
})

// ── nextImagePosition ────────────────────────────────────────────────────────

test('nextImagePosition: 空画板 → 原点', () => {
  assert.deepEqual(nextImagePosition([], 100, 100), { x: 0, y: 0 })
  assert.deepEqual(nextImagePosition(null, 100, 100), { x: 0, y: 0 })
})

test('nextImagePosition: 现有节点右缘 + gap,y 取最上', () => {
  const nodes = [
    { id: 'a', x: 0, y: 100, width: 200, height: 50 }, // 右缘 200
    { id: 'b', x: 300, y: 40, width: 150, height: 50 }, // 右缘 450(最右),y=40(最上)
  ]
  assert.deepEqual(nextImagePosition(nodes, 100, 100), { x: 490, y: 40 }) // 450 + 40
  assert.deepEqual(nextImagePosition(nodes, 100, 100, 10), { x: 460, y: 40 })
})

test('nextImagePosition: 忽略无几何(x/width 非有限数)的节点', () => {
  const nodes = [
    { id: 'text', type: 'text_shape', text: { text: 'no geometry' } }, // 无 x/width
    { id: 'a', x: 10, y: 20, width: 90, height: 30 }, // 右缘 100
    { id: 'bad', x: 'oops', width: 999 }, // x 非数,忽略
  ]
  assert.deepEqual(nextImagePosition(nodes, 100, 100), { x: 140, y: 20 })
})

test('nextImagePosition: 有几何但都无有效 y → y 回落 0', () => {
  const nodes = [{ id: 'a', x: 10, width: 90 }] // 有 x/width,无 y
  assert.deepEqual(nextImagePosition(nodes, 100, 100), { x: 140, y: 0 })
})

// ── 真机回归(2026-07-21 生产画板实测数据)──────────────────────────────────────

test('digestNodes: 真机 connector — 端点嵌在 connector 下(吸附端 start_object,自由端 end.position)', () => {
  // 画板上手画箭头的真实数据形状(裁剪样式字段):从文字节点 a2:6 出发指向海报区域
  const real = {
    id: 'c2:1', type: 'connector', x: 390.135986328125, y: 635.335693359375,
    width: 606.7152099609375, height: 82.80028533935547, z_index: 5,
    connector: {
      shape: 'polyline', specified_coordinate: true,
      start: { arrow_style: 'none', attached_object: { id: 'a2:6', position: { x: 1, y: 0.5 }, snap_to: 'right' } },
      start_object: { id: 'a2:6', position: { x: 1, y: 0.5 }, snap_to: 'right' },
      end: { arrow_style: 'line_arrow', position: { x: 996.8511962890625, y: 635.335693359375 } },
      turning_points: [{ x: 303.35760498046875, y: 82.80028533935547 }, { x: 303.35760498046875, y: 0 }],
    },
  }
  const d = digestNodes([real])
  // 吸附端给目标节点 id(绝不把 0~1 相对量当坐标);自由端给绝对坐标
  assert.equal(d.lines[0], '[箭头] c2:1 from:a2:6→to(997,635)')
})

test('digestNodes: 真机 connector — captions 数组提取为引号文案', () => {
  const n = { id: 'c1', type: 'connector', connector: {
    start: { position: { x: 0, y: 0 } }, end: { position: { x: 10, y: 10 } },
    captions: [{ text: { text: '改成蓝色' } }],
  } }
  const d = digestNodes([n])
  assert.equal(d.lines[0], '[箭头] c1 from(0,0)→to(10,10) "改成蓝色"')
})

test('digestNodes: 真机 paint — 点列嵌在 paint.lines 下也能算包围盒', () => {
  const n = { id: 'p1', type: 'paint', paint: { type: 'marker', lines: [{ points: [{ x: 5, y: 8 }, { x: 25, y: 40 }] }, { points: [[50, 3]] }] } }
  const d = digestNodes([n])
  assert.equal(d.lines[0], '[笔迹] p1 约(5,3)~(50,40)')
})

// ── digestComments:按画板评论 API 的真实返回结构造的 fixture(内容与 id 都是虚构的)──
// 结构要点:图片不在 elements 里,而在回复级
// reply.extra.image_list(裸 token 字符串数组);elements 元素形如
// {type:"text_run", text_run:{text}, docs_link:null, person:null}。此处内联为自足回归。

test('digestComments: 真机 fixture — 两条待处理评论 + 一张图 token 收集', () => {
  const items = [
    {
      comment_id: '7000000000000000101', create_time: 1784619008, is_solved: false, is_whole: false,
      parent_token: 'WbDemoToken0000000000000001', parent_type: 'WHITEBOARD_BLOCK', quote: '[画板]',
      reply_list: { replies: [{
        content: { elements: [{ docs_link: null, person: null, text_run: { text: '色彩构图参考' }, type: 'text_run' }] },
        create_time: 1784619008,
        extra: { image_list: ['ImgDemoToken000000000000001'] },
        reply_id: '7000000000000000111', update_time: 1784619008, user_id: 'ou_0123456789abcdef0123456789abcdef',
      }] },
      solver_user_id: null, update_time: 1784619009, user_id: 'ou_0123456789abcdef0123456789abcdef',
    },
    {
      comment_id: '7000000000000000202', create_time: 1784619237, is_solved: false, is_whole: false,
      parent_token: 'WbDemoToken0000000000000001', parent_type: 'WHITEBOARD_BLOCK', quote: '[图片]',
      reply_list: { replies: [{
        content: { elements: [{ docs_link: null, person: null, text_run: { text: '这里的配色再淡一点 标题字号小一号' }, type: 'text_run' }] },
        create_time: 1784619237,
        extra: { image_list: [] },
        reply_id: '7000000000000000212', update_time: 1784619237, user_id: 'ou_0123456789abcdef0123456789abcdef',
      }] },
      solver_user_id: null, update_time: 1784619237, user_id: 'ou_0123456789abcdef0123456789abcdef',
    },
  ]
  const r = digestComments(items)
  assert.deepEqual(r.lines, [
    '[评论] 7000000000000000101(未解决) 局部 引用:"[画板]" "色彩构图参考 [图×1]"',
    '[评论] 7000000000000000202(未解决) 局部 引用:"[图片]" "这里的配色再淡一点 标题字号小一号"',
  ])
  assert.equal(r.total, 2)
  assert.equal(r.truncated, false)
  assert.deepEqual(r.imageTokens, ['ImgDemoToken000000000000001'])
})

// ── digestComments:文档形状 / 元素类型渲染 ───────────────────────────────────

test('digestComments: 整篇评论(is_whole)无 quote → 无 局部/引用 段', () => {
  const r = digestComments([{
    comment_id: 'c1', is_solved: false, is_whole: true,
    reply_list: { replies: [{ reply_id: 'r1', content: { elements: [{ type: 'text_run', text_run: { text: '整体意见' } }] }, extra: { image_list: [] } }] },
  }])
  assert.deepEqual(r.lines, ['[评论] c1(未解决) "整体意见"'])
})

test('digestComments: docs_link → [链接],person → [@某人],未知类型 → [类型名]', () => {
  const r = digestComments([{
    comment_id: 'c1', is_solved: false, is_whole: false,
    reply_list: { replies: [{
      reply_id: 'r1',
      content: { elements: [
        { type: 'text_run', text_run: { text: '见' } },
        { type: 'docs_link', docs_link: { url: 'https://x' }, text_run: null, person: null },
        { type: 'text_run', text_run: { text: ' 及 ' } },
        { type: 'person', person: { user_id: 'ou_x' }, text_run: null, docs_link: null },
        { type: 'formula', text_run: null },
      ] },
      extra: { image_list: [] },
    }] },
  }])
  assert.equal(r.lines[0], '[评论] c1(未解决) 局部 "见[链接] 及 [@某人][formula]"')
})

test('digestComments: text_run 可为裸字符串或 {text:{text}} 嵌套(防御)', () => {
  const r = digestComments([{
    comment_id: 'c1', is_solved: false, is_whole: false,
    reply_list: { replies: [{
      reply_id: 'r1',
      content: { elements: [
        { type: 'text_run', text_run: '裸串' },
        { type: 'text_run', text_run: { text: { text: '再嵌一层' } } },
      ] },
    }] },
  }])
  assert.equal(r.lines[0], '[评论] c1(未解决) 局部 "裸串再嵌一层"')
})

// ── digestComments:图片(回复级 image_list + 防御式内嵌图元素)────────────────

test('digestComments: 多图 → 尾部 [图×N] + 全部 token 收集', () => {
  const r = digestComments([{
    comment_id: 'c1', is_solved: false, is_whole: false,
    reply_list: { replies: [{
      reply_id: 'r1',
      content: { elements: [{ type: 'text_run', text_run: { text: '看这几张' } }] },
      extra: { image_list: ['tokA', 'tokB', 'tokC'] },
    }] },
  }])
  assert.equal(r.lines[0], '[评论] c1(未解决) 局部 "看这几张 [图×3]"')
  assert.deepEqual(r.imageTokens, ['tokA', 'tokB', 'tokC'])
})

test('digestComments: 纯图回复(无文字)→ 占位不带前导空格', () => {
  const r = digestComments([{
    comment_id: 'c1', is_solved: false, is_whole: false,
    reply_list: { replies: [{ reply_id: 'r1', content: { elements: [] }, extra: { image_list: ['solo'] } }] },
  }])
  assert.equal(r.lines[0], '[评论] c1(未解决) 局部 "[图×1]"')
  assert.deepEqual(r.imageTokens, ['solo'])
})

test('digestComments: 防御式内嵌图元素(未知类型/含 image·attachment 键)→ 行内 [图] + token', () => {
  const r = digestComments([{
    comment_id: 'c1', is_solved: false, is_whole: false,
    reply_list: { replies: [{
      reply_id: 'r1',
      content: { elements: [
        { type: 'text_run', text_run: { text: '内嵌' } },
        { type: 'image', image: { token: 'inlineTok' } },        // 类型名即 image
        { type: 'x', attachment: { file_token: 'attTok' } },     // 含 attachment 键
      ] },
      extra: { image_list: [] },
    }] },
  }])
  assert.equal(r.lines[0], '[评论] c1(未解决) 局部 "内嵌[图][图]"')
  assert.deepEqual(r.imageTokens, ['inlineTok', 'attTok'])
})

// ── digestComments:已解决过滤 ────────────────────────────────────────────────

test('digestComments: 已解决评论默认跳过,includeSolved 才列出', () => {
  const items = [
    { comment_id: 'open', is_solved: false, is_whole: false, reply_list: { replies: [{ reply_id: 'r1', content: { elements: [{ type: 'text_run', text_run: { text: '待办' } }] } }] } },
    { comment_id: 'done', is_solved: true, is_whole: false, solver_user_id: 'ou_s', reply_list: { replies: [{ reply_id: 'r2', content: { elements: [{ type: 'text_run', text_run: { text: '已处理' } }] } }] } },
  ]
  const def = digestComments(items)
  assert.deepEqual(def.lines, ['[评论] open(未解决) 局部 "待办"'])
  assert.equal(def.total, 1)

  const all = digestComments(items, { includeSolved: true })
  assert.deepEqual(all.lines, [
    '[评论] open(未解决) 局部 "待办"',
    '[评论] done(已解决) 局部 "已处理"',
  ])
  assert.equal(all.total, 2)
})

// ── digestComments:回复链 ────────────────────────────────────────────────────

test('digestComments: 首条 reply 作主行,后续 reply 缩进 ↳ reply_id', () => {
  const r = digestComments([{
    comment_id: 'c1', is_solved: false, is_whole: false, quote: '选中段落',
    reply_list: { replies: [
      { reply_id: 'r1', content: { elements: [{ type: 'text_run', text_run: { text: '主意见' } }] }, extra: { image_list: [] } },
      { reply_id: 'r2', content: { elements: [{ type: 'text_run', text_run: { text: '追加一句' } }] }, extra: { image_list: ['t2'] } },
      { reply_id: 'r3', content: { elements: [{ type: 'text_run', text_run: { text: '再补' } }] } },
    ] },
  }])
  assert.deepEqual(r.lines, [
    '[评论] c1(未解决) 局部 引用:"选中段落" "主意见"',
    '  ↳ r2 "追加一句 [图×1]"',
    '  ↳ r3 "再补"',
  ])
  assert.deepEqual(r.imageTokens, ['t2'])
})

// ── digestComments:截断 ──────────────────────────────────────────────────────

test('digestComments: 文本超 80 字截断加省略号', () => {
  const long = 'y'.repeat(200)
  const r = digestComments([{
    comment_id: 'c1', is_solved: false, is_whole: true,
    reply_list: { replies: [{ reply_id: 'r1', content: { elements: [{ type: 'text_run', text_run: { text: long } }] } }] },
  }])
  assert.equal(r.lines[0], `[评论] c1(未解决) "${'y'.repeat(80)}…"`)
})

test('digestComments: 超过 limit 只出前 limit 条并标 truncated', () => {
  const items = Array.from({ length: 105 }, (_, i) => ({
    comment_id: `c${i}`, is_solved: false, is_whole: true,
    reply_list: { replies: [{ reply_id: `r${i}`, content: { elements: [{ type: 'text_run', text_run: { text: `第${i}` } }] } }] },
  }))
  const def = digestComments(items) // 默认 limit=100
  assert.equal(def.total, 105)
  assert.equal(def.truncated, true)
  assert.equal(def.lines.length, 100)
  assert.equal(def.lines[0], '[评论] c0(未解决) "第0"')

  const small = digestComments(items, { limit: 3 })
  assert.equal(small.lines.length, 3)
  assert.equal(small.total, 105)
  assert.equal(small.truncated, true)
})

test('digestComments: 恰好等于 limit 不算截断', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    comment_id: `c${i}`, is_solved: false, is_whole: true,
    reply_list: { replies: [{ reply_id: `r${i}`, content: { elements: [{ type: 'text_run', text_run: { text: 'x' } }] } }] },
  }))
  const r = digestComments(items, { limit: 5 })
  assert.equal(r.truncated, false)
  assert.equal(r.lines.length, 5)
})

// ── digestComments:防御式残缺 ────────────────────────────────────────────────

test('digestComments: 字段全缺 / 非对象 / 无回复 → 占位不抛错', () => {
  const items = [
    { comment_id: 'c1' },                              // 无 is_solved/is_whole/quote/回复
    { is_solved: false },                              // 无 comment_id
    { comment_id: 'c3', reply_list: {} },              // reply_list 无 replies
    { comment_id: 'c4', reply_list: { replies: [null, 'garbage'] } }, // 残缺 reply
    null,                                              // 完全残缺
    'garbage',                                         // 非对象
  ]
  let r
  assert.doesNotThrow(() => { r = digestComments(items) })
  assert.equal(r.total, 6)
  assert.deepEqual(r.lines, [
    '[评论] c1(未解决) 局部 ""',
    '[评论] ?(未解决) 局部 ""',
    '[评论] c3(未解决) 局部 ""',
    '[评论] c4(未解决) 局部 ""',   // 首条 reply=null → 空文本
    '  ↳ ? ""',                    // 第二条 reply='garbage' → ↳ ? 空
    '[评论] ?(未解决) 局部 ""',    // null → {}
    '[评论] ?(未解决) 局部 ""',    // 'garbage' → {}
  ])
})

test('digestComments: 非数组入参 → 空结果', () => {
  assert.deepEqual(digestComments(null), { lines: [], total: 0, truncated: false, imageTokens: [] })
  assert.deepEqual(digestComments(undefined), { lines: [], total: 0, truncated: false, imageTokens: [] })
})

// ── besideImagePosition(参照摆放:改图新图与原图同排,2026-07-22)──
const { besideImagePosition } = require('../../src/platform/board')

test('beside: 新图落参照图右侧同 y(+40 间距)', () => {
  const nodes = [{ id: 'img1', x: 100, y: 200, width: 600, height: 400 }]
  assert.deepEqual(besideImagePosition(nodes, 'img1', 600, 400), { x: 740, y: 200 })
})

test('beside: 同排已有多版时不叠图 — 推进到同排最右;不同排的高图不挡道', () => {
  const nodes = [
    { id: 'v1', x: 0, y: 1000, width: 600, height: 400 },
    { id: 'v2', x: 640, y: 1000, width: 600, height: 400 }, // v1 的上一轮迭代,同排
    { id: 'other', x: 5000, y: -500, width: 600, height: 400 }, // 别的排,更靠右但不相干
  ]
  assert.deepEqual(besideImagePosition(nodes, 'v1', 600, 400), { x: 1280, y: 1000 }) // 640+600+40
})

test('beside: 参照 id 不存在 → 回退全局摆放并标 fallback', () => {
  const nodes = [{ id: 'img1', x: 0, y: 0, width: 600, height: 400 }]
  const p = besideImagePosition(nodes, 'gone', 600, 400)
  assert.equal(p.fallback, true)
  assert.deepEqual({ x: p.x, y: p.y }, { x: 640, y: 0 }) // nextImagePosition 语义
})

test('beside: 无坐标的脏节点被忽略,不影响摆放', () => {
  const nodes = [{ id: 'img1', x: 0, y: 0, width: 600, height: 400 }, { id: 'junk' }, null]
  assert.deepEqual(besideImagePosition(nodes, 'img1', 600, 400), { x: 640, y: 0 })
})

// buildDeliverCard(按标注改结果卡;v0.6.9)—— 图在卡内 / 打开画布 open_url 按钮 / redact / 缺省
test('buildDeliverCard: 图在卡内 + open_url 按钮(type+text 对象)+ redact title/note', () => {
  const { buildDeliverCard } = require('../../src/platform/board')
  const c = buildDeliverCard({ imgKey: 'img_k', boardUrl: 'https://f/x', title: '方案2', note: '帽子改红' })
  assert.equal(c.schema, '2.0')
  assert.match(c.header.title.content, /方案2/)
  assert.equal(c.header.template, 'green')
  assert.equal(c.body.elements.find((e) => e.tag === 'img').img_key, 'img_k')
  const btn = c.body.elements.find((e) => e.tag === 'button')
  assert.equal(btn.type, 'primary') // 样式=type
  assert.equal(btn.text.tag, 'plain_text') // 文字=对象
  assert.equal(btn.behaviors[0].type, 'open_url')
  assert.equal(btn.behaviors[0].default_url, 'https://f/x')
  // redact
  const c2 = buildDeliverCard({ imgKey: 'k', title: 'AKIAABCDEFGHIJKLMNOP', redact: (s) => s.replace(/AKIA[0-9A-Z]{12,}/, '[r]') })
  assert.match(c2.header.title.content, /\[r\]/)
})

test('buildDeliverCard: 无 imgKey 无图 / 无 boardUrl 无按钮(收尾兜底态)', () => {
  const { buildDeliverCard } = require('../../src/platform/board')
  const c = buildDeliverCard({ imgKey: null, boardUrl: null, title: '按标注改图完成', note: '结果见群里' })
  assert.equal(c.body.elements.find((e) => e.tag === 'img'), undefined)
  assert.equal(c.body.elements.find((e) => e.tag === 'button'), undefined)
  assert.match(JSON.stringify(c), /结果见群里/)
})

// ⚠ cardkit 实体卡的 img 组件不接受 size 字段(10002 img size is not allowed,2026-07-23 真机二分
// 实锤;文档的 size 预设值不适用于 cardkit 通道)—— 三个卡构造统一锁死防回归。
test('全部卡构造的 img 元素不得带 size 字段(cardkit 10002)', () => {
  const { buildDeliverCard } = require('../../src/platform/board')
  const imagen = require('../../src/agent/imagen')
  const { createBoardWatch } = require('../../src/platform/boardwatch')
  const w = createBoardWatch({ listNodes: async () => [], digest: () => ({ lines: [] }), lookupGroup: () => null, notify: async () => 'm' })
  const cards = [
    buildDeliverCard({ imgKey: 'k', boardUrl: 'https://f/x', title: 't' }),
    imagen.buildDoneCard({ label: 't', outRel: 'a.png' }, { boardOk: true, boardUrl: 'https://f/x', imgKey: 'k' }),
    w.buildNoticeCard([{ id: 'a' }], [], { imgKey: 'k', boardUrl: 'https://f/x' }),
  ]
  for (const c of cards) {
    const imgs = JSON.stringify(c).match(/"tag":"img"[^}]*/g) || []
    assert.ok(imgs.length >= 1, '卡里有 img')
    for (const frag of imgs) assert.doesNotMatch(frag, /"size"/, 'img 不得带 size 字段')
  }
})

// annotationFocusRegion(预览图聚焦裁剪框;2026-07-23)—— 映射/吸附目标并入/clamp/不值得裁
test('annotationFocusRegion: 标注 bbox 映射到图片像素 + padding;含吸附目标图;区域≈全图返回 null', () => {
  const { annotationFocusRegion } = require('../../src/platform/board')
  // 画板内容 bbox = (0,0)~(2000,1000);导出图 1000x500(等比 0.5)
  const img = { id: 'img1', type: 'image', x: 100, y: 100, width: 300, height: 200 }
  const far = { id: 'far', type: 'image', x: 1800, y: 900, width: 200, height: 100 } // 撑开画板 bbox 到 2000x1000
  const origin = { id: 'o', type: 'image', x: 0, y: 0, width: 10, height: 10 } // 撑开原点
  // 新标注:箭头吸附 img1,自由端在 (450,150)
  const arrow = { id: 'c1', type: 'connector', connector: { start_object: { id: 'img1' }, end: { position: { x: 450, y: 150 } } } }
  const r = annotationFocusRegion([origin, img, far, arrow], [arrow], 1000, 500)
  assert.ok(r, '给出聚焦框')
  // 聚焦 bbox(画板系)= img1∪端点 = (100,100)~(450,300) → 像素 (50,50)~(225,150),padding 后仍远小于全图
  assert.ok(r.w * r.h < 1000 * 500 * 0.8, '聚焦区远小于全图')
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1000 && r.y + r.h <= 500, 'clamp 图内')
  // 标注中心必须在框内(pad 保证)
  const cx = (50 + 225) / 2
  const cy = (50 + 150) / 2
  assert.ok(cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h, '标注中心在框内')
  // 标注铺满整板 → 不值得裁
  const bigPaint = { id: 'p', type: 'paint', points: [[0, 0], [2000, 1000]] }
  assert.equal(annotationFocusRegion([origin, far, bigPaint], [bigPaint], 1000, 500), null)
  // 无几何 fresh → null;空图尺寸 → null
  assert.equal(annotationFocusRegion([img], [{ id: 'x' }], 1000, 500), null)
  assert.equal(annotationFocusRegion([img], [arrow], 0, 0), null)
})

test('annotationFocusRegion: 竖长条聚焦区被扩宽/截高到 maxTallRatio 内(治「太高」)', () => {
  const { annotationFocusRegion } = require('../../src/platform/board')
  const origin = { id: 'o', type: 'image', x: 0, y: 0, width: 10, height: 10 }
  const far = { id: 'f', type: 'image', x: 1900, y: 3900, width: 100, height: 100 } // 板 2000x4000
  const tall = { id: 't', type: 'paint', points: [[900, 500], [1000, 3500]] } // 竖长条标注
  const r = annotationFocusRegion([origin, far, tall], [tall], 1000, 2000) // 图 1000x2000
  assert.ok(r, '有框')
  assert.ok(r.h <= r.w * 1.4 + 2, `高宽比受控(h=${r.h} w=${r.w})`)
})

// ── digestNodes:图表通道产物(composite_shape / mind_map)──────────────────────
const { diagramSpec, redactNodeTexts } = require('../../src/platform/board')

test('digestNodes: composite_shape → [图形] id at(x,y) w×h <shape> "文字"(text 在 node.text)', () => {
  const r = digestNodes([{
    id: 's1', type: 'composite_shape', x: 10.6, y: 20.2, width: 120, height: 60,
    composite_shape: { type: 'round_rect' }, text: { text: '登录页' },
  }])
  assert.equal(r.lines[0], '[图形] s1 at(11,20) 120×60 <round_rect> "登录页"')
})

test('digestNodes: composite_shape 文字嵌在 composite_shape.text 也能取', () => {
  const r = digestNodes([{
    id: 's2', type: 'composite_shape', x: 0, y: 0, width: 80, height: 40,
    composite_shape: { type: 'diamond', text: { text: '判断?' } },
  }])
  assert.equal(r.lines[0], '[图形] s2 at(0,0) 80×40 <diamond> "判断?"')
})

test('digestNodes: composite_shape 残缺 shape.type / 无文字 → ? 占位、不带引号,不抛', () => {
  const r = digestNodes([{ id: 's3', type: 'composite_shape', x: 5, y: 6 }])
  assert.equal(r.lines[0], '[图形] s3 at(5,6) ?×? <?>')
})

// ⚠ 真机形态(2026-07-28 探针):导图树父节点在 mind_map_node.parent_id,**顶层 parent_id 为空**。
// 此前 fixture 照「顶层 parent_id」写,与真机不符 ⇒ 单测绿而线上层级恒不显示。
test('digestNodes: mind_map → 树父节点取自 mind_map_node.parent_id', () => {
  const nodes = [
    { id: 'm0', type: 'mind_map', x: 0, y: 0, text: { text: '根主题' } },
    { id: 'm1', type: 'mind_map', x: 200, y: 40, mind_map_node: { parent_id: 'm0' }, text: { text: '分支A' } },
  ]
  const r = digestNodes(nodes)
  assert.deepEqual(r.lines, [
    '[导图] m0 at(0,0) "根主题"',
    '[导图] m1 at(200,40) "分支A" (parent:m0)',
  ])
})

test('digestNodes: mind_map 顶层 parent_id(移植打组后=组 id)不冒充树父节点', () => {
  // 打组后每个成员的顶层 parent_id 都指向 group,拿它当树父节点会把「组」误报成「上级主题」
  const r = digestNodes([{ id: 'm1', type: 'mind_map', x: 1, y: 2, parent_id: 'dgrp1', text: { text: '分支A' } }])
  assert.deepEqual(r.lines, ['[导图] m1 at(1,2) "分支A"'])
})

test('digestNodes: mind_map 弃用的 mind_map.parent_id 仍兼容读出', () => {
  const r = digestNodes([{ id: 'm1', type: 'mind_map', x: 1, y: 2, mind_map: { parent_id: 'm0', text: { text: '旧形态' } } }])
  assert.deepEqual(r.lines, ['[导图] m1 at(1,2) "旧形态" (parent:m0)'])
})

test('digestNodes: 导图根节点 parent_id 为空串 → 不渲染空的 (parent:)', () => {
  // 真机形态:根节点的 mind_map_node.parent_id 是 '',只判 != null 会渲出 "(parent:)"
  const r = digestNodes([{ id: 'm0', type: 'mind_map', x: 0, y: 0, mind_map_node: { parent_id: '' }, text: { text: '根主题' } }])
  assert.deepEqual(r.lines, ['[导图] m0 at(0,0) "根主题"'])
})

test('digestNodes: group → [组] 行报成员数', () => {
  const r = digestNodes([{ id: 'n1', type: 'group', x: 10, y: 20, children: ['a', 'b', 'c'] }])
  // 文案必须与 CLI 连带删除行为一致(曾写反成「删组只解散、不删成员」)
  assert.equal(r.lines[0], '[组] n1 at(10,20) 含 3 个成员(整组删除:board-del-node n1 —— 连带全部成员,只重写画板一次)')
  // children 缺失(建组回包尚未派生)也不抛
  assert.equal(digestNodes([{ id: 'n2', type: 'group', x: 0, y: 0 }]).lines[0], '[组] n2 at(0,0) 含 0 个成员(整组删除:board-del-node n2 —— 连带全部成员,只重写画板一次)')
})

test('digestNodes: mind_map 文字嵌在 mind_map.text / 全缺字段 → 防御不抛', () => {
  const r = digestNodes([
    { id: 'm2', type: 'mind_map', x: 1, y: 2, mind_map: { text: { text: '嵌套文字' } } },
    { id: 'm3', type: 'mind_map' },
  ])
  assert.deepEqual(r.lines, [
    '[导图] m2 at(1,2) "嵌套文字"',
    '[导图] m3 at(?,?)',
  ])
})

// ── diagramSpec:语法/类型/样式全分支 ─────────────────────────────────────────

test('diagramSpec: 扩展名识别语法(.mmd/.mermaid→2,.puml/.plantuml/.uml→1)', () => {
  assert.equal(diagramSpec('a.mmd', {}).syntaxType, 2)
  assert.equal(diagramSpec('a.mermaid', {}).syntaxType, 2)
  assert.equal(diagramSpec('a.puml', {}).syntaxType, 1)
  assert.equal(diagramSpec('a.plantuml', {}).syntaxType, 1)
  assert.equal(diagramSpec('a.uml', {}).syntaxType, 1)
  assert.equal(diagramSpec('DIR/Sub/Flow.MMD', {}).syntaxType, 2) // 大小写 + 带路径
})

test('diagramSpec: --syntax 覆盖扩展名', () => {
  assert.equal(diagramSpec('a.puml', { syntax: 'mermaid' }).syntaxType, 2) // 覆盖 .puml
  assert.equal(diagramSpec('a.txt', { syntax: 'plantuml' }).syntaxType, 1) // 扩展名识别不出也能靠 --syntax
})

test('diagramSpec: 识别不出且无 --syntax → 中文报错要求指定', () => {
  assert.throws(() => diagramSpec('a.txt', {}), /无法从扩展名识别图表语法.*--syntax/)
  assert.throws(() => diagramSpec('noext', {}), /--syntax/)
})

test('diagramSpec: 非法 --syntax → 报可用值', () => {
  assert.throws(() => diagramSpec('a.mmd', { syntax: 'graphviz' }), /未知的图表语法.*mermaid.*plantuml/)
})

test('diagramSpec: --type 英文映射到 diagram_type', () => {
  assert.equal(diagramSpec('a.mmd', { type: 'mindmap' }).diagramType, 1)
  assert.equal(diagramSpec('a.mmd', { type: 'sequence' }).diagramType, 2)
  assert.equal(diagramSpec('a.mmd', { type: 'activity' }).diagramType, 3)
  assert.equal(diagramSpec('a.mmd', { type: 'class' }).diagramType, 4)
  assert.equal(diagramSpec('a.mmd', { type: 'er' }).diagramType, 5)
  assert.equal(diagramSpec('a.mmd', { type: 'ER' }).diagramType, 5) // 大小写
  assert.equal(diagramSpec('a.mmd', { type: 'flow' }).diagramType, 6)
  assert.equal(diagramSpec('a.mmd', { type: 'usecase' }).diagramType, 7)
  assert.equal(diagramSpec('a.mmd', { type: 'component' }).diagramType, 8)
})

test('diagramSpec: --type 中文别名映射(架构图→8)', () => {
  assert.equal(diagramSpec('a.mmd', { type: '思维导图' }).diagramType, 1)
  assert.equal(diagramSpec('a.mmd', { type: '时序图' }).diagramType, 2)
  assert.equal(diagramSpec('a.mmd', { type: 'ER图' }).diagramType, 5)
  assert.equal(diagramSpec('a.mmd', { type: '流程图' }).diagramType, 6)
  assert.equal(diagramSpec('a.mmd', { type: '组件图' }).diagramType, 8)
  assert.equal(diagramSpec('a.mmd', { type: '架构图' }).diagramType, 8)
})

test('diagramSpec: 缺省 type → 0(自动识别)', () => {
  assert.equal(diagramSpec('a.mmd', {}).diagramType, 0)
  assert.equal(diagramSpec('a.mmd', { type: '' }).diagramType, 0)
  assert.equal(diagramSpec('a.mmd', { type: '  ' }).diagramType, 0)
})

test('diagramSpec: 非法 --type → 报可用列表', () => {
  assert.throws(() => diagramSpec('a.mmd', { type: 'gantt' }), /未知的图类型.*flow.*架构图/)
})

test('diagramSpec: style 缺省 1;--as-image 仅 plantuml 给 2(style2 服务端拒 mermaid,2026-07-27 真机)', () => {
  assert.equal(diagramSpec('a.mmd', {}).styleType, 1)
  assert.equal(diagramSpec('a.mmd', { asImage: false }).styleType, 1)
  assert.equal(diagramSpec('a.mmd', { asImage: true }).styleType, 1)  // mermaid+style2 = invalid arg 2890002 ⇒ 恒 1
  assert.equal(diagramSpec('a.puml', { asImage: true }).styleType, 2) // plantuml 官方整图可用
  assert.equal(diagramSpec('a.puml', { asImage: false }).styleType, 1)
})

test('diagramSpec: 组合返回三字段', () => {
  assert.deepEqual(diagramSpec('flow.mmd', { type: 'flow', asImage: true }), { syntaxType: 2, diagramType: 6, styleType: 1 })
  assert.deepEqual(diagramSpec('flow.puml', { type: 'flow', asImage: true }), { syntaxType: 1, diagramType: 6, styleType: 2 })
})

// ── redactNodeTexts:只脱敏文本键,不碰 id/token/type ──────────────────────────

test('redactNodeTexts: text.text / captions 内 text 被脱敏,id/token/type 原样', () => {
  const R = (s) => s.replace(/AKIA[0-9A-Z]{12,}/g, '[r]')
  const nodes = [
    { id: 'n1', type: 'text_shape', token: 'AKIAABCDEFGHIJKLMNOP', text: { text: '密钥 AKIAABCDEFGHIJKLMNOP 在此', font_size: 14 } },
    { id: 'n2', type: 'connector', connector: { captions: [{ text: { text: '看 AKIAABCDEFGHIJKLMNOP' } }] } },
  ]
  const out = redactNodeTexts(nodes, R)
  // 文本被脱敏
  assert.equal(out[0].text.text, '密钥 [r] 在此')
  assert.equal(out[1].connector.captions[0].text.text, '看 [r]')
  // 结构字段(哪怕值长得像密钥)不碰
  assert.equal(out[0].token, 'AKIAABCDEFGHIJKLMNOP')
  assert.equal(out[0].id, 'n1')
  assert.equal(out[0].type, 'text_shape')
  assert.equal(out[0].text.font_size, 14)
})

test('redactNodeTexts: 裸字符串 text 值 + 数组内文本;不改入参(纯函数)', () => {
  const R = (s) => s.replace(/secret/g, '***')
  const nodes = [{ id: 'x', type: 'sticky_note', text: 'this is secret' }]
  const out = redactNodeTexts(nodes, R)
  assert.equal(out[0].text, 'this is ***')
  assert.equal(nodes[0].text, 'this is secret', '入参未被修改')
})

test('redactNodeTexts: 非 text 键的字符串不动;无 redactFn 退化为恒等', () => {
  const R = (s) => '[X]'
  const nodes = [{ id: 'keep-id', type: 'keep-type', title: 'keep-title', text: 'go' }]
  const out = redactNodeTexts(nodes, R)
  assert.equal(out[0].id, 'keep-id')
  assert.equal(out[0].type, 'keep-type')
  assert.equal(out[0].title, 'keep-title') // title 不是 text 键,不脱敏
  assert.equal(out[0].text, '[X]')
  // 无 redactFn → 恒等克隆
  const id = redactNodeTexts([{ id: 'a', text: 'b' }])
  assert.deepEqual(id, [{ id: 'a', text: 'b' }])
})

test('redactNodeTexts: 深层嵌套 / null / 非对象元素防御', () => {
  const R = (s) => s.toUpperCase()
  const nodes = [
    { id: 'a', mind_map: { text: { text: 'deep' } } },
    null,
    'garbage',
    { id: 'b' },
  ]
  const out = redactNodeTexts(nodes, R)
  assert.equal(out[0].mind_map.text.text, 'DEEP')
  assert.equal(out[1], null)
  assert.equal(out[2], 'garbage')
  assert.deepEqual(out[3], { id: 'b' })
})

// ── 图表移植纯函数(v0.7.2:scratch 渲染 → 主画板搬运)────────────────────────────
const { besideRegionPosition, nodesBBox, sanitizeDiagramNodes, shiftDiagramNodes, groupDiagramBatch, expandDeleteIds, parseInvalidNodeFields } = require('../../src/platform/board')

// besideRegionPosition —— 与 besideImagePosition 同款但占位带扩到入图高度
test('besideRegionPosition: 新图落参照右侧,y=参照顶', () => {
  const nodes = [{ id: 'd1', x: 100, y: 200, width: 300, height: 200 }]
  assert.deepEqual(besideRegionPosition(nodes, 'd1', 300, 200), { x: 440, y: 200 }) // 100+300+40
})

test('besideRegionPosition: 占位带扩到入图高度 —— 高图会避让参照带下方的节点', () => {
  const nodes = [
    { id: 'ref', x: 0, y: 0, width: 200, height: 100 },     // 参照,高 100
    { id: 'below', x: 500, y: 150, width: 200, height: 100 }, // 在参照下方(y150),参照自身高度带够不到
  ]
  // 入图高度 400 ⇒ 占位带 [0,400] 覆盖 below(y150) ⇒ 推进到 below 右缘 700+40
  assert.deepEqual(besideRegionPosition(nodes, 'ref', 300, 400), { x: 740, y: 0 })
  // 入图矮(高 80)⇒ 占位带 [0,100] 够不到 below ⇒ 只按参照右缘
  assert.deepEqual(besideRegionPosition(nodes, 'ref', 300, 80), { x: 240, y: 0 })
})

test('besideRegionPosition: 参照 id 不存在 → 回退全局 + fallback', () => {
  const nodes = [{ id: 'a', x: 0, y: 0, width: 300, height: 200 }]
  const p = besideRegionPosition(nodes, 'gone', 300, 200)
  assert.equal(p.fallback, true)
  assert.deepEqual({ x: p.x, y: p.y }, { x: 340, y: 0 })
})

test('besideRegionPosition: 空画板 → 回退原点 + fallback', () => {
  const p = besideRegionPosition([], 'x', 100, 100)
  assert.equal(p.fallback, true)
  assert.deepEqual({ x: p.x, y: p.y }, { x: 0, y: 0 })
})

// nodesBBox —— 一组节点的并集包围盒
test('nodesBBox: 多形状取并集;connector 全吸附回退顶层 bbox', () => {
  const nodes = [
    { id: 's1', type: 'composite_shape', x: 100, y: 100, width: 120, height: 60 },
    { id: 's2', type: 'composite_shape', x: 400, y: 300, width: 80, height: 40 },
    { id: 'c1', type: 'connector', x: 220, y: 130, width: 180, height: 200, connector: { start: { attached_object: { id: 's1' } }, end: { attached_object: { id: 's2' } } } },
  ]
  assert.deepEqual(nodesBBox(nodes), { minX: 100, minY: 100, maxX: 480, maxY: 340 })
})

test('nodesBBox: 无几何 / 空 → null', () => {
  assert.equal(nodesBBox([]), null)
  assert.equal(nodesBBox([{ id: 'x', type: 'text_shape', text: { text: 'no geo' } }]), null)
  assert.equal(nodesBBox(null), null)
})

// sanitizeDiagramNodes —— 剔 children / 保 id·parent_id / dropKeys
test('sanitizeDiagramNodes: 剔 children,保留 id 与 parent_id(批内引用)', () => {
  const nodes = [
    { id: 'm0', type: 'mind_map', x: 0, y: 0, children: ['m1'], mind_map: { text: { text: '根' } } },
    { id: 'm1', type: 'mind_map', x: 200, y: 40, parent_id: 'm0', mind_map: { text: { text: '枝' } } },
    { id: 'c1', type: 'connector', connector: { start: { attached_object: { id: 'm0' } }, end: { attached_object: { id: 'm1' } } } },
  ]
  const out = sanitizeDiagramNodes(nodes)
  assert.equal(out[0].children, undefined) // children 剔掉
  assert.equal(out[0].id, 'm0') // id 保留(批内引用键)
  assert.equal(out[1].parent_id, 'm0') // parent_id 保留(批内父子引用)
  assert.equal(out[2].connector.start.attached_object.id, 'm0') // 吸附 id 保留
})

test('sanitizeDiagramNodes: dropKeys 逐个剔顶层键;不改入参', () => {
  const nodes = [{ id: 'n1', type: 'composite_shape', x: 1, y: 2, z_index: 5, opacity: 100, children: [] }]
  const out = sanitizeDiagramNodes(nodes, ['z_index', 'opacity'])
  assert.equal(out[0].z_index, undefined)
  assert.equal(out[0].opacity, undefined)
  assert.equal(out[0].children, undefined)
  assert.equal(out[0].x, 1)
  assert.equal(nodes[0].z_index, 5, '入参未被修改')
})

test('sanitizeDiagramNodes: 非对象元素防御', () => {
  const out = sanitizeDiagramNodes([null, 'x', { id: 'a' }])
  assert.deepEqual(out, [null, 'x', { id: 'a' }])
  assert.deepEqual(sanitizeDiagramNodes(null), [])
})

// shiftDiagramNodes —— 平移绝对坐标,保留相对量
test('shiftDiagramNodes: 顶层 x/y 平移;connector 自由端平移、吸附端与 turning_points 不动', () => {
  const nodes = [
    { id: 's1', type: 'composite_shape', x: 100, y: 200, width: 80, height: 40 },
    { id: 'c1', type: 'connector', x: 390, y: 635, width: 600, height: 82,
      connector: {
        start: { attached_object: { id: 's1', position: { x: 1, y: 0.5 } } }, // 吸附端:相对量不动
        end: { position: { x: 996, y: 635 } },                                // 自由端:绝对平移
        turning_points: [{ x: 303, y: 82 }],                                  // 连接线相对量:不动
      } },
  ]
  const out = shiftDiagramNodes(nodes, 50, -100)
  assert.deepEqual({ x: out[0].x, y: out[0].y }, { x: 150, y: 100 })      // 100+50, 200-100
  assert.deepEqual({ x: out[1].x, y: out[1].y }, { x: 440, y: 535 })      // 顶层 bbox 平移
  assert.deepEqual(out[1].connector.end.position, { x: 1046, y: 535 })    // 自由端平移
  assert.deepEqual(out[1].connector.start.attached_object.position, { x: 1, y: 0.5 }) // 吸附相对量原样
  assert.deepEqual(out[1].connector.turning_points[0], { x: 303, y: 82 }) // turning_points 原样
})

test('shiftDiagramNodes: 0 位移恒等;不改入参', () => {
  const nodes = [{ id: 'a', x: 10, y: 20, width: 5, height: 5 }]
  const out = shiftDiagramNodes(nodes, 0, 0)
  assert.deepEqual(out[0], { id: 'a', x: 10, y: 20, width: 5, height: 5 })
  const nodes2 = [{ id: 'b', x: 1, y: 1 }]
  shiftDiagramNodes(nodes2, 100, 100)
  assert.deepEqual(nodes2[0], { id: 'b', x: 1, y: 1 }, '入参未被修改')
})

test('shiftDiagramNodes: paint 点列平移、不双移 x/y;非对象防御', () => {
  const nodes = [{ id: 'p', type: 'paint', x: 0, y: 0, points: [{ x: 10, y: 10 }, { x: 30, y: 40 }] }, null]
  const out = shiftDiagramNodes(nodes, 5, 5)
  assert.deepEqual(out[0].points, [{ x: 15, y: 15 }, { x: 35, y: 45 }])
  assert.equal(out[0].x, 0, 'paint 的 x 不双移(几何在点列)')
  assert.equal(out[1], null)
})

// 审查 #2:平移的点形识别必须与 _pointsBBox 同款三形态,否则「bbox 算了它、平移漏了它」
test('shiftDiagramNodes: 数组点形 [x,y] 与 paint.lines 嵌套点列也平移;空点列回落 x/y', () => {
  const arr = shiftDiagramNodes([{ id: 'a', type: 'paint', x: 0, y: 0, points: [[10, 10], [30, 40]] }], 5, 5)
  assert.deepEqual(arr[0].points, [[15, 15], [35, 45]], '数组点形平移')
  assert.equal(arr[0].x, 0, '有点列时 x 不双移')
  const lines = shiftDiagramNodes([{ id: 'l', type: 'paint', x: 0, y: 0, paint: { lines: [{ points: [{ x: 1, y: 1 }] }] } }], 5, 5)
  assert.deepEqual(lines[0].paint.lines[0].points, [{ x: 6, y: 6 }], 'paint.lines 嵌套点列平移')
  assert.equal(lines[0].x, 0, '嵌套点列时 x 不双移')
  const empty = shiftDiagramNodes([{ id: 'e', type: 'paint', x: 7, y: 8, points: [] }], 5, 5)
  assert.equal(empty[0].x, 12, '空点列视同无点列,回落 x/y 平移')
  assert.equal(empty[0].y, 13)
})

// parseInvalidNodeFields —— 从 99992402 报错抽被拒字段名(真机形态未知,防御式)
// ── expandDeleteIds(删除展开:省 API 调用的关键 —— 删=整板 overwrite,一次删完 vs 逐个删差 50 倍)──
test('expandDeleteIds: 传组 id → 连带全部成员', () => {
  const nodes = [
    { id: 'g1', type: 'group' },
    { id: 'a', type: 'composite_shape', parent_id: 'g1' },
    { id: 'b', type: 'composite_shape', parent_id: 'g1' },
    { id: 'z', type: 'image' }, // 组外,不该被牵连
  ]
  const r = expandDeleteIds(nodes, ['g1'])
  assert.deepEqual(r.ids.sort(), ['a', 'b', 'g1'])
  assert.deepEqual(r.cascaded.sort(), ['a', 'b'])
})

test('expandDeleteIds: 传导图节点 → 连带整棵子树(树关系在 mind_map_node.parent_id)', () => {
  const nodes = [
    { id: 'root', type: 'mind_map' },
    { id: 'k1', type: 'mind_map', mind_map_node: { parent_id: 'root' } },
    { id: 'k2', type: 'mind_map', mind_map_node: { parent_id: 'root' } },
    { id: 'k11', type: 'mind_map', mind_map_node: { parent_id: 'k1' } },
  ]
  assert.deepEqual(expandDeleteIds(nodes, ['root']).ids.sort(), ['k1', 'k11', 'k2', 'root'])
  // 删中间分支只带走它自己的子树,不碰兄弟
  assert.deepEqual(expandDeleteIds(nodes, ['k1']).ids.sort(), ['k1', 'k11'])
})

test('expandDeleteIds: 成员被删光的组自动清掉(治画板积空组)', () => {
  const nodes = [
    { id: 'g1', type: 'group' },
    { id: 'a', type: 'composite_shape', parent_id: 'g1' },
    { id: 'b', type: 'composite_shape', parent_id: 'g1' },
  ]
  const r = expandDeleteIds(nodes, ['a', 'b'])
  assert.ok(r.ids.includes('g1'), '组成员删光,组本身应一并删除')
  assert.deepEqual(r.cascaded, ['g1'])
  // 只删一个成员 ⇒ 组还有活着的成员,不该被清
  assert.equal(expandDeleteIds(nodes, ['a']).ids.includes('g1'), false)
})

test('expandDeleteIds: 嵌套组取到不动点 / 已存在的空组不误删', () => {
  const nodes = [
    { id: 'outer', type: 'group' },
    { id: 'inner', type: 'group', parent_id: 'outer' },
    { id: 'a', type: 'composite_shape', parent_id: 'inner' },
    { id: 'lonely', type: 'group' }, // 本来就没有成员(v0.7.8 残骸):没被点名就别动它
  ]
  const r = expandDeleteIds(nodes, ['a'])
  assert.ok(r.ids.includes('inner') && r.ids.includes('outer'), '内层空了→外层也空→都该清掉')
  assert.equal(r.ids.includes('lonely'), false)
})

test('expandDeleteIds: 环形 parent_id 不死循环;空输入/脏输入防御', () => {
  const cyc = [{ id: 'x', type: 'group', parent_id: 'y' }, { id: 'y', type: 'group', parent_id: 'x' }]
  assert.deepEqual(expandDeleteIds(cyc, ['x']).ids.sort(), ['x', 'y'])
  assert.deepEqual(expandDeleteIds([], []).ids, [])
  assert.deepEqual(expandDeleteIds(null, null).ids, [])
  assert.deepEqual(expandDeleteIds([{ id: 'a' }], ['a', '', null]).ids, ['a']) // 空 id 被滤掉
})

test('expandDeleteIds: 无可连带时 = 原样(cascaded 为空)', () => {
  const nodes = [{ id: 'a', type: 'image' }, { id: 'b', type: 'image' }]
  const r = expandDeleteIds(nodes, ['a', 'b'])
  assert.deepEqual(r.ids.sort(), ['a', 'b'])
  assert.deepEqual(r.cascaded, [])
})

// ── groupDiagramBatch(整批打组;2026-07-28 真机探针定案:组关系走成员 parent_id,不是 group.children)──
test('groupDiagramBatch: 组放批首 + 成员写 parent_id + 组几何=成员并集 bbox', () => {
  const nodes = [
    { id: 'a', type: 'composite_shape', x: 0, y: 0, width: 120, height: 60 },
    { id: 'b', type: 'composite_shape', x: 200, y: 40, width: 120, height: 60 },
  ]
  const { batch, groupLocalId } = groupDiagramBatch(nodes)
  assert.equal(groupLocalId, 'dgrp1')
  assert.equal(batch.length, 3)
  // 组必须在批首:成员引用批内**先出现**的 id(探针验证过的形态)
  assert.deepEqual(batch[0], { id: 'dgrp1', type: 'group', x: 0, y: 0, width: 320, height: 100 })
  assert.equal(batch[1].parent_id, 'dgrp1')
  assert.equal(batch[2].parent_id, 'dgrp1')
  // children 绝不下发 —— 只读字段,写了服务端静默丢弃并建出空组(v0.7.8 的根因)
  assert.equal(batch[0].children, undefined)
})

test('groupDiagramBatch: 已有父的节点不被抢走 parent_id', () => {
  const nodes = [
    { id: 'root', type: 'mind_map', x: 0, y: 0, width: 100, height: 40 },
    { id: 'kid', type: 'mind_map', x: 150, y: 0, width: 100, height: 40, parent_id: 'somebox' },
  ]
  const { batch } = groupDiagramBatch(nodes)
  assert.equal(batch[1].parent_id, 'dgrp1') // 原本无父 → 挂组
  assert.equal(batch[2].parent_id, 'somebox') // 原本有父 → 原样不动
})

test('groupDiagramBatch: 无几何/空数组 → 不打组,原样返回', () => {
  assert.deepEqual(groupDiagramBatch([]), { batch: [], groupLocalId: null })
  const noGeo = [{ id: 'x', type: 'text_shape', text: { text: '无坐标' } }]
  const r = groupDiagramBatch(noGeo)
  assert.equal(r.groupLocalId, null)
  assert.equal(r.batch, noGeo)
})

test('groupDiagramBatch: 纯函数不改入参;自定义 localId 生效', () => {
  const nodes = [{ id: 'a', type: 'composite_shape', x: 5, y: 5, width: 10, height: 10 }]
  const { batch, groupLocalId } = groupDiagramBatch(nodes, 'mygrp')
  assert.equal(groupLocalId, 'mygrp')
  assert.equal(batch[0].id, 'mygrp')
  assert.equal(batch[1].parent_id, 'mygrp')
  assert.equal(nodes[0].parent_id, undefined) // 入参未被污染
})

test('parseInvalidNodeFields: JSON 路径 / field 词 / is invalid 三种形态', () => {
  assert.deepEqual(parseInvalidNodeFields('field validation failed: nodes[2].z_index is invalid'), ['z_index'])
  assert.deepEqual(parseInvalidNodeFields("invalid field 'opacity'"), ['opacity'])
  assert.deepEqual(parseInvalidNodeFields('render_result is not allowed'), ['render_result'])
  assert.deepEqual(parseInvalidNodeFields('字段 fill_opacity 非法'), ['fill_opacity'])
})

test('parseInvalidNodeFields: 滤掉结构/协议词与 id/type;解析不出返回空', () => {
  const r = parseInvalidNodeFields('field validation failed')
  assert.deepEqual(r, []) // validation/failed/field 全被过滤
  assert.deepEqual(parseInvalidNodeFields('nodes[0].id is invalid'), []) // id 不剔
  assert.deepEqual(parseInvalidNodeFields(''), [])
  assert.deepEqual(parseInvalidNodeFields(null), [])
})

// ── PNG 解码/编码/白边裁剪(图表交付卡预览;2026-07-27 真机定案:飞书导出=2560² 顶对齐 fit,
// style2 整图仅 plantuml ⇒ mermaid 预览走「导出 scratch + 白边裁剪」)──────────────────────
const { decodePngRGBA, encodePngRGBA, trimPngWhitespace } = require('../../src/platform/board')

const mkCanvas = (w, h, fill = [255, 255, 255, 255]) => { const px = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) px.set(fill, i * 4); return px }
const setRect = (px, w, x0, y0, x1, y1, rgba) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.set(rgba, (y * w + x) * 4) }
const pxAt = (d, x, y) => Array.from(d.px.subarray((y * d.width + x) * 4, (y * d.width + x) * 4 + 4))

test('png: encodePngRGBA → decodePngRGBA 往返一致', () => {
  const px = mkCanvas(10, 6, [7, 8, 9, 255])
  setRect(px, 10, 2, 1, 5, 4, [200, 100, 50, 128])
  const buf = encodePngRGBA(px, 10, 6)
  const d = decodePngRGBA(buf)
  assert.equal(d.width, 10); assert.equal(d.height, 6)
  assert.deepEqual(pxAt(d, 0, 0), [7, 8, 9, 255])
  assert.deepEqual(pxAt(d, 2, 1), [200, 100, 50, 128])
  assert.deepEqual(pxAt(d, 4, 3), [200, 100, 50, 128])
  assert.deepEqual(pxAt(d, 5, 4), [7, 8, 9, 255])
})

test('trim: 白底色块 → 裁到内容+margin,内容居中保留', () => {
  const px = mkCanvas(200, 200)
  setRect(px, 200, 50, 60, 80, 100, [220, 30, 30, 255]) // 红块 30×40
  const out = trimPngWhitespace(encodePngRGBA(px, 200, 200), { margin: 24 })
  assert.ok(out)
  const d = decodePngRGBA(out)
  assert.equal(d.width, 30 + 48)   // 内容 30 + 两侧 margin 24
  assert.equal(d.height, 40 + 48)
  assert.deepEqual(pxAt(d, 24, 24), [220, 30, 30, 255])          // 左上内容角
  assert.deepEqual(pxAt(d, 24 + 29, 24 + 39), [220, 30, 30, 255]) // 右下内容角
  assert.deepEqual(pxAt(d, 0, 0), [255, 255, 255, 255])           // margin 区是白
})

test('trim: 浅色填充(如 #EBF1FA)也判内容;margin 越界 clamp 到图内', () => {
  const px = mkCanvas(100, 100)
  setRect(px, 100, 0, 0, 20, 20, [235, 241, 250, 255]) // 贴左上角的浅蓝块(min 通道 235 < 245)
  const out = trimPngWhitespace(encodePngRGBA(px, 100, 100), { margin: 24 })
  assert.ok(out)
  const d = decodePngRGBA(out)
  assert.equal(d.width, 44)  // x: 0..19 内容 + 右 margin 24(左被 clamp)
  assert.equal(d.height, 44)
  assert.deepEqual(pxAt(d, 0, 0), [235, 241, 250, 255])
})

test('trim: 全白 / 收益太小 / 非 PNG → null', () => {
  assert.equal(trimPngWhitespace(encodePngRGBA(mkCanvas(50, 50), 50, 50)), null) // 全白
  const near = mkCanvas(100, 100)
  setRect(near, 100, 2, 2, 98, 98, [10, 10, 10, 255]) // 内容几乎满幅 ⇒ 裁后 ≥90% 面积
  assert.equal(trimPngWhitespace(encodePngRGBA(near, 100, 100)), null)
  assert.equal(trimPngWhitespace(Buffer.from('not a png at all')), null)
  assert.equal(trimPngWhitespace(Buffer.alloc(0)), null)
})

test('trim: 透明像素视为空白(α≤16 不算内容)', () => {
  const px = mkCanvas(60, 60, [0, 0, 0, 0]) // 全透明黑
  setRect(px, 60, 20, 20, 30, 30, [0, 0, 0, 255]) // 中间不透明黑块
  const out = trimPngWhitespace(encodePngRGBA(px, 60, 60), { margin: 4 })
  assert.ok(out)
  const d = decodePngRGBA(out)
  assert.equal(d.width, 18); assert.equal(d.height, 18) // 10 内容 + 两侧 4
})

test('png decode: filter Sub/Up 行正确重建(手拼 colorType 2 RGB)', () => {
  const zlibT = require('node:zlib')
  // 4×2 RGB:row0 filter1(Sub):首像素原值 (10,20,30),后续差值 +1 ⇒ (11,21,31)(12,22,32)(13,23,33)
  // row1 filter2(Up):全 0 差值 ⇒ 与 row0 相同
  const stride = 4 * 3
  const raw = Buffer.alloc((stride + 1) * 2)
  raw[0] = 1
  raw.set([10, 20, 30, 1, 1, 1, 1, 1, 1, 1, 1, 1], 1)
  raw[stride + 1] = 2 // row1: Up,差值全 0
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b } // CRC 填 0(decode 不校验)
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibT.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  const d = decodePngRGBA(png)
  assert.ok(d)
  assert.deepEqual(pxAt(d, 0, 0), [10, 20, 30, 255])
  assert.deepEqual(pxAt(d, 3, 0), [13, 23, 33, 255])
  assert.deepEqual(pxAt(d, 3, 1), [13, 23, 33, 255]) // Up 复制上一行
})

test('png decode: 不支持形态返回 null(位深16 / 隔行)', () => {
  const mk = (bitDepth, interlace) => {
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = bitDepth; ihdr[9] = 2; ihdr[12] = interlace
    const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b }
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))])
  }
  assert.equal(decodePngRGBA(mk(16, 0)), null)
  assert.equal(decodePngRGBA(mk(8, 1)), null)
})

test('png decode: colorType 3(palette+tRNS)正确映射;索引越界坏调色板 → null', () => {
  const zlibT = require('node:zlib')
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 3
  const raw = Buffer.from([0, 0, 1]) // filter0 + 索引 0、1
  const mk = (plte, trns) => Buffer.concat([sig, chunk('IHDR', ihdr), chunk('PLTE', plte), ...(trns ? [chunk('tRNS', trns)] : []), chunk('IDAT', zlibT.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  const d = decodePngRGBA(mk(Buffer.from([255, 0, 0, 0, 0, 255]), Buffer.from([200]))) // 红/蓝;tRNS 只盖索引0
  assert.ok(d)
  assert.deepEqual(pxAt(d, 0, 0), [255, 0, 0, 200]) // 索引0:红 + tRNS α
  assert.deepEqual(pxAt(d, 1, 0), [0, 0, 255, 255]) // 索引1:蓝 + 缺省 α255
  assert.equal(decodePngRGBA(mk(Buffer.from([255, 0, 0]))), null) // 调色板只有 1 色,索引 1 越界 → null
})

// ── 卡内预览高宽比封顶(v0.8.1;手机 UI 原型 9:19.5 撑爆交付卡)────────────────────────────
// cardkit 的 img 只有 fit_horizontal 能自适应卡宽,而它拒 size(2026-07-29 生产凭证字段探针)
// ⇒ 竖长图卡高 ≈2.2 倍卡宽刷两屏。归一化只能在**上传前**做,故这里锁死几何与底色口径。
const { padToMaxAspect } = require('../../src/platform/board')

test('padToMaxAspect: 高宽比已达标 → 内容原样、padded:false、reason 说明为何不补', () => {
  const px = mkCanvas(200, 100, [9, 9, 9, 255])
  const r = padToMaxAspect(px, 200, 100)
  assert.equal(r.padded, false)
  assert.equal(r.reason, 'within-ratio')
  assert.deepEqual(pxAt(r, 0, 0), [9, 9, 9, 255]) // 内容不变(不锁「同一引用」:那是实现细节,不是契约)
  assert.equal(r.width, 200); assert.equal(r.height, 100)
  assert.equal(padToMaxAspect(px, 100, 130).reason, 'within-ratio') // 恰好 =1.3 也算达标(闭区间)
  // 不补白也回传**取整后**的尺寸:两条路的口径一致,调用方不用自己再取一次整
  const frac = padToMaxAspect(px, 200.7, 100.9)
  assert.equal(frac.width, 200); assert.equal(frac.height, 100)
  assert.equal(padToMaxAspect(null, 100, 300).reason, 'bad-input') // 非 Buffer:防御,不抛
  assert.equal(padToMaxAspect(px, 0, 300).reason, 'bad-input') // 宽 0:除零守卫
  assert.equal(padToMaxAspect(px, 90, 195).reason, null) // 补白路 reason 为空
})

test('padToMaxAspect: 9:19.5 竖图 → 新宽 ceil(h/1.3)、高不变、原图水平居中(左少右多)', () => {
  const px = mkCanvas(90, 195, [250, 250, 250, 255]) // 页面底色(四角都是它)
  setRect(px, 90, 10, 10, 80, 185, [200, 50, 50, 255]) // 内容块
  setRect(px, 90, 0, 100, 1, 101, [0, 0, 255, 255]) // 左边缘定位标记(x=0,y=100)
  const r = padToMaxAspect(px, 90, 195)
  assert.equal(r.padded, true)
  assert.equal(r.width, 150) // ceil(195/1.3)=150 ⇒ 手机占卡宽 90/150=60%
  assert.equal(r.height, 195)
  // round-trip 一遍编解码,确认补出来的平面是合法 PNG(bin 侧就是这么落临时文件的)
  const d = decodePngRGBA(encodePngRGBA(r.px, r.width, r.height))
  assert.equal(d.width, 150); assert.equal(d.height, 195)
  const left = Math.floor((150 - 90) / 2) // 30;左右差 1 时左少右多,口径固定
  assert.deepEqual(pxAt(d, left, 100), [0, 0, 255, 255]) // 定位标记落在 x=left ⇒ 偏移精确
  assert.deepEqual(pxAt(d, left - 1, 100), [250, 250, 250, 255]) // 它左边一列已是补边
  assert.deepEqual(pxAt(d, 0, 0), [250, 250, 250, 255]) // 最左列 = 采样出的底色
  assert.deepEqual(pxAt(d, 149, 194), [250, 250, 250, 255]) // 最右列同理
  assert.deepEqual(pxAt(d, left + 45, 100), [200, 50, 50, 255]) // 内容原色未被改写
})

test('padToMaxAspect: 底色 = 四角平均;四角不一致/半透明 → 退纯白;显式 bg 覆盖且 α 恒 255', () => {
  const beige = mkCanvas(90, 195, [240, 236, 228, 255])
  setRect(beige, 90, 20, 20, 70, 170, [30, 30, 30, 255]) // 中间内容不影响四角
  assert.deepEqual(pxAt(padToMaxAspect(beige, 90, 195), 0, 0), [240, 236, 228, 255])

  const mixed = mkCanvas(90, 195, [240, 236, 228, 255])
  setRect(mixed, 90, 89, 194, 90, 195, [10, 236, 228, 255]) // 右下角单通道差 230 > 32
  assert.deepEqual(pxAt(padToMaxAspect(mixed, 90, 195), 0, 0), [255, 255, 255, 255])

  // 透明底(logo/图标/透明底 mockup 走 --deliver 的真实形态):α=0 的角 RGB 是没意义的 0,
  // 不看 α 就会采成黑 ⇒ 卡片上补出不透明黑框。要求退纯白。
  const alpha0 = mkCanvas(90, 195, [0, 0, 0, 0])
  setRect(alpha0, 90, 20, 20, 70, 170, [255, 255, 255, 255])
  assert.deepEqual(pxAt(padToMaxAspect(alpha0, 90, 195), 0, 0), [255, 255, 255, 255])
  const alphaHalf = mkCanvas(90, 195, [200, 30, 30, 128]) // 半透明红底:α<250 同样判「猜不出」
  assert.deepEqual(pxAt(padToMaxAspect(alphaHalf, 90, 195), 0, 0), [255, 255, 255, 255])

  const r = padToMaxAspect(beige, 90, 195, { bg: [12, 34, 56, 7] })
  assert.deepEqual(pxAt(r, 0, 0), [12, 34, 56, 255]) // α 强制不透明(半透明补边会露卡底)
  assert.deepEqual(pxAt(padToMaxAspect(beige, 90, 195, { bg: [1, 2] }), 0, 0), [240, 236, 228, 255]) // 残缺 bg → 回退采样
})

test('padToMaxAspect: maxRatio 非法 → 用 1.3;自定义阈值生效', () => {
  const px = mkCanvas(90, 195, [255, 255, 255, 255])
  for (const bad of [NaN, 0, -1, 'abc', undefined]) assert.equal(padToMaxAspect(px, 90, 195, { maxRatio: bad }).width, 150)
  assert.equal(padToMaxAspect(px, 90, 195, { maxRatio: 1 }).width, 195) // 1:1 封顶
  assert.equal(padToMaxAspect(px, 90, 195, { maxRatio: 3 }).reason, 'within-ratio') // 阈值放宽到 3 ⇒ 2.17 算达标
})

test('padToMaxAspect: 极端窄图 / px 截断 / 超大画布防呆都不崩', () => {
  const thin = padToMaxAspect(mkCanvas(1, 10, [7, 7, 7, 255]), 1, 10)
  assert.equal(thin.width, 8); assert.equal(thin.height, 10) // ceil(10/1.3)=8
  assert.deepEqual(pxAt(thin, 3, 5), [7, 7, 7, 255]) // left=floor(7/2)=3

  const short = padToMaxAspect(Buffer.alloc(10 * 50 * 4), 10, 100) // 只给了一半行数
  assert.equal(short.padded, true); assert.equal(short.width, 77) // ceil(100/1.3)
  assert.deepEqual(pxAt(short, 0, 99), [255, 255, 255, 255]) // 四角读不全 ⇒ 不猜底色,用白

  const huge = padToMaxAspect(Buffer.alloc(4), 1, 100000) // 补出来 >4000² ⇒ 不补,交付原图要紧
  assert.equal(huge.padded, false); assert.equal(huge.reason, 'too-large')
})

const { boardUsageNoteNodes } = require('../../src/platform/feishu')

test('画布使用说明便签: 直接改在前、画箭头降为提意见时才用(v0.11.16)', () => {
  const [bg, tx] = boardUsageNoteNodes()
  const text = tx.text.text
  assert.match(text, /直接在画板上改/)
  assert.ok(text.indexOf('直接在画板上改') < text.indexOf('画箭头'), '「直接改」必须排在「画箭头」前面 —— 顺序就是引导')
  // ⚠ 自动感知靠画布轮询,而生产机都把它关了(飞书月配额)⇒ 不能写「它会自动发现」
  assert.match(text, /回群里说一声/)
  assert.doesNotMatch(text, /自动(发现|感知|同步)/)
  // 文字得装得下:两个节点等高对齐,文字框留出内边距
  assert.ok(tx.height <= bg.height, '文字框不能高过底卡')
  assert.ok(bg.height >= 110, `三行文案要放得下,底卡实际 ${bg.height}`)
})
