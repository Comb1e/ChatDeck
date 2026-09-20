import { clipboard, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { PaneLayoutEntry, Provider, ProviderInput, PromptInput, UiState } from '@shared/types'
import type { ProviderStore } from './store/providerStore'
import type { PromptStore } from './store/promptStore'
import type { StateStore } from './store/stateStore'
import type { ViewManager } from './viewManager'
import type { FloatWindowController } from './floatWindow'
import type { TranslateService } from './translateService'
import type { TranslatePopupController } from './translateWindow'

export interface IpcDeps {
  providers: ProviderStore
  prompts: PromptStore
  state: StateStore
  views: ViewManager
  floatViews: ViewManager
  floatWin: FloatWindowController
  translate: TranslateService
  translateWin: TranslatePopupController
}

/** 注册全部 IPC；主→渲染事件经 hooks 由 viewManager 回调驱动 */
export function registerIpc(deps: IpcDeps): void {
  const { providers, prompts, state, views, floatViews, floatWin, translate, translateWin } = deps

  /** 视图懒注册:站点尚未注册进管理器时按 id 补注册 */
  const ensureProviders = async (manager: ViewManager, ids: string[]): Promise<void> => {
    for (const id of ids) {
      if (!manager.hasProvider(id)) {
        const p = (await providers.list()).find((x) => x.id === id)
        if (p) manager.registerProvider(p)
      }
    }
  }

  /** 配置变更后把最新 Provider 快照同步进两个视图管理器(休眠阈值/UA 等立即生效) */
  const registerAll = (items: Provider[]): void => {
    for (const p of items) {
      views.registerProvider(p)
      floatViews.registerProvider(p)
    }
  }

  ipcMain.handle(IPC.ProvidersList, async () => {
    const items = await providers.list()
    registerAll(items)
    return items
  })

  ipcMain.handle(IPC.ProvidersSave, async (_e, input: ProviderInput) => {
    const items = await providers.save(input)
    registerAll(items)
    return items
  })

  ipcMain.handle(IPC.ProvidersRemove, async (_e, id: string) => {
    const items = await providers.remove(id)
    // 确认删除生效(自定义站点)才清理:销毁两侧视图并清空分区存储;
    // 内置站点删除是 no-op,误传的未知 id 也不动
    if (!items.some((p) => p.id === id)) {
      views.discardProvider(id)
      floatViews.discardProvider(id)
      await providers.clearData(id)
    }
    return items
  })

  ipcMain.handle(IPC.ProvidersClearData, async (_e, id: string) => {
    await providers.clearData(id)
    await views.clearData(id)
    await floatViews.clearData(id)
    return true
  })

  ipcMain.handle(IPC.PromptsList, () => prompts.list())

  ipcMain.handle(IPC.PromptsSave, (_e, input: PromptInput) => prompts.save(input))

  ipcMain.handle(IPC.PromptsRemove, (_e, id: string) => prompts.remove(id))

  ipcMain.handle(IPC.PromptsReset, () => prompts.reset())

  ipcMain.handle(IPC.StateGet, () => state.get())

  ipcMain.handle(IPC.StateSave, (_e, s: UiState) => state.save(s))

  ipcMain.handle(IPC.ViewSetLayout, async (_e, entries: PaneLayoutEntry[]) => {
    await ensureProviders(views, entries.map((x) => x.id))
    views.setLayout(entries)
    return true
  })

  ipcMain.on(IPC.ViewSetActive, (_e, id: string) => views.setActive(id))
  ipcMain.on(IPC.ViewReload, (_e, id: string) => views.reload(id))
  ipcMain.on(IPC.ViewBack, (_e, id: string) => views.back(id))
  ipcMain.on(IPC.ViewForward, (_e, id: string) => views.forward(id))
  ipcMain.on(IPC.ViewOpenExternal, (_e, id: string) => views.openExternal(id))
  ipcMain.on(IPC.ViewPaste, (_e, id: string) => views.paste(id))

  // ---- 悬浮窗视图通道(绑定 FloatWindow 的管理器实例) ----

  ipcMain.handle(IPC.FViewSetLayout, async (_e, entries: PaneLayoutEntry[]) => {
    await ensureProviders(floatViews, entries.map((x) => x.id))
    floatViews.setLayout(entries)
    return true
  })
  ipcMain.on(IPC.FViewSetActive, (_e, id: string) => floatViews.setActive(id))
  ipcMain.on(IPC.FViewReload, (_e, id: string) => floatViews.reload(id))
  ipcMain.on(IPC.FViewBack, (_e, id: string) => floatViews.back(id))
  ipcMain.on(IPC.FViewForward, (_e, id: string) => floatViews.forward(id))

  // ---- 悬浮窗窗口控制 ----

  ipcMain.handle(IPC.FloatToggle, () => floatWin.toggle())
  ipcMain.handle(IPC.FloatResize, (_e, expanded: boolean) =>
    floatWin.setExpanded(Boolean(expanded)).then(() => true)
  )
  ipcMain.handle(IPC.FloatHide, () => {
    floatWin.hide()
    return true
  })
  ipcMain.handle(IPC.FloatGetState, () => floatWin.getState())
  ipcMain.on(IPC.FloatSetProvider, (_e, id: string) => floatWin.setActiveProvider(String(id)))

  ipcMain.handle(IPC.ClipboardWrite, (_e, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })

  // ---- 划词翻译 ----

  ipcMain.handle(IPC.TranslateGetConfig, () => translate.getConfig())
  ipcMain.handle(IPC.TranslateSaveConfig, (_e, input: { appId?: string; appKey?: string }) =>
    translate.saveConfig(input ?? {})
  )
  ipcMain.on(IPC.TranslateSetPair, (_e, pair: unknown) => {
    void translate.setPair(pair)
  })
  ipcMain.handle(IPC.TranslateGetLast, () => translateWin.getLastState())
  ipcMain.on(IPC.TranslateHide, () => translateWin.hide())
}
