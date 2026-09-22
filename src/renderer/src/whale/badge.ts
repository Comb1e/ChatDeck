/**
 * 未读气泡(ChatDeck 胶水):鲸鱼头顶显示站点未读数,点击展开悬浮窗。
 * 药丸时代的未读红点在压缩形态下的等价物;位置每帧跟随鲸鱼姿态。
 */
import type { Pose } from './types'

let el: HTMLDivElement | null = null
let count = 0
let badgeVisible = true
// 气泡锚点(世界坐标):每帧由 syncBadge 更新,badgeHit 用同一份数据
const anchor = { x: 0, y: 0 }
let onExpand: () => void = () => {}

export function initBadge(expand: () => void): void {
  onExpand = expand
  el = document.createElement('div')
  el.id = 'whale-badge'
  el.style.display = 'none'
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    onExpand()
  })
  document.body.appendChild(el)
}

export function setUnread(n: number): void {
  count = Math.max(0, Math.round(n))
  if (el) el.textContent = count > 99 ? '99+' : String(count)
  applyVisibility()
}

/** 每帧同步:把气泡钉在鲸鱼头顶(鲸鱼不可见或无未读时隐藏) */
export function syncBadge(
  pose: Pose,
  whaleVisible: boolean,
  workarea: { width: number; height: number }
): void {
  if (!el) return
  const bx = pose.x + 26 * pose.flip
  const by = pose.y - 185
  anchor.x = Math.min(Math.max(bx, 26), workarea.width - 26)
  anchor.y = Math.max(by, 34)
  el.style.transform = `translate(${Math.round(anchor.x)}px, ${Math.round(anchor.y)}px) translate(-50%, -100%)`
  badgeVisible = whaleVisible
  applyVisibility()
}

/** 命中测试(世界坐标):气包周围一块略大于视觉的矩形,便于点中 */
export function badgeHit(wx: number, wy: number): boolean {
  if (count <= 0 || !badgeVisible) return false
  return Math.abs(wx - anchor.x) < 30 && wy > anchor.y - 34 && wy < anchor.y + 10
}

function applyVisibility(): void {
  if (!el) return
  const want = count > 0 && badgeVisible
  el.style.display = want ? 'block' : 'none'
}
