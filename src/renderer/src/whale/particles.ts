/**
 * 通用 2D 粒子系统(水花/涟漪/气泡/Zzz/爱心)——移植自 whale-pet src/particles.js。
 * 性能要点:
 * - 粒子对象池:spawn 复用死亡粒子对象,死亡时归还(update 原地压缩);
 * - 画布尺寸在 resize() 缓存,渲染帧不再读 clientWidth;
 * - 无存活粒子时跳过 clear/绘制(脏标记保证最后一帧内容被清掉);
 * - 每粒子直接设 globalAlpha(无 save/restore),zzz 字体串按字号缓存。
 */
import { WHALE_CONFIG } from '@shared/whaleConfig'

type ParticleType = 'drop' | 'ripple' | 'bubble' | 'zzz' | 'heart'

interface Particle {
  type: ParticleType
  age: number
  delay: number
  x: number
  y: number
  x0: number
  y0: number
  vx: number
  vy: number
  vx0: number
  vy0: number
  g: number
  size: number
  grow: number
  ttl: number
  color: string
  wob: number
}

const DEFAULTS: Particle = {
  type: 'drop',
  age: 0,
  delay: 0,
  x: 0,
  y: 0,
  x0: 0,
  y0: 0,
  vx: 0,
  vy: 0,
  vx0: 0,
  vy0: 0,
  g: 0,
  size: 4,
  grow: 0,
  ttl: 1000,
  color: '#9fc0ff',
  wob: 0
}

let canvas: HTMLCanvasElement | null = null
let ctx2d: CanvasRenderingContext2D | null = null
let parts: Particle[] = []
const pool: Particle[] = [] // 死亡粒子复用池
let dpr = 1
let cw = 0,
  ch = 0 // CSS 像素尺寸(resize 时缓存)
let ox = 0,
  oy = 0 // 取景窗口原点(世界坐标):绘制一律减去它
let dirty = false // 画布上是否有需要清除的残留内容
let lastFontPx = -1 // zzz 字号缓存
let wake: () => void = () => {}
let allocations = 0

function init(canvasEl: HTMLCanvasElement): void {
  canvas = canvasEl
  ctx2d = canvas.getContext('2d')
  resize()
}

function resize(): void {
  if (!canvas) return
  const nextDpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth,
    height = canvas.clientHeight
  const pixelsW = Math.round(width * nextDpr),
    pixelsH = Math.round(height * nextDpr)
  if (
    width === cw &&
    height === ch &&
    nextDpr === dpr &&
    canvas.width === pixelsW &&
    canvas.height === pixelsH
  )
    return
  dpr = nextDpr
  cw = width
  ch = height
  canvas.width = pixelsW
  canvas.height = pixelsH
  allocations++
  lastFontPx = -1
  dirty = true // 尺寸变化即清空
}

function spawn(p: Partial<Particle>): void {
  const o = (pool.pop() ?? {}) as Particle
  Object.assign(o, DEFAULTS, p)
  o.x0 = o.x
  o.y0 = o.y
  o.vx0 = o.vx
  o.vy0 = o.vy
  parts.push(o)
  wake()
}

/** 跟随窗口:取景原点变化后,已画内容全部错位,标脏强制下一帧清屏 */
function setOrigin(x: number, y: number): void {
  ox = x
  oy = y
  dirty = true
}

/** 窗口内边缘渐隐系数:距四边 <EDGE_FADE 像素时线性淡出 */
function edgeFade(wx: number, wy: number): number {
  const d = Math.min(wx, cw - wx, wy, ch - wy)
  const EDGE_FADE = WHALE_CONFIG.performance.particleEdgeFade || 30
  return d >= EDGE_FADE ? 1 : d <= 0 ? 0 : d / EDGE_FADE
}

/** 落水水花:向上扇形水滴 + 涟漪 */
function splash(x: number, y: number, n = 20): void {
  const colors = ['#8fb5ff', '#bcd4ff', '#6f97ff']
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.7
    const sp = 220 + Math.random() * 380
    spawn({
      type: 'drop',
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      g: 1400,
      size: 2 + Math.random() * 4,
      ttl: 700 + Math.random() * 500,
      color: colors[i % colors.length]
    })
  }
  ripple(x, y)
}

function ripple(x: number, y: number): void {
  spawn({ type: 'ripple', x, y, size: 6, grow: 95, ttl: 700, color: 'rgba(143,181,255,0.9)' })
  spawn({
    type: 'ripple',
    x,
    y,
    size: 2,
    grow: 60,
    ttl: 900,
    color: 'rgba(143,181,255,0.7)',
    delay: 130
  })
}

/** 浮出水面:向上小水滴 */
function surface(x: number, y: number, n = 14): void {
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.2
    const sp = 150 + Math.random() * 260
    spawn({
      type: 'drop',
      x: x + (Math.random() - 0.5) * 70,
      y: y + 10,
      vx: Math.cos(a) * sp * 0.6,
      vy: Math.sin(a) * sp,
      g: 1300,
      size: 2 + Math.random() * 3.5,
      ttl: 600 + Math.random() * 400,
      color: '#bcd4ff'
    })
  }
  ripple(x, y)
}

function bubble(x: number, y: number): void {
  spawn({
    type: 'bubble',
    x: x + (Math.random() - 0.5) * 30,
    y,
    vy: -60 - Math.random() * 50,
    size: 2 + Math.random() * 4,
    ttl: 1400 + Math.random() * 800,
    wob: Math.random() * Math.PI * 2
  })
}

