import { defineStore } from 'pinia'
import type { Provider, ViewLoadState } from '@shared/types'

interface ProvidersState {
  items: Provider[]
  loadStates: Record<string, ViewLoadState>
  unread: string[]
}

/** 站点列表与加载状态(桌面版与悬浮窗共用,不耦合任何布局逻辑) */
export const useProvidersStore = defineStore('providers', {
  state: (): ProvidersState => ({
    items: [],
    loadStates: {},
    unread: []
  }),

  getters: {
    enabled(state): Provider[] {
      return state.items.filter((p) => p.enabled)
    },
    byId(state) {
      return (id: string): Provider | undefined => state.items.find((p) => p.id === id)
    }
  },

  actions: {
    async load(): Promise<void> {
      this.items = await window.api.providers.list()
    },

    onTitleChanged(id: string, title: string, isActive: boolean): void {
      if (!title || isActive) return
      if (!this.unread.includes(id)) this.unread.push(id)
    },

    onLoadStateChanged(id: string, state: ViewLoadState): void {
      this.loadStates[id] = state
    },

    clearUnread(id: string): void {
      const i = this.unread.indexOf(id)
      if (i >= 0) this.unread.splice(i, 1)
    }
  }
})
