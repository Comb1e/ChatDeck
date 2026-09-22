/**
 * 余额小窗渲染层——移植自 token-balance src/renderer/widget.js。
 * 多站点余额胶囊 + 站点列表/编辑卡片；主进程推送状态（ev:balance-state）。
 *
 * 与原版的差别：
 * - 走 ChatDeck 的 window.api.balance（原为 window.tokenBalance）；
 * - 去掉"浏览器直接打开时的 Mock 预览"分支（避免 preload 失效时静默显示假数据）；
 * - 去掉托盘"站点管理"UI 指令（ChatDeck 托盘只提供显隐开关，右键胶囊即直达管理）。
 */
import { BRAND_ICONS } from './icons'
import type { BrandIcon } from './icons'
import type {
  BalanceSiteDescription,
  BalanceSiteState,
  BalanceSnapshot
} from '@shared/balance'
import { formatBalance } from '@shared/balance'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const els = {
  app: $('app'),
  pill: $('pill'),
  pillGroups: $('pillGroups'),
  pillExpand: $<HTMLButtonElement>('pillExpand'),
  pillUsed: $<HTMLButtonElement>('pillUsed'),
  card: $('card'),
  cardTitle: $('cardTitle'),
  btnAdd: $('btnAdd'),
  btnCollapse: $('btnCollapse'),
  listView: $('listView'),
  totalBlock: $('totalBlock'),
  totalRows: $('totalRows'),
  emptyHint: $('emptyHint'),
  siteRows: $('siteRows'),
  btnRefreshAll: $('btnRefreshAll'),
  btnBilling: $('btnBilling'),
  btnAddBottom: $('btnAddBottom'),
  editView: $('editView'),
  editTitle: $('editTitle'),
  typeField: $('typeField'),
  typePicker: $('typePicker'),
  inputLabel: $<HTMLInputElement>('inputLabel'),
  inputBase: $<HTMLInputElement>('inputBase'),
  inputUsage: $<HTMLInputElement>('inputUsage'),
  iconPicker: $('iconPicker'),
  setupSteps: $('setupSteps'),
  tokenFields: $('tokenFields'),
  inputEnabled: $<HTMLInputElement>('inputEnabled'),
  btnSave: $<HTMLButtonElement>('btnSave'),
  btnDelete: $<HTMLButtonElement>('btnDelete'),
  btnBack: $('btnBack'),
  editMsg: $('editMsg')
}

const DEFAULT_ICON = 'openai'
const SIZE = {
  collapsedWindow: { w: 196, h: 56 },
  cardWidth: 372
}

type ViewName = 'list' | 'edit'

interface EditingDraft {
  id: string | null
  type: string
  icon: string
}

let state: BalanceSnapshot = { sites: [] } // 调度器推送的运行状态
let descriptions = new Map<string, BalanceSiteDescription>() // id -> describeSite（不含凭据）
let view: ViewName = 'list'
let expanded = false
let editing: EditingDraft | null = null // 编辑草稿（id=null 表示新建）
let editingIsNew = false
const lastGood = new Map<string, string>() // id -> '$X.XX'

const api = window.api.balance

// ---------- 渲染:胶囊 ----------

function iconById(id: string): BrandIcon {
  return (
    BRAND_ICONS.find((i) => i.id === id) ||
    (BRAND_ICONS.find((i) => i.id === DEFAULT_ICON) as BrandIcon)
  )
}

/** 无数据时的占位(货币站点 '$ --',百分比站点 '--') */
function placeholder(currency: string): string {
  return currency === 'PCT' ? '--' : '$ --'
}

