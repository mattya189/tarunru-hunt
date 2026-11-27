import { Vector3 } from 'three'
import { Battle } from '../battle'
import { clamp, flatDistance, forward, pointSegmentSquared, wrap, yawTo } from '../math'
import { attacks, baseDamage, circle, decisionDelay, feather, laser, normalWeights, rageDuration, ragePower, type NormalAttack, type RavenAttack } from './config'
import { RavenVisuals } from './visuals'

const markInterval=.55
const markFuse=.9
const armInterval=.35
const armAngle=Math.PI/3
const magenta=0xe949a0
const turnTolerance=.26
const ultimateHp=.60

export class RavenBattle extends Battle {
  readonly visuals=new RavenVisuals(this.arena.height)
  private current?: RavenAttack
  private last?: NormalAttack
  private streak=0
  private rearTime=0
  private ultimateReady=0
  private nextDecisionAt=0
  private readonly readyAt=new Map<NormalAttack,number>()
  private readonly travel=new Vector3()
  private readonly source=new Vector3()
  private readonly ground=new Vector3()
  private readonly destination=new Vector3()
  private readonly playerFlat=new Vector3()
  private readonly ravenDirection=new Vector3()
  private readonly tip=new Vector3()
  private readonly from=new Vector3()
  private readonly muzzle=new Vector3()
  private readonly eyeLanes=[new Vector3(),new Vector3()]
  private readonly eyeYaws=Array<number>(8).fill(0)
  private events=0
  private firedEyes=0
  private chargedHit=false
  private beamReady=0
  private dustReady=0
  private terminated=false
  private heading=0
  private movingAside=0
  private activeCompleted=false

  override get defeatDuration() { return 2.5 }

  override reset() {
    this.monster.groundHeight=this.arena.height
    super.reset()
    this.current=this.last=undefined
    this.streak=this.rearTime=this.ultimateReady=this.nextDecisionAt=this.movingAside=0
    this.terminated=false
    this.readyAt?.clear()
    this.visuals?.clear()
    this.monster.setEyeGlow(0,false)
  }

  override update(...args:Parameters<Battle['update']>) {
    super.update(...args)
    if(this.outcome && !this.terminated) {
      this.terminated=true
      this.current=undefined
      this.visuals.clear()
      this.monster.setEyeGlow(this.rage ? .53 : 0,false)
    } else if(!this.outcome) this.visuals.syncFeathers()
  }

  protected override canInterruptBoss() {
    return !this.current && this.bossState!=='rage' && this.bossState!=='recovery'
  }

  protected override updateBoss(dt:number) {
    this.playerFlat.set(this.p.x,0,this.p.z)
    this.updateObjects(dt)
    if(this.outcome) return
    if(this.rage) this.visuals.rage(this.m,this.bossYaw,this.elapsed)
    if(this.current) {
      this.runAttack(this.current,dt)
      return
    }

    if(this.bossState==='rage') {
      this.monster.animate('enrage',dt,clamp(this.bt/rageDuration,0,1))
      if(this.bt>=rageDuration) this.idle()
      return
    }
    const ratio=this.bossHp/this.monster.data.hp
    if(ratio<=ultimateHp && this.elapsed>=this.ultimateReady) {
      this.start('ultimate')
      return
    }
    if(!this.rage && ratio<=this.monster.data.rage.hpRatio) {
      this.rage=true
      this.setBoss('rage')
      this.callout='怒り · 邪眼が赤紫に染まった'
      this.monster.setEyeGlow(.58,true)
      this.fx.ring(this.m,.7,3.5,.55,magenta)
      this.monster.animate('enrage',dt,0)
      return
    }
    if(this.bossState==='hit' || this.bossState==='stagger' || this.bossState==='fall') {
      const duration=this.bossState==='hit' ? .24 : this.bossState==='stagger' ? .48 : .7
      this.monster.animate('hit',dt,clamp(this.bt/duration,0,1))
      if(this.bt>=duration) this.idle()
      return
    }

    const distance=flatDistance(this.m,this.p)
    const yaw=yawTo(this.m,this.p)
    const angle=wrap(yaw-this.bossYaw)
    this.rearTime=Math.abs(angle)>Math.PI*.58 ? this.rearTime+dt : Math.max(0,this.rearTime-dt*.65)
    const next=this.elapsed>=this.nextDecisionAt?this.chooseRavenAttack(distance,angle):undefined
    if(next) {
      this.start(next)
    } else if(Math.abs(angle)>turnTolerance) {
      this.bossYaw+=clamp(angle,-dt*this.monster.data.ai.turnSpeed,dt*this.monster.data.ai.turnSpeed)
      this.monster.root.rotation.y=this.bossYaw
      if(this.bossState!=='turn') this.setBoss('turn')
      this.monster.animate(angle>0?'turn':'turnRight',dt)
    } else if(distance>2.25) {
      if(this.bossState!=='approach') this.setBoss('approach')
      const speed=this.monster.data.speed*(this.rage?this.monster.data.rage.speed:1)
      this.travel.copy(this.m)
      this.moveEntity(this.m,forward(yaw+this.movingAside,this.ravenDirection),dt*speed,this.monster.data.radius,this.p,.44)
      if(flatDistance(this.m,this.travel)<dt*speed*.45) {
        const inward=yawTo(this.m,this.source.set(0,0,0))
        this.movingAside=wrap(inward-yaw)>=0?1.15:-1.15
      } else if(this.movingAside) this.movingAside*=.98
      this.monster.animate('walk',dt*(this.rage?1.25:1))
    } else {
      this.monster.animate('idle',dt)
    }
  }

