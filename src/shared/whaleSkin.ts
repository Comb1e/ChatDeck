import { ANCHOR, BODY_D, EYE_D, SWAY_PIVOT, TAIL_D, TAIL_PIVOT } from './whaleGeometry'
import { FORM_CONFIG, clamp01, smooth, type FormScene, type PetVisual } from './formTransition'
import { FLOAT_FRAME_PAD, FLOAT_HEADER_H, FLOAT_INSET, FLOAT_PROMPTBAR_H, FLOAT_WINDOW } from './floatLayout'
import type { Rect } from './types'

export interface Point { x: number; y: number }
export interface SkinFrame {
  body: Point[]; mouth: Point[]; tail: Point[]; eye: Point[]; dot: Point[]; cheek: Point[]
  ink: number; cheekOpacity: number; dotWhite: number
  /** 蓝色主体填充的不透明度:恒为 1——融化中快照必须与不透明主体交叉淡化,而非与桌面 */
  bodyOpacity: number
  /** 嘴部暗色填充(面板=内容区底色,鲸鱼=镂空透底):收起阶段A保持 1,阶段B随轮廓收拢淡出 */
  mouthFill: number
}
const N = FORM_CONFIG.contourSamples
const mix = (a: number, b: number, t: number): number => a + (b - a) * t
function blend(a: Point[], b: Point[], t: number): Point[] {
  return a.map((p, i) => ({ x: mix(p.x, b[i].x, t), y: mix(p.y, b[i].y, t) }))
}

/** Uniform arc-length samples keep the original cubic artwork within subpixel error. */
export function resample(points: Point[], count = N): Point[] {
  const lengths = [0]
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    lengths.push(lengths[i] + Math.hypot(b.x - a.x, b.y - a.y))
  }
  let segment = 0
  return Array.from({ length: count }, (_, i) => {
    const distance = lengths[points.length] * i / count
    while (segment < points.length - 1 && lengths[segment + 1] < distance) segment++
    const a = points[segment], b = points[(segment + 1) % points.length]
    const t = (distance - lengths[segment]) / (lengths[segment + 1] - lengths[segment] || 1)
    return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) }
  })
}

