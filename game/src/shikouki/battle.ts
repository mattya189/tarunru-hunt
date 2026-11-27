import { Vector3 } from 'three'
import { Battle } from '../battle'
import type { HitVolume } from '../flare/combat'
import type { WeaponData } from '../config'
import type { Effects } from '../effects'
import type { HunterModel } from '../hunter'
import type { Controls } from '../input'
import type { MonsterModel } from '../monster-model'
import type { Arena } from '../world'
import { clamp, flatDistance, wrap } from '../math'
import { ShikoukiAttacks, type Crystal } from './attacks'
import { phases } from './config'
import { ShikoukiVisuals } from './visuals'

export class ShikoukiBattle extends Battle {
  attacks!:ShikoukiAttacks
  visuals!:ShikoukiVisuals
  private readonly crystalHitPoint=new Vector3()

  constructor(monster:MonsterModel, hunter:HunterModel, arena:Arena, fx:Effects, weapon:WeaponData) {
    super(monster,hunter,arena,fx,weapon)
    this.visuals=new ShikoukiVisuals()
    this.reset()
  }

  override reset() {
    super.reset()
    this.attacks=new ShikoukiAttacks(this.m,this.arena.data.radius,{
      ground:this.arena.height,
      resolve:p=>this.arena.resolve(p,this.monster.data.radius),
      damage:(damage,source,knockdown,scale)=>!this.outcome && this.damagePlayer({damage,knockdown},source,this.monster.data.power,scale),
      ring:(p,size,color)=>this.fx.ring(p,.4,size,.52,color),
      sound:(cue,p,level)=>this.fx.sound(cue,p,level),
    })
    this.visuals?.clear()
  }

  override get rageLabel() { return phases[this.attacks.phase].name }
  override get defeatDuration() { return 3 }

  override update(dt:number,input:Controls,viewYaw:number) {
    super.update(dt,input,viewYaw)
    if(this.outcome) this.attacks.clear()
    this.visuals.update(this.attacks)
  }

  protected override acceptBossDamage() { return !this.attacks.airborne }
  protected override canInterruptBoss() {
    return !this.attacks.action && !this.attacks.isRecovering
  }

  protected override strikeSecondary(damage:number,volume?:HitVolume,area=false) {
    let hit:Crystal|undefined
    let nearest=1
    let dealt=0
    for(const c of this.attacks.crystals) {
      if(!volume && flatDistance(c.center,this.p)>4.5) continue
      this.crystalHitPoint.copy(c.center).y+=.88
      const distance=volume?volume(this.crystalHitPoint,.76):this.strikeDistanceSquared(this.crystalHitPoint)/.76**2
      if(distance>nearest) continue
      if(area) dealt+=this.strikeCrystal(c,damage)
      else { nearest=distance; hit=c }
    }
    if(!hit || this.acceptBossDamage() && this.findStrike(this.monster,volume)) return dealt
    return this.strikeCrystal(hit,damage)
  }

  private strikeCrystal(hit:Crystal,damage:number) {
    const dealt=Math.min(hit.hp,damage)
    hit.hp-=damage
    this.crystalHitPoint.copy(hit.center).y+=.88
    this.fx.hit(this.crystalHitPoint,Math.round(damage),'結晶',0xc57fff,hit.hp<=0,false,hit.hp<=0?'crystal-burst':'hit-armor')
    if(hit.hp<=0) this.attacks.breakCrystal(hit,false)
    return dealt
  }

  protected override updateBoss(dt:number) {
    const a=this.attacks
    const interruption=this.bossState==='stagger' || this.bossState==='hit'
    // The ultimate's down state is driven by its own attack timeline.
    const knockedDown=this.bossState==='fall' && a.motion!=='fall'
    const stopped=(interruption || knockedDown) && this.bt<(knockedDown?2.5:this.bossState==='stagger'?.85:.40)
    a.update(dt,this.p,this.bossHp,stopped)
    if(this.outcome) return
    if(stopped) {
      if(knockedDown) this.monster.animate('fall',dt,clamp(this.bt/1.5,0,1))
      else this.monster.animate('hit',dt,clamp(this.bt/.45,0,1))
      return
    }
    this.rage=a.phase>0
    this.callout=a.callout
    const state=a.motion==='fall' && (a.action || a.isRecovering) ? 'fall'
      : a.action?.id==='phase' ? 'rage'
      : a.action ? a.hazards.some(h=>h.live) ? 'attack' : 'windup'
      : a.isRecovering ? 'recovery'
      : a.motion==='walk' ? 'approach' : 'idle'
    if(this.bossState!==state) this.setBoss(state)
    this.bossYaw+=wrap(a.angle-this.bossYaw)*Math.min(1,dt*this.monster.data.ai.turnSpeed)
    this.monster.root.rotation.y=this.bossYaw
    this.monster.animate(a.motion,dt,a.progress)
  }
}
