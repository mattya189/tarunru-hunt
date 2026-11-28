import { Vector3 } from 'three'
import { advancingSlash, type Attack, type AttackId, type WeaponData, type WeaponStrike } from './config'
import type { Arena } from './world'
import type { Controls } from './input'
import type { Effects } from './effects'
import type { HunterModel, HunterPose } from './hunter'
import { emberHop, flareSpells, FlareCombat, type HitVolume } from './flare/combat'
import type { FlareModel } from './flare/model'
import { MonsterModel } from './monster-model'
import { clamp, flatDistance, forward, pointSegmentSquared, smooth, wrap, yawTo } from './math'

type FighterState = 'free' | 'skill' | 'cast' | 'swing' | 'charge' | 'dodge' | 'hit' | 'down' | 'rise'
export const battleStep = 1/60
const dodgeTiming = { duration: .59, invincibleFrom: .016, invincibleFor: .275, slowdown: .66 }
const rollTravelTime = Array.from({length:Math.ceil(dodgeTiming.duration/battleStep)+1},(_,tick)=>
  (1-dodgeTiming.slowdown*Math.min(1,tick*battleStep/dodgeTiming.duration))*battleStep
).reduce((total,tick)=>total+tick,0)
export type BossState = 'idle' | 'search' | 'approach' | 'turn' | 'windup' | 'attack' | 'recovery' | 'hit' | 'stagger' | 'fall' | 'rage' | 'defeat'

export class Battle {
  readonly p: Vector3
  readonly m: Vector3
  hp: number
  stamina: number
  bossHp: number
  rage = false
  elapsed = 0
  private lockedMonster?: MonsterModel
  callout = ''
  chargeValue = 0
  reverseMovement = 0
  outcome: 'victory' | 'failure' | null = null
  outcomeTime = 0
  playerYaw = Math.PI
  bossYaw = 0
  playerState: FighterState = 'free'
  bossState: BossState = 'idle'
  private pt = 0
  private controls?: Controls
  private dodgeBack = false
  protected bt = 0
  private immune = 0
  private staminaDelay = 0
  private guard = false
  private combo = 0
  private charged = false
  private power = 1
  private struck = false
  private strike: WeaponStrike
  private attack?: Attack
  private attackLocked = false
  private attackHit = false
  private milestone = 0
  private rageSequence = 0
  private attackCount = 0
  private poise = 0
  private legDamage = 0
  private recentlyStaggered = 0
  private lastAttack?: AttackId
  private cooldowns: Record<AttackId,number> = { swipe:0,rush:1,spin:2,leap:3,special:6 }
  private move = {x:0,y:0}
  private direction = new Vector3()
  protected delta = new Vector3()
  private target = new Vector3()
  private attackOrigin = new Vector3()
  private launch = new Vector3()
  private roll = new Vector3()
  private shove = new Vector3()
  private bladeA = new Vector3()
  private bladeB = new Vector3()
  private previousA = new Vector3()
  private previousB = new Vector3()
  private attackAim = new Vector3()
  private hitPoint = new Vector3()
  private waveTime = 0
  private recoveryDuration = .8
  private flareModel?: FlareModel
  private magic?: FlareCombat
  private skillReadyAt = 0
  private skillDirection = new Vector3()
  private skillPosition = new Vector3()
  private skillBlocked = false
  private skillTargets = new Set<object>()
  private magicOrigin = new Vector3()
  private magicAim = new Vector3()

  get skillCooldown() { return Math.max(0,this.skillReadyAt-this.elapsed) }
  get flare() { return this.flareModel ? this.magic : undefined }
  selectHunter(model?:FlareModel) {
    this.flareModel?.root.removeFromParent()
    this.magic?.reset()
    this.flareModel=model
    if(model) {
      this.hunter.root.add(model.root)
      this.magic ??= new FlareCombat()
      this.magic.attach(this.fx.root)
    }
    this.hunter.showSword(!model)
  }