/** The shared source artwork deliberately only uses absolute M/C/Z commands. */
export function sampleArtwork(d: string): Point[] {
  const tokens = d.match(/[MCZ]|-?\d*\.?\d+/g)!
  let i = 0, current: Point = { x: 0, y: 0 }
  const result: Point[] = []
  const point = (): Point => ({ x: Number(tokens[i++]), y: Number(tokens[i++]) })
  while (i < tokens.length) {
    const command = tokens[i++]
    if (command === 'M') { current = point(); result.push(current) }
    else if (command === 'C') {
      const a = current, b = point(), c = point(), end = point()
      for (let j = 1; j <= 12; j++) {
        const t = j / 12, u = 1 - t
        result.push({ x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * end.x,
          y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * end.y })
      }
      current = end
    }
  }
  return resample(result)
}
function ellipse(x: number, y: number, rx: number, ry = rx): Point[] {
  return Array.from({ length: N }, (_, i) => {
    const t = i / N * Math.PI * 2
    return { x: x + Math.cos(t) * rx, y: y + Math.sin(t) * ry }
  })
}
export function roundedRect(r: Rect, radius: number): Point[] {
  const corners = [
    [r.x + r.width - radius, r.y + radius, -90],
    [r.x + r.width - radius, r.y + r.height - radius, 0],
    [r.x + radius, r.y + r.height - radius, 90],
    [r.x + radius, r.y + radius, 180]
  ]
  return resample(corners.flatMap(([x, y, start]) => Array.from({ length: 25 }, (_, i) => {
    const a = (start + i * 90 / 24) * Math.PI / 180
    return { x: x + radius * Math.cos(a), y: y + radius * Math.sin(a) }
  })))
}
export function contourBounds(points: Point[]): Rect {
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
function area(p: Point[]): number {
  return p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]; return sum + a.x * b.y - a.y * b.x }, 0)
}
/** Match winding and starting point; mirrored pets must never turn contours inside out. */
function align(source: Point[], target: Point[]): Point[] {
  const to = area(source) * area(target) < 0 ? [...target].reverse() : target
  const a = contourBounds(source), b = contourBounds(to)
  let best = 0, score = Infinity
  for (let offset = 0; offset < N; offset++) {
    let error = 0
    for (let i = 0; i < N; i += 4) {
      const p = source[i], q = to[(i + offset) % N]
      error += ((p.x - a.x) / (a.width || 1) - (q.x - b.x) / (b.width || 1)) ** 2
        + ((p.y - a.y) / (a.height || 1) - (q.y - b.y) / (b.height || 1)) ** 2
    }
    if (error < score) { score = error; best = offset }
  }
  return to.map((_, i) => to[(i + best) % N])
}
function rotate(p: Point, origin: Point, degrees: number): Point {
  const a = degrees * Math.PI / 180, x = p.x - origin.x, y = p.y - origin.y
  return { x: origin.x + x * Math.cos(a) - y * Math.sin(a), y: origin.y + x * Math.sin(a) + y * Math.cos(a) }
}
export function petPoint(p: Point, visual: PetVisual): Point {
  const q = rotate(p, SWAY_PIVOT, visual.sway)
  const r = rotate({ x: (q.x - ANCHOR.x) * visual.sx, y: (q.y - ANCHOR.y) * visual.sy }, { x: 0, y: 0 }, visual.rot)
  return { x: visual.x + r.x * visual.flip * visual.scale, y: visual.y + r.y * visual.scale }
}
const [outerD, mouthD] = BODY_D.split(/(?=M 180\.5)/)
const body = sampleArtwork(outerD), mouth = sampleArtwork(mouthD)
const tail = sampleArtwork(TAIL_D), eye = sampleArtwork(EYE_D)
const dot = ellipse(102.3, 84, 3.1), cheek = ellipse(116, 103, 7, 4.2).map(p => rotate(p, { x: 116, y: 103 }, 12))
function expressionEye(pet: PetVisual): Point[] {
  if (pet.expression === 'shock') return ellipse(90, 84, 7.5)
  if (pet.expression === 'happy' || pet.expression === 'sleepy') {
    const curve = Array.from({ length: 49 }, (_, i) => {
      const t = i / 48, happy = pet.expression === 'happy'
      return { x: 80 + 20 * t, y: (happy ? 88 : 82) + (happy ? -24 : 18) * t * (1 - t) }
    })
    return resample([...curve.map(p => ({ x: p.x, y: p.y - 2 })), ...curve.reverse().map(p => ({ x: p.x, y: p.y + 2 }))])
  }
  return eye.map(p => ({ x: p.x + pet.gx, y: 84 + (p.y - 84) * pet.blink + pet.gy }))
}
export function petSkin(pet: PetVisual): SkinFrame {
  const world = (points: Point[]): Point[] => points.map(p => petPoint(p, pet))
  return { body: world(body), mouth: world(mouth), tail: world(tail.map(p => rotate(p, TAIL_PIVOT, pet.tailAngle))),
    eye: world(expressionEye(pet)), dot: world(pet.expression === 'shock' ? ellipse(90, 84, 2.8) : dot.map(p => pet.expression !== 'normal'
      ? { x: 90, y: 84 } : { x: p.x + pet.gx, y: 84 + (p.y - 84) * pet.blink + pet.gy })),
    cheek: world(cheek), ink: 0, cheekOpacity: 0.28, dotWhite: pet.expression === 'shock' ? 0 : 1, bodyOpacity: 1, mouthFill: 0 }
}
export function panelSkin(panel: Rect): SkinFrame {
  return {
    body: roundedRect(panel, FORM_CONFIG.radius),
    mouth: roundedRect({ x: panel.x + FLOAT_FRAME_PAD, y: panel.y + FLOAT_HEADER_H,
      width: panel.width - FLOAT_FRAME_PAD * 2, height: panel.height - FLOAT_HEADER_H - FLOAT_PROMPTBAR_H - FLOAT_FRAME_PAD }, 2),
    tail: tail.map(p => ({ x: panel.x - 22 + p.x * 0.62, y: panel.y - 24 + p.y * 0.62 })),
    eye: eye.map(p => ({ x: panel.x + 12 + (p.x - 74) * 0.65, y: panel.y + 8 + (p.y - 69) * 0.65 })),
    dot: dot.map(p => ({ x: panel.x + 12 + (p.x - 74) * 0.65, y: panel.y + 8 + (p.y - 69) * 0.65 })),
    cheek: cheek.map(p => ({ x: panel.x + p.x, y: panel.y + p.y })), ink: 1, cheekOpacity: 0, dotWhite: 1, bodyOpacity: 1, mouthFill: 1
  }
}

