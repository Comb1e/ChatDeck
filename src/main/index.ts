import { join } from 'node:path'
import { app, BrowserWindow, Menu } from 'electron'
import { IPC } from '@shared/ipc'
import { ProviderStore } from './store/providerStore'
import { PromptStore } from './store/promptStore'
import { StateStore } from './store/stateStore'
import { ViewManager } from './viewManager'
import { registerIpc } from './ipc'

const stores = {
  providers: new ProviderStore(),
  prompts: new PromptStore(),
  state: new StateStore()
}
const viewManager = new ViewManager()
let mainWindow: BrowserWindow | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(bootstrap)
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)
  await Promise.all([stores.providers.init(), stores.prompts.init()])

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
  win.on('closed', () => {
    mainWindow = null
  })

  // 主进程 → 渲染层事件桥
  const emit = (channel: string, payload: unknown): void => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send(channel, payload)
  }
  viewManager.hook({
    onTitleChanged: (id, title) => emit(IPC.EvTitleChanged, { id, title }),
    onActiveChanged: (id) => emit(IPC.EvActiveChanged, { id }),
    onLoadStateChanged: (id, state) => emit(IPC.EvLoadStateChanged, { id, state })
  })

  registerIpc({ providers: stores.providers, prompts: stores.prompts, state: stores.state, views: viewManager })

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
  viewManager.destroyAll()
})
