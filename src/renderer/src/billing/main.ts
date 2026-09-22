/**
 * 账单窗口渲染层——展示用量明细(独立窗口,不由余额胶囊承载)。
 * 数据由主进程先同步入本地账单库再聚合(billing:get):
 * sub2api=站点记账,DeepSeek=本机计量,火山方舟=计费中心真实账单(应付金额)。
 * 粒度可切换:按天(近 30 天)/按月(近 24 个月)/按年(全部)。
 */
import type { BillingReport, BillingSiteReport } from '@shared/balance'
import { formatBalance } from '@shared/balance'
import { BRAND_ICONS } from '../balance/icons'
import './style.css'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

type Granularity = 'day' | 'month' | 'year'
/** 口径徽章文案 */
const SOURCE_LABELS: Record<string, string> = {
  api: '站点记账',
  metered: '本机计量',
  volcbill: '计费中心'
}

const els = {
  genAt: $('genAt'),
  loading: $('loading'),
  body: $('body'),
  summary: $('summary'),
  granularity: $('granularity'),
  siteFilter: $('siteFilter'),
  sites: $('sites'),
  excluded: $('excluded'),
  empty: $('empty'),
  btnRefresh: $<HTMLButtonElement>('btnRefresh'),
  btnClose: $<HTMLButtonElement>('btnClose')
}

let granularity: Granularity = 'month'
/** 站点筛选:null=全部;选中后汇总与分区只统计该站点 */
let siteFilter: string | null = null
let lastReport: BillingReport | null = null

const api = window.api.balance

function iconPath(id: string): string {
  return (BRAND_ICONS.find((i) => i.id === id) ?? BRAND_ICONS[0]).d
}

function escapeHtml(s: unknown): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

/** 当前筛选下参与统计的站点 */
function visibleSites(report: BillingReport): BillingSiteReport[] {
  return siteFilter ? report.sites.filter((s) => s.id === siteFilter) : report.sites
}

/** 顶部汇总:按币种一行"本月已用 / 累计已用"(不同币种分开,跟随站点筛选) */
function renderSummary(report: BillingReport): void {
  const byCur = new Map<string, { month: number; total: number }>()
  const curMonth = report.generatedAt.slice(0, 7)
  for (const s of visibleSites(report)) {
    const cell = byCur.get(s.currency) ?? { month: 0, total: 0 }
    cell.total += s.usedTotal
    cell.month += s.months.find((m) => m.month === curMonth)?.used ?? 0
    byCur.set(s.currency, cell)
  }
  els.summary.innerHTML = ''
  for (const [cur, cell] of byCur) {
    const div = document.createElement('div')
    div.className = 'cell'
    div.innerHTML =
      `<div class="k">本月已用 / 累计已用</div>` +
      `<div class="v"><span class="cur">${escapeHtml(cur)}</span>` +
      `${cell.month.toFixed(2)} / ${cell.total.toFixed(2)}</div>`
    els.summary.appendChild(div)
  }
}

/** 站点筛选条:全部 + 每个站点一枚;单站点时隐藏 */
function renderSiteFilter(report: BillingReport): void {
  const bar = els.siteFilter
  bar.innerHTML = ''
  if (report.sites.length <= 1) {
    bar.hidden = true
    return
  }
  bar.hidden = false
  const chips: { id: string | null; label: string }[] = [
    { id: null, label: '全部' },
    ...report.sites.map((s) => ({ id: s.id, label: s.label }))
  ]
  for (const c of chips) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'fchip' + (c.id === siteFilter ? ' active' : '')
    b.textContent = c.label
    b.addEventListener('click', () => {
      if (siteFilter === c.id) return
      siteFilter = c.id
      if (!lastReport) return
      renderSiteFilter(lastReport)
      renderSummary(lastReport)
      renderSites(lastReport)
    })
    bar.appendChild(b)
  }
}

