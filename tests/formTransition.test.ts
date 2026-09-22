import { afterEach, describe, expect, it, vi } from 'vitest'
import { FORM_CONFIG, FormTimeline, type FormCommand, type FormScene, type PetVisual } from '../src/shared/formTransition'
import { FormController, type FormHost } from '../src/main/formController'
import { contourBounds, createMorph, contains, panelSkin, petPoint, petSkin, relocateScene, shotSkin, windowFromPanel } from '../src/shared/whaleSkin'
import { panelFromWindow } from '../src/shared/floatLayout'

const pet: PetVisual = { x: 500, y: 700, rot: 0, sx: 1, sy: 1, flip: 1, scale: 1,
  sway: 0, tailAngle: 0, gx: 0, gy: 0, expression: 'normal', blink: 1 }
const scene: FormScene = { pet, panel: { x: 380, y: 140, width: 360, height: 620 }, workarea: { x: 0, y: 0, width: 1920, height: 1040 } }
afterEach(() => vi.useRealTimers())

describe('reversible visual timeline', () => {
  it.each([100, 200, 450, 699])('reverses at %i ms without resetting or speeding up', time => {
    const clock = new FormTimeline('whale', 0)
    clock.reverseTo('float', 0)
    expect(clock.advance(time)).toBeCloseTo(time / 700)
    const before = clock.progress
    clock.reverseTo('whale', time)
    expect(clock.progress).toBe(before)
    expect(clock.advance(time + time / 2)).toBeCloseTo(time / 1400)
    expect(clock.advance(time * 2)).toBeCloseTo(0)
    expect(clock.done).toBe(true)
  })
  it('bounds long frames and ignores negative time deltas', () => {
    const clock = new FormTimeline('float', 10)
    clock.reverseTo('whale', 10)
    expect(clock.advance(5)).toBe(1)
    expect(clock.advance(10)).toBe(1)
    expect(clock.advance(10000)).toBe(0)
  })
  it('starts at the actual pose and ends at the exact permanent frame silhouette', () => {
    const sample = createMorph(scene)
    expect(sample(0)).toEqual(petSkin(pet))
    const final = sample(1), panel = panelSkin(scene.panel)
    for (const key of ['body', 'mouth', 'tail', 'eye', 'dot'] as const) {
      const a = contourBounds(final[key]), b = contourBounds(panel[key])
      for (const property of ['x', 'y', 'width', 'height'] as const) expect(a[property]).toBeCloseTo(b[property], 9)
    }
    expect(contourBounds(final.body)).toMatchObject({ x: 380, y: 140, width: 360, height: 620 })
    expect(final.ink).toBe(1)
  })
  it('widens the cutout before introducing the panel; never overshoots', () => {
    const sample = createMorph(scene)
    const initial = contourBounds(sample(0).mouth), open = contourBounds(sample(200 / 700).mouth)
    expect(open.width).toBeGreaterThan(initial.width)
    expect(open.height).toBeGreaterThan(initial.height)
    expect(sample(200 / 700).ink).toBe(0)
    for (let i = 0; i <= 100; i++) expect(sample(i / 100).ink).toBeGreaterThanOrEqual(0)
    expect(sample(2)).toEqual(sample(1))
    expect(sample(-1)).toEqual(sample(0))
  })
  it.each([-1, 1])('preserves coordinates under rotated, stretched, flipped pose %i', flip => {
    const pose = { ...pet, x: -900, y: 280, rot: 90, sx: 2, sy: 0.5, flip, scale: 1.5 }
    // Independent manual transform: offset (10,20), scale (20,10), rotate (-10,20).
    expect(petPoint({ x: 142, y: 182 }, pose)).toEqual({ x: -900 - 15 * flip, y: 310 })
    const sample = createMorph({ ...scene, pet: pose })
    for (const progress of [0, 0.15, 0.4, 0.7, 1]) {
      const forward = sample(progress), backward = sample(1 - (1 - progress))
      forward.body.forEach((point, i) => {
        expect(Number.isFinite(point.x + point.y)).toBe(true)
        expect(point.x).toBeCloseTo(backward.body[i].x, 8)
        expect(point.y).toBeCloseTo(backward.body[i].y, 8)
      })
    }
  })
  it('translates the reverse path with a dragged window on a negative-coordinate monitor', () => {
    const area = { x: -1920, y: -200, width: 1920, height: 1080 }
    const panel = { ...scene.panel, x: -1400, y: 0 }
    const next = relocateScene(scene, panel, area)
    expect(next.pet.x).toBe(pet.x + panel.x - scene.panel.x)
    expect(next.pet.y).toBe(pet.y + panel.y - scene.panel.y)
    const edge = relocateScene(scene, { ...panel, x: -1920, y: 800 }, area)
    const skin = petSkin(edge.pet), b = contourBounds([...skin.body, ...skin.tail])
    expect(b.x).toBeGreaterThanOrEqual(area.x)
    expect(b.y + b.height).toBeLessThanOrEqual(area.y + area.height + 1e-8)
  })
  it('keeps the panel interactive while empty decoration margins pass through', () => {
    const skin = panelSkin({ x: 24, y: 24, width: 360, height: 620 })
    const hit = (x: number, y: number): boolean => contains(skin.body, { x, y }) || contains(skin.tail, { x, y })
    expect(hit(100, 100)).toBe(true)
    expect(hit(383, 300)).toBe(true)
    expect(hit(200, 12)).toBe(false)
    expect(hit(12, 400)).toBe(false)
    expect(hit(40, 15)).toBe(true)
  })
})

