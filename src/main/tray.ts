import { Menu, Tray, nativeImage } from 'electron'
import { resourceFile } from './store/jsonStore'

export interface TrayDeps {
  openSettings(): void
  /** 展开⇄鲸鱼形态互切(悬浮窗展开时收起为鲸鱼;鲸鱼时展开悬浮窗) */
  toggleForm(): void
  /** 鲸鱼招牌动作:起跳下潜(仅鲸鱼形态可见时有效) */
  jumpDive(): void
  quit(): void
}

/** 托盘:常驻入口。应用以鲸鱼/悬浮窗+托盘形态运行,设置等入口都在这里 */
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
    this.tray.on('click', () => this.deps.toggleForm())
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      { label: '设置…', click: () => this.deps.openSettings() },
      { label: '悬浮窗 ⇄ 鲸鱼', click: () => this.deps.toggleForm() },
      { label: '鲸鱼招牌动作(起跳下潜)', click: () => this.deps.jumpDive() },
      { type: 'separator' },
      { label: '退出 ChatDeck', click: () => this.deps.quit() }
    ])
  }
}
