import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AUTO_SLEEP_MINUTES, effectiveAutoSleepMinutes } from '@shared/types'

// ---- 纯函数:阈值回退逻辑 ----

describe('effectiveAutoSleepMinutes', () => {
  it('未配置回退全局默认', () => {
    expect(effectiveAutoSleepMinutes({})).toBe(DEFAULT_AUTO_SLEEP_MINUTES)
    expect(effectiveAutoSleepMinutes({ autoSleepMinutes: undefined })).toBe(DEFAULT_AUTO_SLEEP_MINUTES)
  })

  it('0 表示永不休眠', () => {
    expect(effectiveAutoSleepMinutes({ autoSleepMinutes: 0 })).toBe(0)
  })

  it('非法负值回退全局默认', () => {
    expect(effectiveAutoSleepMinutes({ autoSleepMinutes: -1 })).toBe(DEFAULT_AUTO_SLEEP_MINUTES)
  })
})

// ---- ProviderStore:合并与缓存(JsonStore 读盘打点验证) ----

const defaultProviders = [
  { id: 'deepseek', name: 'DeepSeek', url: 'https://a/', color: '#000', autoSleepMinutes: 0 },
  { id: 'kimi', name: 'Kimi', url: 'https://b/', color: '#111', autoSleepMinutes: 5 }
]

interface FakeLayer {
  custom?: Array<Record<string, unknown>>
  overrides?: Array<Record<string, unknown>>
}

let userLayer: FakeLayer = {}
let loadCalls = 0

vi.mock('../src/main/store/jsonStore', () => ({
  readResourceJson: async () => ({ providers: defaultProviders }),
  JsonStore: class {
    async load(): Promise<FakeLayer> {
      loadCalls++
      return structuredClone(userLayer)
    }
    async save(v: FakeLayer): Promise<void> {
      userLayer = structuredClone(v)
    }
  }
}))

import { ProviderStore } from '../src/main/store/providerStore'

describe('ProviderStore autoSleepMinutes', () => {
  beforeEach(() => {
    userLayer = {}
    loadCalls = 0
  })

  it('内置条目携带默认阈值(deepseek=0 不休眠,其余 5)', async () => {
    const s = new ProviderStore()
    await s.init()
    const items = await s.list()
    expect(items.find((p) => p.id === 'deepseek')?.autoSleepMinutes).toBe(0)
    expect(items.find((p) => p.id === 'kimi')?.autoSleepMinutes).toBe(5)
  })

  it('用户覆盖休眠阈值并写入 overrides 层', async () => {
    const s = new ProviderStore()
    await s.init()
    await s.save({ id: 'kimi', name: 'Kimi', url: 'https://b/', autoSleepMinutes: 0 })
    const items = await s.list()
    expect(items.find((p) => p.id === 'kimi')?.autoSleepMinutes).toBe(0)
    expect(items.find((p) => p.id === 'deepseek')?.autoSleepMinutes).toBe(0) // 不受影响
    expect(userLayer.overrides?.[0]).toMatchObject({ id: 'kimi', autoSleepMinutes: 0 })
  })

  it('非法负值覆盖被忽略,保留内置默认', async () => {
    const s = new ProviderStore()
    await s.init()
    await s.save({ id: 'kimi', name: 'Kimi', url: 'https://b/', autoSleepMinutes: -3 })
    const items = await s.list()
    expect(items.find((p) => p.id === 'kimi')?.autoSleepMinutes).toBe(5)
  })

  it('自定义站点保存阈值写入条目本身', async () => {
    const s = new ProviderStore()
    await s.init()
    await s.save({ name: '混元', url: 'https://h/', autoSleepMinutes: 30 })
    const items = await s.list()
    const custom = items.find((p) => p.name === '混元')
    expect(custom?.autoSleepMinutes).toBe(30)
    await s.save({ id: custom!.id, name: '混元', url: 'https://h/', autoSleepMinutes: 10 })
    expect((await s.list()).find((p) => p.name === '混元')?.autoSleepMinutes).toBe(10)
  })

  it('list() 走缓存:多次调用只读一次盘,save 后失效重算', async () => {
    const s = new ProviderStore()
    await s.init() // init 内 load 1 次
    loadCalls = 0
    await s.list()
    await s.list()
    expect(loadCalls).toBe(1) // 第二次命中缓存
    await s.save({ id: 'kimi', name: 'Kimi', url: 'https://b/', autoSleepMinutes: 15 }) // save load 1 次 + 重算 load 1 次
    expect(loadCalls).toBe(3)
  })
})