describe('snapshot shell endpoint', () => {
  it('window rect derives from the panel and round-trips with panelFromWindow', () => {
    const panel = { x: 380, y: 140, width: 360, height: 620 }
    expect(windowFromPanel(panel)).toEqual({ x: 356, y: 116, width: 384, height: 644 })
    expect(panelFromWindow(windowFromPanel(panel))).toEqual(panel)
  })
  it('snapshot endpoint spans the whole window with collapsed decorations and a transparent body', () => {
    const skin = shotSkin(scene.panel)
    expect(contourBounds(skin.body)).toMatchObject({ x: 356, y: 116, width: 384, height: 644 })
    for (const part of ['tail', 'eye', 'dot', 'cheek'] as const) {
      expect(contourBounds(skin[part])).toMatchObject({ width: 0, height: 0 })
    }
    expect(skin.ink).toBe(1)
    expect(skin.bodyOpacity).toBe(0)
  })
  it('melt crossfades the blue body against the snapshot and lands on the exact pet pose', () => {
    const sample = createMorph(scene, true)
    expect(sample(0)).toEqual(petSkin(pet))
    expect(sample(1).bodyOpacity).toBe(0)
    for (let i = 0; i <= 100; i++) {
      const frame = sample(i / 100)
      expect(frame.bodyOpacity).toBeCloseTo(1 - frame.ink, 9)
      expect(frame.bodyOpacity).toBeGreaterThanOrEqual(0)
      expect(frame.bodyOpacity).toBeLessThanOrEqual(1)
      for (const point of frame.tail) expect(Number.isFinite(point.x + point.y)).toBe(true)
    }
    expect(contourBounds(sample(1).body)).toMatchObject({ x: 356, y: 116, width: 384, height: 644 })
  })
})

