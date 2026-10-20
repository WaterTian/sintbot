// Outbound redaction — the last line of defense before a reply reaches a group.
// Locks in the JSON quote-wrapped keys fix plus every pattern + the
// "conservative, don't over-redact" boundaries.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { redact, PATTERNS } = require('../../src/core/redact')

test('redact: non-string / empty pass through untouched', () => {
  assert.equal(redact(''), '')
  assert.equal(redact(null), null)
  assert.equal(redact(undefined), undefined)
  assert.equal(redact(42), 42)
})

test('redact: bare key=value / key: value forms', () => {
  assert.equal(redact('password=hunter2hunter'), 'password=‹redacted›')
  assert.equal(redact('secret: myverylongsecret'), 'secret: ‹redacted›')
  assert.equal(redact('api_key = abcdef123456'), 'api_key = ‹redacted›')
})

test('redact: JSON quote-wrapped keys are redacted', () => {
  assert.equal(redact('{"password":"hunter2hunter"}'), '{"password":"‹redacted›"}')
  assert.equal(redact('{"app_secret":"verylongsecretvalue"}'), '{"app_secret":"‹redacted›"}')
  assert.equal(redact('"api_key": "longvalue12345"'), '"api_key": "‹redacted›"')
  // a JWT-shaped value is caught (by JWT rule or key=value) — either way redacted
  assert.match(redact('{"token":"eyJabc.eyJdef.eyJghi"}'), /‹redacted/)
})

test('redact: does NOT over-redact short values or plain prose', () => {
  assert.equal(redact('the token is short'), 'the token is short')
  assert.equal(redact('password=short'), 'password=short') // value < 6 chars
  assert.equal(redact('please reset your password today'), 'please reset your password today')
})

test('redact: Bearer / JWT / sk- / slack shapes', () => {
  assert.equal(redact('Authorization: Bearer abcdef1234567890'), 'Authorization: Bearer ‹redacted›')
  assert.match(redact('token eyJabcdefgh.eyJijklmnop.signature123'), /‹redacted:jwt›/)
  assert.match(redact('key sk-abcdefghijklmnop1234'), /‹redacted:key›/)
  assert.match(redact('xoxb-1234567890-abcdefghij'), /‹redacted:slack›/)
})

test('redact: feishu ids + email + china mobile', () => {
  assert.match(redact('app cli_a1b2c3d4e5f6g7h8'), /‹redacted:app_id›/)
  assert.match(redact('user ou_abcdefghij1234567890zz'), /‹redacted:open_id›/)
  assert.match(redact('mail me at foo.bar@example.com'), /‹redacted:email›/)
  assert.match(redact('call 13912345678 now'), /‹redacted:phone›/)
})

// 2026-09-08 真机:`sbot feishu send-msg` 的 @ 全是哑弹 —— open_id 规则把 `<at user_id="ou_…">` 里的
// id 也遮了,飞书收到空 id、mentions 为 null。标签内放行、标签外照遮。
test('redact: @ 标签里的 open_id 原样保留,标签外的裸 open_id 仍被遮', () => {
  const OID = 'ou_abcdefghij1234567890zz'
  // 文本消息形态(双引号 / 单引号)与卡片 markdown 形态(不带引号)
  assert.equal(redact(`<at user_id="${OID}">王五</at>`), `<at user_id="${OID}">王五</at>`)
  assert.equal(redact(`<at user_id='${OID}'>王五</at>`), `<at user_id='${OID}'>王五</at>`)
  assert.equal(redact(`<at id=${OID}></at>`), `<at id=${OID}></at>`)
  assert.equal(redact(`<at id="${OID}"></at>`), `<at id="${OID}"></at>`)
  // 同一串里:标签内放行,标签外的裸 id 仍遮成占位符
  const BARE = 'ou_zzzzzzzzzz1234567890aa'
  const out = redact(`<at user_id="${OID}">王五</at> 看下,另外 ${BARE} 是谁`)
  assert.match(out, new RegExp(`<at user_id="${OID}">王五</at>`))
  assert.doesNotMatch(out, new RegExp(BARE))
  assert.match(out, /‹redacted:open_id›/)
  // 属性名要整段对上:open_id= / JSON 的 "user_id": 都不是 @ 标签,照遮
  assert.match(redact(`open_id=${OID}`), /‹redacted:open_id›/)
  assert.match(redact(`{"user_id":"${OID}"}`), /‹redacted:open_id›/)
  // pii:false 下行为相同(open_id 不是 'pii' 类,没有开关)
  assert.equal(redact(`<at user_id="${OID}">王五</at>`, { pii: false }), `<at user_id="${OID}">王五</at>`)
  assert.equal(redact(`<at id=${OID}></at>`, { pii: false }), `<at id=${OID}></at>`)
  assert.match(redact(`裸 ${BARE}`, { pii: false }), /‹redacted:open_id›/)
})

