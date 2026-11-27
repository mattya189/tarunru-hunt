import { Vector3 } from 'three'
import { Battle } from '../battle'
import type { SoundCue } from '../battle-audio'
import type { Motion, WeaponData } from '../config'
import type { Effects } from '../effects'
import type { HitVolume } from '../flare/combat'
import type { HunterModel } from '../hunter'
import type { Controls } from '../input'
import { clamp, damp, flatDistance, forward, mix, smooth, wrap, yawTo } from '../math'
import type { MonsterModel } from '../monster-model'
import type { Arena } from '../world'
import { attacks, damage, normal, type NormalAttack, type WandaAttack } from './config'
import { WandaVisuals, ice, violet } from './visuals'

const altitude=9.6
const projectionHeight=1.18
const projectionRadius=1.55
const crossWidth=.97
const diveWidth=1.38
const pullRadius=4.5
const beamNear=1.52
const judgmentRadius=5.1
const flareDamageScale=1.20
const waveSpeed=27
const waveAccelerationTime=.34
const waveStartupLoss=2.65
const fullTurn=2*Math.PI
const stormTimes=[2.50,3.66,4.98]
const combinations: Partial<Record<NormalAttack,readonly NormalAttack[]>>={
  wind:['dive'], pull:['bomb'], tornado:['cross','wave'],
}
const attackSounds={
  wind:'wanda-blade', cross:'wanda-slash', bomb:'wanda-fall', pull:'wanda-gravity',
  wave:'wanda-wave', beam:'wanda-beam', dive:'wanda-dive', tornado:'wanda-vortex',
} as const satisfies Record<NormalAttack,SoundCue>
const ultimateSounds={collapse:'wanda-ultimate',judgment:'wanda-ultimate'} as const

type Point={x:number;z:number}
type HazardKind='blade'|'bomb'|'tornado'|'wave'|'scorch'|'burst'
type Hazard={
  kind:HazardKind; born:number; end:number; x:number; y:number; z:number; dx:number; dz:number
  radius:number; damage:number; next:number; hit:boolean; speed:number; slow:boolean; color:number
}
const hazard=():Hazard=>({
  kind:'burst',born:Infinity,end:-1,x:0,y:0,z:0,dx:0,dz:0,radius:0,damage:0,next:0,hit:false,speed:0,slow:false,color:violet,
})

const length=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.z-b.z)
const fraction=(age:number,total:number)=>clamp(age/total,0,1)
export function lineDistanceSquared(x:number,z:number,ax:number,az:number,bx:number,bz:number) {
  const dx=bx-ax, dz=bz-az
  const t=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz || 1),0,1)
  return (x-ax-t*dx)**2+(z-az-t*dz)**2
}

export class WandaBattle extends Battle {
  readonly visuals:WandaVisuals
  private readonly hazards=Array.from({length:112},hazard)
  private readonly cooldown=new Map<NormalAttack,number>()
  private readonly previousPlayer=new Vector3()
  private readonly velocity=new Vector3()
  private readonly aim=new Vector3()
  private readonly flightDirection=new Vector3()
  private readonly projection=new Vector3()
  private readonly origin=new Vector3()
  private readonly end=new Vector3()
  private readonly previousBoss=new Vector3()
  private readonly sample=new Vector3()
  private readonly source=new Vector3()
  private readonly safe=new Vector3()
  private readonly chest=new Vector3()
  private readonly left=new Vector3()
  private readonly right=new Vector3()
  private readonly crown=new Vector3()
  private current?:WandaAttack
  private last?:NormalAttack
  private lastButOne?:NormalAttack
  private sequence=0
  private released=0
  private repeat=0
  private angle=0
  private sweepDirection=1
  private lift=altitude
  private restLift=altitude
  private deathLift=altitude
  private beamHitAt=0
  private scorchHitAt=0
  private nextFlap=0
  private ultimates=0
  private safeReady=false
  private landed=false
  private comboHit=false
  private strafeSide=1
  private visualClock=0

  constructor(monster:MonsterModel,hunter:HunterModel,arena:Arena,fx:Effects,weapon:WeaponData) {
    super(monster,hunter,arena,fx,weapon)
    this.visuals=new WandaVisuals(arena.radius)
    this.reset()
  }

  override get defeatDuration() { return 2.65 }
  override get fieldDarkness() {
    return this.current==='collapse' && this.bossState==='attack' ? .54*smooth(this.bt/.86)*(1-smooth((this.bt-6.73)/.43)) : 0
  }

