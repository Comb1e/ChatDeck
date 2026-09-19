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
}

/** 新增/编辑厂商时由渲染层提交的字段 */
export interface ProviderInput {
  id?: string
  name: string
  url: string
  color?: string
  enabled?: boolean
  userAgent?: string
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

/** 主进程视图状态，用于侧边栏/窗格头展示 */
export type ViewLoadState = 'loading' | 'ready' | 'failed' | 'crashed'

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
