/**
 * 火山引擎 OpenAPI 签名公共件——volcark(POST 表单版)与 volcbill(GET 查询串版)共用。
 *
 * 签名规范(官方《签名机制》docs.volcengine.com/docs/6369/67269):
 * - 派生链 HMAC(SK, 日期) → region → service → "request",逐级用上一步的原始摘要字节作 key
 * - StringToSign = "HMAC-SHA256\n{x-date}\n{scope}\n{sha256(canonicalRequest)}"
 * - scope = {日期}/{region}/{service}/request
 * 两个服务的差别只在 canonicalRequest 的构造(方法/查询串/签名头集合),派生链与信封一致。
 */
import { createHash, createHmac } from 'node:crypto'

export const EMPTY_SHA256 = createHash('sha256').update('').digest('hex')

/** UTC 时间戳 YYYYMMDD'T'HHMMSS'Z'(x-date 头) */
export function utcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

/** 派生签名密钥:kDate = HMAC(SK, date) → region → service → "request"(原始字节链) */
export function deriveSigningKey(
  sk: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  let key = createHmac('sha256', sk).update(dateStamp).digest()
  for (const part of [region, service, 'request']) {
    key = createHmac('sha256', key).update(part).digest()
  }
  return key
}

/** 由 canonicalRequest 与派生密钥合成最终签名(hex) */
export function signStringToSign(
  key: Buffer,
  xDate: string,
  scope: string,
  canonicalRequest: string
): string {
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n')
  return createHmac('sha256', key).update(stringToSign).digest('hex')
}

/** 火山错误码里属于"密钥问题"的(其余视为服务端/结构异常) */
export const AUTH_CODE_RE = /Signature|AccessKey|Auth|Denied|Forbidden|Credential|Invalid/i

export function classifyError(code: string): 'auth' | 'api' {
  return AUTH_CODE_RE.test(code) ? 'auth' : 'api'
}

/** 统一信封:成功 Result / 失败 ResponseMetadata.Error{Code,Message} */
export interface VolcEnvelope {
  ResponseMetadata?: { Error?: { Code?: unknown; Message?: unknown } | null }
  Result?: unknown
}

/** RFC3986 百分号编码(encodeURIComponent 会放过 !'()* ,规范要求转义) */
export function uriEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )
}
