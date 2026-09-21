/**
 * 站点适配器公共基类——移植自 token-balance src/main/providers/base.js。
 * 新增站点：实现 BalanceProvider 接口，并在 index.ts 注册。
 *
 * getBalance 约定抛出以下错误之一，调度器据此切换站点状态：
 *   SetupError   — 凭据未配置
 *   AuthError    — 凭据已失效且无法自动续期，需要用户重新粘贴
 *   NetworkError — 网络不通/超时，下个周期重试即可
 *   ApiError     — 站点返回异常（code!==0 / 结构变化）
 */
import type { BalanceSite, BalanceTokenField, BillingDay } from '@shared/balance'

export type ProviderErrorKind = 'setup' | 'auth' | 'network' | 'api'

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind

  constructor(kind: ProviderErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

export const SetupError = (m: string): ProviderError => new ProviderError('setup', m)
export const AuthError = (m: string): ProviderError => new ProviderError('auth', m)
export const NetworkError = (m: string): ProviderError => new ProviderError('network', m)
export const ApiError = (m: string): ProviderError => new ProviderError('api', m)

export const DEFAULT_TIMEOUT_MS = 15000

export interface JsonResponse {
  status: number
  json: unknown
  jsonOk: boolean
}

export interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

/**
 * 解析余额：只接受数字或非空数字字符串。
 * null/undefined/''/布尔/对象一律视为缺失 —— Number(null) 会得到 0，
 * 若直接使用会把"字段缺失"静默显示成 0.00。各适配器共用。
 */
export function parseBalance(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

/**
 * 生成响应的结构摘要（值替换为类型名），用于诊断日志。
 * 只含键名与类型、不含任何值，凭据安全。
 */
export function shapeOf(v: unknown, depth = 0): unknown {
  if (depth > 2) return typeof v
  if (Array.isArray(v)) return [shapeOf(v[0], depth + 1)]
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 15)) {
      out[k] = shapeOf(val, depth + 1)
    }
    return out
  }
  return typeof v
}

export async function requestJson(url: string, opts: RequestOptions = {}): Promise<JsonResponse> {
  const { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  // 调用方自带 content-type 时不得再注入默认值——volcark 的 SigV4 对 content-type 签名,
  // 双份合并后服务端收到的值与签名不一致必然 SignatureDoesNotMatch
  const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')
  const merged = hasContentType ? { ...headers } : { 'Content-Type': 'application/json', ...headers }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: merged,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    })
  } catch (e) {
    throw NetworkError(`请求失败: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
  let json: unknown = null
  let jsonOk = false
  try {
    json = await res.json()
    jsonOk = true
  } catch {
    // 非 JSON 响应体（如错误地址返回的 HTML 页面）
  }
  return { status: res.status, json, jsonOk }
}

export interface BalanceQueryContext {
  site: BalanceSite
  /** sub2api 续期会轮换 refresh_token，必须把新值写回站点配置 */
  onTokensRefreshed: (tokens: { accessToken: string; refreshToken: string }) => void
}

export interface BalanceResult {
  balance: number
  currency?: string
  /**
   * 成功态的补充说明(原样进入站点状态 message,渲染层在 ok 态展示)。
   * 如 volcark 传"额度重置时间"的 ISO 串。
   */
  note?: string
  /**
   * 站点记账的累计已用(如 sub2api /usage/dashboard/stats 的 total_actual_cost)。
   * 提供不了的类型(DeepSeek)由调度器走本机计量;拉取失败静默省略,不影响余额。
   */
  used?: number
}

export interface BalanceProvider {
  id: string
  label: string
  /** "添加站点"类型选择器里的文案 */
  typeLabel: string
  typeHint: string
  /** 站点未返回币种时的回退单位 */
  balanceUnit?: string
  newSiteDefaults(): Partial<BalanceSite> & { type: string }
  /** 引导态需要的凭据字段 */
  tokenFields: BalanceTokenField[]
  setupSteps: string[]
  hasCredentials(site: Partial<BalanceSite>): boolean
  getBalance(ctx: BalanceQueryContext): Promise<BalanceResult>
  /**
   * 拉取 [start, end] 内的逐日用量(YYYY-MM-DD,闭区间;账单窗口用)。
   * 没有用量接口的类型不实现——调度器/账单对这类站点走本机计量。
   */
  getUsage?(ctx: BalanceQueryContext & { start: string; end: string }): Promise<BillingDay[]>
}
