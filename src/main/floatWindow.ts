import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { clampDragBounds, clampPoint, FLOAT_EXPANDED } from '@shared/floatLayout'
import type { FloatWindowState } from '@shared/api'
import { JsonStore } from './store/jsonStore'

interface PersistedFloatState {
  x: number | null
  y: number | null
  activeProviderId: string | null
}

const EMPTY: PersistedFloatState = { x: null, y: null, activeProviderId: null }

/** 渲染进程崩溃后自动重建窗口的最小间隔,防止崩溃循环拖垮整机 */
const RECREATE_GUARD_MS = 10_000

export interface FloatWindowDeps {
  /** 窗口惰性创建完成时回调(用于把视图管理器 attach 到该窗口) */
  onWindowCreated?: (win: BrowserWindow) => void
  /** 位置/尺寸变化(拖动防抖后或展开⇄折叠)回调 — 译文弹窗跟随用 */
  onMoved?: () => void
  /** 悬浮窗隐藏回调 — 译文弹窗随之隐藏 */
  onHide?: () => void
  /** 窗口重建前把站点视图从旧窗口摘下(留在缓存),避免随窗口一起销毁 */
  onDetachViews?: () => void
}

/**
 * 悬浮窗窗口控制器:无边框透明置顶小窗(360×620)。
 * 收起(压缩)形态由独立的鲸鱼窗口承担,本窗口只在展开时可见。
 * 位置持久化到 float-state.json(独立文件,避免与 ui-state.json 相互覆盖)。
 * 窗口常驻(隐藏不销毁),视图缓存随之保留;启动时以隐藏方式创建,保证
 * 站点视图加载与未读统计在鲸鱼形态下照常工作。
 */
export class FloatWindowController {
  private store = new JsonStore<PersistedFloatState>('float-state.json', EMPTY)
  private win: BrowserWindow | null = null
  private activeProviderId: string | null = null
  private savedX: number | null = null
  private savedY: number | null = null
  private moveTimer: ReturnType<typeof setTimeout> | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private lastRecreateAt = 0
  /** 期望窗口可见(ready-to-show 时据此决定是否自动显示,隐藏创建不闪窗) */
  private wantVisible = false

  constructor(private readonly deps: FloatWindowDeps = {}) {}

  /** 启动时读取持久化状态(窗口本身惰性创建) */
  async restore(): Promise<void> {
    const s = await this.store.load()
    this.activeProviderId = typeof s.activeProviderId === 'string' ? s.activeProviderId : null
    this.savedX = Number.isFinite(s.x) ? s.x : null
    this.savedY = Number.isFinite(s.y) ? s.y : null
  }

  getWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  isVisible(): boolean {
    const win = this.getWindow()
    return !!win && win.isVisible()
  }

  show(): void {
    this.wantVisible = true
    const win = this.getWindow()
    if (win && win.webContents.isCrashed()) {
      // 页面已崩溃(表现为白屏/透明),直接换新窗口
      this.recreate()
      return
    }
    const target = win ?? this.create()
    if (!target.isVisible()) {
      // Windows 上锁屏/全屏应用/驱动重置后 'floating' 置顶级别可能丢失,显示时重新断言
      target.setAlwaysOnTop(true, 'floating')
      target.show()
      target.focus()
      // 透明窗口久跑后 DWM 合成表面可能失效(整窗透明"消失"),强制重绘一次
      target.webContents.invalidate()
    }
  }

  hide(): void {
    this.wantVisible = false
    this.getWindow()?.hide()
    this.deps.onHide?.()
  }

  /** 启动时以隐藏方式创建窗口(渲染层保持存活:站点加载/未读统计/快速展开) */
  ensureCreated(): void {
    if (!this.getWindow()) this.create()
  }

  /** 在指定屏幕位置(如鲸鱼当前位置附近)显示悬浮窗 */
  showAt(point: { x: number; y: number }): void {
    const win = this.getWindow() ?? this.create()
    const b = win.getBounds()
    const area = screen.getDisplayMatching({ x: point.x, y: point.y, width: b.width, height: b.height })
      .workArea
    const p = clampPoint(point.x, point.y, b.width, b.height, area)
    if (p.x !== b.x || p.y !== b.y) {
      win.setBounds({ x: p.x, y: p.y, width: b.width, height: b.height })
      this.savedX = p.x
      this.savedY = p.y
      this.deps.onMoved?.()
      void this.persist()
    }
    this.show()
  }

  /**
   * 透明窗口自愈:锁屏/休眠唤醒/GPU 进程崩溃后,Windows 的 DWM 合成表面可能失效,
   * 表现为整窗透明不可见( isVisible() 仍为 true,托盘「显示/隐藏」第一击反而执行了隐藏)。
   * hide→show 强制重建合成表面,配合重新置顶与强制重绘;窗口未显示或已崩溃交由重建处理。
   */
  heal(): void {
    const win = this.getWindow()
    if (!win || !win.isVisible()) return
    if (win.webContents.isCrashed()) {
      this.recreateIfDue()
      return
    }
    win.setAlwaysOnTop(true, 'floating')
    win.hide()
    win.show()
    win.webContents.invalidate()
  }

