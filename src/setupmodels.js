// `sbot setup` 模型步的纯逻辑:各家在哪拿 key、国际站端点、默认走哪条路、试跑失败怎么说人话。
// 向导本身在 bin/sbot.js(交互、读写配置);这里只放可单测的部分。
//
// 推荐顺序(2026-10-19 定):有 Claude 订阅 → 用 Claude;有 ChatGPT(Codex)→ 用 Codex;都没有 → 推荐 DeepSeek。
// 地区只决定两件事:同一家用中国站还是国际站的端点,以及要不要代理。

// 用 API key 的预设(名字与 sbot.config.example.json 的 providers 键一致)。
// intl:有国际站的厂商,key 在哪个站开的就得连哪个站,填错站点会 401。
const PROVIDER_INFO = {
  deepseek: { label: 'DeepSeek', site: 'https://platform.deepseek.com', billing: '按量付费' },
  glm: { label: '智谱 GLM', site: 'https://open.bigmodel.cn', billing: '按量或包月 GLM Coding Plan', intl: { label: 'Z.ai', site: 'https://z.ai', baseUrl: 'https://api.z.ai/api/anthropic' } },
  minimax: { label: 'MiniMax', site: 'https://platform.minimaxi.com', billing: '按量或包月 Token Plan', intl: { label: 'MiniMax 国际站', site: 'https://platform.minimax.io', baseUrl: 'https://api.minimax.io/anthropic' } },
  volcano: { label: '火山方舟', site: 'https://console.volcengine.com/ark', billing: '包月 Coding Plan,只有中国站' },
}
const RECOMMENDED = 'deepseek'

// 中国大陆常见时区:只用来给「这台机器在中国大陆吗」一个默认值,答案以用户为准
const MAINLAND_TZ = new Set(['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'Asia/Urumqi', 'Asia/Kashgar', 'PRC'])
function looksMainland(tz) {
  if (tz === undefined) { try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { tz = '' } }
  return MAINLAND_TZ.has(String(tz || ''))
}

const host = (url) => { try { return new URL(url).host } catch { return String(url || '') } }

// 已登录的订阅优先:Claude > Codex;都没有返回 null(向导转去推荐 DeepSeek)
function subscriptionRoute({ claudeLoggedIn, codexLoggedIn } = {}) {
  if (claudeLoggedIn) return 'claude'
  if (codexLoggedIn) return 'codex'
  return null
}

// key 是否真能用上:明文非空,或 env: 引用且这个环境变量此刻有值
function keyPresent(apiKey, env = process.env) {
  if (!apiKey || typeof apiKey !== 'string') return false
  if (apiKey.startsWith('env:')) return !!env[apiKey.slice(4)]
  return true
}

// 试跑失败的原文 → 一句人话 + 类别。原文来自 claude 命令行(API Error: 401 …)或 spawn / 网络异常。
function explainTestFailure(text, { baseUrl } = {}) {
  const t = String(text || '')
  const h = baseUrl ? host(baseUrl) : '模型端点'
  if (/\b401\b|authentication|invalid (api )?key|invalid_authentication|unauthori[sz]ed|令牌|token expired|login fail|api key.*invalid/i.test(t)) {
    return { kind: 'auth', text: 'key 不对:检查有没有复制完整;有国际站的厂商,确认 key 和所选站点是同一个站开的' }
  }
  if (/\b402\b|insufficient|balance|余额|欠费|arrear|quota|实名|recharge|billing/i.test(t)) {
    return { kind: 'balance', text: '账户不能用:多半是余额不足或还没实名,到厂商后台充值 / 实名后再试' }
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed? ?out|fetch failed|socket hang up|network|connection error|aborted/i.test(t)) {
    return { kind: 'network', text: `连不上 ${h}:检查网络;开着全局代理的话,把 ${h} 设成直连` }
  }
  if (/\b404\b|model.*(not found|not exist|does not exist|invalid|not supported)|模型.*不存在/i.test(t)) {
    return { kind: 'model', text: '模型名不对或这个 key 没开通该模型:到控制台「模型」页改模型名' }
  }
  return { kind: 'other', text: t.split('\n')[0].slice(0, 200) || '没有返回内容' }
}

module.exports = { PROVIDER_INFO, RECOMMENDED, looksMainland, host, subscriptionRoute, keyPresent, explainTestFailure }
