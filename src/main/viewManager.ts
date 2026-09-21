import { join } from 'node:path'
import { app, BrowserWindow, session, shell, WebContentsView } from 'electron'
import { effectiveAutoSleepMinutes } from '@shared/types'
import type { PaneLayoutEntry, Provider, ViewLoadState } from '@shared/types'
import { canReload, shouldSleepNow, viewTransition, type ViewEvent, type ViewState } from '@shared/viewState'

interface ManagedView {
  provider: Provider
  view: WebContentsView
  state: ViewState
  /** 面向渲染层的粗粒度状态 */
  reported: ViewLoadState
  /** 最近一次确认可见的时刻；休眠扫描据此计算后台时长 */
  lastVisibleAt: number
  /** 是否以非零矩形挂载在宿主窗口上（零矩形=悬浮窗折叠时的隐藏挂载） */
  mountedNonzero: boolean
}

export interface ViewManagerHooks {
  onTitleChanged(id: string, title: string): void
  onActiveChanged(id: string): void
  onLoadStateChanged(id: string, state: ViewLoadState): void
}

/** 桌面 UA(主进程为新建厂商选 UA 时用,如余额站点的 Usage 页) */
export const DEFAULT_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
/** 窄窗口场景(悬浮窗)的移动端 UA:站点给出适配小屏的布局 */
export const MOBILE_UA = `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Mobile Safari/537.36`

/**
 * 站点视图管理器：每个厂商一个 WebContentsView，独立 persist partition。
 * 生命周期状态转移全部经由 @shared/viewState 的纯状态机，避免隐式状态散落。
 * 同名 partition 即同一 session——桌面版与悬浮窗各持一个实例即可共享登录态。
 */
export class ViewManager {
  private views = new Map<string, ManagedView>()
  private win: BrowserWindow | null = null
  private activeId: string | null = null
  /** 最近一次 setLayout 的布局快照,窗口重新显示时用于重建被休眠销毁的视图 */
  private lastLayout: PaneLayoutEntry[] | null = null
  private hooks: ViewManagerHooks = {
    onTitleChanged: () => {},
    onActiveChanged: () => {},
    onLoadStateChanged: () => {}
  }

  /**
   * @param viewUserAgent 视图级 UA 覆盖(如悬浮窗的移动端 UA)。
   *   只作用于本管理器创建的 webContents,不写 session,避免影响其他窗口的同分区视图。
   */
  constructor(private readonly viewUserAgent?: string) {}

