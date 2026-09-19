import { defineStore } from 'pinia'
import type { Prompt } from '@shared/types'

type DrawerView = 'prompts' | 'editor' | 'fill' | 'settings'

interface FillTarget {
  prompt: Prompt
  /** 使用场景：仅复制，或复制后粘贴到站点输入框 */
  pasteAfter: boolean
}

interface UiState {
  view: DrawerView | null
  editing: Prompt | null
  fill: FillTarget | null
  toast: string
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useUiStore = defineStore('ui', {
  state: (): UiState => ({
    view: null,
    editing: null,
    fill: null,
    toast: ''
  }),

  getters: {
    isOpen(state): boolean {
      return state.view !== null
    }
  },

  actions: {
    openPrompts(): void {
      this.view = 'prompts'
      this.editing = null
      this.fill = null
    },
    openSettings(): void {
      this.view = 'settings'
      this.editing = null
      this.fill = null
    },
    newPrompt(): void {
      this.editing = null
      this.view = 'editor'
    },
    editPrompt(p: Prompt): void {
      this.editing = p
      this.view = 'editor'
    },
    startFill(p: Prompt, pasteAfter: boolean): void {
      this.fill = { prompt: p, pasteAfter }
      this.view = 'fill'
    },
    close(): void {
      this.view = null
      this.editing = null
      this.fill = null
    },
    showToast(msg: string): void {
      this.toast = msg
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => {
        this.toast = ''
        toastTimer = null
      }, 2400)
    }
  }
})
