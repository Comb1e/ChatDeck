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
 */
export type ViewState = 'idle' | 'loading' | 'ready' | 'failed' | 'crashed'

export type ViewEvent =
  | { type: 'attach' }
  | { type: 'load-success' }
  | { type: 'load-failed' }
  | { type: 'crash' }
  | { type: 'reload' }
  | { type: 'detach' }

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

/** 需要在窗格头展示的异常状态 */
export function isErrorState(state: ViewLoadState): boolean {
  return state === 'failed' || state === 'crashed'
}
