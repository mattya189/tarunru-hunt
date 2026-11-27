import { Vector3 } from 'three'
import { Battle } from '../battle'
import type { WeaponData } from '../config'
import type { Effects } from '../effects'
import type { HunterModel } from '../hunter'
import type { Controls } from '../input'
import { clamp, damp, flatDistance, forward, pointSegmentSquared, smooth, wrap, yawTo } from '../math'
import type { MonsterModel } from '../monster-model'
import type { Arena } from '../world'
import {
  breathHalfAngle, diveHalfWidth, featherRadius, fireAttacks, fireColor, fireWave,
  normalAttacks, ragePower, weights, type FireAttack,
} from './config'
import { KouenchoVisuals, progressOf } from './visuals'

const flightLift=.72
const recoveryLift=.25
const diveSpeed=15
const shotSpeed=8.2
const twentyDegrees=Math.PI/9
const wingClearance=.20

export class KouenchoBattle extends Battle {
  readonly visuals: KouenchoVisuals
  private current?: FireAttack | 'ultimate'
  private last?: FireAttack
  private streak=0
  private nextDecision=0
  private ultimates=0
  private normalSinceWave=true
  private waveResolved=false
  private waveRadius=0
  private waveRange=0
  private waveStart=new Vector3()
  private previousPlayer=new Vector3()
  private heading=0
  private diveOrigin=new Vector3()
  private diveRange=0
  private locked=false
  private contacted=false
  private lift=flightLift
  private deathLift=0
  private readonly fireDirection=new Vector3()
  private readonly ground=new Vector3()
  private readonly aimOrigin=new Vector3()
  private readonly previous=new Vector3()
  private readonly muzzle=new Vector3()
  private readonly sparkEnd=new Vector3()
  private readonly playerCenter=new Vector3()
  private readonly testPosition=new Vector3()

  constructor(monster: MonsterModel,hunter: HunterModel,arena: Arena,fx: Effects,weapon: WeaponData) {
    super(monster,hunter,arena,fx,weapon)
    this.visuals=new KouenchoVisuals(arena.height,arena.radius)
    this.reset()
  }

  override get defeatDuration() { return 1.65 }

  override reset() {
    super.reset()
    if(!this.visuals) return
    this.current=this.last=undefined
    this.streak=this.ultimates=0
    this.nextDecision=1.35
    this.normalSinceWave=true
    this.waveResolved=this.locked=this.contacted=false
    this.lift=flightLift
    this.monster.setFlightOffset(this.lift)
    this.monster.setEmberGlow(0)
    this.monster.animate('idle',0)
    this.visuals.clear()
  }

  override update(dt: number,input: Controls,viewYaw: number) {
    this.previousPlayer.copy(this.p)
    if(this.outcome==='victory') {
      const time=this.outcomeTime+dt
      const fall=smooth(time/1.30)
      // The rolling body lowers the wing tips during the death clip.
      const clearance=.16+.37*progressOf(time,1.30)
      const initialHeight=Math.max(this.deathLift,.16)
      this.monster.setFlightOffset(clearance+(initialHeight-.16)*(1-fall))
    }
    const wasOver=!!this.outcome
    super.update(dt,input,viewYaw)
    if(!wasOver && this.outcome) {
      this.visuals.clear()
      this.current=undefined
      this.monster.setEmberGlow(0)
      if(this.outcome==='victory') {
        this.deathLift=this.lift
        this.fx.burst(this.monster.emitter('Body',this.muzzle),fireColor,true,.65)
      }
    }
  }

  protected override canInterruptBoss() {
    return !this.current && this.bossState!=='rage'
  }

  private pose(dt: number,lift: number,motion: Parameters<MonsterModel['animate']>[0],progress?: number) {
    this.lift+=(lift-this.lift)*damp(7,dt)
    this.monster.setFlightOffset(this.lift)
    this.monster.animate(motion,dt,progress)
  }

  protected override updateBoss(dt: number) {
    this.visuals.startFrame()
    if(this.current==='ultimate') this.ultimate(dt)
    else if(this.current) this.runAttack(dt,this.current)
    else this.hover(dt)
    if(!this.outcome) this.flyShots(dt)
    if(!this.outcome && this.rage && this.current!=='ultimate') this.bodyFire(9,.36,.13)
    this.visuals.endFrame()
  }

