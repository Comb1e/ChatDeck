/**
 * 调度器——移植自 token-balance src/main/api-client.js。
 * 并行轮询所有启用站点，维护每站点的独立状态机。
 *
 * 每站点状态机（互不影响）:
 *   no-token ──saveSite──▶ loading ──成功──▶ ok
 *      ▲                       │                 │
 *      └──未启用/清空凭据──────┼──凭据失效──▶ auth-error(需用户重新粘贴)
 *                              ├──网络失败──▶ network-error(下个周期自动重试)
 *                              └──响应异常──▶ api-error(下个周期自动重试)
 *   ok/*-error ──定时/手动刷新──▶ loading
 *   disabled:站点被停用,不参与轮询
 *
 * 与原版的差别仅在于：模块级单例改为实例（配置存储由组合根注入，便于测试）。
 */
import type {
  BalanceRefreshResult,
  BalanceSaveResult,
  BalanceSite,
  BalanceSiteInput,
  BalanceSiteState,
  BalanceSnapshot,
  BalanceUsedSource
} from '@shared/balance'
import { getAdapter } from './providers'
import type { BalanceProvider } from './providers'
import type { BalanceStore } from './store'
import { dayKey, type UsageStore } from './usage'

const STATUS_BY_KIND: Record<string, BalanceSiteState['status']> = {
  setup: 'no-token',
  auth: 'auth-error',
  network: 'network-error',
  api: 'api-error'
}

function nowIso(): string {
  return new Date().toISOString()
}

export class BalanceScheduler {
  private state: BalanceSnapshot = { sites: [] }
  private fetching = false
  private timer: ReturnType<typeof setInterval> | null = null
  private onStateChange: ((snapshot: BalanceSnapshot) => void) | null = null

  constructor(
    private readonly store: BalanceStore,
    private readonly usage: UsageStore
  ) {}

  snapshot(): BalanceSnapshot {
    return JSON.parse(JSON.stringify(this.state)) as BalanceSnapshot
  }

  private publish(): void {
    if (this.onStateChange) this.onStateChange(this.snapshot())
  }

  private replaceSiteState(id: string, patch: Partial<BalanceSiteState>): void {
    const idx = this.state.sites.findIndex((s) => s.id === id)
    if (idx < 0) return
    this.state.sites[idx] = { ...this.state.sites[idx], ...patch }
  }

  private async tickSite(
    site: BalanceSite,
    onTokensRefreshed: (tokens: { accessToken: string; refreshToken: string }) => void
  ): Promise<void> {
    const adapter: BalanceProvider | null = getAdapter(site.type)
    this.replaceSiteState(site.id, { status: 'loading', message: null })

    if (!adapter) {
      this.replaceSiteState(site.id, {
        status: 'api-error',
        message: `未知站点类型: ${site.type}`,
        updatedAt: nowIso()
      })
      return
    }
    if (!site.enabled) {
      this.replaceSiteState(site.id, { status: 'disabled', message: null })
      return
    }
    if (!adapter.hasCredentials(site)) {
      this.replaceSiteState(site.id, { status: 'no-token', message: null, balance: null })
      return
    }

    try {
      const { balance, currency, note, used } = await adapter.getBalance({ site, onTokensRefreshed })
      const cur = currency || adapter.balanceUnit || 'USD'
      // 站点"已用"口径:优先站点记账(api),否则回退本机计量(余额下降累计);百分比额度站点不参与
      let usedValue: number | null = null
      let usedSource: BalanceUsedSource | null = null
      if (cur !== 'PCT') {
        if (typeof used === 'number' && Number.isFinite(used)) {
          this.usage.recordApiUsed(site.id, cur, used, nowIso())
          usedValue = used
          usedSource = 'api'
        } else {
          const lastApi = this.usage.get(site.id)
          if (lastApi?.apiUsed != null && lastApi.apiUsedCurrency === cur) {
            usedValue = lastApi.apiUsed
            usedSource = 'api'
          }
        }
        if (usedValue === null) {
          const obs = this.usage.apply(site.id, cur, balance, dayKey(new Date()))
          usedValue = obs.record.meterTotal
          usedSource = obs.record.meterSince ? 'metered' : null
        } else {
          // 有站点记账时本机计量照常累积(站点接口失效时的后备),只是不用于展示
          this.usage.apply(site.id, cur, balance, dayKey(new Date()))
        }
      }
      this.replaceSiteState(site.id, {
        status: 'ok',
        balance,
        currency: cur,
        used: usedValue,
        usedSource,
        // note 为成功态补充说明(如 volcark 的额度重置时间),ok 态由渲染层展示
        message: note ?? null,
        updatedAt: nowIso(),
        lastSuccessAt: nowIso()
      })
    } catch (e) {
      const err = e as { kind?: string; message?: string }
      this.replaceSiteState(site.id, {
        status: STATUS_BY_KIND[err.kind ?? ''] ?? 'api-error',
        message: err.message ?? String(e),
        updatedAt: nowIso()
      })
      if (err.kind === 'setup') this.replaceSiteState(site.id, { balance: null })
    }
  }

