import { describe, expect, it } from 'vitest'
import {
  clampPercent,
  cpuUsagePercent,
  formatMemPair,
  formatStatPercent,
  formatVramPair,
  parseNvidiaSmi,
  sumCpuTimes
} from '../src/shared/systemStats'
import type { CpuSample } from '../src/shared/systemStats'

describe('sumCpuTimes', () => {
  it('累计全部核心的 idle 与总时间片', () => {
    const s = sumCpuTimes([
      { times: { user: 100, nice: 0, sys: 50, idle: 200, irq: 10 } },
      { times: { user: 20, nice: 5, sys: 5, idle: 70, irq: 0 } }
    ])
    expect(s.idle).toBe(270)
    expect(s.total).toBe(460)
  })
})

describe('cpuUsagePercent', () => {
  const prev: CpuSample = { idle: 100, total: 200 }
  it('按增量区间计算占用率', () => {
    expect(cpuUsagePercent(prev, { idle: 150, total: 300 })).toBe(50)
  })
  it('全忙为 100%', () => {
    expect(cpuUsagePercent({ idle: 0, total: 100 }, { idle: 0, total: 200 })).toBe(100)
  })
  it('总时间片无增量时不可信', () => {
    expect(cpuUsagePercent(prev, prev)).toBeNull()
  })
  it('负增量(计数器被重置/休眠恢复)时不可信', () => {
    expect(cpuUsagePercent(prev, { idle: 50, total: 300 })).toBeNull()
  })
})

describe('parseNvidiaSmi', () => {
  it('解析真实输出(本机样例)', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 4070 Laptop GPU, 0, 471, 8188\n')).toEqual({
      name: 'NVIDIA GeForce RTX 4070 Laptop GPU',
      utilPercent: 0,
      vramUsedMb: 471,
      vramTotalMb: 8188
    })
  })
  it('名称含逗号(CSV 引号包裹)时从行尾取数字字段', () => {
    expect(parseNvidiaSmi('"NVIDIA T600, rev a", 45, 1024, 8192')).toEqual({
      name: 'NVIDIA T600, rev a',
      utilPercent: 45,
      vramUsedMb: 1024,
      vramTotalMb: 8192
    })
  })
  it('多行输出取第一块 GPU,CRLF 兼容', () => {
    expect(parseNvidiaSmi('GPU A, 10, 1, 2\r\nGPU B, 20, 3, 4\r\n')?.name).toBe('GPU A')
  })
  it('小数利用率与超界钳制', () => {
    expect(parseNvidiaSmi('X, 45.5, 1, 2')?.utilPercent).toBe(45.5)
    expect(parseNvidiaSmi('X, 120, 1, 2')?.utilPercent).toBe(100)
  })
  it('空输出/无数字字段/显存总量为 0/空名称均为 null', () => {
    expect(parseNvidiaSmi('')).toBeNull()
    expect(parseNvidiaSmi('\n \n')).toBeNull()
    expect(parseNvidiaSmi('garbage')).toBeNull()
    expect(parseNvidiaSmi('N, 1, 2')).toBeNull()
    expect(parseNvidiaSmi('N, 0, 0, 0')).toBeNull()
    expect(parseNvidiaSmi(', 1, 2, 3')).toBeNull()
  })
})

describe('展示格式化', () => {
  it('formatStatPercent:null/NaN 显示占位符,数值取整', () => {
    expect(formatStatPercent(null)).toBe('—')
    expect(formatStatPercent(NaN)).toBe('—')
    expect(formatStatPercent(45.4)).toBe('45%')
    expect(formatStatPercent(0)).toBe('0%')
  })
  it('formatMemPair:字节 → GB 文本', () => {
    expect(formatMemPair(12.3 * 2 ** 30, 32 * 2 ** 30)).toBe('12.3 / 32.0 GB')
    expect(formatMemPair(0, 16 * 2 ** 30)).toBe('0.0 / 16.0 GB')
  })
  it('formatVramPair:MiB → GB 文本(真实样例 471/8188)', () => {
    expect(formatVramPair(471, 8188)).toBe('0.5 / 8.0 GB')
    expect(formatVramPair(0, 8188)).toBe('0.0 / 8.0 GB')
  })
  it('无效数值(总量为 0/负数/NaN)显示占位符', () => {
    expect(formatMemPair(NaN, 100)).toBe('—')
    expect(formatMemPair(-1, 100)).toBe('—')
    expect(formatMemPair(5, 0)).toBe('—')
    expect(formatVramPair(1, 0)).toBe('—')
  })
})

describe('clampPercent', () => {
  it('钳到 0-100,非有限值归 0', () => {
    expect(clampPercent(-5)).toBe(0)
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(42)).toBe(42)
    expect(clampPercent(NaN)).toBe(0)
  })
})
