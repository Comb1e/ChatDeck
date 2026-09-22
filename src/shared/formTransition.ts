import type { Rect } from './types'

export const FORM_CONFIG = {
  durationMs: 700,
  mouthMs: 200,
  readyTimeoutMs: 2000,
  /** 收起方向:外壳在真实悬浮窗上方淡入盖满的时长,盖满后主进程才隐藏悬浮窗 */
  coverMs: 140,
  /** 收起方向:play 到上报 covered 的总延迟 = 外壳淡入 + 鲸鱼窗口自身 DWM 显示过渡的余量。
   *  鲸鱼窗口 re-show 时的系统级淡入(~200ms)会让整个窗口半透明,过早隐藏悬浮窗,
   *  真实 UI 会在半透明外壳下面被硬切掉(表现为从第二次切换起每次闪烁) */
  coveredDelayMs: 340,
  /** 收起中途反向回展开时,外壳淡出让真实 UI 重新显露的时长 */
  uncoverMs: 120,
  /** 展开完成到清空/隐藏鲸鱼窗口的延迟:给悬浮窗的 DWM 显示过渡留足时间,避免露出半透明中间态 */
  retireDelayMs: 300,
  inset: { x: 24, y: 24 },
  radius: 18,
  contentColor: '#131824',
  contourSamples: 192
} as const

export type Form = 'whale' | 'float'
/** Exact composed pose, rather than the physics pose before bob/sway/stretch. */
export interface PetVisual {
  x: number; y: number; rot: number; sx: number; sy: number; flip: number
  scale: number; sway: number; tailAngle: number; gx: number; gy: number
  expression: string; blink: number
}
export interface FormScene {
  pet: PetVisual
  /** Both endpoints use screen DIP coordinates. */
  panel: Rect
  workarea: Rect
}
export type FormCommand =
  | { type: 'capture'; id: number }
  | { type: 'prepare'; id: number; scene: FormScene; from: Form }
  | { type: 'play'; id: number; revision: number; target: Form }
  | { type: 'present'; id: number; revision: number }
  | { type: 'settle'; id: number; form: Form; scene?: FormScene }
export type FormReport =
  | { type: 'captured'; id: number; pet: PetVisual }
  | { type: 'prepared'; id: number }
  | { type: 'complete'; id: number; revision: number; form: Form }
  | { type: 'presented'; id: number; revision: number }
  | { type: 'covered'; id: number }

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))
export function smooth(n: number): number {
  const t = clamp01(n)
  return t * t * t * (10 + t * (-15 + 6 * t))
}

/** A reversible clock: direction changes never reset position or easing. */
export class FormTimeline {
  progress: number
  target: Form
  private last: number
  constructor(from: Form, now: number) {
    this.progress = from === 'float' ? 1 : 0
    this.target = from
    this.last = now
  }
  advance(now: number): number {
    const dt = Math.max(0, now - this.last)
    this.last = Math.max(this.last, now)
    this.progress = clamp01(this.progress + (this.target === 'float' ? 1 : -1) * dt / FORM_CONFIG.durationMs)
    return this.progress
  }
  reverseTo(target: Form, now: number): void {
    this.advance(now)
    this.target = target
  }
  /** Re-anchor after a deliberate hold (collapse crossfade) so the next advance starts from now. */
  resync(now: number): void {
    this.last = now
  }
  get done(): boolean { return this.progress === (this.target === 'float' ? 1 : 0) }
}
