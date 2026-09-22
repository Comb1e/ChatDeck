/**
 * 鲸鱼形态编排层——移植自 whale-pet src/app.js,IPC 改走 ChatDeck 的 window.api。
 * 应用编排:主循环、行为调度(大脑)、输入交互、IPC 接入。
 *
 * ChatDeck 胶水(与原版行为的全部差异,均已获用户确认):
 * - 快速单击鲸鱼 → 展开悬浮窗(原为「开心跳」);
 * - 鼠标悬浮到鲸鱼身上 → 触发「开心跳」(原为单击);
 * - 头顶未读气泡(点击同样展开);
 * - 收到 surface 命令 → 在指定点破水浮出。
 */
import { WHALE_CONFIG } from '@shared/whaleConfig'
import { App } from './context'
import { FSM, FrameLoops } from './fsm'
import { FX } from './particles'
import { FrameScheduler, followViewport, screenToWorld, throwVelocity } from './runtime'
import { States } from './states'
import { Tween } from './tween'
import { Whale } from './whale'
import { badgeHit, initBadge, setUnread, syncBadge } from './badge'
import { FormStage } from './formStage'
import type { PetVisual } from '@shared/formTransition'
import type { SchedulerMode } from './runtime'

const rand = (a: number, b: number): number => a + Math.random() * (b - a)
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))

const fsm = new FSM()
let brainTimer: ReturnType<typeof setTimeout> | null = null
let scheduler: FrameScheduler | null = null
let suspended = false
let formStage: FormStage | null = null
function requestPetFrame(): void {
  if (scheduler) scheduler.request()
}

/* 原生窗口保持固定;只有小的特效画布取景窗口移动,其 CSS 偏移与绘制原点在同一渲染帧内变更 */
const EffectsViewport = { x: 0, y: 0, width: 0, height: 0 }
function initEffects(): void {
  const perf = WHALE_CONFIG.performance
  const side = Math.ceil(perf.whaleHalf * 2 * WHALE_CONFIG.whale.scale)
  EffectsViewport.width = side + perf.fxMarginX * 2
  EffectsViewport.height = side + perf.fxMarginY * 2
  const canvas = document.getElementById('fx') as HTMLCanvasElement
  canvas.style.width = `${EffectsViewport.width}px`
  canvas.style.height = `${EffectsViewport.height}px`
  FX.init(canvas)
}
function updateEffectsViewport(): void {
  if (!followViewport(Whale.pose, EffectsViewport, App.workarea, WHALE_CONFIG.performance.originStep))
    return
  const canvas = document.getElementById('fx') as HTMLCanvasElement
  canvas.style.left = `${EffectsViewport.x}px`
  canvas.style.top = `${EffectsViewport.y}px`
  FX.setOrigin(EffectsViewport.x, EffectsViewport.y)
}

/* debug 钉住模式(whale.html?pinned=1):鲸鱼停在原地只保留呼吸/视线等环境动画,
   不自主游动/跳跃——形态切换与截图测试需要可复现的鲸鱼位置时使用 */
const PINNED = new URLSearchParams(location.search).has('pinned')

/* ---------- 行为大脑:状态结束后按权重随机挑下一个 ---------- */
function scheduleNext(extraDelay = 0): void {
  if (brainTimer) clearTimeout(brainTimer)
  if (!App.ready || PINNED) return
  brainTimer = setTimeout(pickAndRun, rand(WHALE_CONFIG.behavior.minDelay, WHALE_CONFIG.behavior.maxDelay) + extraDelay)
}

function pickAndRun(): void {
  if (!App.ready || App.stateName) return
  const weights: Record<string, number> = { ...WHALE_CONFIG.behavior.weights }
  if (App.stateName === 'sleep') weights.sleep = 0 // 不连续睡两次
  if (Date.now() - App.lastTeleportAt < WHALE_CONFIG.behavior.minTeleportInterval) weights.jumpDive = 0
  let total = 0
  for (const k in weights) total += weights[k]
  if (total <= 0) {
    scheduleNext()
    return
  }
  let r = Math.random() * total
  let choice = 'idle'
  for (const k in weights) {
    r -= weights[k]
    if (r <= 0) {
      choice = k
      break
    }
  }
  go(choice)
}