  constructor(readonly monster: MonsterModel, readonly hunter: HunterModel, protected arena: Arena, protected fx: Effects, readonly weapon: WeaponData) {
    this.p = hunter.root.position
    this.hp=weapon.hp; this.stamina=weapon.stamina; this.strike=weapon.swings[0]
    this.m = monster.root.position
    this.bossHp = monster.data.hp
    this.reset()
  }
  reset() {
    this.p.set(this.arena.data.playerSpawn[0],0,this.arena.data.playerSpawn[1]); this.arena.resolve(this.p,.44)
    this.m.set(this.arena.data.monsterSpawn[0],0,this.arena.data.monsterSpawn[1]); this.arena.resolve(this.m,this.monster.data.radius)
    this.hp=this.weapon.hp; this.stamina=this.weapon.stamina; this.bossHp=this.monster.data.hp
    this.playerYaw=Math.PI; this.bossYaw=0; this.rage=false; this.elapsed=0; this.outcome=null; this.outcomeTime=0; this.lockedMonster=undefined
    this.pt=this.bt=this.immune=this.staminaDelay=this.poise=this.legDamage=this.recentlyStaggered=0
    this.controls?.clearCombatBuffer(); this.dodgeBack=false
    this.chargeValue=this.attackCount=this.rageSequence=this.waveTime=this.milestone=0
    this.lastAttack=undefined; this.attack=undefined
    this.charged=this.struck=this.attackLocked=this.attackHit=this.guard=false
    this.callout=''; this.reverseMovement=0; this.cooldowns={swipe:0,rush:1,spin:2,leap:3,special:6}
    this.skillReadyAt=0
    this.skillTargets.clear()
    this.magic?.reset(); this.flareModel?.reset()
    if(this.flareModel) this.flareModel.root.position.y=0
    this.fx.clear(); this.setPlayer('free'); this.setBoss('idle')
    this.hunter.root.rotation.y=this.playerYaw; this.hunter.pose('idle',0,0,0,0)
    this.monster.root.rotation.y=this.bossYaw; this.monster.setEnraged(false); this.monster.animate('idle',0)
  }
  update(dt: number, input: Controls, viewYaw: number) {
    this.controls=input
    if (this.outcome) {
      input.clearCombatBuffer()
      this.outcomeTime += dt
      if (this.outcome === 'victory') this.monster.animate('defeat',dt,clamp(this.outcomeTime/this.defeatDuration,0,1))
      if(this.flareModel) {
        this.magic!.stop()
        this.flareModel.root.position.y=0
        this.flareModel.pose(this.outcome==='victory'?'Victory':'Death',dt)
      } else if(this.outcome==='failure') this.hunter.pose('down',clamp(this.outcomeTime/.46,0,1),dt,0,0)
      return
    }
    this.elapsed += dt
    if (input.take('lock')) this.lockedMonster = this.lockedMonster ? undefined : this.defaultLockTarget()
    this.pt += dt; this.bt += dt
    this.immune=Math.max(0,this.immune-dt)
    this.staminaDelay=Math.max(0,this.staminaDelay-dt)
    this.recentlyStaggered=Math.max(0,this.recentlyStaggered-dt)
    if (!this.staminaDelay) this.stamina=Math.min(this.weapon.stamina,this.stamina+24*dt)
    this.reverseMovement=Math.max(0,this.reverseMovement-dt)
    this.updatePlayer(dt,input,viewYaw)
    this.updateBoss(dt)
    if(this.magic && this.flareModel) {
      if(!this.outcome) {
        this.explodeEmber(this.magic)
        this.magic.tick(dt,this.arena,(volume,damage)=>this.strikeWithMagic(volume,damage))
      }
      if(this.outcome) this.magic.stop()
    } else if(this.playerState==='skill') this.strikeWithAdvancingSlash()
    else this.strikeMonster()
    if (this.lockedMonster && !this.reticleTargets.includes(this.lockedMonster)) {
      this.lockedMonster = this.defaultLockTarget()
    }
  }

  get lock() { return this.lockedMonster !== undefined }
  get selectedLockTarget() { return this.lockedMonster }
  get lockTarget() { return this.aimedMonster.root.position }
  get reticleTargets(): readonly MonsterModel[] { return [this.monster] }

  selectLockTarget(monster: MonsterModel) {
    if (this.outcome || !this.reticleTargets.includes(monster)) return
    this.lockedMonster = monster
  }

  protected defaultLockTarget() { return this.monster }
  private get aimedMonster() { return this.lockedMonster ?? this.defaultLockTarget() }
  get rageLabel() { return '怒り' }
  get fieldDarkness() { return 0 }
  get field() { return this.arena }
  get defeatDuration() { return 1.65 }
  protected get bossGroundRadius() { return this.monster.data.radius }
  protected get guarding() { return this.guard }
  protected get attackDamageMultiplier() { return this.monster.data.power*(this.rage?1.1:1) }