function zzz(x: number, y: number): void {
  spawn({
    type: 'zzz',
    x: x + (Math.random() - 0.5) * 8,
    y,
    vx: 12,
    vy: -30,
    size: Math.round(13 + Math.random() * 7), // 整数字号:字体串缓存可跨粒子命中
    ttl: 2200,
    wob: Math.random() * 6
  })
}

function hearts(x: number, y: number): void {
  for (let i = 0; i < 4; i++) {
    spawn({
      type: 'heart',
      x: x + (Math.random() - 0.5) * 50,
      y: y - 20 - Math.random() * 20,
      vx: (Math.random() - 0.5) * 30,
      vy: -55 - Math.random() * 30,
      size: 8 + Math.random() * 6,
      ttl: 1300,
      delay: i * 130
    })
  }
}

function update(dt: number): void {
  let w = 0 // 原地压缩:存活前移,死亡归还对象池
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    p.age += dt
    if (p.age >= p.delay + p.ttl) {
      if (pool.length < (WHALE_CONFIG.performance.particlePoolLimit || 128)) pool.push(p)
      continue
    }
    if (p.age >= p.delay) {
      const elapsed = p.age - p.delay
      const s = elapsed / 1000
      if (p.type === 'drop' || p.type === 'heart') {
        p.vy = p.vy0 + p.g * s
        p.x = p.x0 + p.vx0 * s
        // 与原始半隐式 60Hz 步进完全一致的轨迹
        p.y = p.y0 + p.vy0 * s + 0.5 * p.g * (s * s + s / 60)
      } else if (p.type === 'bubble') {
        p.y = p.y0 + p.vy0 * s
        p.x = p.x0 + 0.45 * 60 * 0.28 * (Math.cos(p.wob) - Math.cos(elapsed / 280 + p.wob))
      } else if (p.type === 'zzz') {
        p.y = p.y0 + p.vy0 * s
        p.x = p.x0 + p.vx0 * s + 14 * 0.26 * (Math.cos(p.wob) - Math.cos(elapsed / 260 + p.wob))
      }
    }
    parts[w++] = p
  }
  parts.length = w
}

function drawHeart(c: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  c.beginPath()
  c.moveTo(x, y + s * 0.35)
  c.bezierCurveTo(x - s, y - s * 0.3, x - s * 0.5, y - s * 1.1, x, y - s * 0.4)
  c.bezierCurveTo(x + s * 0.5, y - s * 1.1, x + s, y - s * 0.3, x, y + s * 0.35)
  c.closePath()
}

function render(): void {
  if (!ctx2d) return
  if (parts.length === 0) {
    if (dirty) {
      // 最后一帧的收尾清屏,此后整段空闲期画布零操作
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx2d.clearRect(0, 0, cw, ch)
      dirty = false
    }
    return
  }
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx2d.clearRect(0, 0, cw, ch)
  ctx2d.globalAlpha = 1
  lastFontPx = -1
  for (const p of parts) {
    const age = p.age - p.delay
    if (age < 0) continue
    const k = Math.min(1, age / p.ttl)
    const wx = p.x - ox,
      wy = p.y - oy // 窗口内坐标(世界 − 取景原点)
    const ef = edgeFade(wx, wy)
    if (ef <= 0) continue
    if (p.type === 'drop') {
      ctx2d.globalAlpha = (1 - Math.max(0, (k - 0.55) / 0.45)) * ef
      ctx2d.fillStyle = p.color
      ctx2d.beginPath()
      ctx2d.arc(wx, wy, p.size, 0, Math.PI * 2)
      ctx2d.fill()
    } else if (p.type === 'ripple') {
      const r = p.size + p.grow * k
      ctx2d.globalAlpha = (1 - k) * ef
      ctx2d.strokeStyle = p.color
      ctx2d.lineWidth = 2 * (1 - k) + 0.5
      ctx2d.beginPath()
      ctx2d.ellipse(wx, wy, r, r * 0.32, 0, 0, Math.PI * 2)
      ctx2d.stroke()
    } else if (p.type === 'bubble') {
      ctx2d.globalAlpha = 0.8 * (1 - k) * ef
      ctx2d.strokeStyle = 'rgba(205,228,255,0.95)'
      ctx2d.lineWidth = 1.5
      ctx2d.beginPath()
      ctx2d.arc(wx, wy, p.size, 0, Math.PI * 2)
      ctx2d.stroke()
    } else if (p.type === 'zzz') {
      ctx2d.globalAlpha = (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85) * ef
      ctx2d.fillStyle = '#7f9bff'
      if (p.size !== lastFontPx) {
        ctx2d.font = `bold ${p.size}px "Segoe UI", sans-serif`
        lastFontPx = p.size
      }
      ctx2d.fillText('Z', wx, wy)
    } else if (p.type === 'heart') {
      ctx2d.globalAlpha = (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8) * ef
      ctx2d.fillStyle = '#ff8fb0'
      drawHeart(ctx2d, wx, wy, p.size)
      ctx2d.fill()
    }
  }
  dirty = true
}

interface FxStats {
  active: number
  pooled: number
  allocations: number
  bufferBytes: number
}

export const FX = {
  init,
  resize,
  setOrigin,
  update,
  render,
  splash,
  ripple,
  surface,
  bubble,
  zzz,
  hearts,
  setWake: (fn: () => void): void => {
    wake = fn
  },
  hasParticles: (): boolean => parts.length > 0,
  hasFastEffects: (): boolean => parts.some((p) => p.type !== 'zzz'),
  stats: (): FxStats => ({
    active: parts.length,
    pooled: pool.length,
    allocations,
    bufferBytes: canvas ? canvas.width * canvas.height * 4 : 0
  })
}
