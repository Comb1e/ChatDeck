import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

/** 设置窗口尺寸(DIP);内容为窄栏面板,无需大窗 */
const SETTINGS_SIZE = { width: 880, height: 660 } as const
const SETTINGS_MIN = { width: 720, height: 520 } as const

/**
 * 设置窗口控制器:普通有框窗口,承载设置/提示词库面板(复用主渲染层组件)。
 * 惰性创建,关闭即销毁;悬浮窗齿轮与托盘「设置」共用同一实例,已开则聚焦。
 */
export class SettingsWindowController {
  private win: BrowserWindow | null = null

  getWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  show(): void {
    const win = this.getWindow()
    if (win) {
      win.show()
      win.focus()
      return
    }
    this.create()
  }

  private create(): void {
    const win = new BrowserWindow({
      ...SETTINGS_SIZE,
      minWidth: SETTINGS_MIN.width,
      minHeight: SETTINGS_MIN.height,
      show: false,
      backgroundColor: '#FAF9F5',
      title: 'ChatDeck 设置',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })
    win.on('ready-to-show', () => win.show())
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
  }

  private async loadPage(win: BrowserWindow): Promise<void> {
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`)
    } else {
      await win.loadFile(join(__dirname, '../renderer/settings.html'))
    }
  }
}