  private setPlayer(state: FighterState) { this.playerState=state; this.pt=0 }
  protected setBoss(state: BossState) { this.bossState=state; this.bt=0 }
  private useStamina(cost: number) {
    if (this.stamina < cost) return false
    this.stamina -= cost; this.staminaDelay = .68; return true
  }
  protected moveEntity(pos: Vector3, motion: Vector3, speed: number, radius: number, target: Vector3, targetRadius: number) {
    pos.addScaledVector(motion,speed)
    this.arena.resolve(pos,radius)
    if(targetRadius===0) return
    const dist = flatDistance(pos,target), min = radius+targetRadius
    if (dist < min) {
      const x = pos.x-target.x, z=pos.z-target.z
      pos.x = target.x + (dist ? x/dist : 1)*min; pos.z = target.z+(dist ? z/dist : 0)*min
      this.arena.resolve(pos,radius)
    }
  }
  private updatePlayer(dt: number,input: Controls,viewYaw: number) {
    input.movement(this.move)
    if(this.reverseMovement>0) { this.move.x*=-1; this.move.y*=-1 }
    const magic=this.flare
    const chargeCancelled=input.takeChargeCancel()
    const releasedCharge=input.takeChargeRelease() && this.playerState==='charge' && !chargeCancelled
    if (chargeCancelled && this.playerState==='charge') this.setPlayer('free')
    const magnitude=Math.hypot(this.move.x,this.move.y)
    const dir=this.direction.set(-Math.cos(viewYaw)*this.move.x-Math.sin(viewYaw)*this.move.y,0,Math.sin(viewYaw)*this.move.x-Math.cos(viewYaw)*this.move.y)
    const target=this.lockTarget
    const angle = yawTo(this.p,target)
    let pose: HunterPose='idle', phase=0
    const wasGuarding=this.guard
    this.guard=false
    this.chargeValue=0
    const requestedSkill=input.take('skill')
    if(this.playerState==='skill' && this.pt+1e-9>=(magic ? emberHop.duration : advancingSlash.duration)) {
      this.setPlayer('free')
    }
    const canDodge = this.playerState==='free' || this.playerState==='charge' ||
      (this.playerState==='swing' && this.pt > this.strike.windup+this.strike.active+(this.charged?0:.06)) ||
      (this.playerState==='cast' && magic?.canDodge(this.pt)) ||
      (this.playerState==='skill' && !magic && this.pt+1e-9>=advancingSlash.dodgeAfter)
    if (canDodge && input.take('dodge') && this.useStamina(20)) {
      input.clearCombatBuffer()
      this.startDodge(dir,magnitude)
    }
    if (this.playerState==='free') {
      this.guard=input.held('guard') && this.stamina >= 5
      if (this.guard && !wasGuarding) this.fx.sound('guard-raise',this.p)
      if (!this.guard && requestedSkill && !this.skillCooldown) {
        input.clearCombatBuffer()
        this.beginSkill(dir,magnitude)
      } else {
        if (magnitude>.045 || this.lock) {
          const aim=this.lock ? angle : Math.atan2(dir.x,dir.z)
          this.playerYaw += wrap(aim-this.playerYaw)*Math.min(1,dt*16)
        }
        const shot = input.has('attack') || !!magic && input.held('attack')
        const charge = input.has('charge')
        const aimed = this.lock || Math.abs(wrap(angle-this.playerYaw))<.60
        if (!this.guard && magic?.begin(shot,charge,this.elapsed,aimed)) {
          input.clearCombatBuffer()
          if(aimed) this.playerYaw=angle
          this.setPlayer('cast')
          if(magic.cast?.spell) {
            const { radius,release,color }=magic.cast.spell
            this.fx.sound('magic-charge',this.p)
            this.fx.ring(this.p,radius,radius,release,color,.47)
          }
        } else if (!this.guard && !magic && shot && this.useStamina(5)) {
          input.clearCombatBuffer()
          this.beginSwing(0,false)
        } else if (!this.guard && !magic && charge && this.useStamina(12)) {
          input.clearCombatBuffer()
          this.setPlayer('charge')
          this.fx.sound('sword-charge',this.p)
        } else {
          pose=this.guard?'guard':magnitude>.045?'run':'idle'
          this.moveEntity(this.p,dir,(this.guard?1.7:this.weapon.walk)*dt,.44,this.m,this.bossGroundRadius)
        }
      }
    }
    if (this.playerState==='skill') {
      this.moveSkill(dt,magic ? emberHop : advancingSlash)
      if(!magic) {
        pose='swing'
        const { windup,activeUntil,duration }=advancingSlash
        phase=this.pt<windup ? this.pt/windup : this.pt<activeUntil ? 1+(this.pt-windup)/(activeUntil-windup) :
          2+clamp((this.pt-activeUntil)/(duration-activeUntil),0,1)
        if(this.pt>=windup && this.pt-dt<windup) this.fx.sound('sword-light',this.p)
      }
    }
    if (this.playerState==='charge') {
      this.chargeValue=clamp(this.pt/1.16,.015,1); phase=this.chargeValue
      this.playerYaw += wrap(angle-this.playerYaw)*dt*(this.lock?10:2.5)
      this.moveEntity(this.p,dir,dt*1.1,.44,this.m,this.bossGroundRadius)
      pose='charge'
      if (releasedCharge || !input.held('charge') || this.pt>=1.92) {
        this.power=this.pt>=1.12?2.12:this.pt>=.52?1.60:1
        this.beginSwing(3,true)
      }
    }
    if (this.playerState==='swing') {
      pose='swing'
      const s=this.strike, duration=s.windup+s.active+s.recovery
      if (this.pt >= s.windup && this.pt - dt < s.windup) {
        this.fx.sound(this.charged || this.combo===2 ? 'sword-heavy' : 'sword-light',this.p)
      }
      phase=this.pt<s.windup ? this.pt/s.windup : this.pt<s.windup+s.active ? 1+(this.pt-s.windup)/s.active : 2+clamp((this.pt-s.windup-s.active)/s.recovery,0,1)
      if (phase<1 && (this.lock || (flatDistance(this.p,target)<4.0 && Math.abs(wrap(angle-this.playerYaw))<1.1))) {
        this.playerYaw += wrap(angle-this.playerYaw)*Math.min(1,10*dt)
      }
      if (phase>.72 && phase<1.67) this.moveEntity(this.p,forward(this.playerYaw,this.delta),s.lunge*dt,.44,this.m,this.bossGroundRadius)
      if (this.pt>=duration) {
        if (this.combo<2 && !this.charged && input.has('attack') && this.useStamina(5)) {
          input.clearCombatBuffer()
          this.beginSwing(this.combo+1,false); phase=0
        } else { this.setPlayer('free'); pose='idle'; phase=0 }
      }
    }
    if (this.playerState==='dodge') {
      pose='dodge'; phase=clamp(this.pt/dodgeTiming.duration,0,1)
      this.moveEntity(this.p,this.roll,this.weapon.roll*(1-dodgeTiming.slowdown*phase)*dt,.44,this.m,this.bossGroundRadius)
      if (phase>=1) { this.setPlayer('free'); pose='idle' }
    }
    if (this.playerState==='hit' || this.playerState==='down' || this.playerState==='rise') {
      pose=this.playerState
      const duration=pose==='hit'?.42:pose==='down'?.79:.49
      phase=clamp(this.pt/duration,0,1)
      if (pose!=='rise' && this.pt<.24) this.moveEntity(this.p,this.shove,(pose==='down'?5:3)*dt,.44,this.m,this.bossGroundRadius)
      if (phase>=1) this.setPlayer(pose==='down'?'rise':'free')
    }
    this.hunter.root.rotation.y=this.playerYaw
    if(magic) {
      const hopProgress=clamp(this.pt/emberHop.moveDuration,0,1)
      this.flareModel!.root.position.y=this.playerState==='skill' ? .32*Math.sin(Math.PI*hopProgress) : 0
      if(this.playerState==='skill') {
        this.flareModel!.pose('Dodge',dt,.60*hopProgress)
        return
      }
      const cast = magic.cast
      if(this.playerState==='cast' && cast) {
        this.flareModel!.pose(cast.clip,dt,this.pt)
        const released=magic.release(this.pt)
        if(released?.spell) {
          const spell=released.spell
          this.fx.sound(spell.sound,this.p)
          this.fx.ring(this.p,spell.radius*.95,spell.radius,.55,spell.color)
          this.fx.ring(this.p,.3,spell.radius,.38,spell.color)
          this.fx.burst(this.p,spell.color,true,spell.radius*.55)
          this.strikeWithMagic((center)=>flatDistance(this.p,center)**2/spell.radius**2,spell.damage,spell.name)
        } else if(released) {
          this.flareModel!.hand.getWorldPosition(this.magicOrigin)
          magic.launch(this.magicOrigin,this.playerYaw,released.aimed?this.magicLockPoint():undefined)
          this.fx.sound('magic-shot',this.magicOrigin)
        }
        if(this.pt>=cast.duration) {
          magic.cast=undefined
          this.setPlayer('free')
        }
      } else {
        magic.cast=undefined
        const clip = { idle:'Idle',run:'Run',guard:'Guard',dodge:'Dodge',hit:'Hit',down:'Hit',rise:'Idle',swing:'Idle',charge:'Idle' }[pose]
        const time=pose==='dodge'?(this.dodgeBack?1-phase:phase)*.65:undefined
        if (this.flareModel!.pose(clip,dt,time) && magnitude > .18) {
          this.fx.sound('footstep',this.p,.75+.25*magnitude)
        }
      }
      return
    }
    if (this.hunter.pose(pose,phase,dt,this.combo,magnitude,this.dodgeBack)) this.fx.sound('footstep',this.p,.75+.25*magnitude)
    this.previousA.copy(this.bladeA); this.previousB.copy(this.bladeB)
    this.hunter.blade(this.bladeA,this.bladeB)
    if (pose==='swing' && phase>.98 && phase<1.99) this.fx.blade(this.bladeA,this.bladeB,this.charged && this.power>1)
    else this.fx.endBlade()
  }
  private beginSkill(direction:Vector3,magnitude:number) {
    const magic=this.flare
    this.skillReadyAt=this.elapsed+(magic ? emberHop.cooldown : advancingSlash.cooldown)
    this.skillBlocked=false
    this.skillTargets.clear()
    this.setPlayer('skill')
    if(magnitude>.13) this.skillDirection.copy(direction).normalize()
    else forward(this.playerYaw,this.skillDirection).multiplyScalar(magic ? -1 : 1)

    if(magic) {
      magic.plantEmber(this.p,this.elapsed)
      this.fx.sound('dodge',this.p)
    } else {
      this.playerYaw=Math.atan2(this.skillDirection.x,this.skillDirection.z)
      this.combo=0
      this.charged=false
    }
  }