function go(name: string, params?: Record<string, unknown>): void {
  if (suspended) return
  document.body.classList.toggle('dragging', name === 'held' || name === 'dragged')
  if (brainTimer) clearTimeout(brainTimer)
  App.stateName = name
  fsm.to(name, params)
  requestPetFrame()
}

/* ---------- 视线跟随 ---------- */
const gazeCache: { cursor: number; x: number; y: number; flip: number } = {
  cursor: -1,
  x: 0,
  y: 0,
  flip: 1
}
function updateGaze(): void {
  const p = Whale.pose,
    c = gazeCache
  if (c.cursor === App.input.revision && c.x === p.x && c.y === p.y && c.flip === p.flip) return
  c.cursor = App.input.revision
  c.x = p.x
  c.y = p.y
  c.flip = p.flip
  const gz = WHALE_CONFIG.gaze
  // 眼睛位于锚点上方约 70px(朝向侧偏移随 flip 镜像)
  const dx = App.cursor.x - (Whale.pose.x + 14 * Whale.pose.flip)
  const dy = App.cursor.y - (Whale.pose.y - 74)
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len,
    uy = dy / len
  Whale.setGaze(
    clamp(ux * gz.pupilRange * 1.6, -gz.pupilRange, gz.pupilRange),
    clamp(uy * gz.pupilRange, -gz.pupilRange, gz.pupilRange)
  )
}

/* ---------- 悬停检测:只在鲸鱼/气泡上时接管鼠标 ---------- */
function updateHover(): void {
  if (suspended) { formStage?.hover(); return }
  const whaleHover = Whale.hitTest(App.cursor.x, App.cursor.y)
  const badgeHover = badgeHit(App.cursor.x, App.cursor.y)
  const want =
    App.input.pressed || (App.stateName !== 'jumpDive' && (whaleHover || badgeHover))
  // 悬浮到鲸鱼身上 → 开心跳(单击已让位给「展开悬浮窗」)
  if (
    whaleHover &&
    !App.hovering &&
    !App.input.pressed &&
    App.stateName !== 'jumpDive' &&
    App.stateName !== 'surface' &&
    App.ready
  ) {
    go('happy')
  }
  if (want !== App.hovering) {
    App.hovering = want
    window.api.whale.setInteractive(want)
  }
}

/* ---------- 展开(压缩形态 → 悬浮窗) ---------- */
function expand(): void {
  if (suspended) { void window.api.float.toggle(); return }
  void window.api.whale.expand()
}

/* ---------- 输入 ---------- */
function acceptCursor(point: { x: number; y: number; at: number }, source: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return
  if (!App.input.acceptCursor(point.at, source)) return
  const oldX = App.cursor.x,
    oldY = App.cursor.y
  screenToWorld(point, App.workarea, App.cursor)
  if (!suspended && App.input.move(App.cursor.x, App.cursor.y, WHALE_CONFIG.interaction.dragThreshold)) {
    go('dragged', { grabDX: App.input.grabDX, grabDY: App.input.grabDY })
  }
  if (oldX !== App.cursor.x || oldY !== App.cursor.y) {
    updateHover()
    requestPetFrame()
  }
}

