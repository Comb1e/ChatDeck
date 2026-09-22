/**
 * DeepSeek 风格小蓝鲸:扁平双色剪裁风(#4D6BFE + 镂空白)——移植自 whale-pet src/whale.js。
 * 形状依据官方 LOGO 逐像素扫描测得(水平镜像为面朝右的基底,使状态机的 flip/rot 语义不变):
 * - 身体:圆滚滚主形体 + 背部卷浪形装饰角;肚皮 evenodd 镂空(透出桌面)
 * - 尾鳍:双叉上翘尾(独立分组,可摆动);根部为绕摆轴的圆弧(摆动时根缝永不露出)
 * - 眼睛:逗号浪花形白 swoosh + 圆点瞳(支持眨眼/视线),另有开心/困倦/惊讶变体
 * - 摆尾:尾鳍绕 TAIL_PIVOT 转动 + 整体绕 SWAY_PIVOT 同向轻摆;水线只裁剪原画
 * pose 由状态机驱动,环境层(呼吸/浮动/摆尾/视线/眨眼)在 render 时叠加。
 */
import { WHALE_CONFIG } from '@shared/whaleConfig'
import { DampedSpring, TailOscillator } from './runtime'
import { Tween } from './tween'
import type { Pose, XY } from './types'
import type { PetVisual } from '@shared/formTransition'
import { smooth } from '@shared/formTransition'

const SVGNS = 'http://www.w3.org/2000/svg'
import { ANCHOR, BODY_CENTER, EYE, NOSE, TAIL_PIVOT, SWAY_PIVOT, BLUE, WHITE, BODY_D, TAIL_D, EYE_D } from '@shared/whaleGeometry'
export const pose: Pose = { x: 300, y: 300, rot: 0, sx: 1, sy: 1, flip: 1 }
const gaze = { dx: 0, dy: 0 }
const tail = new TailOscillator()
const secondary = {
  tilt: new DampedSpring(),
  stretch: new DampedSpring(),
  weight: new DampedSpring(1),
  gazeX: new DampedSpring(),
  gazeY: new DampedSpring(),
  swayWeight: new DampedSpring(1)
}
const secondarySprings = Object.values(secondary)
let mode = 'idle'
let lastFrame: number | null = null
let lastX: number | null = null
let lastY: number | null = null
let bobPhase = 0,
  breathPhase = 0
let waterEntry: { ctx: { cancelled: boolean }; y: number; callback: (nose: XY) => void } | null =
  null
let swayRatio = 0.2 // 身体随摆幅度 = 尾角 × swayRatio
const wagOverride = { angle: null as number | null } // 离屏验证钩子:固定尾角
// 快照包含提交给 Chromium 的精确量化变换
const cur = {
  tailAngle: 0,
  sway: 0,
  x: 300,
  y: 300,
  rot: 0,
  sx: 1,
  sy: 1,
  flip: 1,
  scale: 1,
  bob: 0,
  stretch: 0,
  tilt: 0,
  gx: 0,
  gy: 0
}

export interface WhaleSnapshot {
  tailAngle: number
  sway: number
  x: number
  y: number
  rot: number
  sx: number
  sy: number
  flip: number
  scale: number
  bob: number
  stretch: number
  tilt: number
  gx: number
  gy: number
}

interface WhaleNodes {
  clip: SVGGElement
  root: SVGGElement
  waterRect: SVGRectElement
  inner: SVGGElement
  tail: SVGGElement
  body: SVGPathElement
  eye: SVGGElement
  eyeHappy: SVGPathElement
  eyeSleep: SVGPathElement
  eyeShock: SVGGElement
}

let scale = 1
let resumeBlend: { from: PetVisual; start: number | null } | null = null
let visible = true
const g = {} as WhaleNodes

function el(name: string, attrs: Record<string, string | number>, parent: Element): Element {
  const n = document.createElementNS(SVGNS, name)
  for (const k in attrs) n.setAttribute(k, String(attrs[k]))
  if (parent) parent.appendChild(n)
  return n
}

