import { clipboard, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { PaneLayoutEntry, ProviderInput, PromptInput, UiState } from '@shared/types'
import type { ProviderStore } from './store/providerStore'
import type { PromptStore } from './store/promptStore'
import type { StateStore } from './store/stateStore'
import type { ViewManager } from './viewManager'

export interface IpcDeps {
  providers: ProviderStore
  prompts: PromptStore
  state: StateStore
  views: ViewManager
}

/** 注册全部 IPC；主→渲染事件经 hooks 由 viewManager 回调驱动 */
export function registerIpc(deps: IpcDeps): void {
  const { providers, prompts, state, views } = deps

  ipcMain.handle(IPC.ProvidersList, async () => {
    const items = await providers.list()
    for (const p of items) views.registerProvider(p)
    return items
  })

  ipcMain.handle(IPC.ProvidersSave, async (_e, input: ProviderInput) => {
    const items = await providers.save(input)
    for (const p of items) views.registerProvider(p)
    return items
  })

  ipcMain.handle(IPC.ProvidersRemove, async (_e, id: string) => {
    const items = await providers.remove(id)
    return items
  })

  ipcMain.handle(IPC.ProvidersClearData, async (_e, id: string) => {
    await providers.clearData(id)
    await views.clearData(id)
    return true
  })

  ipcMain.handle(IPC.PromptsList, () => prompts.list())

  ipcMain.handle(IPC.PromptsSave, (_e, input: PromptInput) => prompts.save(input))

  ipcMain.handle(IPC.PromptsRemove, (_e, id: string) => prompts.remove(id))

  ipcMain.handle(IPC.PromptsReset, () => prompts.reset())

  ipcMain.handle(IPC.StateGet, () => state.get())

  ipcMain.handle(IPC.StateSave, (_e, s: UiState) => state.save(s))

  ipcMain.handle(IPC.ViewSetLayout, async (_e, entries: PaneLayoutEntry[]) => {
    for (const entry of entries) {
      if (!views.hasProvider(entry.id)) {
        const p = (await providers.list()).find((x) => x.id === entry.id)
        if (p) views.registerProvider(p)
      }
    }
    views.setLayout(entries)
    return true
  })

  ipcMain.on(IPC.ViewSetActive, (_e, id: string) => views.setActive(id))
  ipcMain.on(IPC.ViewReload, (_e, id: string) => views.reload(id))
  ipcMain.on(IPC.ViewBack, (_e, id: string) => views.back(id))
  ipcMain.on(IPC.ViewForward, (_e, id: string) => views.forward(id))
  ipcMain.on(IPC.ViewOpenExternal, (_e, id: string) => views.openExternal(id))
  ipcMain.on(IPC.ViewPaste, (_e, id: string) => views.paste(id))

  ipcMain.handle(IPC.ClipboardWrite, (_e, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
}
