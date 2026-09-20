import { defineStore } from 'pinia'
import type { ViewLoadState } from '@shared/types'
import { floatChatRect } from '@shared/floatLayout'
import { useProvidersStore } from '../stores/providers'
import { usePromptsStore } from '../stores/prompts'

/** 悬浮窗内容模式:对话(内嵌站点视图) / 提示词速查(纯 HTML) */
export type FloatMode = 'chat' | 'prompts'

/** 隐藏站点视图但仍挂载(避免 detach→重挂导致的整页刷新) */
export const HIDDEN_RECT = { x: 0, y: 0, width: 0, height: 0 }

interface FloatState {
  ready: boolean
  expanded: boolean
  mode: FloatMode
  activeId: string | null
  loadStates: Record<string, ViewLoadState>
  toast: string | null
  toastTimer: ReturnType<typeof setTimeout> | null
}

/**
 * 悬浮窗状态机:展开 ⇄ 折叠、对话 ⇄ 提示词、活动站点切换。
 * 站点视图矩形经 fview:set-layout 交主进程定位(WebContentsView 覆盖在 HTML 之上)。
 */
export const useFloatStore = defineStore('float', {
  state: (): FloatState => ({
    ready: false,
    expanded: true,
    mode: 'chat',
    activeId: null,
    loadStates: {},
    toast: null,
    toastTimer: null
  }),

  actions: {
    async init(): Promise<void> {
      const providersStore = useProvidersStore()
      await Promise.all([providersStore.load(), usePromptsStore().load()])
      const saved = await window.api.float.getState()
      this.expanded = saved.expanded
      const enabled = providersStore.enabled
      this.activeId =
        saved.activeProviderId && enabled.some((p) => p.id === saved.activeProviderId)
          ? saved.activeProviderId
          : (enabled[0]?.id ?? null)

      window.api.onF.titleChanged((e) => {
        // 站点标题变化 = 可能有新消息;非活动站点记未读(头部圆点提示)
        providersStore.onTitleChanged(e.id, e.title, e.id === this.activeId)
      })
      window.api.onF.activeChanged((e) => {
        // 用户点击视图内部获得焦点 → 同步活动站点
        if (e.id !== this.activeId) {
          this.activeId = e.id
          window.api.float.setActiveProvider(e.id)
          providersStore.clearUnread(e.id)
        }
      })
      window.api.onF.loadStateChanged((e) => {
        this.loadStates[e.id] = e.state as ViewLoadState
      })

      this.ready = true
      this.sync()
    },

    activate(id: string): void {
      const providers = useProvidersStore()
      if (!providers.byId(id)?.enabled) return
      this.activeId = id
      this.mode = 'chat'
      providers.clearUnread(id)
      window.api.float.setActiveProvider(id)
      window.api.fview.setActive(id)
      this.sync()
    },

    async toggleExpanded(): Promise<void> {
      this.expanded = !this.expanded
      await window.api.float.resize(this.expanded)
      this.sync()
    },

    setMode(mode: FloatMode): void {
      this.mode = mode
      this.sync()
    },

    reloadActive(): void {
      if (this.activeId) window.api.fview.reload(this.activeId)
    },

    /** 把视图矩形同步给主进程;隐藏(折叠/提示词模式)时用零矩形保持挂载不刷新 */
    sync(): void {
      if (!this.ready) return
      const entries =
        this.expanded && this.mode === 'chat' && this.activeId
          ? [{ id: this.activeId, rect: floatChatRect() }]
          : this.activeId
            ? [{ id: this.activeId, rect: HIDDEN_RECT }]
            : []
      void window.api.fview.setLayout(entries)
    },

    showToast(msg: string): void {
      this.toast = msg
      if (this.toastTimer) clearTimeout(this.toastTimer)
      this.toastTimer = setTimeout(() => {
        this.toast = null
        this.toastTimer = null
      }, 2400)
    }
  }
})