function build(stage: Element): void {
  // 外层裁剪组:窗口坐标系(不随鲸鱼 transform),配合 setWaterLine 实现水面线裁剪
  g.clip = el('g', {}, stage) as SVGGElement
  g.root = el('g', { id: 'whale-root' }, g.clip) as SVGGElement
  const defs = el('defs', {}, stage)
  const cp = el('clipPath', { id: 'whale-water-clip' }, defs)
  g.waterRect = el('rect', { x: -4000, y: -4000, width: 8000, height: 4000 }, cp) as SVGRectElement
  // 内层组:整体随动摆动(sway)挂在这里,身体与尾鳍一起轻摇
  const w = (g.inner = el('g', {}, g.root) as SVGGElement)

  // 尾鳍(双叉上翘,位于身体后面,与身体同色无描边可无缝融合)
  g.tail = el('g', { id: 'whale-tail' }, w) as SVGGElement
  el('path', { d: TAIL_D, fill: BLUE }, g.tail)

  // 身体(默认带肚皮镂空:evenodd 复合路径;水线仅通过外层 clipPath 裁剪)
  g.body = el(
    'path',
    {
      id: 'whale-body',
      d: BODY_D,
      fill: BLUE,
      'fill-rule': 'evenodd',
      'clip-rule': 'evenodd'
    },
    w
  ) as SVGPathElement

  // 腮红(半透明白,贴扁平风)
  el(
    'ellipse',
    { cx: 116, cy: 103, rx: 7, ry: 4.2, fill: WHITE, opacity: 0.28, transform: 'rotate(12 116 103)' },
    w
  )

  // 眼睛:逗号浪花形 + 圆点瞳(整组可做眨眼缩放与视线偏移)
  g.eye = el('g', { id: 'whale-eye' }, w) as SVGGElement
  el('path', { d: EYE_D, fill: WHITE }, g.eye)
  el('circle', { cx: 102.3, cy: 84, r: 3.1, fill: WHITE }, g.eye)

  // 备选表情(白色描边风)
  g.eyeHappy = el(
    'path',
    { d: 'M 80 88 Q 90 76 100 88', fill: 'none', stroke: WHITE, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0 },
    w
  ) as SVGPathElement
  g.eyeSleep = el(
    'path',
    { d: 'M 80 82 Q 90 91 100 82', fill: 'none', stroke: WHITE, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0 },
    w
  ) as SVGPathElement
  g.eyeShock = el('g', { opacity: 0 }, w) as SVGGElement
  el('circle', { cx: 90, cy: 84, r: 7.5, fill: WHITE }, g.eyeShock)
  el('circle', { cx: 90, cy: 84, r: 2.8, fill: BLUE }, g.eyeShock)

  // 独立眨眼动画
  scheduleBlink()
}

/* ---------- 表情 ---------- */
let eyeMode = 'normal' // render 用它判断眼睛组是否可见,免去每帧 getAttribute
function setExpression(name: string): void {
  if (eyeMode === name && g.eye?.getAttribute('opacity') !== null) return
  eyeMode = name
  const o = (node: SVGElement, v: string): void => node.setAttribute('opacity', v)
  o(g.eye, name === 'normal' ? '1' : '0')
  o(g.eyeHappy, name === 'happy' ? '1' : '0')
  o(g.eyeSleep, name === 'sleepy' ? '1' : '0')
  o(g.eyeShock, name === 'shock' ? '1' : '0')
}

/* ---------- 环境动画 ---------- */
let blinkK = 0 // 眨眼进度 0~1;blink tween 只更新该值,由 render 统一合成写入
function scheduleBlink(): void {
  setTimeout(() => {
    if (visible && eyeMode === 'normal') {
      Tween.run({
        duration: 150,
        ease: 'linear',
        onUpdate: (k) => {
          blinkK = k
        },
        onComplete: () => {
          blinkK = 0
        }
      })
    }
    scheduleBlink()
  }, 2400 + Math.random() * 2800)
}

