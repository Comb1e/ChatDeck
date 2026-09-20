import { describe, expect, it } from 'vitest'
import {
  clampDragBounds,
  clampPoint,
  DRAG_KEEP_VISIBLE,
  FLOAT_EXPANDED,
  FLOAT_FRAME_PAD,
  FLOAT_HEADER_H,
  FLOAT_PROMPTBAR_H,
  floatChatRect,
  floatPromptsRect
} from '../src/shared/floatLayout'
import type { Rect } from '../src/shared/types'

const WORK: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
const WORK_OFFSET: Rect = { x: -1920, y: 0, width: 1920, height: 1040 }

describe('悬浮窗尺寸常量', () => {
  it('展开态能容纳头部与提示词条', () => {
    expect(FLOAT_HEADER_H + FLOAT_PROMPTBAR_H).toBeLessThan(FLOAT_EXPANDED.height)
  })
})

describe('floatChatRect:聊天区矩形与窗口边界留白', () => {
  const rect = floatChatRect()

  it('位于头部之下、提示词条之上', () => {
    expect(rect.y).toBe(FLOAT_HEADER_H)
    expect(rect.y + rect.height).toBe(FLOAT_EXPANDED.height - FLOAT_PROMPTBAR_H - FLOAT_FRAME_PAD)
  })

  it('左右各留玻璃边框留白(不贴窗口圆角)', () => {
    expect(rect.x).toBe(FLOAT_FRAME_PAD)
    expect(rect.x + rect.width).toBe(FLOAT_EXPANDED.width - FLOAT_FRAME_PAD)
  })

  it('宽高为正', () => {
    expect(rect.width).toBeGreaterThan(0)
    expect(rect.height).toBeGreaterThan(0)
  })
})

describe('floatPromptsRect:提示词模式占满头部以下', () => {
  const rect = floatPromptsRect()

  it('底边贴到下边框留白', () => {
    expect(rect.y).toBe(FLOAT_HEADER_H)
    expect(rect.y + rect.height).toBe(FLOAT_EXPANDED.height - FLOAT_FRAME_PAD)
  })

  it('比聊天区更高', () => {
    expect(rect.height).toBeGreaterThan(floatChatRect().height)
  })
})

describe('clampPoint:窗口完全落在工作区内', () => {
  const w = FLOAT_EXPANDED.width
  const h = FLOAT_EXPANDED.height

  it('界内位置不变', () => {
    expect(clampPoint(100, 200, w, h, WORK)).toEqual({ x: 100, y: 200 })
  })

  it('越界四边均被拉回', () => {
    expect(clampPoint(-50, -50, w, h, WORK)).toEqual({ x: 0, y: 0 })
    expect(clampPoint(WORK.width, WORK.height, w, h, WORK)).toEqual({
      x: WORK.width - w,
      y: WORK.height - h
    })
  })

  it('负坐标工作区(左侧副屏)同样正确', () => {
    const p = clampPoint(-3000, 5000, w, h, WORK_OFFSET)
    expect(p.x).toBe(WORK_OFFSET.x)
    expect(p.y).toBe(WORK_OFFSET.y + WORK_OFFSET.height - h)
  })

  it('单边放不下:超出方向夹到边缘,另一方向不受影响', () => {
    // 1080 宽在 1920 宽工作区内放得下 → x 保持;1860 高放不下 → y 夹到 0
    expect(clampPoint(500, 500, w * 3, h * 3, WORK)).toEqual({ x: 500, y: 0 })
  })

  it('双向都放不下时夹到工作区原点', () => {
    expect(clampPoint(500, 500, w * 6, h * 6, WORK)).toEqual({ x: 0, y: 0 })
  })
})

describe('clampDragBounds:拖动硬钳制(底边挡任务栏,其余保留可见条带)', () => {
  const W = 148
  const H = 64

  it('界内位置不变', () => {
    expect(clampDragBounds({ x: 500, y: 500, width: W, height: H }, WORK)).toEqual({ x: 500, y: 500 })
  })

  it('向下拖不进任务栏:窗口底边被钳在工作区底边', () => {
    const p = clampDragBounds({ x: 1000, y: 2000, width: W, height: H }, WORK)
    expect(p.y).toBe(WORK.height - H)
    expect(p.x).toBe(1000)
  })

  it('向上拖保留底部可见条带:窗口可部分越过工作区顶边', () => {
    const p = clampDragBounds({ x: 1000, y: -500, width: W, height: H }, WORK)
    expect(p.y).toBe(WORK.y + DRAG_KEEP_VISIBLE - H)
    // 底边留 8px 在工作区内,窗口仍可抓取
    expect(p.y + H).toBe(WORK.y + DRAG_KEEP_VISIBLE)
  })

  it('向左拖保留右侧可见条带:窗口可部分越出左边界(跨屏拖动不被堵死)', () => {
    const p = clampDragBounds({ x: -2000, y: 500, width: W, height: H }, WORK)
    expect(p.x).toBe(WORK.x + DRAG_KEEP_VISIBLE - W)
    expect(p.y).toBe(500)
  })

  it('负坐标工作区(左侧副屏)同样正确', () => {
    const p = clampDragBounds({ x: -4000, y: 5000, width: W, height: H }, WORK_OFFSET)
    expect(p.x).toBe(WORK_OFFSET.x + DRAG_KEEP_VISIBLE - W)
    expect(p.y).toBe(WORK_OFFSET.y + WORK_OFFSET.height - H)
  })

  it('展开态大窗口越界四边均受钳', () => {
    const ew = FLOAT_EXPANDED.width
    const eh = FLOAT_EXPANDED.height
    const p = clampDragBounds({ x: -9999, y: 9999, width: ew, height: eh }, WORK)
    expect(p.x).toBe(WORK.x + DRAG_KEEP_VISIBLE - ew)
    expect(p.y).toBe(WORK.y + WORK.height - eh)
  })

  it('窗口比工作区还大:区间退化时不反向,钳到边界', () => {
    const p = clampDragBounds({ x: 500, y: 500, width: W * 30, height: H * 30 }, WORK)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
    expect(p.x).toBeLessThanOrEqual(WORK.width - DRAG_KEEP_VISIBLE)
    expect(p.y).toBeLessThanOrEqual(WORK.height - H * 30)
  })
})