/** 按当前粒度取该站点的行(旧→新,含"当前期"高亮;generatedAt 用于判定当前期) */
function rowsFor(
  site: BillingSiteReport,
  generatedAt: string
): { key: string; used: number; current: boolean }[] {
  if (granularity === 'day') {
    return site.recent.map((d) => ({
      key: d.date.slice(5),
      used: d.used,
      current: d.date === generatedAt.slice(0, 10)
    }))
  }
  if (granularity === 'year') {
    return site.years.map((y) => ({ key: y.year, used: y.used, current: y.year === generatedAt.slice(0, 4) }))
  }
  return site.months.map((m) => ({ key: m.month, used: m.used, current: m.month === generatedAt.slice(0, 7) }))
}

function renderSite(site: BillingSiteReport, generatedAt: string): void {
  const div = document.createElement('div')
  div.className = 'site'
  const rows = rowsFor(site, generatedAt)
  const maxUsed = Math.max(...rows.map((r) => r.used), 0)
  const rowsHtml = rows
    .map((r) => {
      const pct = maxUsed > 0 ? Math.max((r.used / maxUsed) * 100, 3) : 0
      return (
        `<div class="month${r.current ? ' cur' : ''}">` +
        `<span class="m">${escapeHtml(r.key)}</span>` +
        `<span class="bar-track"><span class="bar" style="width:${pct.toFixed(1)}%"></span></span>` +
        `<span class="amt">${formatBalance(r.used, site.currency)}</span></div>`
      )
    })
    .join('')
  const badgeClass = site.source === 'api' ? ' api' : site.source === 'volcbill' ? ' volcbill' : ''
  const noteIsWarn =
    (site.source === 'metered' && Boolean(site.note)) ||
    site.note?.startsWith('计费中心查询失败') === true
  const note = site.note
    ? `<div class="meter-note${noteIsWarn ? ' warn' : ''}">${escapeHtml(site.note)}</div>`
    : ''
  div.innerHTML =
    `<div class="site-head">` +
    `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#D97757" d="${iconPath(site.icon)}"/></svg>` +
    `<span class="name">${escapeHtml(site.label)}</span>` +
    `<span class="badge${badgeClass}">${SOURCE_LABELS[site.source] ?? site.source}</span>` +
    `<span class="cur">${escapeHtml(site.currency)}</span></div>` +
    `<div class="site-total">累计已用 ${formatBalance(site.usedTotal, site.currency)}` +
    (site.since ? `<span class="sub">统计自 ${escapeHtml(site.since)}</span>` : '') +
    `</div>` +
    (rowsHtml ? `<div class="months">${rowsHtml}</div>` : '') +
    note
  els.sites.appendChild(div)
}

function renderSites(report: BillingReport): void {
  els.sites.innerHTML = ''
  for (const s of visibleSites(report)) renderSite(s, report.generatedAt)
}

function render(report: BillingReport): void {
  lastReport = report
  els.loading.hidden = true
  els.body.hidden = false
  els.genAt.textContent = `统计于 ${new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false })}`
  renderSiteFilter(report)
  renderSummary(report)
  renderSites(report)
  els.excluded.hidden = report.excluded.length === 0
  if (report.excluded.length) {
    els.excluded.textContent = `该站点不参与账单统计:${report.excluded.join('、')}`
  }
  els.empty.hidden = visibleSites(report).length > 0
}

async function load(): Promise<void> {
  els.loading.hidden = false
  els.body.hidden = true
  try {
    render(await api.getBillingReport())
  } catch (e) {
    els.loading.hidden = false
    els.loading.textContent = `账单加载失败:${(e as Error).message}`
  }
}

for (const btn of els.granularity.querySelectorAll<HTMLButtonElement>('.gbtn')) {
  btn.addEventListener('click', () => {
    const g = btn.dataset.g as Granularity | undefined
    if (!g || g === granularity || !lastReport) return
    granularity = g
    for (const b of els.granularity.querySelectorAll('.gbtn')) {
      b.classList.toggle('active', (b as HTMLElement).dataset.g === g)
    }
    renderSites(lastReport)
  })
}

els.btnRefresh.addEventListener('click', () => {
  void load()
})
els.btnClose.addEventListener('click', () => {
  api.closeBilling()
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') api.closeBilling()
})

void load()
