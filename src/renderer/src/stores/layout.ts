import { defineStore } from 'pinia'
import type { LayoutMode, PaneLayoutEntry, Rect, UiState } from '@shared/types'
import { adjustRatios, assignPane, computeRects } from '@shared/layout'
import { useProvidersStore } from './providers'

/** 窗格头高度（HTML 部分，站点视图从其下方开始） */
export const HEADER_H = 34
/** 窗格间缝隙（HTML 分割条） */
export const PANE_GAP = 8
/** 单窗格最小宽度 */
export const MIN_PANE_W = 280

function modePanes(mode: LayoutMode): number {
  return mode === 'single' ? 1 : mode === 'split2' ? 2 : 3
}

function equalRatios(n: number): number[] {
  return Array.from({ length: n }, () => 1)
}

interface LayoutState {
  mode: LayoutMode
  panes: string[]
  ratios: number[]
  activeId: string | null
  container: Rect | null
  /** 持久化防抖定时器（非序列化字段） */
  persistTimer: ReturnType<typeof setTimeout> | null
  /** 拖动开始时的比例快照（非序列化字段） */
  dragRatios: number[] | null
}

/**
 * 布局状态机：single ⇄ split2 ⇄ split3。
 * 渲染层计算矩形（CSS px == DIP），经 IPC 让主进程定位 WebContentsView。
 */
