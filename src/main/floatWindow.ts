import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { clampPoint, FLOAT_EXPANDED, FLOAT_PILL } from '@shared/floatLayout'
import type { FloatWindowState } from '@shared/api'
import { JsonStore } from './store/jsonStore'

interface PersistedFloatState {
  x: number | null
  y: number | null
  expanded: boolean
  activeProviderId: string | null
}

const EMPTY: PersistedFloatState = { x: null, y: null, expanded: true, activeProviderId: null }

export interface FloatWindowDeps {
  /** 窗口惰性创建完成时回调(用于把视图管理器 attach 到该窗口) */
  onWindowCreated?: (win: BrowserWindow) => void
}

/**
 * 悬浮窗窗口控制器:无边框透明置顶小窗,展开 ⇄ 折叠(药丸)。
 * 位置与展开态持久化到 float-state.json(独立文件,避免与 ui-state.json 相互覆盖)。
 * 窗口首次唤起时惰性创建,之后常驻(隐藏不销毁),视图缓存随之保留。
 */
export class FloatWindowController {
  private store = new JsonStore<PersistedFloatState>('float-state.json', EMPTY)
  private win: BrowserWindow | null = null
  private expanded = true
  private activeProviderId: string | null = null
  private savedX: number | null = null
  private savedY: number | null = null
  private moveTimer: ReturnType<typeof setTimeout> | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly deps: FloatWindowDeps = {}) {}

  /** 启动时读取持久化状态(窗口本身惰性创建) */
  async restore(): Promise<void> {
    const s = await this.store.load()
    this.expanded = s.expanded !== false
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

  getExpanded(): boolean {
    return this.expanded
  }

  /** 托盘/主窗口侧:显示或隐藏悬浮窗 */
  toggle(): boolean {
    if (this.isVisible()) {
      this.hide()
      return false
    }
    this.show()
    return true
  }

  show(): void {
    const win = this.getWindow() ?? this.create()
    win.show()
    win.focus()
  }

  hide(): void {
    this.getWindow()?.hide()
  }

  /** 展开 ⇄ 折叠:窗口尺寸切换,保持左上角并夹在屏幕工作区内 */
  async setExpanded(expanded: boolean): Promise<void> {
    this.expanded = expanded
    const win = this.getWindow() ?? this.create()
    const size = expanded ? FLOAT_EXPANDED : FLOAT_PILL
    const bounds = win.getBounds()
    const area = screen.getDisplayMatching({
      x: bounds.x,
      y: bounds.y,
      width: size.width,
      height: size.height
    }).workArea
    const point = clampPoint(bounds.x, bounds.y, size.width, size.height, area)
    win.setBounds({ x: point.x, y: point.y, width: size.width, height: size.height })
    this.savedX = point.x
    this.savedY = point.y
    await this.persist()
  }

  getState(): FloatWindowState {
    return { expanded: this.expanded, activeProviderId: this.activeProviderId }
  }

  setActiveProvider(id: string): void {
    this.activeProviderId = id
    void this.persist()
  }

  // ------------------------------------------------------------------

  private create(): BrowserWindow {
    const size = this.expanded ? FLOAT_EXPANDED : FLOAT_PILL
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
    // ready-to-show 后再显示,避免透明窗口在 Windows 上闪黑底
    win.on('ready-to-show', () => win.show())
    win.on('move', () => this.schedulePositionSave())
    win.on('closed', () => {
      this.win = null
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
      const b = win.getBounds()
      this.savedX = b.x
      this.savedY = b.y
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
          expanded: this.expanded,
          activeProviderId: this.activeProviderId
        })
      )
      .catch(() => {})
    return this.writeQueue
  }
}
