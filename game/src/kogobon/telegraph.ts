import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, type Vector3 } from 'three'

const radialSteps = 6
const angularSteps = 60

export class KogobonTelegraph {
  private readonly positions = new Float32Array(radialSteps * angularSteps * 18)
  private readonly geometry = new BufferGeometry()
  readonly mesh = new Mesh(this.geometry, new MeshBasicMaterial({
    color: 0xff783e, opacity: .32, transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false,
  }))

  constructor(private readonly height: (x: number, z: number) => number) {
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
    this.hide()
  }

  show(center: Vector3, yaw: number, radius: number, halfAngle: number) {
    let offset = 0
    const radii = [0, .19, .38, .57, .76, .94, 1]
    const vertex = (radial: number, angular: number) => {
      const angle = yaw + halfAngle * (2 * angular / angularSteps - 1)
      const distance = radii[radial] * radius
      const x = center.x + Math.sin(angle) * distance
      const z = center.z + Math.cos(angle) * distance
      this.positions[offset++] = x
      this.positions[offset++] = this.height(x, z) + .085
      this.positions[offset++] = z
    }
    for (let r = 0; r < radialSteps; r++) for (let a = 0; a < angularSteps; a++) {
      vertex(r,a); vertex(r+1,a); vertex(r+1,a+1)
      vertex(r,a); vertex(r+1,a+1); vertex(r,a+1)
    }
    this.geometry.attributes.position.needsUpdate = true
    this.mesh.visible = true
    this.pulse(0)
  }

  pulse(progress: number) { this.mesh.material.opacity = .27 + .23 * progress }
  hide() { this.mesh.visible = false }
}
