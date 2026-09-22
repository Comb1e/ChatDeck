/**
 * 本地账单库(billdb)测试:内存库 + 临时文件库,不接触真实配置。
 *
 * 重点验证:
 * - 聚合(日/月/年)与手工推演对照,含跨年边界
 * - 来源优先级:metered 不倒灌 api/volcbill(api/volcbill 对其窗口权威)
 * - clearMeteredRange 只清 metered,不动真实记账行
 * - 持久化:写盘后新实例读回;损坏文件回空库
 */
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BillDb, type BillRowInput } from '../src/main/balance/billdb'

let tmpDir = ''

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'chatdeck-billdb-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function tmpFile(name: string): string {
  return join(tmpDir, name)
}

function rows(...pairs: [string, number][]): BillRowInput[] {
  return pairs.map(([day, amount]) => ({ day, currency: 'CNY', amount }))
}

describe('BillDb:聚合与手工对照', () => {
  it('独立对照:日/月/年聚合与手算一致,跨年边界各归各桶,升序输出', async () => {
    const db = new BillDb(null)
    await db.ready()
    // 2025-12-31(年 2025 / 月 2025-12)+ 2026-01 两日(年 2026 / 月 2026-01)
    db.upsertDays('s1', rows(['2025-12-31', 1.5], ['2026-01-01', 2], ['2026-01-02', 0.5]), 'volcbill')
    expect(db.siteDays('s1', '2025-12-01', '2026-01-31')).toEqual([
      { date: '2025-12-31', used: 1.5 },
      { date: '2026-01-01', used: 2 },
      { date: '2026-01-02', used: 0.5 }
    ])
    expect(db.siteMonths('s1', '2025-01')).toEqual([
      { month: '2025-12', used: 1.5 },
      { month: '2026-01', used: 2.5 }
    ])
    expect(db.siteYears('s1')).toEqual([
      { year: '2025', used: 1.5 },
      { year: '2026', used: 2.5 }
    ])
    // 窗口过滤:from 之后才有行
    expect(db.siteDays('s1', '2026-01-01', '2026-01-31')).toEqual([
      { date: '2026-01-01', used: 2 },
      { date: '2026-01-02', used: 0.5 }
    ])
  })

  it('边界:空库查询得空表/0/null;removeSite 后清空', async () => {
    const db = new BillDb(null)
    await db.ready()
    expect(db.siteDays('x', '2000-01-01', '2099-12-31')).toEqual([])
    expect(db.siteMonths('x', '2000-01')).toEqual([])
    expect(db.siteYears('x')).toEqual([])
    expect(db.siteTotal('x')).toBe(0)
    expect(db.siteEarliestDay('x')).toBeNull()
    expect(db.siteDominantCurrency('x')).toBeNull()
    expect(db.syncedMonths('x')).toEqual(new Set())

    db.upsertDays('x', rows(['2026-01-01', 5]), 'api')
    db.markMonthSynced('x', '2026-01')
    db.removeSite('x')
    expect(db.siteTotal('x')).toBe(0)
    expect(db.syncedMonths('x')).toEqual(new Set())
  })

  it('币种:同站多币种分键存储,占比最高者为 dominant;负金额(退款)保留', async () => {
    const db = new BillDb(null)
    await db.ready()
    db.upsertDays(
      's1',
      [
        { day: '2026-01-01', currency: 'CNY', amount: 10 },
        { day: '2026-01-02', currency: 'CNY', amount: -2 },
        { day: '2026-01-03', currency: 'USD', amount: 1 }
      ],
      'volcbill'
    )
    expect(db.siteDominantCurrency('s1')).toBe('CNY') // 净 8 > 1
    expect(db.siteTotal('s1')).toBeCloseTo(9, 10) // 10 - 2 + 1
  })

  it('坏行防御:非法日期/非有限金额跳过,不污染库', async () => {
    const db = new BillDb(null)
    await db.ready()
    db.upsertDays(
      's1',
      [
        { day: '2026-1-1', currency: 'CNY', amount: 5 }, // 非零填充格式
        { day: '2026-01-02', currency: 'CNY', amount: Number.NaN },
        { day: '2026-01-03', currency: 'CNY', amount: Number.POSITIVE_INFINITY },
        { day: '2026-01-04', currency: 'CNY', amount: 3 }
      ],
      'api'
    )
    expect(db.siteDays('s1', '2026-01-01', '2026-01-31')).toEqual([{ date: '2026-01-04', used: 3 }])
  })
})

