import { Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Scene } from 'three'
import type { MonsterModel } from '../monster-model'
import type { Quality } from '../ui'
import type { Arena } from '../world'
import { clamp } from '../math'
import { ArenaGeometry } from './arena-geometry'
import { AttackEffects } from './effects.js'
import { createSocketReader, planBurst, projectilePosition } from './projectiles.js'
import type { AttackTimeline, Breath, Burst, Shot, SocketReader } from './timeline-types'
import { combat, type SabotAttack } from './config'
import eventData from './attack_events.json'
import objectData from './objects.json'
import effectData from './effects.json'

const timelines=new Map((eventData.attacks as AttackTimeline[]).map(a=>[a.id,{...a,events:[...a.events].sort((x,y)=>x.time-y.time)}]))
const epsilon=1e-7
export const timelineFor=(id:SabotAttack)=>timelines.get(id)!
export { effectData }

interface LiveShot extends Shot {
  plant:boolean; group:number; hitHunter:boolean; cancelPlant:boolean
}
interface TimelineRun {
  timeline:AttackTimeline; start:number; rate:number; group:number; eventIndex:number;
  breath?:Breath; breathTime:number; detonated:boolean
}
type DealDamage=(damage:number,source:Vector3,knockdown:boolean)=>boolean

export class AttackRuntime {
  time=0
  active?:TimelineRun
  private shots:LiveShot[]=[]
  private serial=0
  private group=0
  private detonationsHit=new Set<number>()
  private readonly from=new Vector3()
  private readonly to=new Vector3()
  private readonly startHunter=new Vector3()
  private readonly endHunter=new Vector3()
  private readonly source=new Vector3()
  private readonly sliceStartHunter=new Vector3()
  private readonly sliceEndHunter=new Vector3()
  private readonly geometry:ArenaGeometry
  private readonly read:SocketReader
  private readonly effects:AttackEffects

