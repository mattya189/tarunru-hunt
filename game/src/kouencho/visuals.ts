import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Group, IcosahedronGeometry, InstancedMesh,
  Mesh, MeshBasicMaterial, Object3D, Shape, ShapeGeometry, Vector3,
} from 'three'
import { clamp } from '../math'
import { GroundWarning } from '../raven/visuals'
import { breathHalfAngle, fireColor, fireWave } from './config'

const segments = 160
const emberColors = [new Color(0xe93813), new Color(0xff7917), new Color(0xffbd40)]
const waveDirections = Array.from({length:segments},(_,i)=>{
  const angle=i*Math.PI*2/segments
  return {x:Math.sin(angle),z:Math.cos(angle)}
})

function material(color: number, opacity=1) {
  return new MeshBasicMaterial({color,opacity,transparent:opacity<1,depthWrite:opacity===1,side:DoubleSide,toneMapped:false})
}

export class FireBall {
  readonly mesh = new Group()
  readonly from = new Vector3()
  readonly position = new Vector3()
  readonly velocity = new Vector3()
  readonly trail: Mesh
  age = 0
  dropRate = 0
  active = false

  constructor(sphere: BufferGeometry, red: MeshBasicMaterial, gold: MeshBasicMaterial, smoke: MeshBasicMaterial) {
    const core=new Mesh(sphere,gold)
    const flame=new Mesh(sphere,red)
    this.trail=new Mesh(sphere,smoke)
    core.scale.setScalar(.16)
    flame.scale.set(.26,.25,.29)
    this.mesh.add(core,flame,this.trail)
    this.mesh.visible=false
  }

  show(yaw: number) {
    this.mesh.visible=this.active
    this.mesh.position.copy(this.position)
    this.mesh.rotation.y=yaw
    const length=.42+.32*Math.min(1,this.age*4)
    this.trail.scale.set(.15,.15,length)
    this.trail.position.z=-length*.76
  }
}

export class KouenchoVisuals {
  readonly root = new Group()
  readonly warning: GroundWarning
  readonly marks: {center: Vector3; from: Vector3; warning: GroundWarning; feather: Mesh; armed: boolean}[]
  readonly shots: FireBall[]
  private readonly wave: Mesh<BufferGeometry,MeshBasicMaterial>
  private readonly breath: Mesh<BufferGeometry,MeshBasicMaterial>
  private readonly sparks: InstancedMesh
  private sparkCursor = 0
  private readonly transform = new Object3D()
  private readonly breathEnd = new Vector3()

