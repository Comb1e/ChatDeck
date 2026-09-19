import type {
  PaneLayoutEntry,
  Prompt,
  PromptInput,
  Provider,
  ProviderInput,
  UiState,
  ViewLoadState
} from './types'

/** 渲染层可用的宿主 API（preload 经 contextBridge 暴露，结构以本接口为准） */
export interface DeckApi {
  providers: {
    list(): Promise<Provider[]>
    save(input: ProviderInput): Promise<Provider[]>
    remove(id: string): Promise<Provider[]>
    clearData(id: string): Promise<boolean>
  }
  prompts: {
    list(): Promise<PromptLibrary>
    save(input: PromptInput): Promise<PromptLibrary>
    remove(id: string): Promise<PromptLibrary>
    reset(): Promise<PromptLibrary>
  }
  state: {
    get(): Promise<UiState | null>
    save(state: UiState): Promise<void>
  }
  view: {
    setLayout(entries: PaneLayoutEntry[]): Promise<boolean>
    setActive(id: string): void
    reload(id: string): void
    back(id: string): void
    forward(id: string): void
    openExternal(id: string): void
    paste(id: string): void
  }
  /** 悬浮窗专用视图通道(仅悬浮窗渲染层调用,绑定 FloatWindow 的视图管理器) */
  fview: {
    setLayout(entries: PaneLayoutEntry[]): Promise<boolean>
    setActive(id: string): void
    reload(id: string): void
    back(id: string): void
    forward(id: string): void
  }
  /** 悬浮窗窗口控制 */
  float: {
    /** 主窗口侧唤起/收起悬浮窗 */
    toggle(): Promise<boolean>
    /** 悬浮窗内部:展开/折叠 */
    resize(expanded: boolean): Promise<boolean>
    /** 悬浮窗自身隐藏 */
    hide(): Promise<boolean>
    getState(): Promise<FloatWindowState>
    setActiveProvider(id: string): void
  }
  clipboard: {
    writeText(text: string): Promise<boolean>
  }
  on: {
    titleChanged(cb: (e: { id: string; title: string }) => void): void
    activeChanged(cb: (e: { id: string }) => void): void
    loadStateChanged(cb: (e: { id: string; state: ViewLoadState }) => void): void
  }
  onF: {
    titleChanged(cb: (e: { id: string; title: string }) => void): void
    activeChanged(cb: (e: { id: string }) => void): void
    loadStateChanged(cb: (e: { id: string; state: ViewLoadState }) => void): void
  }
}

/** 悬浮窗持久化状态(float-state.json)暴露给渲染层的部分 */
export interface FloatWindowState {
  expanded: boolean
  activeProviderId: string | null
}

export interface PromptLibrary {
  prompts: Prompt[]
  categories: string[]
}
