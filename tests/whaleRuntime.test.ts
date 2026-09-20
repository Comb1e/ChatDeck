/**
 * whale-pet runtime 原语测试移植(源: E:\Projects\whale\scripts\runtime.test.js)。
 * 用独立对照(解析解/RK4/de Casteljau/细分离线积分)验证移植后的 TS 模块
 * 与原 JS 实现行为一致。纯逻辑,不依赖 DOM。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CubicPath,
  cruiseProgress,
  DampedSpring,
  DragSpring,
  followViewport,
  FrameScheduler,
  InputSession,
  planSwim,
  screenToWorld,
  TailOscillator,
  throwVelocity
} from '../src/renderer/src/whale/runtime'
import { Tween } from '../src/renderer/src/whale/tween'
import { FSM } from '../src/renderer/src/whale/fsm'
import { WHALE_CONFIG } from '../src/shared/whaleConfig'
import type { SchedulerMode } from '../src/renderer/src/whale/runtime'

const config = WHALE_CONFIG

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('whale runtime: 坐标与取景', () => {
  it('屏幕坐标换算支持负工作区与边界点', () => {
    const area = { x: -1920, y: -100 }
    expect(screenToWorld({ x: -1800, y: 50 }, area)).toEqual({ x: 120, y: 150 })
    expect(screenToWorld(area, area)).toEqual({ x: 0, y: 0 })
    expect(screenToWorld({ x: -1921, y: -101 }, area)).toEqual({ x: -1, y: -1 })
    const out = { x: 0, y: 0 }
    expect(screenToWorld({ x: 2560, y: 0 }, { x: 1920, y: 0 }, out)).toBe(out)
    expect(out).toEqual({ x: 640, y: 0 })
  })

  it('特效取景死区逐轴独立,工作区缩放后先钳制', () => {
    const viewport = { x: 0, y: 0, width: 830, height: 770 }
    const area = { width: 2560, height: 1552 }
    expect(followViewport({ x: 415 + 24, y: 385 }, viewport, area, 24)).toBe(false)
    expect(followViewport({ x: 415 + 25, y: 385 }, viewport, area, 24)).toBe(true)
    expect(viewport.x).toBe(25)
    followViewport({ x: 2400, y: 1500 }, viewport, area, 24)
    expect(viewport).toEqual({ x: 1730, y: 782, width: 830, height: 770 })
    expect(followViewport({ x: 1730 + 415 - 20, y: 3000 }, viewport, area, 24)).toBe(false)
    followViewport({ x: 1, y: 1 }, viewport, { width: 640, height: 480 }, 24)
    expect(viewport.x).toBe(0)
    expect(viewport.y).toBe(0)
  })
})

describe('whale runtime: 输入状态机', () => {
  it('相位、精确阈值、过期采样与重复清理', () => {
    const input = new InputSession()
    expect(input.acceptCursor(100, 'pointer')).toBe(true)
    expect(input.acceptCursor(99, 'poll')).toBe(false)
    expect(input.acceptCursor(100, 'poll')).toBe(false)
    expect(input.acceptCursor(101, 'poll')).toBe(true) // 无 200ms 黑窗
    expect(input.press(1, 10, 20, 0, { x: 15, y: 30, rot: 0, sx: 1, sy: 1, flip: 1 })).toBe(true)
    expect(input.press(2, 0, 0, 0, { x: 0, y: 0, rot: 0, sx: 1, sy: 1, flip: 1 })).toBe(false)
    expect(input.move(18, 20, 8)).toBe(false)
    expect(input.move(18.01, 20, 8)).toBe(true)
    expect(input.phase).toBe('DRAGGING')
    expect(input.release()).toBe('DRAGGING')
    expect(input.release()).toBe('RELEASED')
    expect(input.pressed).toBe(false)
    expect(input.dragging).toBe(false)
  })
})

describe('whale runtime: 弹簧与振荡器', () => {
  it('10Hz 拖拽弹簧在 60/120/240Hz 下与独立临界阻尼解析解一致', () => {
    const w = 2 * Math.PI * config.interaction.frequencyHz
    const position = (t: number): number => 100 * (1 - (1 + w * t) * Math.exp(-w * t))
    const velocity = (t: number): number => 100 * w * w * t * Math.exp(-w * t)
    for (const fps of [60, 120, 240]) {
      const spring = new DragSpring(0, 0, config.interaction)
      const out = { x: 0, y: 0 }
      let previous = 0
      for (let i = 1; i <= fps / 4; i++) {
        spring.update(100, 0, 1000 / fps, out)
        expect(out.x).toBeGreaterThanOrEqual(previous)
        expect(out.x).toBeLessThanOrEqual(100)
        previous = out.x
      }
      expect(Math.abs(out.x - position(0.25 - 1 / 60))).toBeLessThan(1e-8)
      expect(Math.abs(spring.vx - velocity(0.25))).toBeLessThan(1e-8)
      spring.update(1e4, -1e4, 60000, out)
      expect(Number.isFinite(out.x)).toBe(true)
      expect(Math.abs(out.x)).toBeLessThan(2e4)
    }
  })

  it('阻尼弹簧在各阻尼域与独立 RK4 对照一致', () => {
    for (const damping of [0, 0.65, 1, 1.8]) {
      const w = 2 * Math.PI * 5,
        dt = 0.0001
      let x = 0.7,
        v = -2
      const acceleration = (p: number, speed: number): number =>
        -2 * damping * w * speed - w * w * (p - 1)
      for (let i = 0; i < 2500; i++) {
        const a = acceleration(x, v),
          b = acceleration(x + (v * dt) / 2, v + (a * dt) / 2)
        const c = acceleration(x + ((v + (a * dt) / 2) * dt) / 2, v + (b * dt) / 2)
        const d = acceleration(x + (v + (b * dt) / 2) * dt, v + c * dt)
        x += (dt / 6) * (v + 2 * (v + (a * dt) / 2) + 2 * (v + (b * dt) / 2) + v + c * dt)
        v += (dt / 6) * (a + 2 * b + 2 * c + d)
      }
      for (const parts of [1, 15, 30, 60, 120, 240]) {
        const spring = new DampedSpring(0.7)
        spring.v = -2
        for (let i = 0; i < parts; i++) spring.advance(1, 250 / parts, 5, damping)
        expect(Math.abs(spring.x - x)).toBeLessThan(1e-8)
        expect(Math.abs(spring.v - v)).toBeLessThan(1e-7)
        spring.advance(1, 60000, 5, Math.max(0.65, damping))
        expect(spring.settled()).toBe(true)
      }
    }
  })

  it('摆尾变速保持相位,各刷新率下积分结果相同', () => {
    const values: number[][] = []
    for (const hz of [15, 30, 60, 120, 240]) {
      const tail = new TailOscillator()
      for (let i = 0; i < hz; i++) tail.advance(1000 / hz, 120)
      const angle = tail.advance(0, 120),
        phase = tail.phase
      tail.set(24, 5)
      expect(tail.phase).toBe(phase)
      expect(tail.advance(0, 120)).toBe(angle)
      for (let i = 0; i < hz; i++) tail.advance(1000 / hz, 120)
      values.push([tail.phase, tail.amplitude, tail.frequency])
      expect(tail.settled()).toBe(true)
    }
    for (const row of values)
      row.forEach((n, i) => expect(Math.abs(n - values[0][i])).toBeLessThan(1e-10))
  })

  it('移动拖拽目标在不同刷新率下等价', () => {
    const results: { x: number; y: number; vx: number; vy: number }[] = []
    for (const fps of [60, 120, 240]) {
      const spring = new DragSpring(0, 0, config.interaction)
      const out = { x: 0, y: 0 }
      for (let i = 1; i <= fps * 2; i++) {
        const t = i / fps
        spring.update(120 * t, 80 * Math.sin(t), 1000 / fps, out)
      }
      results.push({ x: out.x, y: out.y, vx: spring.vx, vy: spring.vy })
    }
    for (const result of results)
      for (const key of ['x', 'y', 'vx', 'vy'] as const)
        expect(Math.abs(result[key] - results[0][key])).toBeLessThan(1e-8)
  })
})

describe('whale runtime: 泳路与行程', () => {
  it('三次曲线与独立 de Casteljau 对照及细分距离积分一致', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 90, y: 150 },
      { x: 180, y: -110 },
      { x: 270, y: 70 }
    ]
    const path = new CubicPath(points, config.swim.pathSamples)
    const control = (t: number): { x: number; y: number } => {
      let row = points
      while (row.length > 1)
        row = row.slice(1).map((p, i) => ({
          x: row[i].x * (1 - t) + p.x * t,
          y: row[i].y * (1 - t) + p.y * t
        }))
      return row[0]
    }
    let length = 0
    let previous = control(0)
    const fine = [0]
    for (let i = 1; i <= 10000; i++) {
      const point = control(i / 10000),
        actual = path.evaluate(i / 10000)
      expect(Math.hypot(actual.x - point.x, actual.y - point.y)).toBeLessThan(1e-10)
      length += Math.hypot(point.x - previous.x, point.y - previous.y)
      fine.push(length)
      previous = point
    }
    expect(Math.abs(path.length / length - 1)).toBeLessThan(0.001)
    for (let i = 0; i <= 100; i++) {
      const point = path.sample(i / 100)
      // 该对照曲线的 x 恰为 270*t,用它独立定位弧长
      const index = Math.round((point.x / 270) * 10000)
      expect(Math.abs(fine[index] / length - i / 100)).toBeLessThan(0.001)
    }
    expect(path.sample(0).x).toBe(points[0].x)
    expect(path.sample(1).y).toBe(points[3].y)
    const stopped = new CubicPath(
      Array(4).fill({ x: 10, y: 20 }),
      config.swim.pathSamples
    )
    expect(stopped.sample(0.5)).toEqual({ x: 10, y: 20, dx: 0, dy: 0 })
  })

  it('随机泳路在朝向/高度/距离/弯度/速度上多样,且采样不消耗随机数', () => {
    let seed = 1234567
    const calls = { n: 0 }
    const random = (): number => {
      calls.n++
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 2 ** 32
    }
    const destinations: { x: number; y: number }[] = []
    const speeds: number[] = []
    const directions = new Set<number>()
    const bends = new Set<number>()
    for (let i = 0; i < 300; i++) {
      const route = planSwim(
        { x: 1280, y: 760, flip: 1, rot: 0, sx: 1, sy: 1 },
        { width: 2560, height: 1552 },
        config.swim,
        1,
        random
      )
      const target = route.path.sample(1)
      const before = calls.n
      for (let frame = 0; frame <= 240; frame++) route.path.sample(frame / 240)
      expect(calls.n).toBe(before) // 采样路径不得消耗新的随机数
      destinations.push(target)
      speeds.push(route.speed)
      directions.add(route.direction)
      bends.add(Math.sign(route.path.points[1].y - 760))
      const distance = Math.abs(target.x - 1280)
      expect(distance).toBeGreaterThanOrEqual(config.swim.minDistance)
      expect(distance).toBeLessThanOrEqual(config.swim.maxDistance)
    }
    expect([...directions].sort()).toEqual([-1, 1])
    expect([...bends].sort()).toEqual([-1, 1])
    expect(destinations.some((p) => p.y < 400)).toBe(true)
    expect(destinations.some((p) => p.y > 1300)).toBe(true)
    expect(destinations.some((p) => Math.abs(p.x - 1280) < 250)).toBe(true)
    expect(destinations.some((p) => Math.abs(p.x - 1280) > 650)).toBe(true)
    expect(Math.min(...speeds)).toBeLessThan(0.85)
    expect(Math.max(...speeds)).toBeGreaterThan(1.2)
  })

  it('泳路保持在安全边界内,离屏起点平滑回收且无水平折返', () => {
    for (const area of [
      { width: 2560, height: 1552 },
      { width: 1280, height: 720 },
      { width: 240, height: 180 },
      { width: 0, height: 0 }
    ])
      for (const scale of [1, 1.5, 2])
        for (const flip of [-1, 1])
          for (const value of [0, 0.42, 1]) {
            for (const start of [
              { x: 0, y: 0, flip },
              { x: area.width / 2, y: area.height / 2, flip },
              { x: area.width, y: area.height, flip },
              { x: area.width + 200, y: -150, flip }
            ]) {
              const route = planSwim(
                { ...start, rot: 0, sx: 1, sy: 1 },
                area,
                config.swim,
                scale,
                () => value
              )
              const b = route.bounds
              const first = route.path.sample(0)
              const end = route.path.sample(1)
              expect(first.x).toBe(start.x)
              expect(first.y).toBe(start.y)
              expect(end.x).toBeGreaterThanOrEqual(b.left)
              expect(end.x).toBeLessThanOrEqual(b.right)
              expect(end.y).toBeGreaterThanOrEqual(b.top)
              expect(end.y).toBeLessThanOrEqual(b.bottom)
              let last = first
              for (let i = 1; i <= 100; i++) {
                const p = route.path.sample(i / 100)
                expect(Number.isFinite(p.x)).toBe(true)
                expect(Number.isFinite(p.y)).toBe(true)
                expect((p.x - last.x) * route.direction).toBeGreaterThanOrEqual(-1e-9)
                expect(p.x).toBeGreaterThanOrEqual(Math.min(start.x, b.left) - 1e-9)
                expect(p.x).toBeLessThanOrEqual(Math.max(start.x, b.right) + 1e-9)
                expect(p.y).toBeGreaterThanOrEqual(Math.min(start.y, b.top) - 1e-9)
                expect(p.y).toBeLessThanOrEqual(Math.max(start.y, b.bottom) + 1e-9)
                last = p
              }
            }
          }
  })

  it('巡航进度端点/斜坡连续且单调', () => {
    for (const ramp of [0.01, 0.1, 0.5]) {
      expect(cruiseProgress(0, ramp)).toBe(0)
      expect(cruiseProgress(1, ramp)).toBe(1)
      let previous = 0
      for (let i = 0; i <= 1000; i++) {
        const p = cruiseProgress(i / 1000, ramp)
        expect(p).toBeGreaterThanOrEqual(previous)
        expect(p).toBeLessThanOrEqual(1)
        previous = p
        expect(Math.abs(p + cruiseProgress(1 - i / 1000, ramp) - 1)).toBeLessThan(1e-10)
      }
      const h = 1e-6
      for (const k of [ramp, 1 - ramp]) {
        const left = (cruiseProgress(k, ramp) - cruiseProgress(k - h, ramp)) / h
        const right = (cruiseProgress(k + h, ramp) - cruiseProgress(k, ramp)) / h
        expect(Math.abs(left - right)).toBeLessThan(1e-6)
      }
    }
  })

  it('投掷速度按方向缩放并以像素/秒限幅', () => {
    expect(throwVelocity({ vx: 100, vy: 200 }, config.motion)).toEqual({ vx: 70, vy: 100 })
    expect(throwVelocity({ vx: -100, vy: -200 }, config.motion)).toEqual({ vx: -70, vy: -100 })
    expect(throwVelocity({ vx: 10000, vy: -10000 }, config.motion)).toEqual({ vx: 900, vy: -900 })
  })
})

describe('whale runtime: 帧调度器', () => {
  it('同时最多一个待决回调,唤醒即时,DORMANT 休眠', () => {
    let time = 0
    let mode = 'IDLE'
    let id = 0
    let count = 0
    const frames = new Map<number, (t: number) => void>()
    const timers = new Map<number, { cb: () => void; ms: number }>()
    const s = new FrameScheduler({
      frame: () => count++,
      mode: () => mode as SchedulerMode,
      idleFps: 30,
      sleepFps: 15,
      now: () => time,
      raf: (cb) => {
        frames.set(++id, cb)
        return id
      },
      cancelRaf: (i) => frames.delete(i),
      timer: (cb, ms) => {
        timers.set(++id, { cb, ms })
        return id
      },
      cancelTimer: (i) => timers.delete(i)
    })
    const frame = (): void => {
      const entry = frames.entries().next().value as [number, (t: number) => void]
      frames.delete(entry[0])
      entry[1](time)
    }
    s.start()
    s.request()
    s.request()
    expect(frames.size).toBe(1)
    frame()
    expect(frames.size).toBe(0)
    expect(timers.size).toBe(1)
    expect(Math.abs([...timers.values()][0].ms - 1000 / 30)).toBeLessThan(1e-8)
    mode = 'ACTIVE'
    s.request()
    expect(timers.size).toBe(0)
    time += 4.167
    frame()
    expect(frames.size).toBe(1)
    mode = 'DORMANT'
    time += 4.167
    frame()
    expect(frames.size + timers.size).toBe(0)
    mode = 'SLEEP'
    s.request()
    frame()
    expect(Math.abs([...timers.values()][0].ms - 1000 / 15)).toBeLessThan(1e-8)
    s.stop()
    expect(frames.size + timers.size).toBe(0)
    expect(count).toBe(4)
  })
})

describe('whale tween/fsm', () => {
  it('等待在无帧泵时正常完成与取消', async () => {
    const completed = Tween.wait(5)
    const cancelled = Tween.wait(60000)
    cancelled.cancel()
    cancelled.cancel()
    expect((await cancelled).cancelled).toBe(true)
    expect((await completed).cancelled).toBe(false)
    expect(Tween.hasAnimations()).toBe(false)
    expect(Tween.stats().waits).toBe(0)
  })

  it('FSM 跳过已取消的排队状态,忽略过期的完成回调', async () => {
    const fsm = new FSM()
    const entered: string[] = []
    const ended: unknown[] = []
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 12; i++) await Promise.resolve()
    }
    let releaseOld: (value?: unknown) => void = () => {}
    fsm.add('old', {
      enter: () => {
        entered.push('old')
        return new Promise((r) => {
          releaseOld = r as (value?: unknown) => void
        }) as Promise<void>
      }
    })
    fsm.add('held', {
      enter: () => {
        entered.push('held')
        return new Promise(() => {})
      }
    })
    fsm.onStateEnd = (name, result) => ended.push({ name, result })
    fsm.to('old')
    fsm.to('held')
    await flush()
    expect(entered).toEqual(['held'])
    expect(fsm.current).toBe('held')
    fsm.to('old')
    await flush()
    fsm.to('held')
    releaseOld({ next: 'falling' })
    await flush()
    expect(fsm.current).toBe('held')
    expect(ended).toEqual([])
  })
})

describe('whale particles(以假 canvas 驱动真实模块)', () => {
  async function makeFx(dpr: number) {
    vi.resetModules()
    vi.stubGlobal('window', { devicePixelRatio: dpr })
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const arcs: unknown[][] = []
    const store: Record<string, unknown> = {}
    const ctx = new Proxy(store, {
      get: (obj, key) =>
        (obj as Record<string, unknown>)[key as string] ||
        (key === 'arc'
          ? (...args: unknown[]) => {
              arcs.push(args)
            }
          : () => {})
    })
    const canvas = { clientWidth: 830, clientHeight: 770, width: 0, height: 0, getContext: () => ctx }
    const { FX } = await import('../src/renderer/src/whale/particles')
    FX.init(canvas as unknown as HTMLCanvasElement)
    return { fx: FX, canvas, arcs }
  }

  it('粒子轨迹与寿命与帧率无关', async () => {
    const results: unknown[][] = []
    for (const fps of [15, 30, 60, 120, 240]) {
      const { fx, arcs } = await makeFx(1)
      fx.bubble(400, 500)
      for (let i = 0; i < fps; i++) fx.update(1000 / fps)
      fx.render()
      results.push(arcs[0])
      fx.update(60000)
      expect(fx.stats().active).toBe(0)
      expect(fx.stats().pooled).toBe(1)
    }
    for (const result of results) {
      expect(Math.abs((result[0] as number) - (results[0][0] as number))).toBeLessThan(1e-8)
      expect(Math.abs((result[1] as number) - (results[0][1] as number))).toBeLessThan(1e-8)
    }
  })

  it('水滴与独立 60Hz 积分一致,延迟特效按时到期', async () => {
    let y = 500,
      vy = -410
    for (let i = 0; i < 24; i++) {
      vy += 1400 / 60
      y += vy / 60
    }
    for (const fps of [15, 30, 60, 120, 240]) {
      const { fx, arcs } = await makeFx(1)
      fx.splash(400, 500, 1)
      for (let i = 0; i < fps * 0.4; i++) fx.update(1000 / fps)
      fx.render()
      expect(Math.abs((arcs[0][0] as number) - 400)).toBeLessThan(1e-8)
      expect(Math.abs((arcs[0][1] as number) - y)).toBeLessThan(1e-8)
      fx.update(2000)
      fx.hearts(400, 500)
      fx.update(1300) // 第一颗爱心到期;三颗延迟爱心尚在
      expect(fx.stats().active).toBe(3)
      fx.update(389)
      expect(fx.stats().active).toBe(1)
      fx.update(1)
      expect(fx.stats().active).toBe(0)
      fx.zzz(400, 500)
      fx.update(2199)
      expect(fx.stats().active).toBe(1)
      fx.update(1)
      expect(fx.stats().active).toBe(0)
    }
  })

  it('画布仅在真实变化时重分配,对象池有界', async () => {
    for (const dpr of [1, 1.5, 2]) {
      const { fx, canvas } = await makeFx(dpr)
      fx.resize()
      fx.resize()
      expect(fx.stats().allocations).toBe(1)
      expect(canvas.width).toBe(830 * dpr)
      canvas.clientWidth = 840
      fx.resize()
      expect(fx.stats().allocations).toBe(2)
      for (let i = 0; i < 20; i++) fx.splash(100, 100, 22)
      fx.update(60000)
      expect(fx.stats().active).toBe(0)
      expect(fx.stats().pooled).toBe(config.performance.particlePoolLimit)
    }
  })
})
