import { join } from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import { performance } from 'node:perf_hooks'
import { IPC } from '@shared/ipc'
import { WHALE_CONFIG } from '@shared/whaleConfig'
import type { Rect } from '@shared/types'

/**
 * 鲸鱼窗口(悬浮窗压缩形态)控制器——窗口规格与 whale-pet 保持一致:
 * 透明无边框窗口覆盖当前显示器工作区,鲸鱼完全在 Chromium 内游动(原生窗口不动);
 * 默认鼠标穿透,渲染层检测到悬停后才开启交互(setIgnoreMouseEvents forward)。
 * 渲染层初始化完成(whale:ready)后再显示,避免闪空。
 */
export class WhaleWindowController {
  constructor(private onRendererGone: () => void = () => {}) {}

  ensureCreated(): void { if (!this.getWindow()) this.create() }
  private win: BrowserWindow | null = null
  private workarea: Rect | null = null
  private cursorTimer: ReturnType<typeof setInterval> | null = null
  private readonly lastCursor = { x: -1, y: -1 }
  private booted = false // 渲染层已就绪,此后 show() 可直接显形
  private wanted = false // 曾被请求显示(首显前缓存请求)
  private unreadCount = 0

  getWindow(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null
  }

  isVisible(): boolean {
    const win = this.getWindow()
    return !!win && win.isVisible()
  }

  currentWorkarea(): Rect {
    return this.workarea ?? screen.getPrimaryDisplay().workArea
  }

  /** 展开悬浮窗等外部入口:显示鲸鱼(压缩形态) */
  show(): void {
    this.wanted = true
    const win = this.getWindow()
    if (!win) {
      this.create()
      return
    }
    if (win.webContents.isCrashed()) {
      this.recreate()
      return
    }
    if (this.booted) this.reveal()
  }

  hide(): void {
    this.wanted = false
    this.getWindow()?.hide()
  }

  /** 渲染层初始化完成(WhaleReady IPC)后显形 */
  handleReady(): void {
    this.booted = true
    this.sendUnread()
    if (this.wanted) this.reveal()
  }

  setInteractive(on: boolean): void {
    const win = this.getWindow()
    if (!win) return
    win.setIgnoreMouseEvents(!on, { forward: true })
  }

  /** 主进程 → 鲸鱼:光标跟随/工作区/行为命令/未读数 */
  sendSurfaceAt(pt: { x: number; y: number }): void {
    const win = this.getWindow()
    if (win) win.webContents.send(IPC.EvWhaleCommand, { type: 'surface', x: pt.x, y: pt.y })
  }

  sendJumpDive(): void {
    const win = this.getWindow()
    if (win) win.webContents.send(IPC.EvWhaleCommand, { type: 'jump-dive' })
  }

  setUnreadCount(n: number): void {
    this.unreadCount = Math.max(0, Math.round(n))
    this.sendUnread()
  }

  /** 鲸鱼世界坐标(工作区系)→ 屏幕坐标 */
  screenFromWorld(p: { x: number; y: number }): { x: number; y: number } {
    const area = this.currentWorkarea()
    return { x: area.x + p.x, y: area.y + p.y }
  }

  /** 跟随当前显示器；原显示器移除时选择仍然存在的显示器。 */
  syncWorkarea(): void {
    const wa = this.workarea ? screen.getDisplayMatching(this.workarea).workArea : screen.getPrimaryDisplay().workArea
    this.setWorkarea(wa)
  }

  setWorkarea(wa: Rect): void {
    this.workarea = wa
    const win = this.getWindow()
    if (!win) return
    const bounds = win.getBounds()
    if (
      bounds.x !== wa.x ||
      bounds.y !== wa.y ||
      bounds.width !== wa.width ||
      bounds.height !== wa.height
    )
      win.setBounds(wa)
    win.webContents.send(IPC.EvWhaleWorkarea, wa)
  }

  /** 透明窗口自愈(与悬浮窗同款:DWM 合成表面失效后 hide→show 强制重建) */
  heal(): void {
    const win = this.getWindow()
    if (!win || !win.isVisible()) return
    if (win.webContents.isCrashed()) {
      this.recreate()
      return
    }
    win.setAlwaysOnTop(true, 'floating')
    win.hide()
    win.show()
    win.webContents.invalidate()
  }

