import { Vector3, type Scene } from 'three'
import { Battle } from '../battle'
import type { Effects } from '../effects'
import type { HitVolume } from '../flare/combat'
import type { HunterModel } from '../hunter'
import type { KouperBattle } from '../kouper/battle'
import { flatDistance, yawTo } from '../math'
import type { MonsterModel } from '../monster-model'
import type { RavenBattle } from '../raven/battle'
import type { Quality } from '../ui'
import type { Arena } from '../world'
import type { WeaponData } from '../config'
import { paperAndRaven } from './config'

const threatening=(opponent:Battle) => !opponent.outcome &&
  (opponent.bossState==='windup'||opponent.bossState==='attack'||opponent.bossState==='rage')

export class DuoBattle extends Battle {
  private readonly zero=new Vector3()
  private readonly range=new Vector3()
  private readonly before=new Vector3()
  private readonly pair:readonly [KouperBattle,RavenBattle]
  private lastAttacker?:Battle
  private passedAt=0
  private readonly living:MonsterModel[]=[]
  private readonly models:readonly MonsterModel[]
  private lastDefeated?:Battle

  constructor(private readonly paperBoss:KouperBattle, private readonly ravenBoss:RavenBattle,
    hunter:HunterModel,arena:Arena,fx:Effects,weapon:WeaponData) {
    super(paperBoss.monster,hunter,arena,fx,weapon)
    this.pair=[paperBoss,ravenBoss]
    this.models=[paperBoss.monster,ravenBoss.monster]
    this.reset()
  }

  attach(scene:Scene) {
    scene.add(this.paperBoss.visuals.root,this.ravenBoss.visuals.root)
  }

  override get questData() { return paperAndRaven }
  override get cameraMonster() { return this.defaultLockTarget() }
  override get sceneModels() { return this.models }
  override get reticleTargets() { return this.living }
  override get secondaryBossHealth() {
    return {name:this.ravenBoss.monster.data.name,hp:this.ravenBoss.bossHp,max:this.ravenBoss.monster.data.hp}
  }
  override get statusNotice() { return this.paperBoss.statusNotice }
  override get defeatDuration() { return this.lastDefeated?.defeatDuration??2.5 }
  protected override get usesPrimaryHurtbox() { return false }
  protected override animateBossDefeat() { /* Both opponents advance their own defeat animations. */ }

  override reset() {
    super.reset()
    if(!this.pair) return
    this.lastAttacker=this.lastDefeated=undefined
    this.passedAt=0
    this.living.splice(0,this.living.length,...this.models)
    this.pair.forEach((boss,index)=>{
      boss.reset()
      boss.m.set(index===0?-5.4:5.4,0,-2.5)
      this.arena.resolve(boss.m,boss.monster.data.radius)
      boss.bossYaw=yawTo(boss.m,this.p)
      boss.monster.root.rotation.y=boss.bossYaw
      boss.monster.animate('idle',0)
    })
  }

  setQuality(quality:Quality) { this.paperBoss.visuals.quality=quality }

  frame(dt:number,active:boolean) {
    this.paperBoss.frame(dt,active && !this.paperBoss.outcome)
  }

  protected override defaultLockTarget() {
    const [first,second]=this.living
    if(!first) return this.lastDefeated?.monster??this.monster
    return second && flatDistance(this.p,second.root.position)<flatDistance(this.p,first.root.position)?second:first
  }

  protected override onDodge(direction:Vector3) { this.paperBoss.notifyOpponentDodge(direction) }

  override update(...args:Parameters<Battle['update']>) {
    const [dt]=args
    const finished=this.outcome!==null
    super.update(...args)
    if(this.outcome && (finished||this.outcome==='failure')) {
      for(const boss of this.pair) boss.stepAsOpponent(this,dt,false)
    }
  }

