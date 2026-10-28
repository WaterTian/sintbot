// Config loading — defaults, env:VAR secret resolution, per-project perms,
// proxy-split derivation. Each test file runs in its own process, so mutating
// process.env here is isolated.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { loadConfig, DEFAULTS, applyProxyEnv, deriveNoProxy } = require('../../src/config')

function writeCfg(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-cfg-'))
  const file = path.join(dir, 'sbot.config.json')
  fs.writeFileSync(file, JSON.stringify(obj))
  return file
}

test('config: built-in defaults when no file is found anywhere', () => {
  // findConfigPath falls back to ./sbot.config.json and ~/.sbot/config.json, so to
  // hit the "no file" path we run from an empty cwd with HOME/USERPROFILE redirected.
  const prev = { cwd: process.cwd(), HOME: process.env.HOME, UP: process.env.USERPROFILE, SC: process.env.SBOT_CONFIG }
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-empty-'))
  try {
    process.chdir(empty)
    process.env.HOME = empty
    process.env.USERPROFILE = empty
    delete process.env.SBOT_CONFIG
    const cfg = loadConfig()
    assert.equal(cfg._path, null)
    assert.equal(cfg.defaultProvider, 'claude')
    assert.equal(cfg.agent.permissionMode, DEFAULTS.agent.permissionMode)
  } finally {
    process.chdir(prev.cwd)
    prev.HOME === undefined ? delete process.env.HOME : (process.env.HOME = prev.HOME)
    prev.UP === undefined ? delete process.env.USERPROFILE : (process.env.USERPROFILE = prev.UP)
    if (prev.SC !== undefined) process.env.SBOT_CONFIG = prev.SC
  }
})

test('config: timezone defaults to Beijing, keeps a valid override, falls back on garbage', () => {
  assert.equal(loadConfig(writeCfg({})).timezone, 'Asia/Shanghai')
  assert.equal(loadConfig(writeCfg({ timezone: 'Asia/Tokyo' })).timezone, 'Asia/Tokyo')
  assert.equal(loadConfig(writeCfg({ timezone: 'Beijing/Time' })).timezone, 'Asia/Shanghai') // 写错不漂到主机时区
})

// loadConfig 是白名单式的 ⇒ 顶层键漏写就静默失效(文件里有、doctor 不报、消费点走兜底)。
// instance 与 design 就这么潜伏着:配了等于没配,而三处都不出声。这条用例把「写进去读得出」
// 钉死 —— 新增顶层配置项时在这里补一行,比事后真机排查便宜得多。
test('config: slack 段必须透传,且 env: 密钥要解析(与 feishu 平级)', () => {
  // 同上:白名单式装配漏写 = 配了等于没配,而三处都不出声。
  assert.equal(loadConfig(writeCfg({})).slack, undefined, '没配时不该凭空造出键')
  process.env.SBOT_TEST_XOXB = 'xoxb-real-token'
  const cfg = loadConfig(writeCfg({
    slack: { botToken: 'env:SBOT_TEST_XOXB', appToken: 'xapp-1-plain', botUserId: 'U0TESTBOT01', onlyWhenMentioned: true },
  }))
  assert.equal(cfg.slack.botToken, 'xoxb-real-token', 'env: 引用要解析成真值')
  assert.equal(cfg.slack.appToken, 'xapp-1-plain', '明文照原样')
  assert.equal(cfg.slack.botUserId, 'U0TESTBOT01')
  assert.equal(cfg.slack.onlyWhenMentioned, true)
})

