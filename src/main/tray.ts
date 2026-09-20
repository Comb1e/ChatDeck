import { Menu, Tray, nativeImage } from 'electron'
import { resourceFile } from './store/jsonStore'

export interface TrayDeps {
  openSettings(): void
  toggleFloat(): void
  quit(): void
}

/** 托盘:常驻入口。应用以悬浮窗+托盘形态运行,设置等入口都在这里 */
export class TrayController {
  private tray: Tray | null = null

  constructor(private readonly deps: TrayDeps) {}

  create(): void {
    // 16px 为 Windows 托盘标准尺寸,32px 作为 2x 高 DPI 表示
    const icon = nativeImage.createFromPath(resourceFile('tray.png'))
    const icon2x = nativeImage.createFromPath(resourceFile('tray@2x.png'))
    if (!icon2x.isEmpty()) {
      icon.addRepresentation({ scaleFactor: 2, buffer: icon2x.toPNG() })
    }
    this.tray = new Tray(icon)
    this.tray.setToolTip('ChatDeck')
    this.tray.setContextMenu(this.buildMenu())
    this.tray.on('click', () => this.deps.toggleFloat())
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: '设置…', click: () => this.deps.openSettings() },
      { label: '显示 / 隐藏悬浮窗', click: () => this.deps.toggleFloat() },
      { type: 'separator' },
      { label: '退出 ChatDeck', click: () => this.deps.quit() }
    ])
  }
}
