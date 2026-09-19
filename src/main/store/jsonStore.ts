import { readFile, rename, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'

/** userData 目录下 JSON 配置的读写（原子写入：先写临时文件再 rename） */
export class JsonStore<T> {
  constructor(private fileName: string, private emptyValue: T) {}

  get path(): string {
    return join(app.getPath('userData'), this.fileName)
  }

  async load(): Promise<T> {
    try {
      const raw = await readFile(this.path, 'utf-8')
      return JSON.parse(raw) as T
    } catch {
      return this.emptyValue
    }
  }

  async save(value: T): Promise<void> {
    const target = this.path
    await mkdir(dirname(target), { recursive: true })
    const tmp = `${target}.tmp`
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8')
    // Windows 上 rename 目标存在时直接覆盖
    await rename(tmp, target)
  }
}

/** 内置默认配置资源路径（开发期取项目 resources/，打包后取 process.resourcesPath） */
export function resourceFile(name: string): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, name)
}

export async function readResourceJson<T>(name: string): Promise<T | null> {
  try {
    const raw = await readFile(resourceFile(name), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