/** 悬浮窗窗口矩形(屏幕坐标):面板左上角被 inset 让出给尾鳍装饰,窗口本体补回这段偏移 */
export function windowFromPanel(panel: Rect): Rect {
  return { x: panel.x - FLOAT_INSET.x, y: panel.y - FLOAT_INSET.y, width: FLOAT_WINDOW.width, height: FLOAT_WINDOW.height }
}

const parts = ['body', 'mouth', 'tail', 'eye', 'dot', 'cheek'] as const
/**
 * 截图外壳与普通外壳共用同一端点(面板圆角矩形玻璃壳):收起时快照铺在外壳之上,
 * 蓝色主体全程不透明垫底——融化中快照淡出是与不透明蓝鲸交叉淡化,而不是与桌面,
 * 否则面板内容会在透明窗口上变成半透明幽灵(逐帧可见桌面穿透,即"第二次起闪烁")。
 * 装饰尾鳍/眼睛沿用面板形态的真实位置:快照里同样的像素淡出后由外壳层无缝接管。
 */
export function createMorph(scene: FormScene): (progress: number) => SkinFrame {
  const start = petSkin(scene.pet), open = { ...start }
  open.body = body.map(p => petPoint({ x: 130 + (p.x - 130) * 1.07, y: 90 + (p.y - 90) * 1.11 }, scene.pet))
  open.mouth = align(start.mouth, ellipse(149, 104, 59, 47).map(p => petPoint(p, scene.pet)))
  const end = panelSkin(scene.panel)
  for (const part of parts) end[part] = align(open[part], end[part])
  return (progress) => {
    const ms = Math.max(0, Math.min(1, progress)) * FORM_CONFIG.durationMs
    const opening = smooth(ms / FORM_CONFIG.mouthMs)
    const growing = smooth((ms - FORM_CONFIG.mouthMs) / (FORM_CONFIG.durationMs - FORM_CONFIG.mouthMs))
    // 两段式收起:阶段A(growing 1→0.45)轮廓保持面板形状,快照内容在整块不透明蓝色面板内
    // 溶解;阶段B(0.45→0)轮廓整体收缩成鲸鱼,嘴部暗色填充随之淡出还原为镂空透底。
    // 若轮廓从第一帧就退让,面板顶带会在内容仍可见时瞬间透出桌面,观感即"闪烁";
    // 嘴部暗色填充同理必须撑满阶段A,否则内容区先于轮廓透出桌面。
    const geo = smooth(clamp01((growing - 0.45) / 0.55))
    const ink = smooth(clamp01((growing - 0.45) / 0.55))
    const result = {
      ink, cheekOpacity: 0.28 * (1 - geo), dotWhite: mix(start.dotWhite, 1, geo),
      bodyOpacity: 1, mouthFill: smooth(clamp01(growing / 0.45))
    } as SkinFrame
    for (const part of parts) result[part] = blend(blend(start[part], open[part], opening), end[part], geo)
    return result
  }
}
export function pathOf(points: Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ') + 'Z'
}
export function contains(points: Point[], p: Point): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function hitSkin(frame: SkinFrame, point: Point): boolean {
  return contains(frame.body, point) || contains(frame.tail, point)
}

/** Move the saved reverse path with a dragged panel, then keep the entire pet visible. */
export function relocateScene(scene: FormScene, panel: Rect, workarea: Rect): FormScene {
  const pet = { ...scene.pet, x: scene.pet.x + panel.x - scene.panel.x, y: scene.pet.y + panel.y - scene.panel.y }
  const skin = petSkin(pet), bounds = contourBounds([...skin.body, ...skin.tail])
  pet.x += Math.max(workarea.x, Math.min(bounds.x, workarea.x + workarea.width - bounds.width)) - bounds.x
  pet.y += Math.max(workarea.y, Math.min(bounds.y, workarea.y + workarea.height - bounds.height)) - bounds.y
  return { pet, panel, workarea }
}
