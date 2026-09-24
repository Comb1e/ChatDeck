/**
 * 系统监控采样器——余额卡片底部监控行的数据面。
 * CPU：os.cpus() 两次采样间的时间片增量（渲染层 2s 轮询，增量跨轮询累计）；
 * GPU（独立显卡）：nvidia-smi 查询，可执行路径按常见安装位置探测并缓存，
 * 查询失败时短暂沿用上一次成功结果（单次抖动不闪占位符）。
 * 时钟/核心枚举/内存信息/GPU 查询经 deps 注入，采样策略本身可单测。
 */
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import os from 'node:os'
import type { CpuSample, GpuStats, RawCpuTimes, SystemStats } from '@shared/systemStats'
import { cpuUsagePercent, parseNvidiaSmi, sumCpuTimes } from '@shared/systemStats'

/** CPU 增量窗口下限：更近的调用复用上次占用（高频调用不会把增量切碎到不可信） */
const CPU_MIN_INTERVAL_MS = 800
/** GPU 查询失败后，该时长内沿用上一次成功结果 */
const GPU_LAST_GOOD_MS = 10_000
const SMI_TIMEOUT_MS = 2000

/** nvidia-smi 常见位置（驱动默认还会放进 System32，PATH 不一定有） */
const SMI_CANDIDATES = [
  'nvidia-smi',
  join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
  join('C:\\Program Files\\NVIDIA Corporation\\NVSMI', 'nvidia-smi.exe')
]

const SMI_ARGS = [
  '--query-gpu=name,utilization.gpu,memory.used,memory.total',
  '--format=csv,noheader,nounits'
]

export interface SystemMonitorDeps {
  now(): number
  listCpus(): RawCpuTimes[]
  memInfo(): { usedBytes: number; totalBytes: number }
  queryGpu(): Promise<GpuStats | null>
}

/** 依次探测候选路径，命中即缓存；全部失败按无显卡处理 */
function defaultQueryGpu(): () => Promise<GpuStats | null> {
  let cachedPath: string | null = null
  return async () => {
    for (const path of cachedPath ? [cachedPath] : SMI_CANDIDATES) {
      try {
        const stdout = await new Promise<string>((resolve, reject) => {
          execFile(path, SMI_ARGS, { timeout: SMI_TIMEOUT_MS, windowsHide: true }, (err, out) =>
            err ? reject(err) : resolve(String(out))
          )
        })
        const gpu = parseNvidiaSmi(stdout)
        if (gpu) {
          cachedPath = path
          return gpu
        }
      } catch {
        // 换下一个候选路径
      }
    }
    return null
  }
}

function defaultDeps(): SystemMonitorDeps {
  return {
    now: () => Date.now(),
    listCpus: () => os.cpus(),
    memInfo: () => ({ usedBytes: os.totalmem() - os.freemem(), totalBytes: os.totalmem() }),
    queryGpu: defaultQueryGpu()
  }
}

export class SystemMonitor {
  private lastCpu: CpuSample | null = null
  private lastCpuAt = 0
  private cpuPercent: number | null = null
  private lastGpu: GpuStats | null = null
  private lastGpuAt = 0
  private pending: Promise<SystemStats> | null = null

  constructor(private readonly deps: SystemMonitorDeps) {}

  /** 当前系统快照；并发调用合并为同一次采样 */
  snapshot(): Promise<SystemStats> {
    if (!this.pending) {
      this.pending = this.sample().finally(() => {
        this.pending = null
      })
    }
    return this.pending
  }

  private async sample(): Promise<SystemStats> {
    const { now, listCpus, memInfo, queryGpu } = this.deps
    const t = now()
    const next = sumCpuTimes(listCpus())
    if (!this.lastCpu) {
      this.lastCpu = next
      this.lastCpuAt = t
    } else if (t - this.lastCpuAt >= CPU_MIN_INTERVAL_MS) {
      const pct = cpuUsagePercent(this.lastCpu, next)
      if (pct != null) this.cpuPercent = pct
      // 增量不可信（计数器重置）也要推进基准，否则坏样本会一直参与计算
      this.lastCpu = next
      this.lastCpuAt = t
    }
    const gpu = await queryGpu()
    if (gpu) {
      this.lastGpu = gpu
      this.lastGpuAt = t
    } else if (!this.lastGpu || t - this.lastGpuAt > GPU_LAST_GOOD_MS) {
      this.lastGpu = null
    }
    const mem = memInfo()
    return {
      cpuPercent: this.cpuPercent,
      memUsedBytes: mem.usedBytes,
      memTotalBytes: mem.totalBytes,
      gpu: this.lastGpu
    }
  }
}

export function createSystemMonitor(): SystemMonitor {
  return new SystemMonitor(defaultDeps())
}
