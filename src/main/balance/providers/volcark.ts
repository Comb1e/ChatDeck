/**
 * 火山方舟 Coding Plan 适配器(console.volcengine.com/ark → 订阅的编码计划)。
 *
 * 协议(对照开源实现 dsh-ark-quota / ArkBar 逆向核实):
 * - POST https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01,空请求体
 * - 鉴权:火山引擎 SigV4 请求签名(service=ark, region=cn-beijing),
 *   凭据是「访问控制(IAM) → 访问密钥」的 AccessKeyId/SecretAccessKey,
 *   不是模型推理用的 Ark API Key
 * - 响应:Result.QuotaUsage[] { Level, Percent, ResetTimestamp(秒) },
 *   Level ∈ session(当前五小时会话)/weekly/monthly;Percent 为已用比例
 * - 错误:ResponseMetadata.Error { Code, Message }(+HTTP 4xx)
 *
 * 用户只关心五小时窗口,故取 Level==='session'(缺失时退回第一个条目)。
 * 额度显示用 currency='PCT'(百分比),与货币站点天然互斥,不参与合计。
 */
import { ApiError, AuthError, SetupError, parseBalance, requestJson, shapeOf } from './base'
import type { BalanceProvider, BalanceQueryContext, BalanceResult } from './base'
import {
  EMPTY_SHA256,
  classifyError,
  deriveSigningKey,
  signStringToSign,
  utcStamp
} from './volcsig'

const ACTION = 'GetCodingPlanUsage'
const API_VERSION = '2024-01-01'
const REGION = 'cn-beijing' // 方舟 OpenAPI 所在区域,与控制台 region:cn-beijing 一致
const SERVICE = 'ark'
const DEFAULT_API_BASE = 'https://open.volcengineapi.com'

function trim(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 火山引擎 SigV4 签名(POST 表单版),独立纯函数便于对照测试。
 * canonicalRequest 自行构造(签名头含 content-type/x-content-sha256),
 * 派生链与信封在 volcsig.ts 与 volcbill(GET 版)共用。
 */
export function signVolcRequest(cfg: {
  action: string
  version: string
  ak: string
  sk: string
  region: string
  service: string
  host: string
  now: Date
}): { url: string; headers: Record<string, string> } {
  const xDate = utcStamp(cfg.now)
  const dateStamp = xDate.slice(0, 8)
  const query = `Action=${cfg.action}&Version=${cfg.version}`
  const contentType = 'application/x-www-form-urlencoded; charset=utf-8'
  const signedHeaders = 'content-type;host;x-content-sha256;x-date'
  const canonicalRequest = [
    'POST',
    '/',
    query,
    `content-type:${contentType}`,
    `host:${cfg.host}`,
    `x-content-sha256:${EMPTY_SHA256}`,
    `x-date:${xDate}`,
    '',
    signedHeaders,
    EMPTY_SHA256
  ].join('\n')
  const scope = `${dateStamp}/${cfg.region}/${cfg.service}/request`
  const key = deriveSigningKey(cfg.sk, dateStamp, cfg.region, cfg.service)
  const signature = signStringToSign(key, xDate, scope, canonicalRequest)
  const authorization =
    `HMAC-SHA256 Credential=${cfg.ak}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  return {
    url: `https://${cfg.host}/?${query}`,
    headers: {
      'content-type': contentType,
      accept: 'application/json',
      'x-date': xDate,
      'x-content-sha256': EMPTY_SHA256,
      authorization
    }
  }
}

interface QuotaEntry {
  Level?: unknown
  Percent?: unknown
  ResetTimestamp?: unknown
}

interface VolcEnvelope {
  ResponseMetadata?: { Error?: { Code?: unknown; Message?: unknown } | null }
  Result?: { QuotaUsage?: unknown }
}