  /**
   * 强制整窗重绘(窗口已稳定可见时安全):透明窗口上抗锯齿边缘列可能残留在
   * DWM 合成面(收起落定后桌宠旁出现 1px 蓝线);重绘只替换合成面内容。
   * 与 heal() 的 hide→show 不同,这里不重建表面,不会闪透明空帧。
   */
  repaint(): void {
    const win = this.getWindow()
    if (win && win.isVisible() && !win.webContents.isCrashed()) win.webContents.invalidate()
  }

  destroy(): void {
    if (this.cursorTimer) {
      clearInterval(this.cursorTimer)
      this.cursorTimer = null
    }
    this.getWindow()?.destroy()
    this.win = null
  }

  // ------------------------------------------------------------------

  private reveal(): void {
    const win = this.getWindow()
    if (!win) return
    this.syncWorkarea()
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true)
    // 悬浮窗形态期间本窗口保持可见(隐藏后 re-show 的 DWM 合成面要数百毫秒才恢复呈现,
    // covered 隐藏悬浮窗时屏幕上就是空洞=收起闪烁),但悬浮窗 show() 会把它压到下面;
    // 换形必须回到悬浮窗上方,否则快照被真实 UI 挡住,covered 后暴露的是刚解除遮挡、
    // 合成面尚未提升的空窗期——同样是收起闪烁。可见时仅补一次置顶。
    if (win.isVisible()) {
      win.moveTop()
      return
    }
    // 全屏透明覆盖层不该激活:收起时悬浮窗正持有焦点(用户刚点过收起按钮),show() 的
    // 激活会抢走输入焦点;穿透/点击外壳靠 setIgnoreMouseEvents forward,不需要焦点。
    win.showInactive()
    win.moveTop()
    // 不 invalidate():丢弃首帧会让透明窗口在重绘期间闪透明空帧,见 floatWindow.show()
  }

  private recreate(): void {
    this.destroy()
    this.booted = false
    if (this.wanted) this.create()
  }

  private create(): void {
    const wa = this.currentWorkarea()
    const win = new BrowserWindow({
      ...wa,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'ChatDeck 鲸鱼',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false
      }
    })
    // 与悬浮窗同级别置顶(压过普通应用窗口);默认鼠标穿透,悬停时由渲染层开启
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true)
    win.setIgnoreMouseEvents(true, { forward: true })
    win.on('closed', () => {
      this.win = null
    })
    win.webContents.on('render-process-gone', () => {
      if (this.getWindow() !== win) return
      this.booted = false
      this.onRendererGone()
      this.recreate()
    })
    if (!app.isPackaged) {
      // 开发期把鲸鱼渲染层日志转到终端,便于验证
      win.webContents.on('console-message', (_e, _level, message) => {
        console.log('[whale]', message)
      })
      win.webContents.on('before-input-event', (_e, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') {
          win.webContents.openDevTools({ mode: 'detach' })
        }
      })
    }
    void this.loadPage(win)
    this.win = win

    // 光标轮询(视线跟随):位置未变不发送,静止光标下 IPC 降为 0
    this.cursorTimer = setInterval(() => this.pollCursor(), WHALE_CONFIG.performance.cursorPollMs)
  }

  private async loadPage(win: BrowserWindow): Promise<void> {
    // CHATDECK_WHALE_PINNED=1:钉住模式,鲸鱼不自主游动(形态/截图测试用,见 whale/app.ts)
    const pinned = process.env.CHATDECK_WHALE_PINNED === '1' ? '?pinned=1' : ''
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/whale.html${pinned}`)
    } else {
      await win.loadFile(join(__dirname, '../renderer/whale.html'), pinned ? { search: 'pinned=1' } : undefined)
    }
  }

  private pollCursor(): void {
    const win = this.getWindow()
    if (!win || !win.isVisible()) return
    const p = screen.getCursorScreenPoint()
    if (p.x === this.lastCursor.x && p.y === this.lastCursor.y) return
    this.lastCursor.x = p.x
    this.lastCursor.y = p.y
    win.webContents.send(IPC.EvWhaleCursor, {
      x: p.x,
      y: p.y,
      at: performance.timeOrigin + performance.now()
    })
  }

  private sendUnread(): void {
    const win = this.getWindow()
    if (win) win.webContents.send(IPC.EvWhaleUnread, this.unreadCount)
  }
}
