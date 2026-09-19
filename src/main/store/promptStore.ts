import type { Prompt, PromptInput } from '@shared/types'
import { mergeWithUserLayer, type UserLayer } from '@shared/merge'
import { readResourceJson, JsonStore } from './jsonStore'

interface PromptsDefaultFile {
  categories: string[]
  prompts: Array<Omit<Prompt, 'builtin'>>
}

type PromptUserFile = UserLayer

const EMPTY_USER: PromptUserFile = {}

/** 提示词库：内置默认 + 用户层（覆盖/自定义/删除内置） */
export class PromptStore {
  private defaults: Prompt[] = []
  private defaultCategories: string[] = []
  private userStore = new JsonStore<PromptUserFile>('prompts.user.json', EMPTY_USER)

  async init(): Promise<void> {
    const file = await readResourceJson<PromptsDefaultFile>('prompts.default.json')
    this.defaultCategories = Array.isArray(file?.categories) ? file!.categories : []
    const list = Array.isArray(file?.prompts) ? file!.prompts : []
    this.defaults = list.map((p) => ({
      id: String(p.id),
      category: String(p.category),
      title: String(p.title),
      content: String(p.content),
      builtin: true
    }))
    await this.userStore.load()
  }

  async list(): Promise<{ prompts: Prompt[]; categories: string[] }> {
    const user = await this.userStore.load()
    const { items } = mergeWithUserLayer<Prompt>(this.defaults, user, (base, o) => ({
      ...base,
      category: typeof o.category === 'string' ? o.category : base.category,
      title: typeof o.title === 'string' ? o.title : base.title,
      content: typeof o.content === 'string' ? o.content : base.content
    }))
    const categories = [
      ...this.defaultCategories,
      ...items.map((p) => p.category).filter((c) => !this.defaultCategories.includes(c))
    ]
    return { prompts: items, categories: [...new Set(categories)] }
  }

  async save(input: PromptInput): Promise<{ prompts: Prompt[]; categories: string[] }> {
    const title = input.title?.trim()
    const content = input.content?.trim()
    const category = input.category?.trim() || '自定义'
    if (!title || !content) throw new Error('标题和内容不能为空')

    const user = await this.userStore.load()
    const custom = [...(user.custom ?? [])] as Array<Record<string, unknown> & { id: string }>
    const overrides = [...(user.overrides ?? [])]
    const deletedIds = [...(user.deletedIds ?? [])]

    if (input.id && this.defaults.some((d) => d.id === input.id)) {
      // 编辑内置：存覆盖
      upsertById(overrides, { id: input.id, category, title, content })
      // 曾删除又编辑 → 恢复
      const di = deletedIds.indexOf(input.id)
      if (di >= 0) deletedIds.splice(di, 1)
    } else if (input.id && custom.some((c) => c.id === input.id)) {
      const i = custom.findIndex((c) => c.id === input.id)
      custom[i] = { id: input.id, category, title, content }
    } else {
      upsertById(custom, { id: `custom-prompt-${Date.now().toString(36)}`, category, title, content })
    }
    await this.userStore.save({ ...user, custom, overrides, deletedIds })
    return this.list()
  }

  async remove(id: string): Promise<{ prompts: Prompt[]; categories: string[] }> {
    const user = await this.userStore.load()
    const custom = [...(user.custom ?? [])]
    const deletedIds = [...(user.deletedIds ?? [])]
    if (this.defaults.some((d) => d.id === id)) {
      if (!deletedIds.includes(id)) deletedIds.push(id)
    } else {
      await this.userStore.save({ ...user, custom: custom.filter((c) => c.id !== id) })
      return this.list()
    }
    await this.userStore.save({ ...user, deletedIds })
    return this.list()
  }

  /** 恢复默认：清空提示词用户层 */
  async reset(): Promise<{ prompts: Prompt[]; categories: string[] }> {
    await this.userStore.save({})
    return this.list()
  }
}

type WithId = { id: string }

function upsertById<T extends WithId>(arr: T[], item: T): void {
  const i = arr.findIndex((x) => x.id === item.id)
  if (i >= 0) arr[i] = { ...arr[i], ...item }
  else arr.push(item)
}