export function parseVolcUsage(json: unknown): { percent: number; resetIso: string | null } {
  const body = (json ?? {}) as VolcEnvelope
  const list =
    body.Result && Array.isArray(body.Result.QuotaUsage)
      ? (body.Result.QuotaUsage as QuotaEntry[])
      : null
  if (!list || !list.length) {
    console.error(`[debug] GetCodingPlanUsage 结构变化: shape=${JSON.stringify(shapeOf(json))}`)
    throw ApiError('响应中无 QuotaUsage,请确认账号已订阅火山方舟编码计划')
  }
  // 用户只要五小时窗口;服务端若不再返回 session,退回第一条以免空转
  const entry = list.find((q) => q && q.Level === 'session') || list[0]
  const percent = parseBalance(entry?.Percent)
  if (!Number.isFinite(percent)) {
    console.error(`[debug] GetCodingPlanUsage 缺 Percent: shape=${JSON.stringify(shapeOf(list))}`)
    throw ApiError('响应中无 Percent 字段,接口结构可能已变化')
  }
  const ts = parseBalance(entry?.ResetTimestamp)
  const resetIso = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null
  return { percent, resetIso }
}

export const volcarkProvider: BalanceProvider = {
  id: 'volcark',
  label: '火山方舟',
  // "添加站点"类型选择器里的文案
  typeLabel: '火山方舟 Coding Plan',
  typeHint: 'console.volcengine.com 编码计划,填 IAM 访问密钥 AK/SK',
  balanceUnit: 'PCT',
  newSiteDefaults() {
    return {
      type: 'volcark',
      label: '火山方舟',
      icon: 'bytedance',
      apiBaseUrl: DEFAULT_API_BASE,
      usageUrl: 'https://console.volcengine.com/ark/region:cn-beijing/subscription/coding-plan',
      accessToken: '',
      refreshToken: '',
      enabled: true
    }
  },
  tokenFields: [
    {
      key: 'accessToken',
      sourceKey: 'AccessKeyId',
      label: 'AccessKeyId(火山引擎控制台 → 访问密钥)'
    },
    { key: 'refreshToken', sourceKey: 'SecretAccessKey', label: 'SecretAccessKey(仅创建时完整可见)' }
  ],
  setupSteps: [
    '浏览器打开 `console.volcengine.com` → 右上角头像 → 访问密钥',
    '创建访问密钥;注意是 IAM 的 AK/SK,不是方舟推理用的 Ark API Key',
    '把 AccessKeyId 与 SecretAccessKey 分别粘贴到下方(仅创建时完整可见)',
    '保存后立即验证;密钥不会自动过期,失效请回控制台重建'
  ],

  hasCredentials(site) {
    return Boolean(trim(site.accessToken) && trim(site.refreshToken))
  },

  async getBalance({ site }: BalanceQueryContext): Promise<BalanceResult> {
    const ak = trim(site.accessToken)
    const sk = trim(site.refreshToken)
    if (!ak || !sk) throw SetupError('尚未配置访问密钥(AK/SK)')
    const base = trim(site.apiBaseUrl) || DEFAULT_API_BASE
    let host = ''
    try {
      host = new URL(base).host
    } catch {
      host = ''
    }
    if (!host) throw SetupError('API 地址无效(官方应为 https://open.volcengineapi.com)')

    const signed = signVolcRequest({
      action: ACTION,
      version: API_VERSION,
      ak,
      sk,
      region: REGION,
      service: SERVICE,
      host,
      now: new Date()
    })
    const res = await requestJson(signed.url, { method: 'POST', headers: signed.headers })

    if (res.status === 401 || res.status === 403) {
      throw AuthError('访问密钥无效或无方舟权限,请在控制台检查/重建')
    }
    const body = (res.json ?? {}) as VolcEnvelope
    const err = body.ResponseMetadata?.Error
    if (err && typeof err === 'object') {
      const code = trim(err.Code) || 'Unknown'
      const msg = trim(err.Message) || code
      if (classifyError(code) === 'auth') {
        throw AuthError(`访问密钥被拒绝(${code}),请检查 AK/SK 或权限`)
      }
      throw ApiError(`方舟接口错误: ${code} ${msg}`)
    }
    if (res.status >= 400 || !res.jsonOk) {
      console.error(
        `[debug] GetCodingPlanUsage 异常: HTTP ${res.status} shape=${JSON.stringify(shapeOf(res.json))}`
      )
      throw ApiError(`获取额度失败: HTTP ${res.status},请确认 API 地址(官方为 ${DEFAULT_API_BASE})`)
    }
    const { percent, resetIso } = parseVolcUsage(res.json)
    return { balance: percent, currency: 'PCT', ...(resetIso ? { note: resetIso } : {}) }
  }
}
