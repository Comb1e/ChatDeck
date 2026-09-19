import { describe, expect, it } from 'vitest'
import { deepMerge, mergeWithUserLayer } from '@shared/merge'

describe('deepMerge', () => {
  it('普通对象递归合并', () => {
    const base = { a: 1, b: { c: 2, d: 3 } }
    expect(deepMerge(base, { b: { c: 9 } })).toEqual({ a: 1, b: { c: 9, d: 3 } })
  })

  it('数组整体替换而非拼接', () => {
    expect(deepMerge({ list: [1, 2, 3] }, { list: [9] })).toEqual({ list: [9] })
  })

  it('override 中 undefined/null 跳过，不清空 base', () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: undefined, b: null })).toEqual({ a: 1, b: 2 })
  })

  it('override 为 null/undefined 时返回 base', () => {
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 })
    expect(deepMerge({ a: 1 }, null)).toEqual({ a: 1 })
  })

  it('原始值整体替换', () => {
    expect(deepMerge({ a: 1 }, { a: 'x' })).toEqual({ a: 'x' })
  })

  it('不修改 base 对象', () => {
    const base = { a: { b: 1 } }
    deepMerge(base, { a: { b: 2 } })
    expect(base.a.b).toBe(1)
  })
})

interface Item {
  id: string
  name: string
  enabled: boolean
}

describe('mergeWithUserLayer', () => {
  const defaults: Item[] = [
    { id: 'a', name: 'A', enabled: true },
    { id: 'b', name: 'B', enabled: true }
  ]
  const mergeItem = (base: Item, o: Record<string, unknown>): Item => ({
    ...base,
    enabled: typeof o.enabled === 'boolean' ? o.enabled : base.enabled,
    name: typeof o.name === 'string' ? o.name : base.name
  })

  it('无用户层时原样输出', () => {
    const r = mergeWithUserLayer(defaults, undefined, mergeItem)
    expect(r.items).toEqual(defaults)
    expect(r.overriddenIds).toEqual([])
  })

  it('覆盖内置条目字段', () => {
    const r = mergeWithUserLayer(defaults, { overrides: [{ id: 'a', enabled: false }] }, mergeItem)
    expect(r.items[0].enabled).toBe(false)
    expect(r.items[1].enabled).toBe(true)
    expect(r.overriddenIds).toEqual(['a'])
  })

  it('custom 附加在尾部', () => {
    const r = mergeWithUserLayer(
      defaults,
      { custom: [{ id: 'c1', name: 'C', enabled: true }] },
      mergeItem
    )
    expect(r.items.map((x) => x.id)).toEqual(['a', 'b', 'c1'])
  })

  it('deletedIds 剔除内置条目', () => {
    const r = mergeWithUserLayer(defaults, { deletedIds: ['b'] }, mergeItem)
    expect(r.items.map((x) => x.id)).toEqual(['a'])
  })

  it('非法输入被忽略而不抛错', () => {
    const r = mergeWithUserLayer(
      defaults,
      {
        overrides: [{ name: 'no-id' }, 'junk'] as unknown as Array<{ id: string }>,
        custom: [{}, 42] as unknown as Array<Record<string, unknown>>
      },
      mergeItem
    )
    expect(r.items.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('defaults 非数组时安全返回空', () => {
    const r = mergeWithUserLayer(
      null as unknown as Item[],
      undefined,
      mergeItem
    )
    expect(r.items).toEqual([])
  })
})
