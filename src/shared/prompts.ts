/** 预设提示词的占位符工具（纯函数） */

const PLACEHOLDER_RE = /\{([^{}\n]+)\}/g

/** 提取内容中的占位符名（按出现顺序去重），如「{内容}」→ ['内容'] */
export function extractPlaceholders(content: string): string[] {
  const out: string[] = []
  PLACEHOLDER_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = PLACEHOLDER_RE.exec(content)) !== null) {
    const name = m[1].trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** 用 values 渲染内容；缺失的占位符保留原文 */
export function renderContent(content: string, values: Record<string, string>): string {
  return content.replace(PLACEHOLDER_RE, (raw, name: string) => {
    const v = values[name.trim()]
    return v !== undefined && v !== '' ? v : raw
  })
}

/** 内容是否包含占位符 */
export function hasPlaceholders(content: string): boolean {
  return extractPlaceholders(content).length > 0
}
