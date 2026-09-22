/**
 * 账单报告——账单窗口的数据面:先把各口径数据同步进本地账单库(billdb.ts),再从库聚合。
 *
 * 口径:
 * - sub2api(getUsage 类型):拉站点逐日趋势入账单库(source=api,站点自身记账,权威),
 *   同步成功后清除请求区间内的本机计量行——api 未上报的日子就是 0,不清会重复计数;
 *   拉取失败回退库内已有 api 数据(标注"上次同步"),连历史都没有才回退本机计量(metered)。
 * - DeepSeek 等无用量接口类型:本机计量按日台账种入库(source=metered,只补空行)。
 * - 火山方舟(volcark):计费中心 ListBillDetail 真实账单入账单库(source=volcbill,
 *   应付金额 PayableAmount);余额小窗的 coding plan 百分比显示不在此处,不受影响。
 * 聚合(近 30 天/近 24 月/按年)统一查 bill_day 表;usedTotal/since 的语义与 usage.ts 对齐。
 */
import type { BillingReport, BillingSiteReport } from '@shared/balance'
import { getAdapter } from './providers'
import type { BalanceSite } from '@shared/balance'
import type { BalanceStore } from './store'
import type { UsageStore } from './usage'
import { dayKey } from './usage'
import type { BillDb, BillRowInput, BillSource } from './billdb'
import { fetchVolcBillMonth, monthsToFetch } from './providers/volcbill'

export interface BillingDeps {
  store: BalanceStore
  usage: UsageStore
  bills: BillDb
}

/** 账单库同步与"按月"视图窗口:近 N 个自然月(含本月;计费中心最多回溯 24 个月) */
const MONTHS_COVERED = 24
/** 趋势接口降级窗口:24 个月区间若被站点接口拒绝,退回旧的 6 个月重试 */
const TREND_FALLBACK_MONTHS = 6
/** "近期逐日"(按天视图)窗口长度 */
const RECENT_DAYS = 30

function firstDayOfMonthsAgo(now: Date, monthsBack: number): string {
  return dayKey(new Date(now.getFullYear(), now.getMonth() - monthsBack, 1))
}

type SiteReportResult =
  | { kind: 'site'; report: BillingSiteReport }
  | { kind: 'excluded'; label: string }
  | { kind: 'skip' }

interface ReportWindows {
  end: string
  recentStart: string
  monthsStart: string
}

/** 本机计量种入库(metered 优先级最低,只补没有 api/volcbill 行的空档) */
function seedMetered(deps: BillingDeps, siteId: string): void {
  const rec = deps.usage.get(siteId)
  if (!rec) return
  const rows: BillRowInput[] = Object.entries(rec.meterDaily)
    .filter(([, used]) => Number.isFinite(used) && used > 0)
    .map(([date, used]) => ({ day: date, currency: rec.lastCurrency ?? 'USD', amount: used }))
  if (rows.length) deps.bills.upsertDays(siteId, rows, 'metered')
}

/**
 * 火山方舟:计费中心账单同步。已同步的历史月跳过,本月/上月始终重拉
 * (本月消费持续累加、上月账单次月 2 日才出全);单月失败即中止,已入库的月份保留。
 */
async function syncVolcBilling(deps: BillingDeps, site: BalanceSite, now: Date): Promise<void> {
  const ak = site.accessToken.trim()
  const sk = site.refreshToken.trim()
  if (!ak || !sk) throw new Error('尚未配置访问密钥(AK/SK)')
  const months = monthsToFetch(now, deps.bills.syncedMonths(site.id), MONTHS_COVERED)
  for (const month of months) {
    const rows = await fetchVolcBillMonth({ ak, sk, month })
    if (rows.length) {
      deps.bills.upsertDays(site.id, rows, 'volcbill')
      // 计费中心对该账期权威,清掉区间内可能存在的本机计量行(防御性,PCT 本不进计量)
      deps.bills.clearMeteredRange(site.id, `${month}-01`, `${month}-31`)
    }
    deps.bills.markMonthSynced(site.id, month)
  }
}

/**
 * sub2api 趋势同步:先按完整 24 个月窗口请求,被站点接口拒绝(区间过大等)退回 6 个月;
 * 成功后清区间内 metered 行并入库 source=api。返回是否成功。
 */