  override reset() {
    super.reset()
    if(!this.visuals) return
    this.current=this.last=this.lastButOne=undefined
    this.sequence=this.released=this.repeat=this.ultimates=0
    this.beamHitAt=this.scorchHitAt=this.visualClock=0
    this.nextFlap=.62
    this.lift=this.restLift=this.deathLift=altitude
    this.safeReady=this.landed=false
    this.strafeSide=1
    this.previousPlayer.copy(this.p)
    this.velocity.set(0,0,0)
    this.cooldown.clear()
    this.wipe()
    this.setBoss('recovery')
    this.pose(0,altitude,'idle')
  }

  override update(dt:number,input:Controls,viewYaw:number) {
    const preceding=this.outcome
    if(preceding==='victory') {
      const time=this.outcomeTime+dt
      this.lift=mix(this.deathLift,2.1,fraction(time,1.75)**1.6)
      this.monster.setFlightOffset(this.lift)
    }
    super.update(dt,input,viewYaw)
    if(this.outcome && !preceding) {
      this.current=undefined
      this.deathLift=this.lift
      this.wipe()
      this.monster.setAccentGlow(0)
    }
    if(this.outcome==='victory') {
      this.visuals.clear()
      if(this.outcomeTime>=1.75) {
        if(!this.landed) { this.landed=true; this.fx.sound('wanda-death',this.m) }
        const phase=fraction(this.outcomeTime-1.75,.85)
        this.visuals.burst(this.m.x,.1,this.m.z,4.5,phase)
        this.visuals.area(this.m.x,this.m.z,Math.max(.1,4.5*phase),.28*(1-phase),violet,3.5*phase)
      } else this.visuals.burst(this.m.x,this.lift,this.m.z,2.6,fraction(this.outcomeTime,1.75))
      this.visuals.flush()
    }
  }

  protected override get bossGroundRadius() { return this.lift<4 ? this.monster.data.radius : 0 }
  protected override get attackDamageMultiplier() { return (this.weapon.hp/100)*(this.rage?1.35:1) }
  protected override canInterruptBoss() { return !this.current && this.bossState==='approach' }
  protected override preserveBossHealth(damage:number) {
    if(this.ultimates<2 || this.current==='judgment' && this.bossState==='attack') {
      return Math.min(damage,Math.max(0,this.bossHp-1))
    }
    return damage
  }

  protected override onBossHit(magic:boolean, damage:number) {
    this.fx.sound('wanda-hit',this.m,.75)
    if(magic && damage>0) this.fx.burst(this.monster.emitter('Crown',this.source),0xffa857,false,.65)
  }

  private groundTarget() { return this.projection.copy(this.m).setY(projectionHeight) }
  protected override magicLockPoint() { return this.groundTarget() }
  protected override magicBossDamage(damage:number) { return Math.round(damage*flareDamageScale) }
  protected override findStrike(monster:MonsterModel,volume?:HitVolume) {
    const p=this.groundTarget()
    if(volume) return volume(p,projectionRadius)<=1?monster.parts[0]:undefined
    if(flatDistance(this.p,p)>4.8) return
    return this.strikeDistanceSquared(p)<=projectionRadius**2 ? monster.parts[0] : undefined
  }

  private wipe() {
    for(const hazard of this.hazards) hazard.end=-1
    this.visuals.clear()
  }

  private spawn(kind:HazardKind,x:number,z:number,radius:number,damage:number,delay:number,life:number,color=violet) {
    const h=this.hazards.find(item=>item.end<this.elapsed)!
    Object.assign(h,{kind,x,z,radius,damage,born:this.elapsed+delay,end:this.elapsed+delay+life,color,
      y:0,dx:0,dz:0,next:0,hit:false,speed:0,slow:false})
    return h
  }

  private pose(dt:number, height:number,motion:Motion, progress?:number, exact=false) {
    this.lift=exact?height:mix(this.lift,height,damp(7,dt))
    this.monster.setFlightOffset(this.lift)
    this.monster.animate(motion,dt,progress)
  }

