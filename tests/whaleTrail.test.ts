/**
 * 游动尾迹(水流)纯逻辑测试:
 * - dragDisplacement 指数拖阻:解析解 vs 数值积分独立对照 + 边界(s=0/v0=0/终值/单调)
 * - TrailEmitter:等弧长布点、跨帧路程累计、静止不喷、航向反向漂移、传送重置、streak 节奏
 * - 配置完整性:trail 参数为有限正数
 * 全部用固定随机数,发射参数可手算核对。
 */
import { describe, expect, it } from 'vitest'
import { dragDisplacement, TRAIL_ANCHOR, TrailEmitter } from '../src/renderer/src/whale/trail'
import { WHALE_CONFIG } from '../src/shared/whaleConfig'

const cfg = WHALE_CONFIG.particles.trail

/** random 恒 0.5:drift=(26+60)/2=43,jitter=0,rise=(6+20)/2=13 */
function emitter(): TrailEmitter {
  return new TrailEmitter(cfg, () => 0.5)
}

describe('dragDisplacement 指数拖阻', () => {
  it('与数值积分∫v0·e^(-t/τ)dt 独立对照一致', () => {
    const v0 = 40,
      tau = cfg.tauMs / 1000,
      s = 2
    let x = 0
    const dt = 0.0005
    for (let t = 0; t < s; t += dt) x += v0 * Math.exp(-t / tau) * dt
    expect(dragDisplacement(v0, tau, s)).toBeCloseTo(x, 1)
  })
  it('边界:s=0 位移为 0;v0=0 恒为 0;负初速向反方向漂', () => {
    const tau = cfg.tauMs / 1000
    expect(dragDisplacement(40, tau, 0)).toBe(0)
    expect(dragDisplacement(0, tau, 5)).toBe(0)
    expect(dragDisplacement(-30, tau, 1)).toBeLessThan(0)
  })
  it('终值收敛到 v0·τ(速度衰减到 0),且位移随时间单调增', () => {
    const v0 = 40,
      tau = cfg.tauMs / 1000
    expect(Math.abs(dragDisplacement(v0, tau, tau * 50) - v0 * tau)).toBeLessThan(1e-6 * v0 * tau)
    let prev = -1
    for (let s = 0; s <= 3; s += 0.25) {
      const d = dragDisplacement(v0, tau, s)
      expect(d).toBeGreaterThan(prev)
      prev = d
    }
  })
})

describe('TrailEmitter 等弧长布点', () => {
  const S = cfg.spacing // 用配置参数化,调参不破坏断言

  it('按 spacing 累计路程布点,不足一格的余量跨帧保留', () => {
    const t = emitter()
    expect(t.advance(0, 0)).toEqual([]) // 首帧只锚定
    expect(t.advance(0.6 * S, 0)).toEqual([]) // 累计 0.6S
    const first = t.advance(1.2 * S, 0) // 0.6S ≥ 余量 0.4S → 恰在 x=S 处布点
    expect(first).toHaveLength(1)
    expect(first[0]!.x).toBeCloseTo(S)
    expect(first[0]!.y).toBe(0)
    expect(t.advance(1.8 * S, 0)).toEqual([]) // 余量还差 0.2S
    const second = t.advance(2.4 * S, 0) // 0.6S ≥ 0.2S → 在 x=2S 处布点(2×S)
    expect(second).toHaveLength(1)
    expect(second[0]!.x).toBeCloseTo(2 * S)
  })
  it('静止(路程为 0)不布点,且不消耗余量', () => {
    const t = emitter()
    t.advance(0, 0)
    for (let i = 0; i < 5; i++) expect(t.advance(0, 0)).toEqual([])
    const s = t.advance(S, 0) // 余量未被动过:整 S 恰好一格
    expect(s).toHaveLength(1)
    expect(s[0]!.x).toBeCloseTo(S)
  })
  it('单帧位移超过 maxStep 视为传送:跳过并重置,不喷一串点', () => {
    const t = emitter()
    t.advance(0, 0)
    expect(t.advance(cfg.maxStep + 20, 0)).toEqual([])
    expect(t.advance(cfg.maxStep + 20, 0)).toEqual([]) // 静止
    const s = t.advance(cfg.maxStep + 20 + S, 0) // 重置后重新累计:整 S 一格
    expect(s).toHaveLength(1)
    expect(s[0]!.x).toBeCloseTo(cfg.maxStep + 20 + S)
  })
  it('漂移方向与航向相反并带随机抖动;向右游 → 气泡向左后带 + 上浮', () => {
    const t = emitter()
    t.advance(0, 0)
    const s = t.advance(S + 5, 0)
    expect(s).toHaveLength(1)
    const p = s[0]!
    expect(p.kind).toBe('wake')
    expect(p.x).toBeCloseTo(S) // 布点始终落在弧长的整倍数上
    expect(p.vx).toBeCloseTo(-43) // -ux·drift,ux=1,drift=43(random=0.5)
    expect(p.vy).toBeCloseTo(-13) // -rise(向上),jitter=0
  })
  it('航向反向后漂移跟着反向', () => {
    const t = emitter()
    t.advance(0, 0)
    const s = t.advance(-(S + 5), 0) // 向左游
    expect(s[0]!.vx).toBeGreaterThan(0)
    // 抖动垂直于航向:向左游(ux=-1)时 x 分量只来自漂移项
    expect(s[0]!.vy).toBeCloseTo(-13)
  })
  it('streak 按 streakEvery 节奏夹在水泡之间,初速更小', () => {
    const t = emitter()
    t.advance(0, 0)
    const kinds: string[] = []
    for (let x = 0; x <= 10 * S; x += S / 8) {
      for (const p of t.advance(x, 0)) kinds.push(p.kind)
    }
    // 每 2 个布点一条 streak:w,s,w,s,…
    expect(kinds.filter((k) => k === 'streak').length).toBeGreaterThan(2)
    expect(kinds[0]).toBe('wake')
    if (kinds[1] === 'streak') expect(kinds[2]).toBe('wake')
    const t2 = emitter()
    t2.advance(0, 0)
    const [w, st] = t2.advance(2 * S, 0) // 一次喂足两格 → [wake, streak]
    expect(w.kind).toBe('wake')
    expect(st.kind).toBe('streak')
    expect(Math.hypot(st.vx, st.vy)).toBeLessThan(Math.hypot(w.vx, w.vy))
  })
})

describe('尾迹配置与锚点', () => {
  it('trail 参数为有限正数且区间有序', () => {
    for (const [k, v] of Object.entries(cfg)) expect(Number.isFinite(v), k).toBe(true)
    expect(cfg.spacing).toBeGreaterThan(0)
    expect(cfg.driftMax).toBeGreaterThan(cfg.driftMin)
    expect(cfg.riseMax).toBeGreaterThan(cfg.riseMin)
    expect(cfg.jitter).toBeGreaterThanOrEqual(0)
    expect(cfg.tauMs).toBeGreaterThan(0)
    expect(cfg.streakEvery).toBeGreaterThanOrEqual(1)
    expect(cfg.maxStep).toBeGreaterThan(cfg.spacing)
  })
  it('尾迹锚点落在画布艺术坐标(220×170)内的尾鳍后方', () => {
    expect(TRAIL_ANCHOR.x).toBeGreaterThan(0)
    expect(TRAIL_ANCHOR.x).toBeLessThan(60) // 面朝右基底:尾巴在左侧
    expect(TRAIL_ANCHOR.y).toBeGreaterThan(0)
    expect(TRAIL_ANCHOR.y).toBeLessThan(170)
  })
})
