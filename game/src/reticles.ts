import { Vector3, type Camera } from 'three'
import type { Battle } from './battle'
import { clamp } from './math'
import type { MonsterModel } from './monster-model'
import { monsterIcon } from './quests'

const spacing = 44
const radius = spacing / 2
const offsets = [
  [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1], [-2, 0], [2, 0], [0, -2], [0, 2],
] as const

type Position = { x: number; y: number }

export class Reticles {
  private readonly root = document.querySelector<HTMLElement>('#reticles')!
  private readonly markers = new Map<MonsterModel, HTMLButtonElement>()
  private readonly point = new Vector3()

  constructor(private readonly choose: (model: MonsterModel) => void) {}

  clear() {
    this.root.hidden = true
    this.root.replaceChildren()
    this.markers.clear()
  }

  render(battle: Battle, camera: Camera) {
    this.root.hidden = battle.outcome !== null
    if (this.root.hidden) return

    const targets = battle.reticleTargets
    const width = this.root.clientWidth, height = this.root.clientHeight
    const occupied: Position[] = []
    for (const [model, marker] of this.markers) {
      if (targets.includes(model)) continue
      marker.remove()
      this.markers.delete(model)
    }
    for (const model of targets) {
      const marker = this.markers.get(model) ?? this.add(model, targets)
      const config = model.data.reticle
      const root = model.root.position
      this.point.copy(config?.anchor === 'root' ? root : (model.parts[0]?.center ?? root))
      this.point.y += config?.offsetY ?? 0
      this.point.applyMatrix4(camera.matrixWorldInverse)
      const behind = this.point.z >= 0
      if (Math.abs(this.point.z) < .01) this.point.z = behind ? .01 : -.01
      this.point.applyMatrix4(camera.projectionMatrix)
      if (behind) this.point.negate()

      const point = this.point
      const direction = Math.max(Math.abs(point.x), Math.abs(point.y))
      const offscreen = behind || direction > 1
      if (offscreen) {
        if (direction > .001) point.multiplyScalar(1 / direction)
        else point.set(0, -1, 0)
      }
      // Keep offscreen choices among the battlefield, above the default combat buttons.
      const y = (.5 - point.y * .5) * height
      const position = this.place((point.x * .5 + .5) * width,
        offscreen ? clamp(y, height * .14, height * .69) : y, width, height, occupied)
      occupied.push(position)
      const focused = model === battle.selectedLockTarget
      marker.classList.toggle('focused', focused)
      marker.classList.toggle('offscreen', offscreen)
      marker.setAttribute('aria-pressed', String(focused))
      marker.style.left = `${position.x}px`
      marker.style.top = `${position.y}px`
    }
  }

  private place(x: number, y: number, width: number, height: number, occupied: Position[]) {
    const fit = (left: number, top: number) => ({
      x: clamp(left, radius, width - radius),
      y: clamp(top, radius, height - radius),
    })
    for (const [dx, dy] of offsets) {
      const position = fit(x + dx * spacing, y + dy * spacing)
      if (!occupied.some(other => Math.abs(position.x - other.x) < spacing &&
          Math.abs(position.y - other.y) < spacing)) return position
    }
    return fit(x, y)
  }

  private add(model: MonsterModel, targets: readonly MonsterModel[]) {
    const marker = document.createElement('button')
    marker.type = 'button'
    marker.className = 'monster-reticle'
    const matches = targets.filter(target => target.data.name === model.data.name)
    const number = matches.length > 1 ? ` ${matches.indexOf(model) + 1}` : ''
    marker.setAttribute('aria-label', `${model.data.name}${number}をロックオン`)
    const icon = document.createElement('img')
    icon.src = monsterIcon(model.data)
    icon.alt = ''
    icon.draggable = false
    marker.append(icon)
    if (model.data.reticle?.size) marker.style.setProperty('--reticle-size', `${model.data.reticle.size}px`)
    let tap: { id: number; x: number; y: number } | undefined
    marker.addEventListener('pointerdown', event => {
      if (event.button !== 0 || tap) return
      tap = { id: event.pointerId, x: event.clientX, y: event.clientY }
      marker.setPointerCapture(event.pointerId)
    })
    marker.addEventListener('pointerup', event => {
      if (tap?.id !== event.pointerId) return
      if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= 10) this.choose(model)
      tap = undefined
    })
    marker.addEventListener('lostpointercapture', event => {
      if (tap?.id === event.pointerId) tap = undefined
    })
    marker.addEventListener('click', event => {
      if (!event.detail) this.choose(model)
    })
    this.markers.set(model, marker)
    this.root.append(marker)
    return marker
  }
}