  private moveSkill(dt:number, skill:typeof emberHop | typeof advancingSlash) {
    if(this.skillBlocked) return
    const fraction=(clamp(this.pt,0,skill.moveDuration)-clamp(this.pt-dt,0,skill.moveDuration))/skill.moveDuration
    if(fraction<=0) return
    const distance=this.weapon.roll*rollTravelTime*skill.distanceRatio*fraction
    this.skillPosition.copy(this.p).addScaledVector(this.skillDirection,distance)
    this.moveEntity(this.p,this.skillDirection,distance,.44,this.m,this.bossGroundRadius)
    if(flatDistance(this.p,this.skillPosition)>1e-4) this.skillBlocked=true
  }

  private explodeEmber(magic:FlareCombat) {
    const position=magic.releaseEmber(this.elapsed)
    if(!position) return
    const { radius,color,damageRatio }=emberHop
    this.fx.sound('flare-1',position)
    this.fx.ring(position,.25,radius,.36,color)
    this.fx.burst(position,color,false,radius*.55)
    this.strikeWithMagic(center=>flatDistance(position,center)**2/radius**2,
      Math.round(flareSpells[0].damage*damageRatio),'残火跳び')
  }

  private strikeWithAdvancingSlash() {
    const { windup,activeUntil,reach,halfAngle,damageRatio }=advancingSlash
    if(this.outcome || this.pt<windup || this.pt>activeUntil) return
    const volume:HitVolume=(center,radius)=>{
      const bearing=Math.abs(wrap(yawTo(this.p,center)-this.playerYaw))
      const distance=flatDistance(this.p,center)
      const edgeAngle=Math.max(0,bearing-halfAngle)
      const along=clamp(distance*Math.cos(edgeAngle),0,reach)
      const horizontal=Math.hypot(distance*Math.sin(edgeAngle),distance*Math.cos(edgeAngle)-along)
      const low=Math.min(this.bladeA.y,this.bladeB.y), high=Math.max(this.bladeA.y,this.bladeB.y)
      const vertical=center.y-clamp(center.y,low,high)
      return (horizontal**2+vertical**2)/radius**2
    }
    const damage=this.weapon.swings[0].damage*damageRatio
    const best=this.skillTargets.has(this.monster) ? undefined : this.findStrike(this.monster,volume)
    const accepted=best && this.acceptBossDamage()
    if(best) this.skillTargets.add(this.monster)
    this.strikeSecondary(damage,volume,true,this.skillTargets)
    if(best && accepted) this.applyMonsterHit(best,Math.round(damage*best.config.multiplier),'踏み込み斬り')
  }

