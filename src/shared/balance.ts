/**
 * 余额监控（移植自 token-balance）共享类型：主进程与渲染层共用一份，避免双份定义漂移。
 */

/** 站点类型 id：sub2api 类网关 / deepseek 官方（适配器注册表的键） */
export type BalanceSiteType = string

/** 一个被监控站点的持久化配置（含凭据；describ* 系列会剔除凭据后再交给渲染层） */
export interface BalanceSite {
  id: string
  type: BalanceSiteType
  label: string
  icon: string
  apiBaseUrl: string
  usageUrl: string
  accessToken: string
  refreshToken: string
  enabled: boolean
}

/** 站点运行状态机的状态（每站点独立） */
export type BalanceSiteStatus =
  | 'no-token'
  | 'loading'
  | 'ok'
  | 'auth-error'
  | 'network-error'
  | 'api-error'
  | 'disabled'

/**
 * 站点"已用"数据的来源：
 * - api:站点自身记账(如 sub2api /usage/dashboard/stats 的 total_actual_cost,含赠送额度的消耗)
 * - metered:本机按"余额下降量"计量(DeepSeek 等无用量接口的站点,充值当期会低估,统计自首次观测)
 */
export type BalanceUsedSource = 'api' | 'metered'

/** 调度器对外推送的每站点运行状态（不含凭据） */
export interface BalanceSiteState {
  id: string
  label: string
  icon: string
  enabled: boolean
  status: BalanceSiteStatus
  balance: number | null
  currency: string
  /** 累计已用(口径见 BalanceUsedSource);null=暂无数据;PCT(百分比额度)站点恒为 null */
  used: number | null
  usedSource: BalanceUsedSource | null
  message: string | null
  updatedAt: string | null
  lastSuccessAt: string | null
}

/** 调度器快照（state 推送与 state:get 的载荷） */
export interface BalanceSnapshot {
  sites: BalanceSiteState[]
}

/** 配置持久化结构（userData/balance.user.json） */
export interface BalanceConfig {
  refreshIntervalMinutes: number
  window: {
    x: number | null
    y: number | null
    /** 上次显隐状态：下次启动按此恢复（默认隐藏） */
    visible: boolean
  }
  sites: BalanceSite[]
}

export interface BalanceWindowPatch {
  x?: number | null
  y?: number | null
  visible?: boolean
}

/** 凭据字段指引（引导用户从浏览器/平台复制哪个值） */
export interface BalanceTokenField {
  key: 'accessToken' | 'refreshToken'
  sourceKey: string
  label: string
}

/** 站点描述（列表/表单用，**不含任何凭据**） */
export interface BalanceSiteDescription {
  id: string | null
  type: BalanceSiteType
  label: string
  icon: string
  apiBaseUrl: string
  usageUrl: string
  enabled: boolean
  /** 凭据是否已配置完整 */
  saved: boolean
  setupSteps: string[]
  tokenFields: BalanceTokenField[]
  knownType: boolean
}

export interface BalanceSiteDescriptionList {
  sites: BalanceSiteDescription[]
}

/** "添加站点"类型选择器选项 */
export interface BalanceSiteTypeInfo {
  id: BalanceSiteType
  label: string
  hint: string
}

/** 保存站点（新建 id 为 null）——凭据留空表示"保持原值不变" */
export interface BalanceSiteInput {
  id: string | null
  type: BalanceSiteType
  label: string
  icon: string
  apiBaseUrl: string
  usageUrl: string
  accessToken: string
  refreshToken: string
  enabled: boolean
}

export interface BalanceSaveResult {
  ok: boolean
  id?: string
  message?: string
}

export interface BalanceRefreshResult {
  ok: boolean
  message?: string
}

/**
 * 余额/额度的统一显示格式(通知与渲染层共用一份,避免双份实现漂移)。
 * 货币加符号;PCT 表示"五小时额度已用百分比"(火山方舟 Coding Plan),显示整数+%,不参与货币合计。
 */
const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', CNY: '¥' }
export function formatBalance(balance: number | null, currency: string): string {
  if (currency === 'PCT') return `${Math.round(Number(balance))}%`
  const sym = CURRENCY_SYMBOLS[currency] || CURRENCY_SYMBOLS.USD
  return `${sym}${Number(balance).toFixed(2)}`
}

// ---------- 账单(账单窗口;sub2api=站点记账,DeepSeek=本机计量,百分比额度站点不参与) ----------

/** 单日用量(YYYY-MM-DD,站点本地日;本机计量按本机时区) */
export interface BillingDay {
  date: string
  used: number
}

/** 单月用量(YYYY-MM) */
export interface BillingMonth {
  month: string
  used: number
}

/** 账单里一个站点的用量报告 */
export interface BillingSiteReport {
  id: string
  label: string
  icon: string
  currency: string
  source: BalanceUsedSource
  /** 累计已用(api=最近一次站点记账;metered=本机计量累计) */
  usedTotal: number
  /** 统计起始日(YYYY-MM-DD):metered=首次计量日;api=趋势数据最早一天 */
  since: string | null
  /** 逐月用量(旧→新,最多近 6 个自然月) */
  months: BillingMonth[]
  /** 近 30 天逐日用量(旧→新) */
  recent: BillingDay[]
}

/** 账单窗口数据(billing:get 的载荷;主进程现拉现算,不持久化) */
export interface BillingReport {
  generatedAt: string
  /** 参与统计的站点(货币类) */
  sites: BillingSiteReport[]
  /** 不参与统计的站点名(百分比额度类,如火山方舟) */
  excluded: string[]
}