  private idle() {
    this.callout=''
    this.setBoss('idle')
  }

  private chooseRavenAttack(distance:number,angle:number) {
    const ready=(id:NormalAttack) => this.elapsed>=(this.readyAt.get(id)??0) && (id!==this.last || this.streak<2)
    if(distance<=attacks.spin.range && this.rearTime>.30 && ready('spin')) return 'spin'
    if(Math.abs(angle)>turnTolerance) return undefined
    const weights=normalWeights[distance<=3.1?0:distance<=9?1:2]
    let total=0
    const eligible=weights.filter(([id,weight])=>{
      if(!ready(id) || id==='laser' && distance>19 || id==='feathers' && distance>21 || id==='charge' && (distance<2.70 || distance>14)) return false
      total+=weight
      return true
    })
    let roll=Math.random()*total
    for(const [id,weight] of eligible) {
      roll-=weight
      if(roll<0) return id
    }
    return undefined
  }

  private start(id:RavenAttack) {
    this.firedEyes=0
    if (id==='laser') this.fx.sound('beam-charge',this.m)
    this.current=id
    this.events=0
    this.activeCompleted=false
    this.chargedHit=false
    this.beamReady=this.dustReady=0
    this.heading=id==='spin' || id==='ultimate'?this.bossYaw:yawTo(this.m,this.p)
    this.bossYaw=this.heading
    this.monster.root.rotation.y=this.heading
    if(id==='ultimate') this.ultimateReady=this.elapsed+attacks.ultimate.cooldown
    else {
      this.streak=id===this.last?this.streak+1:1
      this.last=id
    }
    this.setBoss('windup')
    this.callout=attacks[id].name+' · '+attacks[id].hint
    this.monster.animate(this.motion(id),0,0)
    this.warn(id,0)
  }

  private motion(id:RavenAttack) {
    return id==='arms' && this.rage?'ravenArmsRage':attacks[id].motion
  }

  private windup(id:RavenAttack) {
    return attacks[id].windup/(this.rage?this.monster.data.rage.tempo:1)
  }

  private activeDuration(id:RavenAttack) {
    if(id==='arms' && this.rage) return .80
    if(id==='marks') return (this.rage?4:2)*markInterval+markFuse
    return attacks[id].active
  }

  private runAttack(id:RavenAttack,dt:number) {
    const attack=attacks[id]
    const motion=this.motion(id)
    if(this.bossState==='windup') {
      const progress=clamp(this.bt/this.windup(id),0,1)
      if(id==='charge' && progress<.72) {
        const angle=wrap(yawTo(this.m,this.p)-this.heading)
        this.heading+=clamp(angle,-dt*2.5,dt*2.5)
        this.monster.root.rotation.y=this.heading
      }
      this.warn(id,progress)
      this.monster.animate(motion,dt,.30*progress)
      if(progress>=1) {
        this.bossYaw=this.heading
        this.visuals.zone.hide()
        this.visuals.hideLines()
        this.setBoss('attack')
        if(id==='laser') this.fx.sound('beam-release',this.m)
        if(id==='charge') this.fx.sound('beast-rush',this.m)
        this.execute(id,0)
      }
      return
    }
    if(this.bossState==='attack') {
      const duration=this.activeDuration(id)
      const time=Math.min(this.bt,duration)
      if(id==='spin') this.monster.root.rotation.y=this.heading+time/duration*Math.PI*2
      if(id==='charge') this.charge(Math.min(dt,Math.max(0,duration-this.bt+dt)))
      this.monster.animate(motion,dt,this.actionFrame(id,time,duration))
      if(id!=='charge') this.execute(id,time)
      if(time>=duration || this.activeCompleted) {
        this.visuals.zone.hide()
        this.visuals.hideLines()
        this.visuals.hideBeams()
        if(id==='ultimate') this.visuals.clearUltimate()
        this.monster.setEyeGlow(this.rage ? .58 : 0,this.rage)
        this.setBoss('recovery')
        if(!this.outcome) this.callout='攻撃後の隙'
      }
      return
    }

    this.monster.animate(motion,dt,.8+.2*clamp(this.bt/attack.recovery,0,1))
    if(this.bt>=attack.recovery) {
      if(id!=='ultimate') this.readyAt.set(id,this.elapsed+attack.cooldown)
      this.current=undefined
      this.nextDecisionAt=this.elapsed+decisionDelay
      this.idle()
    }
  }

