/** 鲸鱼渲染层内部类型(移植自 whale-pet,与共享 Rect 对齐) */
import type { Rect } from '@shared/types'

/** 工作区矩形(与 Electron workArea 同构) */
export type Workarea = Rect

export interface XY {
  x: number
  y: number
}

/** 鲸鱼世界姿态:锚点(腹部底面中心)位置 + 形变/翻转 */
export interface Pose extends XY {
  rot: number
  sx: number
  sy: number
  flip: number
}

export interface Velocity {
  vx: number
  vy: number
}

/** 曲线求值输出:位置 + 一阶导(方向) */
export interface CurvePoint extends XY {
  dx: number
  dy: number
}
