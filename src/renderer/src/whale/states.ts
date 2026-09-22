/**
 * 行为状态机的各状态实现——移植自 whale-pet src/states.js。
 * 约定:states 只操作 Whale.pose(通过 ctx.animate 补间),
 * 环境层动画(浮动/呼吸/摆尾/眨眼/视线)由 Whale.render 叠加。
 * ChatDeck 新增 surface 状态(定点浮出,悬浮窗收起时交接用),其余逻辑保持一致。
 */
import { WHALE_CONFIG } from '@shared/whaleConfig'
import type { Behavior, StateParams, StateResult } from './fsm'
import { Ctx } from './fsm'
import { App } from './context'
import { FX } from './particles'
import { TRAIL_ANCHOR, TrailEmitter } from './trail'
import { cruiseProgress, planSwim, shortAngle, DragSpring } from './runtime'
import { Tween } from './tween'
import { Whale } from './whale'
import type { Pose, Velocity } from './types'

const rand = (a: number, b: number): number => a + Math.random() * (b - a)
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))

const cfg = (): typeof WHALE_CONFIG => WHALE_CONFIG
const floorY = (): number => App.workarea.height - cfg().whale.floorInset

// 每个编排过渡都从上一个状态留下的姿态出发。
async function morph(
  ctx: Ctx,
  target: Partial<Pose>,
  duration = cfg().animation.transitionMs,
  ease: Parameters<typeof Tween.run>[0]['ease'] = 'smooth'
): Promise<void> {
  const from = {} as Record<keyof Pose, number>
  const delta = {} as Record<keyof Pose, number>
  const keys = Object.keys(target) as (keyof Pose)[]
  for (const key of keys) {
    from[key] = Whale.pose[key]
    delta[key] = key === 'rot' ? shortAngle(target[key]! - from[key]) : target[key]! - from[key]
  }
  await ctx.animate({
    duration,
    ease,
    onUpdate: (k) => {
      for (const key of keys) Whale.pose[key] = from[key] + delta[key] * k
    }
  })
  ctx.check()
}

/* 睡眠前柔和落回底部 */
async function settleDown(ctx: Ctx): Promise<void> {
  const y0 = Whale.pose.y
  const target = floorY() - cfg().animation.swimHeight
  await morph(
    ctx,
    { y: target, rot: 0, sx: 1, sy: 1 },
    Math.abs(target - y0) < 8 ? cfg().animation.transitionMs : 400
  )
}

// 一个飞行积分器同时服务下落与上弹。它始终在另一个状态写姿态前被取消。
async function fly(
  ctx: Ctx,
  { vx = 0, vy = 0 } = {},
  rising: boolean
): Promise<StateResult | void> {
  const m = cfg().motion
  const shape = { rot: shortAngle(Whale.pose.rot), sx: Whale.pose.sx, sy: Whale.pose.sy }
  let elapsed = 0
  let next: StateResult | undefined
  await ctx.frameLoop((dtMs) => {
    const dt = dtMs / 1000,
      wa = App.workarea,
      floor = floorY()
    elapsed += dtMs
    const k = Tween.Ease.smooth(Math.min(1, elapsed / cfg().animation.transitionMs))
    Whale.pose.rot = shape.rot * (1 - k)
    Whale.pose.sx = shape.sx + (1 - shape.sx) * k
    Whale.pose.sy = shape.sy + (1 - shape.sy) * k
    Whale.pose.x += vx * dt
    Whale.pose.y += vy * dt + 0.5 * m.gravity * dt * dt
    vy += m.gravity * dt
    if (Whale.pose.x < m.edgeInset) {
      Whale.pose.x = m.edgeInset
      vx = Math.abs(vx) * m.edgeRestitution
    }
    if (Whale.pose.x > wa.width - m.edgeInset) {
      Whale.pose.x = wa.width - m.edgeInset
      vx = -Math.abs(vx) * m.edgeRestitution
    }
    if (Whale.pose.y >= floor && vy > 0) {
      Whale.pose.y = floor
      next = { next: 'landing', params: { vx, impact: vy } }
      return false
    }
    if (rising && vy >= 0) {
      next = { next: 'falling', params: { vx, vy } }
      return false
    }
    return true
  })
  ctx.check()
  return next
}

