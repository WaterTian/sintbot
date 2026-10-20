// 版本升级群播报(src/upgrade.js):版本比较 + 播报文案纯函数。
// 接线(daemon 启动后对比 state 播报)在 bin,不在单测范围;文案内容在此钉死。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { cmpVersion, buildUpgradeNotice } = require('../../src/upgrade')

const LOG = [
  { version: '0.3.6', date: '2026-07-16', name: '播报', items: [{ t: '版本升级群播报', d: 'x' }, { t: '浏览器配套', d: 'y' }] },
  { version: '0.3.5', date: '2026-07-16', name: '停', items: [{ t: '/stop 单条确认', d: 'z' }] },
  { version: '0.3.4', date: '2026-07-16', name: '并', items: [{ t: '排队消息合并处理', d: 'w' }] },
]

test('upgrade: cmpVersion 逐段数值比较(.10 > .9,字符串比较会错)', () => {
  assert.ok(cmpVersion('0.3.10', '0.3.9') > 0)
  assert.ok(cmpVersion('0.3.6', '0.3.5') > 0)
  assert.ok(cmpVersion('1.0.0', '0.9.9') > 0)
  assert.equal(cmpVersion('0.3.6', '0.3.6'), 0)
  assert.ok(cmpVersion('0.3.5', '0.3.6') < 0)
  assert.equal(cmpVersion('0.3', '0.3.0'), 0) // 段数不齐按 0 补
})

test('upgrade: 首次运行(无基线)/版本没变/降级 → 不播报', () => {
  assert.equal(buildUpgradeNotice(null, '0.3.6', LOG), null)
  assert.equal(buildUpgradeNotice('0.3.6', '0.3.6', LOG), null)
  assert.equal(buildUpgradeNotice('0.3.6', '0.3.5', LOG), null) // 回滚不宣传
})

test('upgrade: 单版升级 → 只列新版条目标题 + 版本历史引导', () => {
  const n = buildUpgradeNotice('0.3.5', '0.3.6', LOG)
  assert.match(n, /🚀 SintBot 已升级:v0\.3\.5 → v0\.3\.6/)
  assert.match(n, /【v0\.3\.6 · 播报】/)
  assert.match(n, /· 版本升级群播报/)
  assert.match(n, /· 浏览器配套/)
  assert.doesNotMatch(n, /0\.3\.5 · /) // 旧版条目不混进来
  assert.doesNotMatch(n, /排队消息合并/)
  assert.match(n, /版本历史/)
})

test('upgrade: 跨多版升级 → (last, current] 区间条目全列,新版在前', () => {
  const n = buildUpgradeNotice('0.3.4', '0.3.6', LOG)
  assert.match(n, /v0\.3\.4 → v0\.3\.6/)
  assert.ok(n.indexOf('v0.3.6 · 播报') < n.indexOf('v0.3.5 · 停'), '新版在前')
  assert.match(n, /\/stop 单条确认/)
  assert.doesNotMatch(n, /排队消息合并/) // 0.3.4 = 基线本身,不在区间内
})

test('upgrade: changelog 缺条目/空数组也出主行,不崩', () => {
  const n = buildUpgradeNotice('0.3.5', '0.3.6', [])
  assert.match(n, /v0\.3\.5 → v0\.3\.6/)
  assert.match(n, /版本历史/)
  assert.equal(buildUpgradeNotice('0.3.5', '0.3.6', undefined).includes('🚀'), true)
})

// CHANGELOG.json 有**两个**消费者,而两边都不认标记语言:控制台「版本历史」走 esc() 转义渲染,
// 群里的升级播报是纯文本消息(markdown 一律不渲染)。写进一个 <b> 就会在两处原样露出。
// v0.11.23 真写进去过一条(81 个版本里唯一一条),审查时才逮到 ⇒ 钉死。
test('CHANGELOG.json:条目正文不许含 HTML 标记(控制台转义 + 群播报纯文本,两边都会露出)', () => {
  const raw = require('../../CHANGELOG.json')
  const list = Array.isArray(raw) ? raw : (raw.versions || raw.entries || [])
  assert.ok(list.length >= 1, '对照组:确实读到了条目(不是空数组让下面的断言白过)')
  const bad = []
  for (const v of list) {
    for (const i of (v.items || [])) {
      for (const [field, text] of [['t', i.t], ['d', i.d]]) {
        // 只拦**成对的排版标签** —— 那才是「本想让它渲染」的写法。单独提到一个标签是正当引用
        // (0.8.1 就有一条在讲「换行用 <br/>」,那句话里的标签就是它要表达的内容本身)。
        if (/<(b|i|u|s|em|strong|span|p|div)\b[^>]{0,80}>[\s\S]{0,400}?<\/\1>/.test(String(text || ''))) {
          bad.push(`${v.version} ${field}: ${String(text).slice(0, 60)}`)
        }
      }
    }
  }
  assert.deepEqual(bad, [], '要强调请用「」,不要用标记语言')
})

// CHANGELOG.en.json = 版本历史的英文本,靠 version 与中文条目对应(控制台英文界面按版本号查表)。
// 允许缺版本(缺了就出中文),但**版本号写错就是静默失效** —— 那条英文永远查不到、也没人会发现。
test('CHANGELOG.en.json:形状正确,且每个版本号都在 CHANGELOG.json 里有对应条目', () => {
  const en = require('../../CHANGELOG.en.json')
  const zh = require('../../CHANGELOG.json')
  assert.ok(Array.isArray(en) && en.length >= 1, '对照组:确实读到了英文条目')
  const known = new Set(zh.map((v) => v.version))
  assert.ok(known.size >= 1, '对照组:中文版本号集合不是空的')
  const bad = []
  for (const v of en) {
    if (typeof v.version !== 'string' || !Array.isArray(v.items)) { bad.push(`形状不对:${JSON.stringify(v).slice(0, 60)}`); continue }
    if (!known.has(v.version)) bad.push(`版本号 ${v.version} 在 CHANGELOG.json 里不存在(拼错 = 这条英文永远用不上)`)
    for (const i of (v.items || [])) if (!i || typeof i.t !== 'string' || typeof i.d !== 'string') bad.push(`${v.version} 的条目缺 t/d`)
  }
  assert.deepEqual(bad, [])
})

test('upgrade: 播报里的产品名可配,默认 SintBot', () => {
  const { DEFAULT_BRAND } = require('../../src/upgrade')
  assert.equal(DEFAULT_BRAND, 'SintBot', '默认值改了 = 替所有没配 brand 的部署改了名')
  // 不传 = 老行为逐字不变
  assert.match(buildUpgradeNotice('0.1.0', '0.2.0', LOG), /^🚀 SintBot 已升级/)
  // 传了就用配的那个
  assert.match(buildUpgradeNotice('0.1.0', '0.2.0', LOG, 'AcmeBot'), /^🚀 AcmeBot 已升级/)
  assert.doesNotMatch(buildUpgradeNotice('0.1.0', '0.2.0', LOG, 'AcmeBot'), /SintBot/)
  // 空串/undefined 回默认,别播成「🚀  已升级」
  for (const v of ['', null, undefined]) assert.match(buildUpgradeNotice('0.1.0', '0.2.0', LOG, v), /^🚀 SintBot 已升级/)
})
