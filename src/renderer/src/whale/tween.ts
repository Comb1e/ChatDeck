/**
 * 极轻量补间/等待引擎——移植自 whale-pet src/tween.js。
 * 返回的 Promise 带 cancel(),供状态机 Ctx 统一取消管理。
 */
export type EaseName =
  | 'linear'
  | 'smooth'
  | 'inQuad'
  | 'outQuad'
  | 'inOutQuad'
  | 'inCubic'
  | 'outCubic'
  | 'outBack'
  | 'outElastic'

export interface TweenResult {
  cancelled: boolean
}

export type CancelablePromise<T> = Promise<T> & { cancel(): void }

export interface TweenRunOptions {
  duration?: number
  delay?: number
  ease?: EaseName
  onUpdate?: (k: number) => void
  onComplete?: () => void
}

interface ActiveTween {
  start: number
  duration: number
  ease: (t: number) => number
  onUpdate?: (k: number) => void
  onComplete?: () => void
  finished: boolean
  finish: (cancelled: boolean) => void
}

const active = new Set<ActiveTween>()
const waits = new Set<object>()
let wake: () => void = () => {}

export const Ease: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  smooth: (t) => t * t * t * (10 + t * (-15 + 6 * t)),
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outBack: (t) => {
    const c = 2.0
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
  },
  outElastic: (t) =>
    t === 0
      ? 0
      : t === 1
        ? 1
        : Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1
}

export function run(opts: TweenRunOptions): CancelablePromise<TweenResult> {
  const { duration = 0, delay = 0, ease = 'linear', onUpdate, onComplete } = opts
  const tw: ActiveTween = {
    start: performance.now() + delay,
    duration,
    ease: Ease[ease] ?? Ease.linear,
    onUpdate,
    onComplete,
    finished: false,
    finish: () => {}
  }
  let resolveP: (r: TweenResult) => void = () => {}
  const promise = new Promise<TweenResult>((res) => {
    resolveP = res
  }) as CancelablePromise<TweenResult>
  tw.finish = (cancelled: boolean): void => {
    if (tw.finished) return
    tw.finished = true
    active.delete(tw)
    if (!cancelled && duration > 0 && tw.onUpdate) tw.onUpdate(1)
    if (!cancelled && tw.onComplete) tw.onComplete()
    resolveP({ cancelled: !!cancelled })
  }
  active.add(tw)
  wake()
  promise.cancel = () => tw.finish(true)
  return promise
}

export function update(now: number): void {
  /* 直接迭代 Set:finish() 只删除当前项,for..of 语义安全 */
  for (const tw of active) {
    if (now < tw.start) continue
    if (tw.duration <= 0) {
      tw.finish(false)
      continue
    }
    const k = Math.min(1, (now - tw.start) / tw.duration)
    if (tw.onUpdate) tw.onUpdate(tw.ease(k))
    if (k >= 1) tw.finish(false)
  }
}

export function wait(ms: number): CancelablePromise<TweenResult> {
  let finish: (cancelled: boolean) => void = () => {}
  const promise = new Promise<TweenResult>((resolve) => {
    const entry: { timer: ReturnType<typeof setTimeout> | null } = { timer: null }
    finish = (cancelled: boolean): void => {
      if (!waits.delete(entry)) return
      if (entry.timer !== null) clearTimeout(entry.timer)
      resolve({ cancelled })
    }
    waits.add(entry)
    entry.timer = setTimeout(() => finish(false), ms)
  }) as CancelablePromise<TweenResult>
  promise.cancel = () => finish(true)
  return promise
}

export const Tween = {
  run,
  wait,
  update,
  Ease,
  setWake: (fn: () => void): void => {
    wake = fn
  },
  hasAnimations: (): boolean => active.size > 0,
  stats: (): { animations: number; waits: number } => ({ animations: active.size, waits: waits.size })
}
