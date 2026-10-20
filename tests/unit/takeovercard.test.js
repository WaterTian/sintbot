// src/platform/takeovercard.js —— 接管卡片三态的形状与文案。
// 分辨力:每态各钉「该有的组件在、不该有的不在」;零工具名扫描带对照组;button 字段名按飞书真实要求钉(type / text 对象)。
const test = require('node:test')
const assert = require('node:assert/strict')
const { buildTakeoverCard, hostOf } = require('../../src/platform/takeovercard')

const tags = (c) => c.body.elements.map((e) => e.tag)

test('takeovercard: open 态 = 截图 + 说明 + 大按钮(open_url)+ 有效期 note;没图就没 img', () => {
  const c = buildTakeoverCard({ url: 'https://ca.example.com/browser#k=abc', pageTitle: '管理后台_登录', imgKey: 'img_v3_x', minutes: 10 })
  assert.equal(c.schema, '2.0'); assert.equal(c.header.template, 'orange'); assert.equal(c.header.title.content, '需要你帮它一把')
  assert.deepEqual(tags(c), ['img', 'markdown', 'button', 'markdown'])
  assert.equal(c.body.elements[3].text_size, 'notation', '有效期是小字 markdown —— 卡片 2.0 不认 note 组件(真机建卡被拒)')
  assert.equal(JSON.stringify(c).includes('"tag":"note"'), false, '整张卡不能出现 note')
  const btn = c.body.elements[2]
  assert.equal(btn.type, 'primary', 'button 样式字段叫 type(不是 button_style)')
  assert.deepEqual(btn.text, { tag: 'plain_text', content: '接管浏览器' }, 'button 文字是 text 对象;不点名手机 —— 电脑上一样能接管')
  assert.deepEqual(btn.behaviors, [{ type: 'open_url', default_url: 'https://ca.example.com/browser#k=abc' }])
  assert.equal(c.body.elements[0].img_key, 'img_v3_x'); assert.equal(c.body.elements[0].scale_type, 'fit_horizontal'); assert.equal(c.body.elements[0].size, undefined, 'fit_horizontal 与 size 互斥(真机坑 1)')
  assert.match(c.body.elements[1].content, /管理后台_登录/); assert.match(c.body.elements[3].content, /10 分钟内有效 · 只能打开一次/)
  const noImg = buildTakeoverCard({ url: 'https://x/browser#k=1', pageTitle: 't' })
  assert.deepEqual(tags(noImg), ['markdown', 'button', 'markdown'])
})

test('takeovercard: claimed / ended / expired 态没有按钮与截图,标题与主题色各自不同;标题缺时退到域名', () => {
  const c = buildTakeoverCard({ pageTitle: '管理后台', state: 'claimed' })
  assert.deepEqual(tags(c), ['markdown']); assert.equal(c.header.template, 'blue'); assert.match(c.header.title.content, /正在接管中/); assert.match(c.body.elements[0].content, /已有人接管/)
  const e = buildTakeoverCard({ pageUrl: 'https://example.com/login/index', state: 'expired' })
  assert.deepEqual(tags(e), ['markdown']); assert.equal(e.header.template, 'grey'); assert.match(e.body.elements[0].content, /example\.com/, '没标题就用域名')
  const d = buildTakeoverCard({ pageTitle: '管理后台', state: 'ended' })
  assert.deepEqual(tags(d), ['markdown']); assert.equal(d.header.template, 'green'); assert.match(d.header.title.content, /接管已结束/); assert.match(d.body.elements[0].content, /在群里说一声/)
  assert.notEqual(d.header.title.content, e.header.title.content, '结束与过期是两张不同的卡:人来过 / 没人来')
  assert.equal(hostOf('not a url'), 'not a url'); assert.equal(hostOf('https://a.b/c?d'), 'a.b')
})

test('takeovercard: 四态全部文案零工具名 / 零路径 / 零命令名(对照组:违规串必被抓)', () => {
  const bad = /\bsbot\b|~\/\.sbot|\/Users\/|SBOT_|--tab|cdp|CDP/
  for (const state of ['open', 'claimed', 'ended', 'expired']) {
    const c = buildTakeoverCard({ url: 'https://x/browser#k=1', pageTitle: '登录', imgKey: 'k', state })
    const text = JSON.stringify(c).replace(/https:\/\/x\/browser#k=1/g, '')
    assert.equal(bad.test(text), false, `${state} 态文案含工具名:` + (text.match(bad) || [])[0])
  }
  assert.ok(bad.test('跑 sbot browser link --tab'), '对照组')
  // redact 钩子对标题生效(标题来自页面,可能带用户名之类)
  const r = buildTakeoverCard({ pageTitle: 'hello SECRET', redact: (s) => s.replace('SECRET', '***') })
  assert.match(r.body.elements[0].content, /hello \*\*\*/)
})
