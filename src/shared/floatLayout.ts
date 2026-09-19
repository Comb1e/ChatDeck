import type { Rect } from './types'

/** 悬浮窗展开态尺寸(DIP) */
export const FLOAT_EXPANDED = { width: 360, height: 620 } as const
/** 悬浮窗折叠态(药丸)尺寸(DIP);高度 64 为 Windows 非可调窗口的系统最小高度 */
export const FLOAT_PILL = { width: 148, height: 64 } as const
/** 展开态头部高度:标题行 + 厂商切换条 */
export const FLOAT_HEADER_H = 84
/** 展开态底部提示词条高度 */
export const FLOAT_PROMPTBAR_H = 42
/** 玻璃边框留白:WebContentsView 不贴窗口圆角 */
export const FLOAT_FRAME_PAD = 10

/** 展开态聊天区矩形(相对窗口内容区,与 WebContentsView 子视图坐标一致) */
export function floatChatRect(): Rect {
  return {
    x: FLOAT_FRAME_PAD,
    y: FLOAT_HEADER_H,
    width: FLOAT_EXPANDED.width - FLOAT_FRAME_PAD * 2,
    height: FLOAT_EXPANDED.height - FLOAT_HEADER_H - FLOAT_PROMPTBAR_H - FLOAT_FRAME_PAD
  }
}

/** 提示词模式内容区矩形(占据头部以下全部区域) */
export function floatPromptsRect(): Rect {
  return {
    x: FLOAT_FRAME_PAD,
    y: FLOAT_HEADER_H,
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
