import { Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Scene } from 'three'
import type { SoundCue } from '../battle-audio'
import type { MonsterModel } from '../monster-model'
import type { Quality } from '../ui'
import type { Arena } from '../world'
import { clamp } from '../math'
import { ArenaGeometry } from './arena-geometry'
import { AttackEffects } from './effects.js'
import { createSocketReader, planBurst, projectilePosition } from './projectiles.js'
import type { AttackTimeline, Breath, Burst, Shot, SocketReader } from './timeline-types'
import type { SabotAttack, SabotCombatProfile } from './config'
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
  breath?:Breath; breathTime:number; breathStarted:boolean; detonated:boolean
}
type PlaySound=(cue:SoundCue, source:Vector3, intensity?:number)=>void
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

  static async load(scene:Scene,arena:Arena,model:MonsterModel,quality:Quality,profile:SabotCombatProfile,sound:PlaySound) {
    const thorn=await new GLTFLoader().loadAsync(import.meta.env.BASE_URL+'models/sabottenanbon/'+objectData.objects.cinder_thorn.model)
    return new AttackRuntime(arena,model,scene,thorn.scene,quality,profile,sound)
  }

  private constructor(arena:Arena,private readonly model:MonsterModel,scene:Scene,thorn:import('three').Group,quality:Quality,
    readonly profile:SabotCombatProfile,private readonly sound:PlaySound) {
    this.geometry=new ArenaGeometry(arena)
    this.read=createSocketReader(model.root,eventData.sockets)
    this.effects=new AttackEffects({scene,thornModel:thorn,objects:objectData,config:effectData,events:eventData,
      quality,breathReader:this.geometry.breath,thornCapacity:profile.thornCapacity})
    this.effects.glow=.55
  }

  setQuality(quality:Quality) { this.effects.setQuality(quality) }
  get elapsed() { return this.active ? (this.time-this.active.start)*this.active.rate : 0 }
  get glowing() { return this.effects.breathGroup.visible }
  get glowLayer() { return this.effects.breathGroup }

  begin(id:SabotAttack,rate=this.profile.attacks[id].rate) {
    if(!Number.isFinite(rate)||rate<=0) throw new Error("再生速度は正の数で指定してください")
    const timeline=timelineFor(id)
    this.active={timeline,start:this.time,rate,group:++this.group,eventIndex:0,breathTime:-Infinity,breathStarted:false,detonated:false,
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
        if (event.type==='thorn_burst') {
          if (run.timeline.id==='attack_01' && event.id==='head_first') {
            this.sound('sabottenanbon-voice-1',this.model.root.position)
          }
          this.emit(run,event)
        }
        if (run.timeline.id==='special_01' && run.eventIndex===1 && event.type==='thorn_charge') {
          this.sound('sabottenanbon-voice-3',this.model.root.position)
        }
        if (event.type==='detonate_thorns') {
          run.detonated=true
          for (const shot of this.shots) {
            if (shot.group!==run.group || !shot.plant) continue
            if (shot.impactTime<=at+epsilon) shot.detonateTime=at
            else shot.cancelPlant=true
          }
          const player=this.endHunter.copy(previous).lerp(hunter,(at-start)/dt)
          const landed=this.shots.find(shot=>shot.group===run.group && shot.plant && !shot.cancelPlant)
          if (landed) this.sound('emperor-impact',landed.impactCenter,.87)
          this.applyExplosions(at,at,player,hit)
        }
      }
      const local=(end-run.start)*run.rate
      poseAt(run.timeline.id,local,end-this.time)
      const breath=run.breath
      if (breath && !run.breathStarted && local>=breath.start) {
        run.breathStarted=true
        const origin=this.read(breath.attachment).position
        if (run.timeline.id==='attack_05') this.sound('sabottenanbon-voice-2',origin)
        this.sound('breath-fire',origin)
      }
      if (breath && local>=breath.start && local<breath.end && end+epsilon>=run.breathTime &&
          this.geometry.hitsBreath(this.geometry.breath(breath,local,this.read,false),hunter)) {
        run.breathTime=end+breath.hit.tickSeconds
        hit(this.profile.attacks[run.timeline.id].breath,this.read(breath.attachment).position,false)
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
    const base=objectData.objects[event.object as keyof typeof objectData.objects]
    const plant=event.detonateAt!==undefined
    const wave=this.profile.attacks[run.timeline.id].wave
    const flightRate=wave?.flightRate??1
    // Compress flight time without shortening the ballistic path.
    const def=wave?{...base,maxSpeed:base.maxSpeed*flightRate,lifetime:base.lifetime/flightRate,
      acceleration:base.acceleration.map(axis=>axis*flightRate**2)}:base
    const burst:Burst={...event,time:run.start+event.time/run.rate,detonateAt:plant?Infinity:undefined}
    if(wave) Object.assign(burst,{
      countPerEmitter:wave.countPerEmitter,layers:wave.layers,spreadDegrees:event.spreadDegrees*wave.spread,
      speed:event.speed*flightRate,lift:event.lift*flightRate,liftVariance:.43*flightRate,
      hit:{...event.hit,explosionRadius:event.hit.explosionRadius*wave.blastScale},
    })
    const spawned=planBurst(burst,def,this.read,[],this.serial,this.geometry.contact)
    this.serial+=spawned.length
    if(spawned.length) this.sound('thorn-volley',spawned[0].origin)
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
      if(!hit(this.profile.thorn.direct,this.source,false)) continue
      shot.hitHunter=true
      if(!shot.plant) {
        shot.impactTime=shot.detonateTime=b
        shot.duration=b-shot.launchTime
        projectilePosition(shot,shot.duration,shot.impactCenter)
        shot.contactPoint.copy(shot.impactCenter); shot.impactNormal=null
      }
    }
    for(const shot of this.shots) {
      if(!shot.plant && !shot.cancelPlant && shot.detonateTime>this.time && shot.detonateTime<=end) {
        this.sound('thorn-explode',shot.impactCenter,.82)
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
        if(hit(this.profile.thorn.blast,shot.impactCenter,false)) shot.hitHunter=true
      } else if(!this.detonationsHit.has(shot.group)) {
        const d=hunter.distanceToSquared(shot.impactCenter)
        if(d<distance) { distance=d; nearest=shot }
      }
    }
    if(nearest&&hit(this.profile.attacks.special_01.detonation,nearest.impactCenter,true)){
      this.detonationsHit.add(nearest.group)
    }
  }

  private present() {
    this.effects.present(this.active?.timeline,this.elapsed,this.read,this.shots,this.time)
  }
}