  protected override updateBoss(dt:number) {
    this.visuals.clear()
    this.velocity.x=mix(this.velocity.x,(this.p.x-this.previousPlayer.x)/dt,damp(10,dt))
    this.velocity.z=mix(this.velocity.z,(this.p.z-this.previousPlayer.z)/dt,damp(10,dt))
    this.previousPlayer.copy(this.p)
    this.visualClock+=dt
    const recovery=this.bossState==='recovery'
    if(this.current==='collapse' || this.current==='judgment') {
      if(recovery) this.recover(dt,3)
      else this.ultimate(dt,this.current)
    } else if(this.current) {
      if(recovery) this.recover(dt,this.rage?this.monster.data.rage.chainDelay:.8)
      else this.runAttack(dt,this.current)
    } else if(this.bossState==='rage') {
      const t=fraction(this.bt,1.22)
      this.pose(dt,altitude,'enrage',t)
      if(t>=1) this.setBoss('idle')
    } else if(this.bossState==='hit') {
      const t=fraction(this.bt,.51)
      this.pose(dt,altitude,'hit',t)
      if(t>=1) this.setBoss('idle')
    } else if(!recovery || this.bt>=.86) this.hover(dt)

    if(this.outcome) return
    this.visuals.area(this.m.x,this.m.z,projectionRadius,.20,ice)
    this.visuals.area(this.m.x,this.m.z,projectionRadius+.23,.54,ice,projectionRadius+.14)
    const charging=this.current && (this.bossState==='windup'||this.bossState==='attack')
    const ultimate=charging&&(this.current==='collapse'||this.current==='judgment')
    this.monster.setAccentGlow(ultimate?.86:this.rage?.65:charging?.24:0)
    if(this.rage||ultimate) {
      this.monster.emitter('Body',this.chest)
      this.monster.emitter('WingUpperL',this.left)
      this.monster.emitter('WingUpperR',this.right)
      this.monster.emitter('Crown',this.crown)
      const flicker=.11+.07*Math.sin(this.visualClock*15)
      this.visuals.bolt(this.crown.x,this.crown.y+.3,this.crown.z,flicker*2,flicker*2,flicker,0,violet)
      this.visuals.burst(this.chest.x,this.chest.y,this.chest.z,ultimate?3.8:2.3,(this.visualClock*.64)%1)
      this.visuals.burst(this.left.x-1.9,this.left.y,this.left.z,2,(this.visualClock*.66+.29)%1)
      this.visuals.burst(this.right.x+1.9,this.right.y,this.right.z,2,(this.visualClock*.66+.64)%1)
    }
    this.updateHazards(dt)
    this.visuals.flush()
  }

  private hover(dt:number) {
    if(this.ultimates===0 && this.bossHp<=this.monster.data.hp*.60) { this.start('collapse'); return }
    if(!this.rage && this.bossHp<=this.monster.data.hp*this.monster.data.rage.hpRatio) {
      this.rage=true
      this.setBoss('rage')
      this.callout='怒り · 重力が歪む'
      this.fx.sound('wanda-rage',this.m)
      return
    }
    if(this.ultimates===1 && this.bossHp<=this.monster.data.hp*.20) { this.start('judgment'); return }
    const d=length(this.p,this.m)
    const turn=wrap(yawTo(this.m,this.p)-this.bossYaw)
    this.bossYaw+=clamp(turn,-4.4*dt,4.4*dt)
    this.monster.root.rotation.y=this.bossYaw
    if(Math.abs(turn)<1 && !this.hazards.some(h=>h.kind==='wave' && h.end>=this.elapsed)) {
      const id=this.choose(d)
      if(id) { this.start(id); return }
    }
    let motion:Motion='idle'
    if(d>4.1) {
      motion='walk'
      forward(this.bossYaw,this.flightDirection)
    } else if(d<1.6 && (this.sequence%3===0)) {
      motion='wandaBack'
      forward(this.bossYaw+Math.PI,this.flightDirection)
    } else if(Math.abs(turn)<.42 && d>2.2) {
      motion=this.strafeSide>0?'wandaRight':'wandaLeft'
      forward(this.bossYaw+this.strafeSide*Math.PI/2,this.flightDirection)
    } else if(Math.abs(turn)>.42) motion='turn'
    if(motion==='walk'||motion==='wandaBack'||motion==='wandaRight'||motion==='wandaLeft') {
      this.m.addScaledVector(this.flightDirection, this.monster.data.speed*(this.rage?this.monster.data.rage.speed:1)*dt)
      this.arena.resolve(this.m,1.1)
    }
    if(this.bossState!=='approach') this.setBoss('approach')
    this.pose(dt,altitude+.35*Math.sin(this.elapsed*4.5),motion)
    if(this.elapsed>=this.nextFlap) {
      this.fx.sound('wanda-flap',this.m,.67)
      this.nextFlap=this.elapsed+(this.rage?.78:1.15)
    }
  }