test('redact: AWS / GitHub / PEM private key shapes (v0.6 增补)', () => {
  assert.match(redact('creds AKIAIOSFODNN7EXAMPLE here'), /‹redacted:aws›/)
  assert.match(redact('token ghp_abcdefghijklmnopqrst123456'), /‹redacted:github›/)
  assert.match(redact('token gho_abcdefghijklmnopqrst123456'), /‹redacted:github›/)
  assert.match(redact('pat github_pat_11ABCDEFG0abcdefghijklmnop'), /‹redacted:github›/)
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...base64...\n-----END RSA PRIVATE KEY-----'
  assert.equal(redact(pem), '‹redacted:private-key›')
  assert.equal(redact('AKIA is a prefix'), 'AKIA is a prefix') // no over-redaction
})

test('redact: PATTERNS export is [regex, replacement] pairs', () => {
  assert.ok(Array.isArray(PATTERNS) && PATTERNS.length > 0)
  for (const [re, rep] of PATTERNS) {
    assert.ok(re instanceof RegExp)
    assert.equal(typeof rep, 'string')
  }
})

// ── 数据明文按群(v0.11.6):pii:false 只放行手机号/邮箱,密钥类恒遮盖 ──

test('redact: pii:false 放行手机号/邮箱,密钥仍全遮', () => {
  const s = '联系 13812345678 或 a@b.com,key=sk-abcdefghijklmnopqrst Bearer abcdefghijklmnop'
  const out = redact(s, { pii: false })
  assert.match(out, /13812345678/)
  assert.match(out, /a@b\.com/)
  assert.doesNotMatch(out, /sk-abcdefghijklmnopqrst/)
  assert.doesNotMatch(out, /Bearer abcdefghijklmnop/)
})

test('redact: 缺省与 pii:true 行为一致(fail-closed,全遮)', () => {
  const s = '手机 13812345678'
  assert.equal(redact(s), redact(s, { pii: true }))
  assert.match(redact(s), /‹redacted:phone›/)
})

test('redact: pii:false 下 AWS/GitHub/PEM/password 仍遮(密钥类无开关)', () => {
  const s = 'AKIAIOSFODNN7EXAMPLE ghp_abcdefghijklmnopqrst1234 password=supersecret99'
  const out = redact(s, { pii: false })
  assert.doesNotMatch(out, /AKIAIOSFODNN7EXAMPLE/)
  assert.doesNotMatch(out, /ghp_abcdefghijklmnopqrst1234/)
  assert.doesNotMatch(out, /supersecret99/)
})