function setup(ready = true): { controller: FormController; host: FormHost; commands: Array<{ form: string; command: FormCommand }>; visible: Set<string> } {
  vi.useFakeTimers()
  const commands: Array<{ form: string; command: FormCommand }> = [], visible = new Set(['whale'])
  const host: FormHost = {
    ensure: vi.fn(), send: (form, command) => commands.push({ form, command }),
    show: form => { visible.add(form) }, hide: form => { visible.delete(form) },
    panel: () => scene.panel, placePanel: () => scene.panel,
    workarea: () => scene.workarea, stage: vi.fn(),
    captureFloat: vi.fn(async () => null), repaint: vi.fn()
  }
  const controller = new FormController(host)
  if (ready) { controller.rendererReady('float'); controller.rendererReady('whale') }
  return { controller, host, commands, visible }
}
function start(h: ReturnType<typeof setup>): { id: number; revision: number } {
  h.controller.request('float')
  const capture = h.commands.at(-1)!.command
  h.controller.report({ type: 'captured', id: capture.id, pet }, 'whale')
  h.controller.report({ type: 'prepared', id: capture.id }, 'whale')
  const play = h.commands.at(-1)!.command
  if (play.type !== 'play') throw new Error('expected play')
  return { id: play.id, revision: play.revision }
}
describe('native form coordinator', () => {
  it('waits for both renderers, then keeps the animation until the live panel is painted', () => {
    const h = setup(false)
    h.controller.request('float')
    expect(h.commands).toHaveLength(0)
    h.controller.rendererReady('whale')
    expect(h.commands).toHaveLength(0)
    h.controller.rendererReady('float')
    const token = start(h)
    expect([...h.visible]).toEqual(['whale'])
    h.controller.report({ type: 'complete', ...token, form: 'float' }, 'whale')
    expect(h.visible.has('whale') && h.visible.has('float')).toBe(true)
    h.controller.report({ type: 'presented', ...token }, 'float')
    // 悬浮窗的 DWM 显示过渡(~retireDelayMs)走完前,鲸鱼窗口保持可见,避免露出半透明中间态
    expect(h.visible.has('whale') && h.visible.has('float')).toBe(true)
    vi.advanceTimersByTime(FORM_CONFIG.retireDelayMs)
    expect([...h.visible]).toEqual(['float'])
    expect(h.controller.current).toBe('float')
  })
  it('reverses immediately and ignores stale completion and duplicate requests', () => {
    const h = setup(), token = start(h)
    const count = h.commands.length
    h.controller.request('float')
    expect(h.commands).toHaveLength(count)
    h.controller.toggle()
    expect(h.commands.at(-1)!.command).toMatchObject({ type: 'play', target: 'whale', id: token.id })
    h.controller.report({ type: 'complete', ...token, form: 'float' }, 'whale')
    expect(h.visible.has('float')).toBe(false)
    h.controller.report({ type: 'complete', id: token.id, revision: token.revision + 1, form: 'whale' }, 'whale')
    expect(h.controller.phase).toBe('stable')
    expect([...h.visible]).toEqual(['whale'])
  })
  it('allows reversing during live-window handoff without accepting the old paint acknowledgement', () => {
    const h = setup(), token = start(h)
    h.controller.report({ type: 'complete', ...token, form: 'float' }, 'whale')
    h.controller.toggle()
    h.controller.report({ type: 'presented', ...token }, 'float')
    expect(h.controller.phase).toBe('animating')
    expect([...h.visible]).toEqual(['whale'])
  })
  it('cancels preparation safely and rejects late acknowledgements', () => {
    const h = setup()
    h.controller.request('float')
    const id = h.commands.at(-1)!.command.id
    h.controller.request('whale')
    h.controller.report({ type: 'captured', id, pet }, 'whale')
    expect(h.controller.phase).toBe('stable')
    expect([...h.visible]).toEqual(['whale'])
  })
  it('recovers a timeout and rejects reports from the wrong renderer', () => {
    const h = setup(), token = start(h)
    h.controller.report({ type: 'complete', ...token, form: 'float' }, 'float')
    expect(h.controller.phase).toBe('animating')
    vi.advanceTimersByTime(2000)
    expect(h.controller.phase).toBe('stable')
    // 恢复路径同样延迟退役鲸鱼窗口(等悬浮窗显示过渡走完)
    vi.advanceTimersByTime(FORM_CONFIG.retireDelayMs)
    expect([...h.visible]).toEqual(['float'])
    h.controller.report({ type: 'complete', ...token, form: 'whale' }, 'whale')
    expect(h.controller.current).toBe('float')
  })
  it('keeps an available form when the destination renderer crashes', () => {
    const h = setup()
    start(h)
    h.controller.recover('float')
    expect(h.controller.current).toBe('whale')
    expect([...h.visible]).toEqual(['whale'])
  })
  it('does not move a live pet when a hidden float renderer crashes', () => {
    const h = setup()
    h.controller.recover('float')
    expect(h.commands).toHaveLength(0)
    expect([...h.visible]).toEqual(['whale'])
  })
  it('keeps the live panel on screen during collapse until the whale reports covered', async () => {
    const h = setup(), token = start(h)
    h.controller.report({ type: 'complete', ...token, form: 'float' }, 'whale')
    h.controller.report({ type: 'presented', ...token }, 'float')
    vi.advanceTimersByTime(FORM_CONFIG.retireDelayMs)
    expect([...h.visible]).toEqual(['float'])
    h.controller.request('whale')
    await vi.advanceTimersByTimeAsync(0) // 整窗快照捕获(promise)排空后才会发出 prepare
    h.controller.report({ type: 'prepared', id: h.commands.at(-1)!.command.id }, 'whale')
    // 外壳淡入盖满之前,真实悬浮窗必须保持可见(隐藏它就是一帧硬切)
    expect(h.visible.has('float')).toBe(true)
    expect(h.controller.phase).toBe('animating')
    h.controller.report({ type: 'covered', id: h.commands.at(-1)!.command.id }, 'whale')
    expect([...h.visible]).toEqual(['whale'])
  })
  it('reversing mid-collapse keeps the panel visible and lands back on float', async () => {
    const h = setup(), token = start(h)
    h.controller.report({ type: 'complete', ...token, form: 'float' }, 'whale')
    h.controller.report({ type: 'presented', ...token }, 'float')
    vi.advanceTimersByTime(FORM_CONFIG.retireDelayMs)
    h.controller.request('whale')
    await vi.advanceTimersByTimeAsync(0)
    h.controller.report({ type: 'prepared', id: h.commands.at(-1)!.command.id }, 'whale')
    h.controller.request('float')
    expect(h.commands.at(-1)!.command).toMatchObject({ type: 'play', target: 'float' })
    expect(h.visible.has('float')).toBe(true)
    const play = h.commands.at(-1)!.command as Extract<FormCommand, { type: 'play' }>
    h.controller.report({ type: 'complete', id: play.id, revision: play.revision, form: 'float' }, 'whale')
    h.controller.report({ type: 'presented', id: play.id, revision: play.revision }, 'float')
    vi.advanceTimersByTime(FORM_CONFIG.retireDelayMs)
    expect([...h.visible]).toEqual(['float'])
    expect(h.controller.current).toBe('float')
  })
  it('snapshot collapse carries the shot, waits for covered, then settles and repaints', async () => {
    const h = setup()
    h.host.captureFloat = vi.fn(async () => ({ base: 'data:image/png;base64,QUFB', overlays: [] }))
    const token = start(h)
    h.controller.report({ type: 'complete', ...token, form: 'float' }, 'whale')
    h.controller.report({ type: 'presented', ...token }, 'float')
    vi.advanceTimersByTime(FORM_CONFIG.retireDelayMs)
    h.controller.request('whale')
    await vi.advanceTimersByTimeAsync(0)
    const prepare = h.commands.filter(c => c.command.type === 'prepare').at(-1)!.command
    expect(prepare).toMatchObject({ type: 'prepare', shot: { base: 'data:image/png;base64,QUFB', overlays: [] } })
    h.controller.report({ type: 'prepared', id: (prepare as { id: number }).id }, 'whale')
    // 鲸鱼窗口的 DWM 显示过渡(~200ms)内整窗半透明:即使外壳像素=真实 UI,
    // 过早隐藏悬浮窗也会透出桌面,两条收起路径都等 covered
    expect(h.visible.has('float')).toBe(true)
    expect(h.controller.phase).toBe('animating')
    h.controller.report({ type: 'covered', id: (prepare as { id: number }).id }, 'whale')
    expect([...h.visible]).toEqual(['whale'])
    const play = h.commands.at(-1)!.command as Extract<FormCommand, { type: 'play' }>
    h.controller.report({ type: 'complete', id: play.id, revision: play.revision, form: 'whale' }, 'whale')
    expect(h.controller.current).toBe('whale')
    expect(h.host.repaint).toHaveBeenCalledWith('whale')
  })
  it('capture failure keeps the legacy cover flow (float stays visible until covered)', async () => {
    const h = setup()
    h.host.captureFloat = vi.fn(async () => null)
    const token = start(h)
    h.controller.report({ type: 'complete', ...token, form: 'float' }, 'whale')
    h.controller.report({ type: 'presented', ...token }, 'float')
    vi.advanceTimersByTime(FORM_CONFIG.retireDelayMs)
    h.controller.request('whale')
    await vi.advanceTimersByTimeAsync(0)
    const prepare = h.commands.filter(c => c.command.type === 'prepare').at(-1)!.command
    expect((prepare as { shot?: unknown }).shot).toBeUndefined()
    h.controller.report({ type: 'prepared', id: (prepare as { id: number }).id }, 'whale')
    expect(h.visible.has('float')).toBe(true)
    h.controller.report({ type: 'covered', id: (prepare as { id: number }).id }, 'whale')
    expect([...h.visible]).toEqual(['whale'])
  })
  it('a capture resolving after a cancelled transition never sends prepare', async () => {
    const h = setup()
    let resolveCapture: (value: null) => void = () => {}
    h.host.captureFloat = vi.fn(() => new Promise<null>(resolve => { resolveCapture = resolve }))
    const token = start(h)
    h.controller.report({ type: 'complete', ...token, form: 'float' }, 'whale')
    h.controller.report({ type: 'presented', ...token }, 'float')
    vi.advanceTimersByTime(FORM_CONFIG.retireDelayMs)
    h.controller.request('whale')
    const countAtCancel = h.commands.length
    h.controller.request('float') // 准备期取消,回到 float
    expect(h.controller.phase).toBe('stable')
    resolveCapture(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(h.commands.slice(countAtCancel).filter(c => c.command.type === 'prepare')).toHaveLength(0)
  })
})