// Slack 进三平台归一(飞书 / 企微 / Slack):写了认,没写按 id 形态推断(Slack 形态要配了 Slack 才作数),再按「只配了一个平台」兜底。
test('config: Slack 进群级 platform 归一 —— 写了认;Slack 形态的 id 只在配了 Slack 时才推断成 slack', () => {
  const { platformsConfigured, inferChatPlatform, chatPlatform } = require('../../src/config')
  const fe = { appId: 'cli_x', appSecret: 's' }
  const sl = { botToken: 'xoxb-1', appToken: 'xapp-1' }
  assert.equal(inferChatPlatform('C0TESTCHAN1'), 'slack'); assert.equal(inferChatPlatform('D0123ABCD9'), 'slack'); assert.equal(inferChatPlatform('c0testchan1'), null, 'Slack id 全大写')
  const both = loadConfig(writeCfg({ feishu: fe, slack: sl, groups: { C0TESTCHAN1: { workdir: '/tmp/a' }, oc_x: { workdir: '/tmp/b' }, CNAMED: { workdir: '/tmp/c', platform: 'slack' } } }))
  assert.deepEqual(platformsConfigured(both), { feishu: true, wecom: false, slack: true })
  assert.equal(both.groups.C0TESTCHAN1.platform, 'slack', '配了 Slack:按形态推断')
  assert.equal(both.groups.oc_x.platform, 'feishu'); assert.equal(both.groups.CNAMED.platform, 'slack', '写了就认')
  assert.equal(chatPlatform(both, 'C0ZZZZZZZZ9'), 'slack', '未绑定的 Slack 频道按形态')
  // 企微单聊 userid 撞 Slack 形态:没配 Slack 时形态不作数,按「只配了一个平台」兜底
  const we = loadConfig(writeCfg({ wecom: { botId: 'aibX', secret: 's' }, groups: { DAVID12345: { workdir: '/z' } } }))
  assert.equal(we.groups.DAVID12345.platform, 'wecom'); assert.equal(chatPlatform(we, 'DAVID12345'), 'wecom')
  // 三个平台里配了两个且认不出 ⇒ ambiguous(与飞书 + 企微同一条规则)
  const amb = loadConfig(writeCfg({ feishu: fe, slack: sl, groups: { WangWu: { workdir: '/z' } } }))
  assert.equal(amb.groups.WangWu.platform, undefined); assert.deepEqual(amb._groupPlatform.ambiguous, ['WangWu'])
  // 只配 Slack:全归 Slack
  const only = loadConfig(writeCfg({ slack: sl, groups: { WangWu: { workdir: '/z' } } }))
  assert.equal(only.groups.WangWu.platform, 'slack'); assert.equal(chatPlatform(only, 'whoever'), 'slack')
})

test('config: 顶层 instance / design / browser 必须透传(白名单漏写 = 静默失效)', () => {
  // 没配时不该凭空造出键 —— 消费方靠 `cfg.instance || 兜底` 分辨「没配」
  const bare = loadConfig(writeCfg({}))
  assert.equal(bare.instance, undefined)
  assert.equal(bare.design, undefined)

  assert.equal(bare.browser, undefined)
  assert.equal(bare.alerts, undefined)
  const cfg = loadConfig(writeCfg({ instance: 'mac-b', design: { iconsDir: '/opt/icons' }, browser: { cdpUrl: 'http://127.0.0.1:9333', takeoverMinutes: 5 }, alerts: { chatId: 'oc_alerts' } }))
  assert.equal(cfg.instance, 'mac-b')
  assert.equal(cfg.design.iconsDir, '/opt/icons')
  assert.equal(cfg.browser.cdpUrl, 'http://127.0.0.1:9333'); assert.equal(cfg.browser.takeoverMinutes, 5)
  assert.equal(cfg.alerts.chatId, 'oc_alerts') // 运维告警群(src/core/opsalert.js)

  // 数字写法也认(写数字不加引号是很自然的手误)
  assert.equal(loadConfig(writeCfg({ instance: 42 })).instance, '42')
})

test('config: agent.autocompactTokens 默认 40 万,可覆盖、可置 0 关闭(长会话自动压缩)', () => {
  assert.equal(loadConfig(writeCfg({})).agent.autocompactTokens, 400_000)
  assert.equal(loadConfig(writeCfg({ agent: { autocompactTokens: 200_000 } })).agent.autocompactTokens, 200_000)
  assert.equal(loadConfig(writeCfg({ agent: { autocompactTokens: 0 } })).agent.autocompactTokens, 0)
})

test('config: agent.ackDelayMs 默认 25 秒,可覆盖、可置 0 关闭(回执等待)', () => {
  assert.equal(loadConfig(writeCfg({})).agent.ackDelayMs, 25_000)
  assert.equal(loadConfig(writeCfg({ agent: { ackDelayMs: 10_000 } })).agent.ackDelayMs, 10_000)
  assert.equal(loadConfig(writeCfg({ agent: { ackDelayMs: 0 } })).agent.ackDelayMs, 0)
})