function timeOf(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function pillParts(s: BalanceSiteState): { text: string; cls: string; dot: string } {
  let text = lastGood.get(s.id) || placeholder(s.currency)
  let cls = ''
  let dot = ''
  switch (s.status) {
    case 'ok':
      text = formatBalance(s.balance, s.currency)
      lastGood.set(s.id, text)
      break
    case 'loading':
      dot = 'loading'
      break
    case 'no-token':
    case 'disabled':
      text = placeholder(s.currency)
      cls = 'muted'
      break
    case 'auth-error':
      text = placeholder(s.currency)
      cls = 'bad'
      dot = 'bad'
      break
    case 'network-error':
    case 'api-error':
      cls = 'warn'
      dot = 'warn'
      break
    default:
      break
  }
  return { text, cls, dot }
}

function renderPill(sites: BalanceSiteState[]): void {
  const visible = sites.filter((s) => s.enabled)
  els.pillGroups.innerHTML = ''
  if (!visible.length) {
    els.pillGroups.innerHTML = '<div class="site-group"><span class="site-value muted">配置 Token</span></div>'
  } else {
    for (const s of visible) {
      const { text, cls, dot } = pillParts(s)
      const g = document.createElement('div')
      // 刷新中整组加 loading:值文字走闪烁动画,让"点了刷新"有可见反馈
      g.className = `site-group${s.status === 'loading' ? ' loading' : ''}`
      // 百分比站点的胶囊值不带"已用"字样,悬停说明补全语义
      g.title =
        s.currency === 'PCT' && s.status === 'ok'
          ? `${s.label} · 五小时额度已用 ${Math.round(s.balance ?? 0)}%` +
            (s.message ? `,${timeOf(s.message)} 重置` : '')
          : s.label
      g.innerHTML =
        `<svg class="logo${s.status === 'loading' ? ' spin' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path fill="#D97757" d="${iconById(s.icon).d}"/></svg>` +
        `<span class="site-name">${escapeHtml(s.label)}</span>` +
        `<span class="site-value ${cls}">${text}</span>` +
        (dot ? `<span class="dot ${dot}"></span>` : '')
      els.pillGroups.appendChild(g)
    }
  }
  renderPillUsed(visible)
  // 单行保持胶囊形,多行切大圆角卡片形
  els.pill.style.borderRadius = els.pillGroups.children.length > 1 ? '18px' : '999px'
}

/**
 * 胶囊底部的"已用"汇总行:按币种分开累计(不同币种直接相加是错的),
 * 只算货币站点(火山方舟等百分比额度站点 excluded),点它打开账单窗口。
 */
function renderPillUsed(sites: BalanceSiteState[]): void {
  const usedByCurrency = new Map<string, number>()
  let known = false
  for (const s of sites) {
    if (s.status !== 'ok' || s.currency === 'PCT' || s.used == null) continue
    known = true
    const cur = s.currency || 'USD'
    usedByCurrency.set(cur, (usedByCurrency.get(cur) ?? 0) + s.used)
  }
  els.pillUsed.hidden = !known
  if (known) {
    els.pillUsed.textContent =
      '已用 ' +
      [...usedByCurrency.entries()].map(([cur, v]) => formatBalance(v, cur)).join(' · ')
  }
}

// ---------- 渲染:站点列表 ----------

function rowSub(s: BalanceSiteState): string {
  switch (s.status) {
    case 'ok': {
      // 火山方舟等百分比站点:主值已是百分比,补充"已用"语义与重置时间(message 存 ISO)
      if (s.currency === 'PCT') {
        const reset = s.message ? ` · ${timeOf(s.message)} 重置` : ''
        return `五小时额度已用 ${Math.round(s.balance ?? 0)}%${reset}`
      }
      return s.lastSuccessAt ? `更新于 ${timeOf(s.lastSuccessAt)}` : ''
    }
    case 'loading':
      return '刷新中…'
    case 'no-token':
      return '未配置 Token,点击配置'
    case 'disabled':
      return '已停用'
    case 'auth-error':
      return s.message || '凭据失效'
    default:
      return s.message || '更新失败,将自动重试'
  }
}

function renderList(sites: BalanceSiteState[]): void {
  els.siteRows.innerHTML = ''
  const okSites = sites.filter((s) => s.status === 'ok')
  const enabledCount = sites.filter((s) => s.enabled).length

  // 合计按币种分行为(不同币种直接相加是错的,混合币种此前整个隐藏也看不到数了):
  // 每个货币一行"余额 … · 已用 …";百分比额度站点(火山方舟)不参与
  const byCurrency = new Map<string, BalanceSiteState[]>()
  for (const s of okSites) {
    if (s.currency === 'PCT') continue
    const cur = s.currency || 'USD'
    const list = byCurrency.get(cur) ?? []
    list.push(s)
    byCurrency.set(cur, list)
  }
  els.totalBlock.hidden = byCurrency.size === 0
  if (!els.totalBlock.hidden) {
    els.totalRows.innerHTML = ''
    for (const [cur, list] of byCurrency) {
      const total = list.reduce((sum, s) => sum + Number(s.balance || 0), 0)
      const usedList = list.filter((s) => s.used != null)
      const used = usedList.reduce((sum, s) => sum + Number(s.used), 0)
      const line = document.createElement('div')
      line.className = 'total-line'
      line.textContent =
        `${cur} 余额 ${formatBalance(total, cur)}` +
        (usedList.length ? ` · 已用 ${formatBalance(used, cur)}` : '')
      line.title = list.map((s) => `${s.label} ${formatBalance(s.balance, s.currency)}`).join('\n')
      els.totalRows.appendChild(line)
    }
  }
  els.emptyHint.hidden = sites.length > 0
  els.btnAddBottom.hidden = false

  sites.forEach((s, i) => {
    if (i > 0) {
      const d = document.createElement('div')
      d.className = 'rows-divider'
      els.siteRows.appendChild(d)
    }
    const { text, cls, dot } = pillParts(s)
    const sub = rowSub(s)
    const row = document.createElement('div')
    // 刷新中整行加 loading:值文字走闪烁动画,让"点了刷新"有可见反馈
    row.className = `site-row${s.status === 'loading' ? ' loading' : ''}`
    row.title = `点击编辑「${s.label}」`
    // 多站点时给每行 ▲▼ 调序按钮:顺序即胶囊与列表的展示序,点击立即持久化并重排
    const sortable = sites.length > 1
    const chevron = (up: boolean): string =>
      up
        ? '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 5.2 18.8 12h-4.3v6.8H9.5V12H5.2L12 5.2z"/></svg>'
        : '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 18.8 5.2 12h4.3V5.2h5v6.8h4.3L12 18.8z"/></svg>'
    const sortBtns = sortable
      ? `<div class="row-sort">` +
        `<button class="sort-btn" data-delta="-1" title="上移" aria-label="上移 ${escapeHtml(s.label)}"${i === 0 ? ' disabled' : ''}>${chevron(true)}</button>` +
        `<button class="sort-btn" data-delta="1" title="下移" aria-label="下移 ${escapeHtml(s.label)}"${i === sites.length - 1 ? ' disabled' : ''}>${chevron(false)}</button>` +
        `</div>`
      : ''
    row.innerHTML =
      `<svg class="row-icon${s.status === 'loading' ? ' spin' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path fill="#D97757" d="${iconById(s.icon).d}"/></svg>` +
      `<div class="row-main"><div class="row-label">${escapeHtml(s.label)}${s.enabled ? '' : '(停用)'}</div>` +
      `<div class="row-sub${['network-error', 'api-error'].includes(s.status) ? ' error' : ''}">${escapeHtml(sub)}</div></div>` +
      sortBtns +
      `<div class="row-right"><span class="row-value ${cls}">${text}</span><span class="dot ${dot}"></span>` +
      `<button class="row-link" title="打开 Usage 页" aria-label="打开 ${escapeHtml(s.label)} Usage 页">` +
      `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg></button></div>`
    const link = row.querySelector('.row-link')
    // 不在渲染层判 desc?.usageUrl——描述表可能还没刷新,主进程侧会校验并忽略空地址
    link?.addEventListener('click', (e) => {
      e.stopPropagation()
      api.openUsage(s.id)
    })
    row.querySelectorAll<HTMLButtonElement>('.sort-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation() // 别触发整行的「点击编辑」
        void api.moveSite(s.id, Number(btn.dataset.delta) === -1 ? -1 : 1)
      })
    })
    row.addEventListener('click', () => openEdit(s.id))
    els.siteRows.appendChild(row)
  })

  if (!enabledCount && sites.length) {
    els.emptyHint.hidden = false
    els.emptyHint.textContent = '所有站点均已停用,可在编辑里重新启用'
  }
}

