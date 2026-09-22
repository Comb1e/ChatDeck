/**
 * 账单报告——账单窗口的数据面,现拉现算(不持久化)。
 *
 * 口径(与 usage.ts 一致):
 * - 有 getUsage 能力的类型(sub2api):现场请求站点逐日用量趋势,按月聚合;
 *   累计已用优先用调度器记下的站点记账值(apiUsed),趋势拉取失败回退本机计量。
 * - 其余货币类类型(DeepSeek):本机计量的按日台账聚合。
 * - 百分比额度类型(火山方舟 PCT):不参与,进 excluded 供界面说明。
 */
import type { BillingDay, BillingMonth, BillingReport, BillingSiteReport } from '@shared/balance'
import { getAdapter } from './providers'
import type { BalanceSite } from '@shared/balance'
import type { BalanceStore } from './store'
import type { UsageStore } from './usage'
import { dayKey } from './usage'

export interface BillingDeps {
  store: BalanceStore
  usage: UsageStore
}

/** 报告覆盖近 N 个自然月(含本月) */
const MONTHS_COVERED = 6
/** "近期逐日"窗口长度 */
const RECENT_DAYS = 30

function firstDayOfMonthsAgo(now: Date, monthsBack: number): string {
  return dayKey(new Date(now.getFullYear(), now.getMonth() - monthsBack, 1))
}

/** 逐日 → 逐月聚合(月份升序) */
export function aggregateMonths(days: BillingDay[]): BillingMonth[] {
  const byMonth = new Map<string, number>()
  for (const d of days) {
    const month = d.date.slice(0, 7)
    byMonth.set(month, (byMonth.get(month) ?? 0) + d.used)
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, used]) => ({ month, used }))
}

type SiteReportResult =
  | { kind: 'site'; report: BillingSiteReport }
  | { kind: 'excluded'; label: string }
  | { kind: 'skip' }

async function buildSiteReport(
  deps: BillingDeps,
  site: BalanceSite,
  start: string,
  end: string,
  recentStart: string
): Promise<SiteReportResult> {
  const adapter = getAdapter(site.type)
  if (!adapter || !adapter.hasCredentials(site)) return { kind: 'skip' }
  if (adapter.balanceUnit === 'PCT') return { kind: 'excluded', label: site.label }

  const rec = deps.usage.get(site.id)
  const base = {
    id: site.id,
    label: site.label,
    icon: site.icon,
    currency: rec?.lastCurrency ?? adapter.balanceUnit ?? 'USD'
  }

  if (adapter.getUsage) {
    try {
      const days = await fetchUsageWithRetry(adapter, site, deps, start, end)
      return {
        kind: 'site',
        report: {
          ...base,
          source: 'api',
          usedTotal: rec?.apiUsed ?? days.reduce((sum, d) => sum + d.used, 0),
          since: days.length ? days[0].date : (rec?.meterSince ?? null),
          months: aggregateMonths(days),
          recent: days.filter((d) => d.date >= recentStart && d.date <= end)
        }
      }
    } catch {
      // 站点趋势接口不可用(站点/代理链路的间歇性故障实测常见):回退本机计量,
      // 但必须标注清楚——否则"本机计量 0.00"会被误读成该站从没用过
    }
  }

  const meteredDays = rec
    ? Object.entries(rec.meterDaily)
        .filter(([date]) => date >= start && date <= end)
        .map(([date, used]) => ({ date, used }))
        .sort((a, b) => a.date.localeCompare(b.date))
    : []
  return {
    kind: 'site',
    report: {
      ...base,
      source: 'metered',
      usedTotal: rec?.meterTotal ?? 0,
      since: rec?.meterSince ?? null,
      months: aggregateMonths(meteredDays),
      recent: meteredDays.filter((d) => d.date >= recentStart),
      ...(adapter.getUsage ? { note: '站点用量接口暂不可用,已回退本机计量(数字可能低于实际)' } : {})
    }
  }
}

/** 趋势拉取失败(网络抖动/代理链路)重试一次,仍失败才回退本机计量 */
async function fetchUsageWithRetry(
  adapter: NonNullable<ReturnType<typeof getAdapter>>,
  site: BalanceSite,
  deps: BillingDeps,
  start: string,
  end: string
): Promise<BillingDay[]> {
  const pull = (): Promise<BillingDay[]> =>
    adapter.getUsage!({
      site,
      onTokensRefreshed: (tokens) => deps.store.updateSiteFields(site.id, tokens),
      start,
      end
    })
  try {
    return await pull()
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 700))
    return pull()
  }
}

export async function buildBillingReport(
  deps: BillingDeps,
  now: Date = new Date()
): Promise<BillingReport> {
  const end = dayKey(now)
  const start = firstDayOfMonthsAgo(now, MONTHS_COVERED - 1)
  const recentStart = dayKey(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - (RECENT_DAYS - 1))
  )

  const settled = await Promise.allSettled(
    deps.store.getSites().map((site) => buildSiteReport(deps, site, start, end, recentStart))
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
