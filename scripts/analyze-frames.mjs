// 形态换形验证:逐帧亮度曲线 + 闪烁(突陷)帧检测,配合 grab-frames.ps1 的输出使用。
// 用法: node analyze-frames.mjs <frames目录> [--roi x,y,w,h] [--dip 12] [--white]
//   --roi   只统计帧内该矩形(帧坐标);默认整帧
//   --dip   亮度突陷判定阈值(默认 12):某帧比左右邻帧均值暗超过阈值即报闪烁候选
//   --white 额外输出白屏像素占比(min(RGB)>200,展开方向白屏加载检查用)
// 帧支持 24/32 位未压缩 BMP(截图默认)与 PNG(经 pngjs)。
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'

const args = process.argv.slice(2)
const dir = args[0]
if (!dir) { console.error('usage: node analyze-frames.mjs <dir> [--roi x,y,w,h] [--dip 12] [--white]'); process.exit(1) }
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt
}
const roi = (() => { const s = opt('roi', ''); return s ? s.split(',').map(Number) : null })()
const dip = Number(opt('dip', 12))
const wantWhite = args.includes('--white')

function decodeBmp(buf) {
  if (buf.toString('ascii', 0, 2) !== 'BM') return null
  const offset = buf.readUInt32LE(10)
  const width = buf.readInt32LE(18)
  const height = buf.readInt32LE(22)
  const bpp = buf.readUInt16LE(28)
  const compression = buf.readUInt32LE(30)
  if (compression !== 0 || (bpp !== 24 && bpp !== 32)) throw new Error(`unsupported bmp bpp=${bpp} compression=${compression}`)
  const bottomUp = height > 0
  const h = Math.abs(height)
  const bytes = bpp / 8
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4
  const px = (x, y) => {
    const row = bottomUp ? h - 1 - y : y
    const p = offset + row * rowSize + x * bytes
    return [buf[p + 2], buf[p + 1], buf[p]] // BGR -> RGB
  }
  return { width, height: h, px }
}

const files = readdirSync(dir).filter(f => /\.(bmp|png)$/i.test(f)).sort()
if (!files.length) { console.error(`no frames in ${dir}`); process.exit(1) }

let frame0
for (const f of files) {
  const buf = readFileSync(join(dir, f))
  if (f.toLowerCase().endsWith('.bmp')) frame0 = decodeBmp(buf)
  else { const png = PNG.sync.read(buf); frame0 = { width: png.width, height: png.height, px: (x, y) => { const p = (y * png.width + x) * 4; return [png.data[p], png.data[p + 1], png.data[p + 2]] } } }
  break
}
const [rx, ry, rw, rh] = roi ?? [0, 0, frame0.width, frame0.height]
const step = 4
const samples = []
for (let y = ry; y < ry + rh; y += step) for (let x = rx; x < rx + rw; x += step) samples.push([x, y])
console.log(`frames=${files.length} size=${frame0.width}x${frame0.height} roi=${rx},${ry},${rw},${rh} samples=${samples.length}`)

const brightness = []
const whites = []
for (const f of files) {
  const buf = readFileSync(join(dir, f))
  const img = f.toLowerCase().endsWith('.bmp') ? decodeBmp(buf)
    : (() => { const png = PNG.sync.read(buf); return { px: (x, y) => { const p = (y * png.width + x) * 4; return [png.data[p], png.data[p + 1], png.data[p + 2]] } } })()
  let sum = 0, white = 0
  for (const [x, y] of samples) {
    const [r, g, b] = img.px(x, y)
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (Math.min(r, g, b) > 200) white++
  }
  brightness.push(sum / samples.length)
  whites.push(white / samples.length)
}
brightness.forEach((b, i) => {
  const w = wantWhite ? ` white=${(whites[i] * 100).toFixed(1)}%` : ''
  console.log(`f${String(i).padStart(4, '0')} y=${b.toFixed(1)}${w}`)
})
const dips = []
for (let i = 1; i < brightness.length - 1; i++) {
  const avg = (brightness[i - 1] + brightness[i + 1]) / 2
  if (avg - brightness[i] > dip) dips.push(i)
}
console.log(dips.length ? `DIP candidates (flash?): ${dips.map(i => `f${String(i).padStart(4, '0')}`).join(' ')}` : 'no dip candidates')