  private hover(dt: number) {
    if(this.bossState==='rage') {
      const progress=progressOf(this.bt,this.monster.duration('enrage'))
      this.pose(dt,flightLift,'enrage',progress)
      this.monster.setEmberGlow(.42*progress)
      if(progress>=1) {
        this.callout=''
        this.setBoss('idle')
      }
      return
    }
    if(this.bossState==='hit') {
      const progress=progressOf(this.bt,this.monster.duration('hit'))
      this.pose(dt,flightLift,'hit',progress)
      if(progress>=1) this.setBoss('idle')
      return
    }
    if(!this.rage && this.bossHp<=this.monster.data.hp*this.monster.data.rage.hpRatio) {
      this.rage=true
      this.setBoss('rage')
      this.callout='怒り · 翼が燃え上がった'
      return
    }
    const waveThreshold=fireWave.thresholds[this.ultimates]
    if(waveThreshold!==undefined && this.elapsed>=this.nextDecision && this.normalSinceWave &&
      this.bossHp<=this.monster.data.hp*waveThreshold) {
      this.start('ultimate')
      return
    }

    const face=yawTo(this.m,this.p)
    const offset=wrap(face-this.bossYaw)
    const {speed,radius,rage,ai}=this.monster.data
    this.bossYaw+=clamp(offset,-ai.turnSpeed*dt,ai.turnSpeed*dt)
    this.monster.root.rotation.y=this.bossYaw
    const distance=flatDistance(this.m,this.p)
    if(this.elapsed>=this.nextDecision && Math.abs(offset)<.65) {
      const attack=this.chooseFireAttack(distance)
      if(attack) {
        this.start(attack)
        return
      }
    }
    if(distance>2.65 && Math.abs(offset)<1.0) {
      if(this.bossState!=='approach') this.setBoss('approach')
      this.moveEntity(this.m,forward(this.bossYaw,this.fireDirection),dt*speed*(this.rage?rage.speed:1),radius+wingClearance,this.p,.44)
      this.pose(dt,flightLift+.07*Math.sin(this.elapsed*6),'walk')
    } else {
      if(this.bossState!=='idle') this.setBoss('idle')
      this.pose(dt,flightLift+.09*Math.sin(this.elapsed*5.4),'idle')
    }
  }

  private chooseFireAttack(distance: number) {
    const row=weights[distance<=3.2?0:distance<=8?1:2]
    const eligible=normalAttacks.map((id,index)=>{
      const range=fireAttacks[id].range
      // Allow a small entry margin for close attacks while the monster is turning.
      const inRange=distance<=(id==='spin'?range+.14:range) && (id!=='dive' || distance>=2.25)
      return inRange && (id!==this.last || this.streak<2)?row[index]:0
    })
    let roll=Math.random()*eligible.reduce<number>((sum,weight)=>sum+weight,0)
    for(let i=0;i<eligible.length;i++) {
      roll-=eligible[i]
      if(roll<0) return normalAttacks[i]
    }
  }

  private start(id: FireAttack | 'ultimate') {
    this.current=id
    this.heading=yawTo(this.m,this.p)
    this.bossYaw=this.heading
    this.monster.root.rotation.y=this.heading
    this.contacted=this.locked=false
    this.setBoss('windup')
    if(id==='ultimate') {
      this.ultimates++
      this.normalSinceWave=this.waveResolved=false
      this.waveRadius=0
      this.callout=this.ultimates===1?'炎の波に合わせて回避！':'全域炎輪'
    } else {
      this.streak=id===this.last?this.streak+1:1
      this.last=id
      const {label,hint}=fireAttacks[id]
      this.callout=label+' · '+hint
    }
  }