  private choose(distance:number) {
    const storms=this.hazards.filter(h=>h.kind==='tornado'&&h.end>=this.elapsed).length
    const ready=(id:NormalAttack)=>id!==this.last && id!==this.lastButOne && (this.cooldown.get(id)??0)<=this.elapsed &&
      (id!=='tornado'||storms===0) && (id!=='dive'||distance>=3.4) && (id!=='pull'||distance<9.5) &&
      (id!=='cross'||distance<15) && (id!=='beam'||storms===0)
    if(this.last && this.bossHp<=this.monster.data.hp*.60 && Math.random()<(this.rage?.73:.42)) {
      const combo=combinations[this.last]?.filter(ready)
      if(combo?.length) return combo[Math.floor(Math.random()*combo.length)]
    }
    const weights=normal.map(id=>{
      if(!ready(id)) return 0
      switch(id) {
        case 'wind': return distance>7?22:12
        case 'cross': return distance<6?24:17
        case 'bomb': return 11+Math.min(13,this.velocity.length()*2)
        case 'pull': return distance<5?18:7
        case 'wave': return storms?8:15
        case 'beam': return distance>5?20:10
        case 'dive': return distance>6?25:11
        case 'tornado': return distance>10?15:20
      }
    })
    let roll=Math.random()*weights.reduce((a,b)=>a+b,0)
    for(const [i,w] of weights.entries()) {
      roll-=w
      if(roll<0) return normal[i]
    }
  }

  private start(id:WandaAttack) {
    this.current=id
    this.released=this.repeat=0
    this.comboHit=this.safeReady=false
    this.strafeSide*=-1
    this.aim.copy(this.p); this.origin.copy(this.m)
    this.angle=yawTo(this.m,this.p)
    this.sweepDirection=this.velocity.dot(forward(this.angle+Math.PI/2,this.flightDirection))>=0?1:-1
    this.callout=attacks[id].name+' · '+attacks[id].hint
    if(id==='collapse'||id==='judgment') {
      this.ultimates++
      this.wipe()
      this.setBoss('attack')
      this.fx.sound('wanda-charge',this.m)
      if(id==='judgment') this.origin.set(0,0,0)
      return
    }
    this.lastButOne=this.last
    this.last=id
    this.sequence++
    this.cooldown.set(id,this.elapsed+attacks[id].cooldown)
    this.setBoss('windup')
    if(id==='dive') this.diveLine()
  }

  private diveLine() {
    const range=clamp(length(this.m,this.aim)+3.7,6.8,19)
    this.end.copy(this.origin).addScaledVector(forward(this.angle,this.flightDirection),range)
    this.arena.resolve(this.end,1)
  }