  static async load(scene:Scene,arena:Arena,model:MonsterModel,quality:Quality) {
    const thorn=await new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'models/sabottenanbon/'+objectData.objects.cinder_thorn.model)
    return new AttackRuntime(arena,model,scene,thorn.scene,quality)
  }

  private constructor(arena:Arena,model:MonsterModel,scene:Scene,thorn:import('three').Group,quality:Quality) {
    this.geometry=new ArenaGeometry(arena)
    this.read=createSocketReader(model.root,eventData.sockets)
    this.effects=new AttackEffects({scene,thornModel:thorn,objects:objectData,config:effectData,events:eventData,quality,breathReader:this.geometry.breath})
    this.effects.glow=.55
  }

  setQuality(quality:Quality) { this.effects.setQuality(quality) }
  get elapsed() { return this.active ? (this.time-this.active.start)*this.active.rate : 0 }
  get glowing() { return this.effects.breathGroup.visible }
  get glowLayer() { return this.effects.breathGroup }

  begin(id:SabotAttack,rate=1) {
    if(!Number.isFinite(rate)||rate<=0) throw new Error("再生速度は正の数で指定してください")
    const timeline=timelineFor(id)
    this.active={timeline,start:this.time,rate,group:++this.group,eventIndex:0,breathTime:-Infinity,detonated:false,
      breath:timeline.events.find((event):event is Breath=>event.type==='breath')}
  }

  interrupt() {
    const run=this.active
    if (!run) return
    if (run.timeline.id==='special_01'&&!run.detonated) this.cancelPlanting(run.group)
    this.active=undefined
    this.present()
  }

  clear() {
    this.active=undefined
    this.time=this.serial=this.group=0
    this.shots=[]
    this.detonationsHit.clear()
    this.present()
  }

  step(dt:number,previous:Vector3,hunter:Vector3,poseAt:(id:SabotAttack,t:number,dt:number)=>void,hit:DealDamage) {
    if(dt<=0) return
    const slices=Math.max(1,Math.ceil(dt*60-epsilon))
    for(let i=0;i<slices;i++){
      const start=this.sliceStartHunter.copy(previous).lerp(hunter,i/slices)
      const end=this.sliceEndHunter.copy(previous).lerp(hunter,(i+1)/slices)
      this.stepSlice(dt/slices,start,end,poseAt,hit)
    }
    this.present()
  }

  private stepSlice(dt:number,previous:Vector3,hunter:Vector3,poseAt:(id:SabotAttack,t:number,dt:number)=>void,hit:DealDamage) {
    const start=this.time, end=start+dt
    const run=this.active
    if (run) {
      const events=run.timeline.events
      while (run.eventIndex<events.length && run.start+events[run.eventIndex].time/run.rate<=end+epsilon) {
        const event=events[run.eventIndex++]
        const at=clamp(run.start+event.time/run.rate,this.time,end)
        this.advanceShots(at,start,dt,previous,hunter,hit)
        poseAt(run.timeline.id,event.time,Math.max(0,at-this.time))
        this.time=at
        if (event.type==='thorn_burst') this.emit(run,event)
        if (event.type==='detonate_thorns') {
          run.detonated=true
          for (const shot of this.shots) {
            if (shot.group!==run.group || !shot.plant) continue
            if (shot.impactTime<=at+epsilon) shot.detonateTime=at
            else shot.cancelPlant=true
          }
          const player=this.endHunter.copy(previous).lerp(hunter,(at-start)/dt)
          this.applyExplosions(at,at,player,hit)
        }
      }
      const local=(end-run.start)*run.rate
      poseAt(run.timeline.id,local,end-this.time)
      const breath=run.breath
      if (breath && local>=breath.start && local<breath.end && end+epsilon>=run.breathTime &&
          this.geometry.hitsBreath(this.geometry.breath(breath,local,this.read,false),hunter)) {
        run.breathTime=end+breath.hit.tickSeconds
        hit(combat.attacks[run.timeline.id].breath,this.read(breath.attachment).position,false)
      }
      if (local+epsilon>=run.timeline.duration &&
          run.eventIndex>=events.length) this.active=undefined
    }
    this.advanceShots(end,start,dt,previous,hunter,hit)
    this.time=end
    this.shots=this.shots.filter(shot=>shot.cancelPlant
      ? end<shot.impactTime
      : end<shot.detonateTime+effectData.effects.thorn_blast.duration)
    for(const group of this.detonationsHit) {
      if(!this.shots.some(shot=>shot.group===group)) this.detonationsHit.delete(group)
    }
  }

  private emit(run:TimelineRun,event:Burst) {
    const def=objectData.objects[event.object as keyof typeof objectData.objects]
    const plant=event.detonateAt!==undefined
    const burst={...event,time:run.start+event.time/run.rate,detonateAt:plant?Infinity:undefined}
    const spawned=planBurst(burst,def,this.read,[],this.serial,this.geometry.contact)
    this.serial+=spawned.length
    this.shots.push(...spawned.map(shot=>({...shot,plant,group:run.group,hitHunter:false,cancelPlant:false})))
  }

  private cancelPlanting(group:number) {
    this.shots=this.shots.filter(shot=>{
      if(shot.group!==group || !shot.plant) return true
      shot.cancelPlant=true
      return shot.impactTime>this.time
    })
  }

  private advanceShots(end:number,start:number,dt:number,previous:Vector3,hunter:Vector3,hit:DealDamage) {
    for(const shot of this.shots) {
      const a=Math.max(shot.launchTime,this.time), b=Math.min(shot.impactTime,end)
      if(shot.hitHunter || b<=a) continue
      const f=this.startHunter.copy(previous).lerp(hunter,clamp((a-start)/dt,0,1))
      const t=this.endHunter.copy(previous).lerp(hunter,clamp((b-start)/dt,0,1))
      projectilePosition(shot,a-shot.launchTime,this.from).sub(f)
      projectilePosition(shot,b-shot.launchTime,this.to).sub(t)
      if(!this.geometry.hitsSweep(this.from,this.to,shot.hit.radius)) continue
      this.source.copy(t).sub(shot.velocity)
      if(!hit(combat.thorn.direct,this.source,false)) continue
      shot.hitHunter=true
      if(!shot.plant) {
        shot.impactTime=shot.detonateTime=b
        shot.duration=b-shot.launchTime
        projectilePosition(shot,shot.duration,shot.impactCenter)
        shot.contactPoint.copy(shot.impactCenter); shot.impactNormal=null
      }
    }
    this.applyExplosions(this.time,end,this.endHunter.copy(previous).lerp(hunter,clamp((end-start)/dt,0,1)),hit)
  }

  private applyExplosions(start:number,end:number,hunter:Vector3,hit:DealDamage) {
    let nearest:LiveShot|undefined
    let distance=Infinity
    for(const shot of this.shots) {
      if(shot.hitHunter || shot.cancelPlant || end+epsilon<shot.detonateTime ||
         start>=shot.detonateTime+shot.hit.explosionDuration ||
         !this.geometry.hitsSphere(shot.impactCenter,hunter,shot.hit.explosionRadius)) continue
      if(!shot.plant) {
        if(hit(combat.thorn.blast,shot.impactCenter,false)) shot.hitHunter=true
      } else if(!this.detonationsHit.has(shot.group)) {
        const d=hunter.distanceToSquared(shot.impactCenter)
        if(d<distance) { distance=d; nearest=shot }
      }
    }
    if(nearest&&hit(combat.attacks.special_01.detonation,nearest.impactCenter,true)){
      this.detonationsHit.add(nearest.group)
    }
  }

  private present() {
    this.effects.present(this.active?.timeline,this.elapsed,this.read,this.shots,this.time)
  }
}
