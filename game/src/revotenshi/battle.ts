import { Vector3, type Scene } from 'three'
import { Battle, type BossState } from '../battle'
import type { Motion } from '../config'
import type { Controls } from '../input'
import { clamp, flatDistance, forward, wrap, yawTo } from '../math'
import type { MonsterModel } from '../monster-model'
import { combat, cues } from './config'
import { createEffects } from './vfx.js'

const attacks = {
  beam: { label:'天裂光線', tell:'横へ避けろ', motions:['beamPrep','beamFire','beamRecover'], range:combat.beamLength, min:3.6, cooldown:7 },
  spin: { label:'狂転突撃', tell:'本体から離れろ', motions:['spinPrep','spin','spinRecover'], range:4.6, min:0, cooldown:4 },
  tornado: { label:'反転竜巻', tell:'翼から竜巻が来る', motions:['tornadoPrep','tornadoRelease','tornadoRecover'], range:9, min:2.6, cooldown:8 },
} as const

type Attack = keyof typeof attacks
type Clone = {
  model:MonsterModel; effects:ReturnType<typeof createEffects>; hp:number; readyAt:number
  age:number; state:'chase'|'windup'|'spin'|'recover'; hit:boolean
}

export class RevotenshiBattle extends Battle {
  private scene!:Scene
  private effects!:ReturnType<typeof createEffects>
  private clones:Clone[]=[]
  private readyAt:Record<Attack,number>={beam:0,spin:0,tornado:3}
  private activeAttack?:Attack
  private landed=false
  private summoned=false
  private barrier=false
  private barrierHealTime=0
  private barrierBroken=false
  private tornadoAge=0
  private tornadoActive=false
  private readonly tornadoPosition=new Vector3()
  private readonly tornadoDirection=new Vector3()
  private readonly beamOrigin=new Vector3()
  private readonly beamAim=new Vector3()
  private readonly beamTarget=new Vector3()

  attach(scene:Scene, models:MonsterModel[]) {
    this.scene=scene
    this.effects=createEffects(scene,this.monster.root,{...combat,height:2.18})
    this.clones=models.map(model=>({
      model, effects:createEffects(scene,model.root,{...combat,height:.91,spinRadius:1.46}),
      hp:0, readyAt:0, age:0, state:'chase', hit:false,
    }))
  }

  override get defeatDuration() { return this.monster.duration('defeat') }
  override get lockTarget() {
    const living=this.clones.filter(clone=>clone.hp>0)
    if (!living.length) return this.m
    return living.reduce((a,b)=>flatDistance(this.p,a.model.root.position)<=flatDistance(this.p,b.model.root.position)?a:b).model.root.position
  }

  override reset() {
    super.reset()
    this.clearEncounter()
    this.readyAt={beam:0,spin:0,tornado:3}
    this.activeAttack=undefined; this.landed=false
    this.summoned=this.barrier=this.barrierBroken=false
    this.barrierHealTime=0
  }

  private clearEncounter() {
    this.effects?.dispose()
    this.tornadoActive=false; this.reverseMovement=0
    for (const clone of this.clones ?? []) {
      clone.hp=0
      clone.effects.dispose()
      this.scene.remove(clone.model.root)
    }
  }

  override update(dt:number,input:Controls,yaw:number) {
    if (this.outcome) { super.update(dt,input,yaw); return }
    const hadBarrier=this.barrier
    super.update(dt,input,yaw)
    if (this.outcome) this.clearEncounter()
    else {
      if (hadBarrier && this.barrier) {
        this.barrierHealTime+=dt
        const seconds=Math.floor(this.barrierHealTime+1e-9)
        if (seconds>0) {
          this.bossHp=Math.min(this.monster.data.hp,this.bossHp+seconds*combat.barrierHealPerSecond)
          this.barrierHealTime-=seconds
        }
      }
      this.effects.update(dt)
      for (const clone of this.clones) clone.effects.update(dt)
    }
  }