  private runAttack(dt:number,id:NormalAttack) {
    const move=attacks[id], tempo=this.rage?this.monster.data.rage.tempo:1
    const windup=move.windup/tempo
    const clip=this.monster.duration(move.motion)
    if(this.bossState==='windup') {
      const f=fraction(this.bt,windup)
      if(f<(id==='cross'?.29:.43) && id!=='pull' && id!=='wave') {
        this.aim.copy(this.p).addScaledVector(this.velocity,id==='cross'?.14:0)
        this.arena.resolve(this.aim,.45)
        this.angle=yawTo(this.origin,this.aim)
        this.bossYaw=this.angle
        this.monster.root.rotation.y=this.angle
        if(id==='dive') this.diveLine()
      }
      if(id==='cross') this.cross(false)
      if(id==='pull') this.visuals.area(this.origin.x,this.origin.z,pullRadius,.33,violet)
      if(id==='beam') {
        this.ray(this.origin,this.angle-this.sweepDirection*Math.PI*5/12,.74,false,beamNear)
        this.ray(this.origin,this.angle+this.sweepDirection*Math.PI*5/12,.46,false,beamNear)
      }
      if(id==='dive') this.visuals.line(this.origin.x,this.origin.z,this.end.x,this.end.z,diveWidth)
      if(id==='wave') {
        this.visuals.area(this.origin.x,this.origin.z,2+2*f,.28,violet,1.6+2*f)
        this.visuals.burst(this.m.x,this.lift,this.m.z,3,f,ice)
      }
      this.pose(dt,id==='dive'?altitude+3.4*smooth(f):altitude,move.motion,f*move.windup/clip)
      if(f<1) return
      this.setBoss('attack')
      this.fx.sound(attackSounds[id],this.m)
      this.previousBoss.copy(this.m)
    }
    const active=id==='pull'||id==='beam'?move.active:move.active/tempo
    const f=fraction(this.bt,active)
    if(id==='dive') this.runDive(dt,f,move.motion,move.windup/clip)
    else this.pose(dt,altitude,move.motion,mix(move.windup/clip,id==='cross'?.80:1,f))
    switch(id) {
      case 'wind': {
        const count=this.rage?12:6
        while(this.released<count && this.bt+1e-6>=active*(this.released/count)) {
          this.windBlade(this.released++,count)
          this.fx.sound('wanda-blade',this.m,.57)
        }
        break
      }
      case 'cross':
        if(!this.released++) this.cross(true)
        else this.cross(false,true)
        break
      case 'bomb':
        if(!this.released++) this.bombs(this.rage?this.integer(20,28):this.integer(12,18),damage.bomb,0,1.04,false)
        break
      case 'pull': {
        const distance=length(this.origin,this.p)
        if(distance<11) this.gravity(this.origin,(1-distance/11)*2.65+.55,dt)
        this.visuals.cyclone(this.origin.x,this.origin.z,pullRadius,6,this.elapsed,violet)
        if(!this.released && this.bt>=.72 && this.bossHp<=this.monster.data.hp*.60 &&
          (this.cooldown.get('bomb')??0)<=this.elapsed) {
          this.released=1
          if(Math.random()<(this.rage?.72:.40)) {
            this.bombs(this.rage?8:5,damage.bomb,0,.32,true,pullRadius+1.5)
            this.cooldown.set('bomb',this.elapsed+3)
            this.fx.sound('wanda-fall',this.m)
          }
        }
        if(f>=1) this.explode(this.origin,pullRadius,damage.pull,true)
        break
      }
      case 'wave': {
        const pulses=[0,.77,1.71]
        const next=pulses[this.released]
        if(next!==undefined && next/tempo-this.bt<.23) {
          this.visuals.burst(this.m.x,this.lift,this.m.z,3.5,1-fraction(next/tempo-this.bt,.23),ice)
        }
        while(this.released<pulses.length && this.bt+1e-6>=pulses[this.released]/tempo) {
          this.wave(this.origin,damage.wave)
          this.released++
        }
        break
      }
      case 'beam': {
        const yaw=this.angle+this.sweepDirection*mix(-Math.PI*5/12,Math.PI*5/12,f)
        this.bossYaw=yaw
        this.monster.root.rotation.y=yaw
        this.visuals.shaft(this.m.x,this.lift,this.m.z,this.origin.x+Math.sin(yaw)*beamNear,.24,
          this.origin.z+Math.cos(yaw)*beamNear,.41,0xff67df)
        const ray=this.ray(this.origin,yaw,.74,true,beamNear)
        if(this.elapsed>=this.beamHitAt && ray<=.74**2) {
          this.beamHitAt=this.elapsed+.85
          this.hit(damage.beam,this.origin,true)
        }
        if(this.bt>=this.released*.12) {
          this.released++
          const h=this.spawn('scorch',this.origin.x+Math.sin(yaw)*beamNear,
            this.origin.z+Math.cos(yaw)*beamNear,.52,damage.scorch,0,2)
          this.rayEnd(this.origin,yaw)
          h.dx=this.sample.x; h.dz=this.sample.z
        }
        break
      }
      case 'tornado':
        if(!this.released++) this.tornadoes()
        break
      case 'dive': break
    }
    if(f<1) return
    const repeats=id==='cross'&&this.rage?2:id==='dive'&&this.rage?3:1
    if(this.repeat+1<repeats && (id!=='dive'||length(this.m,this.p)>2.6)) {
      this.repeat++
      this.released=0
      this.comboHit=false
      this.aim.copy(this.p)
      this.origin.copy(this.m)
      this.angle=yawTo(this.m,this.aim)
      if(id==='dive') this.diveLine()
      this.setBoss('windup')
    } else this.finish()
  }

  private runDive(dt:number,f:number,motion:Motion,start:number) {
    const transit=fraction(f,.76)
    this.previousBoss.copy(this.m)
    this.m.copy(this.origin).lerp(this.end,transit)
    const height=f<.26?mix(altitude+3.4,2.65,smooth(f/.26)):mix(2.65,altitude,smooth((f-.74)/.26))
    this.pose(dt,height,motion,mix(start,.86,f),true)
    this.visuals.line(this.origin.x,this.origin.z,this.end.x,this.end.z,diveWidth,0xfa86d7)
    this.visuals.shaft(this.previousBoss.x,this.lift,this.previousBoss.z,this.m.x,this.lift+.1,this.m.z,1.07,ice)
    this.visuals.burst(this.m.x,this.lift,this.m.z,4,f,ice)
    if(!this.comboHit && f>=.21 && f<=.86 && this.lineHit(this.previousBoss,this.m)<=diveWidth**2) {
      this.comboHit=true
      this.hit(damage.dive,this.previousBoss)
    }
  }

  private cross(active:boolean,lingering=false) {
    const r=8.5
    let hit=false
    const angle=this.angle+(this.repeat?Math.PI/3:0)
    for(const offset of [-Math.PI/4,Math.PI/4]) {
      const yaw=angle+offset
      const dx=Math.sin(yaw)*r, dz=Math.cos(yaw)*r
      const {x,z}=this.aim
      this.visuals.line(x-dx,z-dz,x+dx,z+dz,crossWidth,active||lingering?ice:0xff657d)
      if(active||lingering) {
        this.visuals.shaft(x-dx,.12,z-dz,x+dx,.6,z+dz,.64,violet)
        hit ||= active && lineDistanceSquared(this.p.x,this.p.z,x-dx,z-dz,x+dx,z+dz)<=crossWidth**2
      }
    }
    if(hit) this.hit(damage.cross,this.origin)
  }

