/**
 * 账单窗口控制器——余额监控的明细窗,与胶囊/卡片小窗同风格(无边框透明卡片)。
 * 与 BalanceWindowController 的差别:不做位置记忆/尺寸自适应(固定尺寸,内容内滚动),
 * 关闭即销毁(临时明细窗,重建成本低);显隐只由「账单明细」入口驱动,不进托盘。
 */
import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { resourceFile } from '../store/jsonStore'

const SIZE = { width: 460, height: 620 } as const

export class BillingWindowController {
  private win: BrowserWindow | null = null

  getWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  show(): void {
    const win = this.getWindow() ?? this.create()
    // Windows 上锁屏/全屏应用后置顶级别可能丢失,显示时重新断言
    win.setAlwaysOnTop(true, 'floating')
    if (win.isVisible()) win.focus()
    else if (!win.webContents.isLoading()) win.show()
  }

  close(): void {
    const win = this.getWindow()
    if (win) win.destroy()
    this.win = null
  }

  destroy(): void {
    this.close()
  }

  private create(): BrowserWindow {
    const wa = screen.getPrimaryDisplay().workArea
    const win = new BrowserWindow({
      width: SIZE.width,
      height: SIZE.height,
      x: wa.x + Math.round((wa.width - SIZE.width) / 2),
      y: wa.y + 72,
      frame: false,
      transparent: true,
      thickFrame: false,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      title: 'ChatDeck 账单',
      icon: resourceFile('balance-icon.png'),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    })
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    // 首帧就绪后显示,避免透明窗口在 Windows 上闪黑底
    win.once('ready-to-show', () => win.show())
    win.on('closed', () => {
      this.win = null
    })

    if (!app.isPackaged) {
      win.webContents.on('console-message', (_e, level, message, sourceId) => {
        if (level >= 3) console.error(`[billing] ${message} (${sourceId})`)
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
      await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/billing.html`)
    } else {
      await win.loadFile(join(__dirname, '../renderer/billing.html'))
    }
  }
}