  protected magicLockPoint() {
    const monster=this.aimedMonster
    return this.magicAim.copy(monster.parts[0]?.center ?? monster.root.position)
  }

  protected magicPartBonus(_part: MonsterModel['parts'][number]) { return 1 }

  private strikeWithMagic(volume:HitVolume,damage:number,spell?:string) {
    if(this.outcome) return -1
    const best=this.findStrike(this.monster,volume)
    const blocked=spell && best && !this.acceptBossDamage()
    const secondary=this.strikeSecondary(damage,volume,!!spell)
    if(!spell && secondary) return secondary
    if(!best) return secondary || -1
    if(blocked || !spell && !this.acceptBossDamage()) return secondary
    return this.applyMonsterHit(best,this.magicBossDamage(damage)*this.magicPartBonus(best),spell??'エネルギーショット',spell?0xff9537:0xffb070,.40)
  }

  private startDodge(direction: Vector3, magnitude: number) {
    this.setPlayer('dodge')
    this.fx.sound('dodge',this.p)
    this.dodgeBack=magnitude<=.13
    if (this.dodgeBack) forward(this.playerYaw,this.roll).negate()
    else {
      this.roll.copy(direction).normalize()
      this.playerYaw=Math.atan2(this.roll.x,this.roll.z)
    }
    this.onDodge(this.roll)
  }
  protected onDodge(_direction: Vector3) {}
  private beginSwing(combo: number, charged: boolean) {
    this.combo=combo; this.charged=charged; this.strike=charged?this.weapon.charge:this.weapon.swings[combo]
    if (!charged) this.power=1
    this.struck=false
    this.setPlayer('swing')
  }
  private strikeMonster() {
    const s=this.strike
    if (this.outcome || this.playerState!=='swing' || this.struck || this.pt<s.windup || this.pt>s.windup+s.active) return
    if (this.strikeSecondary(s.damage*this.power)) { this.struck=true; return }
    const best=this.findStrike(this.monster)
    if (!best) return
    this.struck=true
    const damage=Math.round(s.damage*this.power*best.config.multiplier)
    if (!this.acceptBossDamage()) return
    this.applyMonsterHit(best,damage)
  }

