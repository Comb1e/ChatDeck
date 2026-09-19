import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { DeckApi } from '@shared/api'
import type { PaneLayoutEntry, PromptInput, ProviderInput, UiState } from '@shared/types'

/**
 * 渲染层唯一可用的宿主 API。所有方法返回 Promise（send 型也包装为 Promise 以便统一风格）。
 * 渲染层不直接接触 Node / Electron 原生模块。
 */
const api: DeckApi = {
  providers: {
    list: () => ipcRenderer.invoke(IPC.ProvidersList),
    save: (input: ProviderInput) => ipcRenderer.invoke(IPC.ProvidersSave, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.ProvidersRemove, id),
    clearData: (id: string) => ipcRenderer.invoke(IPC.ProvidersClearData, id)
  },
  prompts: {
    list: () => ipcRenderer.invoke(IPC.PromptsList),
    save: (input: PromptInput) => ipcRenderer.invoke(IPC.PromptsSave, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.PromptsRemove, id),
    reset: () => ipcRenderer.invoke(IPC.PromptsReset)
  },
  state: {
    get: () => ipcRenderer.invoke(IPC.StateGet),
    save: (s: UiState) => ipcRenderer.invoke(IPC.StateSave, s)
  },
  view: {
    setLayout: (entries: PaneLayoutEntry[]) => ipcRenderer.invoke(IPC.ViewSetLayout, entries),
    setActive: (id: string): void => ipcRenderer.send(IPC.ViewSetActive, id),
    reload: (id: string): void => ipcRenderer.send(IPC.ViewReload, id),
    back: (id: string): void => ipcRenderer.send(IPC.ViewBack, id),
    forward: (id: string): void => ipcRenderer.send(IPC.ViewForward, id),
    openExternal: (id: string): void => ipcRenderer.send(IPC.ViewOpenExternal, id),
    paste: (id: string): void => ipcRenderer.send(IPC.ViewPaste, id)
  },
  fview: {
    setLayout: (entries: PaneLayoutEntry[]) => ipcRenderer.invoke(IPC.FViewSetLayout, entries),
    setActive: (id: string): void => ipcRenderer.send(IPC.FViewSetActive, id),
    reload: (id: string): void => ipcRenderer.send(IPC.FViewReload, id),
    back: (id: string): void => ipcRenderer.send(IPC.FViewBack, id),
    forward: (id: string): void => ipcRenderer.send(IPC.FViewForward, id)
  },
  float: {
    toggle: () => ipcRenderer.invoke(IPC.FloatToggle),
    resize: (expanded: boolean) => ipcRenderer.invoke(IPC.FloatResize, expanded),
    hide: () => ipcRenderer.invoke(IPC.FloatHide),
    getState: () => ipcRenderer.invoke(IPC.FloatGetState),
    setActiveProvider: (id: string): void => ipcRenderer.send(IPC.FloatSetProvider, id)
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke(IPC.ClipboardWrite, text)
  },
  on: {
    titleChanged: (cb): void => {
      ipcRenderer.on(IPC.EvTitleChanged, (_e, payload) => cb(payload))
    },
    activeChanged: (cb): void => {
      ipcRenderer.on(IPC.EvActiveChanged, (_e, payload) => cb(payload))
    },
    loadStateChanged: (cb): void => {
      ipcRenderer.on(IPC.EvLoadStateChanged, (_e, payload) => cb(payload))
    }
  },
  onF: {
    titleChanged: (cb): void => {
      ipcRenderer.on(IPC.EvFTitleChanged, (_e, payload) => cb(payload))
    },
    activeChanged: (cb): void => {
      ipcRenderer.on(IPC.EvFActiveChanged, (_e, payload) => cb(payload))
    },
    loadStateChanged: (cb): void => {
      ipcRenderer.on(IPC.EvFLoadStateChanged, (_e, payload) => cb(payload))
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