function wag(amp: number, freq: number): void {
  tail.set(amp, freq)
}
function setMotionMode(name: string | null): void {
  mode = name || 'idle'
  // 新状态接管运动;不得把有意的位移或上一个写者的最后一步当作新加速度
  lastX = pose.x
  lastY = pose.y
  const preset = WHALE_CONFIG.animation.tail[mode]
  if (preset) wag(preset[0], preset[1])
}
function hasMotion(): boolean {
  const c = WHALE_CONFIG.animation
  return (
    visible &&
    (!tail.settled() ||
      secondarySprings.some((s) => !s.settled(c.settlePosition, c.settleVelocity)))
  )
}
/* 身体随动比例:摆尾时整条鲸鱼绕 SWAY_PIVOT 同向轻摆 = 尾角 × swayRatio */
function setSwayRatio(r: number): void {
  if (typeof r === 'number' && r >= 0) swayRatio = r
}
/* 验证钩子(离屏脚本用):固定尾角,null 恢复正弦驱动 */
function setWagOverride(angle: number | null): void {
  wagOverride.angle = angle
}

function setGaze(dx: number, dy: number): void {
  gaze.dx = dx
  gaze.dy = dy
}
let waterLineY: number | null = null // 固定窗口中世界坐标与视口坐标一致
function applyWaterLine(): void {
  if (waterLineY != null) g.waterRect.setAttribute('height', String(4000 + waterLineY))
}
/* 水面线裁剪(世界坐标 y,固定不随鲸鱼变动):设置后仅显示该线以上部分,null 解除。
 * 只改变可见区域,不新增颜色或淡出动画,保留肚皮镂空。 */
function setWaterLine(y: number | null): void {
  if (y == null) {
    waterLineY = null
    g.clip.removeAttribute('clip-path')
    return
  }
  waterLineY = y
  applyWaterLine()
  g.clip.setAttribute('clip-path', 'url(#whale-water-clip)')
}
// 本帧姿态合成后、FX 绘制前求值;取消上下文像持有 tween 一样持有该一次性事件
function watchWaterEntry(
  ctx: { cancelled: boolean },
  y: number,
  callback: (nose: XY) => void
): void {
  waterEntry = { ctx, y, callback }
}

/* 艺术坐标 -> 世界坐标,使用与 SVG/命中测试相同的快照 */
function localToWorld(px: number, py: number): XY {
  const a0 = (cur.sway * Math.PI) / 180
  const dx0 = px - SWAY_PIVOT.x,
    dy0 = py - SWAY_PIVOT.y
  const rx = SWAY_PIVOT.x + dx0 * Math.cos(a0) - dy0 * Math.sin(a0)
  const ry = SWAY_PIVOT.y + dx0 * Math.sin(a0) + dy0 * Math.cos(a0)
  const qx = (rx - ANCHOR.x) * cur.sx
  const qy = (ry - ANCHOR.y) * cur.sy
  const a = (cur.rot * Math.PI) / 180
  const c = Math.cos(a),
    s = Math.sin(a)
  return {
    x: cur.x + (qx * c - qy * s) * cur.flip * cur.scale,
    y: cur.y + (qx * s + qy * c) * cur.scale
  }
}
function setScale(s: number): void {
  scale = s
}
function show(): void {
  visible = true
  g.root.setAttribute('opacity', '1')
}
function hide(): void {
  visible = false
  g.root.setAttribute('opacity', '0')
}
function isVisible(): boolean {
  return visible
}

/* 反演合成变换;同一身体椭圆跟随真实的朝向/压缩/倾斜/随动 */
function hitTest(px: number, py: number): boolean {
  if (!visible) return false
  if (waterLineY != null && py > waterLineY) return false
  const x = (px - cur.x) / (cur.flip * cur.scale),
    y = (py - cur.y) / cur.scale
  const a = (cur.rot * Math.PI) / 180,
    ca = Math.cos(a),
    sa = Math.sin(a)
  const rx = (x * ca + y * sa) / cur.sx + ANCHOR.x - SWAY_PIVOT.x
  const ry = (-x * sa + y * ca) / cur.sy + ANCHOR.y - SWAY_PIVOT.y
  const b = (cur.sway * Math.PI) / 180,
    cb = Math.cos(b),
    sb = Math.sin(b)
  const dx = (rx * cb + ry * sb + SWAY_PIVOT.x - BODY_CENTER.x) / 88
  const dy = (-rx * sb + ry * cb + SWAY_PIVOT.y - BODY_CENTER.y) / 78
  return dx * dx + dy * dy <= 1.05
}