  private applyMonsterHit(best:MonsterModel['parts'][number],damage:number,name=best.config.name,color=0xffce79,staggerScale=1) {
    damage=this.preserveBossHealth(damage)
    if(damage<=0) return 0
    const dealt=Math.min(this.bossHp,damage)
    this.bossHp=Math.max(0,this.bossHp-damage)
    const stagger=damage*best.config.stagger*staggerScale
    this.poise+=stagger
    if (best.config.bone===this.monster.data.rig?.leftLeg || best.config.bone===this.monster.data.rig?.rightLeg) this.legDamage+=stagger
    this.fx.hit(best.center,damage,name,color,damage>=88,false,
      staggerScale < 1 ? 'magic-hit' : this.monster.data.metallic ? 'hit-armor' : 'hit-flesh')
    this.onBossHit(staggerScale<1,dealt)
    if (this.bossHp===0) {
      this.controls?.clearCombatBuffer()
      this.setBoss('defeat'); this.outcome='victory'; this.callout='討伐完了'; return dealt
    }
    if (!this.canInterruptBoss() || this.bossState==='fall' || this.bossState==='stagger' || this.bossState==='rage') return dealt
    if (this.recentlyStaggered<=0 && (this.legDamage>=this.monster.data.ai.topple || this.poise>=this.monster.data.ai.topple*1.4)) {
      this.legDamage=this.poise=0; this.recentlyStaggered=4.5
      this.setBoss('fall'); this.callout='転倒 · 大きな隙'
    } else if (this.recentlyStaggered<=0 && this.poise>=this.monster.data.ai.stagger) {
      this.poise*=.36; this.recentlyStaggered=2.5
      this.setBoss('stagger'); this.callout='怯み'
    } else if (this.bossState==='approach' || this.bossState==='turn' || this.bossState==='search') {
      this.setBoss('hit')
    }
    return dealt
  }

  protected preserveBossHealth(damage:number) { return damage }
  protected magicBossDamage(damage:number) { return damage }
  protected onBossHit(_magic:boolean,_damage:number) {}
  protected strikeSecondary(_damage:number,_volume?:HitVolume,_area=false,_hitTargets?: Set<object>) { return 0 }
  protected acceptBossDamage() { return true }

  protected findStrike(monster:MonsterModel,volume?:HitVolume) {
    if(!volume && flatDistance(this.p,monster.root.position)>5) return
    let best: MonsterModel['parts'][number] | undefined
    let bestScore=Infinity
    for(const part of monster.parts) {
      const center=part.center
      const radius=part.config.radius*monster.data.scale+.18
      const contact=volume?volume(center,radius):this.strikeDistanceSquared(center)/(radius*radius)
      const score=contact - (volume?0:(part.config.multiplier-1)*.32)
      if (contact <= 1 && score < bestScore) { best=part; bestScore=score }
    }
    return best
  }

  protected strikeDistanceSquared(point: Vector3) {
    return Math.min(
      pointSegmentSquared(point,this.bladeA,this.bladeB),
      pointSegmentSquared(point,this.previousA,this.previousB),
      pointSegmentSquared(point,this.previousB,this.bladeB),
    )
  }

  protected canInterruptBoss() { return true }

