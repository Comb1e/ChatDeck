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
 */
import { ApiError, AuthError, NetworkError, SetupError, parseBalance, requestJson, shapeOf } from './base'
import type { BalanceProvider, BalanceQueryContext, BalanceResult, JsonResponse } from './base'

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
    return { balance }
  }
}