async function syncTrend(
  deps: BillingDeps,
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  site: BalanceSite,
  now: Date
): Promise<boolean> {
  const pull = async (months: number) => {
    const start = firstDayOfMonthsAgo(now, months - 1)
    const days = await adapter.getUsage!({
      site,
      onTokensRefreshed: (tokens) => deps.store.updateSiteFields(site.id, tokens),
      start,
      end: dayKey(now)
    })
    return { start, days }
  }
  let result: Awaited<ReturnType<typeof pull>>
  try {
    result = await pull(MONTHS_COVERED)
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 700))
    try {
      result = await pull(TREND_FALLBACK_MONTHS)
    } catch {
      return false
    }
  }
  deps.bills.clearMeteredRange(site.id, result.start, dayKey(now))
  const rec = deps.usage.get(site.id)
  const currency = rec?.lastCurrency ?? adapter.balanceUnit ?? 'USD'
  const rows: BillRowInput[] = result.days.map((d) => ({
    day: d.date,
    currency,
    amount: d.used
  }))
  if (rows.length) deps.bills.upsertDays(site.id, rows, 'api')
  return true
}

async function buildSiteReport(
  deps: BillingDeps,
  site: BalanceSite,
  now: Date,
  win: ReportWindows
): Promise<SiteReportResult> {
  const adapter = getAdapter(site.type)
  if (!adapter || !adapter.hasCredentials(site)) return { kind: 'skip' }
  // PCT 类型默认不参与;volcark 例外——它经计费中心有真实货币账单
  if (adapter.balanceUnit === 'PCT' && site.type !== 'volcark') {
    return { kind: 'excluded', label: site.label }
  }
  const isVolc = site.type === 'volcark'

  seedMetered(deps, site.id)

  let syncedOk = false
  let note: string | undefined
  if (isVolc) {
    try {
      await syncVolcBilling(deps, site, now)
      syncedOk = true
    } catch (e) {
      note = `计费中心查询失败:${(e as Error).message}`
    }
  } else if (adapter.getUsage) {
    syncedOk = await syncTrend(deps, adapter, site, now)
    if (!syncedOk) {
      note = deps.bills.siteSources(site.id).has('api')
        ? '站点用量接口暂不可用,显示上次同步的数据(可能缺最近几天)'
        : '站点用量接口暂不可用,已回退本机计量(数字可能低于实际)'
    }
  }

  const sources = deps.bills.siteSources(site.id)
  const hasApi = sources.has('api')
  const source: BillSource = isVolc ? 'volcbill' : hasApi ? 'api' : 'metered'
  const rec = deps.usage.get(site.id)
  const currency = isVolc
    ? (deps.bills.siteDominantCurrency(site.id) ?? 'CNY')
    : (rec?.lastCurrency ?? adapter.balanceUnit ?? 'USD')

  const report: BillingSiteReport = {
    id: site.id,
    label: site.label,
    icon: site.icon,
    currency,
    source,
    usedTotal: isVolc
      ? deps.bills.siteTotal(site.id)
      : source === 'api'
        ? (rec?.apiUsed ?? deps.bills.siteTotalBySource(site.id, 'api'))
        : (rec?.meterTotal ?? 0),
    since: isVolc
      ? deps.bills.siteEarliestDay(site.id)
      : source === 'api'
        ? (deps.bills.siteEarliestDay(site.id, 'api') ?? (rec?.meterSince ?? null))
        : (rec?.meterSince ?? null),
    months: deps.bills.siteMonths(site.id, win.monthsStart),
    recent: deps.bills.siteDays(site.id, win.recentStart, win.end),
    years: deps.bills.siteYears(site.id)
  }
  if (note) {
    report.note = note
  } else if (isVolc) {
    report.note = '取自火山引擎计费中心:应付金额(近 24 个月账单),仅供对账参考。'
  }
  return { kind: 'site', report }
}

export async function buildBillingReport(
  deps: BillingDeps,
  now: Date = new Date()
): Promise<BillingReport> {
  await deps.bills.ready()
  const end = dayKey(now)
  const recentStart = dayKey(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - (RECENT_DAYS - 1))
  )
  const monthsStart = firstDayOfMonthsAgo(now, MONTHS_COVERED - 1).slice(0, 7)
  const win: ReportWindows = { end, recentStart, monthsStart }

  const settled = await Promise.allSettled(
    deps.store.getSites().map((site) => buildSiteReport(deps, site, now, win))
  )
  const sites: BillingSiteReport[] = []
  const excluded: string[] = []
  for (const r of settled) {
    if (r.status === 'rejected' || r.value.kind === 'skip') continue
    if (r.value.kind === 'excluded') excluded.push(r.value.label)
    else sites.push(r.value.report)
  }
  return { generatedAt: now.toISOString(), sites, excluded }
}
