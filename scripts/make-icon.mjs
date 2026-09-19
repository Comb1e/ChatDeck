// 一次性脚本:生成 build/icon.ico(赤陶色圆角底 + 两个米白窗格,分屏意象)
// 纯像素数学绘制,无字体/无原生依赖;用法:node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PNG } from 'pngjs'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BG = [217, 119, 87] // #D97757
const PANE = [250, 249, 245] // #FAF9F5

/** 圆角矩形内测(SDF):qx/qy 为到圆角圆心的超出量 */
function inRoundRect(px, py, x, y, w, h, r) {
  const qx = Math.max(Math.abs(px - (x + w / 2)) - (w / 2 - r), 0)
  const qy = Math.max(Math.abs(py - (y + h / 2)) - (h / 2 - r), 0)
  return qx * qx + qy * qy <= r * r
}

/** 绘制 size×size 图标,3×3 超采样抗锯齿 */
function draw(size) {
  const png = new PNG({ width: size, height: size })
  const SS = 3
  const rBg = size * 0.22
  const m = size * 0.24
  const gap = size * 0.09
  const paneW = (size - 2 * m - gap) / 2
  const paneH = size * 0.44
  const py = (size - paneH) / 2
  const rPane = paneW * 0.22

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
          const inPane =
            inRoundRect(px, pyc, m, py, paneW, paneH, rPane) ||
            inRoundRect(px, pyc, m + paneW + gap, py, paneW, paneH, rPane)
          const color = inPane ? PANE : BG
          const alpha = inRoundRect(px, pyc, 0, 0, size, size, rBg) ? 255 : 0
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
console.log(`build/icon.ico 已生成(${sizes.length} 个尺寸,${ico.length} 字节)`)