  private actionFrame(id:RavenAttack,time:number,duration:number) {
    // Impact keys in the asset align with the same combat clock as the hit tests.
    if(id==='arms') {
      const second=this.rage ? .52 : .65
      if(time<=armInterval) return .30+(second-.30)*time/armInterval
      if(this.rage && time<=2*armInterval) return second+(.74-second)*(time-armInterval)/armInterval
      const finalTime=this.rage ? .70 : .35
      const finalPose=this.rage ? .74 : second
      return finalPose+(.80-finalPose)*(time-finalTime)/(duration-finalTime)
    }
    if(id==='ultimate') {
      if(time<=circle.featherTime) return .30+(.66-.30)*time/circle.featherTime
      return .66+(.80-.66)*(time-circle.featherTime)/(circle.shockTime-circle.featherTime)
    }
    return .30+.50*time/duration
  }

  private warn(id:RavenAttack,progress:number) {
    const visuals=this.visuals
    switch(id) {
      case 'arms': visuals.zone.sector(this.m,this.heading,3,armAngle,progress); break
      case 'spin': visuals.zone.sector(this.m,this.heading,4.5,Math.PI,progress); break
      case 'laser':
        this.normalBeamLanes(0,false,progress)
        visuals.zone.sector(this.m,this.heading,18,laser.sweep+.08,progress,2,0xb34b83)
        this.monster.setEyeGlow(.30+.62*progress,this.rage)
        break
      case 'feathers':
        this.featherWarning(this.heading,this.rage?11:7,feather.angle,progress)
        break
      case 'charge': visuals.zone.lane(this.m,this.heading,12,2.40,progress); break
      case 'marks': this.monster.setEyeGlow(.3+.54*progress,this.rage); break
      case 'ultimate':
        visuals.zone.sector(this.m,0,6,Math.PI,progress,5.73,magenta)
        this.monster.setEyeGlow(.48+.48*progress,this.rage)
        break
    }
  }

  private execute(id:RavenAttack,time:number) {
    switch(id) {
      case 'arms': this.arms(time); break
      case 'spin': this.spin(time); break
      case 'laser': this.normalBeamLanes(clamp(time/attacks.laser.active,0,1),true,1); break
      case 'feathers':
        if(this.events===0) {
          this.events=1
          this.launchFeathers(this.heading,this.rage?11:7,feather.angle,false)
        }
        break
      case 'charge': break
      case 'marks': this.placeMarks(time); break
      case 'ultimate': this.ultimate(time); break
    }
  }

  private hurt(multiplier:number,source:Vector3,knockdown=false,push=.18) {
    if(this.outcome) return false
    return this.damagePlayer({damage:baseDamage,knockdown},source,multiplier*(this.rage?ragePower:1),1,
      {damageScale:.24,push})
  }

  private inArea(range:number,halfAngle=Math.PI) {
    return flatDistance(this.m,this.p)<=range && Math.abs(wrap(yawTo(this.m,this.p)-this.heading))<=halfAngle
  }

  private arms(time:number) {
    const count=this.rage?3:2
    while(this.events<count && time+1e-6>=armInterval*this.events) {
      const slam=this.events++===2
      this.fx.sound(slam?'earth-slam':'metal-swipe',this.m)
      if(slam) {
        this.fx.ring(this.m,.7,3.15,.36,0xf47395)
        this.fx.burst(this.m,0xc09072,true)
      }
      if(this.inArea(3,armAngle)) this.hurt(slam?1.12:attacks.arms.multiplier,this.m,slam,.34)
    }
    if(this.events<count) this.visuals.zone.sector(this.m,this.heading,3,armAngle,1)
    else this.visuals.zone.hide()
  }