  constructor(private height: (x: number,z: number)=>number, private arenaRadius: number) {
    this.warning=new GroundWarning(height)
    this.warning.mesh.renderOrder=2
    const sphere=new IcosahedronGeometry(1,1)
    const red=material(0xf64e1c,.68)
    const gold=material(0xffb72b)
    const smoke=material(0xbc3414,.58)
    this.shots=Array.from({length:3},()=>new FireBall(sphere,red,gold,smoke))

    const shape=new Shape()
    shape.moveTo(0,-.33)
    shape.quadraticCurveTo(-.22,-.04,-.17,.18)
    shape.quadraticCurveTo(-.09,.40,.13,.57)
    shape.quadraticCurveTo(.20,.19,.11,-.04)
    shape.lineTo(0,-.33)
    const featherGeometry=new ShapeGeometry(shape,4)
    this.marks=Array.from({length:3},()=>{
      const warning=new GroundWarning(height)
      const feather=new Mesh(featherGeometry,gold)
      return {center:new Vector3(),from:new Vector3(),warning,feather,armed:false}
    })

    const waveGeometry=new BufferGeometry()
    waveGeometry.setAttribute('position',new BufferAttribute(new Float32Array(segments*9),3).setUsage(DynamicDrawUsage))
    const colors=new Float32Array(segments*9)
    const indices: number[]=[]
    for(let i=0;i<segments;i++) {
      const a=i*3,b=((i+1)%segments)*3
      indices.push(a,b,a+1,b,b+1,a+1,a+1,b+1,a+2,b+1,b+2,a+2)
      emberColors[0].toArray(colors,a*3)
      emberColors[2].toArray(colors,a*3+3)
      emberColors[0].toArray(colors,a*3+6)
    }
    waveGeometry.setIndex(indices)
    waveGeometry.setAttribute('color',new BufferAttribute(colors,3))
    this.wave=new Mesh(waveGeometry,material(0xffffff,.89))
    this.wave.material.vertexColors=true
    this.wave.frustumCulled=false
    this.wave.renderOrder=4
    this.wave.material.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 arenaPosition;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\narenaPosition = position.xz;')
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 arenaPosition;')
        .replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>\nif (dot(arenaPosition, arenaPosition) > ${(this.arenaRadius**2).toFixed(4)}) discard;`)
    }

    const breathGeometry=new BufferGeometry()
    breathGeometry.setAttribute('position',new BufferAttribute(new Float32Array(18*3),3).setUsage(DynamicDrawUsage))
    this.breath=new Mesh(breathGeometry,material(0xb93013,.45))
    this.breath.frustumCulled=false
    this.breath.renderOrder=3

    this.sparks=new InstancedMesh(sphere,material(0xffffff,.78),52)
    this.sparks.instanceMatrix.setUsage(DynamicDrawUsage)
    this.sparks.frustumCulled=false
    this.sparks.renderOrder=5
    this.root.add(this.warning.mesh,this.wave,this.breath,this.sparks,...this.shots.map(shot=>shot.mesh))
    for(const {warning,feather} of this.marks) this.root.add(warning.mesh,feather)
    this.clear()
  }

  droplets(from: Vector3, to: Vector3, time: number, count: number, spread: number, size: number, seed=0) {
    const transform=this.transform
    for(let i=0;i<count && this.sparkCursor<this.sparks.instanceMatrix.count;i++) {
      const phase=(i/count+time*(1.45+(i%3)*.19)+seed)%1
      const angle=i*2.39996+time*4+seed*5
      const radius=spread*(.24+.76*phase)*(.36+(i%5)*.16)
      transform.position.lerpVectors(from,to,phase)
      transform.position.x+=Math.cos(angle)*radius
      transform.position.y+=.6*radius+Math.sin(angle)*radius*.4
      transform.position.z+=Math.sin(angle)*radius
      const flame=size*(1-.68*phase)
      transform.scale.set(flame*.62,flame*(1.2+(i%3)*.55),flame*.61)
      transform.rotation.set(.15*Math.cos(angle),0,.22*Math.sin(angle))
      transform.updateMatrix()
      this.sparks.setMatrixAt(this.sparkCursor,transform.matrix)
      this.sparks.setColorAt(this.sparkCursor,emberColors[i%3])
      this.sparkCursor++
    }
  }

  startFrame() { this.sparkCursor=0 }
  endFrame() {
    this.sparks.count=this.sparkCursor
    if(!this.sparkCursor) return
    this.sparks.instanceMatrix.needsUpdate=true
    if(this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate=true
  }

  waveAt(center: Vector3,radius: number,time: number) {
    const position=this.wave.geometry.attributes.position
    const inner=Math.max(0,radius-fireWave.halfWidth), outer=radius+fireWave.halfWidth
    const write=(vertex: number,distance: number,direction: {x:number;z:number},lift: number)=>{
      const x=center.x+direction.x*distance,z=center.z+direction.z*distance
      position.setXYZ(vertex,x,this.height(x,z)+lift,z)
    }
    for(let i=0;i<segments;i++) {
      const crest=.21+.65*Math.pow(.5+.5*Math.sin(i*.72-time*22),2)+.16*Math.sin(i*1.65+time*21)
      const direction=waveDirections[i]
      write(i*3,inner,direction,.075)
      write(i*3+1,radius,direction,crest)
      write(i*3+2,outer,direction,.075)
    }
    position.needsUpdate=true
    this.wave.visible=true
  }

  showBreath(from: Vector3,ground: Vector3,yaw: number,range: number,time: number) {
    const position=this.breath.geometry.attributes.position
    let vertex=0
    const endpoint=(angle: number)=>{
      const x=ground.x+Math.sin(angle)*range,z=ground.z+Math.cos(angle)*range
      position.setXYZ(vertex++,x,this.height(x,z)+.34,z)
    }
    for(let i=0;i<6;i++) {
      position.setXYZ(vertex++,from.x,from.y,from.z)
      endpoint(yaw-breathHalfAngle+2*breathHalfAngle*i/6)
      endpoint(yaw-breathHalfAngle+2*breathHalfAngle*(i+1)/6)
    }
    position.needsUpdate=true
    this.breath.visible=true
    this.warning.sector(ground,yaw,range,breathHalfAngle,.53,0,fireColor)
    for(let i=-3;i<=3;i++) {
      const turn=yaw+breathHalfAngle*i/3
      const x=ground.x+Math.sin(turn)*range,z=ground.z+Math.cos(turn)*range
      this.breathEnd.set(x,this.height(x,z)+.25,z)
      this.droplets(from,this.breathEnd,time,4,.42,.27,(i+3)*.19)
    }
  }

  featherAt(index: number,progress: number,radius: number) {
    const mark=this.marks[index]
    mark.warning.sector(mark.center,0,radius,Math.PI,progress,0,fireColor)
    const position=mark.feather.position
    position.lerpVectors(mark.from,mark.center,progress)
    position.y=mark.center.y+.16+(mark.from.y-mark.center.y)*Math.pow(1-progress,1.55)
    mark.feather.rotation.set(-.46,progress*5+index*1.7,progress*3+.3)
    mark.feather.visible=true
  }

  hideAttack() {
    this.warning.hide()
    this.breath.visible=false
    this.wave.visible=false
    for(const mark of this.marks) { mark.warning.hide(); mark.feather.visible=false; mark.armed=false }
  }

  clear() {
    this.hideAttack()
    this.startFrame()
    this.endFrame()
    for(const shot of this.shots) { shot.active=false; shot.mesh.visible=false }
  }

  dispose() {
    const geometries=new Set<BufferGeometry>()
    const materials=new Set<MeshBasicMaterial>()
    this.root.traverse(object=>{
      if(!(object instanceof Mesh)) return
      geometries.add(object.geometry)
      materials.add(object.material)
      if(object instanceof InstancedMesh) object.dispose()
    })
    for(const geometry of geometries) geometry.dispose()
    for(const surface of materials) surface.dispose()
    this.root.removeFromParent()
  }
}

export const progressOf = (time: number,duration: number) => clamp(time/duration,0,1)