  private runAttack(dt: number,id: FireAttack) {
    const move=fireAttacks[id]
    const tempo=this.rage?this.monster.data.rage.tempo:1
    // The feather countdown stays 1.5 seconds in anger so players have the same reaction window.
    const active=move.active/(id==='feathers'||id==='breath'?1:tempo)
    const windup=move.windup/tempo
    const duration=this.monster.duration(move.motion)
    const windupFraction=move.windup/duration
    if(this.bossState==='windup') {
      const progress=progressOf(this.bt,windup)
      if(!this.locked) {
        this.heading+=clamp(wrap(yawTo(this.m,this.p)-this.heading),-2.6*dt,2.6*dt)
        this.bossYaw=this.heading
        this.monster.root.rotation.y=this.heading
      }
      if(id==='dive') this.prepareDive(progress,dt)
      else if(id==='breath' && progress>=.45) this.locked=true
      this.pose(dt,move.lift,move.motion,windupFraction*progress)
      this.tell(id,progress)
      if(progress<1) return
      this.setBoss('attack')
      if(id==='shot') this.launchShots()
      if(id==='feathers') { this.fx.sound('feather-volley',this.m); this.armFeathers() }
      if(id==='breath') { this.breathOrigin(); this.fx.sound('breath-fire',this.muzzle) }
      if(id==='spin' || id==='dive') this.fx.sound(id==='spin'?'beast-spin':'wing-dive',this.m)
    }

    if(this.bossState==='attack') {
      const progress=progressOf(this.bt,active)
      this.pose(dt,id==='dive'?.26:move.lift,move.motion,windupFraction+(1-windupFraction)*progress)
      this.execute(id,progress)
      if(progress>=1) this.recover()
      return
    }

    this.pose(dt,id==='dive'?.18:recoveryLift,'kouenchoRecovery')
    if(this.bt>=move.recovery) {
      this.normalSinceWave=true
      this.finish()
    }
  }

  private prepareDive(progress: number,dt: number) {
    if(this.locked) return
    if(progress<.42) {
      this.moveEntity(this.m,forward(this.heading+Math.PI,this.fireDirection),2.65*dt,this.monster.data.radius+wingClearance,this.p,.44)
      return
    }
    this.locked=true
    this.diveOrigin.copy(this.m)
    this.diveRange=0
    forward(this.heading,this.fireDirection)
    const range=Math.min(fireAttacks.dive.range,Math.max(4,flatDistance(this.m,this.p)+1))
    for(let distance=.25;distance<=range;distance+=.25) {
      this.ground.copy(this.m).addScaledVector(this.fireDirection,distance)
      this.testPosition.copy(this.ground)
      this.arena.resolve(this.testPosition,this.monster.data.radius+wingClearance)
      if(flatDistance(this.ground,this.testPosition)>.02) break
      this.diveRange=distance
    }
  }

  private tell(id: FireAttack,progress: number) {
    const warning=this.visuals.warning
    if(id==='spin') {
      warning.sector(this.m,0,fireAttacks.spin.range,Math.PI,progress,0,fireColor)
      this.wingFire(3,.11,.10)
    } else if(id==='dive') {
      if(this.locked && this.diveRange>0) warning.lane(this.diveOrigin,this.heading,this.diveRange,diveHalfWidth*2,progress,fireColor)
      this.wingFire(5,.23,.17+progress*.08)
    } else if(id==='shot') {
      const muzzle=this.monster.emitter('FireMuzzle',this.muzzle)
      this.sparkEnd.copy(muzzle).y+=.37
      this.visuals.droplets(muzzle,this.sparkEnd,this.elapsed,9,.28*progress,.27*progress)
    } else if(id==='breath') {
      this.breathOrigin()
      warning.sector(this.aimOrigin,this.heading,fireAttacks.breath.range,breathHalfAngle,progress,0,fireColor)
      this.sparkEnd.copy(this.muzzle).y+=.38
      this.visuals.droplets(this.muzzle,this.sparkEnd,this.elapsed,8,.25*progress,.22*progress)
    } else this.wingFire(6,.25,.19)
  }

  private execute(id: FireAttack,progress: number) {
    if(id==='dive') {
      const distance=Math.min(this.diveRange,this.bt*diveSpeed)
      this.previous.set(this.m.x,0,this.m.z)
      this.m.copy(this.diveOrigin).addScaledVector(forward(this.heading,this.fireDirection),distance)
      this.arena.resolve(this.m,this.monster.data.radius+wingClearance)
      this.ground.set(this.m.x,0,this.m.z)
      this.playerCenter.set(this.p.x,0,this.p.z)
      if(this.diveRange>0 && !this.contacted &&
        pointSegmentSquared(this.playerCenter,this.previous,this.ground)<=diveHalfWidth**2) {
        this.contacted=true
        this.hurt(fireAttacks.dive.damage,this.previous)
      }
      this.wingFire(14,.30,.25,1.55)
      if(distance>=this.diveRange && progress<1) this.recover()
    } else if(id==='spin') {
      this.visuals.warning.sector(this.m,0,fireAttacks.spin.range,Math.PI,.48,0,fireColor)
      this.wingFire(13,.26,.24,.62)
      if(!this.contacted && flatDistance(this.m,this.p)<=fireAttacks.spin.range) {
        this.contacted=true
        this.hurt(fireAttacks.spin.damage,this.m)
      }
    } else if(id==='feathers') this.dropFeathers(progress)
    else if(id==='breath') {
      const move=fireAttacks.breath
      const muzzle=this.monster.emitter('FireMuzzle',this.muzzle)
      this.visuals.showBreath(muzzle,this.aimOrigin,this.heading,move.range,this.elapsed)
      const distance=flatDistance(this.aimOrigin,this.p)
      if(!this.contacted && distance<=move.range &&
        (distance<.18 || Math.abs(wrap(yawTo(this.aimOrigin,this.p)-this.heading))<=breathHalfAngle)) {
        this.contacted=this.hurt(move.damage,this.aimOrigin)
      }
    }
  }

