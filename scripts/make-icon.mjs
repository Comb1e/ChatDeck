// 一次性脚本:生成 build/icon.ico(ChatDeck 应用图标:深空圆底 + 单轨道双电子原子,蓝系渐变 + 辉光)
// 意象源自 Electron 默认运行时标识的"断口轨道 + 电子点":一条主轨道被两个断口分为两段弧,
// 断口处各有一颗电子(右上/左下对角),中心亮核;全部蓝系渐变,呼应应用暗色玻璃科幻风
// 纯像素数学绘制,无字体/无原生依赖;用法:node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PNG } from 'pngjs'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// 主轨道:rot=长轴旋转角(度);两个断口中心按"世界屏幕角"目标求解(atan2 y 向下:0=东,-90=北)
const MAIN = { rot: -25, a: 0.4, b: 0.13, w: 0.036, glowW: 0.036 * 3 }
const GAP_TARGETS = [-50, 130] // 右上、左下
const GAP_HALF = 17 // 断口半角(参数角,度):空间弧长 ≈ 2 倍电子直径,刚好容下电子
const R_ELEC = 0.038
const HALO_ELEC = R_ELEC * 2.3
const R_DOT = 0.06
const HALO_DOT = R_DOT * 2.2

const rad = (deg) => (deg * Math.PI) / 180
const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]
const clamp01 = (t) => Math.min(Math.max(t, 0), 1)

/** 轨道渐变:世界纵向 青蓝 → 蓝 → 蓝紫 */
function orbitGradient(py, size) {
  const t = clamp01(py / size)
  if (t < 0.5) return mix([168, 241, 255], [94, 156, 255], t * 2)
  return mix([94, 156, 255], [143, 123, 255], (t - 0.5) * 2)
}

/** 椭圆(中心原点,长轴 rot)参数角 t 的世界坐标 */
function pointAt(tDeg, size) {
  const lx = MAIN.a * size * Math.cos(rad(tDeg))
  const ly = MAIN.b * size * Math.sin(rad(tDeg))
  const r = rad(MAIN.rot)
  return {
    x: size / 2 + lx * Math.cos(r) - ly * Math.sin(r),
    y: size / 2 + lx * Math.sin(r) + ly * Math.cos(r)
  }
}

/** 点到主轨道曲线的近似像素距离(一阶展开;断口区间返回 Infinity) */
function mainRingDist(px, py, size, gaps) {
  const dx = px - size / 2
  const dy = py - size / 2
  const r = rad(-MAIN.rot)
  const u = dx * Math.cos(r) - dy * Math.sin(r)
  const v = dx * Math.sin(r) + dy * Math.cos(r)
  const q = (u * u) / (MAIN.a * MAIN.a * size * size) + (v * v) / (MAIN.b * MAIN.b * size * size)
  const grad = 2 * Math.hypot(u / (MAIN.a * MAIN.a * size * size), v / (MAIN.b * MAIN.b * size * size))
  let t = (Math.atan2(v / (MAIN.b * size), u / (MAIN.a * size)) * 180) / Math.PI
  if (t < 0) t += 360
  for (const g of gaps) {
    let d = Math.abs(t - g)
    if (d > 180) d = 360 - d
    if (d < GAP_HALF) return Infinity
  }
  return Math.abs(q - 1) / grad
}

/** 求主轨道上最接近目标世界角的参数角 */
function tForWorldAngle(targetDeg, size) {
  let best = 0
  let bestD = 999
  for (let t = 0; t < 360; t++) {
    const p = pointAt(t, size)
    const ang = (Math.atan2(p.y - size / 2, p.x - size / 2) * 180) / Math.PI
    let d = Math.abs(ang - targetDeg)
    if (d > 180) d = 360 - d
    if (d < bestD) {
      bestD = d
      best = t
    }
  }
  return best
}

/** 绘制 size×size 图标,3×3 超采样抗锯齿 */
function draw(size) {
  const png = new PNG({ width: size, height: size })
  const SS = 3
  const gaps = GAP_TARGETS.map((g) => tForWorldAngle(g, size))
  const electrons = gaps.map((g) => pointAt(g, size))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rAcc = 0
      let gAcc = 0
      let bAcc = 0
      let aAcc = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS
          const pyc = y + (sy + 0.5) / SS
          const dist = Math.hypot(px - size / 2, pyc - size / 2)
          let color = [0, 0, 0]
          let alpha = 0
          if (dist <= size * 0.5) {
            alpha = 255
            // 深空圆底:径向渐变(中心偏亮,边缘近黑)
            color = mix([42, 48, 62], [16, 18, 24], clamp01(dist / (size * 0.5)))
            // 主轨道辉光(平方衰减) → 主轨道
            const dRing = mainRingDist(px, pyc, size, gaps) // 像素
            const halfGlow = (MAIN.glowW * size) / 2
            if (dRing < halfGlow) {
              color = mix(color, [80, 150, 255], 0.22 * Math.pow(1 - dRing / halfGlow, 2))
            }
            if (dRing < (MAIN.w * size) / 2) color = orbitGradient(pyc, size)
            // 电子光晕(平方衰减) → 电子
            for (const e of electrons) {
              const de = Math.hypot(px - e.x, pyc - e.y)
              if (de <= HALO_ELEC * size) {
                const t =
                  de <= R_ELEC * size ? 1 : 0.5 * Math.pow(1 - (de - R_ELEC * size) / ((HALO_ELEC - R_ELEC) * size), 2)
                color = mix(color, [205, 240, 255], t)
              }
            }
            // 核光晕(平方衰减) → 核
            if (dist <= HALO_DOT * size) {
              const t =
                dist <= R_DOT * size ? 1 : 0.5 * Math.pow(1 - (dist - R_DOT * size) / ((HALO_DOT - R_DOT) * size), 2)
              color = mix(color, [130, 210, 255], t)
            }
          }
          // 预乘累加,避免边缘出现白色光晕
          rAcc += (color[0] / 255) * alpha
          gAcc += (color[1] / 255) * alpha
          bAcc += (color[2] / 255) * alpha
          aAcc += alpha
        }
      }
      const n = SS * SS
      const a = aAcc / n
      const idx = (size * y + x) << 2
      if (a > 0) {
        const cover = a / 255
        png.data[idx] = Math.round(rAcc / n / cover)
        png.data[idx + 1] = Math.round(gAcc / n / cover)
        png.data[idx + 2] = Math.round(bAcc / n / cover)
      } else {
        png.data[idx] = 0
        png.data[idx + 1] = 0
        png.data[idx + 2] = 0
      }
      png.data[idx + 3] = Math.round(a)
    }
  }
  return PNG.sync.write(png)
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngBuffers = sizes.map((s) => draw(s))
const ico = await pngToIco(pngBuffers)
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.ico'), ico)
writeFileSync(join(root, 'build', 'icon-256.png'), pngBuffers[pngBuffers.length - 1])
// 托盘图标:运行时经 resourceFile() 读取(打包由 extraResources to:"." 平铺到安装目录)
mkdirSync(join(root, 'resources'), { recursive: true })
writeFileSync(join(root, 'resources', 'tray.png'), draw(16))
writeFileSync(join(root, 'resources', 'tray@2x.png'), draw(32))
console.log(
  `build/icon.ico 已生成(${sizes.length} 个尺寸,${ico.length} 字节);resources/tray.png、tray@2x.png 已生成`
)
