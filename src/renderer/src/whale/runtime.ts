/**
 * 可独立测试的计时/输入/运动原语——移植自 whale-pet src/runtime.js,逻辑逐行保持一致。
 */
import type { CurvePoint, Pose, Velocity, XY } from './types'
import type { WhaleConfig } from '@shared/whaleConfig'

export const screenToWorld = (point: XY, area: XY, out: XY = { x: 0, y: 0 }): XY => {
  out.x = point.x - area.x
  out.y = point.y - area.y
  return out
}

/** 渲染层取景窗口:先钳制再做死区比较,抵达一条屏幕边不会强制另一轴移动 */
export function followViewport(
  point: XY,
  viewport: { x: number; y: number; width: number; height: number },
  area: { width: number; height: number },
  deadZone: number
): boolean {
  const axis = (p: number, old: number, size: number, available: number): number => {
    const target = Math.min(Math.max(Math.round(p - size / 2), 0), Math.max(0, available - size))
    const bounded = Math.min(Math.max(old, 0), Math.max(0, available - size))
    return Math.abs(target - bounded) > deadZone ? target : bounded
  }
  const x = axis(point.x, viewport.x, viewport.width, area.width)
  const y = axis(point.y, viewport.y, viewport.height, area.height)
  if (x === viewport.x && y === viewport.y) return false
  viewport.x = x
  viewport.y = y
  return true
}

export type InputPhase = 'RELEASED' | 'PRESSED' | 'DRAGGING'

export class InputSession {
  phase: InputPhase = 'RELEASED'
  pointerId: number | null = null
  downX = 0
  downY = 0
  downAt = 0
  grabDX = 0
  grabDY = 0
  cursorAt = -Infinity
  cursorSource: string | null = null
  revision = 0

  get pressed(): boolean {
    return this.phase !== 'RELEASED'
  }
  get dragging(): boolean {
    return this.phase === 'DRAGGING'
  }
  acceptCursor(at: number, source: string): boolean {
    if (
      !Number.isFinite(at) ||
      at < this.cursorAt ||
      (at === this.cursorAt && source === 'poll' && this.cursorSource === 'pointer')
    )
      return false
    this.cursorAt = at
    this.cursorSource = source
    this.revision++
    return true
  }
  press(id: number, x: number, y: number, at: number, pose: Pose): boolean {
    if (this.pressed) return false
    this.phase = 'PRESSED'
    this.pointerId = id
    this.downX = x
    this.downY = y
    this.downAt = at
    this.grabDX = pose.x - x
    this.grabDY = pose.y - y
    return true
  }
  move(x: number, y: number, threshold: number): boolean {
    if (this.phase !== 'PRESSED' || Math.hypot(x - this.downX, y - this.downY) <= threshold)
      return false
    this.phase = 'DRAGGING'
    return true
  }
  release(): InputPhase {
    const phase = this.phase
    this.phase = 'RELEASED'
    this.pointerId = null
    return phase
  }
}

type Raf = (cb: (t: number) => void) => number
type Timer = (cb: () => void, ms: number) => number
export type SchedulerMode = 'ACTIVE' | 'IDLE' | 'SLEEP' | 'DORMANT'

export interface FrameSchedulerOptions {
  frame: (t: number, dt: number) => void
  mode: () => SchedulerMode
  idleFps: number
  sleepFps: number
  now?: () => number
  raf?: Raf
  cancelRaf?: (id: number) => void
  timer?: Timer
  cancelTimer?: (id: number) => void
}

export class FrameScheduler {
  private readonly frame: (t: number, dt: number) => void
  private readonly mode: FrameSchedulerOptions['mode']
  private readonly idleFps: number
  private readonly sleepFps: number
  private readonly now: () => number
  private readonly raf: Raf
  private readonly cancelRaf: (id: number) => void
  private readonly timer: Timer
  private readonly cancelTimer: (id: number) => void
  private rafId: number | null = null
  private timerId: number | null = null
  private running = false
  private inFrame = false
  private last = 0
  private deadline = 0
  private currentMode: SchedulerMode = 'DORMANT'
  private readonly tick = (t: number): void => {
    this.rafId = null
    if (!this.running) return
    this.inFrame = true
    const dt = Math.max(0, t - this.last)
    this.last = t
    this.frame(t, dt)
    this.inFrame = false
    this.schedule()
  }

