import type { Rect } from './types'

export const FORM_CONFIG = {
  durationMs: 700,
  mouthMs: 200,
  readyTimeoutMs: 2000,
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
  get done(): boolean { return this.progress === (this.target === 'float' ? 1 : 0) }
}