/* ---------- 渲染(单写者:所有 transform 由这里统一写入) ----------
 * 性能要点:数值量化到 0.1(呼吸用 0.001)缩短序列化串;上次写入的字符串
 * 缓存比对,相同则跳过 setAttribute;隐藏期跳过全部 DOM 写。 */
const tCache = new Map<Element, Partial<Record<'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'h', number>>>()
function changed(
  node: Element,
  a: number,
  b?: number,
  c?: number,
  d?: number,
  e?: number,
  f?: number,
  h?: number
): boolean {
  let last = tCache.get(node)
  if (
    last &&
    last.a === a &&
    last.b === b &&
    last.c === c &&
    last.d === d &&
    last.e === e &&
    last.f === f &&
    last.h === h
  )
    return false
  if (!last) {
    last = {}
    tCache.set(node, last)
  }
  last.a = a
  last.b = b
  last.c = c
  last.d = d
  last.e = e
  last.f = f
  last.h = h
  return true
}
const q1 = (n: number): number => Math.round(n * 10) / 10
const q3 = (n: number): number => Math.round(n * 1000) / 1000

function compose(t: number): void {
  const c = WHALE_CONFIG.animation
  const dt =
    lastFrame == null ? 0 : Math.min(WHALE_CONFIG.performance.maxPhysicsDeltaMs, Math.max(0, t - lastFrame))
  lastFrame = t
  const clamp = (v: number, limit: number): number => Math.max(-limit, Math.min(limit, v))
  const moving = ['dragged', 'swim', 'falling', 'bouncing'].includes(mode)
  const vx = dt > 0 && lastX != null ? ((pose.x - lastX) * 1000) / dt : 0
  const vy = dt > 0 && lastY != null ? ((pose.y - lastY) * 1000) / dt : 0
  lastX = pose.x
  lastY = pose.y
  const spring = (
    name: keyof typeof secondary,
    target: number,
    frequency = c.bodyFrequencyHz,
    damping = c.bodyDampingRatio
  ): number => secondary[name].advance(target, dt, frequency, damping)
  const tilt = spring('tilt', moving ? clamp(vx * c.velocityTilt, c.tiltLimit) : 0)
  const stretch = spring(
    'stretch',
    moving ? clamp((Math.abs(vy) - Math.abs(vx) * 0.5) * c.velocityStretch, c.deformLimit) : 0
  )
  const weight = spring('weight', mode === 'idle' || mode === 'sleep' ? 1 : 0, c.bodyFrequencyHz, 1)
  const tailAngle = tail.advance(dt, c.tailBlendMs)
  bobPhase = (bobPhase + (dt / 1000) * Math.PI * 2 * c.bobFrequencyHz) % (2 * Math.PI)
  breathPhase = (breathPhase + (dt / 1000) * Math.PI * 2 * c.breathFrequencyHz) % (2 * Math.PI)
  cur.tailAngle = wagOverride.angle != null ? wagOverride.angle : q1(tailAngle)
  // 静止与水面编排时保留既有的尾根随动;落地时身体随动淡出使腹部保持贴地
  const swayWeight = spring('swayWeight', mode === 'landing' ? 0 : 1, c.bodyFrequencyHz, 1)
  cur.sway = q1(cur.tailAngle * swayRatio * swayWeight)
  cur.bob = q1(Math.sin(bobPhase) * c.bobAmplitude * weight)
  cur.stretch = clamp(stretch, c.deformLimit)
  cur.tilt = clamp(tilt, c.tiltLimit) * pose.flip
  const shape = 1 + cur.stretch
  cur.x = q1(pose.x)
  cur.y = q1(pose.y + cur.bob)
  cur.rot = q1(pose.rot + cur.tilt)
  cur.sx = q3(pose.sx / shape)
  cur.sy = q3(pose.sy * shape * (1 + Math.sin(breathPhase) * c.breathAmplitude * weight))
  cur.flip = pose.flip
  cur.scale = q3(scale)
  cur.gx = q1(spring('gazeX', gaze.dx, c.gazeFrequencyHz, 1))
  cur.gy = q1(spring('gazeY', gaze.dy, c.gazeFrequencyHz, 1))
  if (resumeBlend) {
    resumeBlend.start ??= t
    const k = smooth((t - resumeBlend.start) / c.transitionMs)
    for (const key of ['x', 'y', 'rot', 'sx', 'sy', 'flip', 'scale', 'sway', 'tailAngle', 'gx', 'gy'] as const)
      cur[key] = resumeBlend.from[key] + (cur[key] - resumeBlend.from[key]) * k
    if (k === 1) resumeBlend = null
  }
}

