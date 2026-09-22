/**
 * 用量统计存储——账单功能的本机一侧。
 *
 * 两条口径:
 * - api:站点自身记账(sub2api 的 total_actual_cost),每次成功拉到就记下来;站点接口
 *   临时不可用时回退用最近一次记账值,避免胶囊上的"已用"来回跳。
 * - metered:本机计量。DeepSeek 等没有用量接口的站点,只能按"余额下降量"估算:
 *   每次成功观测,余额比上次低多少就记多少用量(记到当日);余额升高视为充值,
 *   该段用量无法追溯(充值与消耗混在一起),从新基线重新计。统计自首次观测。
 * 火山方舟等百分比额度站点不进入本存储(PCT 在调度器侧已被排除)。
 *
 * 持久化在 userData/balance.usage.json(与站点配置分文件:它是派生数据,清掉即重新计量,
 * 不污染用户手编的配置)。路径由组合根注入;传 null 则纯内存(测试用)。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 单站点的用量台账(按站点 id 键控) */
export interface SiteUsageRecord {
  /** 最近一次站点记账的累计已用(null=该站点从未提供) */
  apiUsed: number | null
  apiUsedCurrency: string | null
  apiUsedAt: string | null
  /** 本机计量累计 */
  meterTotal: number
  /** 本机计量按日台账:YYYY-MM-DD → 当日用量 */
  meterDaily: Record<string, number>
  /** 首次计量日(YYYY-MM-DD) */
  meterSince: string | null
  /** 上次成功观测(计量基线) */
  lastBalance: number | null
  lastCurrency: string | null
}

export interface UsageObservation {
  record: SiteUsageRecord
  /** 本次观测新计量的用量(余额下降量;基线建立/充值/异常时为 0) */
  meteredDelta: number
  /** 台账是否有变化(调用方据此决定是否落盘) */
  changed: boolean
}

function emptyRecord(): SiteUsageRecord {
  return {
    apiUsed: null,
    apiUsedCurrency: null,
    apiUsedAt: null,
    meterTotal: 0,
    meterDaily: {},
    meterSince: null,
    lastBalance: null,
    lastCurrency: null
  }
}

/** 本地日期键 YYYY-MM-DD(计量归属哪一天按本机时区) */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 把一次成功观测应用到台账上——纯函数,便于独立对照/边界/反例测试。
 *
 * 规则:
 * - 首次观测:只建立基线,不产生用量
 * - 余额下降:差额记入当日(计量)
 * - 余额上升:视为充值,不计用量,基线抬到新值(充值期间的消耗无法追溯)
 * - 余额持平:无变化
 * - 币种变化:旧计量作废重开(不同币种的数字不能接续相加)
 * - 余额为负:视为观测异常,只重置基线不记用量(防止把异常值当巨额消耗)
 */
export function applyObservation(
  prev: SiteUsageRecord | null,
  currency: string,
  balance: number,
  today: string
): UsageObservation {
  if (!prev || prev.lastBalance === null || prev.lastCurrency !== currency) {
    // 币种"变化"必须是曾有观测(lastCurrency 非空)且与新币种不同;
    // 尚无观测(lastCurrency=null)只是首次建基线,apiUsed 要保留,否则刚记的站点账会被清掉
    const currencyChanged = prev != null && prev.lastCurrency !== null && prev.lastCurrency !== currency
    const record: SiteUsageRecord = {
      ...emptyRecord(),
      apiUsed: currencyChanged ? null : (prev?.apiUsed ?? null),
      apiUsedCurrency: currencyChanged ? null : (prev?.apiUsedCurrency ?? null),
      apiUsedAt: currencyChanged ? null : (prev?.apiUsedAt ?? null),
      meterSince: today,
      lastBalance: balance,
      lastCurrency: currency
    }
    return { record, meteredDelta: 0, changed: true }
  }

  const last = prev.lastBalance
  if (balance === last) return { record: prev, meteredDelta: 0, changed: false }

  if (balance < 0) {
    return {
      record: { ...prev, lastBalance: balance },
      meteredDelta: 0,
      changed: true
    }
  }

  if (balance < last) {
    const delta = last - balance
    const daily = { ...prev.meterDaily }
    daily[today] = Number(((daily[today] ?? 0) + delta).toFixed(10))
    return {
      record: {
        ...prev,
        meterTotal: Number((prev.meterTotal + delta).toFixed(10)),
        meterDaily: daily,
        meterSince: prev.meterSince ?? today,
        lastBalance: balance
      },
      meteredDelta: delta,
      changed: true
    }
  }

  // 余额上升:充值,基线抬到新值,不计用量
  return { record: { ...prev, lastBalance: balance }, meteredDelta: 0, changed: true }
}

