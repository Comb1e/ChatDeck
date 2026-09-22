/**
 * whale 行为状态机集成测试移植(源: E:\Projects\whale\scripts\animation.test.js)。
 * 用假 DOM/时钟驱动移植后的真实 states/whale/fsm/tween 模块,验证:
 * 编排过渡不跳变、按压取消不重置形状、泳路完成与取消、形变有界、
 * 水线同步清除、短弧旋转恢复。FX 粒子以 mock 替身注入。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/src/whale/particles', () => ({
  FX: {
    splash: vi.fn(),
    bubble: vi.fn(),
    hearts: vi.fn(),
    ripple: vi.fn(),
    surface: vi.fn(),
    zzz: vi.fn(),
    init: vi.fn(),
    resize: vi.fn(),
    setOrigin: vi.fn(),
    update: vi.fn(),
    render: vi.fn(),
    setWake: vi.fn(),
    hasParticles: () => false,
    hasFastEffects: () => false
  }
}))

import { App } from '../src/renderer/src/whale/context'
import { FSM, FrameLoops } from '../src/renderer/src/whale/fsm'
import { InputSession, shortAngle } from '../src/renderer/src/whale/runtime'
import { States } from '../src/renderer/src/whale/states'
import { Tween } from '../src/renderer/src/whale/tween'
import { Whale } from '../src/renderer/src/whale/whale'
import { WHALE_CONFIG } from '../src/shared/whaleConfig'

interface MockNode {
  attrs: Record<string, string>
  children: MockNode[]
  setAttribute(k: string, v: string): void
  getAttribute(k: string): string | null
  removeAttribute(k: string): void
  appendChild(c: MockNode): MockNode
}

let time = 0
let nextTimer = 0
const timers = new Map<number, { at: number; fn: () => void }>()
const nodes: MockNode[] = []
const errors: string[] = []

function node(): MockNode {
  const n: MockNode = {
    attrs: {},
    children: [],
    setAttribute(k, v) {
      this.attrs[k] = String(v)
    },
    getAttribute(k) {
      return this.attrs[k] ?? null
    },
    removeAttribute(k) {
      delete this.attrs[k]
    },
    appendChild(child) {
      this.children.push(child)
      return child
    }
  }
  nodes.push(n)
  return n
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const step = async (dt: number): Promise<void> => {
  time += dt
  for (const [id, timer] of timers) {
    if (timer.at <= time) {
      timers.delete(id)
      timer.fn()
    }
  }
  Tween.update(time)
  for (const entry of FrameLoops) {
    if (entry.fn(dt) === false && entry.resolve) entry.resolve()
  }
  Whale.render(time)
  const rendered = { ...Whale.pose }
  const wasVisible = Whale.isVisible()
  await flush()
  if (wasVisible && Whale.isVisible()) {
    for (const key of ['x', 'y', 'sx', 'sy'] as const)
      expect(
        Math.abs(Whale.pose[key] - rendered[key]),
        `异步完成在无时间流逝时改变了 ${key}`
      ).toBeLessThan(1e-8)
  }
}

function fixture(): { fsm: FSM; now: () => number } {
  time = 0
  nextTimer = 0
  timers.clear()
  nodes.length = 0
  errors.length = 0
  for (const entry of [...FrameLoops])
    if (entry.resolve) entry.resolve()

  vi.stubGlobal(
    'performance',
    Object.assign(() => time, { now: () => time })
  )
  vi.stubGlobal('setTimeout', (fn: () => void, delay: number): number => {
    timers.set(++nextTimer, { at: time + delay, fn })
    return nextTimer
  })
  vi.stubGlobal('clearTimeout', (id: number): void => {
    timers.delete(id)
  })
  vi.stubGlobal('document', { createElementNS: (_ns: string, _tag: string) => node() })
  vi.spyOn(Math, 'random').mockReturnValue(0.42)
  const errorSpy = vi.spyOn(console, 'error')
  errorSpy.mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  })

  // 复位共享单例(原版每例全新 VM;此处显式复位等价字段)
  Object.assign(App, {
    workarea: { x: 0, y: 0, width: 1280, height: 720 },
    dragVelocity: { vx: 0, vy: 0 },
    stateName: null,
    lastTeleportAt: 0,
    hovering: false,
    ready: false,
    input: new InputSession()
  })
  App.cursor.x = 600
  App.cursor.y = 300

  Whale.build(node() as unknown as Element)
  Object.assign(Whale.pose, { x: 400, y: 350, sx: 1, sy: 1, rot: 0, flip: 1 })
  const fsm = new FSM()
  for (const [name, state] of Object.entries(States)) fsm.add(name, state)
  fsm.onStateEnd = (_name, result) => {
    if (result?.next) fsm.to(result.next, result.params as Record<string, unknown>)
    else Whale.setMotionMode('idle')
  }
  return { fsm, now: () => time }
}

const SLEEP_BOUNDS = { min: WHALE_CONFIG.behavior.sleepDurationMin, max: WHALE_CONFIG.behavior.sleepDurationMax }

beforeEach(() => {
  // 恢复默认时长(上个用例可能改小)
  WHALE_CONFIG.behavior.sleepDurationMin = SLEEP_BOUNDS.min
  WHALE_CONFIG.behavior.sleepDurationMax = SLEEP_BOUNDS.max
})

afterEach(() => {
  for (const entry of [...FrameLoops])
    if (entry.resolve) entry.resolve()
  WHALE_CONFIG.behavior.sleepDurationMin = SLEEP_BOUNDS.min
  WHALE_CONFIG.behavior.sleepDurationMax = SLEEP_BOUNDS.max
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('whale 行为状态机(移植版)', () => {
  it('编排动作的相位切换在同一时刻保持可见位置与形状', async () => {
    for (const action of ['swim', 'happy', 'jumpDive', 'sleep', 'spin', 'falling']) {
      const f = fixture()
      const p = Whale.pose
      WHALE_CONFIG.behavior.sleepDurationMin = 400
      WHALE_CONFIG.behavior.sleepDurationMax = 400
      Object.assign(p, { sx: 1.08, sy: 0.94, rot: -6 })
      f.fsm.to(action)
      await flush()
      for (let i = 0; i < 240 * 10; i++) {
        await step(1000 / 240)
        const before = { ...p }
        const visible = Whale.isVisible()
        // k=0 起始的下一个补间不得重置上一个端点
        Tween.update(f.now())
        if (visible && Whale.isVisible()) {
          for (const key of ['x', 'y', 'sx', 'sy'] as const)
            expect(
              Math.abs(p[key] - before[key]),
              `${action}: ${key} 在 ${f.now()} 处不连续`
            ).toBeLessThan(1e-8)
        }
        await flush()
      }
      expect(errors).toEqual([])
    }
  }, 120_000)

  it('按压与再抓取取消此前所有运动写者且不重置形状', async () => {
    for (const action of ['swim', 'falling', 'bouncing', 'landing', 'happy', 'sleep']) {
      const f = fixture()
      const p = Whale.pose
      f.fsm.to(action, { vx: 120, vy: -400, impact: 800 })
      await flush()
      for (let i = 0; i < 12; i++) await step(1000 / 120)
      const before = { ...p }
      f.fsm.to('held')
      await flush()
      expect(p).toEqual(before) // 按压瞬间必须保持姿态
      for (let i = 0; i < 24; i++) await step(1000 / 120)
      expect(p.x).toBe(before.x)
      expect(p.y).toBe(before.y)
      f.fsm.to('dragged', { grabDX: p.x - 600, grabDY: p.y - 300 })
      await flush()
      for (let i = 0; i < 60; i++) await step(1000 / 120)
      expect(Math.abs(p.x - before.x)).toBeLessThan(1e-8)
      expect(Math.abs(p.y - before.y)).toBeLessThan(1e-8)
      expect(FrameLoops.size).toBe(1)
      expect(f.fsm.current).toBe('dragged')
      expect(errors).toEqual([])
    }
  })

  it('随机泳路入水不先下沉、平滑完成、可被任意刷新率中途取消', async () => {
    const endpoints: { x: number; y: number }[] = []
    for (const hz of [60, 120, 240])
      for (const flip of [-1, 1]) {
        const f = fixture()
        Object.assign(Whale.pose, { x: 600, y: 500, flip })
        f.fsm.to('swim')
        await flush()
        await step(100)
        expect(Whale.pose.y).toBe(500) // 游动不得先坠底
        let previous = { ...Whale.pose }
        let maxStep = 0
        for (let i = 0; i < hz * 20 && f.fsm.current; i++) {
          await step(1000 / hz)
          maxStep = Math.max(maxStep, Math.hypot(Whale.pose.x - previous.x, Whale.pose.y - previous.y))
          expect((Whale.pose.x - previous.x) * Whale.pose.flip).toBeGreaterThanOrEqual(-1e-9)
          previous = { ...Whale.pose }
        }
        expect(f.fsm.current).toBeNull() // 行程完成并释放活动调度
        expect(maxStep).toBeLessThan((WHALE_CONFIG.whale.swimSpeed * WHALE_CONFIG.swim.speedMax) / hz * 1.1)
        expect(Math.abs(Whale.pose.y - 500)).toBeGreaterThan(20) // 探索了别的高度
        const end = { ...Whale.pose }
        await step(1000)
        expect({ ...Whale.pose }).toEqual(end) // 到达后无复位或吸附
        endpoints.push(end)
        f.fsm.to('swim')
        await flush()
        for (let i = 0; i < hz * 2; i++) await step(1000 / hz)
        const held = { ...Whale.pose }
        f.fsm.to('held')
        await flush()
        for (let i = 0; i < hz; i++) await step(1000 / hz)
        expect(Whale.pose.x).toBe(held.x)
        expect(Whale.pose.y).toBe(held.y)
        expect(Tween.hasAnimations()).toBe(false)
        expect(errors).toEqual([])
      }
    for (let i = 2; i < endpoints.length; i++) {
      expect(endpoints[i].x).toBe(endpoints[i % 2].x)
      expect(endpoints[i].y).toBe(endpoints[i % 2].y)
    }
  }, 120_000)

  it('表现形变有界、命中测试共享几何并会收敛', async () => {
    for (const flip of [-1, 1]) {
      const f = fixture()
      Whale.pose.flip = flip
      Whale.setMotionMode('dragged')
      for (let i = 0; i < 180; i++) {
        Whale.pose.x += (i % 40 < 20 ? 1 : -1) * 30
        Whale.pose.y += (i % 30 < 15 ? 1 : -1) * 15
        await step(1000 / 120)
        const s = Whale.snapshot()
        expect(Math.abs(s.stretch)).toBeLessThanOrEqual(WHALE_CONFIG.animation.deformLimit)
        expect(Math.abs(s.tilt)).toBeLessThanOrEqual(WHALE_CONFIG.animation.tiltLimit)
        expect(Math.abs(s.sx * s.sy - 1)).toBeLessThan(0.015) // 除呼吸淡出外面积守恒
        const center = Whale.localToWorld(127, 88)
        const outside = Whale.localToWorld(350, 350)
        expect(Whale.hitTest(center.x, center.y)).toBe(true)
        expect(Whale.hitTest(outside.x, outside.y)).toBe(false)
      }
      f.fsm.to('idle')
      await flush()
      for (let i = 0; i < 120; i++) await step(1000 / 60)
      expect(Whale.hasMotion()).toBe(false) // 收敛后释放原生刷新调度
    }
  })

  it('取消的水面入水事件不会在后续持有者中喷水花', async () => {
    fixture()
    let splashes = 0
    const ctx = { cancelled: false }
    Whale.watchWaterEntry(ctx, 100, () => splashes++)
    ctx.cancelled = true
    await step(16)
    expect(splashes).toBe(0)
    Whale.watchWaterEntry({ cancelled: false }, 100, (nose) => {
      splashes++
      expect(nose).toEqual(Whale.localToWorld(Whale.NOSE.x, Whale.NOSE.y))
    })
    await step(16)
    await step(16)
    expect(splashes).toBe(1)
  })

  it('水线裁剪同步清除,不为后续持有者留下动画', async () => {
    fixture()
    const before = { ...Whale.pose }
    const clip = nodes.find((n) => n.children.some((c) => c.attrs.id === 'whale-root'))
    Whale.setWaterLine(300)
    expect(clip?.getAttribute('clip-path')).toBe('url(#whale-water-clip)')
    Whale.setWaterLine(null)
    expect(clip?.getAttribute('clip-path')).toBeNull()
    expect(Tween.stats().animations).toBe(0) // 清除水面不得启动淡出
    Whale.setWaterLine(150)
    await step(80)
    expect(clip?.getAttribute('clip-path')).toBe('url(#whale-water-clip)')
    const clipPath = nodes.find((n) => n.attrs.id === 'whale-water-clip')
    expect(clipPath?.children[0]?.attrs.height).toBe('4150')
    Whale.setWaterLine(null)
    Whale.setWaterLine(null)
    await step(160)
    expect(clip?.getAttribute('clip-path')).toBeNull()
    expect(Tween.stats().animations).toBe(0)
    expect({ ...Whale.pose }).toEqual(before)
  })

  it('在旋转接近收尾时抓取,沿最短旋转弧收敛', async () => {
    for (const angle of [-710, -350, 350, 710]) {
      const f = fixture()
      Whale.pose.rot = angle
      f.fsm.to('held')
      await flush()
      expect(Whale.pose.rot).toBe(angle) // 按压保持当前显示朝向
      let travel = 0
      let last = angle
      for (let i = 0; i < 60; i++) {
        await step(1000 / 240)
        travel += Math.abs(shortAngle(Whale.pose.rot - last))
        last = Whale.pose.rot
      }
      expect(travel).toBeLessThanOrEqual(10.000001) // 抓取不得回转近一整圈
      f.fsm.to('dragged', { grabDX: Whale.pose.x - 600, grabDY: Whale.pose.y - 300 })
      await flush()
      for (let i = 0; i < 60; i++) await step(1000 / 240)
      expect(Math.abs(shortAngle(Whale.pose.rot))).toBeLessThan(1e-8)
      expect(errors).toEqual([])
    }
  })

  it('surface 状态:在指定点破水浮出并回到可见待机', async () => {
    const { fsm } = fixture()
    Whale.hide()
    Whale.pose.rot = 30
    fsm.to('surface', { x: 500, y: 400 })
    await flush()
    expect(Whale.isVisible()).toBe(true) // 浮出后可见
    for (let i = 0; i < 240; i++) await step(1000 / 240)
    // 收敛后位置在目标点附近(钳制范围内),姿态归正
    expect(Whale.pose.rot).toBe(0)
    expect(Whale.pose.sx).toBe(1)
    expect(Whale.pose.sy).toBe(1)
    expect(Whale.pose.x).toBeGreaterThanOrEqual(WHALE_CONFIG.jumpDive.targetMargin)
    expect(Whale.pose.x).toBeLessThanOrEqual(App.workarea.width - WHALE_CONFIG.jumpDive.targetMargin)
    expect(errors).toEqual([])
  })
})
