import { Vector3, type Camera } from 'three'
import type { Battle } from './battle'
import type { MonsterModel } from './monster-model'
import { monsterIcon } from './quests'

export class Reticles {
  private readonly root = document.querySelector<HTMLElement>('#reticles')!
  private readonly markers = new Map<MonsterModel, HTMLImageElement>()
  private readonly point = new Vector3()

  clear() {
    this.root.hidden = true
    this.root.replaceChildren()
    this.markers.clear()
  }

  render(battle: Battle, camera: Camera) {
    this.root.hidden = !battle.lock || battle.outcome !== null
    if (this.root.hidden) return

    const targets = battle.reticleTargets
    const focused = battle.lockTarget
    for (const [model, marker] of this.markers) {
      if (targets.includes(model)) continue
      marker.remove()
      this.markers.delete(model)
    }
    for (const model of targets) {
      const marker = this.markers.get(model) ?? this.add(model)
      const config = model.data.reticle
      const root = model.root.position
      this.point.copy(config?.anchor === 'root' ? root : (model.parts[0]?.center ?? root))
      this.point.y += config?.offsetY ?? 0
      this.point.project(camera)
      const { x, y, z } = this.point
      marker.hidden = z < -1 || z > 1 || Math.abs(x) > .98 || Math.abs(y) > .97
      marker.classList.toggle('focused', root === focused)
      if (!marker.hidden) {
        marker.style.left = `${(x * .5 + .5) * 100}%`
        marker.style.top = `${(.5 - y * .5) * 100}%`
      }
    }
  }

  private add(model: MonsterModel) {
    const marker = document.createElement('img')
    marker.className = 'monster-reticle'
    marker.src = monsterIcon(model.data)
    marker.alt = ''
    marker.draggable = false
    if (model.data.reticle?.size) marker.style.setProperty('--reticle-size', `${model.data.reticle.size}px`)
    this.markers.set(model, marker)
    this.root.append(marker)
    return marker
  }
}
