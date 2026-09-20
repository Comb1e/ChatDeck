import type { ViewLoadState } from './types'

/**
 * 站点视图生命周期状态机。
 *
 * idle ──attach──▶ loading ──load-success──▶ ready
 *                    │ load-failed             │
 *                    ▼                         ▼
 *                  failed ◀────────────── (load-failed)
 *                    │  │ reload               │ reload
 *                    ▼  ▼                      ▼
 *                 loading ◀────── attach ──────┘
 *  任意状态 ──crash──▶ crashed ──reload──▶ loading
 *  任意状态 ──detach──▶ idle（视图仍在缓存中，仅从窗口移除）
 *  任意状态 ──sleep───▶ sleeping（视图已销毁释放内存，切回时经 attach 重建重载）
 */
export type ViewState = 'idle' | 'loading' | 'ready' | 'failed' | 'crashed' | 'sleeping'

export type ViewEvent =
  | { type: 'attach' }
  | { type: 'load-success' }
  | { type: 'load-failed' }
  | { type: 'crash' }
  | { type: 'reload' }
  | { type: 'detach' }
  | { type: 'sleep' }

export function viewTransition(state: ViewState, event: ViewEvent): ViewState {
  switch (event.type) {
    case 'attach':
      return 'loading'
    case 'load-success':
      return state === 'loading' ? 'ready' : state
    case 'load-failed':
      return state === 'loading' || state === 'ready' ? 'failed' : state
    case 'crash':
      return 'crashed'
    case 'reload':
      return state === 'crashed' || state === 'failed' ? 'loading' : state
    case 'detach':
      return 'idle'
    case 'sleep':
      return 'sleeping'
    default: {
      const exhaustive: never = event
      void exhaustive
      return state
    }
  }
}

/** 是否允许触发整页 reload（在非法状态下的 reload 请求应被忽略） */
export function canReload(state: ViewState): boolean {
  return state !== 'loading'
}

/**
 * 后台休眠判定：可见立即放行；不可见且距上次可见已超过阈值（毫秒）时休眠。
 * thresholdMs <= 0 表示该站点永不休眠。
 */
export function shouldSleepNow(
  visible: boolean,
  lastVisibleAt: number,
  now: number,
  thresholdMs: number
): boolean {
  if (thresholdMs <= 0) return false
  if (visible) return false
  return now - lastVisibleAt >= thresholdMs
}

/** 需要在窗格头展示的异常状态 */
export function isErrorState(state: ViewLoadState): boolean {
  return state === 'failed' || state === 'crashed'
}