  constructor(opts: FrameSchedulerOptions) {
    this.frame = opts.frame
    this.mode = opts.mode
    this.idleFps = opts.idleFps
    this.sleepFps = opts.sleepFps
    this.now = opts.now ?? (() => performance.now())
    this.raf = opts.raf ?? ((cb) => requestAnimationFrame(cb))
    this.cancelRaf = opts.cancelRaf ?? ((id) => cancelAnimationFrame(id))
    this.timer = opts.timer ?? ((cb, ms) => setTimeout(cb, ms) as unknown as number)
    this.cancelTimer = opts.cancelTimer ?? ((id) => clearTimeout(id))
  }
  start(): void {
    if (this.running) return
    this.running = true
    this.last = this.now()
    this.request()
  }
  stop(): void {
    this.running = false
    if (this.rafId !== null) this.cancelRaf(this.rafId)
    if (this.timerId !== null) this.cancelTimer(this.timerId)
    this.rafId = this.timerId = null
  }
  request(): void {
    if (!this.running || this.inFrame) return
    if (this.timerId !== null) this.cancelTimer(this.timerId)
    this.timerId = null
    this.deadline = this.now()
    if (this.rafId === null) this.rafId = this.raf(this.tick)
  }
  private schedule(): void {
    if (!this.running) return
    const mode = this.mode()
    const changed = mode !== this.currentMode
    this.currentMode = mode
    if (mode === 'DORMANT') return
    if (mode === 'ACTIVE') {
      this.rafId = this.raf(this.tick)
      return
    }
    const period = 1000 / (mode === 'SLEEP' ? this.sleepFps : this.idleFps)
    if (changed || this.deadline < this.last - period) this.deadline = this.last
    this.deadline += period
    this.timerId = this.timer(() => {
      this.timerId = null
      this.rafId = this.raf(this.tick)
    }, Math.max(0, this.deadline - this.now()))
  }
}

/** x'' + 2*zeta*omega*x' + omega^2*(x-target) = 0 的精确解;速度单位为像素/秒 */
export class DampedSpring {
  x: number
  v = 0
  target: number

  constructor(value = 0) {
    this.x = value
    this.target = value
  }
  advance(target: number, dtMs: number, frequencyHz: number, dampingRatio = 1): number {
    this.target = target
    if (!(dtMs > 0) || !(frequencyHz > 0)) return this.x
    const t = dtMs / 1000,
      w = 2 * Math.PI * frequencyHz,
      z = Math.max(0, dampingRatio),
      e = this.x - target,
      v = this.v
    if (Math.abs(z - 1) < 1e-6) {
      const decay = Math.exp(-w * t),
        j = v + w * e
      this.x = target + (e + j * t) * decay
      this.v = (v - w * j * t) * decay
    } else if (z < 1) {
      const a = z * w,
        b = w * Math.sqrt(1 - z * z),
        decay = Math.exp(-a * t),
        c = Math.cos(b * t),
        s = Math.sin(b * t)
      this.x = target + decay * (e * c + ((v + a * e) / b) * s)
      this.v = decay * (v * c - ((a * v + w * w * e) / b) * s)
    } else {
      const root = Math.sqrt(z * z - 1)
      const r1 = -w / (z + root),
        r2 = -w * (z + root)
      const a = (v - r2 * e) / (r1 - r2),
        b = e - a
      const e1 = Math.exp(r1 * t),
        e2 = Math.exp(r2 * t)
      this.x = target + a * e1 + b * e2
      this.v = a * r1 * e1 + b * r2 * e2
    }
    return this.x
  }
  settled(position = 0.001, velocity = 0.01): boolean {
    return Math.abs(this.x - this.target) < position && Math.abs(this.v) < velocity
  }
}

/** 相位在变速时保持连续;指数混合及其精确积分保证同一时刻各刷新率得到同一角度 */
export class TailOscillator {
  amplitude: number
  targetAmplitude: number
  frequency: number
  targetFrequency: number
  phase = 0

