'use strict'
// 「接管浏览器」的群内卡片(纯函数,可测)—— 代替 agent 自己写一句话 + 贴裸链接。
//
// 为什么要卡片:① 裸链接在群里只是一串字符,看不出「卡在哪个页面、为什么要人」;卡片带当前页面截图,一眼看懂;
// ② 文案由代码保证(零工具名 / 零路径),不再靠 agent 每次现编;③ 一张卡能改状态:有人点了「开始接管」就翻成
// 「正在接管中」,群里其他人不会再去点一张已经用掉的票。
// 四种状态:open(等人来)· claimed(有人在接管了)· ended(接管结束了:人点了「结束」或到时)· expired(过期没人来)。
// ⚠ ended 与 expired 分开:前者人来过、多半登录已经做完;后者没人来 —— 群里看到的下一步不一样。

// 飞书卡片 button 的字段名反直觉:样式是 type、文字是 text:{tag,content} 对象
function buildTakeoverCard({ url = '', pageTitle = '', pageUrl = '', imgKey = null, minutes = 10, state = 'open', redact = (s) => s } = {}) {
  const title = redact(String(pageTitle || '').trim()) || (pageUrl ? redact(hostOf(pageUrl)) : '一个页面')
  const elements = []
  if (state === 'open') {
    if (imgKey) elements.push({ tag: 'img', img_key: imgKey, scale_type: 'fit_horizontal', corner_radius: '8px', preview: true, alt: { tag: 'plain_text', content: `机器人卡住的页面:${title}` } })
    elements.push({ tag: 'markdown', content: `机器人卡在 **${title}**,这一步只有真人能做(登录 / 验证码 / 滑块 / 扫码)。\n点下面的按钮,直接操作它的浏览器(手机、电脑都行);做完回群里说一声,它接着干。` })
    elements.push({ tag: 'button', type: 'primary', width: 'fill', text: { tag: 'plain_text', content: '接管浏览器' }, behaviors: [{ type: 'open_url', default_url: url }] })
    // ⚠ 卡片 2.0 已不认 note 组件(2026-09-10 真机:「unsupported tag note」建卡被拒)—— 小字用 markdown 的 notation 字号 + 灰字
    elements.push({ tag: 'markdown', text_size: 'notation', content: `<font color='grey'>${minutes} 分钟内有效 · 只能打开一次 · 只对应这一个页面</font>` })
    return { schema: '2.0', config: { width_mode: 'default' }, header: { title: { tag: 'plain_text', content: '需要你帮它一把' }, subtitle: { tag: 'plain_text', content: '登录 / 验证码 / 滑块 / 扫码' }, template: 'orange' }, body: { padding: '16px', vertical_spacing: '12px', elements } }
  }
  if (state === 'claimed') {
    elements.push({ tag: 'markdown', content: `**${title}** —— 已有人接管,正在操作中。\n做完回群里说一声就行;这条链接已经用掉,别人点不开了。` })
    return { schema: '2.0', config: { width_mode: 'default' }, header: { title: { tag: 'plain_text', content: '正在接管中' }, template: 'blue' }, body: { padding: '16px', vertical_spacing: '12px', elements } }
  }
  if (state === 'ended') {
    elements.push({ tag: 'markdown', content: `**${title}** —— 接管已结束,这条链接已作废。\n登录 / 验证做完了就在群里说一声,机器人接着干;没做完就让它再发一条。` })
    return { schema: '2.0', config: { width_mode: 'default' }, header: { title: { tag: 'plain_text', content: '接管已结束' }, template: 'green' }, body: { padding: '16px', vertical_spacing: '12px', elements } }
  }
  // expired
  elements.push({ tag: 'markdown', content: `**${title}** —— 这条接管链接已过期,没人来得及用。\n还需要的话让机器人重新发一条。` })
  return { schema: '2.0', config: { width_mode: 'default' }, header: { title: { tag: 'plain_text', content: '接管链接已过期' }, template: 'grey' }, body: { padding: '16px', vertical_spacing: '12px', elements } }
}

function hostOf(u) { try { return new URL(u).hostname } catch { return String(u || '').slice(0, 60) } }

module.exports = { buildTakeoverCard, hostOf }
