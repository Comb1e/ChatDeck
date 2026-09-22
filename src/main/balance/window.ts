/**
 * 余额小窗控制器——窗口行为移植自 token-balance src/main/main.js：
 * 无边框透明胶囊/卡片、不抢焦点（showInactive）、位置记忆 + 屏幕内硬约束、
 * 反 Aero Snap（外部改尺寸立即拉回）、按渲染层内容自适应尺寸。
 * 与 ChatDeck 的差别：窗口层级统一为 'floating'（原为 screen-saver）、
 * 只由托盘开关控制显隐、显隐状态持久化后下次启动恢复。
 */
import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { IPC } from '@shared/ipc'
import type { BalanceSnapshot } from '@shared/balance'
import { resourceFile } from '../store/jsonStore'
import type { BalanceStore } from './store'

/** 收起态胶囊初始尺寸（与渲染层 SIZE.collapsedWindow 对应） */
const INITIAL_SIZE = { width: 196, height: 56 } as const

export interface BalanceWindowDeps {
  store: BalanceStore
  /** 显隐变化回调（托盘菜单勾选态同步用） */
  onVisibilityChanged?: (visible: boolean) => void
}

export class BalanceWindowController {
  private win: BrowserWindow | null = null
  private intendedSize: { width: number; height: number } = { ...INITIAL_SIZE }
  private wantVisible = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: BalanceWindowDeps) {}

  getWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  isVisible(): boolean {
    const win = this.getWindow()
    return !!win && win.isVisible()
  }

  /** 惰性创建并显示（不抢焦点）；下次启动按持久化的 window.visible 恢复 */
  show(): void {
    this.wantVisible = true
    this.deps.store.setWindowVisible(true)
    const win = this.getWindow() ?? this.create()
    // Windows 上锁屏/全屏应用后置顶级别可能丢失，显示时重新断言
    win.setAlwaysOnTop(true, 'floating')
    if (!win.webContents.isLoading()) win.showInactive()
    this.deps.onVisibilityChanged?.(true)
  }

  hide(): void {
    this.wantVisible = false
    this.deps.store.setWindowVisible(false)
    this.getWindow()?.hide()
    this.deps.onVisibilityChanged?.(false)
  }

  /** 托盘开关：返回切换后的可见状态 */
  toggle(): boolean {
    if (this.isVisible()) {
      this.hide()
      return false
    }
    this.show()
    return true
  }

  /** 渲染层按内容测量后请求的尺寸（原 window:resize 通道） */
  setContentSize(width: number, height: number): void {
    const win = this.getWindow()
    if (!win) return
    const wa = screen.getDisplayMatching(win.getBounds()).workArea
    const w = Math.max(120, Math.min(Math.round(width), wa.width))
    const h = Math.max(40, Math.min(Math.round(height), wa.height))
    this.intendedSize = { width: w, height: h }
    const [x, y] = win.getPosition()
    // 展开时把整个窗口放进工作区,避免卡片超出屏幕
    const pos = this.containInDisplay(x, y, w, h)
    win.setBounds({ x: pos.x, y: pos.y, width: w, height: h })
  }

  /** 调度器状态 → 渲染层 */
  pushState(snapshot: BalanceSnapshot): void {
    const win = this.getWindow()
    if (win) win.webContents.send(IPC.EvBalanceState, snapshot)
  }

  destroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const win = this.getWindow()
    if (win) win.destroy()
    this.win = null
  }

  // ------------------------------------------------------------------

  /** 把窗口完整约束在所在显示器工作区内：四个边缘都不得越界（拖不出屏幕） */
  private containInDisplay(
    x: number,
    y: number,
    width: number,
    height: number
  ): { x: number; y: number } {
    const wa = screen.getDisplayMatching({ x, y, width, height }).workArea
    return {
      x: Math.round(Math.max(wa.x, Math.min(x, wa.x + wa.width - width))),
      y: Math.round(Math.max(wa.y, Math.min(y, wa.y + wa.height - height)))
    }
  }

  private defaultPosition(width: number, height: number): { x: number; y: number } {
    const wa = screen.getPrimaryDisplay().workArea
    const saved = this.deps.store.load().window
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      return this.containInDisplay(saved.x as number, saved.y as number, width, height)
    }
    return { x: wa.x + wa.width - width - 24, y: wa.y + 96 }
  }

  private create(): BrowserWindow {
    const { x, y } = this.defaultPosition(INITIAL_SIZE.width, INITIAL_SIZE.height)
    const win = new BrowserWindow({
      width: INITIAL_SIZE.width,
      height: INITIAL_SIZE.height,
      x,
      y,
      frame: false,
      transparent: true,
      thickFrame: false,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      title: 'ChatDeck 余额',
      icon: resourceFile('balance-icon.png'),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })
    // 'floating' 级别：压过普通应用窗口，但不盖系统托盘/输入法
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // 首帧就绪后显示，避免透明窗口在 Windows 上闪黑底
    win.once('ready-to-show', () => {
      if (this.wantVisible) win.showInactive()
    })

    // 位置约束:拖动过程中('move')立即把窗口约束回屏幕内 —— 只挂在 'moved' 上不够可靠
    // (程序化移动等场景不触发 'moved'),窗口一旦移出就抓不回来。
    // 每次只做一次纠正;setPosition 会再次触发 'move',此时已完整在屏幕内,自然收敛。
    let clamping = false
    const ensureVisible = (): void => {
      if (clamping || !this.getWindow()) return
      const b = win.getBounds()
      const p = this.containInDisplay(b.x, b.y, b.width, b.height)
      if (p.x !== b.x || p.y !== b.y) {
        clamping = true
        win.setPosition(p.x, p.y)
        clamping = false
      }
    }
    win.on('move', ensureVisible)

    // 拖动结束后:再校正一次并记忆位置
    win.on('moved', () => {
      ensureVisible()
      if (this.saveTimer) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null
        if (!this.getWindow()) return
        ensureVisible()
        const [px, py] = win.getPosition()
        this.deps.store.patchWindow({ x: px, y: py })
      }, 400)
    })

    // 系统强改尺寸时(Aero Snap / 最大化)恢复为内容尺寸,
    // 否则会留下一个巨大的透明窗口挡住底层点击
    win.on('resize', () => {
      if (!this.getWindow()) return
      const b = win.getBounds()
      if (b.width === this.intendedSize.width && b.height === this.intendedSize.height) return
      const p = this.containInDisplay(b.x, b.y, this.intendedSize.width, this.intendedSize.height)
      win.setBounds({ x: p.x, y: p.y, width: this.intendedSize.width, height: this.intendedSize.height })
    })

    win.on('closed', () => {
      this.win = null
    })

    if (!app.isPackaged) {
      // 只转发渲染层报错,便于诊断 preload/IPC 问题
      win.webContents.on('console-message', (_e, level, message, sourceId) => {
        if (level >= 3) console.error(`[balance] ${message} (${sourceId})`)
      })
      win.webContents.on('before-input-event', (_e, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') {
          win.webContents.openDevTools({ mode: 'detach' })
        }
      })
    }

    void this.loadPage(win)
    this.win = win
    return win
  }

  private async loadPage(win: BrowserWindow): Promise<void> {
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/balance.html`)
    } else {
      await win.loadFile(join(__dirname, '../renderer/balance.html'))
    }
  }
}
