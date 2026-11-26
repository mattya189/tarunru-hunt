import {
  BoxGeometry, CircleGeometry, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, OctahedronGeometry, PlaneGeometry, RingGeometry, type BufferGeometry,
} from 'three'
import type { Hazard, ShikoukiAttacks } from './attacks'
import { crystal } from './config'

const fan=(arc:number)=>new CircleGeometry(1,32,Math.PI/2-arc,2*arc).rotateX(Math.PI/2)

const tint=(color:number, opacity:number)=>new MeshBasicMaterial({
  color,opacity,transparent:true,depthWrite:false,side:DoubleSide,toneMapped:false,
})

export class ShikoukiVisuals {
  readonly root=new Group()
  private readonly decals=new Map<Hazard,Group>()
  private readonly disk=new CircleGeometry(1,48).rotateX(-Math.PI/2)
  private readonly rim=new RingGeometry(.927,1,48).rotateX(-Math.PI/2)
  private readonly line=new PlaneGeometry(2,1).rotateX(-Math.PI/2).translate(0,0,.5)
  private readonly slashFan=fan(1.12)
  private readonly barrageFan=fan(.755)
  private readonly beam=new BoxGeometry(2,.36,1).translate(0,0,.5)
  private readonly orange=tint(0xff963d,.39)
  private readonly edge=tint(0xffb657,.85)
  private readonly purple=tint(0xb038e4,.40)
  private readonly ray=tint(0xe685ff,.85)
  private readonly shards=new OctahedronGeometry(1)
  private readonly pillars=this.batch(this.shards,new MeshStandardMaterial({
    color:0x7831ba, roughness:.31, metalness:.26, emissive:0x310d66, emissiveIntensity:.48,
  }),crystal.limit*3)
  private readonly bullets=this.batch(this.shards,new MeshBasicMaterial({color:0xe69cfb,toneMapped:false}),144)
  private readonly transform=new Object3D()

  private batch(geo:BufferGeometry, material:MeshBasicMaterial|MeshStandardMaterial, capacity:number) {
    const mesh=new InstancedMesh(geo,material,capacity)
    mesh.count=0
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.frustumCulled=false
    this.root.add(mesh)
    return mesh
  }

  clear() {
    for(const g of this.decals.values()) g.removeFromParent()
    this.decals.clear()
    this.bullets.count=this.pillars.count=0
  }

  update(attacks:ShikoukiAttacks) {
    const active=new Set(attacks.hazards)
    for(const [h,g] of this.decals) {
      if(!active.has(h)) { g.removeFromParent(); this.decals.delete(h) }
    }
    for(const h of active) {
      const g=this.decals.get(h)??this.addDecal(h)
      g.rotation.y=h.angle
      const fill=g.children[0] as Mesh
      fill.material=h.live?this.purple:this.orange
      if(h.beam) g.children[1].visible=h.live
    }

    const transform=this.transform
    let count=0
    for(const c of attacks.crystals) for(let i=0;i<3;i++) {
      const lift=Math.min(1,.16+(attacks.time-c.at)*6)
      const side=i===0?0:i===1?-.32:.34
      transform.position.set(c.center.x+side,c.center.y+(i===0?1.08:.66)*lift,c.center.z+(i===2?.28:0))
      transform.rotation.set(.10*i,0,side*.65)
      transform.scale.set(i===0?.40:.26,(i===0?1.08:.61)*lift,i===0?.4:.27)
      transform.updateMatrix()
      this.pillars.setMatrixAt(count++,transform.matrix)
    }
    this.pillars.count=count
    this.pillars.instanceMatrix.needsUpdate=count>0
    count=0
    for(const bullet of attacks.shots) {
      if(count>=this.bullets.instanceMatrix.count) break
      transform.position.copy(bullet.center)
      transform.rotation.set(0,bullet.angle,0)
      transform.scale.set(.21,.21,.52)
      transform.updateMatrix()
      this.bullets.setMatrixAt(count++,transform.matrix)
    }
    this.bullets.count=count
    this.bullets.instanceMatrix.needsUpdate=count>0
  }

  private addDecal(h:Hazard) {
    const g=new Group()
    g.position.copy(h.origin)
    // The flattened coast varies in elevation by less than a quarter unit.
    g.position.y=Math.max(.23,h.origin.y+.075)
    const fill=new Mesh(h.shape==='box'?this.line:h.shape==='fan'?(h.damage?this.slashFan:this.barrageFan):this.disk,this.orange)
    fill.renderOrder=2
    g.add(fill)
    if(h.shape==='box') g.scale.set(h.width,1,h.length)
    else g.scale.set(h.radius,1,h.radius)
    if(h.shape==='circle') {
      const circle=new Mesh(this.rim,this.edge)
      circle.position.y=.012
      circle.renderOrder=3
      g.add(circle)
    }
    if(h.beam) {
      const beam=new Mesh(this.beam,this.ray)
      beam.position.y=.69
      beam.visible=false
      g.add(beam)
    }
    this.root.add(g)
    this.decals.set(h,g)
    return g
  }
}
