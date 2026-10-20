// 瞬时错判据 —— 服务端过载 / 限流 / 网关错这类「过一会儿再来就好」的错,与配置错、权限错、
// 额度用尽是两类事:前者群里该说「排不上队,稍后接着做」,后者要人去改配置或等额度重置。
//
// 由来(2026-09-08 测试群现场):codex 在工具调用之后的下一次请求上收到
// 「Selected model is at capacity. Please try a different model.」,群里落的是这句英文原话 ——
// 「换个模型」是给 ChatGPT 用户的建议,群成员照做不了(群里 /model 会清会话,照做反而更糟)。
//
// 两个 runner 共用这一份签名表(codex 的 turn.failed / error,claude 的 result is_error),
// 分开写必漂;引擎只认结果上的 `transient` 字段(一句人话),不认签名 —— core 不碰错误文本。
// ⚠ 只给群面那句人话,**不改 result.text**:账本的失败原因要留服务端原话,查的人靠它对号。
// ⚠ 判据宁漏不误:额度类(usage limit / quota / billing)显式排除 —— 那种等十秒没用,
//    而且额度告警另有一条线在管;裸数字状态码不认(「exit code 500」这种正文会误中)。

const NOT_TRANSIENT = /usage limit|usage_limit|quota|额度|insufficient|billing|credit/i

// [签名, 群面人话] —— 顺序即优先级;人话里零工具名(群成员看得到)
const SIGNATURES = [
  [/at capacity/i, '模型这会儿排不上队(服务端过载)'],
  [/overloaded/i, '模型这会儿排不上队(服务端过载)'],
  [/rate[ _-]?limit|too many requests/i, '请求太密,被暂时限流了'],
  [/bad gateway|service unavailable|gateway time-?out|internal server error|server_error|upstream connect error/i, '模型服务暂时不可用'],
]

/** 命中瞬时错签名 ⇒ 返回群面那句人话;否则空串。 */
function classifyTransient(text) {
  const s = String(text || '')
  if (!s.trim() || NOT_TRANSIENT.test(s)) return ''
  for (const [re, human] of SIGNATURES) if (re.test(s)) return human
  return ''
}

module.exports = { classifyTransient, SIGNATURES, NOT_TRANSIENT }