test('config: agent block carries NO global allow/deny (per-project perms)', () => {
  const cfg = loadConfig(writeCfg({})) // explicit empty config ⇒ pure DEFAULTS.agent merge
  assert.equal(cfg.agent.allowedTools, undefined)
  assert.equal(cfg.agent.disallowedTools, undefined)
})

test('config: per-group allow/deny are preserved verbatim', () => {
  const file = writeCfg({ groups: { g1: { workdir: '/p', allowedTools: ['Read', 'Edit'], disallowedTools: ['Bash(rm *)'] } } })
  const cfg = loadConfig(file)
  assert.deepEqual(cfg.groups.g1.allowedTools, ['Read', 'Edit'])
  assert.deepEqual(cfg.groups.g1.disallowedTools, ['Bash(rm *)'])
})

test('config: env:VAR resolves a provider apiKey from the environment', () => {
  process.env.__SBOT_TEST_KEY = 'secret-value-xyz'
  const file = writeCfg({ providers: { glm: { baseUrl: 'https://x', apiKey: 'env:__SBOT_TEST_KEY' } } })
  const cfg = loadConfig(file)
  assert.equal(cfg.providers.glm.apiKey, 'secret-value-xyz')
  delete process.env.__SBOT_TEST_KEY
})

test('config: env:VAR that is unset resolves to empty string', () => {
  const file = writeCfg({ providers: { glm: { baseUrl: 'https://x', apiKey: 'env:__SBOT_MISSING_' + Date.now() } } })
  const cfg = loadConfig(file)
  assert.equal(cfg.providers.glm.apiKey, '')
})

test('config: invalid JSON throws with the file path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbot-cfg-'))
  const file = path.join(dir, 'sbot.config.json')
  fs.writeFileSync(file, '{bad json')
  assert.throws(() => loadConfig(file), /failed to parse config/)
})

test('deriveNoProxy: includes provider host + 2-level wildcard + localhost', () => {
  const np = deriveNoProxy({ glm: { baseUrl: 'https://open.bigmodel.cn/api/anthropic' }, claude: {} })
  assert.match(np, /open\.bigmodel\.cn/)
  assert.match(np, /\*\.bigmodel\.cn/)
  assert.match(np, /localhost/)
})

test('applyProxyEnv: sets proxy env vars (https falls back to http)', () => {
  for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy']) delete process.env[k]
  applyProxyEnv({ proxy: { http: 'http://127.0.0.1:7890', noProxy: 'localhost,127.0.0.1' } })
  assert.equal(process.env.HTTP_PROXY, 'http://127.0.0.1:7890')
  assert.equal(process.env.HTTPS_PROXY, 'http://127.0.0.1:7890') // https ?? http
  assert.equal(process.env.NO_PROXY, 'localhost,127.0.0.1')
})

test('applyProxyEnv: no proxy block ⇒ no-op', () => {
  for (const k of ['HTTP_PROXY', 'http_proxy']) delete process.env[k]
  applyProxyEnv({})
  assert.equal(process.env.HTTP_PROXY, undefined)
})