  hook(hooks: ViewManagerHooks): void {
    this.hooks = hooks
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id)
  }

  attachWindow(win: BrowserWindow): void {
    this.win = win
    // 窗口隐藏期间后台视图可能已被休眠销毁,重新显示时按最近一次布局重建缺失的视图
    win.on('show', () => this.remount())
    win.on('restore', () => this.remount())
  }

  /** 应用布局：出现在 entries 中的视图被挂载并定位，其余从窗口移除（保留缓存） */
  setLayout(entries: PaneLayoutEntry[]): void {
    if (!this.win) return
    this.lastLayout = entries
    // 渲染层页面坐标即 contentView 子视图坐标（二者同以内容区为原点），直接使用
    const wanted = new Set<string>()
    for (const entry of entries) {
      if (wanted.has(entry.id)) continue // 防御：同一站点不能出现在两个窗格
      wanted.add(entry.id)
      const mv = this.ensureView(entry.id)
      if (!mv) continue
      if (mv.state === 'idle') this.dispatch(mv, { type: 'attach' })
      this.win.contentView.addChildView(mv.view)
      mv.view.setBounds(entry.rect)
      mv.mountedNonzero = entry.rect.width > 0 && entry.rect.height > 0
      if (mv.mountedNonzero) mv.lastVisibleAt = Date.now()
    }
    for (const [id, mv] of this.views) {
      if (!wanted.has(id)) {
        this.win.contentView.removeChildView(mv.view)
        mv.mountedNonzero = false
        this.dispatch(mv, { type: 'detach' })
      }
    }
  }

  setActive(id: string | null): void {
    this.activeId = id
    if (id) {
      const mv = this.views.get(id)
      mv?.view.webContents.focus()
    }
  }

  getActiveId(): string | null {
    return this.activeId
  }

  reload(id: string): void {
    const mv = this.views.get(id)
    if (!mv) {
      // 不在缓存（从未打开或已清数据）：重新创建并直接加载站点
      this.ensureView(id, true)
      return
    }
    if (!canReload(mv.state)) return
    this.dispatch(mv, { type: 'reload' })
    if (mv.state === 'loading') {
      mv.reported = 'loading'
      this.hooks.onLoadStateChanged(id, mv.reported)
      mv.view.webContents.loadURL(mv.provider.url).catch(() => {
        /* 失败由 did-fail-load 统一处理 */
      })
    }
  }

  /**
   * 把已注册站点的视图导航到指定地址（余额站点的 Usage 页等）。
   * 无视图则按 provider 创建并直载目标地址；有视图按状态机走合法转移后换页。
   */
  navigate(id: string, url: string): void {
    const existing = this.views.get(id)
    if (!existing) {
      const provider = this.providerOf(id)
      if (!provider) return
      this.createView(provider, url) // attach → loading,直载目标地址
      return
    }
    if (existing.state === 'idle') this.dispatch(existing, { type: 'attach' })
    else if (existing.state === 'failed' || existing.state === 'crashed') {
      this.dispatch(existing, { type: 'reload' })
    }
    existing.reported = 'loading'
    this.hooks.onLoadStateChanged(id, existing.reported)
    void existing.view.webContents.loadURL(url).catch(() => {
      /* 失败由 did-fail-load 统一处理 */
    })
  }

  back(id: string): void {
    const wc = this.views.get(id)?.view.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  forward(id: string): void {
    const wc = this.views.get(id)?.view.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  openExternal(id: string): void {
    const url = this.views.get(id)?.provider.url
    if (url) void shell.openExternal(url)
  }

  /**
   * 粘贴到站点输入框：先聚焦视图再执行 paste。
   * 渲染层已提前把文本写入剪贴板；若站点输入框没有焦点，粘贴会静默失败，
   * 用户仍可用 Ctrl+V 手动粘贴（剪贴板内容一致）。
   */
  paste(id: string): void {
    const mv = this.views.get(id)
    if (!mv) return
    mv.view.webContents.focus()
    setTimeout(() => {
      try {
        mv.view.webContents.paste()
      } catch {
        /* 视图可能刚被销毁 */
      }
    }, 60)
  }

  /** 清除站点登录数据并销毁其视图（分区存储由 ProviderStore.clearData 统一清理） */
  async clearData(id: string): Promise<void> {
    this.discardView(id)
  }

  /** 删除站点：销毁视图并忘记注册信息（分区存储由 ipc 层调 ProviderStore.clearData） */
  discardProvider(id: string): void {
    this.discardView(id, true)
  }

  /**
   * 后台休眠扫描：可见视图刷新时间戳；不可见超过该站点休眠阈值的视图直接销毁
   * （渲染进程退出释放内存），切回时由 ensureView 重建，登录态保留在 persist 分区。
   */
  sweepSleep(now = Date.now()): void {
    for (const [id, mv] of this.views) {
      const provider = this.providers.get(id) ?? mv.provider
      const visible =
        mv.mountedNonzero &&
        this.win !== null &&
        !this.win.isDestroyed() &&
        this.win.isVisible() &&
        !this.win.isMinimized()
      if (visible) {
        mv.lastVisibleAt = now
        continue
      }
      if (shouldSleepNow(visible, mv.lastVisibleAt, now, effectiveAutoSleepMinutes(provider) * 60_000)) {
        this.discardView(id)
      }
    }
  }

  /** 从窗口摘除并销毁视图；延迟 close 避免并发销毁告警 */
  private discardView(id: string, forgetProvider = false): void {
    const mv = this.views.get(id)
    if (!mv) return
    this.views.delete(id)
    if (forgetProvider) this.providers.delete(id)
    this.win?.contentView.removeChildView(mv.view)
    setTimeout(() => {
      try {
        mv.view.webContents.close()
      } catch {
        /* already closed */
      }
    }, 100)
    mv.reported = 'sleeping'
    this.hooks.onLoadStateChanged(id, mv.reported)
  }

  /** 窗口重新显示：按最近一次布局重建被休眠销毁的视图（幂等，仍在缓存的视图原样复用） */
  private remount(): void {
    if (this.lastLayout) this.setLayout(this.lastLayout)
  }

  destroyAll(): void {
    for (const [, mv] of this.views) {
      try {
        mv.view.webContents.close()
      } catch {
        /* ignore */
      }
    }
    this.views.clear()
  }

  // ------------------------------------------------------------------

  private ensureView(providerId: string, loadSite = false): ManagedView | null {
    const existing = this.views.get(providerId)
    if (existing) return existing
    const provider = this.providerOf(providerId)
    if (!provider) return null
    return this.createView(provider, loadSite ? provider.url : undefined)
  }

  private providerOf(id: string): Provider | null {
    // providerStore 通过回调注入？直接由 ipc 层保证 provider 存在；
    // 这里用惰性注册：ipc 在 setLayout 前调用 registerProvider。
    return this.providers.get(id) ?? null
  }

  private providers = new Map<string, Provider>()

  registerProvider(provider: Provider): void {
    this.providers.set(provider.id, provider)
  }

  private createView(provider: Provider, initialUrl?: string): ManagedView {
    const ses = session.fromPartition(`persist:provider-${provider.id}`)
    ses.setUserAgent(provider.userAgent || DEFAULT_UA)
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

    const view = new WebContentsView({
      webPreferences: {
        partition: `persist:provider-${provider.id}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 站点输入校验由站点自身负责;关掉 Chromium 拼写检查省词典加载与内存
        spellcheck: false,
        preload: this.errorPreloadPath()
      }
    })
    view.setBackgroundColor('#FFFFFF')
    // 厂商显式配置的 UA 优先;否则应用管理器级覆盖(悬浮窗移动端 UA)
    if (this.viewUserAgent && !provider.userAgent) {
      view.webContents.setUserAgent(this.viewUserAgent)
    }

    const mv: ManagedView = {
      provider,
      view,
      state: 'idle',
      reported: 'loading',
      lastVisibleAt: Date.now(),
      mountedNonzero: false
    }
    this.views.set(provider.id, mv)

    const wc = view.webContents
    wc.on('page-title-updated', (_e, title) => this.hooks.onTitleChanged(provider.id, title))
    wc.on('focus', () => {
      this.activeId = provider.id
      this.hooks.onActiveChanged(provider.id)
    })
    wc.on('did-finish-load', () => {
      // 错误页加载完成不算站点 ready
      if (this.isErrorPage(wc.getURL())) return
      this.dispatch(mv, { type: 'load-success' })
      mv.reported = 'ready'
      this.hooks.onLoadStateChanged(provider.id, mv.reported)
    })
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return // -3 = ABORTED，多为页面自身跳转
      if (this.isErrorPage(url)) return
      this.dispatch(mv, { type: 'load-failed' })
      mv.reported = 'failed'
      this.hooks.onLoadStateChanged(provider.id, mv.reported)
      void wc.loadFile(this.errorPagePath(), {
        query: { p: provider.id, code: String(code), desc: encodeURIComponent(desc) }
      })
    })
    wc.on('render-process-gone', () => {
      // 视图已休眠/删除移出缓存时不上报（销毁瞬间可能触发本事件）
      if (this.views.get(provider.id) !== mv) return
      this.dispatch(mv, { type: 'crash' })
      mv.reported = 'crashed'
      this.hooks.onLoadStateChanged(provider.id, mv.reported)
    })
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    if (!app.isPackaged) {
      wc.on('before-input-event', (_e, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') wc.openDevTools({ mode: 'detach' })
      })
    }

    if (initialUrl) {
      this.dispatch(mv, { type: 'attach' })
      mv.reported = 'loading'
      this.hooks.onLoadStateChanged(provider.id, mv.reported)
      void wc.loadURL(initialUrl).catch(() => {
        /* 失败由 did-fail-load 统一处理 */
      })
    } else {
      // 先放一个空页占位，真实站点由 attach 流程加载
      mv.reported = 'loading'
      void wc.loadURL('about:blank')
    }
    return mv
  }

  /** setLayout 挂载时若视图从未加载过站点（about:blank 占位），则真正加载站点 URL */
  private dispatch(mv: ManagedView, event: ViewEvent): void {
    mv.state = viewTransition(mv.state, event)
    if (event.type === 'attach' && mv.state === 'loading') {
      mv.reported = 'loading'
      this.hooks.onLoadStateChanged(mv.provider.id, mv.reported)
      void mv.view.webContents.loadURL(mv.provider.url).catch(() => {
        /* 失败由 did-fail-load 统一处理 */
      })
    }
  }

  private isErrorPage(url: string): boolean {
    return url.startsWith('file://') && url.includes('error.html')
  }

  private errorPagePath(): string {
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    return join(base, 'error.html')
  }

  private errorPreloadPath(): string {
    return join(__dirname, '../preload/error.js')
  }

  /** 供 IPC 层查询视图状态 */
  getReportedState(id: string): ViewLoadState | null {
    return this.views.get(id)?.reported ?? null
  }
}
