import { describe, expect, it } from 'vitest'
import { SystemMonitor, type SystemMonitorDeps } from '../src/main/systemMonitor'
import type { GpuStats, RawCpuTimes } from '../src/shared/systemStats'

const RTX: GpuStats = {
  name: 'NVIDIA GeForce RTX 4070 Laptop GPU',
  utilPercent: 12,
  vramUsedMb: 471,
  vramTotalMb: 8188
}

/** cpu(idle, busy):sys 记 busy/2,核心总时间片 = 1.5*busy + idle */
function cpu(idle: number, busy: number): RawCpuTimes {
  return { times: { user: busy, nice: 0, sys: busy / 2, idle, irq: 0 } }
}

interface Harness {
  monitor: SystemMonitor
  setTime(ms: number): void
  setCpu(idle: number, busy: number): void
  setGpu(g: GpuStats | null): void
  gpuCalls(): number
}

function makeHarness(): Harness {
  let t = 0
  let cpus = [cpu(1000, 1000)]
  let gpu: GpuStats | null = null
  let calls = 0
  const deps: SystemMonitorDeps = {
    now: () => t,
    listCpus: () => cpus,
    memInfo: () => ({ usedBytes: 4 * 2 ** 30, totalBytes: 32 * 2 ** 30 }),
    queryGpu: () => {
      calls++
      return Promise.resolve(gpu)
    }
  }
  return {
    monitor: new SystemMonitor(deps),
    setTime: (ms) => (t = ms),
    setCpu: (idle, busy) => (cpus = [cpu(idle, busy)]),
    setGpu: (g) => (gpu = g),
    gpuCalls: () => calls
  }
}

describe('SystemMonitor 采样策略', () => {
  it('首次 CPU 无基准为 null,增量窗口达到下限后计算占用', async () => {
    const h = makeHarness()
    expect((await h.monitor.snapshot()).cpuPercent).toBeNull()
    h.setTime(2000)
    h.setCpu(1100, 1100) // idle+100,total+250 → 60%
    expect((await h.monitor.snapshot()).cpuPercent).toBe(60)
  })

  it('增量窗口过近时复用上次占用,基准不推进', async () => {
    const h = makeHarness()
    await h.monitor.snapshot()
    h.setTime(2000)
    h.setCpu(1100, 1100) // idle+100,total+250 → 60%
    expect((await h.monitor.snapshot()).cpuPercent).toBe(60)
    h.setTime(2100)
    h.setCpu(1200, 1400) // 窗口过近:复用 60%,这份样本不能成为新基准
    expect((await h.monitor.snapshot()).cpuPercent).toBe(60)
    h.setTime(5000)
    h.setCpu(1200, 1400) // 基准仍是 t=2000 样本:idle+100,total+550 → 81.82%
    expect((await h.monitor.snapshot()).cpuPercent).toBeCloseTo(81.82, 1)
  })

  it('GPU 查询失败时在窗口期内沿用上次成功结果,超窗后置空', async () => {
    const h = makeHarness()
    h.setTime(2000)
    h.setGpu(RTX)
    expect((await h.monitor.snapshot()).gpu).toEqual(RTX)
    h.setTime(2100)
    h.setGpu(null)
    expect((await h.monitor.snapshot()).gpu).toEqual(RTX)
    h.setTime(12_100) // 距上次成功 >10s
    expect((await h.monitor.snapshot()).gpu).toBeNull()
  })

  it('并发 snapshot 合并为一次采样', async () => {
    const h = makeHarness()
    h.setGpu(RTX)
    const [a, b] = [h.monitor.snapshot(), h.monitor.snapshot()]
    expect(h.gpuCalls()).toBe(1)
    expect(await b).toBe(await a)
  })

  it('内存信息原样透传', async () => {
    const h = makeHarness()
    const s = await h.monitor.snapshot()
    expect(s.memUsedBytes).toBe(4 * 2 ** 30)
    expect(s.memTotalBytes).toBe(32 * 2 ** 30)
  })
})
