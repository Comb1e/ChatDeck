import { FORM_CONFIG, type FloatShot, type Form, type FormCommand, type FormReport, type FormScene } from '@shared/formTransition'
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
  /** 悬浮窗整窗快照(主页+站点视图);null = 捕获失败,收起退回覆盖淡入路径 */
  captureFloat(): Promise<FloatShot | null>
  /** 展开预热:换形动画开始时提前创建悬浮窗并重建/加载站点视图(加载藏在动画之后) */
  prewakeFloat(): void
  /** 融化结束后强制整窗重绘:透明窗口上外壳抗锯齿边缘列可能残留在 DWM 合成面(蓝线) */
  repaint(form: Form): void
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
  private shot: FloatShot | null | undefined // undefined = 捕获进行中
  private shotRequested = false
  constructor(private host: FormHost) {}

  toggle(): void { this.request(this.target === 'whale' ? 'float' : 'whale') }
  request(target: Form): void {
    if (target === this.target) return
    this.target = target
    this.revision++
    clearTimeout(this.retireTimer)
    if (this.phase === 'animating' || this.phase === 'handoff') {
      this.phase = 'animating'
      // 收起进行中(悬浮窗仍可见,等待 covered)反向回悬浮窗:保留 UI 原地不动,外壳自行淡出+倒放;
      // 已过 covered 的融化期反向则把悬浮窗重新显示(倒放的外壳不再遮挡面板区)。
      // 其余方向(倒回收起)隐藏悬浮窗是无害兜底(被不透明外壳盖住或本就隐藏)。
      if (target === 'float') this.host.show('float')
      else this.host.hide('float')
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
    this.shot = undefined
    this.shotRequested = false
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
      if (this.shot === undefined) {
        // 截图外壳:捕获完成才发 prepare(渲染层要先把快照画进外壳再换形)
        if (!this.shotRequested) {
          this.shotRequested = true
          void this.host.captureFloat().then(shot => {
            if (this.phase !== 'preparing' || this.shot !== undefined) return
            this.shot = shot
            this.sendPreparation()
          })
        }
        return
      }
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
      // 展开方向:动画开始前预热悬浮窗(确保窗口已建+站点视图重建/加载),
      // 加载过程藏在鲸鱼外壳与 retire 延迟之后;收起方向悬浮窗本就存在,无需预热。
      if (this.current === 'whale') this.host.prewakeFloat()
      this.host.show('whale')
      // 两条收起路径(截图外壳/覆盖淡入兜底)都等鲸鱼上报 covered 再隐藏悬浮窗:
      // 鲸鱼渲染层冻结时钟、等外壳确实盖住 UI 后才上报——截图外壳与真实 UI 逐像素一致,
      // 只留合成器提交余量(coveredShotDelayMs);兜底外壳要等淡入盖满(coveredDelayMs ≥ coverMs + 余量)。
      // 外壳盖住期间悬浮窗隐藏不可感知。展开方向(current=whale):悬浮窗本就隐藏,立即隐藏是无害兜底。
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
    this.host.send('whale', { type: 'prepare', id: this.id, scene: this.scene, from: this.current, shot: this.shot ?? undefined })
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
      // 外壳若立刻消失,半透明的过渡中间态直接暴露(整窗幽灵闪烁)。等过渡走完再清空鲸鱼页面。
      clearTimeout(this.retireTimer)
      this.retireTimer = setTimeout(() => {
        this.retireTimer = undefined
        if (this.phase !== 'stable' || this.current !== 'float') return
        this.host.send('whale', { type: 'settle', id: this.id, form, scene: this.scene })
        // 不隐藏鲸鱼窗口:隐藏后的 re-show 会让 DWM 合成面在数百毫秒内不呈现内容
        // (显示过渡+表面重建),期间悬浮窗一旦隐藏,屏幕上就是空洞=收起闪烁。
        // 页面 settle 后本窗口已渲染为全透明,保持可见即可;下次收起无需 re-show。
      }, FORM_CONFIG.retireDelayMs)
    } else {
      this.host.send('whale', { type: 'settle', id: this.id, form, scene: this.scene })
      this.host.hide('float')
    }
    this.host.show(form)
    // 收起落定后强制鲸鱼窗口整窗重绘一次:外壳圆角矩形贴着窗口边缘,其抗锯齿边缘列
    // 可能残留在 DWM 合成面上(桌宠形态出现 1px 蓝色竖线);此刻窗口已稳定可见,
    // 重绘只替换合成面内容,无 show 时空帧闪烁的风险。
    if (form === 'whale') this.host.repaint('whale')
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
