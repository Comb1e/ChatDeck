/**
 * 游动尾迹发射器(水流特效的纯逻辑半边,无 DOM 可离线测试)。
 * 设计:尾鳍锚点沿路径移动时,按固定弧长间距布点——间距法保证发射密度只与
 * 路程相关,与帧率/掉帧无关;每个布点产生一个"水流气泡"(wake,被水流向后带
 * + 缓慢上浮)并按节奏夹一条"水流线"(streak,沿航向的短流线)。
 * 运动学:漂移用指数拖阻 dragDisplacement(v0, τ, t) = v0·τ·(1-e^(-t/τ)),
 * 即速度按 e^(-t/τ) 衰减——水的高阻尼让尾迹原地小幅漂散而不是抛物线飞走。
 */
import type { WhaleConfig } from '@shared/whaleConfig'

export type TrailConfig = WhaleConfig['particles']['trail']

/** 面朝右基底的艺术坐标(220×170):尾鳍双叉尖正后方,尾迹从这里冒出 */
export const TRAIL_ANCHOR = { x: 6, y: 46 }

/** 指数拖阻位移:初速 v0、时间常数 τ,经时间 s 后的总位移(速度积分的精确解) */
export function dragDisplacement(v0: number, tau: number, s: number): number {
  return v0 * tau * (1 - Math.exp(-s / tau))
}

export interface TrailSpawn {
  kind: 'wake' | 'streak'
  x: number
  y: number
  /** 漂移初速(px/s):航向反方向(水流向后带)+ 随机横向抖动 + 缓慢上浮 */
  vx: number
  vy: number
}

export class TrailEmitter {
  private last: { x: number; y: number } | null = null
  /** 距下一次布点还需前进的路程(px) */
  private pending: number
  private count = 0

  constructor(
    private readonly cfg: TrailConfig,
    private readonly random: () => number = Math.random
  ) {
    this.pending = cfg.spacing
  }

  /** 重置尾迹(状态切换/形态交接后从零开始,不留旧方向的残余) */
  reset(): void {
    this.last = null
    this.pending = this.cfg.spacing
  }

  /**
   * 喂入本帧尾鳍锚点的世界坐标,返回本帧应发射的粒子描述。
   * 位移超过 maxStep 视为传送(破水重现/窗口重定位):跳过不喷,重置累计。
   */
  advance(x: number, y: number): TrailSpawn[] {
    if (!this.last || Math.hypot(x - this.last.x, y - this.last.y) > this.cfg.maxStep) {
      this.last = { x, y }
      return []
    }
    const dx = x - this.last.x,
      dy = y - this.last.y
    const dist = Math.hypot(dx, dy)
    this.last = { x, y }
    if (dist < 1e-6) return []
    const ux = dx / dist,
      uy = dy / dist // 航向单位向量
    const out: TrailSpawn[] = []
    let travelled = 0
    while (dist - travelled >= this.pending) {
      travelled += this.pending
      this.pending = this.cfg.spacing
      // 布点 = 段起点(上一帧位置)沿航向前进 travelled
      const px = x - ux * (dist - travelled),
        py = y - uy * (dist - travelled)
      out.push(this.emit(px, py, ux, uy))
    }
    this.pending -= dist - travelled
    return out
  }

  private emit(px: number, py: number, ux: number, uy: number): TrailSpawn {
    this.count++
    const rand = (a: number, b: number): number => a + (b - a) * this.random()
    const drift = rand(this.cfg.driftMin, this.cfg.driftMax)
    // 垂直航向的双向抖动,让气泡带不排成一条直线
    const jitter = (this.random() * 2 - 1) * this.cfg.jitter
    const rise = rand(this.cfg.riseMin, this.cfg.riseMax)
    if (this.cfg.streakEvery > 0 && this.count % this.cfg.streakEvery === 0) {
      // 水流线:贴着航向反方向小幅后移,几不可察地上浮
      return { kind: 'streak', x: px, y: py, vx: -ux * drift * 0.4, vy: -uy * drift * 0.4 - rise * 0.3 }
    }
    return {
      kind: 'wake',
      x: px,
      y: py,
      vx: -ux * drift - uy * jitter,
      vy: -uy * drift + ux * jitter - rise
    }
  }
}