  private beginAttack(attack: Attack) {
    this.attack=attack; this.lastAttack=attack.id
    this.cooldowns[attack.id]=attack.cooldown
    this.attackHit=this.attackLocked=false
    this.milestone=0; this.waveTime=0
    this.callout=attack.label+' · '+attack.tells
    this.setBoss('windup')
  }
  private chooseAttack(dist: number, offset: number) {
    const r=this.rage, a=this.monster.data.attacks!
    const ready=(id: AttackId) => this.cooldowns[id]<=0 && this.monster.data.ai.enabledAttacks.includes(id)
    const firstRageAttack=r && this.rageSequence===0
    const specialOpening=dist>2.65 && (r || this.attackCount>=4 && this.bossHp<this.monster.data.hp*.82)
    if (ready('special') && dist<=a.special.range && (firstRageAttack || specialOpening)) return a.special
    if (ready('spin') && dist<a.spin.range+.3 && (offset>1 || r && this.lastAttack==='swipe' || this.attackCount%4===3)) return a.spin
    if (dist<a.swipe.range-.13 && offset<1.02 && ready('swipe')) return a.swipe
    if (dist>3.05 && dist<(r?10.8:8.4) && offset<.68 && ready('leap') && (r || this.lastAttack==='rush')) return a.leap
    if (dist>4.45 && dist<15 && offset<.66 && ready('rush')) return a.rush
    if (dist<a.spin.range && ready('spin')) return a.spin
    if (dist>3.1 && dist<8.2 && offset<.7 && ready('leap')) return a.leap
  }
  protected updateBoss(dt: number) {
    const data=this.monster.data
    for (const id of Object.keys(this.cooldowns) as AttackId[]) this.cooldowns[id]=Math.max(0,this.cooldowns[id]-dt)
    const dist=flatDistance(this.p,this.m), face=yawTo(this.m,this.p), offset=Math.abs(wrap(face-this.bossYaw))
    const tempo=this.rage?data.rage.tempo:1
    const turn=(rate: number) => {
      this.bossYaw+=clamp(wrap(face-this.bossYaw),-rate*dt,rate*dt)
      this.monster.root.rotation.y=this.bossYaw
    }
    if (!this.rage && this.bossHp<=data.hp*data.rage.hpRatio && ['approach','turn','search','recovery','hit'].includes(this.bossState)) {
      this.rage=true; this.rageSequence=0
      this.monster.setEnraged(true)
      this.cooldowns.special=Math.min(this.cooldowns.special,.9)
      this.setBoss('rage'); this.callout='怒り · 攻撃が激しくなる'
      this.fx.ring(this.m,1,6,.82,0xff8152)
    }
    switch(this.bossState) {
      case 'idle':
        this.monster.animate('idle',dt)
        if (this.bt>.75 && dist<data.ai.wake) this.setBoss('search')
        break
      case 'search':
        turn(data.ai.turnSpeed*.5); this.monster.animate('roar',dt,clamp(this.bt/1.28,0,1))
        this.callout='モンスターがこちらに気づいた'
        if(this.bt>1.28) this.setBoss('approach')
        break
      case 'turn':
      case 'approach': {
        this.callout=''
        const next=this.chooseAttack(dist,offset)
        if (next) { this.beginAttack(next); break }
        turn(data.ai.turnSpeed*tempo)
        if (offset>.52) {
          if (this.bossState!=='turn') this.setBoss('turn')
          this.monster.animate('turn',dt)
        } else {
          if (this.bossState!=='approach') this.setBoss('approach')
          if (dist>2.35) {
            this.moveEntity(this.m,forward(this.bossYaw,this.delta),data.speed*(this.rage?data.rage.speed:1)*dt,this.monster.data.radius,this.p,.44)
            this.monster.animate(dist>6 || this.rage?'run':'walk',dt)
          } else this.monster.animate('idle',dt)
        }
        break
      }
      case 'windup': {
        const a=this.attack!, duration=a.windup/tempo
        const t=clamp(this.bt/duration,0,1)
        if (t<.68 && a.id!=='spin') turn(data.ai.turnSpeed*.76)
        if (t>=.68 && !this.attackLocked) {
          this.attackLocked=true
          this.target.copy(this.p); this.launch.copy(this.m); this.attackOrigin.copy(this.m)
          this.attackAim.copy(forward(this.bossYaw,this.delta))
          if(a.id==='leap') this.fx.ring(this.target,a.range,a.range,duration*(1-t)+a.active/tempo*.94,0xffb362,.68)
          if(a.id==='special') this.fx.ring(this.m,1,3.25,.52,0xffad64,.88)
        }
        if (a.id==='swipe') this.monster.animate('swipe',dt,t*.33)
        if (a.id==='rush') this.monster.animate('special',dt,t*.21)
        if (a.id==='spin') this.monster.animate('spinPrep',dt,t)
        if (a.id==='leap') this.monster.animate('leapPrep',dt,t)
        if (a.id==='special') this.monster.animate('special',dt,t*.57)
        if(t>=1) { this.setBoss('attack'); this.attackCount++; this.callout=a.label }
        break
      }
      case 'attack':
        this.resolveAttack(dt,tempo)
        break
      case 'recovery': {
        const a=this.attack!
        const t=clamp(this.bt/this.recoveryDuration,0,1)
        if(a.id==='swipe') this.monster.animate('swipe',dt,.65+.35*t)
        else if(a.id==='special') this.monster.animate('special',dt,.9+.1*t)
        else this.monster.animate('idle',dt)
        if(t>=1) { this.callout=''; this.setBoss('approach') }
        break
      }
      case 'rage':
        this.monster.animate('roar',dt,clamp(this.bt/1.42,0,1))
        if(this.bt>=1.42) this.setBoss('approach')
        break
      case 'hit':
      case 'stagger':
      case 'fall': {
        const state=this.bossState
        const duration=state==='fall'?2.8:state==='stagger'?1:.24
        this.monster.animate(state,dt,clamp(this.bt/duration,0,1))
        if(this.bt>=duration) { this.callout=''; this.setBoss('approach') }
        break
      }
    }
    this.monster.root.rotation.y=this.bossYaw
  }