// 项目根目录围栏的配置入口(src/projectsroot.js):顶层 projectsRoots。loadConfig 就地解析成绝对路径数组,
// 没配给平台默认;「等于没围」的值被丢并记进 _projectsRoots.dropped(doctor 报)。同样是白名单透传,漏了就静默失效。
test('config: 顶层 projectsRoots 透传并解析 —— 默认 / ~ 展开 / 字符串写法 / 等于没围的值被丢且有记录', () => {
  const { defaultProjectsRoot } = require('../../src/projectsroot')
  const os = require('node:os')
  const bare = loadConfig(writeCfg({}))
  assert.deepEqual(bare.projectsRoots, [defaultProjectsRoot()])
  assert.equal(bare._projectsRoots.fromConfig, false)
  assert.deepEqual(bare._projectsRoots.dropped, [])

  const cfg = loadConfig(writeCfg({ projectsRoots: ['~/Work', '/Volumes/A/Projects'] }))
  assert.deepEqual(cfg.projectsRoots, [path.join(os.homedir(), 'Work'), '/Volumes/A/Projects'])
  assert.equal(cfg._projectsRoots.fromConfig, true)

  assert.deepEqual(loadConfig(writeCfg({ projectsRoots: '~/Solo' })).projectsRoots, [path.join(os.homedir(), 'Solo')])

  // 等于没围的值:丢掉、记原因、剩下的照用;全丢 ⇒ 回默认(绝不退到家目录)
  const mixed = loadConfig(writeCfg({ projectsRoots: ['/', '~/Ok'] }))
  assert.deepEqual(mixed.projectsRoots, [path.join(os.homedir(), 'Ok')])
  assert.deepEqual(mixed._projectsRoots.dropped, [{ value: '/', why: '是文件系统根目录' }])
  const allBad = loadConfig(writeCfg({ projectsRoots: [os.homedir()] }))
  assert.deepEqual(allBad.projectsRoots, [defaultProjectsRoot()])
  assert.equal(allBad._projectsRoots.dropped[0].why, '是整个家目录')
})

// 2026-10-09:loadConfig 把凭据的值登记给出站脱敏(provider apiKey / env 里的 TOKEN|KEY|SECRET|PASSWORD / 飞书 appSecret)。
test('loadConfig 把配置里的凭据值登记进 redact(apiKey 的 env: 引用按解析后的值;短值与非凭据 env 不登记)', () => {
  const { redact, setKnownSecrets } = require('../../src/core/redact')
  const ark = '3f1c2b7a-9d4e-4c8b-a1f0-5e6d7c8b9a01'
  const sec = 'a9f3c1e5b7d2048f6e1c3a5b7d9f0e2c'
  const envTok = 'tok-in-env-block-0123456789abcdef'
  const fromEnv = 'key-from-process-env-0123456789'
  process.env.SBOT_TEST_KEY_X = fromEnv
  try {
    loadConfig(writeCfg({
      providers: {
        // ⚠ provider.env 块是原样透传给 spawn 的(claudecode.js Object.assign),里面不解析 env: ⇒ 登记的也是字面值
        volcano: { apiKey: ark, env: { ANTHROPIC_AUTH_TOKEN: envTok, CLAUDE_CODE_EFFORT_LEVEL: 'high-but-not-a-secret' } },
        deepseek: { apiKey: 'env:SBOT_TEST_KEY_X' }, // apiKey 走 resolveSecret ⇒ 登记解析后的值
        gpt: { apiKey: 'sk-local-dummy' },           // 14 字符:不登记
      },
      feishu: { appId: 'cli_abcdefghijkl', appSecret: sec },
    }))
    const out = redact(`a ${ark} b ${sec} c ${envTok} d high-but-not-a-secret e sk-local-dummy f ${fromEnv}`)
    assert.doesNotMatch(out, /3f1c2b7a/)
    assert.doesNotMatch(out, /a9f3c1e5/)
    assert.doesNotMatch(out, /tok-in-env-block/)
    assert.doesNotMatch(out, /key-from-process-env/)
    assert.match(out, /high-but-not-a-secret/) // 非凭据名的 env 值不动
    assert.match(out, /sk-local-dummy/)        // 短值不动
  } finally {
    delete process.env.SBOT_TEST_KEY_X
    setKnownSecrets([])
  }
})

