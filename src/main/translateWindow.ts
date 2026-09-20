import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { IPC } from '@shared/ipc'
import { TRANSLATE_POPUP, translatePopupRect } from '@shared/translate'
import type { TranslatePopupState } from '@shared/translate'
import type { Rect } from '@shared/types'

export interface TranslatePopupDeps {
  /** 取悬浮窗当前 bounds(悬浮窗未创建/已销毁时为 null) */
  getFloatBounds: () => Rect | null
}

/** 无交互时的自动隐藏时长;用户点击弹窗(获得焦点)后取消,失焦改为重排计时 */
const AUTO_HIDE_MS = 10_000
/** 隐藏后的闲置销毁时长:销毁释放整个渲染进程,下次 show() 重建(lastState 在主进程不丢失) */
const IDLE_DESTROY_MS = 10 * 60_000

/**
 * 译文弹窗:依附悬浮窗正上方的小窗,平时隐藏,不持久化位置。
 * showInactive 显示不抢焦点(保持划词处应用在前台);悬浮窗移动时跟随,隐藏时随之隐藏。
 */
export class TranslatePopupController {
  private win: BrowserWindow | null = null
  private lastState: TranslatePopupState | null = null
  private hideTimer: ReturnType<typeof setTimeout> | null = null
  private destroyTimer: ReturnType<typeof setTimeout> | null = null
  /** 首次创建时页面未就绪,ready-to-show 后再补显示(防 Windows 透明窗闪黑底) */
  private pendingShow = false

  constructor(private readonly deps: TranslatePopupDeps) {}

  getWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  /** 显示并按悬浮窗当前位置定位;悬浮窗不存在时静默忽略 */
  show(): void {
    if (!this.deps.getFloatBounds()) return
    const win = this.getWindow()
    if (win) {
      this.positionAndShow(win)
    } else {
      this.pendingShow = true
      this.create()
    }
  }

  hide(): void {
    this.cancelAutoHide()
    this.getWindow()?.hide()
    this.scheduleIdleDestroy()
  }

  repositionIfVisible(): void {
    const win = this.getWindow()
    if (!win || !win.isVisible()) return
    const bounds = this.deps.getFloatBounds()
    if (!bounds) return
    const area = screen.getDisplayMatching(bounds).workArea
    const point = translatePopupRect(bounds, area)
    win.setBounds({ x: point.x, y: point.y, width: TRANSLATE_POPUP.width, height: TRANSLATE_POPUP.height })
  }

  getLastState(): TranslatePopupState | null {
    return this.lastState
  }

  /** 推送状态;窗口尚未就绪时仅缓存,由渲染层 getLast() 兜底拉取 */
  sendState(state: TranslatePopupState): void {
    this.lastState = state
    const win = this.getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.EvTranslateResult, state)
  }

  private positionAndShow(win: BrowserWindow): void {
    this.cancelIdleDestroy()
    const bounds = this.deps.getFloatBounds()
    if (!bounds) return
    const area = screen.getDisplayMatching(bounds).workArea
    const point = translatePopupRect(bounds, area)
    win.setBounds({ x: point.x, y: point.y, width: TRANSLATE_POPUP.width, height: TRANSLATE_POPUP.height })
    win.showInactive()
    this.scheduleAutoHide()
  }

  private scheduleAutoHide(): void {
    this.cancelAutoHide()
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      this.hide()
    }, AUTO_HIDE_MS)
  }

  private cancelAutoHide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
  }

  private scheduleIdleDestroy(): void {
    this.cancelIdleDestroy()
    this.destroyTimer = setTimeout(() => {
      this.destroyTimer = null
      const win = this.getWindow()
      if (win && !win.isVisible()) {
        win.destroy()
        this.win = null
      }
    }, IDLE_DESTROY_MS)
  }

  private cancelIdleDestroy(): void {
    if (this.destroyTimer) {
      clearTimeout(this.destroyTimer)
      this.destroyTimer = null
    }
  }

  private create(): BrowserWindow {
    const win = new BrowserWindow({
      ...TRANSLATE_POPUP,
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
      title: 'ChatDeck 翻译',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })
    // 'floating' 级别:与悬浮窗同级置顶,压过普通应用但不盖系统托盘/输入法
    win.setAlwaysOnTop(true, 'floating')
    win.on('ready-to-show', () => {
      if (this.pendingShow) {
        this.pendingShow = false
        this.positionAndShow(win)
      }
    })
    // 聚焦(如点击弹窗复制)取消自动隐藏;失焦不立即隐藏——原生 select
    // 下拉等子菜单会短暂夺走焦点,直接隐藏会让方向选择无法使用,改为重排计时。
    // 已隐藏窗口的 blur 不再排程,避免 hide→blur→hide 的空转涟漪
    win.on('focus', () => this.cancelAutoHide())
    win.on('blur', () => {
      if (win.isVisible()) this.scheduleAutoHide()
    })
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
    return win
  }

  private async loadPage(win: BrowserWindow): Promise<void> {
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/translate.html`)
    } else {
      await win.loadFile(join(__dirname, '../renderer/translate.html'))
    }
  }
}
