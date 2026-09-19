import { describe, expect, it } from 'vitest'
import { canReload, viewTransition, type ViewEvent } from '@shared/viewState'

function run(initial: Parameters<typeof viewTransition>[0], events: ViewEvent[]) {
  let state = initial
  for (const e of events) state = viewTransition(state, e)
  return state
}

describe('viewTransition 状态机', () => {
  it('正常路径：idle → loading → ready', () => {
    expect(run('idle', [{ type: 'attach' }, { type: 'load-success' }])).toBe('ready')
  })

  it('加载失败：idle → loading → failed', () => {
    expect(run('idle', [{ type: 'attach' }, { type: 'load-failed' }])).toBe('failed')
  })

  it('ready 状态下加载失败也进入 failed（站点内跳转失败）', () => {
    expect(run('ready', [{ type: 'load-failed' }])).toBe('failed')
  })

  it('failed 后 reload 重新进入 loading', () => {
    expect(run('failed', [{ type: 'reload' }])).toBe('loading')
  })

  it('crashed 后 reload 重新进入 loading', () => {
    expect(run('ready', [{ type: 'crash' }, { type: 'reload' }])).toBe('loading')
  })

  it('crash 从任意状态进入 crashed', () => {
    for (const s of ['idle', 'loading', 'ready', 'failed'] as const) {
      expect(viewTransition(s, { type: 'crash' })).toBe('crashed')
    }
  })

  it('detach 使任意状态回到 idle', () => {
    for (const s of ['loading', 'ready', 'failed', 'crashed'] as const) {
      expect(viewTransition(s, { type: 'detach' })).toBe('idle')
    }
  })

  it('load-success 只在 loading 状态生效（failed 下保持 failed）', () => {
    expect(viewTransition('failed', { type: 'load-success' })).toBe('failed')
    expect(viewTransition('idle', { type: 'load-success' })).toBe('idle')
  })

  it('ready 下 reload 不改变状态（避免重复加载竞态）', () => {
    expect(viewTransition('ready', { type: 'reload' })).toBe('ready')
  })

  it('loading 下再次 attach 不回退', () => {
    expect(viewTransition('loading', { type: 'attach' })).toBe('loading')
  })
})

describe('canReload', () => {
  it('loading 中不允许 reload', () => {
    expect(canReload('loading')).toBe(false)
  })

  it('其他状态允许 reload', () => {
    for (const s of ['idle', 'ready', 'failed', 'crashed'] as const) {
      expect(canReload(s)).toBe(true)
    }
  })
})
