import { BoxGeometry, Color, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, PlaneGeometry, Shape, ShapeGeometry, Vector3, type BufferGeometry } from 'three'
import type { Quality } from '../ui'
import { clamp } from '../math'
import { paper } from './config'
import { type CursePaper, type Zone } from './plan'

const dangerColor=0xf68848
const blastColor=0xff5239
const paperGreen=0x72e976
const paperYellow=0xfedd61
const paperRed=0xff4c43
const point=new Vector3()
const transform=new Object3D()
const tint=new Color()

function disc(half:boolean, outline:boolean) {
  const shape=new Shape(), angle=half?Math.PI:Math.PI*2, steps=half?24:36
  for(let i=0;i<=steps;i++) {
    const a=angle*i/steps-(half?Math.PI:0)
    const x=Math.cos(a), z=Math.sin(a)
    if(i===0) shape.moveTo(x,z)
    else shape.lineTo(x,z)
  }
  if(outline && !half) {
    shape.closePath()
    const hole=new Shape()
    for(let i=steps;i>=0;i--) {
      const angle=i/steps*Math.PI*2
      const x=Math.cos(angle)*.96,z=Math.sin(angle)*.96
      if(i===steps) hole.moveTo(x,z); else hole.lineTo(x,z)
    }
    shape.holes.push(hole)
  } else if(outline) {
    for(let i=steps;i>=0;i--) {
      const a=Math.PI*i/steps-Math.PI
      shape.lineTo(Math.cos(a)*.96,Math.sin(a)*.96-.020)
    }
  }
  shape.closePath()
  return new ShapeGeometry(shape).rotateX(-Math.PI/2)
}

function instances(geometry:BufferGeometry, capacity:number, opacity:number, order:number) {
  const mesh=new InstancedMesh(geometry,new MeshBasicMaterial({
    color:0xffffff, transparent:opacity<1, opacity, depthWrite:opacity===1, side:DoubleSide,
    polygonOffset:true, polygonOffsetFactor:-1,
  }),capacity)
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.count=0
  mesh.frustumCulled=false
  mesh.renderOrder=order
  return mesh
}

function add(mesh:InstancedMesh, p:Vector3,y:number,yaw:number,xScale:number,yScale:number,zScale:number,color:number, pitch=0) {
  if(mesh.count>=mesh.instanceMatrix.count) return
  transform.position.set(p.x,y,p.z); transform.rotation.set(pitch,yaw,0); transform.scale.set(xScale,yScale,zScale)
  transform.updateMatrix()
  mesh.setMatrixAt(mesh.count,transform.matrix); mesh.setColorAt(mesh.count,tint.setHex(color))
  mesh.count++
}
const flashes = 32
const particles = 160
export class PaperVisuals {
  readonly root=new Group()
  quality:Quality='low'
  private readonly circles=instances(disc(false,false),112,.14,4)
  private readonly edges=instances(disc(false,true),112,.58,5)
  private readonly sectors=instances(disc(true,false),8,.18,4)
  private readonly sectorEdges=instances(disc(true,true),8,.70,5)
  private readonly bands=instances(new PlaneGeometry(2,2).rotateX(-Math.PI/2),32,.15,4)
  private readonly bits=instances(new BoxGeometry(1,.085,.62),particles+24,1,8)
  private readonly bursts=instances(disc(false,false),flashes,.27,6)
  private readonly shock=instances(disc(false,true),flashes,.85,7)
  private readonly debugDots=instances(disc(false,false),140,.52,9)
  private readonly meshes=[this.circles,this.edges,this.sectors,this.sectorEdges,this.bands,this.bits,this.bursts,this.shock,this.debugDots]
  private readonly flash=Array.from({length:flashes},()=>({point:new Vector3(),radius:0,at:-10,color:0}))
  private readonly shreds=Array.from({length:particles},()=>({point:new Vector3(),at:-10,life:0,dir:0,speed:0,size:0,color:0}))
  private flashIndex=0
  private shredIndex=0
  private readonly attached=new Mesh(new BoxGeometry(.28,.032,.18),new MeshBasicMaterial({color:paperGreen,side:DoubleSide}))

  constructor(private readonly height:(x:number,z:number)=>number) {
    this.root.add(...this.meshes,this.attached)
    this.clear()
  }

  clear() {
    for(const mesh of this.meshes) mesh.count=0
    for(const flash of this.flash) flash.at=-10
    for(const shred of this.shreds) shred.at=-10
    this.attached.visible=false
    this.root.visible=false
  }

  emit(position:Vector3,time:number,color:number,count:number,speed=2) {
    const limit=Math.ceil(count*(this.quality==='low'?.48:this.quality==='medium'?.75:1))
    for(let i=0;i<limit;i++) {
      const index=this.shredIndex++%this.shreds.length
      const shred=this.shreds[index]
      shred.point.copy(position); shred.at=time; shred.life=.32+(index%9)*.027
      shred.dir=index*2.39996; shred.speed=speed*(.66+(i%5)*.16)
      shred.size=.075+(index%6)*.023; shred.color=color
    }
  }

