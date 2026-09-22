/**
 * 多站点与配置迁移测试——移植自 token-balance scripts/test-multi-site.js。
 * 1. 旧版 {provider, providers} 配置无损迁移为 sites 数组（真实凭据字段保留）
 * 2. 调度器并行轮询多站点，每站点状态机独立；token 轮换写回对应站点
 * 全程用 fetch 桩与临时配置文件，不接触真实 config.json。
 *
 * 与原脚本的差别：原版用 Module._resolveFilename 把共享 store 重定向到临时文件；
 * 移植版把配置路径改为构造参数注入（BalanceStore(filePath)），不再打补丁。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BalanceStore } from '../src/main/balance/store'
import { BalanceScheduler } from '../src/main/balance/scheduler'
import { UsageStore } from '../src/main/balance/usage'
import { describeAll, describeNewSite, describeTypes } from '../src/main/balance/providers'

let tmpDir = ''
let tmpConfig = ''

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'chatdeck-balance-test-'))
  tmpConfig = join(tmpDir, 'balance.user.json')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('余额配置:旧格式迁移与规范化', () => {
  it('旧版 {provider, providers} 无损迁移为 sites 数组并写回磁盘', () => {
    writeFileSync(
      tmpConfig,
      JSON.stringify({
        provider: 'spacetimeai',
        refreshIntervalMinutes: 7,
        window: { x: 100, y: 200 },
        providers: {
          spacetimeai: {
            apiBaseUrl: 'https://spacetimeai.cc/api/v1',
            usageUrl: 'https://spacetimeai.cc/usage',
            icon: 'anthropic',
            accessToken: 'AT-OLD',
            refreshToken: 'RT-OLD'
          }
        }
      })
    )
    const store = new BalanceStore(tmpConfig)
    const cfg = store.load()
    expect(Array.isArray(cfg.sites)).toBe(true)
    expect(cfg.sites).toHaveLength(1)
    const s0 = cfg.sites[0]
    expect(s0.accessToken).toBe('AT-OLD') // 凭据无损
    expect(s0.refreshToken).toBe('RT-OLD')
    expect(s0.apiBaseUrl).toBe('https://spacetimeai.cc/api/v1')
    expect(s0.icon).toBe('anthropic')
    expect(s0.label).toBe('SpacetimeAI') // label 推导
    expect(s0.enabled).toBe(true)
    expect('provider' in cfg).toBe(false) // 旧键已清除
    expect('providers' in cfg).toBe(false)
    expect(cfg.refreshIntervalMinutes).toBe(7)
    const persisted = JSON.parse(readFileSync(tmpConfig, 'utf8')) as Record<string, unknown>
    expect(Array.isArray(persisted.sites)).toBe(true)
    expect(persisted.providers).toBeUndefined()
  })

  it('非法 interval 被钳制，窗口显隐默认为隐藏', () => {
    writeFileSync(tmpConfig, JSON.stringify({ refreshIntervalMinutes: 999, sites: [] }))
    const store = new BalanceStore(tmpConfig)
    expect(store.load().refreshIntervalMinutes).toBe(60)
    expect(store.load().window.visible).toBe(false)
  })

  it('窗口位置与显隐状态可持久化', () => {
    const store = new BalanceStore(tmpConfig)
    store.patchWindow({ x: 11, y: 22 })
    store.setWindowVisible(true)
    const reloaded = new BalanceStore(tmpConfig)
    expect(reloaded.load().window).toEqual({ x: 11, y: 22, visible: true })
  })
})

interface StubSite {
  me: unknown
  refresh: unknown
  balance?: unknown
}

function stubMultiSiteFetch(responses: Record<string, StubSite | null>): { aMeCalls: () => number } {
  const state = { aMe: 0 }
  vi.stubGlobal('fetch', async (url: string) => {
    const base = Object.keys(responses).find((k) => url.startsWith(k))
    if (!base) throw new Error('unexpected url ' + url)
    const r = responses[base]
    if (!r) throw new Error('ECONNREFUSED')
    if (url.endsWith('/auth/me')) {
      if (base.startsWith('https://a.test')) state.aMe++
      // a 站第一次 401 → 触发 refresh → 重试(验证续期链路)
      if (base.startsWith('https://a.test') && state.aMe === 1) {
        return { status: 401, json: async () => null }
      }
      return { status: 200, json: async () => r.me }
    }
    if (url.endsWith('/auth/refresh')) return { status: 200, json: async () => r.refresh }
    if (url.endsWith('/user/balance')) return { status: 200, json: async () => r.balance }
    throw new Error('unexpected path ' + url)
  })
  return { aMeCalls: () => state.aMe }
}

describe('多站点调度:并行轮询与独立状态机', () => {
  it('四站点混合类型各走各的链路,token 轮换只写回所属站点', async () => {
    stubMultiSiteFetch({
      'https://a.test/api/v1': {
        me: { code: 0, data: { balance: 4.97 } },
        refresh: { code: 0, data: { access_token: 'A2', refresh_token: 'AR2', expires_in: 3600 } }
      },
      'https://b.test/api/v1': {
        me: { code: 0, data: { user: { balance: 12.4 } } },
        refresh: { code: 0, data: { access_token: 'B2', refresh_token: 'BR2', expires_in: 3600 } }
      },
      'https://c.test/api/v1': null, // c 站模拟断网
      'https://api.d.test': {
        me: null,
        refresh: null,
        balance: { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '88.50' }] }
      }
    })

    const store = new BalanceStore(tmpConfig)
    const scheduler = new BalanceScheduler(store, new UsageStore(null))
    store.upsertSite({ id: 'a', type: 'sub2api', label: 'A站', icon: 'openai', apiBaseUrl: 'https://a.test/api/v1', accessToken: 'A1', refreshToken: 'AR1', enabled: true })
    store.upsertSite({ id: 'b', type: 'sub2api', label: 'B站', icon: 'anthropic', apiBaseUrl: 'https://b.test/api/v1', accessToken: 'B1', refreshToken: 'BR1', enabled: true })
    store.upsertSite({ id: 'c', type: 'sub2api', label: 'C站', icon: 'kimi', apiBaseUrl: 'https://c.test/api/v1', accessToken: 'C1', refreshToken: 'CR1', enabled: true })
    store.upsertSite({ id: 'd', type: 'deepseek', label: 'D站', icon: 'deepseek', apiBaseUrl: 'https://api.d.test', accessToken: 'sk-D1', refreshToken: '', enabled: true })

    const snap = await scheduler.tick()
    const byId = Object.fromEntries(snap.sites.map((s) => [s.id, s]))
    expect(byId.a).toMatchObject({ status: 'ok', balance: 4.97, currency: 'USD' }) // 401→续期→成功
    expect(byId.b).toMatchObject({ status: 'ok', balance: 12.4 }) // 嵌套形态
    expect(byId.c.status).toBe('network-error') // 断网
    expect(byId.d).toMatchObject({ status: 'ok', balance: 88.5, currency: 'CNY' }) // 多类型混合

    expect(store.getSite('a')).toMatchObject({ accessToken: 'A2', refreshToken: 'AR2' }) // 轮换写回
    expect(store.getSite('b')).toMatchObject({ accessToken: 'B1' }) // 未轮换不变

    // 停用 C 站 → 不参与轮询,状态为 disabled
    store.updateSiteFields('c', { enabled: false })
    const snap2 = await scheduler.tick()
    expect(snap2.sites.find((s) => s.id === 'c')?.status).toBe('disabled')
  })

  it('保存接口:重复地址/非法地址被拒绝;新站点可先保存为未配置', async () => {
    stubMultiSiteFetch({
      'https://a.test/api/v1': { me: { code: 0, data: { balance: 1 } }, refresh: null },
      'https://b.test/api/v1': { me: { code: 0, data: { balance: 2 } }, refresh: null }
    })
    const store = new BalanceStore(tmpConfig)
    const scheduler = new BalanceScheduler(store, new UsageStore(null))
    store.upsertSite({ id: 'b', type: 'sub2api', label: 'B站', icon: 'openai', apiBaseUrl: 'https://b.test/api/v1', accessToken: 'B1', refreshToken: 'BR1', enabled: true })

    const dup = await scheduler.saveSite({
      id: null,
      type: 'sub2api',
      label: 'D站',
      icon: 'openai',
      apiBaseUrl: 'https://b.test/api/v1',
      usageUrl: '',
      accessToken: 'x',
      refreshToken: 'y',
      enabled: true
    })
    expect(dup.ok).toBe(false)
    expect(dup.message).toContain('相同')

    const bad = await scheduler.saveSite({
      id: null,
      type: 'sub2api',
      label: 'E站',
      icon: 'openai',
      apiBaseUrl: 'b.test',
      usageUrl: '',
      accessToken: 'x',
      refreshToken: 'y',
      enabled: true
    })
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain('http')

    // 无 token 允许保存为"未配置"态
    const newSite = await scheduler.saveSite({
      id: null,
      type: 'sub2api',
      label: 'F站',
      icon: 'openai',
      apiBaseUrl: 'https://f.test/api/v1',
      usageUrl: '',
      accessToken: '',
      refreshToken: '',
      enabled: true
    })
    expect(newSite.id).toBeTruthy()
    expect(store.getSite(String(newSite.id))?.label).toBe('F站')

    // type 透传（deepseek 类型站点持久化）
    const ds = await scheduler.saveSite({
      id: null,
      type: 'deepseek',
      label: 'E站',
      icon: 'deepseek',
      apiBaseUrl: 'https://api.e.test',
      usageUrl: '',
      accessToken: 'sk-E',
      refreshToken: '',
      enabled: true
    })
    expect(store.getSite(String(ds.id))?.type).toBe('deepseek')

    // 删除生效
    await scheduler.removeSite(String(newSite.id))
    await scheduler.removeSite(String(ds.id))
    expect(store.getSite(String(newSite.id))).toBeNull()
    expect(store.getSite(String(ds.id))).toBeNull()
  })

  it('编辑已保存站点时凭据留空保持不变', async () => {
    stubMultiSiteFetch({
      'https://a.test/api/v1': { me: { code: 0, data: { balance: 3 } }, refresh: null }
    })
    const store = new BalanceStore(tmpConfig)
    const scheduler = new BalanceScheduler(store, new UsageStore(null))
    store.upsertSite({ id: 'a', type: 'sub2api', label: 'A站', icon: 'openai', apiBaseUrl: 'https://a.test/api/v1', accessToken: 'A1', refreshToken: 'AR1', enabled: true })

    await scheduler.saveSite({
      id: 'a',
      type: 'sub2api',
      label: 'A站改名',
      icon: 'openai',
      apiBaseUrl: 'https://a.test/api/v1',
      usageUrl: '',
      accessToken: '',
      refreshToken: '',
      enabled: true
    })
    expect(store.getSite('a')).toMatchObject({ label: 'A站改名', accessToken: 'A1', refreshToken: 'AR1' })
  })
})

describe('站点类型注册表', () => {
  it('describeTypes 含 sub2api 与 deepseek 与 volcark', () => {
    const types = describeTypes()
    expect(types.some((t) => t.id === 'sub2api')).toBe(true)
    expect(types.some((t) => t.id === 'deepseek')).toBe(true)
    expect(types.some((t) => t.id === 'volcark')).toBe(true)
  })

  it('describeNewSite 按类型预填默认值', () => {
    const ds = describeNewSite('deepseek')
    expect(ds).toMatchObject({
      type: 'deepseek',
      apiBaseUrl: 'https://api.deepseek.com',
      icon: 'deepseek',
      label: 'DeepSeek'
    })
    const sold = describeNewSite('sub2api')
    expect(sold).toMatchObject({ type: 'sub2api', apiBaseUrl: '', icon: 'openai' })
    const ark = describeNewSite('volcark')
    expect(ark).toMatchObject({ type: 'volcark', apiBaseUrl: 'https://open.volcengineapi.com', icon: 'bytedance' })
  })

  it('volcark 站点:note 进 message,货币单位为 PCT,未配置前占位也用 PCT', async () => {
    vi.stubGlobal('fetch', async () => ({
      status: 200,
      json: async () => ({
        ResponseMetadata: { RequestId: 'r' },
        Result: { QuotaUsage: [{ Level: 'session', Percent: 41.2, ResetTimestamp: 1758000000 }] }
      })
    }))
    const store = new BalanceStore(tmpConfig)
    const scheduler = new BalanceScheduler(store, new UsageStore(null))
    store.upsertSite({
      id: 'ark',
      type: 'volcark',
      label: '火山方舟',
      icon: 'bytedance',
      apiBaseUrl: 'https://open.volcengineapi.com',
      usageUrl: '',
      accessToken: 'AK',
      refreshToken: 'SK',
      enabled: true
    })
    const snap = await scheduler.tick()
    // 默认配置预置了占位站点 spacetimeai 在前,按 id 取 volcark 站点
    expect(snap.sites.find((s) => s.id === 'ark')).toMatchObject({
      status: 'ok',
      balance: 41.2,
      currency: 'PCT',
      message: new Date(1758000000 * 1000).toISOString() // note → message(ok 态展示重置时间)
    })

    // 新增一个未配置凭据的 volcark 站点:全新 base 态的 currency 应取适配器 balanceUnit
    store.upsertSite({
      id: 'ark2',
      type: 'volcark',
      label: '方舟2',
      icon: 'bytedance',
      apiBaseUrl: 'https://open.volcengineapi.com',
      usageUrl: '',
      accessToken: '',
      refreshToken: '',
      enabled: true
    })
    const snap2 = await scheduler.tick()
    expect(snap2.sites.find((s) => s.id === 'ark2')).toMatchObject({
      status: 'no-token',
      currency: 'PCT',
      balance: null
    })
  })

  it('describeAll 不含任何凭据字段', () => {
    const store = new BalanceStore(tmpConfig)
    store.upsertSite({
      id: 'a',
      type: 'sub2api',
      label: 'A站',
      icon: 'openai',
      apiBaseUrl: 'https://a.test/api/v1',
      accessToken: 'SECRET-A',
      refreshToken: 'SECRET-R',
      enabled: true
    })
    const all = describeAll(store)
    const serialized = JSON.stringify(all)
    expect(serialized).not.toContain('SECRET-A')
    expect(serialized).not.toContain('SECRET-R')
    // 默认配置预置了一个占位站点(spacetimeai),追加站点在其后
    const a = all.sites.find((s) => s.id === 'a')
    expect(a).toMatchObject({ saved: true, knownType: true })
  })
})