  private breathOrigin() {
    this.monster.emitter('FireMuzzle',this.muzzle)
    this.aimOrigin.copy(this.muzzle)
    this.aimOrigin.y=this.arena.height(this.aimOrigin.x,this.aimOrigin.z)
  }

  private launchShots() {
    const muzzle=this.monster.emitter('FireMuzzle',this.muzzle)
    const secondsToTarget=Math.max(.14,flatDistance(muzzle,this.p)/shotSpeed)
    const dropRate=Math.max(2.8,(muzzle.y-this.p.y-.82)/secondsToTarget)
    this.visuals.shots.forEach((shot,index)=>{
      const yaw=this.heading+(index-1)*twentyDegrees
      shot.position.copy(muzzle)
      shot.velocity.copy(forward(yaw,this.fireDirection)).multiplyScalar(shotSpeed)
      shot.age=0
      shot.dropRate=dropRate
      shot.active=true
      shot.show(yaw)
    })
    this.fx.burst(muzzle,0xffab33,false,.33)
    this.fx.sound('flame-shot',muzzle)
  }

  private flyShots(dt: number) {
    const shots=this.visuals.shots
    const range=fireAttacks.shot.range
    for(const shot of shots) {
      if(!shot.active) continue
      shot.from.copy(shot.position)
      shot.age+=dt
      shot.position.addScaledVector(shot.velocity,dt)
      const floor=this.arena.height(shot.position.x,shot.position.z)
      shot.position.y=Math.max(floor+.72,shot.position.y-shot.dropRate*dt)
      this.playerCenter.copy(this.p).y+=.92
      if(shot.age*shotSpeed>range || Math.hypot(shot.position.x,shot.position.z)>this.arena.radius) shot.active=false
      else if(pointSegmentSquared(this.playerCenter,shot.from,shot.position)<=.58**2) {
        this.hurt(fireAttacks.shot.damage,shot.from)
        this.fx.burst(shot.position,0xffa035,false,.26)
        shot.active=false
      }
      shot.show(Math.atan2(shot.velocity.x,shot.velocity.z))
    }
  }

  private armFeathers() {
    const marks=this.visuals.marks
    const angle=yawTo(this.m,this.p)
    marks[0].center.copy(this.p)
    for(let i=0;i<marks.length;i++) {
      const mark=marks[i]
      if(i>0) {
        // Near the coast, rotate each offset until it fits without crossing another mark.
        const preferred=angle+(i===1?1:-1)*Math.PI*.56
        for(let step=0;step<12;step++) {
          mark.center.copy(this.p).addScaledVector(forward(preferred+step*Math.PI/6,this.fireDirection),3.28)
          if(Math.hypot(mark.center.x,mark.center.z)<this.arena.radius-.10 &&
            marks.slice(0,i).every(other=>flatDistance(mark.center,other.center)>=2*featherRadius+.04)) break
        }
      }
      mark.center.y=this.arena.height(mark.center.x,mark.center.z)
      this.monster.emitter(i===2?'FireWingR':'FireWingL',mark.from)
      mark.armed=true
    }
  }

