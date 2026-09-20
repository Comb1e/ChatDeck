import type {
  PaneLayoutEntry,
  Prompt,
  PromptInput,
  Provider,
  ProviderInput,
  ViewLoadState
} from './types'
import type { TranslateConfig, TranslatePairId, TranslatePopupState } from './translate'

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
  /** 悬浮窗站点视图通道(绑定 FloatWindow 的视图管理器) */
  fview: {
    setLayout(entries: PaneLayoutEntry[]): Promise<boolean>
    setActive(id: string): void
    reload(id: string): void
    back(id: string): void
    forward(id: string): void
    /** 粘贴到悬浮窗当前活动站点(提示词面板从设置窗口调用) */
    paste(): Promise<boolean>
  }
  /** 悬浮窗窗口控制 */
  float: {
    /** 托盘等外部入口唤起/收起悬浮窗 */
    toggle(): Promise<boolean>
    /** 悬浮窗内部:展开/折叠 */
    resize(expanded: boolean): Promise<boolean>
    /** 悬浮窗自身隐藏 */
    hide(): Promise<boolean>
    getState(): Promise<FloatWindowState>
    setActiveProvider(id: string): void
  }
  /** 应用级入口 */
  app: {
    /** 打开设置窗口(悬浮窗齿轮/托盘共用同一窗口,已开则聚焦) */
    openSettings(): Promise<boolean>
    /** 开机自启当前状态(读注册表 Run 项) */
    getAutostart(): Promise<boolean>
    /** 设置/取消开机自启;返回生效后的真实状态 */
    setAutostart(enabled: boolean): Promise<boolean>
  }
  clipboard: {
    writeText(text: string): Promise<boolean>
  }
  /** 划词翻译(设置表单与译文弹窗共用同一 preload) */
  translate: {
    getConfig(): Promise<TranslateConfig>
    /** 保存 APPID/KEY;pair 由 setPair 单独维护 */
    saveConfig(input: { appId: string; appKey: string }): Promise<TranslateConfig>
    /** 弹窗方向选择器:切换语言方向对并持久化 */
    setPair(pair: TranslatePairId): void
    /** 弹窗冷启动兜底:取最近一次推送的状态 */
    getLast(): Promise<TranslatePopupState | null>
    hide(): Promise<boolean>
  }
  /** 主进程 → 译文弹窗渲染层事件(仅弹窗会收到) */
  on: {
    translateResult(cb: (state: TranslatePopupState) => void): void
  }
  /** 主进程 → 悬浮窗渲染层事件 */
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
