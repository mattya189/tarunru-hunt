import { Vector3 } from 'three'
import { Battle, type BossState } from '../battle'
import type { Controls } from '../input'
import { clamp, flatDistance, forward, wrap, yawTo } from '../math'
import { combat, type SabotAttack } from './config'
import { AttackRuntime, timelineFor } from './attack-runtime'

export class SabotBattle extends Battle {
  private runtime!:AttackRuntime
  private readyAt:Record<SabotAttack,number>={attack_01:0,attack_05:0,special_01:0}
  private rageAttacks=0
  private lastMove?:SabotAttack
  private standingUp=false
  private readonly previousHunter=new Vector3()

  attachRuntime(runtime:AttackRuntime) { this.runtime=runtime }
  get attacksRuntime() { return this.runtime }
  override get defeatDuration() { return this.monster.duration('defeat') }

  override reset() {
    super.reset()
    this.runtime?.clear()
    this.readyAt={attack_01:0,attack_05:0,special_01:0}
    this.rageAttacks=0; this.lastMove=undefined; this.standingUp=false
  }
  override update(dt:number,input:Controls,yaw:number) {
    this.previousHunter.copy(this.p)
    super.update(dt,input,yaw)
    if(this.outcome && this.outcomeTime===0) this.runtime.clear()
  }
  protected override canInterruptBoss() {
    const run=this.runtime.active
    return !(run?.timeline.id==='special_01' && run.detonated)
  }
  protected override setBoss(state:BossState) {
    if(this.runtime?.active && (state==='stagger'||state==='fall'||state==='defeat')) {
      const id=this.runtime.active.timeline.id
      this.runtime.interrupt()
      this.readyAt[id]=this.runtime.time+combat.attacks[id].cooldown
    }
    if(state==='fall') this.standingUp=false
    super.setBoss(state)
  }

  protected override updateBoss(dt:number) {
    const runtime=this.runtime
    const data=this.monster.data
    const distance=flatDistance(this.m,this.p), aim=yawTo(this.m,this.p)
    const difference=()=>wrap(aim-this.bossYaw)
    const turn=(span=dt)=>{
      this.bossYaw+=clamp(difference(),-data.ai.turnSpeed*span,data.ai.turnSpeed*span)
      this.monster.root.rotation.y=this.bossYaw
    }
    const ready=(id:SabotAttack)=>runtime.time>=this.readyAt[id] && distance>=combat.attacks[id].min &&
      distance<=combat.attacks[id].max && Math.abs(difference())<=combat.attacks[id].angle

    if(runtime.active) {
      const move=runtime.active.timeline.id
      const remainingAim=combat.attacks[move].aimUntil-runtime.elapsed
      if(remainingAim>0) turn(Math.min(dt,remainingAim))
      if(remainingAim<=dt) { this.bossState='attack'; this.callout=timelineFor(move).label }
      this.tickAttacks(dt)
      if(!runtime.active) {
        this.readyAt[move]=runtime.time+combat.attacks[move].cooldown
        if(this.rage && move!=='special_01') this.rageAttacks++
        this.callout=''; this.setBoss('approach')
      }
      return
    }
    if(!this.rage && this.bossHp<=combat.enrageHp && ['approach','turn','search','hit'].includes(this.bossState)){
      this.rage=true; this.rageAttacks=0
      this.callout='怒り · 焼き込みブレスに注意'; this.setBoss('rage')
    }
    switch(this.bossState){
      case 'idle':
        this.monster.animate('idle',dt)
        if(this.bt>.75 && distance<data.ai.wake) {this.callout='モンスターがこちらに気づいた';this.setBoss('search')}
        break
      case 'search':
      case 'rage': {
        const motion=this.bossState==='rage'?'enrage':'roar'
        const duration=this.monster.duration(motion)
        if(motion==='roar') turn(dt*.5)
        this.monster.animate(motion,dt,clamp(this.bt/duration,0,1))
        if(this.bt>=duration) {this.callout='';this.setBoss('approach')}
        break
      }
      case 'approach':
      case 'turn': {
        turn()
        const next=this.rage && this.rageAttacks>0 && this.lastMove!=='special_01' && ready('special_01')?'special_01':
          this.rage && ready('attack_05')?'attack_05':ready('attack_01')?'attack_01':undefined
        if(next) {
          runtime.begin(next); this.lastMove=next
          if(next==='special_01') this.rageAttacks=0
          this.callout=timelineFor(next).label+' · 予兆'; this.setBoss('windup')
        } else if(Math.abs(difference())>.53){
          this.monster.animate(difference()<0?'turnRight':'turn',dt)
        } else {
          const retreat=distance<combat.attacks.attack_01.min
          const approach=distance>(this.rage?combat.rageApproachDistance:combat.attacks.attack_01.max)
          if(retreat || approach) {
            const speed=data.speed*(this.rage?data.rage.speed:1)*(retreat?-combat.retreatSpeed:1)
            this.moveEntity(this.m,forward(this.bossYaw,this.delta),speed*dt,data.radius,this.p,.44)
            this.monster.animate('walk',dt)
          } else this.monster.animate('idle',dt)
        }
        break
      }
      case 'hit':
      case 'stagger':
      case 'fall': {
        const motion=this.bossState==='fall' && this.standingUp?'getUp':this.bossState
        const duration=this.monster.duration(motion)
        this.monster.animate(motion,dt,clamp(this.bt/duration,0,1))
        if(this.bt>=duration){
          if(motion==='fall') {this.standingUp=true;this.bt=0}
          else {this.callout='';this.setBoss('approach')}
        }
        break
      }
    }
    this.tickAttacks(dt)
  }

  private tickAttacks(dt:number) {
    this.runtime.step(dt,this.previousHunter,this.p,
      (id,t,span)=>this.monster.animate(id,span,clamp(t/this.monster.duration(id),0,1)),
      (damage,source,knockdown)=>!this.outcome&&this.damagePlayer({damage,knockdown},source,1))
  }
}
