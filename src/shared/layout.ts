import type { Rect } from './types'

export interface PaneSpec {
  id: string
  /** 相对权重，0~1，内部会归一化 */
  ratio: number
}

export interface ComputeRectsOptions {
  /** 窗格间留缝（HTML 分割条所在位置） */
  gap: number
  /** 单个窗格最小宽度；空间不足时退化为等分 */
  minPaneWidth: number
}

export interface PaneRect {
  id: string
  rect: Rect
}

/**
 * 水平分屏矩形计算（纯函数）。
 * - ratio 先按 [minRatio, 1] 夹取再归一化
 * - 若最小宽度之和超出可用空间（容器过小），退化为等分（min 约束无法满足时明确放弃而不是溢出）
 * - n=1 时窗格占满容器、无缝隙
 */
export function computeRects(
  container: Rect,
  panes: PaneSpec[],
  opts: ComputeRectsOptions = { gap: 8, minPaneWidth: 280 }
): PaneRect[] {
  const n = panes.length
  if (n === 0) return []
  if (!Number.isFinite(container.width) || container.width <= 0) {
    return panes.map((p) => ({ id: p.id, rect: { ...container, width: 0 } }))
  }
  if (n === 1) {
    return [{ id: panes[0].id, rect: { ...container } }]
  }

  const gapTotal = (n - 1) * Math.max(0, opts.gap)
  const flexWidth = Math.max(0, container.width - gapTotal)
  const minSum = n * Math.max(0, opts.minPaneWidth)

  let widths: number[]
  if (flexWidth <= 0 || minSum > flexWidth) {
    // 空间不足：等分可用宽度（不含缝隙），min 约束放弃
    widths = Array.from({ length: n }, () => flexWidth / n)
  } else {
    const minRatio = opts.minPaneWidth / flexWidth
    const clamped = panes.map((p) => {
      const r = Number.isFinite(p.ratio) ? Math.min(Math.max(p.ratio, minRatio), 1) : 1 / n
      return r
    })
    const sum = clamped.reduce((a, b) => a + b, 0)
    widths = clamped.map((r) => (r / sum) * flexWidth)
    // 归一化后可能仍有极小值低于 min（浮点），做一次投影修正
    const fixed = enforceMin(widths, opts.minPaneWidth, flexWidth)
    widths = fixed
  }

  const result: PaneRect[] = []
  let cursor = container.x
  for (let i = 0; i < n; i++) {
    result.push({
      id: panes[i].id,
      rect: { x: Math.round(cursor), y: container.y, width: Math.round(widths[i]), height: container.height }
    })
    cursor += widths[i] + (i < n - 1 ? Math.max(0, opts.gap) : 0)
  }
  return result
}

/** 保证每个宽度 ≥ min：先夹取，再把差值从仍高于 min 的窗格中按比例扣回 */
function enforceMin(widths: number[], min: number, total: number): number[] {
  const w = widths.slice()
  let deficit = 0
  for (let i = 0; i < w.length; i++) {
    if (w[i] < min) {
      deficit += min - w[i]
      w[i] = min
    }
  }
  if (deficit > 0) {
    const donors = w.map((x, i) => ({ x, i })).filter(({ x }) => x > min)
    const donorTotal = donors.reduce((a, { x }) => a + (x - min), 0)
    if (donorTotal >= deficit && donorTotal > 0) {
      for (const { x, i } of donors) {
        w[i] = x - (deficit * (x - min)) / donorTotal
      }
    } else {
      // 极端情况（min 总和超限，理论上不会走到）：等分兜底
      const equal = total / w.length
      return w.map(() => equal)
    }
  }
  return w
}

/**
 * 把 providerId 分配到第 index 个窗格（纯函数）。
 * 若该 provider 已在其他窗格 j，则两个窗格内容互换（同一个站点视图不能同时出现在两个窗格）。
 * index 越界或 panes 为空时原样返回拷贝。
 */
export function assignPane(panes: string[], index: number, providerId: string): string[] {
  const next = [...panes]
  if (index < 0 || index >= next.length || next[index] === providerId) return next
  const j = next.indexOf(providerId)
  if (j >= 0) {
    ;[next[index], next[j]] = [next[j], next[index]]
  } else {
    next[index] = providerId
  }
  return next
}

/**
 * 拖动分割条 i（位于窗格 i 与 i+1 之间）时的 ratio 调整（纯函数）。
 * dx 为分割条位移像素，flexWidth 为扣除缝隙后的可分宽度。
 * 保证两侧窗格都不小于 minPaneWidth。
 */
export function adjustRatios(
  ratios: number[],
  dividerIndex: number,
  dx: number,
  flexWidth: number,
  minPaneWidth: number
): number[] {
  const next = [...ratios]
  const i = dividerIndex
  if (i < 0 || i >= next.length - 1 || flexWidth <= 0) return next
  const min = minPaneWidth / flexWidth
  const a = next[i] + dx / flexWidth
  const b = next[i + 1] - dx / flexWidth
  if (a < min) {
    // 左侧顶到下限：把溢出部分还给右侧
    const overflow = min - a
    next[i] = min
    next[i + 1] = Math.max(min, b - overflow)
  } else if (b < min) {
    const overflow = min - b
    next[i + 1] = min
    next[i] = Math.max(min, a - overflow)
  } else {
    next[i] = a
    next[i + 1] = b
  }
  return next
}
