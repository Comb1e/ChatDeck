import type { Rect } from './types'
import { FORM_CONFIG } from './formTransition'

/** 悬浮窗展开态尺寸(DIP);折叠(压缩)形态为独立鲸鱼窗口,不再有药丸尺寸 */
export const FLOAT_EXPANDED = { width: 360, height: 620 } as const
export const FLOAT_INSET = FORM_CONFIG.inset
export const FLOAT_WINDOW = { width: 384, height: 644 } as const
export function floatPanelRect(): Rect {
  return { ...FLOAT_INSET, ...FLOAT_EXPANDED }
}
export function panelFromWindow(bounds: Rect): Rect {
  return { x: bounds.x + FLOAT_INSET.x, y: bounds.y + FLOAT_INSET.y, ...FLOAT_EXPANDED }
}
/** 展开态头部高度:标题行 + 厂商切换条 */
export const FLOAT_HEADER_H = 84
/** 展开态底部提示词条高度 */
export const FLOAT_PROMPTBAR_H = 42
/** 玻璃边框留白:WebContentsView 不贴窗口圆角 */
export const FLOAT_FRAME_PAD = 10

/** 展开态聊天区矩形(相对窗口内容区,与 WebContentsView 子视图坐标一致) */
export function floatChatRect(): Rect {
  return {
    x: FLOAT_INSET.x + FLOAT_FRAME_PAD,
    y: FLOAT_INSET.y + FLOAT_HEADER_H,
    width: FLOAT_EXPANDED.width - FLOAT_FRAME_PAD * 2,
    height: FLOAT_EXPANDED.height - FLOAT_HEADER_H - FLOAT_PROMPTBAR_H - FLOAT_FRAME_PAD
  }
}

/** 提示词模式内容区矩形(占据头部以下全部区域) */
export function floatPromptsRect(): Rect {
  return {
    x: FLOAT_INSET.x + FLOAT_FRAME_PAD,
    y: FLOAT_INSET.y + FLOAT_HEADER_H,
    width: FLOAT_EXPANDED.width - FLOAT_FRAME_PAD * 2,
    height: FLOAT_EXPANDED.height - FLOAT_HEADER_H - FLOAT_FRAME_PAD
  }
}

/** 窗口完全落在工作区内的最小左上角坐标 */
export function clampPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  workArea: Rect
): { x: number; y: number } {
  const minX = workArea.x
  const maxX = workArea.x + workArea.width - width
  const minY = workArea.y
  const maxY = workArea.y + workArea.height - height
  return {
    x: Math.min(Math.max(x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(y, minY), Math.max(minY, maxY))
  }
}

/** 拖动越界时,左右上三边至少保留在工作区内的可见条带(DIP);足够抓取且不堵死跨屏拖动 */
export const DRAG_KEEP_VISIBLE = 8

/**
 * 手动拖动每帧的硬钳制(will-move 阶段,窗口尚未移动即拦截):
 * 底边完全不允许越过工作区底边(拖不进任务栏);左右上允许部分越界但保留可见条带。
 * 与 clampPoint 的区别:不要求窗口完全落在工作区内,只挡住"再也抓不回来"的方向。
 */
export function clampDragBounds(
  b: { x: number; y: number; width: number; height: number },
  workArea: Rect
): { x: number; y: number } {
  const minX = workArea.x + DRAG_KEEP_VISIBLE - b.width
  const maxX = workArea.x + workArea.width - DRAG_KEEP_VISIBLE
  const minY = workArea.y + DRAG_KEEP_VISIBLE - b.height
  const maxY = workArea.y + workArea.height - b.height
  return {
    x: Math.min(Math.max(b.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(b.y, minY), Math.max(minY, maxY))
  }
}