// 企业微信平台块(src/platform/wecom.js):wecom.botId / secret 认 env:;secret 登记进按值脱敏名单 —— 与 feishu.appSecret
// 同一条纪律(白名单式装配,漏写 = 静默失效)。顶层 platform 字段已废弃(双平台并存):存在只记下来给 doctor 提一句,不再产出 cfg.platform。
test('config: wecom 透传,secret 认 env: 且进脱敏名单;顶层 platform 废弃只记不认', () => {
  const { redact } = require('../../src/core/redact')
  const bare = loadConfig(writeCfg({}))
  assert.equal(bare.platform, undefined); assert.equal(bare.wecom, undefined); assert.equal(bare._deprecatedPlatform, undefined)
  assert.equal(loadConfig(writeCfg({ platform: 'wecom' }))._deprecatedPlatform, 'wecom', '写了就记下来(doctor 报废弃),不改行为')
  process.env.SBOT_T_WECOM_SECRET = 'VRT2ziyQjK7G8t3Su90HEyEAETJsHCatEUoYDeWkGyc'
  try {
    const cfg = loadConfig(writeCfg({ wecom: { botId: 'aibXYZ', secret: 'env:SBOT_T_WECOM_SECRET', botName: 'SintBot', names: { WangWu: '王五' } } }))
    assert.equal(cfg.wecom.botId, 'aibXYZ'); assert.equal(cfg.wecom.secret, process.env.SBOT_T_WECOM_SECRET)
    assert.equal(cfg.wecom.botName, 'SintBot'); assert.deepEqual(cfg.wecom.names, { WangWu: '王五' })
    assert.equal(redact('日志里带 ' + process.env.SBOT_T_WECOM_SECRET + ' 这串'), '日志里带 ‹redacted:secret› 这串')
  } finally { delete process.env.SBOT_T_WECOM_SECRET; loadConfig(writeCfg({})) }
})

// 双平台并存:platformsConfigured 按凭据配齐判;群级 platform 归一 —— 写了认、没写按 id 形态推断(oc_ 飞书 / wr 企微)、
// 认不出形态按「只配了一个平台就是它」、两个都配且认不出 ⇒ 暂按飞书并记进 ambiguous(doctor warn)。推断只写内存态不写文件。
test('config: 群级 platform 归一与推断', () => {
  const { platformsConfigured, inferChatPlatform, chatPlatform } = require('../../src/config')
  assert.equal(inferChatPlatform('oc_abcdef123'), 'feishu'); assert.equal(inferChatPlatform('wrDemoGroupChat0000000000000001'), 'wecom')
  assert.equal(inferChatPlatform('WangWu'), null, '企微单聊 chatId = userid,没形态可认'); assert.equal(inferChatPlatform(''), null)
  const both = { feishu: { appId: 'cli_x', appSecret: 's' }, wecom: { botId: 'aibX', secret: 's' } }
  const cfg = loadConfig(writeCfg({ ...both, groups: { oc_1234567890: { workdir: '/x' }, wrABCDEFGH12345: { workdir: '/y' }, WangWu: { workdir: '/z' }, oc_explicit00: { workdir: '/w', platform: 'wecom' }, oc_bad000000: { workdir: '/v', platform: 'discord' } } }))
  assert.deepEqual(platformsConfigured(cfg), { feishu: true, wecom: true, slack: false })
  assert.equal(cfg.groups.oc_1234567890.platform, 'feishu'); assert.equal(cfg.groups.wrABCDEFGH12345.platform, 'wecom')
  assert.equal(cfg.groups.oc_explicit00.platform, 'wecom', '写了就认,不按形态改写')
  assert.equal(cfg.groups.WangWu.platform, undefined, '判不出就不写(路由器按最近入站的适配器回)'); assert.deepEqual(cfg._groupPlatform.ambiguous, ['WangWu'])
  assert.deepEqual(cfg._groupPlatform.invalid, ['oc_bad000000']); assert.equal(cfg.groups.oc_bad000000.platform, 'feishu')
  assert.ok(cfg._groupPlatform.inferred.includes('oc_1234567890') && cfg._groupPlatform.inferred.includes('wrABCDEFGH12345'))
  assert.equal(chatPlatform(cfg, 'oc_explicit00'), 'wecom'); assert.equal(chatPlatform(cfg, 'wrZZZZZZZZ999'), 'wecom', '未绑定的群按形态'); assert.equal(chatPlatform(cfg, 'nobody'), null, '两个都配且认不出 ⇒ null,路由器不发')
  // 只配企微:认不出形态的全归企微(单聊绑项目就是这种),不进 ambiguous
  const we = loadConfig(writeCfg({ wecom: both.wecom, groups: { WangWu: { workdir: '/z' } } }))
  assert.equal(we.groups.WangWu.platform, 'wecom'); assert.deepEqual(we._groupPlatform.ambiguous, []); assert.equal(chatPlatform(we, 'whoever'), 'wecom')
  // 现有两台(只配飞书)零改动:全部归飞书
  const fe = loadConfig(writeCfg({ feishu: both.feishu, groups: { oc_1234567890: { workdir: '/x' }, WangWu: { workdir: '/z' } } }))
  assert.equal(fe.groups.oc_1234567890.platform, 'feishu'); assert.equal(fe.groups.WangWu.platform, 'feishu'); assert.deepEqual(fe._groupPlatform.ambiguous, [])
  // 配置文件原文没被改
  const parsed = JSON.parse(fs.readFileSync(fe._path, 'utf8'))
  assert.equal(parsed.groups.oc_1234567890.platform, undefined); assert.equal(parsed.groups.oc_1234567890.workdir, '/x', '对照:确实读到了这份文件')
  loadConfig(writeCfg({}))
})

