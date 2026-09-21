/**
 * 账单窗口渲染层——展示每月用量等明细(独立窗口,不由余额胶囊承载)。
 * 数据由主进程现拉现算(billing:get):sub2api=站点记账(真实),DeepSeek=本机计量,
 * 火山方舟等百分比额度站点不参与(进 excluded 供说明)。
 */
import type { BillingReport, BillingSiteReport } from '@shared/balance'
import { formatBalance } from '@shared/balance'
import { BRAND_ICONS } from '../balance/icons'
import './style.css'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const els = {
  genAt: $('genAt'),
  loading: $('loading'),
  body: $('body'),
  summary: $('summary'),
  sites: $('sites'),
  excluded: $('excluded'),
  empty: $('empty'),
  btnRefresh: $<HTMLButtonElement>('btnRefresh'),
  btnClose: $<HTMLButtonElement>('btnClose')
}

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

function currentMonth(iso: string): string {
  return iso.slice(0, 7)
}

/** 顶部汇总:按币种一行"本月已用 / 累计已用"(不同币种分开,百分比站点已被报告排除) */
function renderSummary(report: BillingReport): void {
  const byCur = new Map<string, { month: number; total: number }>()
  const curMonth = currentMonth(report.generatedAt)
  for (const s of report.sites) {
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

function renderSite(site: BillingSiteReport): void {
  const div = document.createElement('div')
  div.className = 'site'
  const maxUsed = Math.max(...site.months.map((m) => m.used), 0)
  const monthsHtml = site.months
    .map((m) => {
      const pct = maxUsed > 0 ? Math.max((m.used / maxUsed) * 100, 3) : 0
      return (
        `<div class="month">` +
        `<span class="m">${escapeHtml(m.month)}</span>` +
        `<span class="bar-track"><span class="bar" style="width:${pct.toFixed(1)}%"></span></span>` +
        `<span class="amt">${formatBalance(m.used, site.currency)}</span></div>`
      )
    })
    .join('')
  const note =
    site.source === 'metered'
      ? '<div class="meter-note">本机计量:按余额下降估算,充值当期可能低估;清空数据后从零重计。</div>'
      : ''
  div.innerHTML =
    `<div class="site-head">` +
    `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#D97757" d="${iconPath(site.icon)}"/></svg>` +
    `<span class="name">${escapeHtml(site.label)}</span>` +
    `<span class="badge${site.source === 'api' ? ' api' : ''}">${site.source === 'api' ? '站点记账' : '本机计量'}</span>` +
    `<span class="cur">${escapeHtml(site.currency)}</span></div>` +
    `<div class="site-total">累计已用 ${formatBalance(site.usedTotal, site.currency)}` +
    (site.since ? `<span class="sub">统计自 ${escapeHtml(site.since)}</span>` : '') +
    `</div>` +
    (monthsHtml ? `<div class="months">${monthsHtml}</div>` : '') +
    note
  els.sites.appendChild(div)
}

function render(report: BillingReport): void {
  els.loading.hidden = true
  els.body.hidden = false
  els.genAt.textContent = `统计于 ${new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false })}`
  renderSummary(report)
  els.sites.innerHTML = ''
  for (const s of report.sites) renderSite(s)
  els.excluded.hidden = report.excluded.length === 0
  if (report.excluded.length) {
    els.excluded.textContent =
      `百分比额度站点不参与账单统计:${report.excluded.join('、')}`
  }
  els.empty.hidden = report.sites.length > 0
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
