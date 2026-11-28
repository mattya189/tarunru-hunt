import { PerspectiveCamera, Vector3 } from 'three'
import type { Battle } from './battle'
import type { Arena } from './world'
import { clamp, damp, flatDistance, forward, wrap, yawTo } from './math'

const chasePitch = .37

export class HuntCamera {
  readonly camera = new PerspectiveCamera(51,1,.10,145)
  yaw = Math.PI
  readonly pitch = chasePitch
  private targetYaw = Math.PI
  private manualLookHold = 0
  private pitchLift = 0
  private focus = new Vector3()
  private target = new Vector3()
  private anchor = new Vector3()
  private normal = new Vector3()
  private desired = new Vector3()
  private aim = new Vector3()
  private subject = new Vector3()
  private secondSubject = new Vector3()
  private screenPoint = new Vector3()
  private dist = 7.45
  private baseFov = 49
  constructor(private arena: Arena) {}
  setArena(arena:Arena) { this.arena=arena }
  resize(width: number, height: number) {
    this.camera.aspect=width/height
    this.baseFov=width<height?57:49
    this.camera.fov=this.baseFov
    this.camera.updateProjectionMatrix()
  }
  reset(battle: Battle) {
    this.yaw = this.targetYaw = Math.PI
    this.manualLookHold = 0
    this.update(1,battle,0,0,true)
  }
  update(dt: number, battle: Battle, lookX: number, shake: number, snap = false, showcase = 0) {
    const camera=this.camera, portrait=camera.aspect<1
    const fieldCamera=this.arena.data.camera
    const victory=battle.outcome==='victory'
    const orbit=showcase>0
    if (orbit) {
      this.arena.updateCameraVisibility(dt)
      this.target.copy(battle.m); this.target.y+=1.84
      this.focus.copy(this.target)
      const a=.41+Math.sin(showcase*.25)*.16
      camera.position.set(battle.m.x+Math.sin(a)*9.8,battle.m.y+3.25,battle.m.z+Math.cos(a)*9.8)
      if(!portrait) this.target.x-=2.10
      camera.lookAt(this.target)
      return
    }
    const locked=battle.lock&&!victory
    const focusMonster=(locked?battle.selectedLockTarget:undefined) ?? battle.cameraMonster
    const target=focusMonster.root.position
    const distanceToMonster=flatDistance(battle.p,target)
    if(victory) this.yaw=this.targetYaw=wrap(this.yaw-dt*.69)
    else {
      this.manualLookHold=Math.max(0,this.manualLookHold-dt)
      if(lookX) {
        this.targetYaw=wrap(this.targetYaw-lookX*.007)
        this.manualLookHold=.85
      }
      if(locked && !this.manualLookHold && distanceToMonster>.5) {
        this.targetYaw=wrap(this.targetYaw+wrap(yawTo(battle.p,target)-this.targetYaw)*damp(5.8,dt))
      }
      this.yaw=wrap(this.yaw+wrap(this.targetYaw-this.yaw)*(snap?1:damp(19,dt)))
    }
    this.target.copy(victory?target:battle.p)
    const view=victory?'victory':portrait?'portrait':'landscape'
    this.target.y+=fieldCamera?.focusHeight[view] ?? (victory?1.42:portrait?1.91:1.58)
    const tracking=fieldCamera?.targetTracking
    if(tracking && !victory) {
      const room=Math.min(tracking.fraction,tracking.distance/Math.max(1,distanceToMonster))
      this.target.x+=(target.x-battle.p.x)*room
      this.target.z+=(target.z-battle.p.z)*room
    }
    if(locked) this.target.addScaledVector(forward(this.yaw,this.normal),Math.min(.65,distanceToMonster*.055))
    this.focus.lerp(this.target,snap?1:damp(victory?3.5:14,dt))
    const closeRoom=victory?0:clamp((4.8-distanceToMonster)/3.2,0,1)
    const baseDistance=fieldCamera?.distance[view] ?? (victory?7.6:portrait?8.65:7.45)
    const spacing=baseDistance+closeRoom*(fieldCamera ? fieldCamera.closeDistance ?? 0 : .95)
    const closeLift=closeRoom*clamp((focusMonster.data.radius-.75)/.40,0,1)*.16
    this.pitchLift+=(closeLift-this.pitchLift)*(snap?1:damp(6,dt))
    const pitch=(fieldCamera?.pitch ?? this.pitch)+(victory?0:this.pitchLift)
    const side=victory||portrait?0:.58
    forward(this.yaw,this.normal)
    this.anchor.copy(this.focus)
    this.anchor.x-=Math.cos(this.yaw)*side
    this.anchor.z+=Math.sin(this.yaw)*side
    // Keep the follow distance independent of foreground scenery.
    this.normal.set(-this.normal.x*Math.cos(pitch),Math.sin(pitch),-this.normal.z*Math.cos(pitch))
    this.dist = snap ? spacing : this.dist+(spacing-this.dist)*damp(7,dt)
    this.desired.copy(this.anchor).addScaledVector(this.normal,this.dist)
    this.desired.y=Math.max(this.desired.y,this.arena.height(this.desired.x,this.desired.z)+.48)
    camera.position.copy(this.desired)
    camera.position.x+=Math.sin(battle.elapsed*68)*shake*.32
    camera.position.y+=Math.cos(battle.elapsed*51)*shake*.20
    this.aim.copy(camera.position).sub(this.normal)
    camera.lookAt(this.aim)
    camera.updateMatrixWorld()
    this.subject.copy(victory?target:battle.p).y+=1.06
    this.secondSubject.copy(target).y+=focusMonster.data.scale*1.25
    this.screenPoint.copy(this.secondSubject).project(camera)
    const monsterInView=!victory && this.screenPoint.z>=-1 && this.screenPoint.z<=1 &&
      Math.abs(this.screenPoint.x)<1.1 && Math.abs(this.screenPoint.y)<1.1
    this.arena.updateCameraVisibility(dt,camera.position,this.subject,monsterInView?this.secondSubject:undefined)
  }
}
