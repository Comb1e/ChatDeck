import { defineStore } from 'pinia'
import type { Provider, ViewLoadState } from '@shared/types'
import { useLayoutStore } from './layout'

interface ProvidersState {
  items: Provider[]
  loadStates: Record<string, ViewLoadState>
  unread: string[]
}

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
      const layout = useLayoutStore()
      layout.prunePanes()
    },

    onTitleChanged(id: string, title: string): void {
      if (!title) return
      const layout = useLayoutStore()
      if (layout.activeId !== id) {
        if (!this.unread.includes(id)) this.unread.push(id)
      }
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