  private dropFeathers(progress: number) {
    for(const [index,mark] of this.visuals.marks.entries()) {
      if(!mark.armed) continue
      if(progress<1) {
        this.visuals.featherAt(index,progress,featherRadius)
        this.sparkEnd.copy(mark.feather.position).y+=.23
        this.visuals.droplets(mark.feather.position,this.sparkEnd,this.elapsed,5,.16,.14,index*.21)
      } else {
        mark.armed=false
        this.fx.ring(mark.center,.42,featherRadius,.33,0xffa434)
        this.fx.burst(mark.center,fireColor,true,.56)
        this.fx.sound('thorn-explode',mark.center,.83)
        if(flatDistance(mark.center,this.p)<=featherRadius) this.hurt(fireAttacks.feathers.damage,mark.center)
      }
    }
  }

  private ultimate(dt: number) {
    if(this.bossState==='windup') {
      const progress=progressOf(this.bt,fireWave.windup)
      this.pose(dt,.96,'ultimateCharge',progress)
      const heat=progressOf(this.bt-.5,2.5)
      if(heat>0) {
        this.monster.setEmberGlow(.40+.60*heat)
        this.bodyFire(20,.68,.18+.22*heat)
        this.wingFire(5,.36,.22)
        this.visuals.warning.sector(this.m,0,2.35,Math.PI,heat,1.95,fireColor)
      }
      if(progress>=1) this.setBoss('attack')
      return
    }
    if(this.bossState==='attack') {
      const time=this.bt-fireWave.spin
      this.pose(dt,.96,'special',progressOf(this.bt,fireWave.spin))
      if(time<0) {
        this.bodyFire(23,.86,.31)
        this.wingFire(9,.40,.26)
        return
      }
      if(!this.locked) {
        this.locked=true
        this.monster.setEmberGlow(this.rage?.42:.10)
        this.waveStart.copy(this.m)
        this.waveRange=Math.hypot(this.m.x,this.m.z)+this.arena.radius+fireWave.halfWidth
        this.fx.burst(this.waveStart,0xffa32a,true,1.25)
        this.fx.sound('fire-wave',this.waveStart)
        this.visuals.warning.hide()
      }
      const radius=this.waveRange*progressOf(time,fireWave.travel)
      this.visuals.waveAt(this.waveStart,radius,this.elapsed)
      this.checkWave(radius)
      this.waveRadius=radius
      if(time>=fireWave.travel) this.recover()
      return
    }
    this.pose(dt,recoveryLift,'kouenchoRecovery')
    if(this.bt>=fireWave.recovery) this.finish()
  }

  private checkWave(radius: number) {
    if(this.waveResolved) return
    // Subtract the radius at both ends of the fixed step. Sweeping that signed
    // separation prevents a fast ring from tunnelling through a moving hunter.
    const before=flatDistance(this.previousPlayer,this.waveStart)-this.waveRadius
    const after=flatDistance(this.p,this.waveStart)-radius
    if(Math.min(before,after)>fireWave.halfWidth || Math.max(before,after)<-fireWave.halfWidth) return
    this.waveResolved=true
    this.hurt(fireWave.damage,this.waveStart,true)
  }

  private bodyFire(count: number,spread: number,size: number) {
    const center=this.monster.emitter('Body',this.muzzle)
    this.sparkEnd.copy(center).y+=1.34
    this.visuals.droplets(center,this.sparkEnd,this.elapsed,count,spread,size)
  }

  private wingFire(count: number,spread: number,size: number,length=.48) {
    for(const name of ['FireWingL','FireWingR']) {
      const wing=this.monster.emitter(name,this.muzzle)
      this.sparkEnd.copy(wing).addScaledVector(forward(this.heading,this.fireDirection),-length)
      this.sparkEnd.y+=.44
      this.visuals.droplets(wing,this.sparkEnd,this.elapsed,count,spread,size,name==='FireWingL'?0:.43)
    }
  }

  private hurt(damage: number,source: Vector3,unblockable=false) {
    if(this.outcome) return false
    return this.damagePlayer({damage,knockdown:false},source,this.weapon.hp/100*(this.rage?ragePower:1),1,
      unblockable?'dodge-only':undefined)
  }

  private recover() {
    this.visuals.hideAttack()
    this.monster.setEmberGlow(this.rage?.42:0)
    this.setBoss('recovery')
    if(!this.outcome) this.callout=this.current==='ultimate'?'疲労 · 大きな隙':'攻撃後の隙'
  }

  private finish() {
    this.current=undefined
    this.nextDecision=this.elapsed+.64+Math.random()*.38
    this.callout=''
    this.setBoss('idle')
  }
}
