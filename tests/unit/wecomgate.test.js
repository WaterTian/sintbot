// 便宜模型门控(src/platform/wecomgate.js):提示词只给去身份文字 · 回答只认 YES/NO(是/否)· 不值一问的不问 ·
// 每群每分钟限速 · 问不通 / 看不懂一律当 NO(宁漏不误)。全注入零网络。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createGatekeeper, buildGatePrompt, parseVerdict, trivial } = require('../../src/platform/wecomgate')

test('wecomgate: 提示词 —— system 定规则只要 YES/NO;user 带最近几句(旧→新,最多 8)与候选句;长文截断;不含 userid / 路径', () => {
  const recent = Array.from({ length: 12 }, (_, i) => ({ sender: `甲${i}`, text: `第 ${i} 句` }))
  const { system, user } = buildGatePrompt({ botName: 'SintBot', recent, candidate: { sender: '乙', text: 'x'.repeat(600) } })
  assert.match(system, /「SintBot」/); assert.match(system, /只输出 YES 或 NO/); assert.match(system, /「\[附图片\]」.*回答 YES/, '带附件在问「这是什么」要判 YES')
  assert.ok(!user.includes('第 3 句') && user.includes('第 4 句') && user.includes('第 11 句'), '只留最近 8 句')
  assert.ok(user.indexOf('第 4 句') < user.indexOf('第 11 句'), '旧→新')
  assert.match(user, /候选消息 —— 乙:「x{399}…」/, '正文截到 400 字')
  const empty = buildGatePrompt({ candidate: { text: 'hi' } })
  assert.match(empty.user, /最近没有别的消息/); assert.match(empty.system, /「机器人」/, '没名字就叫机器人')
})

test('wecomgate: 回答解析只认开头;不值一问的判定', () => {
  for (const [s, v] of [['YES', true], ['yes.', true], ['"Yes"', true], ['是', true], ['要,因为…', true], ['NO', false], ['No', false], ['否', false], ['不要', false], ['大概吧', null], ['', null], ['YESTERDAY', null]]) assert.equal(parseVerdict(s), v, s)
  for (const [s, v] of [['好', true], ['', true], ['😂😂', true], ['...', true], ['https://x.y/z', true], ['好的', false], ['看看这个', false], ['ok', false]]) assert.equal(trivial(s), v, JSON.stringify(s))
})

test('wecomgate: 问一次按 YES/NO 放行;不值一问不问;限速每群每分钟 N 次;问不通 / 看不懂当 NO 且日志只记前 3 次', async () => {
  let t = 1_000_000; const asks = []; const logs = []
  let answer = 'YES'
  const gate = createGatekeeper({ botName: 'SintBot', maxPerMin: 2, now: () => t, log: (l) => logs.push(l), ask: async (q) => { asks.push(q); if (answer instanceof Error) throw answer; return answer } })
  assert.equal(await gate('wrG', { text: '那个报表再发一份', sender: '甲', recent: [{ sender: '乙', text: '早' }] }), true)
  assert.match(asks[0].user, /乙:早/); assert.match(asks[0].user, /甲:「那个报表再发一份」/)
  assert.ok(logs.some((l) => /门控 YES\(…wrG\):那个报表再发一份/.test(l)), '每次判定记一行')
  answer = 'NO'
  assert.equal(await gate('wrG', { text: '今天吃啥', sender: '甲' }), false)
  assert.equal(asks.length, 2)
  // 第 3 条:限速(一分钟 2 次)⇒ 不问、当 NO;另一个群不受影响;一分钟后放开
  assert.equal(await gate('wrG', { text: '帮我查一下', sender: '甲' }), false); assert.equal(asks.length, 2); assert.ok(logs.some((l) => /限速/.test(l)))
  answer = 'YES'; assert.equal(await gate('wrH', { text: '帮我查一下', sender: '甲' }), true); assert.equal(asks.length, 3)
  t += 61_000; assert.equal(await gate('wrG', { text: '帮我查一下', sender: '甲' }), true); assert.equal(asks.length, 4)
  // 不值一问
  assert.equal(await gate('wrH', { text: '好', sender: '甲' }), false); assert.equal(asks.length, 4)
  // 问不通 ⇒ NO;连续失败日志只记 3 次
  answer = new Error('HTTP 500'); t += 61_000
  for (let i = 0; i < 2; i++) assert.equal(await gate('wrH', { text: '帮我查一下' + i, sender: '甲' }), false)
  t += 61_000; for (let i = 0; i < 2; i++) await gate('wrH', { text: '再查一下' + i, sender: '甲' })
  assert.equal(logs.filter((l) => /问不通/.test(l)).length, 3)
  // 看不懂 ⇒ NO
  answer = '这个嘛…'; t += 61_000; assert.equal(await gate('wrH', { text: '帮我查一下', sender: '甲' }), false); assert.ok(logs.some((l) => /看不懂/.test(l)))
  const s = gate.stats(); assert.deepEqual(s, { asked: 9, yes: 3, no: 1, failed: 5, skipped: 1, throttled: 1 }, '4 次抛 + 1 次看不懂 = failed 5;限速与不值一问的不算 asked')
  assert.throws(() => createGatekeeper({}), /ask required/)
})

test('wecomgate: botName 给函数时提示词现读', async () => {
  let name = 'A'; const asks = []
  const gate = createGatekeeper({ botName: () => name, ask: async (q) => { asks.push(q.system); return 'NO' } })
  await gate('wrG', { text: '帮我看看', sender: '甲' }); name = 'B'; await gate('wrG', { text: '帮我看看2', sender: '甲' })
  assert.match(asks[0], /「A」/); assert.match(asks[1], /「B」/)
})
