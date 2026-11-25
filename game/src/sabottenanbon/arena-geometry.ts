import { Plane, Vector3 } from 'three'
import type { Arena } from '../world'
import { clamp } from '../math'
import { projectilePosition } from './projectiles.js'
import { pointInBreath, sampleBreath } from './effects.js'
import type { Breath, BreathReader, Shot, SocketReader } from './timeline-types'

const hunterRadius=.40
const capsuleBottom=.40, capsuleTop=1.70
const up=new Vector3(0,1,0)
export class ArenaGeometry {
  private readonly floor=new Plane()
  private readonly planes:Plane[]
  private readonly point=new Vector3()
  private readonly axis=new Vector3()
  private readonly offset=new Vector3()
  private readonly foot=new Vector3(0,capsuleBottom,0)
  private readonly head=new Vector3(0,capsuleTop,0)

  constructor(private arena:Arena) {
    // Tangent planes approximate the circular wall for the frustum. Thorn flight uses the circle directly.
    this.planes=Array.from({length:48},(_,i)=>{
      const a=2*Math.PI*i/48
      return new Plane(new Vector3(Math.cos(a),0,Math.sin(a)),arena.radius)
    })
    this.planes.push(this.floor)
  }

  contact=(shot:Shot, duration:number)=>{
    const gap=(t:number)=>{
      const p=projectilePosition(shot,t,this.point)
      return Math.min(p.y-this.arena.height(p.x,p.z),this.arena.radius-Math.hypot(p.x,p.z))-shot.hit.radius
    }
    let low=0, high=0, found=gap(0)<=0
    for(let i=1;!found&&i<=48;i++){
      high=duration*i/48
      found=gap(high)<=0
      if(!found) low=high
    }
    if(!found) return
    for(let i=0;i<15;i++){
      const mid=(low+high)*.5
      if(gap(mid)>0) low=mid
      else high=mid
    }
    const p=projectilePosition(shot,high,this.point)
    const height=this.arena.height(p.x,p.z)
    const boundary=this.arena.radius-Math.hypot(p.x,p.z)
    if(boundary<p.y-height) {
      const normal=new Vector3(-p.x,0,-p.z).normalize()
      return {time:high,plane:new Plane(normal,this.arena.radius)}
    }
    const slopeX=(this.arena.height(p.x+.04,p.z)-this.arena.height(p.x-.04,p.z))/.08
    const slopeZ=(this.arena.height(p.x,p.z+.04)-this.arena.height(p.x,p.z-.04))/.08
    const normal=new Vector3(-slopeX,1,-slopeZ).normalize()
    return {time:high,plane:new Plane().setFromNormalAndCoplanarPoint(normal,new Vector3(p.x,height,p.z))}
  }

  breath:BreathReader=(event:Breath,time:number,read:SocketReader,full:boolean)=>{
    const socket=read(event.attachment)
    // The local floor tangent keeps the cone's contact on the arena surface.
    const {x,z}=socket.position
    const h=this.arena.height(x,z)
    this.floor.setFromNormalAndCoplanarPoint(up,this.point.set(x,h,z))
    return sampleBreath(event,time,()=>socket,this.planes,full)
  }

  hitsSweep(from:Vector3,to:Vector3,radius:number) {
    // Minimize the distance to the vertical capsule. The squared distance is
    // piecewise quadratic, with breaks where the segment crosses the two cap heights.
    const delta=this.axis.subVectors(to,from)
    const limit=(radius+hunterRadius)**2
    const test=(t:number) => {
      const x=from.x+delta.x*t, y=from.y+delta.y*t, z=from.z+delta.z*t
      return x*x+z*z+(y-clamp(y,capsuleBottom,capsuleTop))**2<=limit
    }
    if(test(0)||test(1)) return true
    const horizontal=delta.x*delta.x+delta.z*delta.z
    if(horizontal>0 && test(clamp(-(from.x*delta.x+from.z*delta.z)/horizontal,0,1))) return true
    for(const cap of [this.foot,this.head]) {
      const length=delta.lengthSq()
      if(length>0 && test(clamp(-this.offset.subVectors(from,cap).dot(delta)/length,0,1))) return true
    }
    return false
  }

  hitsSphere(center:Vector3,hunter:Vector3,radius:number) {
    const y=center.y-hunter.y
    return (center.x-hunter.x)**2+(center.z-hunter.z)**2+
      (y-clamp(y,capsuleBottom,capsuleTop))**2<=(radius+hunterRadius)**2
  }

  hitsBreath(frame:ReturnType<BreathReader>,hunter:Vector3) {
    if(frame.distance<=0) return false
    for(let i=0;i<=8;i++){
      const center=this.point.copy(hunter)
      center.y+=capsuleBottom+(capsuleTop-capsuleBottom)*i/8
      if(pointInBreath(center,frame)) return true
      const offset=this.offset.subVectors(center,frame.position)
      const z=offset.dot(frame.direction), radial=Math.sqrt(Math.max(0,offset.lengthSq()-z*z))
      if(z< -hunterRadius || z>frame.distance+hunterRadius) continue
      const edge=clamp((z+(radial-frame.near)*frame.slope)/(1+frame.slope**2),0,frame.distance)
      const gap=Math.max(0,radial-(frame.near+frame.slope*edge))
      if((z-edge)**2+gap*gap<=hunterRadius*hunterRadius) return true
    }
    return false
  }
}