  protected override updateBoss(dt:number) {
    for(const boss of this.pair) {
      const other=boss===this.paperBoss?this.ravenBoss:this.paperBoss
      const wasThreatening=threatening(boss)
      const allow=!other.outcome
        ? !threatening(other) && (this.lastAttacker!==boss || this.elapsed>=this.passedAt+1.4)
        : true
      boss.stepAsOpponent(this,dt,allow)
      if(!wasThreatening && threatening(boss)) this.lastAttacker=boss
      if(wasThreatening && !threatening(boss)) this.passedAt=this.elapsed
    }
    this.keepOpponentsApart()
    const display=this.pair.find(threatening)??this.pair.find(boss=>!boss.outcome && boss.callout)
    this.bossState=display?.bossState??'idle'
    this.rage=this.pair.some(boss=>!boss.outcome&&boss.rage)
    if(!this.outcome) this.callout=display ? display.monster.data.name+' · '+display.callout : ''
    this.bossHp=this.paperBoss.bossHp
  }

  protected override strikeSecondary(damage:number,volume?:HitVolume,area=false,hitTargets?:Set<object>,spell?:string) {
    const advancingSlash=hitTargets!==undefined
    let total=0
    let nearest: {boss:Battle; part:MonsterModel['parts'][number]; score:number} | undefined
    for(const boss of this.pair) {
      const model=boss.monster
      if(boss.outcome || hitTargets?.has(model)) continue
      const part=this.findStrike(model,volume)
      if(!part) continue
      if(area) {
        hitTargets?.add(model)
        total+=this.hit(boss,part,damage,!advancingSlash,spell??(advancingSlash?'踏み込み斬り':undefined))
        continue
      }
      const radius=part.config.radius*model.data.scale+.18
      const score=volume?.(part.center,radius)??this.strikeDistanceSquared(part.center)/(radius*radius)
      if(!nearest || score<nearest.score) nearest={boss,part,score}
    }
    if(nearest) return this.hit(nearest.boss,nearest.part,damage,!!volume)
    return total
  }

  protected override moveEntity(pos:Vector3,motion:Vector3,speed:number,radius:number,target:Vector3,targetRadius:number) {
    if(pos!==this.p) {
      super.moveEntity(pos,motion,speed,radius,target,targetRadius)
      return
    }
    super.moveEntity(pos,motion,speed,radius,target,0)
    for(const model of this.living) super.moveEntity(pos,this.zero,0,radius,model.root.position,model.data.radius)
  }

  private hit(boss:Battle,part:MonsterModel['parts'][number],damage:number,magic:boolean,label?:string) {
    const dealt=boss.hitOpponent(part,damage,magic,label)
    this.bossHp=this.paperBoss.bossHp
    if(boss.outcome==='victory') {
      this.lastDefeated=boss
      const index=this.living.indexOf(boss.monster)
      if(index>=0) this.living.splice(index,1)
      if(!this.living.length) {
        this.outcome='victory'
        this.callout='2体討伐完了'
      } else this.callout=boss.monster.data.name+' 討伐 · 残り1体'
    }
    return dealt
  }

  private keepOpponentsApart() {
    if(this.living.length<2) return
    const [paper,raven]=this.pair
    const gap=paper.monster.data.radius+raven.monster.data.radius+.22
    const distance=flatDistance(paper.m,raven.m)
    if(distance>=gap) return
    const canMove=(boss:Battle) => boss.bossState==='idle'||boss.bossState==='approach'||boss.bossState==='search'||boss.bossState==='turn'
    const mover=canMove(raven)?raven:canMove(paper)?paper:undefined
    if(!mover) return
    const other=mover===paper?raven:paper
    this.range.subVectors(mover.m,other.m).setY(0)
    if(this.range.lengthSq()<1e-8) this.range.set(1,0,0)
    this.range.normalize()
    this.before.copy(mover.m)
    super.moveEntity(mover.m,this.range,Math.min(.08,gap-distance),mover.monster.data.radius,this.p,.44)
    this.range.subVectors(mover.m,this.before)
    mover.monster.root.updateMatrixWorld(true)
    for(const part of mover.monster.parts) part.center.add(this.range)
  }
}