describe('BillDb:来源优先级(metered 不倒灌真实记账)', () => {
  it('metered 先入,api 后入覆盖同键;api 在后,metered 再种库不覆盖', async () => {
    const db = new BillDb(null)
    await db.ready()
    db.upsertDays('s1', rows(['2026-01-01', 1]), 'metered')
    db.upsertDays('s1', rows(['2026-01-01', 2]), 'api') // 真实记账覆盖估算
    expect(db.siteTotalBySource('s1', 'api')).toBeCloseTo(2, 10)
    expect(db.siteTotalBySource('s1', 'metered')).toBe(0)
    expect(db.siteTotal('s1')).toBeCloseTo(2, 10)

    db.upsertDays('s1', rows(['2026-01-01', 9]), 'metered') // 反例:本机计量不得倒灌
    expect(db.siteTotal('s1')).toBeCloseTo(2, 10)
    expect(db.siteSources('s1')).toEqual(new Set(['api']))

    db.upsertDays('s1', rows(['2026-01-02', 0.5]), 'metered') // metered 只补空档
    expect(db.siteTotalBySource('s1', 'metered')).toBeCloseTo(0.5, 10)
  })

  it('volcbill 同理覆盖 metered;同源后写覆盖(api 两轮)', async () => {
    const db = new BillDb(null)
    await db.ready()
    db.upsertDays('s1', rows(['2026-01-01', 9.9]), 'volcbill')
    db.upsertDays('s1', rows(['2026-01-01', 3]), 'metered') // 不倒灌
    expect(db.siteTotal('s1')).toBeCloseTo(9.9, 10)
    db.upsertDays('s1', rows(['2026-01-01', 9.2]), 'api') // 站点类型切换等场景:高优先级互相覆盖
    expect(db.siteSources('s1')).toEqual(new Set(['api']))
    expect(db.siteTotal('s1')).toBeCloseTo(9.2, 10)
  })

  it('clearMeteredRange 只清区间内 metered,api/volcbill 与区间外不动', async () => {
    const db = new BillDb(null)
    await db.ready()
    db.upsertDays('s1', rows(['2026-01-10', 1], ['2026-01-20', 2], ['2026-02-01', 4]), 'metered')
    db.upsertDays('s1', rows(['2026-01-15', 7]), 'api')
    db.clearMeteredRange('s1', '2026-01-01', '2026-01-31')
    expect(db.siteTotalBySource('s1', 'metered')).toBeCloseTo(4, 10) // 02-01 在区间外保留
    expect(db.siteTotalBySource('s1', 'api')).toBeCloseTo(7, 10) // 真实记账不受影响
    expect(db.siteTotal('s1')).toBeCloseTo(11, 10)
  })
})

describe('BillDb:bill_sync 与持久化', () => {
  it('markMonthSynced 幂等;syncedMonths 只回该站点', async () => {
    const db = new BillDb(null)
    await db.ready()
    db.markMonthSynced('s1', '2026-01')
    db.markMonthSynced('s1', '2026-01') // 幂等
    db.markMonthSynced('s2', '2026-02')
    expect(db.syncedMonths('s1')).toEqual(new Set(['2026-01']))
    expect(db.syncedMonths('s2')).toEqual(new Set(['2026-02']))
  })

  it('文件库:flushSync 后新实例读回;坏文件回空库;内存模式不产生文件', async () => {
    const path = tmpFile('balance.sqlite')
    const db = new BillDb(path)
    await db.ready()
    db.upsertDays('s1', rows(['2026-01-01', 9.9]), 'volcbill')
    db.markMonthSynced('s1', '2026-01')
    db.flushSync()
    expect(existsSync(path)).toBe(true)

    const reloaded = new BillDb(path)
    await reloaded.ready()
    expect(reloaded.siteTotal('s1')).toBeCloseTo(9.9, 10)
    expect(reloaded.siteDominantCurrency('s1')).toBe('CNY')
    expect(reloaded.syncedMonths('s1')).toEqual(new Set(['2026-01']))

    writeFileSync(path, 'not a sqlite file at all')
    const broken = new BillDb(path)
    await broken.ready() // 损坏文件:从空库开始,不抛错
    expect(broken.siteTotal('s1')).toBe(0)

    const mem = new BillDb(null)
    await mem.ready()
    mem.upsertDays('s1', rows(['2026-01-01', 1]), 'api')
    mem.flushSync() // 纯内存:空操作不报错
    expect(existsSync(tmpFile('memory-mode-never-writes.sqlite'))).toBe(false)
  })
})
