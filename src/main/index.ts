import { join } from 'node:path'
import { app, Menu, globalShortcut, powerMonitor, screen } from 'electron'
import { IPC } from '@shared/ipc'
import { formatDirection, resolveDirection } from '@shared/translate'
import type { TranslatePopupState } from '@shared/translate'
import { FormController } from './formController'
import { ProviderStore } from './store/providerStore'
import { PromptStore } from './store/promptStore'
import { resourceFile } from './store/jsonStore'
import { MOBILE_UA, ViewManager } from './viewManager'
import { FloatWindowController } from './floatWindow'
import { WhaleWindowController } from './whaleWindow'
import { SettingsWindowController } from './settingsWindow'
import { TrayController } from './tray'
import { registerIpc } from './ipc'
import { TranslateService } from './translateService'
import { TranslatePopupController } from './translateWindow'
import { captureSelectedText } from './textCapture'
import { BalanceStore } from './balance/store'
import { BalanceScheduler } from './balance/scheduler'
import { UsageStore } from './balance/usage'
import { BalanceNotifier } from './balance/notify'
import { BalanceWindowController } from './balance/window'
import { BillingWindowController } from './balance/billing-window'

const stores = {
  providers: new ProviderStore(),
  prompts: new PromptStore()
}
// ChatDeck 以「悬浮窗(压缩形态=鲸鱼) + 托盘」形态运行,悬浮窗是站点视图的唯一宿主
const floatViews = new ViewManager(MOBILE_UA)
const translate = new TranslateService()
// 译文弹窗依附悬浮窗(正上方),纯跟随不持久化位置
const translateWin = new TranslatePopupController({
  getFloatBounds: () => floatWin.isVisible() ? floatWin.getPanelBounds() : null
})
const floatWin = new FloatWindowController({
  onRendererGone: () => forms.recover('float'),
  // 悬浮窗惰性创建,创建完成后把视图管理器绑定到该窗口
  onWindowCreated: (w) => floatViews.attachWindow(w),
  onMoved: () => translateWin.repositionIfVisible(),
  onHide: () => translateWin.hide(),
  // 重建窗口前把站点视图从旧窗口摘下(留在缓存),随新窗口 boot 后的 setLayout 重新挂载
  onDetachViews: () => floatViews.setLayout([])
})
const whaleWin = new WhaleWindowController(() => forms.recover('whale'))
// 余额监控（移植自 token-balance）：配置存 userData，与站点配置同文件；
// 用量台账独立成文件（派生数据,清掉即重新计量,不污染用户手编的配置）
const balanceStore = new BalanceStore(join(app.getPath('userData'), 'balance.user.json'))
const balanceUsage = new UsageStore(join(app.getPath('userData'), 'balance.usage.json'))
const balanceScheduler = new BalanceScheduler(balanceStore, balanceUsage)
const balanceNotifier = new BalanceNotifier(resourceFile('balance-icon.png'))
const balanceWin = new BalanceWindowController({
  store: balanceStore,
  onVisibilityChanged: (visible) => tray?.setBalanceChecked(visible)
})
// 账单窗口:余额明细(每月用量),由余额卡片/胶囊/设置窗口入口打开,关闭即销毁
const billingWin = new BillingWindowController()
const settingsWin = new SettingsWindowController()
let tray: TrayController | null = null

const forms = new FormController({
  ensure: form => form === 'float' ? floatWin.ensureCreated() : whaleWin.ensureCreated(),
  send: (form, command) => {
    const win = form === 'float' ? floatWin.getWindow() : whaleWin.getWindow()
    if (win && !win.webContents.isCrashed()) win.webContents.send(IPC.FormCommand, command)
  },
  show: form => form === 'float' ? floatWin.show() : whaleWin.show(),
  hide: form => form === 'float' ? floatWin.hide() : whaleWin.hide(),
  panel: () => floatWin.getPanelBounds(),
  placePanel: point => floatWin.prepareAt(point),
  workarea: panel => screen.getDisplayMatching(panel).workArea,
  stage: area => whaleWin.setWorkarea(area)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // 二次启动:唤起压缩形态(鲸鱼)
  app.on('second-instance', () => {
    forms.request('whale')
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
    toggleForm: () => forms.toggle(),
    jumpDive: () => {
      // 招牌动作只在鲸鱼可见时有意义(隐藏时动画无人看)
      if (forms.phase === 'stable' && forms.current === 'whale') whaleWin.sendJumpDive()
    },
    toggleBalance: () => {
      // 余额小窗显隐由托盘菜单控制;勾选态经 onVisibilityChanged 回写
      balanceWin.toggle()
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
    balanceStore,
    balanceScheduler,
    balanceWin,
    billingWin,
    balanceUsage,
    settingsWin,
    translate,
    translateWin,
    forms
  })
  registerTranslateHotkey()

  // 默认以压缩形态(鲸鱼)显示悬浮窗;悬浮窗窗口以隐藏方式创建,
  // 其渲染层保持存活:站点视图加载、未读统计、快速展开都依赖它
  floatWin.ensureCreated()
  whaleWin.show()

  // 余额监控:主进程轮询常驻(窗口隐藏也照常刷新、通知照发);
  // 上次退出时窗口可见则恢复显示(默认隐藏)
  balanceScheduler.startSchedule((snapshot) => {
    balanceWin.pushState(snapshot)
    balanceNotifier.onSnapshot(snapshot)
  })
  if (balanceStore.load().window.visible) balanceWin.show()
  else tray.setBalanceChecked(false)

  // 后台站点休眠扫描:每分钟检查一次,超过站点休眠阈值未显示的站点视图销毁释放内存
  setInterval(() => floatViews.sweepSleep(), 60_000)

  // 透明窗口自愈:锁屏/休眠唤醒/显卡驱动重置后 DWM 合成表面可能失效(整窗透明"消失",
  // isVisible 仍为 true 导致托盘第一击 toggle 反而执行隐藏),在这些事件后强制恢复;
  // 显示器拓扑变化(断开/分辨率变更)则把窗口夹回现存工作区。
  powerMonitor.on('resume', () => {
    if (forms.phase !== 'stable') forms.recover()
    floatWin.heal()
    whaleWin.heal()
  })
  powerMonitor.on('unlock-screen', () => {
    if (forms.phase !== 'stable') forms.recover()
    floatWin.heal()
    whaleWin.heal()
  })
  app.on('child-process-gone', (_e, details) => {
    if (details.type === 'GPU') {
      forms.recover()
      floatWin.heal()
      whaleWin.heal()
    }
  })
  screen.on('display-removed', () => {
    if (forms.phase !== 'stable') forms.recover()
    floatWin.reclamp()
    whaleWin.syncWorkarea()
  })
  screen.on('display-metrics-changed', () => {
    if (forms.phase !== 'stable') forms.recover()
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
  forms.destroy()
  globalShortcut.unregisterAll()
  floatViews.destroyAll()
  whaleWin.destroy()
  balanceScheduler.stop()
  balanceWin.destroy()
  billingWin.destroy()
  tray?.destroy()
})
