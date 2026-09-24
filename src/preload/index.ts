import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { DeckApi } from '@shared/api'
import type { PaneLayoutEntry, PromptInput, ProviderInput, Rect } from '@shared/types'
import type {
  BalanceRefreshResult,
  BalanceSaveResult,
  BalanceSiteDescription,
  BalanceSiteDescriptionList,
  BalanceSiteInput,
  BalanceSiteTypeInfo,
  BalanceSnapshot,
  BillingReport
} from '@shared/balance'
import type { TranslateConfig, TranslatePairId, TranslatePopupState } from '@shared/translate'
import type { SystemStats } from '@shared/systemStats'

/**
 * 渲染层唯一可用的宿主 API。所有方法返回 Promise（send 型也包装为 Promise 以便统一风格）。
 * 渲染层不直接接触 Node / Electron 原生模块。
 */
const api: DeckApi = {
  form: {
    ready: () => ipcRenderer.send(IPC.FloatReady),
    report: (report) => ipcRenderer.send(IPC.FormReport, report),
    onCommand: (cb) => { ipcRenderer.on(IPC.FormCommand, (_e, command) => cb(command)) }
  },
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
  fview: {
    setLayout: (entries: PaneLayoutEntry[]) => ipcRenderer.invoke(IPC.FViewSetLayout, entries),
    setActive: (id: string): void => ipcRenderer.send(IPC.FViewSetActive, id),
    reload: (id: string): void => ipcRenderer.send(IPC.FViewReload, id),
    back: (id: string): void => ipcRenderer.send(IPC.FViewBack, id),
    forward: (id: string): void => ipcRenderer.send(IPC.FViewForward, id),
    navigate: (id: string, url: string) =>
      ipcRenderer.invoke(IPC.FViewNavigate, { id, url }) as Promise<boolean>,
    paste: () => ipcRenderer.invoke(IPC.FViewPaste) as Promise<boolean>
  },
  float: {
    toggle: () => ipcRenderer.invoke(IPC.FloatToggle),
    collapse: () => ipcRenderer.invoke(IPC.FloatCollapse) as Promise<boolean>,
    hide: () => ipcRenderer.invoke(IPC.FloatHide),
    getState: () => ipcRenderer.invoke(IPC.FloatGetState),
    setActiveProvider: (id: string): void => ipcRenderer.send(IPC.FloatSetProvider, id),
    pushUnread: (count: number): void => ipcRenderer.send(IPC.FloatUnreadCount, count)
  },
  whale: {
    ready: (): void => ipcRenderer.send(IPC.WhaleReady),
    getWorkarea: () => ipcRenderer.invoke(IPC.WhaleGetWorkarea) as Promise<Rect>,
    setInteractive: (on: boolean): void => ipcRenderer.send(IPC.WhaleSetInteractive, Boolean(on)),
    expand: () => ipcRenderer.invoke(IPC.WhaleExpand) as Promise<boolean>
  },
  app: {
    openSettings: () => ipcRenderer.invoke(IPC.AppOpenSettings) as Promise<boolean>,
    getAutostart: () => ipcRenderer.invoke(IPC.AppGetAutostart) as Promise<boolean>,
    setAutostart: (enabled: boolean) =>
      ipcRenderer.invoke(IPC.AppSetAutostart, Boolean(enabled)) as Promise<boolean>
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke(IPC.ClipboardWrite, text)
  },
  balance: {
    getState: () => ipcRenderer.invoke(IPC.BalanceState) as Promise<BalanceSnapshot>,
    describeSites: () =>
      ipcRenderer.invoke(IPC.BalanceDescribeSites) as Promise<BalanceSiteDescriptionList>,
    describeNewSite: (type: string) =>
      ipcRenderer.invoke(IPC.BalanceDescribeNewSite, type) as Promise<BalanceSiteDescription>,
    describeSiteTypes: () =>
      ipcRenderer.invoke(IPC.BalanceDescribeSiteTypes) as Promise<BalanceSiteTypeInfo[]>,
    saveSite: (input: BalanceSiteInput) =>
      ipcRenderer.invoke(IPC.BalanceSaveSite, input) as Promise<BalanceSaveResult>,
    removeSite: (id: string) =>
      ipcRenderer.invoke(IPC.BalanceRemoveSite, id) as Promise<{ ok: boolean }>,
    moveSite: (id: string, delta: -1 | 1) =>
      ipcRenderer.invoke(IPC.BalanceMoveSite, id, delta) as Promise<{ ok: boolean }>,
    refreshNow: () =>
      ipcRenderer.invoke(IPC.BalanceRefresh) as Promise<BalanceRefreshResult>,
    toggle: (mode?: 'show'): void => ipcRenderer.send(IPC.BalanceToggle, mode),
    openBilling: (): void => ipcRenderer.send(IPC.BalanceBillingOpen),
    getBillingReport: () => ipcRenderer.invoke(IPC.BalanceBillingGet) as Promise<BillingReport>,
    closeBilling: (): void => ipcRenderer.send(IPC.BalanceBillingClose),
    openUsage: (siteId: string): void => ipcRenderer.send(IPC.BalanceOpenUsage, siteId),
    resize: (width: number, height: number): void =>
      ipcRenderer.send(IPC.BalanceResize, { width, height })
  },
  translate: {
    getConfig: () => ipcRenderer.invoke(IPC.TranslateGetConfig) as Promise<TranslateConfig>,
    saveConfig: (input: { appId: string; appKey: string }) =>
      ipcRenderer.invoke(IPC.TranslateSaveConfig, input) as Promise<TranslateConfig>,
    setPair: (pair: TranslatePairId): void => ipcRenderer.send(IPC.TranslateSetPair, pair),
    getLast: () => ipcRenderer.invoke(IPC.TranslateGetLast) as Promise<TranslatePopupState | null>,
    hide: () => ipcRenderer.invoke(IPC.TranslateHide) as Promise<boolean>
  },
  system: {
    getStats: () => ipcRenderer.invoke(IPC.SystemGetStats) as Promise<SystemStats>
  },
  on: {
    translateResult: (cb: (state: TranslatePopupState) => void): void => {
      ipcRenderer.on(IPC.EvTranslateResult, (_e, payload) => cb(payload))
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
    },
    usageOpen: (cb: (e: { id: string; url: string }) => void): void => {
      ipcRenderer.on(IPC.EvFUsageOpen, (_e, payload) => cb(payload))
    }
  },
  onWhale: {
    cursor: (cb): void => {
      ipcRenderer.on(IPC.EvWhaleCursor, (_e, payload) => cb(payload))
    },
    workarea: (cb): void => {
      ipcRenderer.on(IPC.EvWhaleWorkarea, (_e, payload) => cb(payload))
    },
    command: (cb): void => {
      ipcRenderer.on(IPC.EvWhaleCommand, (_e, payload) => cb(payload))
    },
    unread: (cb): void => {
      ipcRenderer.on(IPC.EvWhaleUnread, (_e, payload) => cb(payload))
    }
  },
  onBalance: {
    state: (cb): void => {
      ipcRenderer.on(IPC.EvBalanceState, (_e, payload) => cb(payload))
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