  private windBlade(index:number,count:number) {
    const wing=index%2?'WingUpperR':'WingUpperL'
    this.monster.emitter(wing,this.sample)
    const spread=(Math.random()-.5)*.42
    const yaw=yawTo(this.sample,this.p)+spread
    const travel=mix(13,23,index/(count-1))
    const h=this.spawn('blade',this.sample.x,this.sample.z,.72,damage.wind,0,1.94,ice)
    h.y=this.sample.y
    h.dx=Math.sin(yaw); h.dz=Math.cos(yaw); h.speed=travel
    h.next=clamp(length(this.sample,this.p)/travel,.25,1.39)
  }

  private integer(min:number,max:number) { return min+Math.floor(Math.random()*(max-min+1)) }

  private bombs(count:number,power:number,delay:number,spread:number,wholeArena:boolean,excludePull=0) {
    const targets=Math.ceil(count*(wholeArena?.33:.66))
    const heading=this.velocity.lengthSq()>1?Math.atan2(this.velocity.x,this.velocity.z):this.playerYaw
    for(let i=0;i<count;i++) {
      const led=i<targets
      const a=i*2.39996+heading
      const r=led ? (i===0?0:1.1+Math.sqrt(i)*1.44) : Math.sqrt(Math.random())*(this.arena.radius-1)
      const predict=led?Math.min(.54,.08+(i%5)*.1):0
      this.sample.set((led?this.p.x:0)+this.velocity.x*predict+Math.sin(a)*r,0,
        (led?this.p.z:0)+this.velocity.z*predict+Math.cos(a)*r)
      this.arena.resolve(this.sample,.46)
      const radius=wholeArena?1.34:1.42
      if(this.safeReady && length(this.safe,this.sample)<3.05+radius) continue
      if(excludePull && length(this.origin,this.sample)<excludePull+radius) continue
      const h=this.spawn('bomb',this.sample.x,this.sample.z,radius,power,
        delay+(count>1?spread*i/(count-1):0),1.32,wholeArena?0xf81e96:0xb17dff)
      h.y=wholeArena?15.2:12.9
    }
  }

  private tornadoes() {
    const count=this.rage?5:3
    const heading=yawTo(this.m,this.p)
    for(let i=0;i<count;i++) {
      const a=heading+fullTurn*i/count
      this.sample.copy(this.p).addScaledVector(forward(a,this.flightDirection),4.65+i%2*.85)
      this.arena.resolve(this.sample,1.1)
      const h=this.spawn('tornado',this.sample.x,this.sample.z,1.25,damage.tornado,0,8,0x9bc4ff)
      h.dx=Math.sin(a); h.dz=Math.cos(a)
      h.speed=1.65+(i%3)*.22
    }
  }

  private wave(center:Point,power:number) {
    const reach=this.arena.radius+Math.hypot(center.x,center.z)+1.2
    this.spawn('wave',center.x,center.z,1,power,0,(reach+waveStartupLoss)/waveSpeed,0xf596f5)
    this.source.set(center.x,0,center.z)
    this.fx.sound('wanda-wave',this.source)
  }

  private gravity(center:Point,speed:number,dt:number) {
    const d=length(this.p,center)
    if(d<.03) return
    const travel=Math.min(d,speed*dt*(this.playerState==='dodge'?.36:1))
    this.p.x+=(center.x-this.p.x)*travel/d
    this.p.z+=(center.z-this.p.z)*travel/d
    this.arena.resolve(this.p,.44)
  }

  private rayEnd(center:Point,yaw:number) {
    const a=Math.sin(yaw),b=Math.cos(yaw)
    const dot=center.x*a+center.z*b
    const radius=this.arena.radius
    const length=-dot+Math.sqrt(Math.max(0,dot*dot+radius*radius-center.x**2-center.z**2))
    this.sample.set(center.x+a*length,0,center.z+b*length)
  }

  private ray(center:Point,yaw:number,radius:number,fire:boolean,near=0) {
    this.rayEnd(center,yaw)
    const {x,z}=this.sample
    const ax=center.x+Math.sin(yaw)*near,az=center.z+Math.cos(yaw)*near
    if(near && length(center,this.sample)<near) return Infinity
    this.visuals.line(ax,az,x,z,radius,fire?0xff63e5:0xff657d)
    if(fire) {
      this.visuals.shaft(ax,.27,az,x,.27,z,radius,0xff67df)
      this.visuals.shaft(ax,.27,az,x,.27,z,radius*.37,0xffe7fa)
    }
    return lineDistanceSquared(this.p.x,this.p.z,ax,az,x,z)
  }

