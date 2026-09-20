import { describe, expect, it } from 'vitest'
import { canReload, shouldSleepNow, viewTransition, type ViewEvent } from '@shared/viewState'

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

describe('休眠状态转移', () => {
  it('sleep 使任意状态进入 sleeping', () => {
    for (const s of ['idle', 'loading', 'ready', 'failed', 'crashed'] as const) {
      expect(viewTransition(s, { type: 'sleep' })).toBe('sleeping')
    }
  })

  it('sleeping 后 attach 重建进入 loading', () => {
    expect(run('sleeping', [{ type: 'attach' }])).toBe('loading')
  })

  it('sleeping 下 load-success/reload 不改变状态（视图已销毁,事件不应越权）', () => {
    expect(viewTransition('sleeping', { type: 'load-success' })).toBe('sleeping')
    expect(viewTransition('sleeping', { type: 'reload' })).toBe('sleeping')
  })

  it('canReload(sleeping) 为 true（sleeping 非 loading,重载请求放行走重建分支）', () => {
    expect(canReload('sleeping')).toBe(true)
  })
})

describe('shouldSleepNow 休眠判定', () => {
  const now = 1_000_000

  it('可见永不休眠', () => {
    expect(shouldSleepNow(true, now - 10 * 60_000, now, 5 * 60_000)).toBe(false)
  })

  it('阈值为 0 表示永不休眠', () => {
    expect(shouldSleepNow(false, now - 10 * 60_000, now, 0)).toBe(false)
  })

  it('不可见且超过阈值 → 休眠', () => {
    expect(shouldSleepNow(false, now - 5 * 60_000 - 1, now, 5 * 60_000)).toBe(true)
  })

  it('不可见且恰好达到阈值 → 休眠（边界）', () => {
    expect(shouldSleepNow(false, now - 5 * 60_000, now, 5 * 60_000)).toBe(true)
  })

  it('不可见但未达阈值 → 不休眠', () => {
    expect(shouldSleepNow(false, now - 5 * 60_000 + 1, now, 5 * 60_000)).toBe(false)
  })
})