  /** 显示器拓扑变化后把窗口夹回现存工作区(防止窗口留在已断开的显示器上不可见) */
  reclamp(): void {
    const win = this.getWindow()
    if (!win || !win.isVisible()) return
    const b = win.getBounds()
    const area = screen.getDisplayMatching(b).workArea
    const point = clampPoint(b.x, b.y, b.width, b.height, area)
    if (point.x !== b.x || point.y !== b.y) {
      win.setBounds({ x: point.x, y: point.y, width: b.width, height: b.height })
    }
  }

  getState(): FloatWindowState {
    return { activeProviderId: this.activeProviderId }
  }

  setActiveProvider(id: string): void {
    this.activeProviderId = id
    void this.persist()
  }

  /** 悬浮窗当前活动站点(提示词粘贴等跨窗口操作的目标) */
  getActiveProvider(): string | null {
    return this.activeProviderId
  }

  // ------------------------------------------------------------------

  /** 重建窗口但受崩溃循环保护(自愈事件路径用);不满足间隔要求时静默跳过 */
  private recreateIfDue(): void {
    const now = Date.now()
    if (now - this.lastRecreateAt < RECREATE_GUARD_MS) return
    this.lastRecreateAt = now
    this.recreate()
  }

  /** 销毁当前窗口并立即重建(渲染进程崩溃/表面失效);新页面 boot 后重新发布局挂载站点视图 */
  private recreate(): void {
    const old = this.getWindow()
    if (old) {
      const b = old.getBounds()
      this.savedX = b.x
      this.savedY = b.y
      this.deps.onDetachViews?.()
      old.destroy()
    }
    this.win = null
    this.show()
  }

  private create(): BrowserWindow {
    const size = FLOAT_EXPANDED
    const point = this.initialPoint(size.width, size.height)
    const win = new BrowserWindow({
      ...size,
      x: point.x,
      y: point.y,
      show: false,
      frame: false,
      transparent: true,
      // 透明窗口必须显式全透明背景;resizable:false 避免破坏 Windows 透明合成
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      title: 'ChatDeck 悬浮窗',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })
    // 'floating' 级别:压过普通应用窗口,但不盖系统托盘/输入法
    win.setAlwaysOnTop(true, 'floating')
    // 跟随虚拟桌面且不被全屏应用盖住(多桌面切换/全屏视频时胶囊不丢)
    win.setVisibleOnAllWorkspaces(true)
    // 拖动硬钳制:手动拖动落地前拦截(will-move),拖不进任务栏/屏幕外;
    // setBounds 触发的程序性移动不会走此事件,无递归
    win.on('will-move', (event, newBounds) => {
      const area = screen.getDisplayMatching(newBounds).workArea
      const point = clampDragBounds(newBounds, area)
      if (point.x !== newBounds.x || point.y !== newBounds.y) {
        event.preventDefault()
        win.setBounds({ x: point.x, y: point.y, width: newBounds.width, height: newBounds.height })
      }
    })
    // ready-to-show 后再显示,避免透明窗口在 Windows 上闪黑底;
    // 隐藏创建(ensureCreated)不自动显形,由 show() 的 wantVisible 驱动
    win.on('ready-to-show', () => {
      if (this.wantVisible) win.show()
    })
    win.on('move', () => this.schedulePositionSave())
    win.on('closed', () => {
      this.win = null
    })
    // 悬浮窗自身页面崩溃(白屏/透明) → 自动重建;受最小间隔保护防崩溃循环
    win.webContents.on('render-process-gone', () => {
      if (this.getWindow() !== win) return
      this.recreateIfDue()
    })
    if (!app.isPackaged) {
      win.webContents.on('before-input-event', (_e, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') {
          win.webContents.openDevTools({ mode: 'detach' })
        }
      })
    }
    void this.loadPage(win)
    this.win = win
    this.deps.onWindowCreated?.(win)
    return win
  }

  private async loadPage(win: BrowserWindow): Promise<void> {
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/float.html`)
    } else {
      await win.loadFile(join(__dirname, '../renderer/float.html'))
    }
  }

  private initialPoint(width: number, height: number): { x: number; y: number } {
    const area = screen.getPrimaryDisplay().workArea
    if (this.savedX !== null && this.savedY !== null) {
      return clampPoint(this.savedX, this.savedY, width, height, area)
    }
    // 无历史位置:默认落在工作区右下角
    return clampPoint(
      area.x + area.width - width - 32,
      area.y + area.height - height - 32,
      width,
      height,
      area
    )
  }

  private schedulePositionSave(): void {
    if (this.moveTimer) clearTimeout(this.moveTimer)
    this.moveTimer = setTimeout(() => {
      this.moveTimer = null
      const win = this.getWindow()
      if (!win) return
      // 拖动结束落盘前兜底钳制(will-move 已挡住手动拖动,此处只兜程序性/系统级偏移)
      const b = win.getBounds()
      const area = screen.getDisplayMatching(b).workArea
      const point = clampPoint(b.x, b.y, b.width, b.height, area)
      if (point.x !== b.x || point.y !== b.y) {
        win.setBounds({ x: point.x, y: point.y, width: b.width, height: b.height })
      }
      this.savedX = point.x
      this.savedY = point.y
      this.deps.onMoved?.()
      void this.persist()
    }, 400)
  }

  /** 串行化写入,避免并发原子写互踩临时文件 */
  private persist(): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(() =>
        this.store.save({
          x: this.savedX,
          y: this.savedY,
          activeProviderId: this.activeProviderId
        })
      )
      .catch(() => {})
    return this.writeQueue
  }
}
