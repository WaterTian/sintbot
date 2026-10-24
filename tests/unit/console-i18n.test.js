'use strict'
// 控制台英文界面的翻译层(src/ui/console.html 里的 I18N_EN / I18N_EN_RX + DOM 翻译)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'ui', 'console.html'), 'utf8')
const pairs = () => {
  const a = html.indexOf('\nconst I18N_EN=[')
  const b = html.indexOf('\n];\nconst I18N_EN_RX=[', a)
  return new Function('return [' + html.slice(html.indexOf('[', a) + 1, b) + ']')() // eslint-disable-line no-new-func
}

test('左上角的品牌字标不进翻译层', () => {
  assert.match(html, /<a class="word"[^>]*><span data-i18n-skip>Sint<i class="trace"[^>]*><\/i>Bot<\/span><\/a>/)
})

// 翻译层在英文界面下会把「没有中文、但恰好等于某条译文」的文字反查成中文原文(i18nZhOrig),切回中文时写回去。
// 所以任何一条译文都不许与页面里**本来就是英文**的整段文字相同,否则那段英文切回中文后会变成别的字
// (10-24:「机器人 → Bot」让左上角的「SintBot」切回中文后成了「Sint机器人」)。
test('没有一条译文与页面里本来就是英文的文字或提示完全相同(否则切回中文会被反查改掉)', () => {
  const cjk = /[一-鿿]/
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 标了 data-i18n-skip 的片段不进翻译层,也就不会被反查(品牌字标、语言按钮)
  const live = html.replace(/<span data-i18n-skip>[\s\S]*?<\/span>/g, '').replace(/<button[^>]*data-i18n-skip[\s\S]*?<\/button>/g, '')
  const hits = []
  for (const [zh, en] of pairs()) {
    if (!en || !en.trim() || cjk.test(en)) continue
    const re = new RegExp('>' + esc(en) + '<|(?:title|placeholder|aria-label)="' + esc(en) + '"')
    if (re.test(live)) hits.push(`${en}  ⇐  ${zh}`)
  }
  assert.deepEqual(hits, [])
})
