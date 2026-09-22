import { BLUE, WHITE } from '@shared/whaleGeometry'
import { FORM_CONFIG } from '@shared/formTransition'
import { hitSkin, pathOf, type SkinFrame } from '@shared/whaleSkin'

/** One painter serves the animation stage and the permanent Vue frame. */
export class SkinRenderer {
  readonly root: SVGGElement
  private nodes: SVGPathElement[]
  private frame: SkinFrame | null = null
  constructor(stage: SVGElement) {
    this.root = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    this.root.setAttribute('data-whale-skin', '')
    this.nodes = [BLUE, BLUE, FORM_CONFIG.contentColor, WHITE, WHITE, WHITE].map(fill => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      node.setAttribute('fill', fill)
      node.setAttribute('fill-rule', 'evenodd')
      this.root.appendChild(node)
      return node
    })
    stage.appendChild(this.root)
  }
  draw(frame: SkinFrame): void {
    this.frame = frame
    const [tail, body, mouth, eye, dot, cheek] = this.nodes
    tail.setAttribute('d', pathOf(frame.tail))
    body.setAttribute('d', pathOf(frame.body) + pathOf(frame.mouth))
    mouth.setAttribute('d', pathOf(frame.mouth))
    mouth.setAttribute('opacity', String(frame.ink))
    eye.setAttribute('d', pathOf(frame.eye))
    dot.setAttribute('d', pathOf(frame.dot))
    const blue = [77, 107, 254]
    dot.setAttribute('fill', `rgb(${blue.map(c => Math.round(c + (255 - c) * frame.dotWhite)).join(',')})`)
    cheek.setAttribute('d', pathOf(frame.cheek))
    cheek.setAttribute('opacity', String(frame.cheekOpacity))
  }
  hit(x: number, y: number): boolean {
    return !!this.frame && hitSkin(this.frame, { x, y })
  }
  show(on: boolean): void { this.root.style.display = on ? '' : 'none' }
}