function bindInput(): void {
  const root = document.getElementById('whale-root') as Element
  const sample = (e: PointerEvent): void =>
    acceptCursor(
      { x: e.screenX, y: e.screenY, at: performance.timeOrigin + e.timeStamp },
      'pointer'
    )
  const finish = (reason: string, e?: PointerEvent): void => {
    const input = App.input
    if (!input.pressed || (e && e.pointerId !== input.pointerId)) return
    if (reason === 'up' && e) sample(e)
    const id = input.pointerId
    const phase = input.release()
    if (id !== null && root.hasPointerCapture(id)) root.releasePointerCapture(id)
    const quick =
      reason === 'up' &&
      phase === 'PRESSED' &&
      performance.now() - input.downAt < WHALE_CONFIG.interaction.clickMs &&
      Math.hypot(App.cursor.x - input.downX, App.cursor.y - input.downY) <
        WHALE_CONFIG.interaction.clickDistance
    if (quick) {
      expand() // 单击鲸鱼 → 展开悬浮窗(姿态冻结即可,窗口即将隐藏)
    } else {
      go('falling', { ...throwVelocity(App.dragVelocity, WHALE_CONFIG.motion) })
    }
    updateHover()
    requestPetFrame()
  }
  root.addEventListener('pointerdown', (e) => {
    const ev = e as PointerEvent
    if (suspended || ev.button !== 0 || ev.isPrimary === false || App.input.pressed) return
    sample(ev)
    App.input.press(ev.pointerId, App.cursor.x, App.cursor.y, performance.now(), Whale.pose)
    App.dragVelocity.vx = App.dragVelocity.vy = 0
    go('held') // 在跨越拖拽阈值之前立即取消上一个动作
    root.setPointerCapture(ev.pointerId)
    updateHover()
    requestPetFrame()
    ev.preventDefault()
  })
  document.addEventListener('pointermove', (e) => {
    const ev = e as PointerEvent
    // 原生窗口外的释放可能只以后续 move 的形式到达。
    // 鼠标键已松开后绝不能继续跟随桌面光标。
    if (
      App.input.pressed &&
      ev.pointerId === App.input.pointerId &&
      ev.pointerType === 'mouse' &&
      !(ev.buttons & 1)
    )
      finish('buttons-lost', ev)
    if (!App.input.pressed || ev.pointerId === App.input.pointerId) sample(ev)
  })
  document.addEventListener('pointerup', (e) => finish('up', e as PointerEvent))
  document.addEventListener('pointercancel', (e) => finish('cancel', e as PointerEvent))
  root.addEventListener('lostpointercapture', () => finish('lost-capture'))
  window.addEventListener('blur', () => finish('blur'))
}

/* ---------- 主循环 ---------- */
function renderMode(): SchedulerMode {
  if (suspended) return 'DORMANT'
  if (
    App.input.pressed ||
    Tween.hasAnimations() ||
    FrameLoops.size ||
    FX.hasFastEffects() ||
    Whale.hasMotion()
  )
    return 'ACTIVE'
  if (!Whale.isVisible() && !FX.hasParticles()) return 'DORMANT'
  if (App.stateName === 'sleep') return 'SLEEP'
  return 'IDLE'
}
const poseCache = { x: 0, y: 0, visible: true, state: null as string | null }
function loop(t: number, dt: number): void {
  if (suspended) return
  Tween.update(t)
  /* 直接迭代 Set:resolve() 经微任务异步删除,迭代期间无同步变更 */
  for (const entry of FrameLoops) {
    if (entry.fn(Math.min(WHALE_CONFIG.performance.maxPhysicsDeltaMs, dt)) === false && entry.resolve)
      entry.resolve()
  }

  Whale.render(t) // 一次性合成,包括水面入水事件,先于几何查询
  if (App.ready) {
    updateGaze()
    const p = Whale.pose,
      c = poseCache
    // 形变也会在锚点静止时改变命中目标
    updateHover()
    syncBadge(p, Whale.isVisible(), App.workarea)
    if (c.x !== p.x || c.y !== p.y || c.visible !== Whale.isVisible() || c.state !== App.stateName) {
      c.x = p.x
      c.y = p.y
      c.visible = Whale.isVisible()
      c.state = App.stateName
      updateEffectsViewport()
    }
  }
  FX.update(dt)
  FX.render()
}

