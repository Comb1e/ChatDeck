/**
 * 余额站点顺序调整测试:store.moveSite 的交换/边界/持久化,以及
 * scheduler.moveSite 的快照重排与未知 id 反例。全程临时配置文件。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BalanceStore } from '../src/main/balance/store'
import { BalanceScheduler } from '../src/main/balance/scheduler'
import { UsageStore } from '../src/main/balance/usage'

let tmpDir = ''
let tmpConfig = ''

function site(id: string): Record<string, unknown> {
  return {
    id,
    type: 'sub2api',
    label: id.toUpperCase(),
    icon: 'openai',
    apiBaseUrl: `https://${id}.example.com/api`,
    usageUrl: '',
    accessToken: '',
    refreshToken: '',
    enabled: true
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'chatdeck-balance-move-'))
  tmpConfig = join(tmpDir, 'balance.user.json')
  writeFileSync(
    tmpConfig,
    JSON.stringify({
      refreshIntervalMinutes: 5,
      window: { x: null, y: null, visible: false },
      sites: [site('a'), site('b'), site('c')]
    })
  )
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function freshStore(): BalanceStore {
  return new BalanceStore(tmpConfig)
}

describe('BalanceStore.moveSite', () => {
  it('中间站点上移/与相邻站点交换位置', () => {
    const store = freshStore()
    expect(store.moveSite('b', -1).map((s) => s.id)).toEqual(['b', 'a', 'c'])
    // c 从末位上移一格,与 a 交换
    expect(store.moveSite('c', -1).map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })
  it('边界反例:首个上移/末个下移原样返回,不写盘', () => {
    const store = freshStore()
    expect(store.moveSite('a', -1).map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(store.moveSite('c', 1).map((s) => s.id)).toEqual(['a', 'b', 'c'])
    // 未写盘:新实例读到的仍是原序
    expect(freshStore().getSites().map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })
  it('未知 id 原样返回', () => {
    const store = freshStore()
    expect(store.moveSite('ghost', -1).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })
  it('顺序持久化:重开实例读到的就是新序', () => {
    freshStore().moveSite('c', -1) // → a, c, b
    expect(freshStore().getSites().map((s) => s.id)).toEqual(['a', 'c', 'b'])
  })
  it('单站点时移动是无操作', () => {
    writeFileSync(
      tmpConfig,
      JSON.stringify({
        refreshIntervalMinutes: 5,
        window: { x: null, y: null, visible: false },
        sites: [site('only')]
      })
    )
    expect(freshStore().moveSite('only', 1).map((s) => s.id)).toEqual(['only'])
  })
})

describe('BalanceScheduler.moveSite', () => {
  it('重排后立即反映进快照(胶囊/列表顺序跟随),返回 ok=true', async () => {
    const scheduler = new BalanceScheduler(freshStore(), new UsageStore(join(tmpDir, 'usage.json')))
    expect((await scheduler.moveSite('b', -1)).ok).toBe(true)
    expect(scheduler.snapshot().sites.map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })
  it('未知 id 返回 ok=false,快照不受影响', async () => {
    const scheduler = new BalanceScheduler(freshStore(), new UsageStore(join(tmpDir, 'usage.json')))
    await scheduler.moveSite('b', -1) // 先同步一次状态列表(未知 id 路径不重排)
    expect((await scheduler.moveSite('ghost', -1)).ok).toBe(false)
    expect(scheduler.snapshot().sites.map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })
})
