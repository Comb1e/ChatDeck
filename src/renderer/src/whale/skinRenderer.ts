import { BLUE, WHITE } from '@shared/whaleGeometry'
import { FORM_CONFIG } from '@shared/formTransition'
import { hitSkin, pathOf, type SkinFrame } from '@shared/whaleSkin'

const SVG_NS = 'http://www.w3.org/2000/svg'

export interface ShotImage {
  dataUrl: string
  x: number
  y: number
  width: number
  height: number
}

/** One painter serves the animation stage and the permanent Vue frame. */
export class SkinRenderer {
  readonly root: SVGGElement
  private nodes: SVGPathElement[]
  private frame: SkinFrame | null = null
  private shots: SVGGElement
  private shotClip: SVGPathElement
  private shotImages: SVGImageElement[] = []
  constructor(stage: SVGElement) {
    this.root = document.createElementNS(SVG_NS, 'g')
    this.root.setAttribute('data-whale-skin', '')
    this.nodes = [BLUE, BLUE, FORM_CONFIG.contentColor, WHITE, WHITE, WHITE].map(fill => {
      const node = document.createElementNS(SVG_NS, 'path')
      node.setAttribute('fill', fill)
      node.setAttribute('fill-rule', 'evenodd')
      this.root.appendChild(node)
      return node
    })
    // 截图层夹在嘴部暗色填充与眼睛之间:收起换形时快照盖住暗色内容区,融化中随 ink 淡出
    this.shots = document.createElementNS(SVG_NS, 'g')
    this.shots.setAttribute('clip-path', 'url(#whale-shot-clip)')
    this.shots.setAttribute('opacity', '0')
    this.root.insertBefore(this.shots, this.nodes[3])
    const defs = document.createElementNS(SVG_NS, 'defs')
    const clip = document.createElementNS(SVG_NS, 'clipPath')
    clip.setAttribute('id', 'whale-shot-clip')
    this.shotClip = document.createElementNS(SVG_NS, 'path')
    clip.appendChild(this.shotClip)
    defs.appendChild(clip)
    stage.appendChild(defs)
    stage.appendChild(this.root)
  }
  draw(frame: SkinFrame): void {
    this.frame = frame
    const [tail, body, mouth, eye, dot, cheek] = this.nodes
    tail.setAttribute('d', pathOf(frame.tail))
    body.setAttribute('d', pathOf(frame.body) + pathOf(frame.mouth))
    body.setAttribute('opacity', String(frame.bodyOpacity))
    mouth.setAttribute('d', pathOf(frame.mouth))
    mouth.setAttribute('opacity', String(frame.mouthFill))
    eye.setAttribute('d', pathOf(frame.eye))
    dot.setAttribute('d', pathOf(frame.dot))
    const blue = [77, 107, 254]
    dot.setAttribute('fill', `rgb(${blue.map(c => Math.round(c + (255 - c) * frame.dotWhite)).join(',')})`)
    cheek.setAttribute('d', pathOf(frame.cheek))
    cheek.setAttribute('opacity', String(frame.cheekOpacity))
    if (this.shotImages.length) {
      this.shotClip.setAttribute('d', pathOf(frame.body))
      this.shots.setAttribute('opacity', String(frame.ink))
    }
  }
  /** 挂载/清除收起换形的整窗快照(调用方保证 dataUrl 已解码,挂载即绘) */
  setShots(items: ShotImage[] | null): void {
    for (const img of this.shotImages) img.remove()
    this.shotImages = []
    if (!items || items.length === 0) {
      this.shots.setAttribute('opacity', '0')
      return
    }
    for (const item of items) {
      const img = document.createElementNS(SVG_NS, 'image')
      img.setAttribute('href', item.dataUrl)
      img.setAttribute('x', String(item.x))
      img.setAttribute('y', String(item.y))
      img.setAttribute('width', String(item.width))
      img.setAttribute('height', String(item.height))
      img.setAttribute('preserveAspectRatio', 'none')
      this.shots.appendChild(img)
      this.shotImages.push(img)
    }
    if (this.frame) {
      this.shotClip.setAttribute('d', pathOf(this.frame.body))
      this.shots.setAttribute('opacity', String(this.frame.ink))
    }
  }
  hit(x: number, y: number): boolean {
    return !!this.frame && hitSkin(this.frame, { x, y })
  }
  show(on: boolean): void { this.root.style.display = on ? '' : 'none' }
}
