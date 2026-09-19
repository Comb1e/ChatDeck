import { defineStore } from 'pinia'
import type { PromptLibrary } from '@shared/api'
import type { Prompt, PromptInput } from '@shared/types'

interface PromptsState {
  prompts: Prompt[]
  categories: string[]
}

export const usePromptsStore = defineStore('prompts', {
  state: (): PromptsState => ({
    prompts: [],
    categories: []
  }),

  actions: {
    applyLibrary(lib: PromptLibrary): void {
      this.prompts = lib.prompts
      this.categories = lib.categories
    },

    async load(): Promise<void> {
      this.applyLibrary(await window.api.prompts.list())
    },

    async save(input: PromptInput): Promise<void> {
      this.applyLibrary(await window.api.prompts.save(input))
    },

    async remove(id: string): Promise<void> {
      this.applyLibrary(await window.api.prompts.remove(id))
    },

    async reset(): Promise<void> {
      this.applyLibrary(await window.api.prompts.reset())
    }
  }
})
