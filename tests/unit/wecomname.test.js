// 企微机器人名从群消息的 @ 里学(src/platform/wecomname.js):提及解析 · 一批历史里被 @ 最多的就是它 · 两套混排字段名都认。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mentionsOf, guessBotName, textsOf } = require('../../src/platform/wecomname')

test('wecomname: mentionsOf —— 名字到空白 / 标点为止;连着 @ 两个人各算各的;没有 @ 给空', () => {
  assert.deepEqual(mentionsOf('@SintBot 现在几点'), ['SintBot'])
  assert.deepEqual(mentionsOf('@SintBot\u200b 现在几点\ufeff'), ['SintBot']) // 零宽不在 \s 里,不剥就会学成「SintBot​」
  assert.deepEqual(mentionsOf('@张三 @SintBot 看看这个,@李四也看看'), ['张三', 'SintBot', '李四也看看'])
  assert.deepEqual(mentionsOf('@SintBot,帮我查一下'), ['SintBot']); assert.deepEqual(mentionsOf('邮箱 a@b.com'), ['b.com'], '邮箱会误当提及 —— 统计时靠「最多」压掉')
  assert.deepEqual(mentionsOf(''), []); assert.deepEqual(mentionsOf(null), [])
})

test('wecomname: guessBotName —— 被 @ 最多的名字;同条消息里同名只算一次;混排两套字段名都认;一条 @ 都没有 ⇒ null', () => {
  const msgs = [
    { msg_type: 'text', text: { content: '@SintBot 现在几点' } },
    { msg_type: 'text', text: { content: '@张三 @SintBot 看看' } },
    { msg_type: 'mixed', mixed: { items: [{ msg_type: 'image', image: { media_id: 'x' } }, { msg_type: 'text', text: { content: '@SintBot @SintBot 这是什么' } }] } },
    { msg_type: 'mixed', mixed: { msg_item: [{ msg_type: 'text', text: { content: '@张三 吃饭' } }] } },
    { msg_type: 'text', text: { content: '没有提及的闲聊' } },
    { msg_type: 'image', image: { media_id: 'y' } },
  ]
  assert.deepEqual(guessBotName(msgs), { name: 'SintBot', count: 3, total: 4 })
  assert.deepEqual(guessBotName([{ msg_type: 'text', text: { content: '闲聊' } }]), { name: null, count: 0, total: 0 })
  assert.deepEqual(guessBotName([]), { name: null, count: 0, total: 0 })
  assert.deepEqual(textsOf({ msg_type: 'voice', voice: { content: 'x' } }), [], '语音转写不算文字片段(里面不会有 @)')
})