// 2026-09-07:邮箱正则本地部分无上界 ⇒ 对没有 @ 的长串是二次的(128KB 实测 8 秒),而 finalizeTurn 对全量
// 回复的那次 redact 没设防 —— daemon 与控制台同进程,卡住就是全群停摆。加上界后要线性。
test('redact: 256KB 没有邮箱的长串要在一秒内跑完(此前 128KB 就要 8 秒),且末尾的邮箱照样被遮', () => {
  const s = 'x'.repeat(256 * 1024) + ' contact: someone@example.com'
  const t0 = Date.now()
  const out = redact(s)
  const ms = Date.now() - t0
  assert.ok(ms < 1000, `耗时 ${ms}ms —— 邮箱正则又变回二次的了`)
  assert.doesNotMatch(out, /someone@example\.com/) // 对照组:确实跑了脱敏,不是跳过了
  // 本地部分超过 64 位的邮箱:靠后的 64 位 + 域名仍被遮,不会整条漏出去
  const long = redact('a'.repeat(90) + '@example.com 完')
  assert.doesNotMatch(long, /@example\.com/)
  assert.match(long, /‹redacted:email›/)
})

// 2026-10-09:按值遮盖。形状模式认不出的凭据(UUID 形的火山 key、32 位裸十六进制的飞书 appSecret)
// 此前原样出站 —— 而 sbot 自己就拿着这些值,没理由靠猜形状。
test('redact: 登记过的凭据值按原文替换(UUID / 裸十六进制这类形状模式认不出的)', () => {
  const { setKnownSecrets } = require('../../src/core/redact')
  const uuidKey = '3f1c2b7a-9d4e-4c8b-a1f0-5e6d7c8b9a01'
  const hexSecret = 'a9f3c1e5b7d2048f6e1c3a5b7d9f0e2c'
  try {
    // 对照组:登记前原样出站(这正是要修的洞)
    assert.match(redact(`ARK key is ${uuidKey}`), new RegExp(uuidKey))
    assert.equal(setKnownSecrets([uuidKey, hexSecret, 'short', 42, null]), 2) // 短的 / 非字符串不登记
    const out = redact(`ARK key is ${uuidKey}; secret ${hexSecret} and again ${uuidKey}`)
    assert.doesNotMatch(out, new RegExp(uuidKey))
    assert.doesNotMatch(out, /a9f3c1e5b7d2048f/)
    assert.equal((out.match(/‹redacted:secret›/g) || []).length, 3) // 多次出现每处都替
    // 短值不登记 ⇒ 正文里的 "short" 不被误伤
    assert.equal(redact('a short word'), 'a short word')
    // 没登记的值仍走形状模式、保留原标签
    assert.match(redact('key sk-abcdefghijklmnop1234'), /‹redacted:key›/)
    // pii:false 也不放过凭据值(密钥类无开关)
    assert.doesNotMatch(redact(`x ${hexSecret}`, { pii: false }), /a9f3c1e5b7d2048f/)
    // 按值必须先于形状:值里嵌着 11 位数字 / Bearer 遇 + 停下,若形状先跑会留残片 `x-‹redacted:phone›-abcdefghij`
    setKnownSecrets(['x-13812345678-abcdefghij', 'Bearer abcdefgh+ijklmnop/qrstuv'])
    assert.equal(redact('v=x-13812345678-abcdefghij.'), 'v=‹redacted:secret›.')
    assert.equal(redact('auth Bearer abcdefgh+ijklmnop/qrstuv end'), 'auth ‹redacted:secret› end')
    // 值里带正则元字符也当字面量处理
    setKnownSecrets(['abc.def+ghi(jkl)mno*pqr'])
    assert.equal(redact('token abc.def+ghi(jkl)mno*pqr end'), 'token ‹redacted:secret› end')
    assert.equal(redact('abcXdefXghiXjklXmnoXpqr'), 'abcXdefXghiXjklXmnoXpqr') // 不是正则:. 不匹配任意字符
  } finally {
    setKnownSecrets([]) // 清掉,别影响同文件其它用例
  }
  assert.match(redact(`ARK key is ${uuidKey}`), new RegExp(uuidKey)) // 清空后不再替
})
