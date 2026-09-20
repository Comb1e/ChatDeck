import type { Provider, ProviderInput } from '@shared/types'
import { mergeWithUserLayer, type UserLayer } from '@shared/merge'
import { readResourceJson, JsonStore } from './jsonStore'

interface ProvidersDefaultFile {
  providers: Array<Omit<Provider, 'enabled' | 'builtin'>>
}

type ProviderUserFile = UserLayer

const EMPTY_USER: ProviderUserFile = {}

/** 厂商配置：内置默认(resources/providers.default.json) + 用户层(providers.user.json) */
export class ProviderStore {
  private defaults: Provider[] = []
  private userStore = new JsonStore<ProviderUserFile>('providers.user.json', EMPTY_USER)
  /** 合并结果缓存：list() 在每次 setLayout 的热路径上被调用，避免逐次读盘 */
  private cache: Provider[] | null = null

  async init(): Promise<void> {
    const file = await readResourceJson<ProvidersDefaultFile>('providers.default.json')
    const list = Array.isArray(file?.providers) ? file!.providers : []
    this.defaults = list.map((p) => ({
      id: String(p.id),
      name: String(p.name),
      url: String(p.url),
      color: typeof p.color === 'string' ? p.color : '#D97757',
      autoSleepMinutes: typeof p.autoSleepMinutes === 'number' ? p.autoSleepMinutes : undefined,
      enabled: true,
      builtin: true
    }))
    await this.userStore.load()
    this.cache = null
  }

  async list(): Promise<Provider[]> {
    if (this.cache) return this.cache
    const user = await this.userStore.load()
    const { items } = mergeWithUserLayer<Provider>(this.defaults, user, (base, o) => ({
      ...base,
      enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
      userAgent: typeof o.userAgent === 'string' ? o.userAgent : base.userAgent,
      autoSleepMinutes:
        typeof o.autoSleepMinutes === 'number' && o.autoSleepMinutes >= 0
          ? o.autoSleepMinutes
          : base.autoSleepMinutes
    }))
    this.cache = items
    return items
  }

  async save(input: ProviderInput): Promise<Provider[]> {
    const user = await this.userStore.load()
    const custom = [...(user.custom ?? [])] as Array<Record<string, unknown> & { id: string }>
    const overrides = [...(user.overrides ?? [])]

    if (input.id && this.defaults.some((d) => d.id === input.id)) {
      // 内置厂商：只允许启停与 UA 覆盖
      upsertById(overrides, {
        id: input.id,
        enabled: input.enabled ?? true,
        ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
        ...(input.autoSleepMinutes !== undefined ? { autoSleepMinutes: input.autoSleepMinutes } : {})
      })
    } else if (input.id && custom.some((c) => c.id === input.id)) {
      // 已有自定义厂商：局部更新
      const i = custom.findIndex((c) => c.id === input.id)
      custom[i] = {
        ...custom[i],
        ...(input.name?.trim() ? { name: input.name.trim() } : {}),
        ...(input.url?.trim() ? { url: normalizeUrl(input.url) } : {}),
        ...(input.color?.trim() ? { color: input.color.trim() } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.autoSleepMinutes !== undefined ? { autoSleepMinutes: input.autoSleepMinutes } : {})
      }
    } else {
      // 新增自定义厂商
      const name = input.name?.trim()
      const url = input.url?.trim()
      if (!name || !url) throw new Error('新增厂商需要 name 和 url')
      upsertById(custom, {
        id: genId(name),
        name,
        url: normalizeUrl(url),
        color: input.color?.trim() || '#D97757',
        enabled: input.enabled ?? true,
        builtin: false,
        ...(input.autoSleepMinutes !== undefined ? { autoSleepMinutes: input.autoSleepMinutes } : {})
      })
    }
    await this.userStore.save({ ...user, custom, overrides })
    this.cache = null
    return this.list()
  }

  async remove(id: string): Promise<Provider[]> {
    const user = await this.userStore.load()
    await this.userStore.save({
      ...user,
      custom: (user.custom ?? []).filter((c) => c.id !== id)
    })
    this.cache = null
    return this.list()
  }

  async clearData(id: string): Promise<void> {
    const { session } = await import('electron')
    const ses = session.fromPartition(`persist:provider-${id}`)
    await ses.clearStorageData()
    await ses.clearCache()
  }
}

type WithId = { id: string }

function upsertById<T extends WithId>(arr: T[], item: T): void {
  const i = arr.findIndex((x) => x.id === item.id)
  if (i >= 0) arr[i] = { ...arr[i], ...item }
  else arr.push(item)
}

function genId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `custom-${slug || 'provider'}-${Date.now().toString(36)}`
}

function normalizeUrl(url: string): string {
  const u = url.trim()
  if (!u) return u
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}