export const States: Record<string, Behavior> = {
  /* ---------------- 待机:悬浮呼吸,随机时长 ---------------- */
  idle: {
    async enter(ctx) {
      Whale.setExpression('normal')
      Whale.wag(...cfg().animation.tail.idle)
      await morph(ctx, { sx: 1, sy: 1, rot: 0 })
      await ctx.wait(rand(900, 2000))
    }
  },

  /* ---------------- 随机目的地与平滑曲线游动 ---------------- */
  swim: {
    async enter(ctx) {
      Whale.setExpression('normal')
      const a = cfg().animation,
        c = cfg().swim
      // 从上一个状态留下的姿态恢复形状,然后规划一条路径。
      // 按压通过现有状态上下文取消整个行程。
      await morph(ctx, { rot: 0, sx: 1, sy: 1 })
      const route = planSwim(Whale.pose, App.workarea, c, cfg().whale.scale, Math.random)
      if (route.path.length < 1) {
        await ctx.wait(400)
        return
      }
      const dir = route.direction
      if (dir !== Whale.pose.flip) {
        await morph(ctx, { sx: 1.07, sy: 1 / 1.07, rot: -5 }, a.turnMs)
        Whale.pose.flip = dir
        await morph(ctx, { sx: 1, sy: 1, rot: 0 }, a.transitionMs)
      }
      Whale.wag(...a.tail.swim)

      const dur = (route.path.length / (cfg().whale.swimSpeed * route.speed)) * 1000 + a.swimRampMs
      const ramp = Math.min(0.5, a.swimRampMs / dur)
      const point = { x: 0, y: 0, dx: 0, dy: 0 }
      // 游动尾迹(水流):尾鳍锚点按固定弧长间距冒气泡/水流线,随路径结束自然停止
      const trail = new TrailEmitter(cfg().particles.trail, Math.random)

      await ctx.animate({
        duration: dur,
        ease: 'linear',
        onUpdate: (k) => {
          const progress = cruiseProgress(k, ramp)
          const envelope = Math.sin(k * Math.PI) ** 2
          route.path.sample(progress, point)
          Whale.pose.x = point.x
          Whale.pose.y = point.y
          Whale.pose.rot =
            clamp((Math.atan2(point.dy, Math.abs(point.dx)) * 180) / Math.PI, -c.tiltLimit, c.tiltLimit) *
            envelope
          // localToWorld 用上一合成帧的姿态(1 帧滞后,对漂散的尾迹不可见)
          const tail = Whale.localToWorld(TRAIL_ANCHOR.x, TRAIL_ANCHOR.y)
          for (const s of trail.advance(tail.x, tail.y)) {
            if (s.kind === 'wake') FX.wake(s.x, s.y, s.vx, s.vy)
            else FX.streak(s.x, s.y, s.vx, s.vy)
          }
        }
      })
      ctx.check()
      Whale.wag(...a.tail.idle)
      await ctx.wait(rand(400, 900))
    }
  },

  /* ---------------- 招牌动作:后退蓄力→海豚弧起跳→同水平线入水→随机位置浮出 ---------------- */
  jumpDive: {
    async enter(ctx) {
      const c = cfg().jumpDive
      const wa = App.workarea
      const floor = floorY()
      const dir = Whale.pose.flip // 顺着自己的朝向起跳

      Whale.setExpression('happy')
      Whale.wag(20, 4)

      // 1. 蓄力:略后退 + 压缩(像弹簧下压)
      const startX = Whale.pose.x,
        startY = Whale.pose.y
      await morph(ctx, { x: startX - c.crouchBack * dir, rot: 0, sx: 1.14, sy: 0.82 }, c.crouchMs)

      // 2. 弹性起跳画海豚弧:从后退点弹射前进,弧线落回起跳同一水平线入水。
      //    边界:起跳点贴近屏幕顶部时压缩跳高,入水点贴近左右边缘时压缩前跳距离,
      //    避免弧顶/弧线尾段被屏幕裁切。
      const launchX = Whale.pose.x
      const jumpH = Math.min(c.jumpHeight, Math.max(40, startY - 160))
      const maxFwd = dir === 1 ? wa.width - 120 - launchX : launchX - 120
      const totalX = Math.max(40, Math.min(c.crouchBack + rand(c.arcForwardMin, c.arcForwardMax), maxFwd))
      Whale.wag(10, 6)
      const launchSX = Whale.pose.sx,
        launchSY = Whale.pose.sy

      // 2a. 上升半弧:头上仰 -14°,拉伸过冲
      await ctx.animate({
        duration: c.jumpMs / 2,
        ease: 'linear',
        onUpdate: (k) => {
          Whale.pose.x = launchX + ((totalX * dir) / 2) * k
          Whale.pose.y = startY - jumpH * Math.sin((k * Math.PI) / 2)
          Whale.pose.rot = -14 * Tween.Ease.smooth(k)
          const w = Math.sin(k * Math.PI)
          Whale.pose.sy = launchSY + (1 - launchSY) * Tween.Ease.smooth(k) + 0.12 * w
          Whale.pose.sx = launchSX + (1 - launchSX) * Tween.Ease.smooth(k) - 0.08 * w
        }
      })
      ctx.check()

      // 2b. 下落半弧:俯压加速到头朝下 140°,落回起跳同一水平线;
      //     鱼头尖端(按位姿换算)穿出水面的一刻才打水花。
      Whale.setExpression('shock')
      Whale.setWaterLine(startY)
      let entryX = launchX + totalX * dir // 兜底:极小跳高时取弧线终点
      Whale.watchWaterEntry(ctx, startY, (nose) => {
        entryX = nose.x
        FX.splash(nose.x, startY - 4, cfg().particles.splashCount)
      })
      await ctx.animate({
        duration: c.jumpMs / 2,
        ease: 'linear',
        onUpdate: (k) => {
          Whale.pose.x = launchX + ((totalX * dir) * (1 + k)) / 2
          Whale.pose.y = startY - jumpH * Math.cos((k * Math.PI) / 2)
          Whale.pose.rot = -14 + 154 * k * k
        }
      })
      ctx.check()

      // 3. 入水:鲸鱼加速下潜、被水面逐渐没入
      await ctx.animate({
        duration: c.submergeMs,
        ease: 'inQuad',
        onUpdate: (k) => {
          Whale.pose.y = startY + 200 * k
        }
      })
      ctx.check()
      Whale.hide()
      Whale.setWaterLine(null)
      Whale.pose.rot = 0
      Whale.pose.sx = Whale.pose.sy = 1
      App.lastTeleportAt = Date.now()

      // 水下冒几个泡(入水线下方升起)
      for (let i = 0; i < 3; i++) {
        FX.bubble(entryX + (Math.random() - 0.5) * 60, startY + 24)
        await ctx.wait(180)
      }
      ctx.check()

      // 4. 在水下等待随机时长
      await ctx.wait(rand(c.waitMin, c.waitMax))
      ctx.check()

      // 5. 选一个随机目标点(避开边缘、与入水点保持距离)
      let tx = 0,
        ty = 0
      for (let tries = 0; tries < 20; tries++) {
        tx = rand(c.targetMargin, wa.width - c.targetMargin)
        ty = rand(wa.height * 0.25, floor - 16)
        if (Math.hypot(tx - entryX, ty - floor) >= c.minTravel) break
      }
      ty = Math.min(ty, floor - 10)

      await emerge(ctx, tx, ty)

      // 7. 开心摆两下收尾
      Whale.wag(18, 4)
      await ctx.wait(380)
      ctx.check()
      Whale.setExpression('normal')
      Whale.pose.sx = Whale.pose.sy = 1
    }
  },

  /* ---------------- 原地转圈 ---------------- */
  spin: {
    async enter(ctx) {
      Whale.setExpression('happy')
      Whale.wag(14, 4)
      const turn = Math.random() < 0.5 ? 1 : -1
      const startY = Whale.pose.y
      await morph(ctx, { sx: 1, sy: 1, rot: 0 })
      await ctx.animate({
        duration: 950,
        ease: 'outCubic',
        onUpdate: (k) => {
          Whale.pose.rot = 360 * k * turn
          Whale.pose.y = startY - 30 * Math.sin(k * Math.PI)
        }
      })
      ctx.check()
      Whale.pose.rot = 0
      Whale.pose.y = startY
      Whale.setExpression('normal')
      await ctx.wait(300)
    }
  },

  /* ---------------- 睡觉(Zzz,悬浮唤醒) ---------------- */
  sleep: {
    async enter(ctx) {
      Whale.setExpression('sleepy')
      Whale.wag(...cfg().animation.tail.sleep)
      await settleDown(ctx)
      const y0 = Whale.pose.y
      await morph(ctx, { sy: 0.9, sx: 1 / 0.9, y: y0 + 8 }, 500)

      const dur = rand(cfg().behavior.sleepDurationMin, cfg().behavior.sleepDurationMax)
      const t0 = performance.now()
      while (performance.now() - t0 < dur) {
        FX.zzz(Whale.pose.x + 24 * Whale.pose.flip, Whale.pose.y - 122)
        await ctx.wait(1500)
        ctx.check()
      }

      // 醒来伸个懒腰
      await morph(ctx, { sy: 1.12, sx: 1 / 1.12, y: y0 }, 240)
      await morph(ctx, { sx: 1, sy: 1 }, 260, 'outBack')
      Whale.setExpression('normal')
      Whale.pose.sx = Whale.pose.sy = 1
    }
  },

  /* ---------------- 被摸头(鼠标悬浮触发):开心跳 + 爱心 ---------------- */
  happy: {
    async enter(ctx) {
      Whale.setExpression('happy')
      FX.hearts(Whale.pose.x, Whale.pose.y - 108)
      const a = cfg().animation
      Whale.wag(...a.tail.happy)
      const y0 = Whale.pose.y
      await morph(ctx, { rot: 0, sy: 0.92, sx: 1 / 0.92 }, a.happyAnticipateMs)
      for (let i = 0; i < 2; i++) {
        const sy = Whale.pose.sy
        await ctx.animate({
          duration: a.happyHopMs,
          ease: 'linear',
          onUpdate: (k) => {
            Whale.pose.y = y0 - a.happyHeight * Math.sin(k * Math.PI)
            Whale.pose.sy = sy + (1 - sy) * Tween.Ease.smooth(k) + 0.1 * Math.sin(2 * Math.PI * k)
            Whale.pose.sx = 1 / Whale.pose.sy
          }
        })
        ctx.check()
        await morph(ctx, { sy: 0.93, sx: 1 / 0.93 }, a.impactCompressMs)
      }
      await morph(ctx, { sx: 1, sy: 1 }, a.impactSettleMs, 'outBack')
      FX.bubble(Whale.pose.x + 42 * Whale.pose.flip, Whale.pose.y - 104)
      await ctx.wait(350)
      ctx.check()
      Whale.setExpression('normal')
      Whale.pose.y = y0
      Whale.wag(...a.tail.idle)
    }
  },

  /* ---------------- ChatDeck 胶水:定点破水浮出(悬浮窗收起时在原位置交接) ---------------- */
  surface: {
    async enter(ctx, params: StateParams) {
      const { x = 0, y = 0 } = params as { x?: number; y?: number }
      const c = cfg().jumpDive
      const wa = App.workarea
      const floor = floorY()
      const tx = clamp(x, c.targetMargin, wa.width - c.targetMargin)
      const ty = clamp(y, wa.height * 0.25, floor - 16)
      App.lastTeleportAt = Date.now()
      await emerge(ctx, tx, ty)
      Whale.wag(18, 4)
      await ctx.wait(380)
      ctx.check()
      Whale.setExpression('normal')
      Whale.pose.sx = Whale.pose.sy = 1
    }
  },

  /* 指针持有与自由飞行是相互独立、可取消的状态 */
  held: {
    async enter(ctx) {
      Whale.setExpression('normal')
      // 位置立即冻结;在此处取消可保留其形状
      await morph(ctx, { rot: 0, sx: 1, sy: 1 })
      await ctx.frameLoop(() => true) // 保持姿态直到释放或拖拽
    }
  },
  dragged: {
    async enter(ctx, params: StateParams) {
      const { grabDX = 0, grabDY = 0 } = params as { grabDX?: number; grabDY?: number }
      Whale.setExpression('shock')
      Whale.wag(...cfg().animation.tail.dragged)
      const spring = new DragSpring(Whale.pose.x, Whale.pose.y, cfg().interaction)
      const shape = { rot: shortAngle(Whale.pose.rot), sx: Whale.pose.sx, sy: Whale.pose.sy }
      let elapsed = 0
      await ctx.frameLoop((dt) => {
        spring.update(App.cursor.x + grabDX, App.cursor.y + grabDY, dt, Whale.pose)
        elapsed += dt
        const k = Tween.Ease.smooth(Math.min(1, elapsed / cfg().animation.transitionMs))
        Whale.pose.rot = shape.rot * (1 - k)
        Whale.pose.sx = shape.sx + (1 - shape.sx) * k
        Whale.pose.sy = shape.sy + (1 - shape.sy) * k
        App.dragVelocity.vx = spring.vx
        App.dragVelocity.vy = spring.vy
        return true // 输入释放会切换状态并取消此写者
      })
    }
  },
  falling: {
    async enter(ctx, params: StateParams) {
      const { vx = 0, vy = 0 } = (params ?? {}) as Partial<Velocity>
      return fly(ctx, { vx, vy }, false)
    }
  },
  bouncing: {
    async enter(ctx, params: StateParams) {
      const { vx = 0, vy = 0 } = (params ?? {}) as Partial<Velocity>
      return fly(ctx, { vx, vy }, true)
    }
  },
  landing: {
    async enter(ctx, params: StateParams) {
      const { vx = 0, impact = 0 } = params as { vx?: number; impact?: number }
      const m = cfg().motion,
        a = cfg().animation
      const amount = a.deformLimit * clamp(impact / a.impactSpeed, 0.25, 1)
      await morph(ctx, { rot: 0, sy: 1 - amount, sx: 1 / (1 - amount) }, a.impactCompressMs, 'outQuad')
      if (impact > m.bounceThreshold) {
        FX.splash(Whale.pose.x, floorY(), 8)
        // 下一个状态在上行飞行中恢复压缩形状
        return {
          next: 'bouncing',
          params: { vx: vx * m.horizontalRestitution, vy: -impact * m.groundRestitution }
        }
      }
      await morph(ctx, { sy: 1 + amount * 0.45, sx: 1 / (1 + amount * 0.45) }, a.impactReboundMs)
      await morph(ctx, { rot: 0, sx: 1, sy: 1 }, a.impactSettleMs)
      Whale.setExpression('normal')
      Whale.wag(...a.tail.idle)
      return { next: 'idle' }
    }
  }
}

/** jumpDive 第 6 步抽出的「破水浮出」编排:surface 状态与招牌动作共用同一段视觉 */
async function emerge(ctx: Ctx, tx: number, ty: number): Promise<void> {
  const c = cfg().jumpDive
  Whale.pose.x = tx
  Whale.pose.y = ty + c.emergeDepth
  Whale.pose.sx = c.emergeSquashX
  Whale.pose.sy = c.emergeSquashY
  Whale.pose.rot = 0
  Whale.pose.flip = Math.random() < 0.5 ? 1 : -1
  Whale.setWaterLine(ty)
  Whale.show()
  Whale.setExpression('happy')
  FX.ripple(tx, ty)
  FX.surface(tx, ty + 45, cfg().particles.surfaceCount)
  await ctx.animate({
    duration: c.riseMs,
    ease: 'outBack',
    onUpdate: (k) => {
      Whale.pose.y = ty + c.emergeDepth - c.emergeDepth * k
      Whale.pose.sy = c.emergeSquashY + (1 - c.emergeSquashY) * k
      Whale.pose.sx = c.emergeSquashX + (1 - c.emergeSquashX) * k
    }
  })
  ctx.check()
  Whale.setWaterLine(null)
  FX.surface(tx, ty + 30, 6)
}
