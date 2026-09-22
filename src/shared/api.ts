import type {
  PaneLayoutEntry,
  Prompt,
  PromptInput,
  Provider,
  ProviderInput,
  Rect,
  ViewLoadState
} from './types'
import type {
  BalanceRefreshResult,
  BalanceSaveResult,
  BalanceSiteDescription,
  BalanceSiteDescriptionList,
  BalanceSiteInput,
  BalanceSiteTypeInfo,
  BalanceSnapshot,
  BillingReport
} from './balance'
import type { TranslateConfig, TranslatePairId, TranslatePopupState } from './translate'
import type { FormCommand, FormReport } from './formTransition'

/** 主进程 → 鲸鱼渲染层的行为命令 */
export type WhaleCommand = { type: 'jump-dive' } | { type: 'surface'; x: number; y: number }

/** 鲸鱼渲染层光标采样(屏幕坐标 + 时间戳,与渲染层 performance 时钟同源) */
export interface WhaleCursorPoint {
  x: number
  y: number
  at: number
}

/** 渲染层可用的宿主 API（preload 经 contextBridge 暴露，结构以本接口为准） */
export interface DeckApi {
  form: {
    ready(): void
    report(report: FormReport): void
    onCommand(cb: (command: FormCommand) => void): void
  }
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
    /** 把站点视图导航到指定地址(余额站点的 Usage 页) */
    navigate(id: string, url: string): Promise<boolean>
    /** 粘贴到悬浮窗当前活动站点(提示词面板从设置窗口调用) */
    paste(): Promise<boolean>
  }
  /** 悬浮窗窗口控制 */
  float: {
    /** 托盘等外部入口:展开悬浮窗 / 收起为鲸鱼(形态切换) */
    toggle(): Promise<boolean>
    /** 悬浮窗内部:收起为鲸鱼形态 */
    collapse(): Promise<boolean>
    /** 悬浮窗隐藏(等价于收起为鲸鱼) */
    hide(): Promise<boolean>
    getState(): Promise<FloatWindowState>
    setActiveProvider(id: string): void
    /** 未读站点数变化推送(鲸鱼头顶气泡) */
    pushUnread(count: number): void
  }
  /** 鲸鱼形态(悬浮窗压缩态) */
  whale: {
    /** 渲染层初始化完成,可以显示窗口 */
    ready(): void
    getWorkarea(): Promise<Rect>
    /** 悬浮在鲸鱼/气泡上时开启窗口交互,离开后恢复鼠标穿透 */
    setInteractive(on: boolean): void
    /** 请求展开；协调器随后采集实际显示姿态。 */
    expand(): Promise<boolean>
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
  /** 余额监控小窗(独立窗口,托盘开关显隐;数据面均由主进程持有) */
  balance: {
    /** 当前全部站点运行状态 */
    getState(): Promise<BalanceSnapshot>
    /** 站点元信息列表(不含凭据) */
    describeSites(): Promise<BalanceSiteDescriptionList>
    /** "添加站点"表单默认值(按类型) */
    describeNewSite(type: string): Promise<BalanceSiteDescription>
    /** "添加站点"类型选择器选项 */
    describeSiteTypes(): Promise<BalanceSiteTypeInfo[]>
    /** 保存并立即验证(凭据留空表示保持不变) */
    saveSite(input: BalanceSiteInput): Promise<BalanceSaveResult>
    removeSite(id: string): Promise<{ ok: boolean }>
    /** 调整站点顺序(delta=-1 上移/+1 下移);胶囊与列表顺序立即跟随 */
    moveSite(id: string, delta: -1 | 1): Promise<{ ok: boolean }>
    refreshNow(): Promise<BalanceRefreshResult>
    /** 打开/关闭余额小窗;传 'show' 则只打开(幂等,设置窗口入口用) */
    toggle(mode?: 'show'): void
    /** 打开独立账单窗口(每月用量等明细) */
    openBilling(): void
    /** 拉取账单报告(主进程现拉现算,可能耗时数秒) */
    getBillingReport(): Promise<BillingReport>
    /** 关闭账单窗口(账单窗口内部用) */
    closeBilling(): void
    /** 打开站点的 Usage 页(系统浏览器) */
    openUsage(siteId: string): void
    /** 渲染层按内容测量的窗口尺寸 */
    resize(width: number, height: number): void
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
    /** 余额站点的 Usage 页请求打开:先 navigate 再 activate */
    usageOpen(cb: (e: { id: string; url: string }) => void): void
  }
  /** 主进程 → 鲸鱼渲染层事件 */
  onWhale: {
    cursor(cb: (p: WhaleCursorPoint) => void): void
    workarea(cb: (wa: Rect) => void): void
    command(cb: (cmd: WhaleCommand) => void): void
    unread(cb: (count: number) => void): void
  }
  /** 主进程 → 余额小窗事件(仅余额窗口会收到) */
  onBalance: {
    state(cb: (snapshot: BalanceSnapshot) => void): void
  }
}

/** 悬浮窗持久化状态(float-state.json)暴露给渲染层的部分 */
export interface FloatWindowState {
  activeProviderId: string | null
}

export interface PromptLibrary {
  prompts: Prompt[]
  categories: string[]
}