/* ---------- IPC 接入 ---------- */
function bindIpc(): void {
  window.api.onWhale.cursor((p) => acceptCursor(p, 'poll'))
  window.api.onWhale.workarea((wa) => {
    App.workarea = wa
    FX.resize()
    if (!suspended) {
      Whale.pose.x = clamp(Whale.pose.x, 80, wa.width - 80)
      Whale.pose.y = Math.min(Whale.pose.y, wa.height - WHALE_CONFIG.whale.floorInset)
    }
    updateEffectsViewport()
    requestPetFrame()
  })
  window.api.onWhale.command((cmd) => {
    if (cmd.type === 'jump-dive' && !App.input.pressed) go('jumpDive')
    else if (cmd.type === 'surface') {
      // 屏幕坐标 → 工作区世界坐标,在悬浮窗原位置破水浮出
      const world = screenToWorld({ x: cmd.x, y: cmd.y }, App.workarea, { x: 0, y: 0 })
      go('surface', { x: world.x, y: world.y })
    }
  })
  window.api.onWhale.unread((n) => setUnread(n))
}

function freezePet(): PetVisual {
  const snapshot = Whale.visualSnapshot()
  snapshot.x += App.workarea.x
  snapshot.y += App.workarea.y
  if (suspended) return snapshot
  suspended = true
  App.ready = false
  if (brainTimer) clearTimeout(brainTimer)
  fsm.cancel()
  App.stateName = null
  const pointer = App.input.pointerId
  App.input.release()
  const root = document.getElementById('whale-root')!
  if (pointer !== null && root.hasPointerCapture(pointer)) root.releasePointerCapture(pointer)
  document.body.classList.remove('dragging')
  FX.clear()
  syncBadge(Whale.pose, false, App.workarea)
  App.hovering = false
  window.api.whale.setInteractive(false)
  return snapshot
}
function resumePet(visual?: PetVisual): void {
  if (visual) Whale.restoreVisual({ ...visual, x: visual.x - App.workarea.x, y: visual.y - App.workarea.y })
  else { Whale.setWaterLine(null); Whale.show() }
  suspended = false
  App.ready = true
  Whale.setMotionMode('idle')
  updateEffectsViewport()
  scheduleNext(250)
  requestPetFrame()
}

/* ---------- 启动 ---------- */
async function boot(): Promise<void> {
  Whale.build(document.getElementById('stage') as unknown as SVGElement)
  Whale.setScale(WHALE_CONFIG.whale.scale)
  Whale.setSwayRatio(WHALE_CONFIG.whale.swayRatio)
  initEffects()

  App.workarea = await window.api.whale.getWorkarea()

  Whale.pose.x = App.workarea.width * 0.3
  Whale.pose.y = App.workarea.height - WHALE_CONFIG.whale.floorInset

  initBadge(expand)
  bindIpc()
  updateEffectsViewport()

  for (const [name, st] of Object.entries(States)) fsm.add(name, st)
  fsm.onStateEnd = (name, result) => {
    if (result?.next) {
      go(result.next, result.params as Record<string, unknown> | undefined)
      return
    }
    App.stateName = null
    Whale.setMotionMode('idle')
    scheduleNext(name === 'jumpDive' ? 600 : 0)
  }
  bindInput()
  formStage = new FormStage(document.getElementById('stage') as unknown as SVGElement, {
    freeze: freezePet, cover: () => Whale.hide(), resume: resumePet, cursor: () => App.cursor, workarea: () => App.workarea
  })

  App.ready = true
  scheduler = new FrameScheduler({
    frame: loop,
    mode: renderMode,
    idleFps: WHALE_CONFIG.performance.idleFps,
    sleepFps: WHALE_CONFIG.performance.sleepFps
  })
  Tween.setWake(requestPetFrame)
  FX.setWake(requestPetFrame)
  go('idle')
  Whale.render(performance.now())
  FX.render()
  window.api.whale.ready()
  scheduler.start()
  console.log('[whale] booted')
}

void boot()