function visualSnapshot(): PetVisual {
  return { ...cur, expression: eyeMode,
    blink: blinkK > 0 ? Math.max(0.08, blinkK < 0.5 ? 1 - blinkK * 2 : (blinkK - 0.5) * 2) : 1 }
}
function restoreVisual(visual: PetVisual): void {
  Object.assign(pose, { x: visual.x, y: visual.y, rot: visual.rot, sx: visual.sx, sy: visual.sy, flip: visual.flip })
  lastFrame = null
  lastX = visual.x
  lastY = visual.y
  resumeBlend = { from: visual, start: null }
  setWaterLine(null)
  setExpression(visual.expression)
  show()
  render(performance.now())
}

function render(t: number): void {
  if (!g.root) return
  compose(t)
  const { tailAngle, sway } = cur
  if (!visible) return // 隐藏期:root opacity 已为 0,无需更新变换

  if (changed(g.tail, tailAngle))
    g.tail.setAttribute('transform', `rotate(${tailAngle} ${TAIL_PIVOT.x} ${TAIL_PIVOT.y})`)
  if (changed(g.inner, sway))
    g.inner.setAttribute('transform', `rotate(${sway} ${SWAY_PIVOT.x} ${SWAY_PIVOT.y})`)

  const { x, y, rot, sx, sy } = cur
  const flip = q3(cur.flip * cur.scale),
    sc = cur.scale
  if (changed(g.root, x, y, flip, sc, rot, sx, sy))
    g.root.setAttribute(
      'transform',
      `translate(${x} ${y}) scale(${flip} ${sc}) rotate(${rot}) scale(${sx} ${sy}) translate(${-ANCHOR.x} ${-ANCHOR.y})`
    )

  if (eyeMode === 'normal') {
    const gx = cur.gx,
      gy = cur.gy
    if (blinkK > 0) {
      const eyeSy = Math.max(0.08, blinkK < 0.5 ? 1 - blinkK * 2 : (blinkK - 0.5) * 2)
      const ey = q1(EYE.cy * (1 - eyeSy)),
        es = q3(eyeSy)
      if (changed(g.eye, gx, gy, ey, es))
        g.eye.setAttribute(
          'transform',
          `translate(${gx} ${gy}) translate(0 ${ey}) scale(1 ${es})`
        )
    } else {
      if (changed(g.eye, gx, gy)) g.eye.setAttribute('transform', `translate(${gx} ${gy})`)
    }
  }
  if (waterEntry) {
    if (waterEntry.ctx.cancelled) waterEntry = null
    else {
      const nose = localToWorld(NOSE.x, NOSE.y)
      if (nose.y >= waterEntry.y) {
        const event = waterEntry
        waterEntry = null
        event.callback(nose)
      }
    }
  }
}

export const Whale = {
  visualSnapshot,
  restoreVisual,
  build,
  render,
  pose,
  gaze,
  ANCHOR,
  NOSE,
  TAIL_PIVOT,
  localToWorld,
  setExpression,
  setGaze,
  setScale,
  wag,
  setSwayRatio,
  setWagOverride,
  setWaterLine,
  show,
  hide,
  isVisible,
  hitTest,
  setMotionMode,
  hasMotion,
  watchWaterEntry,
  snapshot: (): WhaleSnapshot => ({ ...cur })
}
