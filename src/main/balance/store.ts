/**
 * 余额监控配置存储——移植自 token-balance src/shared/store.js。
 * 与原版唯一差别：配置文件路径由组合根注入（ChatDeck 用 userData，
 * 原版写在项目根目录——打包进 asar 后会变成只读，必须改）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { BalanceConfig, BalanceSite, BalanceWindowPatch } from '@shared/balance'

function defaultSite(): BalanceSite {
  return {
    id: 'spacetimeai',
    type: 'sub2api',
    label: 'SpacetimeAI',
    icon: 'openai',
    apiBaseUrl: 'https://spacetimeai.cc/api/v1',
    usageUrl: 'https://spacetimeai.cc/usage',
    accessToken: '',
    refreshToken: '',
    enabled: true
  }
}

export const BALANCE_DEFAULTS: BalanceConfig = {
  refreshIntervalMinutes: 5,
  window: { x: null, y: null, visible: false },
  sites: [defaultSite()]
}

type Json = Record<string, unknown>

function isPlainObject(v: unknown): v is Json {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function deepMerge(base: unknown, patch: unknown): Json {
  const out: Json = isPlainObject(base) ? { ...base } : {}
  for (const [key, value] of Object.entries((patch as Json) ?? {})) {
    // 数组整体替换，不逐元素合并（站点列表以 patch 为准）
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value)
    } else if (value !== undefined) {
      out[key] = value
    }
  }
  return out
}

function clampInterval(minutes: unknown): number {
  const n = Number(minutes)
  if (!Number.isFinite(n)) return BALANCE_DEFAULTS.refreshIntervalMinutes
  return Math.min(60, Math.max(1, Math.round(n)))
}

/** 旧版单站点格式 {provider, providers:{key:{...}}} → sites 数组，凭据无损保留 */
function migrateOldFormat(raw: Json): Json {
  const sites: BalanceSite[] = []
  const providers = raw.providers
  if (isPlainObject(providers)) {
    for (const [key, p] of Object.entries(providers)) {
      if (!isPlainObject(p)) continue
      sites.push({
        id: key,
        type: 'sub2api',
        label: key === 'spacetimeai' ? 'SpacetimeAI' : key.charAt(0).toUpperCase() + key.slice(1),
        icon: typeof p.icon === 'string' && p.icon ? p.icon : 'openai',
        apiBaseUrl: typeof p.apiBaseUrl === 'string' ? p.apiBaseUrl : '',
        usageUrl: typeof p.usageUrl === 'string' ? p.usageUrl : '',
        accessToken: typeof p.accessToken === 'string' ? p.accessToken : '',
        refreshToken: typeof p.refreshToken === 'string' ? p.refreshToken : '',
        enabled: true
      })
    }
  }
  if (!sites.length) sites.push(defaultSite())
  const next: Json = { ...raw, refreshIntervalMinutes: raw.refreshIntervalMinutes, window: raw.window, sites }
  delete next.provider
  delete next.providers
  return next
}