export const useLayoutStore = defineStore('layout', {
  state: (): LayoutState => ({
    mode: 'single',
    panes: [],
    ratios: [],
    activeId: null,
    container: null,
    persistTimer: null,
    dragRatios: null
  }),

  getters: {
    paneCount(state): number {
      return state.panes.length
    },
    activeIndex(state): number {
      return state.activeId ? state.panes.indexOf(state.activeId) : -1
    },
    /** 窗格权重（缺省为 1，均分） */
    paneSpecs(state) {
      return state.panes.map((id, i) => ({ id, ratio: state.ratios[i] ?? 1 }))
    },
    paneRects(state) {
      if (!state.container || state.panes.length === 0) return []
      const specs = state.panes.map((id, i) => ({ id, ratio: state.ratios[i] ?? 1 }))
      return computeRects(state.container, specs, {
        gap: PANE_GAP,
        minPaneWidth: MIN_PANE_W
      })
    }
  },

  actions: {
    setContainer(rect: Rect): void {
      this.container = rect
      this.sync()
    },

    async restore(): Promise<void> {
      const saved = await window.api.state.get()
      const providers = useProvidersStore()
      const enabled = providers.enabled
      let panes: string[] = []
      let mode: LayoutMode = 'single'
      let ratios: number[] = []

      if (saved) {
        mode = saved.mode
        panes = (saved.paneProviderIds ?? []).filter(
          (id) => id && enabled.some((p) => p.id === id)
        )
        ratios = Array.isArray(saved.ratios) ? saved.ratios.filter((r) => Number.isFinite(r)) : []
      }
      // 校正：窗格数与模式一致；不足则降级模式
      if (panes.length > modePanes(mode)) panes = panes.slice(0, modePanes(mode))
      if (panes.length < modePanes(mode)) {
        for (const p of enabled) {
          if (panes.length >= modePanes(mode)) break
          if (!panes.includes(p.id)) panes.push(p.id)
        }
        if (panes.length < modePanes(mode)) mode = panes.length <= 1 ? 'single' : `split${panes.length}` as LayoutMode
      }
      if (panes.length === 0 && enabled.length > 0) panes = [enabled[0].id]
      if (ratios.length !== panes.length) ratios = equalRatios(panes.length)

      this.mode = mode
      this.panes = panes
      this.ratios = ratios
      this.activeId = saved?.activeProviderId && panes.includes(saved.activeProviderId)
        ? saved.activeProviderId
        : (panes[0] ?? null)
      this.sync()
    },

    /** 侧边栏点击：单屏替换当前窗格；分屏下替换活动窗格（已在别的窗格则互换） */
    activate(id: string): void {
      const providers = useProvidersStore()
      if (!providers.byId(id)?.enabled) return
      if (this.mode === 'single') {
        this.panes = [id]
      } else {
        const idx = this.activeIndex >= 0 ? this.activeIndex : 0
        this.panes = assignPane(this.panes, idx, id)
      }
      this.setActivePane(id)
      this.sync()
    },

    setMode(mode: LayoutMode): void {
      const providers = useProvidersStore()
      const enabled = providers.enabled
      if (modePanes(mode) > enabled.length) return
      const target = modePanes(mode)
      // 调整窗格数量：多退少补（补位取未显示的已启用站点）
      let panes = this.panes.slice(0, target)
      for (const p of enabled) {
        if (panes.length >= target) break
        if (!panes.includes(p.id)) panes.push(p.id)
      }
      if (panes.length < target) return
      this.panes = panes
      this.mode = mode
      this.ratios = equalRatios(target)
      if (!this.activeId || !panes.includes(this.activeId)) this.activeId = panes[0]
      this.sync()
    },

    closePane(id: string): void {
      if (this.mode === 'single') return
      const providers = useProvidersStore()
      const enabled = providers.enabled
      let panes = this.panes.filter((x) => x !== id)
      if (panes.length === 0) {
        const fallback = enabled.find((p) => p.id !== id)
        if (!fallback) return
        panes = [fallback.id]
      }
      this.panes = panes
      if (panes.length === 1) this.mode = 'single'
      this.ratios = this.ratios.slice(0, panes.length)
      while (this.ratios.length < panes.length) this.ratios.push(1)
      if (!panes.includes(this.activeId ?? '')) this.activeId = panes[0]
      this.sync()
    },

    setActivePane(id: string): void {
      if (!this.panes.includes(id)) return
      this.activeId = id
      window.api.view.setActive(id)
      useProvidersStore().clearUnread(id)
    },

    /** 主进程 webContents focus 事件 → 活动窗格变化 */
    onMainActiveChanged(id: string): void {
      if (!this.panes.includes(id)) return
      this.activeId = id
      useProvidersStore().clearUnread(id)
    },

    applyRatios(ratios: number[]): void {
      this.ratios = ratios
      this.sync()
    },

    /** 设置里启停厂商后，把已禁用的站点请出窗格 */
    prunePanes(): void {
      if (this.panes.length === 0) return
      const providers = useProvidersStore()
      const enabled = providers.enabled
      const kept = this.panes.filter((id) => enabled.some((p) => p.id === id))
      if (kept.length === 0 && enabled.length > 0) kept.push(enabled[0].id)
      if (kept.length === this.panes.length && kept.every((v, i) => v === this.panes[i])) return
      this.panes = kept
      if (this.panes.length === 1) this.mode = 'single'
      else if (this.panes.length < modePanes(this.mode)) this.mode = this.panes.length === 2 ? 'split2' : 'single'
      this.ratios = equalRatios(this.panes.length)
      if (!this.panes.includes(this.activeId ?? '')) this.activeId = this.panes[0] ?? null
      this.sync()
    },

    sync(): void {
      if (!this.container) return
      // 站点视图矩形 = 窗格矩形扣除窗格头（HTML 部分）
      const entries: PaneLayoutEntry[] = this.paneRects.map(({ id, rect }) => ({
        id,
        rect: {
          x: rect.x,
          y: rect.y + HEADER_H,
          width: rect.width,
          height: Math.max(0, rect.height - HEADER_H)
        }
      }))
      void window.api.view.setLayout(entries)
      this.persistSoon()
    },

    persistSoon(): void {
      if (this.persistTimer) clearTimeout(this.persistTimer)
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null
        void window.api.state.save(this.snapshot())
      }, 400)
    },

    snapshot(): UiState {
      return {
        activeProviderId: this.activeId,
        mode: this.mode,
        paneProviderIds: [...this.panes],
        ratios: [...this.ratios]
      }
    },

    /** 拖动分割条：以拖动开始时的比例为基准计算 */
    beginDrag(): number[] {
      this.dragRatios = [...this.ratios]
      return this.dragRatios
    },
    dragTo(dividerIndex: number, dx: number, flexWidth: number): void {
      if (!this.dragRatios) return
      this.ratios = adjustRatios(this.dragRatios, dividerIndex, dx, flexWidth, MIN_PANE_W)
      this.sync()
    },
    endDrag(): void {
      this.dragRatios = null
      this.persistSoon()
    }
  }
})