function escapeHtml(s: unknown): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

// ---------- 渲染:编辑表单 ----------

function fillIconPicker(container: HTMLElement, current: string, onPick: (id: string) => void): void {
  container.innerHTML = ''
  for (const icon of BRAND_ICONS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `icon-opt${icon.id === current ? ' selected' : ''}`
    btn.title = icon.label
    btn.setAttribute('aria-label', icon.label)
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon.d}"/></svg>`
    btn.addEventListener('click', () => {
      container.querySelectorAll('.icon-opt').forEach((b) => b.classList.remove('selected'))
      btn.classList.add('selected')
      onPick(icon.id)
    })
    container.appendChild(btn)
  }
}

function fillTokenFields(desc: Partial<BalanceSiteDescription>, saved: boolean): void {
  els.tokenFields.innerHTML = ''
  for (const f of desc.tokenFields || []) {
    const label = document.createElement('label')
    label.className = 'field'
    const span = document.createElement('span')
    span.className = 'field-label'
    span.textContent = f.label
    const input = document.createElement('input')
    input.type = 'text'
    input.spellcheck = false
    input.autocomplete = 'off'
    input.dataset.key = f.key
    input.placeholder = saved ? '已配置 —— 留空保持不变' : `粘贴 ${f.sourceKey} 的值`
    label.append(span, input)
    els.tokenFields.appendChild(label)
  }
  els.setupSteps.innerHTML = ''
  for (const step of desc.setupSteps || []) {
    const li = document.createElement('li')
    li.innerHTML = step.replace(/`([^`]+)`/g, '<code>$1</code>')
    els.setupSteps.appendChild(li)
  }
}

function readTokenFields(): Record<string, string> {
  const out: Record<string, string> = {}
  els.tokenFields.querySelectorAll('input').forEach((i) => {
    if (i.dataset.key) out[i.dataset.key] = i.value.trim()
  })
  return out
}

function openEdit(siteId: string): void {
  const siteState = state.sites.find((s) => s.id === siteId)
  const desc = descriptions.get(siteId)
  editingIsNew = false
  editing = {
    id: siteId,
    type: desc?.type || 'sub2api',
    icon: siteState?.icon || desc?.icon || DEFAULT_ICON
  }
  view = 'edit'
  els.editTitle.textContent = '编辑站点'
  els.typeField.hidden = true // 已有站点不换类型:类型决定协议与凭据字段
  els.inputLabel.value = siteState?.label || desc?.label || ''
  els.inputBase.value = desc?.apiBaseUrl || ''
  els.inputUsage.value = desc?.usageUrl || ''
  els.inputEnabled.checked = desc ? desc.enabled !== false : true
  els.btnDelete.hidden = false
  els.editMsg.hidden = true
  fillIconPicker(els.iconPicker, editing.icon, (iconId) => {
    if (editing) editing.icon = iconId
  })
  fillTokenFields(desc || { setupSteps: [], tokenFields: [] }, Boolean(desc?.saved))
  showView()
}

/** 按所选类型套用"添加站点"默认值(名称/地址/图标/引导步骤/凭据字段) */
function applyNewSiteDefaults(type: string): void {
  void api.describeNewSite(type).then((desc) => {
    // 用户可能已切换到别的类型,过期响应直接丢弃
    if (!editingIsNew || !editing || editing.type !== desc.type) return
    editing.icon = desc.icon || DEFAULT_ICON
    els.inputLabel.value = desc.label || ''
    els.inputBase.value = desc.apiBaseUrl || ''
    els.inputUsage.value = desc.usageUrl || ''
    fillIconPicker(els.iconPicker, editing.icon, (iconId) => {
      if (editing) editing.icon = iconId
    })
    fillTokenFields(desc, false)
    showView() // 表单高度可能变化,重新测量窗口
  })
}

function fillTypePicker(current: string): void {
  els.typePicker.innerHTML = ''
  void api.describeSiteTypes().then((types) => {
    if (!editingIsNew || !editing) return
    for (const t of types) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = `type-opt${t.id === current ? ' selected' : ''}`
      btn.textContent = t.label
      btn.title = t.hint || t.label
      btn.addEventListener('click', () => {
        if (!editingIsNew || !editing || editing.type === t.id) return
        editing.type = t.id
        els.typePicker.querySelectorAll('.type-opt').forEach((b) => b.classList.remove('selected'))
        btn.classList.add('selected')
        applyNewSiteDefaults(t.id)
      })
      els.typePicker.appendChild(btn)
    }
  })
}

function openAdd(): void {
  view = 'edit'
  editingIsNew = true
  editing = { id: null, type: 'sub2api', icon: DEFAULT_ICON }
  els.editTitle.textContent = '添加站点'
  els.typeField.hidden = false
  els.inputLabel.value = ''
  els.inputBase.value = ''
  els.inputUsage.value = ''
  els.inputEnabled.checked = true
  els.btnDelete.hidden = true
  els.editMsg.hidden = true
  fillTypePicker('sub2api')
  applyNewSiteDefaults('sub2api')
  showView()
}

function showView(): void {
  els.editView.hidden = view !== 'edit'
  els.listView.hidden = view !== 'list'
  els.btnAdd.style.display = view === 'list' ? 'grid' : 'none'
  renderList(state.sites)
  applySize() // 编辑视图比列表高,必须立即按内容调整窗口,否则表单被窗口裁掉
}

async function saveEditing(): Promise<void> {
  if (!editing) return
  els.btnSave.disabled = true
  els.editMsg.hidden = false
  els.editMsg.className = 'setup-msg'
  els.editMsg.textContent = '正在保存并验证…'
  const tokens = readTokenFields()
  const res = await api.saveSite({
    id: editing.id,
    type: editing.type,
    label: els.inputLabel.value,
    icon: editing.icon,
    apiBaseUrl: els.inputBase.value,
    usageUrl: els.inputUsage.value,
    accessToken: tokens.accessToken ?? '',
    refreshToken: tokens.refreshToken ?? '',
    enabled: els.inputEnabled.checked
  })
  els.btnSave.disabled = false
  if (!res.ok) {
    els.editMsg.className = 'setup-msg error'
    els.editMsg.textContent = res.message || '保存失败'
    return
  }
  if (res.id) editing.id = res.id
  editingIsNew = false
  els.btnDelete.hidden = false
  els.editMsg.className = 'setup-msg success'
  els.editMsg.textContent = '已保存'
  // 描述表只在启动时拉过一次:新保存的站点(usage页/表单字段)必须补拉,
  // 否则它的 Usage 按钮与编辑表单会一直拿到空描述(火山方舟按钮失灵的根因)
  void refreshDescriptions()
  setTimeout(() => {
    view = 'list'
    showView()
  }, 550)
}

async function deleteEditing(): Promise<void> {
  if (!editing?.id) return
  if (els.btnDelete.dataset.confirm !== '1') {
    els.btnDelete.dataset.confirm = '1'
    els.btnDelete.textContent = '再点一次确认删除'
    setTimeout(() => {
      els.btnDelete.dataset.confirm = ''
      els.btnDelete.textContent = '删除站点'
    }, 2600)
    return
  }
  els.btnDelete.dataset.confirm = ''
  els.btnDelete.textContent = '删除站点'
  await api.removeSite(editing.id)
  void refreshDescriptions() // 描述表同步删除,避免残留可点开的死条目
  view = 'list'
  showView()
}

// ---------- 尺寸自适应 ----------

const lastApplied = { key: '' } // 尺寸未变化时不重复调用 resize

function applySize(): void {
  let w: number, h: number
  if (!expanded) {
    // 收起态:宽高都随内容(每站点一行),宽度上限防超长名称
    els.app.style.width = 'max-content'
    w = Math.max(SIZE.collapsedWindow.w, Math.min(els.pill.scrollWidth + 12, 460))
    h = Math.max(SIZE.collapsedWindow.h, els.pill.scrollHeight + 12)
  } else {
    els.app.style.width = `${SIZE.cardWidth}px`
    // 卡片内容尽量完整展示;极高时受 CSS max-height(890) 限制转为卡片内滚动,
    // 小屏幕再由主进程按工作区高度钳制
    w = SIZE.cardWidth + 12
    h = Math.min(els.card.scrollHeight + 14, 890 + 14)
  }
  w = Math.ceil(w)
  h = Math.ceil(h)
  const key = `${expanded ? 'x' : 'p'}:${w}x${h}`
  if (key === lastApplied.key) return
  lastApplied.key = key
  api.resize(w, h)
}

function expand(): void {
  expanded = true
  els.pill.style.display = 'none'
  view = 'list'
  showView()
  els.card.hidden = false
  applySize()
}

function collapse(): void {
  expanded = false
  els.card.hidden = true
  els.pill.style.display = 'flex'
  els.app.style.width = ''
  applySize()
}

// ---------- 状态分发 ----------

function render(s: BalanceSnapshot): void {
  state = s
  renderPill(s.sites)
  if (expanded) {
    renderList(s.sites)
    if (view === 'edit') return // 编辑中不重排窗口高度,避免打断输入
    applySize()
  } else {
    applySize() // 余额变化/站点增删后胶囊宽高跟随
  }
}

// ---------- 事件 ----------

// #pill 本体是窗口拖拽区(app-region: drag),原生吞掉 click/contextmenu——
// 鼠标展开只能走 #pillExpand(no-drag);键盘 Enter 走合成 click,仍可用
els.pillExpand.addEventListener('click', (e) => {
  e.stopPropagation()
  expand()
})
els.pill.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  expand()
})

els.pill.addEventListener('click', () => {
  expand()
})
els.pill.addEventListener('keydown', (e) => {
  if ((e as KeyboardEvent).key === 'Enter') els.pill.click()
})
els.btnCollapse.addEventListener('click', collapse)
els.btnAdd.addEventListener('click', openAdd)
els.btnAddBottom.addEventListener('click', openAdd)
els.btnRefreshAll.addEventListener('click', () => {
  void api.refreshNow().catch(() => {})
})
// 账单明细入口:卡片按钮与胶囊"已用"行都打开同一个账单窗口
els.btnBilling.addEventListener('click', () => {
  api.openBilling()
})
els.pillUsed.addEventListener('click', (e) => {
  e.stopPropagation() // 别触发 #pill 的展开
  api.openBilling()
})
els.btnSave.addEventListener('click', () => {
  void saveEditing()
})
els.btnDelete.addEventListener('click', () => {
  void deleteEditing()
})
els.btnBack.addEventListener('click', () => {
  view = 'list'
  showView()
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && expanded) {
    if (view === 'edit') {
      view = 'list'
      showView()
    } else {
      collapse()
    }
  }
})

// ---------- 启动 ----------

async function refreshDescriptions(): Promise<void> {
  const desc = await api.describeSites()
  descriptions = new Map(
    desc.sites.filter((d) => d.id).map((d) => [d.id as string, d] as [string, BalanceSiteDescription])
  )
}

async function init(): Promise<void> {
  await refreshDescriptions()
  render(await api.getState())
  window.api.onBalance.state(render)
  const unconfigured = state.sites.filter((s) => s.enabled && s.status === 'no-token')
  if (unconfigured.length === state.sites.length && state.sites.length) {
    expand() // 首次使用:全部未配置时直接展示列表引导
  }
}

void init()
