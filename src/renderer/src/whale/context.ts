/** 应用层数据单例(自 whale-pet app.js 拆出,供 states/app 两侧共享,避免循环导入) */
import { InputSession } from './runtime'
import type { Velocity, Workarea, XY } from './types'

export const App = {
  workarea: { x: 0, y: 0, width: 1280, height: 720 } as Workarea,
  cursor: { x: -9999, y: -9999 } as XY,
  input: new InputSession(),
  dragVelocity: { vx: 0, vy: 0 } as Velocity,
  stateName: null as string | null,
  lastTeleportAt: 0,
  hovering: false,
  ready: false
}
