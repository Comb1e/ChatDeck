/**
 * 账单/用量统计测试。
 *
 * 两条口径(见 src/main/balance/usage.ts):
 * - api:站点记账(sub2api total_actual_cost / 逐日 trend,已实测对账 delta=0)
 * - metered:本机计量(DeepSeek 无用量接口,按余额下降量估算)
 * 全程 fetch 桩 + 临时文件,不接触真实配置。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyObservation, UsageStore, dayKey, type SiteUsageRecord } from '../src/main/balance/usage'
import { buildBillingReport } from '../src/main/balance/billing'
import { BillDb } from '../src/main/balance/billdb'
import { BalanceStore } from '../src/main/balance/store'
import { BalanceScheduler } from '../src/main/balance/scheduler'

let tmpDir = ''

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'chatdeck-usage-test-'))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  rmSync(tmpDir, { recursive: true, force: true })
})

function tmpFile(name: string): string {
  return join(tmpDir, name)
}

function recordOf(total: number, daily: Record<string, number>, last: number): SiteUsageRecord {
  return {
    apiUsed: null,
    apiUsedCurrency: null,
    apiUsedAt: null,
    meterTotal: total,
    meterDaily: daily,
    meterSince: '2026-09-01',
    lastBalance: last,
    lastCurrency: 'USD'
  }
}

describe('applyObservation:本机计量纯函数', () => {
  it('独立对照:余额序列 [10, 9.5, 9.5, 11, 10.2] 的用量台账与手工推演一致', () => {
    let obs = applyObservation(null, 'USD', 10, '2026-09-01') // 建基线
    obs = applyObservation(obs.record, 'USD', 9.5, '2026-09-01') // -0.5 → d1
    obs = applyObservation(obs.record, 'USD', 9.5, '2026-09-02') // 持平
    obs = applyObservation(obs.record, 'USD', 11, '2026-09-02') // 充值 +1.5
    obs = applyObservation(obs.record, 'USD', 10.2, '2026-09-03') // -0.8 → d3
    expect(obs.record.meterTotal).toBeCloseTo(1.3, 10)
    expect(obs.record.meterDaily['2026-09-01']).toBeCloseTo(0.5, 10)
    expect(obs.record.meterDaily['2026-09-02']).toBeUndefined() // 充值日无用量
    expect(obs.record.meterDaily['2026-09-03']).toBeCloseTo(0.8, 10)
    expect(obs.record.lastBalance).toBe(10.2)
    expect(obs.record.meterSince).toBe('2026-09-01')
  })

  it('边界:首次观测只建基线;余额为 0 合法', () => {
    const first = applyObservation(null, 'CNY', 0, '2026-09-21')
    expect(first.record.lastBalance).toBe(0)
    expect(first.record.meterTotal).toBe(0)
    expect(first.meteredDelta).toBe(0)
    expect(first.changed).toBe(true)
  })

  it('边界:余额持平 changed=false(调用方不落盘)', () => {
    const obs = applyObservation(recordOf(2, { '2026-09-01': 2 }, 8), 'USD', 8, '2026-09-02')
    expect(obs.changed).toBe(false)
    expect(obs.record.meterTotal).toBe(2)
  })

  it('反例:充值后再消耗,只计净下降(10 → 12 → 11 用量是 1 不是 2)', () => {
    const up = applyObservation(recordOf(0, {}, 10), 'USD', 12, '2026-09-01')
    expect(up.record.meterTotal).toBe(0)
    const down = applyObservation(up.record, 'USD', 11, '2026-09-01')
    expect(down.record.meterTotal).toBeCloseTo(1, 10)
  })

  it('边界:负余额视为观测异常,重置基线但不记用量(防止当巨额消耗)', () => {
    const obs = applyObservation(recordOf(0, {}, 10), 'USD', -1, '2026-09-01')
    expect(obs.record.meterTotal).toBe(0)
    expect(obs.record.lastBalance).toBe(-1)
    const back = applyObservation(obs.record, 'USD', 5, '2026-09-02') // 上升 → 充值语义
    expect(back.record.meterTotal).toBe(0)
    expect(back.record.lastBalance).toBe(5)
  })

  it('边界:币种变化重开台账(不同币种数字不能接续相加,apiUsed 一并作废)', () => {
    const prev: SiteUsageRecord = {
      ...recordOf(7, { '2026-09-01': 7 }, 3),
      apiUsed: 159.89,
      apiUsedCurrency: 'USD',
      apiUsedAt: '2026-09-01T00:00:00Z'
    }
    const obs = applyObservation(prev, 'CNY', 88.5, '2026-09-05')
    expect(obs.record.meterTotal).toBe(0)
    expect(obs.record.meterDaily).toEqual({})
    expect(obs.record.meterSince).toBe('2026-09-05')
    expect(obs.record.apiUsed).toBeNull()
    expect(obs.record.lastCurrency).toBe('CNY')
    expect(obs.record.lastBalance).toBe(88.5)
  })

  it('边界:用量归属注入的"今天",跨日各自入桶', () => {
    let obs = applyObservation(null, 'USD', 10, '2026-09-20')
    obs = applyObservation(obs.record, 'USD', 9, '2026-09-20')
    obs = applyObservation(obs.record, 'USD', 8, '2026-09-21')
    expect(obs.record.meterDaily).toEqual({ '2026-09-20': 1, '2026-09-21': 1 })
    expect(obs.record.meterTotal).toBeCloseTo(2, 10)
  })

  it('对照:浮点漂移被钳制(10 → 9.9 → 9.8 累计 0.2,而非 0.19999…)', () => {
    let obs = applyObservation(null, 'USD', 10, '2026-09-01')
    obs = applyObservation(obs.record, 'USD', 9.9, '2026-09-01')
    obs = applyObservation(obs.record, 'USD', 9.8, '2026-09-01')
    expect(obs.record.meterTotal).toBe(0.2)
  })
})

describe('UsageStore:持久化与台账管理', () => {
  it('台账写盘后可被新实例读回(原子文件)', () => {
    const path = tmpFile('balance.usage.json')
    const store = new UsageStore(path)
    store.apply('s1', 'CNY', 88.5, '2026-09-21')
    store.apply('s1', 'CNY', 80.5, '2026-09-21')
    const reloaded = new UsageStore(path)
    const rec = reloaded.get('s1')
    expect(rec?.meterTotal).toBeCloseTo(8, 10)
    expect(rec?.lastCurrency).toBe('CNY')
    expect(rec?.meterSince).toBe('2026-09-21')
  })

  it('持平观测不重写文件(字节级一致)', () => {
    const path = tmpFile('balance.usage.json')
    const store = new UsageStore(path)
    store.apply('s1', 'USD', 10, '2026-09-21')
    const before = readFileSync(path, 'utf8')
    store.apply('s1', 'USD', 10, '2026-09-21')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('recordApiUsed 记下站点记账;同值同币种不重复写', () => {
    const path = tmpFile('balance.usage.json')
    const store = new UsageStore(path)
    store.recordApiUsed('s1', 'USD', 159.89, '2026-09-21T00:00:00Z')
    const before = readFileSync(path, 'utf8')
    store.recordApiUsed('s1', 'USD', 159.89, '2026-09-21T01:00:00Z') // 同值不同时间也不重写
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(store.get('s1')?.apiUsed).toBe(159.89)
  })

  it('remove 清台账;站点不存在时无副作用;坏文件回空台账', () => {
    const path = tmpFile('balance.usage.json')
    const store = new UsageStore(path)
    store.apply('s1', 'USD', 10, '2026-09-21')
    store.remove('s1')
    expect(store.get('s1')).toBeNull()
    store.remove('nope') // 不抛错
    writeFileSync(path, '{broken json')
    expect(new UsageStore(path).get('s1')).toBeNull()
  })

  it('内存模式(filePath=null)不产生任何文件', () => {
    const store = new UsageStore(null)
    store.apply('s1', 'USD', 10, '2026-09-21')
    store.recordApiUsed('s1', 'USD', 1, 'x')
    expect(existsSync(tmpFile('balance.usage.json'))).toBe(false)
    expect(store.get('s1')?.lastBalance).toBe(10)
  })
})

function stubUsageFetch(): void {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.startsWith('https://s.test/api/v1')) {
      if (url.endsWith('/auth/me')) {
        return { status: 200, json: async () => ({ code: 0, data: { balance: 5 } }) }
      }
      if (url.endsWith('/usage/dashboard/stats')) {
        return {
          status: 200,
          json: async () => ({ code: 0, data: { total_actual_cost: 159.89 } })
        }
      }
      if (url.includes('/usage/dashboard/trend')) {
        return {
          status: 200,
          json: async () => ({
            code: 0,
            data: {
              trend: [
                { date: '2026-08-14', actual_cost: 138.1 },
                { date: '2026-09-18', actual_cost: 4.75 },
                { date: '2026-09-21', actual_cost: 17.04 }
              ]
            }
          })
        }
      }
    }
    if (url.startsWith('https://api.d.test') && url.endsWith('/user/balance')) {
      return {
        status: 200,
        json: async () => ({ balance_infos: [{ currency: 'CNY', total_balance: '80.50' }] })
      }
    }
    if (url.startsWith('https://open.volcengineapi.com')) {
      return {
        status: 200,
        json: async () => ({
          ResponseMetadata: {},
          Result: { QuotaUsage: [{ Level: 'session', Percent: 42, ResetTimestamp: 1789000000 }] }
        })
      }
    }
    // 火山计费中心:2026-08 有一笔 ¥9.90 账单(与真实探针同构),其余账期为空
    if (url.startsWith('https://billing.volcengineapi.com') && url.includes('Action=ListBillDetail')) {
      const period = new URL(url).searchParams.get('BillPeriod')
      const list =
        period === '2026-08'
          ? [{ ExpenseDate: '2026-08-26', PayableAmount: '9.90', Currency: 'CNY', Product: 'ark_bd' }]
          : []
      return { status: 200, json: async () => ({ ResponseMetadata: {}, Result: { List: list, Total: list.length } }) }
    }
    throw new Error('unexpected url ' + url)
  })
}

function seedStore(): BalanceStore {
  const store = new BalanceStore(tmpFile('balance.user.json'))
  store.upsertSite({ id: 'sp', type: 'sub2api', label: 'Sp站', icon: 'openai', apiBaseUrl: 'https://s.test/api/v1', usageUrl: 'https://s.test/usage', accessToken: 'AT', refreshToken: 'RT', enabled: true })
  store.upsertSite({ id: 'ds', type: 'deepseek', label: 'DeepSeek', icon: 'deepseek', apiBaseUrl: 'https://api.d.test', usageUrl: 'https://platform.deepseek.com/usage', accessToken: 'sk-1', refreshToken: '', enabled: true })
  store.upsertSite({ id: 'vk', type: 'volcark', label: '火山方舟', icon: 'bytedance', apiBaseUrl: 'https://open.volcengineapi.com', usageUrl: 'https://console.volcengine.com/x', accessToken: 'AK', refreshToken: 'SK', enabled: true })
  store.upsertSite({ id: 'nc', type: 'sub2api', label: '未配置', icon: 'openai', apiBaseUrl: 'https://nc.test/api/v1', usageUrl: '', accessToken: '', refreshToken: '', enabled: true })
  return store
}

describe('buildBillingReport:账单报告', () => {
  it('sub2api=站点记账(api);volcark=计费中心真实账单(volcbill,CNY);未配置站点跳过', async () => {
    stubUsageFetch()
    const store = seedStore()
    const usage = new UsageStore(null)
    const bills = new BillDb(null)
    await bills.ready()
    usage.recordApiUsed('sp', 'USD', 159.89, '2026-09-21T00:00:00Z')
    const report = await buildBillingReport({ store, usage, bills }, new Date(2026, 8, 21, 12, 0, 0))
    const sp = report.sites.find((s) => s.id === 'sp')
    expect(sp).toMatchObject({ source: 'api', currency: 'USD', usedTotal: 159.89, since: '2026-08-14' })
    expect(sp?.months).toEqual([
      { month: '2026-08', used: 138.1 },
      { month: '2026-09', used: 21.79 }
    ])
    expect(sp?.recent.map((d) => d.date)).toEqual(['2026-09-18', '2026-09-21']) // 08-14 在 30 天窗口外
    // 火山:计费中心数据只进账单窗口;2026-08-26 在近 30 天窗口内,按天/月/年同源可查
    const vk = report.sites.find((s) => s.id === 'vk')
    expect(vk).toMatchObject({
      source: 'volcbill',
      currency: 'CNY',
      usedTotal: 9.9,
      since: '2026-08-26'
    })
    expect(vk?.months).toEqual([{ month: '2026-08', used: 9.9 }])
    expect(vk?.recent).toEqual([{ date: '2026-08-26', used: 9.9 }])
    expect(vk?.years).toEqual([{ year: '2026', used: 9.9 }])
    expect(report.excluded).toEqual([])
    expect(report.sites.some((s) => s.id === 'nc')).toBe(false) // 未配置不出现
  })

  it('DeepSeek=本机计量(metered),24 个月窗口含历史月,旧日计入月表与累计', async () => {
    stubUsageFetch()
    const store = seedStore()
    const usage = new UsageStore(tmpFile('u.json'))
    const bills = new BillDb(null)
    await bills.ready()
    // 基线 88.5 → 3 月降 4.5(在 24 个月窗口内) → 9 月两日各降 4(窗口内)
    usage.apply('ds', 'CNY', 88.5, '2026-03-01')
    usage.apply('ds', 'CNY', 84, '2026-03-15')
    usage.apply('ds', 'CNY', 80, '2026-09-19')
    usage.apply('ds', 'CNY', 76, '2026-09-21')
    const report = await buildBillingReport({ store, usage, bills }, new Date(2026, 8, 21, 12, 0, 0))
    const ds = report.sites.find((s) => s.id === 'ds')
    expect(ds).toMatchObject({
      source: 'metered',
      currency: 'CNY',
      usedTotal: 12.5, // 累计=月表合计(全部都在 24 个月窗口内)
      since: '2026-03-01'
    })
    expect(ds?.months).toEqual([
      { month: '2026-03', used: 4.5 },
      { month: '2026-09', used: 8 }
    ])
    expect(ds?.years).toEqual([{ year: '2026', used: 12.5 }])
    expect(ds?.recent.map((d) => d.date)).toEqual(['2026-09-19', '2026-09-21'])
  })

  it('站点趋势接口故障:回退库内 api 数据,连历史都没有才回退本机计量并标注', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('https://s.test/api/v1') && url.endsWith('/auth/me')) {
        return { status: 200, json: async () => ({ code: 0, data: { balance: 5 } }) }
      }
      throw new Error('unexpected url ' + url)
    })
    const store = seedStore()
    const usage = new UsageStore(null)
    const bills = new BillDb(null)
    await bills.ready()
    usage.apply('sp', 'USD', 10, '2026-09-20')
    usage.apply('sp', 'USD', 7, '2026-09-21')
    const report = await buildBillingReport({ store, usage, bills }, new Date(2026, 8, 21, 12, 0, 0))
    const sp = report.sites.find((s) => s.id === 'sp')
    expect(sp).toMatchObject({ source: 'metered', usedTotal: 3 })
    expect(sp?.months).toEqual([{ month: '2026-09', used: 3 }])
    // 有 getUsage 能力的站点回退时必须标注,避免"本机计量 0.00"被误读成从未用过
    expect(sp?.note).toContain('站点用量接口暂不可用')
    // 反例:volcark 的计费中心同样失联,但站点仍出现(空数据+失败说明),不再被整体排除
    const vk = report.sites.find((s) => s.id === 'vk')
    expect(vk?.source).toBe('volcbill')
    expect(vk?.note).toContain('计费中心查询失败')
  })

  it('趋势接口先失败后成功:重试一次即恢复 api 口径', async () => {
    let trendCalls = 0
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('https://s.test/api/v1') && url.endsWith('/auth/me')) {
        return { status: 200, json: async () => ({ code: 0, data: { balance: 5 } }) }
      }
      if (url.includes('/usage/dashboard/trend')) {
        trendCalls++
        if (trendCalls === 1) throw new Error('ECONNRESET') // 第一次网络抖动
        return {
          status: 200,
          json: async () => ({ code: 0, data: { trend: [{ date: '2026-09-20', actual_cost: 12.5 }] } })
        }
      }
      if (url.endsWith('/usage/dashboard/stats')) {
        return { status: 200, json: async () => ({ code: 0, data: { total_actual_cost: 12.5 } }) }
      }
      throw new Error('unexpected url ' + url)
    })
    const store = seedStore()
    const usage = new UsageStore(null)
    const bills = new BillDb(null)
    await bills.ready()
    usage.recordApiUsed('sp', 'USD', 12.5, '2026-09-21T00:00:00Z')
    const report = await buildBillingReport({ store, usage, bills }, new Date(2026, 8, 21, 12, 0, 0))
    const sp = report.sites.find((s) => s.id === 'sp')
    expect(trendCalls).toBe(2) // 失败一次 + 重试一次
    expect(sp).toMatchObject({ source: 'api', usedTotal: 12.5 })
    expect(sp?.note).toBeUndefined()
  })
})

describe('调度器集成:used/usedSource 状态注入', () => {
  it('sub2api stats 成功 → api 口径;deepseek 两轮下降 → metered 口径;充值不计', async () => {
    stubUsageFetch()
    const store = seedStore()
    const scheduler = new BalanceScheduler(store, new UsageStore(null))
    const snap = await scheduler.tick()
    const byId = Object.fromEntries(snap.sites.map((s) => [s.id, s]))
    expect(byId.sp).toMatchObject({ status: 'ok', balance: 5, used: 159.89, usedSource: 'api' })
    expect(byId.ds).toMatchObject({ status: 'ok', used: 0, usedSource: 'metered' }) // 首轮建基线

    // deepseek 余额 80.5 → 78:本机计量 +2.5
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('https://api.d.test') && url.endsWith('/user/balance')) {
        return {
          status: 200,
          json: async () => ({ balance_infos: [{ currency: 'CNY', total_balance: '78.00' }] })
        }
      }
      throw new Error('unexpected url ' + url)
    })
    const snap2 = await scheduler.tick()
    expect(snap2.sites.find((s) => s.id === 'ds')).toMatchObject({ used: 2.5, usedSource: 'metered' })

    // 反例:余额回升(充值)→ 用量不增长
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('https://api.d.test') && url.endsWith('/user/balance')) {
        return {
          status: 200,
          json: async () => ({ balance_infos: [{ currency: 'CNY', total_balance: '90.00' }] })
        }
      }
      throw new Error('unexpected url ' + url)
    })
    const snap3 = await scheduler.tick()
    expect(snap3.sites.find((s) => s.id === 'ds')).toMatchObject({ used: 2.5 })
  })

  it('volcark(PCT)不参与计量:used/usedSource 恒为 null', async () => {
    stubUsageFetch()
    const store = new BalanceStore(tmpFile('balance.user.json'))
    store.upsertSite({ id: 'vk', type: 'volcark', label: '火山方舟', icon: 'bytedance', apiBaseUrl: 'https://open.volcengineapi.com', usageUrl: '', accessToken: 'AK', refreshToken: 'SK', enabled: true })
    const scheduler = new BalanceScheduler(store, new UsageStore(null))
    const snap = await scheduler.tick()
    // BALANCE_DEFAULTS 预置站点占位在前,按 id 查找
    expect(snap.sites.find((s) => s.id === 'vk')).toMatchObject({
      status: 'ok',
      currency: 'PCT',
      used: null,
      usedSource: null
    })
  })

  it('stats 失效但记过账 → 用最近一次站点记账值;删除站点清台账', async () => {
    stubUsageFetch()
    const store = seedStore()
    const usage = new UsageStore(tmpFile('u2.json'))
    const scheduler = new BalanceScheduler(store, usage)
    await scheduler.tick()
    expect(usage.get('sp')?.apiUsed).toBe(159.89)
    // stats 与 trend 全部失效:余额来自 /auth/me,已用回退最近记账
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.startsWith('https://s.test/api/v1') && url.endsWith('/auth/me')) {
        return { status: 200, json: async () => ({ code: 0, data: { balance: 4 } }) }
      }
      throw new Error('unexpected url ' + url)
    })
    const snap = await scheduler.tick()
    expect(snap.sites.find((s) => s.id === 'sp')).toMatchObject({ used: 159.89, usedSource: 'api' })
    await scheduler.removeSite('sp')
    expect(usage.get('sp')).toBeNull()
  })

  it('dayKey:本地日期键格式', () => {
    expect(dayKey(new Date(2026, 8, 5))).toBe('2026-09-05')
  })
})