  /** 拉取全部启用站点；siteId 传入时只拉取该站点（用于保存后验证） */
  async tick(siteId: string | null = null): Promise<BalanceSnapshot> {
    if (this.fetching) return this.snapshot()
    this.fetching = true
    try {
      // 配置可能刚被修改:以最新配置重建站点状态列表(保留已有的成功数据)
      this.syncSiteList()
      const targets = siteId
        ? this.state.sites.filter((s) => s.id === siteId)
        : this.state.sites.filter((s) => s.enabled)
      this.publish()

      await Promise.allSettled(
        targets.map(async (st) => {
          const site = this.store.getSite(st.id)
          if (!site) return
          await this.tickSite(site, (tokens) => {
            this.store.updateSiteFields(st.id, tokens) // 轮换后的新凭据写回该站点
          })
        })
      )
      this.publish()
    } finally {
      this.fetching = false
    }
    return this.snapshot()
  }

  /** 配置变更后同步状态列表:新增站点补位,删除站点移除,字段(label/icon/enabled)跟随 */
  private syncSiteList(): void {
    const sites = this.store.getSites()
    const byId = new Map(this.state.sites.map((s) => [s.id, s]))
    this.state.sites = sites.map((site) => {
      const prev = byId.get(site.id)
      const base: BalanceSiteState = prev ?? {
        id: site.id,
        label: site.label,
        icon: site.icon,
        enabled: site.enabled !== false,
        status: site.enabled === false ? 'disabled' : 'no-token',
        balance: null,
        // 首次成功前错误占位也要按适配器单位显示(如 volcark 的 '--' 而非 '$ --')
        currency: getAdapter(site.type)?.balanceUnit || 'USD',
        used: null,
        usedSource: null,
        message: null,
        updatedAt: null,
        lastSuccessAt: null
      }
      const enabled = site.enabled !== false
      // 停用立即进入 disabled;重新启用则回到 no-token 等待下一轮拉取
      let status = base.status
      if (!enabled) status = 'disabled'
      else if (prev && prev.status === 'disabled') status = 'no-token'
      return { ...base, label: site.label, icon: site.icon, enabled, status }
    })
  }

  async saveSite(input: BalanceSiteInput): Promise<BalanceSaveResult> {
    const site = this.sanitize(input)
    const errors = this.validate(site)
    if (errors) return { ok: false, message: errors }
    const saved = this.store.upsertSite(site)
    if (saved.enabled === false) {
      this.syncSiteList()
      this.publish()
      return { ok: true, id: saved.id }
    }
    await this.tick(saved.id)
    const st = this.state.sites.find((s) => s.id === saved.id)
    if (st && st.status === 'ok') return { ok: true, id: saved.id }
    return { ok: false, id: saved.id, message: st?.message || `验证失败(${st?.status})` }
  }

  async removeSite(id: string): Promise<{ ok: boolean }> {
    this.store.removeSite(id)
    this.usage.remove(id) // 台账跟着站点一起删,不留孤儿数据
    await this.tick()
    return { ok: true }
  }

  /** 仅调整展示顺序:不触发轮询,立即重排状态列表并推送(胶囊与列表顺序跟随) */
  async moveSite(id: string, delta: -1 | 1): Promise<{ ok: boolean }> {
    const before = this.store.getSites().map((s) => s.id).join('\n')
    const after = this.store.moveSite(id, delta).map((s) => s.id).join('\n')
    if (before === after) return { ok: false }
    this.syncSiteList()
    this.publish()
    return { ok: true }
  }

  async refreshNow(): Promise<BalanceRefreshResult> {
    try {
      await this.tick()
      return { ok: true }
    } catch (e) {
      return { ok: false, message: (e as Error).message }
    }
  }

  private sanitize(site: BalanceSiteInput): BalanceSiteInput {
    return {
      id: site.id || null,
      type: typeof site.type === 'string' && site.type ? site.type : 'sub2api',
      label: String(site.label || '').trim() || '未命名站点',
      icon: typeof site.icon === 'string' && site.icon ? site.icon : 'openai',
      apiBaseUrl: String(site.apiBaseUrl || '').trim(),
      usageUrl: String(site.usageUrl || '').trim(),
      accessToken: String(site.accessToken || '').trim(),
      refreshToken: String(site.refreshToken || '').trim(),
      enabled: site.enabled !== false
    }
  }

  /** 返回 null 表示合法，否则为错误消息 */
  private validate(site: BalanceSiteInput): string | null {
    if (!/^https?:\/\//i.test(site.apiBaseUrl)) {
      return 'API 地址需以 http(s):// 开头'
    }
    const others = this.store.getSites().filter((s) => s.id !== site.id)
    if (
      others.some(
        (s) => s.apiBaseUrl.replace(/\/+$/, '') === site.apiBaseUrl.replace(/\/+$/, '')
      )
    ) {
      return '已存在相同 API 地址的站点'
    }
    // 编辑已保存站点时"留空保持不变"
    const existing = site.id ? this.store.getSite(site.id) : null
    if (!site.accessToken && existing) site.accessToken = existing.accessToken
    if (!site.refreshToken && existing) site.refreshToken = existing.refreshToken
    return null // 允许暂不配置 Token:保存后列表中显示"未配置"态
  }

  startSchedule(cb: (snapshot: BalanceSnapshot) => void): Promise<BalanceSnapshot> {
    this.onStateChange = cb
    this.syncSiteList()
    this.publish()
    const minutes = this.store.load().refreshIntervalMinutes
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(
      () => {
        void this.tick().catch(() => {})
      },
      minutes * 60 * 1000
    )
    return this.tick().catch(() => this.snapshot())
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
