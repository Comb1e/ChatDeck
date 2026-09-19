/**
 * 通用深度合并：内置默认配置 + 用户覆盖层的统一合并策略。
 * 规则：
 * - 普通对象递归合并；数组与原始值整体替换（不按下标/键拼合）
 * - override 中的 undefined/null 字段跳过，不会清掉 base 的值
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined || override === null) return base
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T

  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || value === null) continue
    result[key] = isPlainObject(value) ? deepMerge(result[key], value) : value
  }
  return result as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface UserLayer {
  /** 对内置条目的覆盖（至少含 id，可只写要改的字段） */
  overrides?: Override[]
  /** 用户自定义条目 */
  custom?: Record<string, unknown>[]
  /** 用户删除的内置条目 id（针对可删除的数据，如提示词） */
  deletedIds?: string[]
}

/** 用户层条目的最小约束：必须带 id */
export type Override = Record<string, unknown> & { id: string }

export interface MergeResult<T extends { id: string }> {
  items: T[]
  /** 合并中被覆盖修改过的内置条目 id */
  overriddenIds: string[]
}

/**
 * 「默认列表 + 用户层」的统一合并：
 * - 内置条目按默认顺序输出，用户字段浅覆盖
 * - custom 附加在尾部
 * - deletedIds 中的内置条目被剔除
 * - 非法输入（非数组、条目缺 id）被忽略而不是抛错
 */
export function mergeWithUserLayer<B extends { id: string }>(
  defaults: B[],
  layer: UserLayer | undefined,
  mergeItem: (base: B, override: Record<string, unknown>) => B
): MergeResult<B> {
  const defaultsArr = Array.isArray(defaults) ? defaults : []
  const overrideMap = new Map<string, Override>()
  for (const o of validArray<Override>(layer?.overrides)) {
    if (typeof o.id === 'string') overrideMap.set(o.id, o)
  }
  const deleted = new Set(validArray(layer?.deletedIds).filter((x): x is string => typeof x === 'string'))

  const overriddenIds: string[] = []
  const items: B[] = []
  for (const base of defaultsArr) {
    if (deleted.has(base.id)) continue
    const override = overrideMap.get(base.id)
    if (override) {
      items.push(mergeItem(base, override))
      overriddenIds.push(base.id)
    } else {
      items.push(base)
    }
  }

  for (const c of validArray<Record<string, unknown>>(layer?.custom)) {
    if (typeof c.id === 'string' && c.id) {
      items.push(c as unknown as B)
    }
  }

  return { items, overriddenIds }
}

function validArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}