  protected override acceptBossDamage() {
    if (!this.barrier) return true
    this.fx.hit(this.monster.parts[0].center,0,'無敵バリア',0xbe81ff,false,false)
    return false
  }

  protected override strikeSecondary(damage:number) {
    for (const clone of this.clones) {
      if (!clone.hp) continue
      const part=this.findStrike(clone.model)
      if (!part) continue
      const dealt=Math.round(damage*part.config.multiplier)
      clone.hp=Math.max(0,clone.hp-dealt)
      this.fx.hit(part.center,dealt,'分身体',0xe3acff,dealt>=88,false)
      if (!clone.hp) {
        clone.effects.dispose()
        this.scene.remove(clone.model.root)
        this.effects.burst(part.center)
        if (!this.clones.some(candidate=>candidate.hp>0)) {
          this.barrier=false
          this.barrierBroken=true
          this.effects.breakBarrier()
          this.setBoss('fall')
          this.callout='バリア破壊 · 4秒ダウン'
        }
      }
      return true
    }
    return false
  }

  protected override canInterruptBoss() {
    return !this.barrier && !(this.summoned && this.bossState==='attack' && !this.activeAttack)
  }

  protected override setBoss(state:BossState) {
    if (this.activeAttack && (state==='fall'||state==='stagger'||state==='defeat')) {
      this.effects.stop('charge'); this.effects.stop('beam'); this.effects.stop('spin')
      this.readyAt[this.activeAttack]=this.elapsed+attacks[this.activeAttack].cooldown
      this.activeAttack=undefined
    }
    super.setBoss(state)
  }

  protected override updateBoss(dt:number) {
    this.tickTornado(dt)
    if (this.outcome) return
    for (const clone of this.clones) {
      if (clone.hp>0) this.tickClone(clone,dt)
      if (this.outcome) return
    }

    const data=this.monster.data
    const distance=flatDistance(this.m,this.p)
    const angle=yawTo(this.m,this.p)
    const turn=(rate:number)=>{
      this.bossYaw+=clamp(wrap(angle-this.bossYaw),-rate*dt,rate*dt)
      this.monster.root.rotation.y=this.bossYaw
    }
    if (this.activeAttack) {
      this.tickAttack(this.activeAttack,dt,turn)
      return
    }
    if (this.bossState==='attack') {
      this.tickSummon(dt)
      return
    }
    if (this.barrier) {
      this.monster.animate('barrierIdle',dt)
      this.callout=`無敵バリア・HP回復中 · 分身体 残り${this.clones.filter(clone=>clone.hp>0).length}体`
      return
    }

    switch (this.bossState) {
      case 'idle':
        this.monster.animate('idle',dt)
        if (this.bt>.7 && distance<data.ai.wake) this.setBoss('search')
        break
      case 'search':
        this.callout='モンスターがこちらに気づいた'
        turn(2.4)
        if (this.play('roar',dt)) this.approach()
        break
      case 'rage':
        if (this.play('enrage',dt)) this.approach()
        break
      case 'fall': {
        const drop=this.barrierBroken?'barrierBreak':'fall'
        const down=this.barrierBroken?combat.barrierDown:2.4
        const recover=this.monster.duration('getUp')
        if (this.bt<this.monster.duration(drop)) this.play(drop,dt)
        else if (this.bt<down) this.monster.animate('downLoop',dt)
        else if (this.play('getUp',dt,this.bt-down,recover)) {
          this.barrierBroken=false
          this.approach()
        }
        break
      }
      case 'stagger':
      case 'hit':
        if (this.play(this.bossState,dt)) this.approach()
        break
      case 'approach': {
        if (!this.summoned && this.bossHp<=data.hp*combat.summonHpRatio) {
          this.summoned=true
          this.setBoss('attack')
          this.callout='分身召喚 · バリアを展開する'
          return
        }
        if (!this.rage && this.bossHp<=data.hp*data.rage.hpRatio) {
          this.rage=true
          this.effects.rage()
          this.callout='怒り · 移動速度と攻撃力が上昇'
          this.setBoss('rage')
          return
        }
        turn(data.ai.turnSpeed)
        const ready=(kind:Attack)=>this.elapsed>=this.readyAt[kind] &&
          distance>=attacks[kind].min && distance<=attacks[kind].range
        const aligned=Math.abs(wrap(angle-this.bossYaw))<.45
        const kind=ready('spin') && distance<3.5 ? 'spin' :
          aligned && ready('tornado') && !this.tornadoActive ? 'tornado' :
          aligned && ready('beam') ? 'beam' :
          aligned && ready('spin') ? 'spin' : undefined
        if (kind) {
          this.activeAttack=kind; this.landed=false
          this.callout=`${attacks[kind].label} · ${attacks[kind].tell}`
          this.setBoss('windup')
          if (kind==='beam') this.effects.charge()
          if (kind==='spin') {
            const radius=combat.spinRadius
            this.fx.ring(this.m,radius,radius,this.monster.duration('spinPrep'),0xff9edc)
          }
        } else if (aligned && distance>2.2) {
          const speed=data.speed*(this.rage?data.rage.speed:1)
          this.moveEntity(this.m,forward(this.bossYaw,this.delta),speed*dt,data.radius,this.p,.44)
          this.monster.animate('walk',dt)
        } else this.monster.animate(this.rage?'rageIdle':'idle',dt)
        break
      }
    }
  }

