/**
 * 站点类型注册表——移植自 token-balance src/main/providers/index.js。
 * 新增一类站点三步：
 *   1. 在 providers/ 下新增适配器文件，按 base.ts 注释实现接口
 *   2. 在 ADAPTERS 中注册（键 = 站点 type）
 *   3. 若需预置默认站点，在 store.ts 的 DEFAULTS 里加默认项
 * 同类站点的多个实例不需要新适配器 —— 只需用户在界面里添加站点并填地址与 Token。
 */
import type {
  BalanceSite,
  BalanceSiteDescription,
  BalanceSiteTypeInfo
} from '@shared/balance'
import type { BalanceProvider } from './base'
import { sub2apiProvider } from './sub2api'
import { deepseekProvider } from './deepseek'
import { volcarkProvider } from './volcark'
import type { BalanceStore } from '../store'

const ADAPTERS: Record<string, BalanceProvider> = {
  [sub2apiProvider.id]: sub2apiProvider,
  [deepseekProvider.id]: deepseekProvider,
  [volcarkProvider.id]: volcarkProvider
}

export type { BalanceProvider }

export function getAdapter(type: string): BalanceProvider | null {
  return ADAPTERS[type] || null
}

/** 站点元信息（不含任何凭据），供渲染层列表/表单使用 */
export function describeSite(site: BalanceSite): BalanceSiteDescription {
  const adapter = getAdapter(site.type)
  return {
    id: site.id,
    type: site.type,
    label: site.label,
    icon: site.icon,
    apiBaseUrl: site.apiBaseUrl || '',
    usageUrl: site.usageUrl || '',
    enabled: site.enabled !== false,
    saved: adapter ? adapter.hasCredentials(site) : false,
    setupSteps: adapter ? adapter.setupSteps : [],
    tokenFields: adapter ? adapter.tokenFields : [],
    knownType: Boolean(adapter)
  }
}

/** "添加站点"表单的默认值（由各适配器提供预填：地址/图标/名称） */
export function describeNewSite(type: string): BalanceSiteDescription {
  const adapter = getAdapter(type) || sub2apiProvider
  const d = adapter.newSiteDefaults()
  return {
    id: null,
    type: adapter.id,
    label: d.label || '',
    icon: d.icon || 'openai',
    apiBaseUrl: d.apiBaseUrl || '',
    usageUrl: d.usageUrl || '',
    enabled: true,
    saved: false,
    setupSteps: adapter.setupSteps,
    tokenFields: adapter.tokenFields,
    knownType: true
  }
}

/** "添加站点"类型选择器的可选项（不含任何凭据） */
export function describeTypes(): BalanceSiteTypeInfo[] {
  return Object.values(ADAPTERS).map((a) => ({
    id: a.id,
    label: a.typeLabel || a.label,
    hint: a.typeHint || ''
  }))
}

export function describeAll(store: BalanceStore): { sites: BalanceSiteDescription[] } {
  return { sites: store.getSites().map(describeSite) }
}