function genId(): string {
  return 'site-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}

/** 补默认值与合法性（新站点缺字段、非法 interval 等） */
function normalize(raw: Json): BalanceConfig {
  const next = deepMerge(BALANCE_DEFAULTS, {
    ...raw,
    refreshIntervalMinutes: clampInterval(raw.refreshIntervalMinutes)
  })
  const sites = Array.isArray(next.sites) ? next.sites : []
  next.sites = sites
    .filter((s): s is Json => isPlainObject(s))
    .map((s) => ({
      id: String(s.id || genId()),
      type: typeof s.type === 'string' && s.type ? s.type : 'sub2api',
      label: String(s.label || '未命名站点'),
      icon: typeof s.icon === 'string' && s.icon ? s.icon : 'openai',
      apiBaseUrl: typeof s.apiBaseUrl === 'string' ? s.apiBaseUrl : '',
      usageUrl: typeof s.usageUrl === 'string' ? s.usageUrl : '',
      accessToken: typeof s.accessToken === 'string' ? s.accessToken : '',
      refreshToken: typeof s.refreshToken === 'string' ? s.refreshToken : '',
      enabled: s.enabled !== false
    }))
  const win = isPlainObject(next.window) ? next.window : {}
  next.window = {
    x: Number.isFinite(win.x) ? (win.x as number) : null,
    y: Number.isFinite(win.y) ? (win.y as number) : null,
    visible: win.visible === true
  }
  return next as unknown as BalanceConfig
}

export class BalanceStore {
  private cache: BalanceConfig | null = null

  constructor(private readonly filePath: string) {}

  getPath(): string {
    return this.filePath
  }

  load(): BalanceConfig {
    if (this.cache) return this.cache
    let raw: Json = {}
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (isPlainObject(parsed)) raw = parsed
    } catch {
      // 首次运行或文件损坏：回到默认值
    }
    let needsPersist = false
    if (!Array.isArray(raw.sites)) {
      raw = migrateOldFormat(raw)
      needsPersist = true
    }
    this.cache = normalize(raw)
    if (needsPersist) this.persist()
    return this.cache
  }

  private persist(): void {
    const target = this.filePath
    mkdirSync(dirname(target), { recursive: true })
    // 先写临时文件再改名：进程被杀/断电不会留下半个 JSON
    const tmp = `${target}.tmp`
    writeFileSync(tmp, JSON.stringify(this.cache, null, 2) + '\n', 'utf8')
    renameSync(tmp, target)
  }

  save(patch: Json): BalanceConfig {
    const next = normalize(deepMerge(this.load(), patch))
    this.cache = next
    this.persist()
    return next
  }

  getSites(): BalanceSite[] {
    return this.load().sites
  }

  getSite(id: string): BalanceSite | null {
    return this.load().sites.find((s) => s.id === id) || null
  }

  /** 新增或更新站点（按 id 匹配；无 id 或未命中则追加）。返回保存后的站点（含 id）。 */
  upsertSite(
    site: Omit<Partial<BalanceSite>, 'id'> & { id?: string | null }
  ): BalanceSite {
    const cfg = this.load()
    const sites = [...cfg.sites]
    const idx = sites.findIndex((s) => s.id === site.id)
    let saved: BalanceSite
    if (idx >= 0) {
      saved = { ...sites[idx], ...site, id: sites[idx].id }
      sites[idx] = saved
    } else {
      saved = { ...site, id: site.id || genId() } as BalanceSite
      sites.push(saved)
    }
    this.save({ sites })
    return saved
  }

  removeSite(id: string): BalanceSite[] {
    const cfg = this.load()
    return this.save({ sites: cfg.sites.filter((s) => s.id !== id) }).sites
  }

  /**
   * 调整站点顺序(delta=-1 上移 / +1 下移)。
   * 越界(已在边界继续同向移动)或未知 id 时原样返回,不写盘;
   * 成功即持久化——sites 数组序就是胶囊与列表的展示序。
   */
  moveSite(id: string, delta: -1 | 1): BalanceSite[] {
    const cfg = this.load()
    const from = cfg.sites.findIndex((s) => s.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= cfg.sites.length) return cfg.sites
    const sites = [...cfg.sites]
    const [moved] = sites.splice(from, 1)
    sites.splice(to, 0, moved as BalanceSite)
    return this.save({ sites }).sites
  }

  updateSiteFields(id: string, patch: Partial<BalanceSite>): BalanceSite[] {
    const site = this.getSite(id)
    if (!site) return this.getSites()
    this.upsertSite({ ...site, ...patch })
    return this.getSites()
  }

  /** 窗口位置与显隐状态（与站点配置同文件，原版即如此） */
  patchWindow(patch: BalanceWindowPatch): void {
    const cfg = this.load()
    this.save({ window: { ...cfg.window, ...patch } })
  }

  setWindowVisible(visible: boolean): void {
    if (this.load().window.visible === visible) return
    this.patchWindow({ visible })
  }
}