  private spin(time:number) {
    const spin=attacks.spin
    if(this.events===0) {
      this.events=1
      this.fx.ring(this.m,2.25,spin.range,spin.active,magenta,.85)
      this.fx.sound('metal-swipe',this.m,1.10)
    }
    const bladeYaw=this.heading + time/spin.active*Math.PI*2
    const angle=Math.abs(wrap(yawTo(this.m,this.p)-bladeYaw))
    if(!this.chargedHit && flatDistance(this.m,this.p)<=spin.range && angle<=.57) {
      this.chargedHit=this.hurt(spin.multiplier,this.m,true,.51)
    }
  }

  private normalBeamLanes(progress:number,active:boolean,warningProgress:number) {
    for(let i=0;i<2;i++) {
      const side=i===0?-1:1
      const muzzle=this.monster.emitter(i===0?'MuzzleL':'MuzzleR',this.muzzle)
      const origin=this.eyeLanes[i].copy(muzzle)
      origin.y=0
      this.destination.copy(this.m).addScaledVector(forward(this.heading,this.ravenDirection),attacks.laser.range)
      const aim=yawTo(origin,this.destination)+side*laser.sweep*(1-progress)
      this.visuals.lines[i].lane(origin,aim,attacks.laser.range,laser.width+.16,warningProgress,magenta)
      if(active) this.fireBeam(i,origin,aim,attacks.laser.range,attacks.laser.multiplier,muzzle)
    }
  }

  private fireBeam(index:number,origin:Vector3,yaw:number,range:number,multiplier:number,from:Vector3) {
    this.tip.copy(origin).addScaledVector(forward(yaw,this.ravenDirection),range)
    this.tip.y=0
    const inside=pointSegmentSquared(this.playerFlat,this.ground.set(origin.x,0,origin.z),this.tip)<=(laser.width/2+.27)**2
    this.tip.y=this.arena.height(this.tip.x,this.tip.z)+.73
    this.visuals.beam(index,from,this.tip,laser.width)
    if(inside && this.elapsed>=this.beamReady) {
      this.source.copy(origin)
      if(this.hurt(multiplier,this.source)) this.beamReady=this.elapsed+laser.tick
    }
  }

  private featherWarning(yaw:number,count:number,spread:number,progress:number) {
    const wing=this.monster.emitter('Wing',this.muzzle)
    for(let i=0;i<count;i++) {
      const aim=yaw-spread/2+spread*i/(count-1)
      this.visuals.lines[i].lane(wing,aim,feather.range,.29,progress,0xf6ac72)
    }
  }

  private launchFeathers(yaw:number,count:number,spread:number,phase:boolean) {
    const wing=this.monster.emitter('Wing',this.muzzle)
    this.fx.sound('feather-volley',wing,phase?1:.88)
    for(let i=0;i<count;i++) {
      const shot=this.visuals.feathers.find(item=>!item.mesh.visible)
      if(!shot) break
      shot.yaw=yaw-spread/2+spread*i/(count-1)
      shot.start.copy(wing)
      shot.mesh.position.copy(shot.start)
      shot.mesh.rotation.set(0,shot.yaw,Math.PI*.10)
      shot.distance=0
      shot.phase=phase
      shot.mesh.visible=true
    }
  }

  private charge(dt:number) {
    if(dt===0) return
    this.travel.copy(this.m)
    this.destination.copy(this.m).addScaledVector(forward(this.heading,this.ravenDirection),12*dt)
    this.ground.copy(this.destination)
    this.arena.resolve(this.ground,this.monster.data.radius)
    this.activeCompleted=flatDistance(this.destination,this.ground)>.015
    this.tip.set(this.ground.x,0,this.ground.z)
    this.from.set(this.travel.x,0,this.travel.z)
    const contact=pointSegmentSquared(this.playerFlat,this.from,this.tip)
    if(!this.chargedHit && contact<=1.48**2) this.chargedHit=this.hurt(attacks.charge.multiplier,this.travel,true,.85)
    if(flatDistance(this.ground,this.p)<this.monster.data.radius+.44) {
      // The armor settles at contact. A well-timed roll remains protected by Battle.
      this.activeCompleted=true
    } else this.m.copy(this.ground)
    if(this.elapsed>=this.dustReady) {
      this.fx.burst(this.m,0xba9f75,false,.38)
      this.dustReady=this.elapsed+.10
    }
  }

