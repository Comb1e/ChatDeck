/**
 * sub2api 类网关通用适配器（Subscription to API Conversion Platform）
 * ——移植自 token-balance src/main/providers/sub2api.js。
 * SpacetimeAI 是其一个实例；同族站点只需在站点配置里填不同地址即可接入。
 *
 * 契约:
 * - 所有请求带 Authorization: Bearer <access_token>
 * - access_token 过期时用 refresh_token 调 <base>/auth/refresh 续期,
 *   站点会轮换 refresh_token,必须把新值写回站点配置
 * - 余额来自 GET <base>/auth/me → data(或 data.user).balance(美元)
 * - 已用/用量(该类网关自带记账,实测对账 total_actual_cost == 逐日趋势求和):
 *   GET <base>/usage/dashboard/stats → data.total_actual_cost(累计已用,含赠送额度消耗)
 *   GET <base>/usage/dashboard/trend?start_date=&end_date= → data.trend[](逐日 actual_cost)
 */
import { ApiError, AuthError, NetworkError, SetupError, parseBalance, requestJson, shapeOf } from './base'
import type { BalanceProvider, BalanceQueryContext, BalanceResult, JsonResponse } from './base'
import type { BillingDay } from '@shared/balance'

function trim(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

interface RefreshPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

async function refreshTokens(apiBaseUrl: string, refreshToken: string): Promise<RefreshPayload> {
  let res: JsonResponse
  try {
    res = await requestJson(`${apiBaseUrl}/auth/refresh`, {
      method: 'POST',
      body: { refresh_token: refreshToken }
    })
  } catch (e) {
    if ((e as { kind?: string }).kind === 'network') throw e
    throw NetworkError(`刷新请求异常: ${(e as Error).message}`)
  }
  if (res.status === 401 || res.status === 403) {
    throw AuthError('refresh_token 已失效,请重新粘贴')
  }
  const { code, data, message } = (res.json ?? {}) as {
    code?: number
    data?: RefreshPayload
    message?: string
  }
  if (res.status >= 400 || code !== 0 || !data?.access_token) {
    throw AuthError(`刷新失败: ${message || `HTTP ${res.status}`}`)
  }
  return data // { access_token, refresh_token, expires_in }
}

interface MeUser {
  balance?: unknown
}

async function fetchMe(apiBaseUrl: string, accessToken: string): Promise<MeUser> {
  const res = await requestJson(`${apiBaseUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (res.status === 401) throw AuthError('access_token 已过期')
  const body = (res.json ?? {}) as { code?: number; data?: unknown; message?: string }
  if (res.jsonOk && res.json && body.code === undefined) {
    throw ApiError('响应缺少 code 字段,请确认 API 地址是否正确(通常应以 /api/v1 结尾)')
  }
  if (!res.jsonOk) {
    throw ApiError(`响应不是 JSON(HTTP ${res.status}),请检查 API 地址是否指向站点接口`)
  }
  // 该类站点 /auth/me 把用户对象平铺在 data 下(实测),同时兼容 data.user 嵌套形态
  const data = body.data
  const user =
    data && typeof data === 'object'
      ? (((data as { user?: unknown }).user ?? data) as MeUser)
      : null
  if (res.status >= 400 || body.code !== 0 || !user || !Number.isFinite(parseBalance(user.balance))) {
    // 结构诊断:只打印键名与类型,不含值,便于定位站点响应结构变化
    console.error(
      `[debug] /auth/me 异常: HTTP ${res.status} code=${JSON.stringify(body.code)} message=${JSON.stringify(body.message)} shape=${JSON.stringify(shapeOf(res.json))}`
    )
    throw ApiError(`获取用户信息失败: ${body.message || `HTTP ${res.status}`}`)
  }
  return user
}

/** 站点记账的累计已用(失败静默返回 null:用量缺失不影响余额展示) */
async function fetchUsedCost(apiBaseUrl: string, accessToken: string): Promise<number | null> {
  try {
    const res = await requestJson(`${apiBaseUrl}/usage/dashboard/stats`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (res.status >= 400) return null
    const body = (res.json ?? {}) as { code?: number; data?: { total_actual_cost?: unknown } }
    if (body.code !== 0) return null
    const used = parseBalance(body.data?.total_actual_cost)
    return Number.isFinite(used) ? used : null
  } catch {
    return null
  }
}

/** 逐日用量趋势(账单窗口);401 时用 refresh_token 续期后重试一次 */
async function fetchUsageTrend(
  apiBaseUrl: string,
  accessToken: string,
  refreshToken: string,
  start: string,
  end: string,
  onTokensRefreshed: BalanceQueryContext['onTokensRefreshed']
): Promise<BillingDay[]> {
  const pull = async (token: string): Promise<JsonResponse> =>
    requestJson(
      `${apiBaseUrl}/usage/dashboard/trend?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
  let res = await pull(accessToken)
  if (res.status === 401) {
    const fresh = await refreshTokens(apiBaseUrl, refreshToken)
    onTokensRefreshed({
      accessToken: String(fresh.access_token ?? ''),
      refreshToken: String(fresh.refresh_token ?? '')
    })
    res = await pull(String(fresh.access_token))
  }
  if (res.status >= 400) throw ApiError(`获取用量趋势失败: HTTP ${res.status}`)
  const body = (res.json ?? {}) as {
    code?: number
    data?: { trend?: Array<{ date?: unknown; actual_cost?: unknown }> }
  }
  const rows = body.code === 0 && Array.isArray(body.data?.trend) ? body.data.trend : null
  if (!rows) throw ApiError('用量趋势响应结构异常')
  const days: BillingDay[] = []
  for (const row of rows) {
    const date = typeof row?.date === 'string' ? row.date : ''
    const used = parseBalance(row?.actual_cost)
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(used)) days.push({ date, used })
  }
  return days
}

export const sub2apiProvider: BalanceProvider = {
  id: 'sub2api',
  label: 'sub2api 网关',
  // "添加站点"类型选择器里的文案
  typeLabel: 'sub2api 网关站点',
  typeHint: 'SpacetimeAI 等 sub2api 类站点;从浏览器 localStorage 复制 Token',
  balanceUnit: 'USD',
  newSiteDefaults() {
    return {
      type: 'sub2api',
      label: '',
      icon: 'openai',
      apiBaseUrl: '',
      usageUrl: '',
      accessToken: '',
      refreshToken: '',
      enabled: true
    }
  },
  tokenFields: [
    { key: 'accessToken', sourceKey: 'auth_token', label: 'Access Token(auth_token)' },
    { key: 'refreshToken', sourceKey: 'refresh_token', label: 'Refresh Token(refresh_token)' }
  ],
  setupSteps: [
    '浏览器打开该站点并登录',
    '按 F12 打开开发者工具 → Application(应用)→ Local Storage → 站点域名',
    '分别复制 `auth_token` 和 `refresh_token` 的值,粘贴到下方输入框',
    '保存后立即生效;之后应用会用 refresh_token 自动续期,无需重复操作'
  ],

  hasCredentials(site) {
    return Boolean(trim(site.accessToken) && trim(site.refreshToken))
  },

  async getBalance({ site, onTokensRefreshed }: BalanceQueryContext): Promise<BalanceResult> {
    const apiBaseUrl = trim(site.apiBaseUrl).replace(/\/+$/, '')
    const accessToken = trim(site.accessToken)
    const refreshToken = trim(site.refreshToken)
    if (!apiBaseUrl) throw SetupError('未配置 API 地址')
    if (!accessToken || !refreshToken) throw SetupError('尚未配置 Token')

    let user: MeUser
    try {
      user = await fetchMe(apiBaseUrl, accessToken)
    } catch (e) {
      if ((e as { kind?: string }).kind !== 'auth') throw e
      // access_token 过期:用 refresh_token 续期后重试一次
      const fresh = await refreshTokens(apiBaseUrl, refreshToken)
      onTokensRefreshed({
        accessToken: String(fresh.access_token ?? ''),
        refreshToken: String(fresh.refresh_token ?? '')
      })
      user = await fetchMe(apiBaseUrl, String(fresh.access_token))
    }

    const balance = parseBalance(user.balance)
    if (!Number.isFinite(balance)) {
      throw ApiError('响应中无 balance 字段,站点结构可能已变化')
    }
    // 已用为锦上添花:拿不到(旧版网关/临时故障)就不填,调度器回退本机计量
    const used = await fetchUsedCost(apiBaseUrl, accessToken)
    return used === null ? { balance } : { balance, used }
  },

  async getUsage({ site, onTokensRefreshed, start, end }: BalanceQueryContext & { start: string; end: string }) {
    const apiBaseUrl = trim(site.apiBaseUrl).replace(/\/+$/, '')
    const accessToken = trim(site.accessToken)
    const refreshToken = trim(site.refreshToken)
    if (!apiBaseUrl) throw SetupError('未配置 API 地址')
    if (!accessToken || !refreshToken) throw SetupError('尚未配置 Token')
    return fetchUsageTrend(apiBaseUrl, accessToken, refreshToken, start, end, onTokensRefreshed)
  }
}
