import { app, Menu, globalShortcut, powerMonitor, screen } from 'electron'
import { IPC } from '@shared/ipc'
import { formatDirection, resolveDirection } from '@shared/translate'
import type { TranslatePopupState } from '@shared/translate'
import { FLOAT_EXPANDED } from '@shared/floatLayout'
import { ProviderStore } from './store/providerStore'
import { PromptStore } from './store/promptStore'
import { MOBILE_UA, ViewManager } from './viewManager'
import { FloatWindowController } from './floatWindow'
import { WhaleWindowController } from './whaleWindow'
import { SettingsWindowController } from './settingsWindow'
import { TrayController } from './tray'
import { registerIpc } from './ipc'
import { TranslateService } from './translateService'
import { TranslatePopupController } from './translateWindow'
import { captureSelectedText } from './textCapture'

const stores = {
  providers: new ProviderStore(),
  prompts: new PromptStore()
}
// ChatDeck 以「悬浮窗(压缩形态=鲸鱼) + 托盘」形态运行,悬浮窗是站点视图的唯一宿主
const floatViews = new ViewManager(MOBILE_UA)
const translate = new TranslateService()
// 译文弹窗依附悬浮窗(正上方),纯跟随不持久化位置
const translateWin = new TranslatePopupController({
  getFloatBounds: () => floatWin.getWindow()?.getBounds() ?? null
})
const floatWin = new FloatWindowController({
  // 悬浮窗惰性创建,创建完成后把视图管理器绑定到该窗口
  onWindowCreated: (w) => floatViews.attachWindow(w),
  onMoved: () => translateWin.repositionIfVisible(),
  onHide: () => translateWin.hide(),
  // 重建窗口前把站点视图从旧窗口摘下(留在缓存),随新窗口 boot 后的 setLayout 重新挂载
  onDetachViews: () => floatViews.setLayout([])
})
const whaleWin = new WhaleWindowController()
const settingsWin = new SettingsWindowController()
let tray: TrayController | null = null

/** 展开悬浮窗(可带屏幕锚点);鲸鱼随之隐藏(压缩形态 ⇄ 展开形态互斥) */
function expandFloat(at?: { x: number; y: number }): void {
  if (at) {
    floatWin.showAt({
      x: at.x - FLOAT_EXPANDED.width / 2,
      y: at.y - 120
    })
  } else {
    floatWin.show()
  }
  whaleWin.hide()
}

/** 收起悬浮窗为鲸鱼形态;鲸鱼在悬浮窗原位置(中心点)破水浮出 */
function collapseToWhale(): void {
  const win = floatWin.getWindow()
  const bounds = win && floatWin.isVisible() ? win.getBounds() : null
  floatWin.hide()
  whaleWin.show()
  if (bounds) {
    whaleWin.sendSurfaceAt({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
  }
}

function toggleForm(): void {
  if (floatWin.isVisible()) collapseToWhale()
  else expandFloat()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // 二次启动:唤起压缩形态(鲸鱼)
  app.on('second-instance', () => {
    whaleWin.show()
  })

  void app.whenReady().then(bootstrap)
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)
  await Promise.all([stores.providers.init(), stores.prompts.init(), floatWin.restore(), translate.init()])

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
    openSettings: () => settingsWin.show(),
    toggleForm: toggleForm,
    jumpDive: () => {
      // 招牌动作只在鲸鱼可见时有意义(隐藏时动画无人看)
      if (whaleWin.isVisible()) whaleWin.sendJumpDive()
    },
    quit: () => {
      app.quit()
    }
  })
  tray.create()

  registerIpc({
    ...stores,
    floatViews,
    floatWin,
    whaleWin,
    settingsWin,
    translate,
    translateWin,
    forms: { collapseToWhale, expandFloat, toggleForm }
  })
  registerTranslateHotkey()

  // 默认以压缩形态(鲸鱼)显示悬浮窗;悬浮窗窗口以隐藏方式创建,
  // 其渲染层保持存活:站点视图加载、未读统计、快速展开都依赖它
  floatWin.ensureCreated()
  whaleWin.show()

  // 后台站点休眠扫描:每分钟检查一次,超过站点休眠阈值未显示的站点视图销毁释放内存
  setInterval(() => floatViews.sweepSleep(), 60_000)

  // 透明窗口自愈:锁屏/休眠唤醒/显卡驱动重置后 DWM 合成表面可能失效(整窗透明"消失",
  // isVisible 仍为 true 导致托盘第一击 toggle 反而执行隐藏),在这些事件后强制恢复;
  // 显示器拓扑变化(断开/分辨率变更)则把窗口夹回现存工作区。
  powerMonitor.on('resume', () => {
    floatWin.heal()
    whaleWin.heal()
  })
  powerMonitor.on('unlock-screen', () => {
    floatWin.heal()
    whaleWin.heal()
  })
  app.on('child-process-gone', (_e, details) => {
    if (details.type === 'GPU') {
      floatWin.heal()
      whaleWin.heal()
    }
  })
  screen.on('display-removed', () => {
    floatWin.reclamp()
    whaleWin.syncWorkarea()
  })
  screen.on('display-metrics-changed', () => {
    floatWin.reclamp()
    whaleWin.syncWorkarea()
  })
}

// 托盘常驻应用:窗口全部关闭(悬浮窗重建间隙等)也不退出,退出只走托盘「退出」
app.on('window-all-closed', () => {})

// ---- 划词翻译:Ctrl+Q 全局取词 → 百度翻译 → 悬浮窗正上方弹窗 ----

function registerTranslateHotkey(): void {
  const ok = globalShortcut.register('CommandOrControl+Q', () => {
    void handleTranslateHotkey()
  })
  if (!ok) console.warn('[translate] Ctrl+Q 全局快捷键注册失败(可能被其他应用占用)')
}

async function handleTranslateHotkey(): Promise<void> {
  // 翻译依附悬浮窗;悬浮窗未唤起时不动作
  if (!floatWin.getWindow()) return
  const raw = await captureSelectedText()
  // 取词失败(无选区/该应用 Ctrl+C 非复制)静默,避免误触弹窗
  if (!raw) return

  const pairId = translate.getConfig().pair
  const { from, to } = resolveDirection(pairId, raw)
  const base: TranslatePopupState = {
    status: 'translating',
    dst: '',
    message: '',
    dirLabel: formatDirection(from, to),
    pairId
  }

  if (!translate.hasCredentials()) {
    translateWin.show()
    translateWin.sendState({ ...base, status: 'error', message: '未配置百度翻译：请在设置中填写 APPID/KEY' })
    return
  }
  translateWin.show()
  translateWin.sendState(base)

  const outcome = await translate.translate(raw)
  translateWin.sendState(
    outcome.ok
      ? { status: 'done', dst: outcome.dst, message: '', dirLabel: outcome.dirLabel, pairId }
      : { ...base, status: 'error', message: outcome.message }
  )
}

app.on('before-quit', () => {
  globalShortcut.unregisterAll()
  floatViews.destroyAll()
  whaleWin.destroy()
  tray?.destroy()
})
