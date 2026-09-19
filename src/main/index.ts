import { join } from 'node:path'
import { app, BrowserWindow, Menu } from 'electron'
import { IPC } from '@shared/ipc'
import { ProviderStore } from './store/providerStore'
import { PromptStore } from './store/promptStore'
import { StateStore } from './store/stateStore'
import { MOBILE_UA, ViewManager } from './viewManager'
import { FloatWindowController } from './floatWindow'
import { TrayController } from './tray'
import { registerIpc } from './ipc'

const stores = {
  providers: new ProviderStore(),
  prompts: new PromptStore(),
  state: new StateStore()
}
// 桌面版与悬浮窗各持一个视图管理器;同名 persist 分区即共享登录态
const viewManager = new ViewManager()
const floatViews = new ViewManager(MOBILE_UA)
const floatWin = new FloatWindowController({
  // 悬浮窗惰性创建,创建完成后把视图管理器绑定到该窗口
  onWindowCreated: (w) => floatViews.attachWindow(w)
})
let mainWindow: BrowserWindow | null = null
let tray: TrayController | null = null
let isQuitting = false

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(bootstrap)
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)
  await Promise.all([stores.providers.init(), stores.prompts.init(), floatWin.restore()])

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#FAF9F5',
    title: 'ChatDeck',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  mainWindow = win
  viewManager.attachWindow(win)

  win.on('ready-to-show', () => win.show())
  // 悬浮窗存活时关主窗 = 隐藏到托盘;真正退出走托盘「退出」
  win.on('close', (e) => {
    if (!isQuitting && floatWin.getWindow()) {
      e.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })

  // 主进程 → 主窗口渲染层事件桥
  const emit = (channel: string, payload: unknown): void => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send(channel, payload)
  }
  viewManager.hook({
    onTitleChanged: (id, title) => emit(IPC.EvTitleChanged, { id, title }),
    onActiveChanged: (id) => emit(IPC.EvActiveChanged, { id }),
    onLoadStateChanged: (id, state) => emit(IPC.EvLoadStateChanged, { id, state })
  })

  // 主进程 → 悬浮窗渲染层事件桥
  const emitF = (channel: string, payload: unknown): void => {
    const w = floatWin.getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
  floatViews.hook({
    onTitleChanged: (id, title) => emitF(IPC.EvFTitleChanged, { id, title }),
    onActiveChanged: (id) => emitF(IPC.EvFActiveChanged, { id }),
    onLoadStateChanged: (id, state) => emitF(IPC.EvFLoadStateChanged, { id, state })
  })

  tray = new TrayController({
    showMainWindow: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    },
    toggleFloat: () => {
      floatWin.toggle()
    },
    quit: () => {
      isQuitting = true
      app.quit()
    }
  })
  tray.create()

  registerIpc({ ...stores, views: viewManager, floatViews, floatWin })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  viewManager.destroyAll()
  floatViews.destroyAll()
  tray?.destroy()
})