  constructor(amplitude = 9, frequency = 1.6) {
    this.amplitude = this.targetAmplitude = amplitude
    this.frequency = this.targetFrequency = frequency
  }
  set(amplitude: number, frequency: number): void {
    this.targetAmplitude = amplitude
    this.targetFrequency = frequency
  }
  advance(dtMs: number, blendMs: number): number {
    const t = Math.max(0, dtMs) / 1000,
      rate = Math.log(100) / (blendMs / 1000)
    const decay = Math.exp(-rate * t)
    this.phase =
      (this.phase +
        2 *
          Math.PI *
          (this.targetFrequency * t +
            ((this.frequency - this.targetFrequency) * (1 - decay)) / rate)) %
      (2 * Math.PI)
    this.frequency = this.targetFrequency + (this.frequency - this.targetFrequency) * decay
    this.amplitude = this.targetAmplitude + (this.amplitude - this.targetAmplitude) * decay
    return Math.sin(this.phase) * this.amplitude
  }
  settled(): boolean {
    return (
      Math.abs(this.amplitude - this.targetAmplitude) < 0.01 &&
      Math.abs(this.frequency - this.targetFrequency) < 0.001
    )
  }
}

/** 对称的加速/巡航/减速行程;每段斜坡使用 smoothstep 速度,连接处速度与加速度连续 */
export function cruiseProgress(k: number, rampFraction: number): number {
  const r = Math.min(0.5, Math.max(0.001, rampFraction))
  const integral = (u: number): number => u * u * u - 0.5 * u * u * u * u
  if (k < r) return (r * integral(k / r)) / (1 - r)
  if (k > 1 - r) return 1 - (r * integral((1 - k) / r)) / (1 - r)
  return (k - r / 2) / (1 - r)
}

/** 有界三次曲线恒在控制点凸包内;距离表只建一次,渲染复用输出对象且不产生随机数 */
export class CubicPath {
  readonly points: XY[]
  readonly distances: Float64Array
  length = 0

  constructor(points: XY[], samples: number) {
    this.points = points.map((p) => ({ x: p.x, y: p.y }))
    this.distances = new Float64Array(Math.max(2, Math.floor(samples)) + 1)
    const point: CurvePoint = { x: 0, y: 0, dx: 0, dy: 0 }
    const first = this.points[0]
    const last = { x: first.x, y: first.y }
    for (let i = 1; i < this.distances.length; i++) {
      this.evaluate(i / (this.distances.length - 1), point)
      this.length += Math.hypot(point.x - last.x, point.y - last.y)
      this.distances[i] = this.length
      last.x = point.x
      last.y = point.y
    }
  }
  evaluate(t: number, out: CurvePoint = { x: 0, y: 0, dx: 0, dy: 0 }): CurvePoint {
    t = Math.max(0, Math.min(1, t))
    const [a, b, c, d] = this.points,
      u = 1 - t
    // 相对坐标保证重合控制点严格静止
    out.x =
      t === 1
        ? d.x
        : a.x + 3 * u * u * t * (b.x - a.x) + 3 * u * t * t * (c.x - a.x) + t ** 3 * (d.x - a.x)
    out.y =
      t === 1
        ? d.y
        : a.y + 3 * u * u * t * (b.y - a.y) + 3 * u * t * t * (c.y - a.y) + t ** 3 * (d.y - a.y)
    out.dx = 3 * (u * u * (b.x - a.x) + 2 * u * t * (c.x - b.x) + t * t * (d.x - c.x))
    out.dy = 3 * (u * u * (b.y - a.y) + 2 * u * t * (c.y - b.y) + t * t * (d.y - c.y))
    return out
  }
  sample(progress: number, out: CurvePoint = { x: 0, y: 0, dx: 0, dy: 0 }): CurvePoint {
    if (progress <= 0 || this.length === 0) return this.evaluate(0, out)
    if (progress >= 1) return this.evaluate(1, out)
    const distance = progress * this.length,
      table = this.distances
    let lo = 0,
      hi = table.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (table[mid] < distance) lo = mid
      else hi = mid
    }
    const fraction = (distance - table[lo]) / (table[hi] - table[lo])
    return this.evaluate((lo + fraction) / (table.length - 1), out)
  }
}

