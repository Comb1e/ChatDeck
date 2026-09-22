import { FormTimeline, type FormCommand, type FormScene, type PetVisual } from '@shared/formTransition'
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
      this.id = command.id
      this.hooks.freeze()
      this.scene = command.scene
      this.sample = createMorph(command.scene)
      this.clock = new FormTimeline(command.from, performance.now())
      this.skin.root.setAttribute('transform', `translate(${-command.scene.workarea.x} ${-command.scene.workarea.y})`)
      this.skin.draw(this.sample(this.clock.progress))
      this.skin.root.dataset.progress = String(this.clock.progress)
      this.skin.show(true)
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
      this.tick(performance.now())
    } else if (command.type === 'settle') {
      this.stop()
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
}
