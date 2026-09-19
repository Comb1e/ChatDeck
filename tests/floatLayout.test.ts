import { describe, expect, it } from 'vitest'
import {
  clampPoint,
  FLOAT_EXPANDED,
  FLOAT_FRAME_PAD,
  FLOAT_HEADER_H,
  FLOAT_PILL,
  FLOAT_PROMPTBAR_H,
  floatChatRect,
  floatPromptsRect
} from '../src/shared/floatLayout'
import type { Rect } from '../src/shared/types'

const WORK: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
const WORK_OFFSET: Rect = { x: -1920, y: 0, width: 1920, height: 1040 }

describe('悬浮窗尺寸常量', () => {
  it('折叠药丸小于展开态', () => {
    expect(FLOAT_PILL.width).toBeLessThan(FLOAT_EXPANDED.width)
    expect(FLOAT_PILL.height).toBeLessThan(FLOAT_EXPANDED.height)
  })

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