  private approach() { this.callout=''; this.setBoss('approach') }

  private play(motion:Motion,dt:number,age=this.bt,duration=this.monster.duration(motion)) {
    this.monster.animate(motion,dt,clamp(age/duration,0,1))
    return age+1e-5>=duration
  }

  private tickAttack(kind:Attack,dt:number,turn:(rate:number)=>void) {
    const [windup,active,recover]=attacks[kind].motions
    if (this.bossState==='windup') {
      if (this.bt<this.monster.duration(windup)*.72) turn(2.8)
      if (this.play(windup,dt)) {
        this.setBoss('attack')
        this.callout=attacks[kind].label
        if (kind==='beam') this.effects.beam()
        if (kind==='spin') this.effects.spin()
      }
      return
    }
    if (this.bossState==='recovery') {
      if (this.play(recover,dt)) {
        this.readyAt[kind]=this.elapsed+attacks[kind].cooldown
        this.activeAttack=undefined
        this.approach()
      }
      return
    }
    if (kind==='beam') turn(.50)
    if (kind==='spin' && this.bt<.75) {
      const data=this.monster.data
      this.moveEntity(this.m,forward(this.bossYaw,this.delta),(this.rage?data.rage.speed:1)*3.8*dt,data.radius,this.p,.44)
    }
    const finished=this.play(active,dt)
    if (kind==='beam' && !this.landed && this.beamHits()) this.landed=this.hitPlayer(combat.beamDamage,true,this.m)
    if (kind==='spin' && !this.landed && flatDistance(this.m,this.p)<=combat.spinRadius+.30) {
      this.landed=this.hitPlayer(combat.spinDamage,true,this.m)
    }
    if (kind==='tornado' && !this.landed && this.bt+1e-5>=cues.tornado) {
      this.landed=true
      this.tornadoActive=true; this.tornadoAge=0
      forward(this.bossYaw,this.tornadoDirection)
      this.tornadoPosition.copy(this.m).addScaledVector(this.tornadoDirection,1.26)
      this.effects.tornado(this.tornadoPosition)
    }
    if (finished) {
      this.effects.stop('beam'); this.effects.stop('spin')
      this.callout='攻撃後の隙'
      this.setBoss('recovery')
    }
  }

