/**
 * 系统监控纯逻辑——余额卡片底部监控行的数据类型、nvidia-smi 输出解析、
 * CPU 时间片增量计算与展示格式化。主进程与渲染层共用，无 Node/Electron 依赖。
 */

/** 独立显卡采样（数据源 nvidia-smi；utilization 0-100，显存单位 MiB） */
export interface GpuStats {
  name: string
  utilPercent: number
  vramUsedMb: number
  vramTotalMb: number
}

/** 系统监控快照（余额卡片底部展示） */
export interface SystemStats {
  /** 全机 CPU 占用；null=首次采样尚无增量基准 */
  cpuPercent: number | null
  memUsedBytes: number
  memTotalBytes: number
  /** null=无可用显卡数据源（未装 NVIDIA 驱动 / nvidia-smi 不可达） */
  gpu: GpuStats | null
}

/** os.cpus() 单核时间片（只取计算所需字段，便于测试注入） */
export interface RawCpuTimes {
  times: { user: number; nice: number; sys: number; idle: number; irq: number }
}

/** 一次采样内全部核心的累计时间片 */
export interface CpuSample {
  idle: number
  total: number
}

export function sumCpuTimes(cpus: readonly RawCpuTimes[]): CpuSample {
  let idle = 0
  let total = 0
  for (const c of cpus) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}

export function clampPercent(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(100, Math.max(0, v))
}

/**
 * 两次采样间的 CPU 占用率（%）。总时间片没有增量，或任一维度出现负增量
 * （计数器被重置、休眠恢复），都无法得出可信占用，返回 null。
 */
export function cpuUsagePercent(prev: CpuSample, next: CpuSample): number | null {
  const idleDelta = next.idle - prev.idle
  const totalDelta = next.total - prev.total
  if (totalDelta <= 0 || idleDelta < 0) return null
  return clampPercent((1 - idleDelta / totalDelta) * 100)
}

/**
 * 解析 nvidia-smi CSV 输出（--query-gpu=name,utilization.gpu,memory.used,memory.total
 * --format=csv,noheader,nounits），取第一块 GPU。名称可能含逗号（CSV 会加引号），
 * 因此从行尾匹配最后三个数字字段，其余部分整体视作名称。
 */
export function parseNvidiaSmi(output: string): GpuStats | null {
  const line = output.split(/\r?\n/).find((l) => l.trim() !== '')
  if (!line) return null
  const m = line.match(/,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*$/)
  if (!m) return null
  const name = line.slice(0, m.index).trim().replace(/^"|"$/g, '')
  const vramUsedMb = Number(m[2])
  const vramTotalMb = Number(m[3])
  if (!name || !(vramTotalMb > 0)) return null
  return { name, utilPercent: clampPercent(Number(m[1])), vramUsedMb, vramTotalMb }
}

// ---------- 展示格式化（渲染层） ----------

/** 占用率文本；null/无效显示占位符 */
export function formatStatPercent(v: number | null): string {
  return v == null || !Number.isFinite(v) ? '—' : `${Math.round(v)}%`
}

function gib(bytes: number): string {
  return (bytes / 2 ** 30).toFixed(1)
}

function validPair(used: number, total: number): boolean {
  return [used, total].every((v) => Number.isFinite(v) && v >= 0) && total > 0
}

/** 内存占用文本（字节 → "12.3 / 32.0 GB"）；无效显示占位符 */
export function formatMemPair(usedBytes: number, totalBytes: number): string {
  return validPair(usedBytes, totalBytes)
    ? `${gib(usedBytes)} / ${gib(totalBytes)} GB`
    : '—'
}

/** 显存占用文本（MiB → "0.5 / 8.0 GB"）；无效显示占位符 */
export function formatVramPair(usedMb: number, totalMb: number): string {
  return validPair(usedMb, totalMb)
    ? `${(usedMb / 1024).toFixed(1)} / ${(totalMb / 1024).toFixed(1)} GB`
    : '—'
}

/** 占用百分比（used/total × 100）；无效输入返回 null */
export function usagePercent(used: number, total: number): number | null {
  if (![used, total].every((v) => Number.isFinite(v) && v >= 0) || total <= 0) return null
  return clampPercent((used / total) * 100)
}

/** 收起态胶囊速览行："CPU 22% · 内存 63% · GPU 45% · 显存 11%"（容量详情走悬停） */
export function formatPillStats(s: SystemStats): string {
  return [
    `CPU ${formatStatPercent(s.cpuPercent)}`,
    `内存 ${formatStatPercent(usagePercent(s.memUsedBytes, s.memTotalBytes))}`,
    `GPU ${formatStatPercent(s.gpu?.utilPercent ?? null)}`,
    `显存 ${s.gpu ? formatStatPercent(usagePercent(s.gpu.vramUsedMb, s.gpu.vramTotalMb)) : '—'}`
  ].join(' · ')
}
