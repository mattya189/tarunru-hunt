import { Group, Vector3 } from 'three'
import { Battle } from '../battle'
import { clamp, flatDistance, forward, wrap, yawTo } from '../math'
import { KogobonTelegraph } from '../kogobon/telegraph'
import type { MonsterModel } from '../monster-model'

const moves = {
  sweep: {label:'片翼なぎ払い', tell:.75, rest:.8, damage:22},
  leap: {label:'跳び踏み', tell:1, rest:1.2, damage:27},
  tail: {label:'尾の打ち下ろし', tell:.7, rest:.8, damage:20},
  claw: {label:'両翼突き刺し', tell:1.1, rest:1.8, damage:31},
  fissure: {label:'双翼地裂 · 中央か背後へ', tell:.85, rest:2.5, damage:39},
} as const
type Move = keyof typeof moves
type Sector = {center:Vector3; yaw:number; radius:number; angle:number}

export class VariantBattle extends Battle {
  readonly warning = new Group()
  private markers = [new KogobonTelegraph(this.arena.height),new KogobonTelegraph(this.arena.height)]
  private sectors: Sector[] = []
  private activeMove?: Move
  private previous?: Move
  private side = 1
  private start = new Vector3()
  private landing = new Vector3()
  private heading = new Vector3()
  private lastLeap = -10

  constructor(...args: ConstructorParameters<typeof Battle>) {
    super(...args)
    this.warning.add(...this.markers.map(marker=>marker.mesh))
  }

  override reset() {
    this.monster.setFlightOffset(0)
    super.reset()
    this.activeMove=this.previous=undefined
    this.lastLeap=-10
    this.markers?.forEach(marker=>marker.hide())
    this.setWeakness()
  }

  protected override canInterruptBoss() { return false }
  protected override magicPartBonus(part: MonsterModel['parts'][number]) { return part.config.multiplier }

  private setWeakness(move?: Move) {
    for (const part of this.monster.parts) {
      const exposed = move==='claw' && part.config.name.endsWith('翼爪') || move==='fissure' && part.config.name==='顎'
      part.config.multiplier=exposed ? 1.4 : 1
    }
  }

  override update(...args: Parameters<Battle['update']>) {
    super.update(...args)
    if (this.outcome) this.markers.forEach(marker=>marker.hide())
  }

  protected override updateBoss(dt:number) {
    if (this.activeMove) { this.perform(this.activeMove,dt); return }
    const aim=yawTo(this.m,this.p)
    const angle=wrap(aim-this.bossYaw)
    const distance=flatDistance(this.m,this.p)
    if (!this.rage && this.bossHp<=this.monster.data.hp*.5) {
      this.rage=true
      this.monster.setEnraged(true)
      this.setBoss('rage')
      this.callout='怒り · 両翼を広げている'
    }
    if (this.bossState==='rage') {
      this.monster.animate('enrage',dt,clamp(this.bt/.55,0,1))
      if (this.bt>=.55) this.begin('fissure',angle)
      return
    }
    // Score only reachable attacks. A repeated move incurs a cost, but the
    // hunter can still deliberately bait it by holding the correct position.
    const bearing=Math.abs(angle)
    const choices: [Move,number][]=[]
    if (distance<=4.9 && bearing>.65 && bearing<2.52) choices.push(['sweep',2-Math.abs(bearing-1.55)])
    if (distance<=5.7 && bearing>Math.PI-.60) choices.push(['tail',1+bearing-(Math.PI-.60)])
    if (distance<=6.7 && bearing<(this.rage?.83:.67)) choices.push(['claw',this.rage?2.6:2])
    if (distance>=4.8 && distance<=10 && this.elapsed-this.lastLeap>4) choices.push(['leap',1.2+(distance-4.8)*.4])
    const score=([id,value]:[Move,number])=>value-(id===this.previous ? .8 : 0)
    choices.sort((a,b)=>score(b)-score(a))
    if (choices.length && this.bt>.28) { this.begin(choices[0][0],angle); return }
    this.bossYaw+=clamp(angle,-dt*2.4,dt*2.4)
    this.monster.root.rotation.y=this.bossYaw
    if (distance>2.5 && bearing<1) this.moveEntity(this.m,forward(this.bossYaw,this.heading),dt*this.monster.data.speed,this.monster.data.radius,this.p,.44)
    this.monster.animate('walk',dt)
  }

  private begin(id:Move,angle:number) {
    this.activeMove=id
    this.side=Math.sign(angle)||1
    this.start.copy(this.m)
    this.landing.copy(this.p)
    this.arena.resolve(this.landing,this.monster.data.radius)
    const sector=(yaw:number,radius:number,angle:number,center=this.start)=>({center,yaw,radius,angle})
    const y=this.bossYaw
    switch (id) {
      case 'sweep': this.sectors=[sector(y+this.side*1.5,6.8,1.22)]; break
      case 'tail': this.sectors=[sector(y+Math.PI,7,.60)]; break
      case 'claw': this.sectors=[sector(y,8,this.rage?.83:.67)]; break
      case 'leap': this.lastLeap=this.elapsed; this.sectors=[sector(y,4.55,Math.PI,this.landing)]; break
      case 'fissure':
        this.sectors=[-1,1].map(sign=>sector(y+sign*.86,11.5,.86,
          this.start.clone().addScaledVector(forward(y+sign*Math.PI/2,this.heading),1.1)))
    }
    this.sectors.forEach((s,i)=>this.markers[i].show(s.center,s.yaw,s.radius,s.angle))
    this.setBoss('windup')
    this.callout=moves[id].label
  }

  private perform(id:Move,dt:number) {
    const attack=moves[id]
    const prep=({sweep:this.side<0?'sweepLeft':'sweepRight',claw:'clawPrep',leap:'leapPrep',tail:'tailPrep',fissure:'fissurePrep'} as const)[id]
    const hit=({sweep:this.side<0?'sweepLeftHit':'sweepRightHit',claw:'clawHit',leap:'leapHit',tail:'tailHit',fissure:'fissureHit'} as const)[id]
    if (this.bossState==='windup') {
      const t=clamp(this.bt/attack.tell,0,1)
      this.markers.forEach(marker=>marker.pulse(t))
      if (id==='leap') {
        const jump=clamp((t-.25)/.75,0,1)
        this.m.lerpVectors(this.start,this.landing,jump)
        this.m.y=this.arena.height(this.m.x,this.m.z)
        this.monster.setFlightOffset(1.7*Math.sin(Math.PI*jump))
      }
      if(t<.82) this.monster.animate(prep,dt,Math.min(1,t*2))
      else this.monster.animate(hit,dt,(t-.82)/.18)
      if(t===1) {
        this.markers.forEach(marker=>marker.hide())
        this.fx.sound('earth-slam',this.m)
        for (const s of this.sectors) {
          if (flatDistance(s.center,this.p)<=s.radius && Math.abs(wrap(yawTo(s.center,this.p)-s.yaw))<=s.angle) {
            this.damagePlayer({damage:attack.damage,knockdown:false},this.m,1)
            break
          }
        }
        this.setWeakness(id)
        this.callout=id==='claw'?'翼爪が刺さった':id==='fissure'?'頭が下がった':'反撃の隙'
        this.setBoss('recovery')
      }
    } else {
      const t=clamp(this.bt/attack.rest,0,1)
      this.monster.animate(hit,dt,Math.min(1,(1-t)*5))
      if(t===1) {
        this.setWeakness()
        this.previous=id
        this.activeMove=undefined
        this.callout=''
        this.setBoss('approach')
      }
    }
  }
}
