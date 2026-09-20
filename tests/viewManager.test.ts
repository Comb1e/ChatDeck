import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import type { Provider } from '@shared/types'
import { ViewManager } from '../src/main/viewManager'

// ---- 最小 electron 替身:只覆盖 ViewManager 用到的表面 ----

const h = vi.hoisted(() => ({
  /** 按创建顺序记录每个视图的 webContents 替身 */
  created: [] as Array<{ loaded: string[]; closed: boolean }>
}))

vi.mock('electron', () => {
  class FakeWC {
    loaded: string[] = []
    closed = false
    on(): this {
      return this
    }
    loadURL(url: string): Promise<void> {
      this.loaded.push(url)
      return Promise.resolve()
    }
    loadFile(): Promise<void> {
      return Promise.resolve()
    }
    setUserAgent(): void {}
    setWindowOpenHandler(): void {}
    getURL(): string {
      return 'https://site/'
    }
    close(): void {
      this.closed = true
    }
    navigationHistory = { canGoBack: () => false, canGoForward: () => false }
  }
  class FakeView {
    webContents = new FakeWC()
    constructor() {
      h.created.push(this.webContents)
    }
    setBounds(): void {}
    setBackgroundColor(): void {}
  }
  const sessions = new Map<string, { setUserAgent(): void; setPermissionRequestHandler(): void }>()
  return {
    app: { isPackaged: true },
    BrowserWindow: class {
      visible = true
      minimized = false
      handlers = new Map<string, Array<() => void>>()
      contentView = {
        addChildView: () => {},
        removeChildView: () => {}
      }
      on(ev: string, fn: () => void): void {
        const arr = this.handlers.get(ev) ?? []
        arr.push(fn)
        this.handlers.set(ev, arr)
      }
      emit(ev: string): void {
        for (const fn of this.handlers.get(ev) ?? []) fn()
      }
      isVisible(): boolean {
        return this.visible
      }
      isMinimized(): boolean {
        return this.minimized
      }
      isDestroyed(): boolean {
        return false
      }
    },
    WebContentsView: FakeView,
    session: {
      fromPartition: (name: string) => {
        let s = sessions.get(name)
        if (!s) {
          s = { setUserAgent() {}, setPermissionRequestHandler() {} }
          sessions.set(name, s)
        }
        return s
      }
    },
    shell: { openExternal: async () => {} }
  }
})

function makeProvider(id: string, autoSleepMinutes: number): Provider {
  return {
    id,
    name: id,
    url: `https://${id}/`,
    color: '#000000',
    enabled: true,
    builtin: false,
    autoSleepMinutes
  }
}

const FULL: Provider['autoSleepMinutes'] = 5
const rect = { x: 0, y: 0, width: 400, height: 300 }
const zero = { x: 0, y: 0, width: 0, height: 0 }

describe('ViewManager 后台休眠扫描', () => {
  let win: BrowserWindow
  let states: Array<{ id: string; state: string }>
  let manager: ViewManager

  beforeEach(() => {
    h.created.length = 0
    states = []
    manager = new ViewManager()
    manager.hook({
      onTitleChanged: () => {},
      onActiveChanged: () => {},
      onLoadStateChanged: (id, state) => states.push({ id, state })
    })
    win = new BrowserWindow() // electron 已被 mock,此即替身类
    manager.attachWindow(win)
  })

  it('可见视图刷新时间戳,永不休眠', () => {
    manager.registerProvider(makeProvider('a', FULL))
    const t0 = Date.now()
    manager.setLayout([{ id: 'a', rect }])
    manager.sweepSleep(t0 + 10 * 60_000)
    expect(manager.getReportedState('a')).toBe('loading') // 首次挂载加载中,未被休眠
  })

  it('detach 后超过站点阈值休眠;阈值 0 的站点(DeepSeek)永不休眠', () => {
    manager.registerProvider(makeProvider('a', FULL))
    manager.registerProvider(makeProvider('ds', 0))
    const t0 = Date.now()
    manager.setLayout([
      { id: 'a', rect },
      { id: 'ds', rect }
    ])
    // a 被切走(detach),ds 以零矩形隐藏挂载
    manager.setLayout([{ id: 'ds', rect: zero }])
    manager.sweepSleep(t0 + 60_000)
    expect(manager.getReportedState('a')).toBe('loading') // 未达阈值,仍在缓存(替身不触发 load-success,恒为 loading)
    manager.sweepSleep(t0 + FULL * 60_000 + 1000)
    expect(manager.getReportedState('a')).toBeNull() // 已休眠销毁
    expect(manager.getReportedState('ds')).toBe('loading') // 阈值 0 常驻
    expect(states.filter((s) => s.id === 'a' && s.state === 'sleeping')).toHaveLength(1)
  })

  it('宿主窗口隐藏/最小化后按不可见计', () => {
    manager.registerProvider(makeProvider('a', FULL))
    const t0 = Date.now()
    manager.setLayout([{ id: 'a', rect }])
    ;(win as unknown as { visible: boolean }).visible = false
    manager.sweepSleep(t0 + FULL * 60_000 + 1000)
    expect(manager.getReportedState('a')).toBeNull()
  })

  it('窗口隐藏期间视图被休眠,重新显示时按最近布局自动重建', () => {
    manager.registerProvider(makeProvider('a', FULL))
    const t0 = Date.now()
    manager.setLayout([{ id: 'a', rect }])
    const fakeWin = win as unknown as { visible: boolean; emit: (ev: string) => void }
    fakeWin.visible = false
    manager.sweepSleep(t0 + FULL * 60_000 + 1000)
    expect(manager.getReportedState('a')).toBeNull()
    fakeWin.visible = true
    fakeWin.emit('show')
    expect(manager.getReportedState('a')).toBe('loading') // 已按 lastLayout 重建
  })

  it('休眠后切回:重建视图并直接加载站点(登录态在分区保留)', () => {
    manager.registerProvider(makeProvider('a', FULL))
    const t0 = Date.now()
    manager.setLayout([{ id: 'a', rect }])
    manager.setLayout([]) // 切走
    manager.sweepSleep(t0 + FULL * 60_000 + 1000)
    const createdBefore = h.created.length
    manager.setLayout([{ id: 'a', rect }])
    expect(h.created.length).toBe(createdBefore + 1) // 重建了视图
    expect(h.created.at(-1)?.loaded).toContain('https://a/')
    expect(manager.getReportedState('a')).toBe('loading')
    // 重建后的新视图不会被上一轮的时间戳立即休眠
    manager.sweepSleep(Date.now() + 1000)
    expect(manager.getReportedState('a')).toBe('loading')
  })

  it('discardProvider 销毁视图并忘记注册,之后 reload 不再重建', () => {
    manager.registerProvider(makeProvider('a', FULL))
    manager.setLayout([{ id: 'a', rect }])
    manager.discardProvider('a')
    expect(manager.getReportedState('a')).toBeNull()
    manager.reload('a') // provider 已忘记,不会重建
    expect(h.created).toHaveLength(1) // 只有最初那一个视图
  })
})
