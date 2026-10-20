// 控制台两处小判据(2026-09-07 通读逮到):
//   ① 配置读不出来时「配了密码吗」怎么判 —— 对外绑定必须 fail-closed,否则坏配置 = 局域网免密;
//   ② 首次绑定群发进群的那句不许带机器绝对路径(用户面零机器路径)。
const test = require('node:test')
const assert = require('node:assert/strict')
const { authConfiguredFrom, bindNoticeText } = require('../../src/ui/server')

test('authConfiguredFrom: 读得到就按有没有 auth 判', () => {
  assert.equal(authConfiguredFrom(() => 'scrypt$x$y', true), true)
  assert.equal(authConfiguredFrom(() => 'scrypt$x$y', false), true)
  assert.equal(authConfiguredFrom(() => undefined, true), false)
  assert.equal(authConfiguredFrom(() => undefined, false), false)
})

test('authConfiguredFrom: 配置读坏时 —— 环回退「没配」(本机能进去修),对外退「配了」(fail-closed)', () => {
  const boom = () => { throw new Error('配置文件损坏') }
  assert.equal(authConfiguredFrom(boom, true), false, '只绑环回:退成没配,本机浏览器仍免密进去修')
  assert.equal(authConfiguredFrom(boom, false), true, '对外绑定:退成配了,页面不再给 LAN 访客注入 token')
})

test('bindNoticeText: 只说项目目录名,不带机器绝对路径', () => {
  const t = bindNoticeText('/Users/someone/Projects/DemoApp')
  assert.match(t, /「DemoApp」/)
  assert.doesNotMatch(t, /\/Users\//)
  assert.doesNotMatch(t, /Projects/)
  assert.match(t, /\/help/) // 群内命令名保留,那是产品的一部分
  assert.match(bindNoticeText(''), /未命名/)
})