  blast(zone:Zone,time:number,color=blastColor) {
    const blast=this.flash[this.flashIndex++%this.flash.length]
    blast.point.copy(zone.point); blast.radius=zone.radius; blast.at=time; blast.color=color
    this.emit(zone.point,time,color,zone.radius>6?25:10,zone.radius>6?8:3.5)
  }

  private circle(p:Vector3, radius:number, color:number, yaw=0, half=false) {
    const y=this.height(p.x,p.z)+.034
    add(half?this.sectors:this.circles,p,y,yaw,radius,1,radius,color)
    add(half?this.sectorEdges:this.edges,p,y+.004,yaw,radius,1,radius,color)
  }

  private zone(zone:Zone,color:number) {
    if(zone.end) {
      const dx=zone.end.x-zone.point.x, dz=zone.end.z-zone.point.z
      point.copy(zone.point).lerp(zone.end,.5)
      add(this.bands,point,this.height(point.x,point.z)+.03,Math.atan2(dx,dz),zone.radius,1,Math.hypot(dx,dz)*.5,color)
      this.circle(zone.point,zone.radius,color)
      this.circle(zone.end,zone.radius,color)
    } else this.circle(zone.point,zone.radius,color,zone.yaw,zone.yaw!==undefined)
  }

  draw(now:number,zones:readonly Zone[],papers:readonly CursePaper[],player:Vector3,attachment:number,rage:boolean,boss:Vector3,debug?:{map:Vector3[];path:Vector3[]}) {
    this.root.visible=true
    for(const mesh of this.meshes) mesh.count=0
    for(const zone of zones) if(now>=zone.warn && now<=zone.until) {
      this.zone(zone,zone.kind==='blast'?blastColor:dangerColor)
    }
    for(const stamp of papers) {
      const left=stamp.at-now
      const color=left>paper.yellow?paperGreen:left>paper.red?paperYellow:
        Math.floor(now*22)%2?paperRed:0xffc3a1
      this.circle(stamp.point,stamp.radius,color)
      add(this.bits,stamp.point,this.height(stamp.point.x,stamp.point.z)+.085,stamp.strike*.87,.39,1,.42,color,.19)
    }
    for(const burst of this.flash) {
      const age=now-burst.at
      if(age<0 || age>.33) continue
      const y=this.height(burst.point.x,burst.point.z)+.055
      const r=burst.radius
      add(this.bursts,burst.point,y,0,r,1,r,burst.color)
      const shockRadius=r*clamp(.50+age*3.6,.5,1)
      add(this.shock,burst.point,y+.02,0,shockRadius,1,shockRadius,0xffcd92)
    }
    for(const shred of this.shreds) {
      const age=now-shred.at
      if(age<0 || age>shred.life) continue
      point.set(shred.point.x+Math.sin(shred.dir)*shred.speed*age,0,shred.point.z+Math.cos(shred.dir)*shred.speed*age)
      const lift=.10+Math.sin(Math.PI*age/shred.life)*shred.life*2.6
      add(this.bits,point,this.height(point.x,point.z)+lift,shred.dir+age*14,shred.size,1,shred.size,shred.color,age*9)
    }
    if(rage) for(let i=0;i<(this.quality==='low'?4:8);i++) {
      const angle=now*2.9+i*Math.PI*.5
      point.set(boss.x+Math.sin(angle)*(1.6+.14*i),boss.y,boss.z+Math.cos(angle)*(1.6+.14*i))
      add(this.bits,point,boss.y+.45+(i*.53+now)%1.9,angle,.11,1,.12,i%2?0xfa5544:0xbe2718,angle)
    }
    this.attached.visible=attachment>0
    if(attachment>0) {
      this.attached.position.set(player.x+.34*Math.sin(now*3),player.y+1.26,player.z+.35*Math.cos(now*3))
      this.attached.rotation.set(.52,now*3,.26)
      const fast=attachment<1.2
      this.attached.material.color.setHex(attachment>3.2?paperGreen:!fast?paperYellow:Math.floor(now*22)%2?paperRed:0xffc3a1)
    }
    if(debug) {
      for(const cell of debug.map) add(this.debugDots,cell,this.height(cell.x,cell.z)+.08,0,.24,1,.24,0x987afa)
      for(const step of debug.path) add(this.debugDots,step,this.height(step.x,step.z)+.12,0,.18,1,.18,0x51fdee)
    }
    for(const mesh of this.meshes) {
      if(mesh.count) mesh.instanceMatrix.needsUpdate=true
      if(mesh.instanceColor && mesh.count) mesh.instanceColor.needsUpdate=true
    }
  }
}