  private lineHit(a:Point,b:Point) { return lineDistanceSquared(this.p.x,this.p.z,a.x,a.z,b.x,b.z) }
  private hit(power:number,from:Point,unguardable=false) {
    if(this.outcome) return false
    this.source.set(from.x,0,from.z)
    if(length(this.source,this.p)<.22) this.source.copy(this.m)
    return this.damagePlayer({damage:power,knockdown:false},this.source,this.attackDamageMultiplier,1,unguardable?'unguardable':undefined)
  }

  private explode(center:Point,radius:number,power:number,unguardable:boolean,color=violet) {
    this.spawn('burst',center.x,center.z,radius,0,0,.5,color)
    this.source.set(center.x,0,center.z)
    this.fx.sound('wanda-burst',this.source)
    if(length(this.p,center)<=radius) this.hit(power,center,unguardable)
  }

  private ultimate(dt:number,id:'collapse'|'judgment') {
    const time=this.bt, move=attacks[id]
    if(id==='collapse') {
      this.pose(dt,altitude+3.3*smooth(time/1.15),move.motion,fraction(time,7))
      if(time>=1.0 && time<4.3 && time>=1+this.released*.39) {
        this.bombs(6,damage.collapseBomb,0,.27,true)
        this.released++
        this.fx.sound('wanda-fall',this.m,.78)
      }
      if(time>=4.25 && !this.safeReady) {
        this.safeReady=true
        // Start the refuge close to the player at reveal time, even against the rim.
        const fromCenter=Math.hypot(this.p.x,this.p.z)
        this.safe.copy(this.p).multiplyScalar(fromCenter>4?1-3.7/fromCenter:1)
        if(fromCenter<=4) this.safe.x+=3.1
        this.arena.resolve(this.safe,3.25)
        for(const h of this.hazards) if(h.kind==='bomb' && h.end>=this.elapsed && length(h,this.safe)<3.05+h.radius) h.end=-1
      }
      if(this.safeReady) {
        this.visuals.storm(this.safe.x,this.safe.z,3.0,time>6.74?.53:.20+.12*Math.sin(time*13)**2)
        this.visuals.area(this.safe.x,this.safe.z,3.0,.27,ice)
      }
      if(time>=6.75 && !this.comboHit) {
        this.comboHit=true
        this.fx.sound(ultimateSounds[id],this.m)
        if(length(this.p,this.safe)>3) this.hit(damage.collapseFinal,this.m,true)
      }
    } else {
      const center=this.origin
      this.m.lerp(center,damp(2.4,dt))
      this.pose(dt,altitude+1.3,move.motion,fraction(time,8))
      this.visuals.storm(0,0,0,.067)
      if(time<5.35) this.gravity(center,time<1.35?1.35:1.0,dt)
      const rotating=time>=1.8&&time<5.75
      if(time<5.75) {
        const angle=this.angle+.37*Math.max(0,time-1.8)
        let hit=false
        if(rotating) this.visuals.shaft(this.m.x,this.lift,this.m.z,center.x,.24,center.z,.55,0xff67df)
        for(let i=0;i<6;i++) hit=this.ray(center,angle+i*fullTurn/6,.52,rotating)<=.52**2 || hit
        if(rotating && !this.repeat++) this.fx.sound('wanda-beam',center)
        if(rotating && hit && this.elapsed>=this.beamHitAt) {
          this.beamHitAt=this.elapsed+.79
          this.hit(damage.judgmentBeam,center,true)
        }
      }
      while(this.released<stormTimes.length && time>=stormTimes[this.released]) {
        this.wave(center,damage.judgmentWave)
        this.released++
      }
      if(time>=5.67) {
        const f=fraction(time-5.67,1.98)
        this.visuals.area(center.x,center.z,judgmentRadius,.22+.12*Math.sin(time*14)**2)
        this.visuals.cyclone(center.x,center.z,judgmentRadius*f,3.2+f*3,time,violet)
      }
      if(time>=7.65 && !this.comboHit) {
        this.comboHit=true
        this.explode(center,judgmentRadius,damage.judgmentFinal,true)
        this.fx.sound(ultimateSounds[id],this.m)
      }
    }
    if(time>=move.active) {
      this.wipe()
      this.finish(3.1)
    }
  }

  private finish(height=altitude) {
    this.restLift=height
    this.setBoss('recovery')
    this.callout=height<altitude?'反撃のチャンス · 3秒':''
  }