  private beamHits() {
    const origin=this.effects.mouth(this.beamOrigin)
    forward(this.bossYaw,this.beamAim)
    const offset=this.beamTarget.copy(this.p).sub(origin).setY(0)
    const distance=offset.dot(this.beamAim)
    return distance>=0 && distance<=combat.beamLength &&
      Math.abs(offset.x*this.beamAim.z-offset.z*this.beamAim.x)<combat.beamWidth+.29
  }

  private hitPlayer(damage:number,knockdown:boolean,source:Vector3,power=1) {
    return this.damagePlayer({damage,knockdown},source,power*(this.rage?combat.ragePower:1))
  }

  private tickTornado(dt:number) {
    if (!this.tornadoActive) return
    this.tornadoAge+=dt
    this.tornadoPosition.addScaledVector(this.tornadoDirection,combat.tornadoSpeed*dt)
    if (this.tornadoAge>=combat.tornadoDuration) {
      this.stopTornado()
    } else if (flatDistance(this.tornadoPosition,this.p)<=combat.tornadoRadius+.30 &&
      this.hitPlayer(combat.tornadoDamage,false,this.tornadoPosition)) {
      this.reverseMovement=combat.reverseDuration
      this.stopTornado()
    }
  }

  private stopTornado() {
    this.tornadoActive=false
    this.effects.stop('tornado')
  }

  private tickSummon(dt:number) {
    const finished=this.play('summon',dt)
    if (!this.barrier && this.bt+1e-5>=cues.barrier) {
      this.barrier=true
      this.effects.barrier()
    }
    if (this.bt-dt<cues.minions && this.bt>=cues.minions) this.spawnClones()
    if (finished) this.approach()
  }

  private spawnClones() {
    const angle=yawTo(this.m,this.p)
    const positions=this.clones.map((clone,i)=>{
      const model=clone.model
      const position=model.root.position.copy(this.m)
      position.addScaledVector(forward(angle,this.delta),2)
      const side=i===0?-2:2
      position.x+=Math.cos(angle)*side
      position.z-=Math.sin(angle)*side
      this.arena.resolve(position,model.data.radius)
      clone.hp=model.data.hp; clone.state='chase'; clone.age=0
      clone.readyAt=this.elapsed+1+i*.9
      model.root.rotation.y=yawTo(position,this.p)
      this.scene.add(model.root)
      model.animate('idle',0)
      return position
    })
    this.effects.summon(positions)
  }

  private tickClone(clone:Clone,dt:number) {
    const model=clone.model, position=model.root.position
    const distance=flatDistance(position,this.p)
    clone.age+=dt
    if (clone.state==='chase') {
      const angle=yawTo(position,this.p)
      model.root.rotation.y=angle
      if (distance<2.15 && this.elapsed>=clone.readyAt) {
        clone.state='windup'; clone.age=0; clone.hit=false
        this.fx.ring(position,1.48,1.48,.70,0xce86ff)
      } else if (distance>1.28) {
        this.moveEntity(position,forward(angle,this.delta),2.9*dt,model.data.radius,this.p,.44)
        this.moveEntity(position,this.delta,0,model.data.radius,this.m,this.monster.data.radius)
        for (const other of this.clones) {
          if (other!==clone && other.hp>0) this.moveEntity(position,this.delta,0,model.data.radius,other.model.root.position,other.model.data.radius)
        }
      }
      model.animate(distance>1.28?'walk':'idle',dt)
      return
    }
    const motion=clone.state==='windup'?'spinPrep':clone.state==='spin'?'spin':'spinRecover'
    const duration=model.duration(motion)
    model.animate(motion,dt,clamp(clone.age/duration,0,1))
    if (clone.state==='spin' && !clone.hit && distance<=1.76) {
      clone.hit=this.hitPlayer(combat.spinDamage,false,position,combat.minionPower)
    }
    if (clone.age+1e-5<duration) return
    clone.age=0
    if (clone.state==='windup') { clone.state='spin'; clone.effects.spin() }
    else if (clone.state==='spin') clone.state='recover'
    else { clone.state='chase'; clone.readyAt=this.elapsed+1.4 }
  }
}