export interface SwimRoute {
  path: CubicPath
  bounds: { left: number; right: number; top: number; bottom: number }
  direction: number
  speed: number
}

/** 每次游动规划一次:保留轻微的朝向偏好,但有空间时任一侧都允许;全安全高度区间打破底层泳道 */
export function planSwim(
  start: Pose,
  area: { width: number; height: number },
  config: WhaleConfig['swim'],
  scale = 1,
  random: () => number = Math.random
): SwimRoute {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
  const between = (lo: number, hi: number): number => lo + (hi - lo) * random()
  const xInset = Math.min(config.sideInset * scale, area.width / 2)
  const yScale = Math.min(scale, area.height / (config.topInset + config.bottomInset))
  const bounds = {
    left: xInset,
    right: area.width - xInset,
    top: config.topInset * yScale,
    bottom: area.height - config.bottomInset * yScale
  }
  const room = (dir: number): number =>
    Math.max(0, dir > 0 ? bounds.right - start.x : start.x - bounds.left)
  let direction = random() < config.continueChance ? start.flip : -start.flip
  if (room(direction) < config.minDistance && room(-direction) > room(direction)) direction *= -1
  const reach = Math.min(config.maxDistance, room(direction))
  const end = {
    x: clamp(
      start.x + direction * between(Math.min(config.minDistance, reach), reach),
      bounds.left,
      bounds.right
    ),
    y: between(bounds.top, bounds.bottom)
  }
  const dx = end.x - start.x
  const bend = Math.min(config.curveBend, Math.hypot(dx, end.y - start.y) / 2)
  const path = new CubicPath(
    [
      { x: start.x, y: start.y },
      {
        x: start.x + dx / 3,
        y: clamp(start.y + between(-bend, bend), bounds.top, bounds.bottom)
      },
      {
        x: start.x + (dx * 2) / 3,
        y: clamp(end.y + between(-bend, bend), bounds.top, bounds.bottom)
      },
      end
    ],
    config.pathSamples
  )
  return {
    path,
    bounds,
    direction: Math.sign(dx) || start.flip,
    speed: between(config.speedMin, config.speedMax)
  }
}

export function throwVelocity(velocity: Velocity, config: WhaleConfig['motion']): Velocity {
  const bound = (n: number): number =>
    Math.max(-config.maxThrowVelocity, Math.min(config.maxThrowVelocity, n))
  return {
    vx: bound(velocity.vx * config.throwXScale),
    vy: bound(velocity.vy * config.throwYScale)
  }
}

export const shortAngle = (degrees: number): number =>
  ((((degrees + 180) % 360) + 360) % 360) - 180

/** 固定参考采样 + 高刷新率插值;精确弹簧的速度在释放前始终以像素/秒保存 */
export class DragSpring {
  x: number
  private px: number
  y: number
  private py: number
  vx = 0
  vy = 0
  private acc = 0
  private readonly config: WhaleConfig['interaction']
  private readonly horizontal: DampedSpring
  private readonly vertical: DampedSpring

  constructor(x: number, y: number, config: WhaleConfig['interaction']) {
    this.x = this.px = x
    this.y = this.py = y
    this.config = config
    this.horizontal = new DampedSpring(x)
    this.vertical = new DampedSpring(y)
  }
  update(tx: number, ty: number, dt: number, out: XY): XY {
    const c = this.config,
      step = 1000 / c.referenceHz
    this.acc += Math.min(Math.max(0, dt), step * c.maxCatchUpSteps)
    while (this.acc + 1e-7 >= step) {
      this.px = this.x
      this.py = this.y
      this.x = this.horizontal.advance(tx, step, c.frequencyHz, c.dampingRatio)
      this.y = this.vertical.advance(ty, step, c.frequencyHz, c.dampingRatio)
      this.vx = this.horizontal.v
      this.vy = this.vertical.v
      this.acc -= step
    }
    const alpha = Math.max(0, this.acc / step)
    out.x = this.px + (this.x - this.px) * alpha
    out.y = this.py + (this.y - this.py) * alpha
    return out
  }
}
