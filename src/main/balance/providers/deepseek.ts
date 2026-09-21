/**
 * DeepSeek 开放平台适配器（platform.deepseek.com，与 sub2api 类网关协议不同）
 * ——移植自 token-balance src/main/providers/deepseek.js。
 *
 * 契约(https://api-docs.deepseek.com/api/get-user-balance):
 * - GET <base>/user/balance,Authorization: Bearer <API Key>
 * - 响应:{ is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
 * - 币种由账户充值币种决定(CNY 或 USD),随余额一起返回
 * - API Key 在平台手动创建,不会自动轮换,因此没有 refresh 流程
 */
import { ApiError, AuthError, SetupError, parseBalance, requestJson, shapeOf } from './base'
import type { BalanceProvider, BalanceQueryContext, BalanceResult } from './base'

function trim(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

interface BalanceInfo {
  currency?: unknown
  total_balance?: unknown
}

export const deepseekProvider: BalanceProvider = {
  id: 'deepseek',
  label: 'DeepSeek 官方',
  // "添加站点"类型选择器里的文案
  typeLabel: 'DeepSeek 官方平台',
  typeHint: 'platform.deepseek.com,创建一个 API Key 粘贴即可',
  balanceUnit: 'USD',
  newSiteDefaults() {
    return {
      type: 'deepseek',
      label: 'DeepSeek',
      icon: 'deepseek',
      apiBaseUrl: 'https://api.deepseek.com',
      usageUrl: 'https://platform.deepseek.com/usage',
      accessToken: '',
      refreshToken: '',
      enabled: true
    }
  },
  tokenFields: [
    { key: 'accessToken', sourceKey: 'API Key', label: 'API Key(在 platform.deepseek.com/api_keys 创建)' }
  ],
  setupSteps: [
    '浏览器打开 `platform.deepseek.com/api_keys`',
    '创建 API Key 并复制(仅创建时完整可见)',
    '把 API Key 粘贴到下方输入框,保存即可',
    'API Key 不会自动过期;若查询报错请回平台重新创建一个'
  ],

  hasCredentials(site) {
    return Boolean(trim(site.accessToken))
  },

  async getBalance({ site }: BalanceQueryContext): Promise<BalanceResult> {
    const apiBaseUrl = trim(site.apiBaseUrl).replace(/\/+$/, '')
    const apiKey = trim(site.accessToken)
    if (!apiBaseUrl) throw SetupError('未配置 API 地址')
    if (!apiKey) throw SetupError('尚未配置 API Key')

    const res = await requestJson(`${apiBaseUrl}/user/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    })
    if (res.status === 401 || res.status === 403) {
      throw AuthError('API Key 无效或已被删除,请重新创建并粘贴')
    }
    const body = (res.json ?? {}) as { balance_infos?: unknown }
    const infos =
      res.jsonOk && body && Array.isArray(body.balance_infos)
        ? (body.balance_infos as BalanceInfo[])
        : null
    if (res.status >= 400 || !infos || !infos.length) {
      // 结构诊断:只打印键名与类型,不含值
      console.error(
        `[debug] /user/balance 异常: HTTP ${res.status} shape=${JSON.stringify(shapeOf(res.json))}`
      )
      throw ApiError(
        `获取余额失败: HTTP ${res.status},请确认 API 地址(官方应为 https://api.deepseek.com)`
      )
    }
    // 官方按币种分条返回,普通账户只有一条;取第一条
    const info = infos[0]
    const balance = parseBalance(info.total_balance)
    if (!Number.isFinite(balance)) {
      console.error(`[debug] /user/balance 结构变化: shape=${JSON.stringify(shapeOf(infos))}`)
      throw ApiError('响应中无 total_balance 字段,官方接口结构可能已变化')
    }
    const currency = typeof info.currency === 'string' && info.currency ? info.currency : 'USD'
    return { balance, currency }
  }
}