type Json = Record<string, unknown>

function isPlainObject(v: unknown): v is Json {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/** 从磁盘 JSON 还原台账(字段级校验,坏值回默认) */
function revive(raw: unknown): Record<string, SiteUsageRecord> {
  const out: Record<string, SiteUsageRecord> = {}
  if (!isPlainObject(raw)) return out
  for (const [id, v] of Object.entries(raw)) {
    if (!isPlainObject(v)) continue
    const daily: Record<string, number> = {}
    if (isPlainObject(v.meterDaily)) {
      for (const [day, n] of Object.entries(v.meterDaily)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && typeof n === 'number' && Number.isFinite(n) && n > 0) {
          daily[day] = n
        }
      }
    }
    out[id] = {
      apiUsed: typeof v.apiUsed === 'number' && Number.isFinite(v.apiUsed) ? v.apiUsed : null,
      apiUsedCurrency: typeof v.apiUsedCurrency === 'string' ? v.apiUsedCurrency : null,
      apiUsedAt: typeof v.apiUsedAt === 'string' ? v.apiUsedAt : null,
      meterTotal: typeof v.meterTotal === 'number' && Number.isFinite(v.meterTotal) ? v.meterTotal : 0,
      meterDaily: daily,
      meterSince: typeof v.meterSince === 'string' ? v.meterSince : null,
      lastBalance: typeof v.lastBalance === 'number' && Number.isFinite(v.lastBalance) ? v.lastBalance : null,
      lastCurrency: typeof v.lastCurrency === 'string' ? v.lastCurrency : null
    }
  }
  return out
}

export class UsageStore {
  private cache: Record<string, SiteUsageRecord> | null = null

  /** filePath 为 null 时纯内存(测试);否则原子落盘 */
  constructor(private readonly filePath: string | null) {}

  private load(): Record<string, SiteUsageRecord> {
    if (this.cache) return this.cache
    if (!this.filePath) return (this.cache = {})
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      this.cache = revive(parsed)
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  private persist(): void {
    if (!this.filePath || !this.cache) return
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2) + '\n', 'utf8')
    renameSync(tmp, this.filePath)
  }

  get(siteId: string): SiteUsageRecord | null {
    return this.load()[siteId] ?? null
  }

  /** 应用一次成功观测(内部走 applyObservation 纯函数;有变化才落盘) */
  apply(siteId: string, currency: string, balance: number, today: string): UsageObservation {
    const all = this.load()
    const obs = applyObservation(all[siteId] ?? null, currency, balance, today)
    if (obs.changed) {
      all[siteId] = obs.record
      this.persist()
    }
    return obs
  }

  /** 记下站点记账的累计已用(api 口径;调用方保证 balance 为有效数字) */
  recordApiUsed(siteId: string, currency: string, used: number, at: string): void {
    const all = this.load()
    const cur = all[siteId] ?? emptyRecord()
    if (cur.apiUsed === used && cur.apiUsedCurrency === currency) return
    all[siteId] = { ...cur, apiUsed: used, apiUsedCurrency: currency, apiUsedAt: at }
    this.persist()
  }

  /** 站点删除后清掉台账,避免孤儿数据越积越多 */
  remove(siteId: string): void {
    const all = this.load()
    if (!(siteId in all)) return
    delete all[siteId]
    this.persist()
  }

  /** 丢弃仍在内存的缓存(重新计量用;主流程不调,测试用) */
  resetForTest(): void {
    this.cache = null
  }
}
