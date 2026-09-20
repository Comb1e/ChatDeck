/** 厂商（LLM 站点）配置 */
export interface Provider {
  id: string
  name: string
  url: string
  /** 侧边栏字母标底色 */
  color: string
  enabled: boolean
  /** 内置厂商不可删除，只能停用 */
  builtin: boolean
  /** 覆盖默认 User-Agent（可选） */
  userAgent?: string
  /** 后台休眠分钟数（0=永不休眠；缺省回退 DEFAULT_AUTO_SLEEP_MINUTES） */
  autoSleepMinutes?: number
}

/** 新增/编辑厂商时由渲染层提交的字段 */
export interface ProviderInput {
  id?: string
  name: string
  url: string
  color?: string
  enabled?: boolean
  userAgent?: string
  autoSleepMinutes?: number
}

/** 预设提示词 */
export interface Prompt {
  id: string
  category: string
  title: string
  content: string
  builtin: boolean
}

export interface PromptInput {
  id?: string
  category: string
  title: string
  content: string
}

/** 主进程持久化的界面状态 */
export interface UiState {
  activeProviderId: string | null
  mode: LayoutMode
  paneProviderIds: string[]
  ratios: number[]
}

export type LayoutMode = 'single' | 'split2' | 'split3'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 主进程视图状态，用于侧边栏/窗格头展示（sleeping=视图已休眠卸载，切回时重建） */
export type ViewLoadState = 'loading' | 'ready' | 'failed' | 'crashed' | 'sleeping'

export interface PaneLayoutEntry {
  id: string
  rect: Rect
}

/** 主进程 → 渲染层的事件载荷 */
export interface TitleChangedEvent {
  id: string
  title: string
}

export interface ActiveChangedEvent {
  id: string
}

export interface LoadStateChangedEvent {
  id: string
  state: ViewLoadState
}

/** 站点后台休眠默认阈值（分钟）：超过该时长未显示的站点视图被卸载以释放内存 */
export const DEFAULT_AUTO_SLEEP_MINUTES = 5

/** 站点后台休眠分钟数；未配置或非法负值回退全局默认 */
export function effectiveAutoSleepMinutes(p: Pick<Provider, 'autoSleepMinutes'>): number {
  return typeof p.autoSleepMinutes === 'number' && p.autoSleepMinutes >= 0
    ? p.autoSleepMinutes
    : DEFAULT_AUTO_SLEEP_MINUTES
}
