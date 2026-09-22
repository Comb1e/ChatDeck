import { FORM_CONFIG, FormTimeline, type FormCommand, type FormScene, type PetVisual } from '@shared/formTransition'
import { createMorph } from '@shared/whaleSkin'
import { SkinRenderer } from './skinRenderer'

export interface StageHooks {
  freeze(): PetVisual
  cover(): void
  resume(pet?: PetVisual): void
  cursor(): { x: number; y: number }
  workarea(): { x: number; y: number }
}
/** Renderer owns the only animation clock. IPC conveys intent, never individual frames. */
export class FormStage {
  private skin: SkinRenderer
  private id = -1
  private revision = 0
  private scene?: FormScene
  private clock?: FormTimeline
  private sample?: ReturnType<typeof createMorph>
  private frame = 0
  private playing = false
  private interactive = false
  private captured?: PetVisual
  private crossfade = false
  private fadeTimer?: ReturnType<typeof setTimeout>
  constructor(stage: SVGElement, private hooks: StageHooks) {
    this.skin = new SkinRenderer(stage)
    this.skin.show(false)
    this.skin.root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !e.isPrimary) return
      e.preventDefault()
      void window.api.float.toggle()
    })
    window.api.form.onCommand(command => this.command(command))
  }
  private command(command: FormCommand): void {
    if (command.id < this.id) return
    if (command.type === 'capture') {
      this.id = command.id
      this.captured = this.hooks.freeze()
      window.api.form.report({ type: 'captured', id: command.id, pet: this.captured })
    } else if (command.type === 'prepare') {
      this.stop()
      this.clearFade()
      this.id = command.id
      this.hooks.freeze()
      this.scene = command.scene
      this.sample = createMorph(command.scene)
      this.clock = new FormTimeline(command.from, performance.now())
      this.skin.root.setAttribute('transform', `translate(${-command.scene.workarea.x} ${-command.scene.workarea.y})`)
      this.skin.draw(this.sample(this.clock.progress))
      this.skin.root.dataset.progress = String(this.clock.progress)
      this.skin.show(true)
      // 收起方向(from=float):鲸鱼窗口将显示在真实悬浮窗正上方,外壳先以透明待命,
      // play 时淡入盖住 UI,构成 crossfade;展开方向外壳直接顶替已隐藏的宠物本体。
      this.crossfade = command.from === 'float'
      if (this.crossfade) {
        this.skin.root.style.transition = 'none'
        this.skin.root.style.opacity = '0'
      }
      this.hooks.cover()
      const id = this.id
      // A painted shell exists before native visibility changes.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (id === this.id && this.clock) window.api.form.report({ type: 'prepared', id })
      }))
    } else if (command.type === 'play' && command.id === this.id && this.clock) {
      this.revision = command.revision
      this.clock.reverseTo(command.target, performance.now())
      this.playing = true
      cancelAnimationFrame(this.frame)
      if (this.crossfade && command.target === 'whale') {
        // 收起:先淡入盖满真实悬浮窗(FormController 收到 covered 才隐藏它),再开始融化
        this.clearFade()
        this.skin.root.style.transition = `opacity ${FORM_CONFIG.coverMs}ms ease`
        this.skin.root.style.opacity = '1'
        const id = this.id
        this.fadeTimer = setTimeout(() => {
          this.fadeTimer = undefined
          if (id !== this.id || !this.playing) return
          this.skin.root.style.transition = ''
          window.api.form.report({ type: 'covered', id })
          this.tick(performance.now())
        }, FORM_CONFIG.coverMs)
        return
      }
      this.clearFade()
      this.tick(performance.now())
    } else if (command.type === 'settle') {
      this.stop()
      this.clearFade()
      this.id = command.id
      this.skin.show(false)
      this.scene = command.scene
      if (command.form === 'whale') this.hooks.resume(command.scene?.pet ?? this.captured)
      else { this.hooks.freeze(); this.hooks.cover() }
      this.captured = undefined
    }
  }
  private tick = (now: number): void => {
    if (!this.clock || !this.sample || !this.playing) return
    this.skin.draw(this.sample(this.clock.advance(now)))
    this.skin.root.dataset.progress = String(this.clock.progress)
    this.hover()
    if (this.clock.done) {
      this.playing = false
      // 融化结束到鲸鱼窗口真正隐藏之间有一段过渡期,此窗口内外壳不得截获鼠标
      // (点击会落到下层真实悬浮窗上),统一恢复鼠标穿透。
      if (this.interactive) {
        this.interactive = false
        window.api.whale.setInteractive(false)
      }
      window.api.form.report({ type: 'complete', id: this.id, revision: this.revision, form: this.clock.target })
    } else this.frame = requestAnimationFrame(this.tick)
  }
  hover(): void {
    if (!this.clock || !this.scene) return
    const cursor = this.hooks.cursor(), area = this.hooks.workarea()
    const on = this.skin.hit(cursor.x + area.x, cursor.y + area.y)
    if (this.interactive !== on) {
      this.interactive = on
      window.api.whale.setInteractive(on)
    }
  }
  private stop(): void {
    cancelAnimationFrame(this.frame)
    this.playing = false
    this.clock = undefined
    this.interactive = false
    window.api.whale.setInteractive(false)
  }
  /** 取消未完成的淡入定时并复位外壳透明度(瞬时回到不透明) */
  private clearFade(): void {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer)
      this.fadeTimer = undefined
    }
    this.skin.root.style.transition = ''
    this.skin.root.style.opacity = ''
  }
}