test('config: 顶层 brand 必须透传(同一条白名单陷阱,新键最容易再踩一次)', () => {
  // 没配时不造键 —— 消费方靠 `cfg.brand || DEFAULT_BRAND` 分辨「没配」与「配成了默认值」
  assert.equal(loadConfig(writeCfg({})).brand, undefined)
  assert.equal(loadConfig(writeCfg({ brand: 'SintBot' })).brand, 'SintBot')
  // 非字符串也要收成字符串(配置是人手写的)
  assert.equal(loadConfig(writeCfg({ brand: 123 })).brand, '123')
})

test('config: feishu.botOpenId 是示例占位(ou_xxxx…)⇒ 当作没填;真 open_id 原样保留', () => {
  assert.equal(loadConfig(writeCfg({ feishu: { appId: 'cli_a', appSecret: 's', botOpenId: 'ou_xxxxxxxxxxxxxxxx' } })).feishu.botOpenId, '')
  assert.equal(loadConfig(writeCfg({ feishu: { appId: 'cli_a', appSecret: 's', botOpenId: 'ou_0123abcd' } })).feishu.botOpenId, 'ou_0123abcd')
})

// 示例配置的 codex 预设不钉型号(与 claude 同一条规矩):钉死的型号会过时,有的型号 ChatGPT 账号登录直接拒
// (开源版验收实测:示例钉 gpt-5.5,新装后第一轮就报「model is not supported when using Codex with a ChatGPT account」)
test('示例配置:codex 预设不写 model,跟随 codex 自己的默认', () => {
  const ex = JSON.parse(fs.readFileSync(path.join(__dirname, '../../sbot.config.example.json'), 'utf8'))
  assert.equal(ex.providers.codex.runner, 'codex')
  assert.equal(ex.providers.codex.model, undefined)
  assert.equal(ex.providers.claude.model, undefined, 'claude 预设同样不钉')
})

test('config: 群 workdir 以 ~ 开头的在内存里展开(修 1.0.2 及以前向导原样存下的 ~/x),别的不动', () => {
  const file = writeCfg({ groups: { oc_a: { workdir: '~/Projects/a', provider: 'claude' }, oc_b: { workdir: '/srv/b' }, oc_c: { workdir: '~x' } } })
  const cfg = loadConfig(file)
  assert.equal(cfg.groups.oc_a.workdir, path.join(os.homedir(), 'Projects', 'a'))
  assert.equal(cfg.groups.oc_a.provider, 'claude')
  assert.equal(cfg.groups.oc_b.workdir, '/srv/b')
  assert.equal(cfg.groups.oc_c.workdir, '~x')
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).groups.oc_a.workdir, '~/Projects/a') // 文件不改
})

test('deriveNoProxy: IP hosts are listed as-is, never turned into a wildcard like *.0.1', () => {
  const np = deriveNoProxy({ local: { baseUrl: 'http://127.0.0.1:8317' }, lan: { baseUrl: 'http://203.0.113.5:9000/v1' }, v6: { baseUrl: 'http://[::1]:7000' } }).split(',')
  assert.ok(np.includes('203.0.113.5'))
  assert.ok(!np.some((h) => /^\*\.\d/.test(h)), np.join(','))
  assert.ok(!np.includes('[::1]'))
})
