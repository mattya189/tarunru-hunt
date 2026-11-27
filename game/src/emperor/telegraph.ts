import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, type Vector3 } from 'three'
import { flatDistance, wrap, yawTo } from '../math'
import type { EmperorStrike } from './config'

const rows = 6
const columns = 24

export class EmperorTelegraph {
  private readonly positions = new Float32Array((rows + 1) * (columns + 1) * 3)
  private readonly geometry = new BufferGeometry()
  readonly mesh = new Mesh(this.geometry, new MeshBasicMaterial({
    color: 0xf9a957, transparent: true, opacity: .44, toneMapped: false,
    depthWrite: false, side: DoubleSide,
  }))

  constructor(private readonly height: (x: number, z: number) => number) {
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    const indices: number[] = []
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column
      const b = a + columns + 1
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
    this.geometry.setIndex(indices)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
    this.hide()
  }

  show(center: Vector3, yaw: number, hitbox: EmperorStrike['hitbox']) {
    const sin = Math.sin(yaw), cos = Math.cos(yaw)
    let i = 0
    for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
      const across = 2 * column / columns - 1
      let x: number, z: number
      if (hitbox.kind === 'arc') {
        const angle = yaw + across * hitbox.halfAngle, radius = row / rows * hitbox.range
        x = center.x + Math.sin(angle) * radius
        z = center.z + Math.cos(angle) * radius
      } else {
        const along = (2 * row / rows - 1) * hitbox.halfWidth
        x = center.x + sin * along + cos * across * hitbox.halfLength
        z = center.z + cos * along - sin * across * hitbox.halfLength
      }
      this.positions[i++] = x
      this.positions[i++] = this.height(x, z) + .08
      this.positions[i++] = z
    }
    this.geometry.attributes.position.needsUpdate = true
    this.mesh.visible = true
    this.mesh.material.color.setHex(hitbox.kind === 'band' ? 0xf98f60 : 0xf9a957)
    this.pulse(0)
  }

  pulse(progress: number) { this.mesh.material.opacity = .32 + .25 * progress }
  flash(progress: number) { this.mesh.material.opacity = .66 * (1 - progress) }
  hide() { this.mesh.visible = false }
}

export function inEmperorHitbox(p: Vector3, center: Vector3, yaw: number, hitbox: EmperorStrike['hitbox']) {
  if (hitbox.kind === 'arc') {
    const distance = flatDistance(p, center)
    return distance <= hitbox.range && (distance < .01 || Math.abs(wrap(yawTo(center, p) - yaw)) <= hitbox.halfAngle)
  }
  const dx = p.x - center.x, dz = p.z - center.z
  const sin = Math.sin(yaw), cos = Math.cos(yaw)
  return Math.abs(dx * sin + dz * cos) <= hitbox.halfWidth &&
    Math.abs(dx * cos - dz * sin) <= hitbox.halfLength
}
