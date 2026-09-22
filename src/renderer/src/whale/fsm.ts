/**
 * 通用有限状态机:enter 为可取消的异步行为脚本——移植自 whale-pet src/fsm.js。
 * 切换状态时取消上一个 Ctx 的所有等待/动画/逐帧循环,
 * 行为脚本通过 ctx.check() 在每个 await 后快速退出。
 */
import { Tween } from './tween'
import type { CancelablePromise, TweenResult } from './tween'
import { Whale } from './whale'

export class CancelledError extends Error {
  constructor() {
    super('state cancelled')
  }
}

export interface FrameEntry {
  fn: (dtMs: number) => boolean | void
  resolve: (() => void) | null
}

/** 逐帧循环注册表:主循环每帧调用,fn 返回 false 时结束该循环 */
export const FrameLoops = new Set<FrameEntry>()

export interface StateResult {
  next: string
  params?: unknown
}

export type StateParams = Record<string, unknown>

export interface Behavior {
  enter(ctx: Ctx, params: StateParams): Promise<StateResult | void>
}

/** 逐帧循环由 go() 后的 requestPetFrame() 驱动(fsm.to 的调用方负责) */
export class Ctx {
  cancelled = false
  private readonly _pending = new Set<CancelablePromise<TweenResult>>()
  private readonly _frames = new Set<FrameEntry>()

  wait(ms: number): CancelablePromise<TweenResult> {
    return this._track(Tween.wait(ms))
  }

  animate(opts: Parameters<typeof Tween.run>[0]): CancelablePromise<TweenResult> {
    return this._track(Tween.run(opts))
  }

  private _track(p: CancelablePromise<TweenResult>): CancelablePromise<TweenResult> {
    if (this.cancelled) p.cancel()
    else this._pending.add(p)
    const cleanup = (): void => {
      this._pending.delete(p)
    }
    p.then(cleanup, cleanup)
    return p
  }

  frameLoop(fn: (dtMs: number) => boolean | void): Promise<TweenResult> {
    if (this.cancelled) return Promise.resolve({ cancelled: true })
    const entry: FrameEntry = { fn, resolve: null }
    this._frames.add(entry)
    FrameLoops.add(entry)
    return new Promise<TweenResult>((resolve) => {
      entry.resolve = (): void => {
        if (!FrameLoops.has(entry) && !this._frames.has(entry)) return
        this._frames.delete(entry)
        FrameLoops.delete(entry)
        resolve({ cancelled: this.cancelled })
      }
    })
  }

  private _endFrame(entry: FrameEntry): void {
    if (entry.resolve) entry.resolve()
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    for (const p of [...this._pending]) p.cancel()
    for (const f of [...this._frames]) this._endFrame(f)
  }

  check(): void {
    if (this.cancelled) throw new CancelledError()
  }
}

export class FSM {
  private readonly states = new Map<string, Behavior>()
  current: string | null = null
  private ctx: Ctx | null = null
  onStateEnd: ((name: string, result: StateResult | void) => void) | null = null

  add(name: string, behavior: Behavior): void {
    this.states.set(name, behavior)
  }

  cancel(): void {
    this.ctx?.cancel()
    this.ctx = null
    this.current = null
  }

  to(name: string, params?: StateParams): void {
    const behavior = this.states.get(name)
    if (!behavior) throw new Error('unknown state: ' + name)
    if (this.ctx) this.ctx.cancel()
    const ctx = new Ctx()
    this.ctx = ctx
    this.current = name
    Whale.setMotionMode(name)
    Promise.resolve()
      .then(() => {
        ctx.check()
        return behavior.enter(ctx, params ?? {})
      })
      .catch((err: unknown) => {
        if (!(err instanceof CancelledError)) console.error('[state:' + name + ']', err)
      })
      .then((result) => {
        if (this.ctx !== ctx) return // 已被新状态接管
        this.ctx = null
        this.current = null
        if (this.onStateEnd) this.onStateEnd(name, result)
      })
  }
}