  private recover(dt:number,seconds:number) {
    this.pose(dt,this.restLift,'idle')
    if(this.bt<seconds) return
    this.current=undefined
    this.callout=''
    this.setBoss('idle')
  }

  private updateHazards(dt:number) {
    for(const h of this.hazards) {
      if(h.end<this.elapsed||h.born>this.elapsed) continue
      const age=this.elapsed-h.born
      switch(h.kind) {
        case 'bomb': {
          const fall=fraction(age,.96)
          if(fall<1) {
            this.visuals.area(h.x,h.z,h.radius,.14+.19*fall,h.color)
            this.visuals.area(h.x,h.z,h.radius*fall,.11,h.color)
            const y=h.y*(1-fall**2)+.25
            this.visuals.bolt(h.x,y,h.z,.18,.62,.18,0,h.color)
            this.visuals.shaft(h.x,y,h.z,h.x,y+.94,h.z,.08,h.color)
          } else {
            const phase=fraction(age-.96,.36)
            this.visuals.burst(h.x,.12,h.z,h.radius*1.58,phase,h.color)
            this.visuals.area(h.x,h.z,h.radius,.65*(1-phase),h.color)
            if(!h.hit) {
              h.hit=true
              this.source.set(h.x,0,h.z)
              this.fx.sound('wanda-burst',this.source,.72)
              if(length(h,this.p)<=h.radius) this.hit(h.damage,h)
            }
          }
          break
        }
        case 'blade': {
          const x=h.x+h.dx*h.speed*dt,z=h.z+h.dz*h.speed*dt
          const y=mix(h.y,1.15,smooth(age/h.next))
          const yaw=Math.atan2(h.dx,h.dz)
          this.visuals.blade(x,y,z,yaw,h.color)
          this.visuals.bolt(h.x-h.dx*.24,y+.12,h.z-h.dz*.24,.61,.07,.58,yaw,0x479aca)
          if(y<=2.10 && this.lineHit(h,{x,z})<=h.radius**2) {
            h.end=-1
            this.hit(h.damage,h)
          }
          h.x=x; h.z=z
          if(Math.hypot(x,z)>this.arena.radius+1) h.end=-1
          break
        }
        case 'wave': {
          const progress=smooth(age/waveAccelerationTime)
          const outer=Math.max(.16,age*waveSpeed-waveStartupLoss*progress+h.radius*.42)
          const inner=Math.max(0,outer-h.radius)
          this.visuals.area(h.x,h.z,outer,.64,h.color,inner)
          this.visuals.area(h.x,h.z,outer+.81,.15,h.color,outer+.66)
          const d=length(h,this.p)
          if(!h.hit && d<=outer && d>=inner-waveSpeed*dt) {
            h.hit=true; this.hit(h.damage,h,true)
          }
          break
        }
        case 'tornado': {
          const start=.7
          const phase=smooth(age/start)
          const r=h.radius*mix(.64,1,phase)
          if(age>=start) {
            const heading=Math.atan2(h.dx,h.dz)
            const want=Math.atan2(this.p.x-h.x,this.p.z-h.z)
            const yaw=heading+clamp(wrap(want-heading),-dt*.82,dt*.82)
            h.dx=Math.sin(yaw); h.dz=Math.cos(yaw)
            this.sample.set(h.x+h.dx*h.speed*dt,0,h.z+h.dz*h.speed*dt)
            this.arena.resolve(this.sample,.65)
            h.x=this.sample.x; h.z=this.sample.z
            if(length(h,this.p)<=r && this.elapsed>=h.next) {
              h.next=this.elapsed+1.25
              this.hit(h.damage,h)
            }
          }
          this.visuals.cyclone(h.x,h.z,r,5*mix(.15,1,phase),this.elapsed+h.born,h.color)
          break
        }
        case 'scorch':
          this.visuals.line(h.x,h.z,h.dx,h.dz,h.radius,0xaf4da8)
          if(this.elapsed>=this.scorchHitAt &&
            lineDistanceSquared(this.p.x,this.p.z,h.x,h.z,h.dx,h.dz)<=h.radius**2) {
            this.scorchHitAt=this.elapsed+.76
            this.hit(h.damage,h)
          }
          break
        case 'burst': {
          const phase=fraction(age,.5)
          this.visuals.burst(h.x,.18,h.z,h.radius,phase,h.color)
          this.visuals.area(h.x,h.z,h.radius,.57*(1-phase),h.color)
          this.visuals.shaft(h.x,.1,h.z,h.x,1+5*Math.sin(phase*Math.PI),h.z,
            h.radius*(1-phase)*.65,h.color)
          break
        }
      }
    }
  }
}