  private placeMarks(time:number) {
    const count=this.rage?5:3
    while(this.events<count && time+1e-6>=this.events*markInterval) {
      const index=this.events++
      const mark=this.visuals.marks[index]
      mark.center.copy(this.p)
      mark.time=markFuse
      this.visuals.mark(index,0,attacks.marks.range)
      this.fx.sound('crystal',mark.center,.58)
    }
  }

  private ultimate(time:number) {
    const visuals=this.visuals
    if(!this.events) {
      const rotation=yawTo(this.m,this.p)
      for(let i=0;i<circle.count;i++) {
        const eye=visuals.eyes[i]
        const angle=rotation+i*Math.PI*2/circle.count
        eye.position.set(Math.sin(angle)*circle.radius,0,Math.cos(angle)*circle.radius)
        this.arena.resolve(eye.position,.5)
        this.eyeYaws[i]=Math.atan2(-eye.position.x,-eye.position.z)+(i%2 ? .11 : -.11)
        eye.rotation.y=this.eyeYaws[i]
        eye.visible=true
      }
      this.visuals.syncEyes()
      this.events=1
      this.fx.sound('summon',this.m)
    }
    visuals.hideLines()
    visuals.hideBeams()
    for(let i=0;i<circle.count;i++) {
      const until=circle.warning+i*circle.interval-time
      const eye=visuals.eyes[i]
      const yaw=this.eyeYaws[i]
      if(until>0 && until<=circle.warning) visuals.lines[i].lane(eye.position,yaw,20,laser.width+.20,1-until/circle.warning,magenta)
      else if(until<=0 && until>-circle.beamTime) {
        const bit=1<<i
        if (!(this.firedEyes & bit)) {
          this.firedEyes|=bit
          this.fx.sound('beam-release',eye.position,.55)
        }
        this.from.copy(eye.position).y+=.45
        this.fireBeam(0,eye.position,yaw,20,.8,this.from)
      }
    }
    if(time>=circle.featherTime-.5 && time<circle.featherTime) this.featherWarning(this.heading,12,feather.angle,1)
    if(time>=circle.featherTime && this.events===1) {
      this.events++
      this.launchFeathers(this.heading,12,feather.angle,true)
    }
    if(time>=circle.featherTime+.18) {
      visuals.zone.sector(this.m,0,attacks.ultimate.range,Math.PI,clamp((time-circle.featherTime-.18)/1.12,0,1),0,magenta)
    }
    if(time>=circle.shockTime && this.events===2) {
      this.events++
      this.fx.ring(this.m,1.5,attacks.ultimate.range,.44,magenta)
      this.fx.burst(this.m,magenta,true)
      this.fx.sound('emperor-impact',this.m,.89)
      if(this.inArea(attacks.ultimate.range)) this.hurt(attacks.ultimate.multiplier,this.m,true,.9)
    }
  }

  private updateObjects(dt:number) {
    for(let i=0;i<this.visuals.marks.length;i++) {
      const mark=this.visuals.marks[i]
      if(mark.time<=0) continue
      mark.time=Math.max(0,mark.time-dt)
      if(mark.time>1e-6) this.visuals.mark(i,1-mark.time/markFuse,attacks.marks.range)
      else {
        mark.time=0
        this.visuals.hideMark(i)
        this.fx.ring(mark.center,.24,attacks.marks.range,.34,magenta)
        this.fx.burst(mark.center,magenta,false)
        this.fx.sound('crystal-burst',mark.center,.75)
        if(flatDistance(mark.center,this.p)<=attacks.marks.range) this.hurt(attacks.marks.multiplier,mark.center)
      }
    }
    for(const shot of this.visuals.feathers) {
      if(!shot.mesh.visible) continue
      const position=shot.mesh.position
      this.from.set(position.x,0,position.z)
      shot.distance+=dt*feather.speed
      position.copy(shot.start).addScaledVector(forward(shot.yaw,this.ravenDirection),shot.distance)
      const height=this.arena.height(position.x,position.z)
      position.y=height+.79+Math.max(0,shot.start.y-height-.79)*Math.exp(-shot.distance*.80)
      this.tip.set(position.x,0,position.z)
      this.ground.copy(position)
      this.arena.resolve(this.ground,feather.radius)
      if(shot.distance>=feather.range || flatDistance(this.ground,position)>.05) {
        shot.mesh.visible=false
      } else if(pointSegmentSquared(this.playerFlat,this.from,this.tip)<=(.30+feather.radius)**2) {
        this.hurt(shot.phase ? .5 : attacks.feathers.multiplier,this.from)
        shot.mesh.visible=false
      }
    }
  }
}