  private resolveAttack(dt: number, tempo: number) {
    const a=this.attack!
    const t=clamp(this.bt/(a.active/tempo),0,1), p=this.p, m=this.m
    const range=this.rage && a.id==='special' ? a.range : a.id==='special' ? a.range-2 : a.range
    let dangerous=false, source=m
    const first=() => { if (this.milestone) return false; this.milestone=1; return true }
    switch(a.id) {
      case 'swipe':
        this.monster.animate('swipe',dt,.33+.32*t)
        if(t>=.22 && first()) this.fx.sound('beast-swipe',m)
        dangerous=t>=.22 && flatDistance(p,m)<=range && Math.abs(wrap(yawTo(m,p)-this.bossYaw))<1.51
        break
      case 'rush':
        this.moveEntity(m,this.attackAim,14*dt*tempo,this.monster.data.radius,p,.44)
        this.monster.animate('rush',dt)
        if(t>.045 && first()) this.fx.sound('beast-rush',m)
        dangerous=t>.045 && flatDistance(p,m)<=range && Math.abs(wrap(yawTo(m,p)-this.bossYaw))<1.18
        break
      case 'spin':
        this.monster.animate('spin',dt,t)
        if (first()) { this.fx.sound('beast-spin',m); this.fx.ring(m,1.1,range,.47,0xffb775) }
        dangerous=t>.12 && t<.94 && flatDistance(p,m)<=range
        break
      case 'leap':
        this.delta.copy(this.launch).lerp(this.target,smooth(t/.8)).sub(m).setY(0)
        this.moveEntity(m,this.delta,1,this.monster.data.radius,p,.44)
        this.monster.animate('leap',dt,t)
        if(t>=.94 && first()) { this.fx.sound('earth-slam',m); this.fx.ring(m,1,range,.38,0xffa45d); this.fx.shake=Math.max(this.fx.shake,.16) }
        dangerous=t>=.94 && flatDistance(p,m)<=range
        break
      case 'special': {
        source=this.attackOrigin
        this.monster.animate('special',dt,.57+.33*t)
        const total=a.active/tempo, gap=this.rage?.31:.48, waveCount=this.rage?3:2
        const waveDuration=total-gap*(waveCount-1)-.105
        const speed=range/waveDuration
        const dtFromImpact=this.bt-.065
        if (dtFromImpact>=this.waveTime && this.milestone<waveCount) {
          this.fx.sound('shockwave',source,this.milestone===0?1:.84)
          this.fx.ring(source,.3,range,waveDuration,this.milestone%2===0?0xff874f:0xffc769,.93)
          this.milestone++; this.waveTime+=gap
          this.fx.shake=Math.max(this.fx.shake,.15)
        }
        const d=flatDistance(p,source)
        for(let i=0;i<waveCount;i++) {
          const age=dtFromImpact-gap*i
          if(age>=0 && age<=waveDuration && Math.abs(d-age*speed)<.79) dangerous=true
        }
        break
      }
    }
    if (dangerous && !this.attackHit && this.damagePlayer(a,source)) this.attackHit=true
    if (t>=1 && !this.outcome) {
      const chain=this.rage && ++this.rageSequence%3===0 && a.id!=='special'
      this.recoveryDuration=chain ? this.monster.data.rage.chainDelay : a.recovery/tempo
      if (chain) this.cooldowns.spin=Math.min(.17,this.cooldowns.spin)
      this.setBoss('recovery'); this.callout='攻撃後の隙'
      this.onAttackFinished(a,this.attackHit)
    }
  }
  protected onAttackFinished(_attack: Attack, _hit: boolean) {}

  protected damagePlayer(
    a: Pick<Attack,'damage' | 'knockdown'>, source: Vector3,
    multiplier = this.attackDamageMultiplier, damageScale = 1,
    guardEffect?: { damageScale: number; push: number } | 'dodge-only' | 'unguardable',
  ) {
    const dodgeOnly=guardEffect==='dodge-only'
    const guardResponse=typeof guardEffect==='object'?guardEffect:undefined
    const dodging=this.playerState==='dodge' && this.pt>=dodgeTiming.invincibleFrom &&
      this.pt<dodgeTiming.invincibleFrom+dodgeTiming.invincibleFor
    if (dodging || !dodgeOnly && (this.immune>0 || this.playerState==='rise' || this.playerState==='down')) return false
    const toward=yawTo(this.p,source)
    const guarded=guardEffect!=='dodge-only' && guardEffect!=='unguardable' && this.guard && Math.abs(wrap(toward-this.playerYaw))<=1.30 && this.useStamina(a.knockdown?23:15)
    const damage=guarded && guardResponse
      ? Math.round(a.damage*multiplier*guardResponse.damageScale)*damageScale
      : Math.max(1,Math.round(a.damage*multiplier*(guarded?.24:1)))*damageScale
    this.hp=Math.max(0,this.hp-damage)
    this.immune=guarded?.28:a.knockdown?1.27:.56
    if(!guarded) {
      this.controls?.clearCombatBuffer()
      this.setPlayer(a.knockdown?'down':'hit')
      forward(toward+Math.PI,this.shove)
    } else if (guardResponse?.push) {
      forward(toward+Math.PI,this.shove)
      this.moveEntity(this.p,this.shove,guardResponse.push,.44,this.m,this.bossGroundRadius)
    }
    this.hitPoint.copy(this.p); this.hitPoint.y+=1.55
    this.fx.hit(this.hitPoint,damage,guarded?'防御':'',guarded?0xffdb9b:0xff7f69,a.knockdown&&!guarded,true,guarded?'guard-hit':'hit-player')
    if(this.hp<=0) { this.outcome='failure'; this.callout='力尽きた' }
    return true
  }
}
