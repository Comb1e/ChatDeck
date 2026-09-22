import { FORM_CONFIG, type Form, type FormCommand, type FormReport, type FormScene } from '@shared/formTransition'
import { petPoint, relocateScene } from '@shared/whaleSkin'
import type { Rect } from '@shared/types'
import { FLOAT_EXPANDED } from '@shared/floatLayout'

export interface FormHost {
  ensure(form: Form): void
  send(form: Form, command: FormCommand): void
  show(form: Form): void
  hide(form: Form): void
  panel(): Rect
  placePanel(at: { x: number; y: number }): Rect
  workarea(panel: Rect): Rect
  stage(area: Rect): void
}
type Phase = 'stable' | 'preparing' | 'animating' | 'handoff'

/** Owns native visibility. Animation frames remain entirely in the whale renderer. */
export class FormController {
  phase: Phase = 'stable'
  current: Form = 'whale'
  target: Form = 'whale'
  private id = 0
  private revision = 0
  private ready = { whale: false, float: false }
  private scene: FormScene | undefined
  private preparedScene = false
  private captureSent = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private retireTimer: ReturnType<typeof setTimeout> | undefined
  constructor(private host: FormHost) {}

  toggle(): void { this.request(this.target === 'whale' ? 'float' : 'whale') }
  request(target: Form): void {
    if (target === this.target) return
    this.target = target
    this.revision++
    clearTimeout(this.retireTimer)
    if (this.phase === 'animating' || this.phase === 'handoff') {
      this.phase = 'animating'
      this.host.hide('float')
      this.play()
      return
    }
    if (this.phase === 'preparing') {
      if (target === this.current) this.finish(this.current)
      return
    }
    this.id++
    this.phase = 'preparing'
    if (this.current === 'whale') this.scene = undefined
    this.preparedScene = false
    this.captureSent = false
    this.host.ensure('float')
    this.host.ensure('whale')
    this.watchdog()
    this.prepare()
  }
  rendererReady(form: Form): void {
    this.ready[form] = true
    if (this.phase === 'preparing') this.prepare()
  }
  private prepare(): void {
    if (!this.ready.whale || !this.ready.float || this.preparedScene) return
    if (this.current === 'whale') {
      if (!this.captureSent) {
        this.captureSent = true
        this.host.send('whale', { type: 'capture', id: this.id })
      }
    } else {
      const panel = this.host.panel(), workarea = this.host.workarea(panel)
      if (!this.scene) { this.recover(); return }
      this.scene = relocateScene(this.scene, panel, workarea)
      this.sendPreparation()
    }
  }
  report(report: FormReport, sender: Form): void {
    if (report.id !== this.id || this.phase === 'stable') return
    if (report.type === 'captured' && sender === 'whale' && this.phase === 'preparing' && !this.preparedScene) {
      if (!Object.values(report.pet).every(v => typeof v !== 'number' || Number.isFinite(v))) { this.recover(); return }
      const mouth = petPoint({ x: 149, y: 104 }, report.pet)
      const panel = this.host.placePanel({ x: mouth.x - FLOAT_EXPANDED.width / 2, y: mouth.y - FLOAT_EXPANDED.height / 2 })
      this.scene = { pet: report.pet, panel, workarea: this.host.workarea(panel) }
      this.sendPreparation()
    } else if (report.type === 'prepared' && sender === 'whale' && this.phase === 'preparing' && this.preparedScene) {
      this.host.show('whale')
      // 收起方向(current=float):外壳需先在可见的悬浮窗上方淡入盖满,此刻不能隐藏悬浮窗,
      // 否则真实 UI 一帧内被空白外壳替换(闪烁);盖满后鲸鱼上报 covered 再隐藏。
      // 展开方向(current=whale):悬浮窗本就隐藏,立即隐藏是无害兜底。
      if (this.current !== 'float') this.host.hide('float')
      this.phase = 'animating'
      this.play()
    } else if (report.type === 'covered' && sender === 'whale' && this.phase === 'animating') {
      this.host.hide('float')
    } else if (report.type === 'complete' && sender === 'whale' && this.phase === 'animating' && report.revision === this.revision && report.form === this.target) {
      if (report.form === 'whale') this.finish('whale')
      else {
        this.phase = 'handoff'
        this.host.show('float')
        this.host.send('float', { type: 'present', id: this.id, revision: this.revision })
        this.watchdog()
      }
    } else if (report.type === 'presented' && sender === 'float' && this.phase === 'handoff' && report.revision === this.revision) this.finish('float')
  }
  private sendPreparation(): void {
    if (!this.scene) return
    this.preparedScene = true
    this.host.stage(this.scene.workarea)
    this.host.send('whale', { type: 'prepare', id: this.id, scene: this.scene, from: this.current })
  }
  private play(): void {
    this.host.send('whale', { type: 'play', id: this.id, revision: this.revision, target: this.target })
    this.watchdog()
  }
  private finish(form: Form): void {
    clearTimeout(this.timer)
    this.phase = 'stable'
    this.current = this.target = form
    if (form === 'float') {
      // 悬浮窗显示时会播 Windows DWM 显示过渡(~200ms 淡入),而它此刻在鲸鱼窗口(外壳)之下,
      // 外壳若立刻消失,半透明的过渡中间态直接暴露(整窗幽灵闪烁)。等过渡走完再清空并隐藏鲸鱼。
      clearTimeout(this.retireTimer)
      this.retireTimer = setTimeout(() => {
        this.retireTimer = undefined
        if (this.phase !== 'stable' || this.current !== 'float') return
        this.host.send('whale', { type: 'settle', id: this.id, form, scene: this.scene })
        this.host.hide('whale')
      }, FORM_CONFIG.retireDelayMs)
    } else {
      this.host.send('whale', { type: 'settle', id: this.id, form, scene: this.scene })
      this.host.hide('float')
    }
    this.host.show(form)
  }
  destroy(): void { clearTimeout(this.timer); clearTimeout(this.retireTimer); this.id++ }
  /** Fail open to a ready form, invalidate old reports, and retain a visible source while rebooting. */
  recover(failed?: Form): void {
    if (failed) this.ready[failed] = false
    if (failed && this.phase === 'stable' && failed !== this.current) return
    this.id++
    const fallback = this.ready[this.target] ? this.target : this.ready[this.current] ? this.current : this.target === 'whale' ? 'float' : 'whale'
    this.host.ensure(fallback)
    if (this.scene) {
      this.scene = relocateScene(this.scene, this.host.panel(), this.host.workarea(this.host.panel()))
      this.host.stage(this.scene.workarea)
    }
    this.finish(fallback)
  }
  private watchdog(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.recover(), FORM_CONFIG.readyTimeoutMs)
  }
}
