import { describe, expect, it } from 'vitest'
import { adjustRatios, assignPane, computeRects } from '@shared/layout'

const CONTAINER = { x: 10, y: 20, width: 900, height: 600 }

describe('computeRects', () => {
  it('单窗格占满容器、无缝隙', () => {
    const r = computeRects(CONTAINER, [{ id: 'a', ratio: 1 }])
    expect(r).toEqual([{ id: 'a', rect: { x: 10, y: 20, width: 900, height: 600 } }])
  })

  it('等比两分：ratio 0.5/0.5 平分（扣除缝隙）', () => {
    const r = computeRects(CONTAINER, [
      { id: 'a', ratio: 0.5 },
      { id: 'b', ratio: 0.5 }
    ], { gap: 8, minPaneWidth: 280 })
    expect(r[0].rect.width + r[1].rect.width).toBe(900 - 8)
    expect(r[0].rect.x).toBe(10)
    // 右窗格起点 = 左宽 + 缝隙 + 容器 x
    expect(r[1].rect.x).toBe(10 + r[0].rect.width + 8)
    expect(r[1].rect.x + r[1].rect.width).toBe(910)
  })

  it('ratio 0 与 1 归一化后仍等分（两侧都顶到夹取下限）', () => {
    const r = computeRects(CONTAINER, [
      { id: 'a', ratio: 0 },
      { id: 'b', ratio: 1 }
    ], { gap: 8, minPaneWidth: 280 })
    expect(r[0].rect.width).toBeGreaterThanOrEqual(280)
    expect(r[1].rect.width).toBeGreaterThanOrEqual(280)
    expect(r[0].rect.width + r[1].rect.width).toBe(892)
  })

  it('ratio 0.7:0.3 按比例分配', () => {
    const r = computeRects(CONTAINER, [
      { id: 'a', ratio: 0.7 },
      { id: 'b', ratio: 0.3 }
    ], { gap: 0, minPaneWidth: 0 })
    expect(r[0].rect.width / r[1].rect.width).toBeCloseTo(7 / 3)
  })

  it('容器过小（小于 min×3）退化为等分且不溢出', () => {
    const small = { x: 0, y: 0, width: 500, height: 400 }
    const r = computeRects(small, [
      { id: 'a', ratio: 0.8 },
      { id: 'b', ratio: 0.1 },
      { id: 'c', ratio: 0.1 }
    ], { gap: 8, minPaneWidth: 280 })
    const total = r.reduce((s, x) => s + x.rect.width, 0)
    // 整数舍入允许 ±窗格数 误差
    expect(total).toBeLessThanOrEqual(484)
    expect(total).toBeGreaterThan(460)
    for (const pane of r) {
      expect(pane.rect.x + pane.rect.width).toBeLessThanOrEqual(500)
    }
  })

  it('容器宽度为 0 时返回零宽矩形不崩溃', () => {
    const r = computeRects({ x: 0, y: 0, width: 0, height: 100 }, [
      { id: 'a', ratio: 1 },
      { id: 'b', ratio: 1 }
    ])
    expect(r.every((x) => x.rect.width === 0)).toBe(true)
  })

  it('空窗格返回空数组', () => {
    expect(computeRects(CONTAINER, [])).toEqual([])
  })

  it('NaN ratio 按等分处理', () => {
    const r = computeRects(CONTAINER, [
      { id: 'a', ratio: NaN },
      { id: 'b', ratio: NaN }
    ], { gap: 0, minPaneWidth: 0 })
    expect(r[0].rect.width).toBe(450)
    expect(r[1].rect.width).toBe(450)
  })
})

describe('assignPane', () => {
  it('分配到空位', () => {
    expect(assignPane(['a', 'b'], 1, 'c')).toEqual(['a', 'c'])
  })

  it('provider 已在其他窗格时互换（同一站点不能同时出现在两个窗格）', () => {
    expect(assignPane(['a', 'b', 'c'], 0, 'c')).toEqual(['c', 'b', 'a'])
  })

  it('分配到自身所在窗格时不变', () => {
    expect(assignPane(['a', 'b'], 0, 'a')).toEqual(['a', 'b'])
  })

  it('越界索引原样返回拷贝', () => {
    expect(assignPane(['a'], 5, 'b')).toEqual(['a'])
    expect(assignPane([], 0, 'b')).toEqual([])
  })
})

describe('adjustRatios', () => {
  it('按位移调整相邻两窗格', () => {
    const r = adjustRatios([0.5, 0.5], 0, 100, 1000, 100)
    expect(r[0]).toBeCloseTo(0.6)
    expect(r[1]).toBeCloseTo(0.4)
  })

  it('左窗格顶到最小宽度后不再变窄', () => {
    const r = adjustRatios([0.5, 0.5], 0, -900, 1000, 100)
    expect(r[0]).toBeCloseTo(0.1)
    expect(r[1]).toBeCloseTo(0.9)
  })

  it('右窗格顶到最小宽度后不再变窄', () => {
    const r = adjustRatios([0.5, 0.5], 0, 900, 1000, 100)
    expect(r[0]).toBeCloseTo(0.9)
    expect(r[1]).toBeCloseTo(0.1)
  })

  it('非法分割条索引原样返回', () => {
    expect(adjustRatios([0.5, 0.5], 1, 10, 1000, 100)).toEqual([0.5, 0.5])
    expect(adjustRatios([0.5], 0, 10, 1000, 100)).toEqual([0.5])
  })
})
