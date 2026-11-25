import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three'

export class ContactShadow {
  readonly mesh: Mesh<PlaneGeometry,MeshBasicMaterial>
  constructor(radius: number, alpha: number) {
    const canvas=document.createElement('canvas')
    canvas.width=canvas.height=48
    const ctx=canvas.getContext('2d')!
    const gradient=ctx.createRadialGradient(24,24,0,24,24,24)
    gradient.addColorStop(0,'#20221c')
    gradient.addColorStop(.43,'#20221cb0')
    gradient.addColorStop(1,'#20221c00')
    ctx.fillStyle=gradient; ctx.fillRect(0,0,48,48)
    this.mesh=new Mesh(new PlaneGeometry(radius*2,radius*2).rotateX(-Math.PI/2),
      new MeshBasicMaterial({map:new CanvasTexture(canvas),transparent:true,opacity:alpha,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}))
    this.mesh.renderOrder=1
  }
  follow(anchor: Vector3, weight=1) {
    this.mesh.position.set(anchor.x,anchor.y+.026,anchor.z)
    this.mesh.material.opacity=weight
  }
}
