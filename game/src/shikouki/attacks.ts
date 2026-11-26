import { Vector3 } from 'three'
import type { Motion } from '../config'
import { clamp, flatDistance, yawTo } from '../math'
import { crystal, damageScale, moves, phases, shikouki, type MoveId } from './config'

export interface Hazard {
  origin: Vector3
  angle: number
  shape: 'circle' | 'box' | 'fan'
  radius: number
  length: number
  width: number
  arc: number
  damage: number
  scale: DamageScale
  at: number
  end: number
  live: boolean
  hit: boolean
  pillar?: boolean
  shatter?: boolean
  beam?: boolean
  split?: boolean
  shock?: boolean
  rotate?: number
}
export interface Crystal { center: Vector3; hp: number; at: number; end: number }
export interface Shot { center: Vector3; angle: number; speed: number; damage: number; end: number }
interface Action {
  id: MoveId | 'phase'
  age: number
  rate: number
  duration: number
  recovery: number
  events: { at: number; run: () => void }[]
  motion: Motion
  travel?: { from: Vector3; to: Vector3; start: number; end: number }
  chargeHit: boolean
}
type DamageScale=typeof damageScale[keyof typeof damageScale]

interface Ports {
  ground: (x: number, z: number) => number
  resolve: (point: Vector3) => void
  damage: (damage: number, source: Vector3, knockdown: boolean, scale: DamageScale) => boolean
  ring: (point: Vector3, size: number, color: number) => void
}
const tau = Math.PI * 2
const bodyRadius = .44
const offset = (p: Vector3, angle: number, d: number) => new Vector3(p.x+Math.sin(angle)*d,0,p.z+Math.cos(angle)*d)

export function overlaps(
  h: Pick<Hazard,'shape'|'origin'|'angle'|'radius'|'length'|'width'|'arc'>, p: Vector3, radius: number,
) {
  const x=p.x-h.origin.x, z=p.z-h.origin.z
  const distance=Math.hypot(x,z)
  if(h.shape==='circle') return distance<=h.radius+radius
  const forward=x*Math.sin(h.angle)+z*Math.cos(h.angle)
  const side=Math.abs(x*Math.cos(h.angle)-z*Math.sin(h.angle))
  if(h.shape==='box') return Math.hypot(forward-clamp(forward,0,h.length),Math.max(0,side-h.width))<=radius
  return distance<=radius || (distance<=h.radius+radius && Math.atan2(side,forward)<=h.arc+Math.asin(radius/distance))
}
const footprint = (origin:Vector3, shape:Hazard['shape'], extras:Partial<Hazard>={}) => ({
  origin,shape,angle:0,radius:0,length:0,width:0,arc:0,damage:0,scale:damageScale.melee,at:0,end:0,live:false,hit:false,...extras,
})

export class ShikoukiAttacks {
  time=0
  phase=0
  angle=0
  motion:Motion='idle'
  progress:number|undefined
  callout=''
  action?:Action
  recoveryUntil=.20
  ultimateUsed=false
  hazards:Hazard[]=[]
  crystals:Crystal[]=[]
  shots:Shot[]=[]
  private cooldowns:Partial<Record<MoveId,number>>={}
  private last?:MoveId
  private walkUntil=1.30
  private turnSide=1
  private readonly previous=new Vector3()

  constructor(private readonly boss:Vector3, private readonly arenaRadius:number, private readonly ports:Ports) {}

  get airborne() { return this.motion==='shikoukiHover'||this.motion==='shikoukiTakeoff'||this.motion==='leap'||this.motion==='special' }
  get isRecovering() { return this.time < this.recoveryUntil }

  clear() {
    this.hazards=[]
    this.crystals=[]
    this.shots=[]
  }

  update(dt:number, player:Vector3, hp:number, interrupted:boolean) {
    this.time+=dt
    if(this.action) this.advance(dt,player)
    else if(!interrupted && !this.isRecovering) {
      if(this.time<this.walkUntil) this.walk(dt,player)
      else this.choose(dt,player,hp)
    }

    for(const h of this.hazards.slice()) this.updateHazard(h,dt,player)
    this.hazards=this.hazards.filter(h=>this.time<h.end)
    this.crystals=this.crystals.filter(c=>this.time<c.end)
    for(const c of this.crystals) {
      if(flatDistance(c.center,player)<=1.32) this.ports.damage(7*phases[this.phase].power,c.center,false,damageScale.crystal)
    }
    for(const s of this.shots) {
      const length=s.speed*dt
      if(overlaps(footprint(s.center,'box',{ angle:s.angle,length,width:.24 }),player,bodyRadius)
        && this.ports.damage(s.damage,s.center,false,damageScale.crystal)) s.end=this.time
      s.center.x+=Math.sin(s.angle)*length
      s.center.z+=Math.cos(s.angle)*length
      s.center.y=this.ports.ground(s.center.x,s.center.z)+.68
    }
    this.shots=this.shots.filter(s=>this.time<s.end && Math.hypot(s.center.x,s.center.z)<=this.arenaRadius+1)
  }

  private choose(dt:number, player:Vector3, hp:number) {
    const next=hp<=shikouki.hp*phases[2].threshold ? 2 : hp<=shikouki.hp*phases[1].threshold ? 1 : 0
    if(next>this.phase) {
      this.phase=next
      this.callout=next===1?'怒り · 翼が展開する':'暴走 · 紫煌天獄に備えろ'
      this.action={ id:'phase',motion:next===1?'enrage':'shikoukiBerserk',age:0,rate:1,duration:2,recovery:.35,events:[],chargeHit:false }
      this.motion=this.action.motion; this.progress=0
      this.ports.ring(this.boss,4.5,0xa764e4)
      return
    }
    if(this.phase===2 && !this.ultimateUsed) { this.begin('ultimate',player); return }
    const range=flatDistance(this.boss,player)
    const ready=(id:MoveId)=>id!==this.last && (this.cooldowns[id]??0)<=this.time
    const choices:[MoveId,number][]=range<=5.1
      ? [['slash_horizontal',5],['leg_pierce',4],['wing_spin',this.phase?4:2]]
      : [['charge',range<18?4:0],['wing_barrage',this.phase?4:2],['dive',this.phase?2:0]]
    if(range<=17) choices.push(['crystal_summon',this.crystals.length<4?3:0])
    if(range<=20) choices.push(['beam',this.crystals.length?4:2])
    const options=choices.filter(([id,weight])=>weight>0 && ready(id))
    let roll=Math.random()*options.reduce((sum,[,weight])=>sum+weight,0)
    for(const [id,weight] of options) {
      roll-=weight
      if(roll<0) { this.begin(id,player); return }
    }
    this.walk(dt,player)
  }

  private walk(dt:number, player:Vector3) {
    const range=flatDistance(this.boss,player)
    const approach=range>3.1
    const toward=yawTo(this.boss,player)
    // Keep stepping around the player once inside melee range.
    const heading=approach?toward:toward+this.turnSide*(range<2.55?1.86:1.45)
    const pace=shikouki.speed*phases[this.phase].move*(approach?1:.74)
    this.previous.copy(this.boss)
    this.boss.x+=Math.sin(heading)*pace*dt
    this.boss.z+=Math.cos(heading)*pace*dt
    this.ports.resolve(this.boss)
    this.callout=''
    this.progress=undefined
    const moved=flatDistance(this.previous,this.boss)>.001
    this.motion=moved?'walk':'idle'
    if(moved) this.angle=yawTo(this.previous,this.boss)
  }

  private begin(id:MoveId, player:Vector3) {
    const m=moves[id], tuning=phases[this.phase], rate=id==='ultimate'?1:tuning.speed
    const origin=this.boss.clone()
    const target=player.clone()
    const aim=yawTo(origin,target)
    this.angle=aim
    const action:Action={ id,age:0,rate,duration:m.clip,recovery:m.recovery*tuning.recovery,events:[],motion:m.motion,chargeHit:false }
    this.action=action
    this.motion=m.motion; this.progress=0
    this.last=id; this.cooldowns[id]=this.time+m.cooldown
    this.callout=m.label
    const event=(at:number,run:()=>void)=>action.events.push({at,run})
    const warn=(when:number,hit:number,h:Hazard,life=.15)=>event(when,()=>this.addHazard(h,(hit-when)/rate,life))
    const ring=(p:Vector3,radius:number,damage:number,extra:Partial<Hazard>={})=>footprint(p,'circle',{radius,damage,...extra})
    const line=(length:number,width:number,damage:number,extra:Partial<Hazard>={})=>footprint(origin,'box',{angle:aim,length,width,damage,...extra})

    switch(id) {
      case 'slash_horizontal':
        warn(0,.72,footprint(origin,'fan',{angle:aim,radius:4.6,arc:1.12,damage:16,shatter:true}))
        break
      case 'leg_pierce':
        for(let i=0;i<3;i++) {
          const hit=.78+i*.53
          warn(hit-.65,hit,line(5.35,.63,12,{angle:aim+(i-1)*.18}))
        }
        break
      case 'wing_spin':
        warn(0,.89,ring(origin,4.65,17,{shatter:true}),.20)
        break
      case 'charge': {
        const end=offset(origin,aim,Math.min(12.5,Math.max(4,flatDistance(origin,target)+1)))
        this.ports.resolve(end)
        const length=flatDistance(origin,end), travelAim=yawTo(origin,end)
        warn(0,.65,line(length+1.2,1.45,0,{angle:travelAim}))
        this.angle=travelAim
        action.travel={from:origin,to:end,start:.65,end:1.50}
        break
      }
      case 'wing_barrage':
        warn(0,.77,footprint(origin,'fan',{angle:aim,radius:15,arc:.755}))
        for(let wave=0;wave<3;wave++) event(.77+wave*.43,()=>{
          const count=tuning.bullets/3
          for(let i=0;i<count;i++) this.fire(offset(origin,aim,1.5),aim+(i/(count-1)-.5)*1.35+(wave-1)*.08,10.8,10)
        })
        break
      case 'crystal_summon':
        for(let i=0;i<5;i++) {
          const center=this.crystalPoint(target,i,2.75+(i%2)*1.45,1.4)
          warn(.12+i*.07,1.12+i*.07,ring(center,.96,12,{pillar:true,scale:damageScale.crystal}))
        }
        break
      case 'beam': {
        const c=this.crystals.filter(c=>flatDistance(c.center,origin)<20 && flatDistance(c.center,origin)>2)
          .sort((a,b)=>flatDistance(a.center,target)-flatDistance(b.center,target))[0]
        if(c && flatDistance(c.center,target)<8) this.angle=yawTo(origin,c.center)
        warn(0,1.23,line(29,.65,22,{angle:this.angle,beam:true,split:true,scale:damageScale.heavy}),.55/rate)
        break
      }
      case 'dive': {
        event(1.3,()=>{ action.motion='shikoukiHover' })
        event(2.2,()=>{ action.motion='leap' })
        this.ports.resolve(target)
        warn(1.3,3.6,ring(target,4.65,21,{shock:true,scale:damageScale.heavy}),.24)
        action.travel={from:origin,to:target,start:2.2,end:3.6}
        break
      }
      case 'ultimate': {
        this.ultimateUsed=true
        this.ports.ring(origin,4.5,0xad69e2)
        let landing=target
        for(let i=0;i<48;i++) {
          const center=this.crystalPoint(new Vector3(),i,3+Math.sqrt(i)*2.62,1.25)
          warn(2+i/20,2.65+i/20,ring(center,.91,10,{pillar:true,scale:damageScale.crystal}))
        }
        for(let i=0;i<2;i++) warn(4.12,5,line(47,.57,16,{angle:aim+i*Math.PI,beam:true,rotate:.91,scale:damageScale.heavy}),2.9)
        for(let wave=0;wave<3;wave++) event(5+wave,()=>{
          for(let n=0;n<24;n++) this.fire(origin,n*tau/24+wave*.14,11.7,9)
        })
        event(8,()=>{
          landing=player.clone(); this.ports.resolve(landing)
          this.callout='紫煌天獄 · 着地点から離れろ'
          this.addHazard(ring(landing,7.1,28,{shock:true,scale:damageScale.ultimateImpact}),2,.30)
        })
        event(8.6,()=>{
          action.motion='leap'
          action.travel={from:origin,to:landing,start:8.6,end:10}
          this.angle=yawTo(origin,landing)
        })
        event(10,()=>{
          this.callout='着地ダウン · 反撃の隙'
          for(const c of this.crystals.slice()) this.breakCrystal(c,true)
          action.motion='fall'
        })
        break
      }
    }
    action.events.sort((a,b)=>a.at-b.at)
    this.runEvents(action)
  }

  private runEvents(action:Action) {
    while(action.events.length && action.events[0].at<=action.age+1e-6) {
      action.events.shift()!.run()
    }
  }

  private advance(dt:number, player:Vector3) {
    const a=this.action!
    a.age=Math.min(a.duration,a.age+dt*a.rate)
    this.runEvents(a)
    if(a.travel && a.age>=a.travel.start && a.age<=a.travel.end+dt*a.rate) {
      const travel=a.travel
      this.previous.copy(this.boss)
      this.boss.lerpVectors(travel.from,travel.to,clamp((a.age-travel.start)/(travel.end-travel.start),0,1))
      this.ports.resolve(this.boss)
      if(a.id==='charge' && !a.chargeHit && overlaps(footprint(this.previous,'box',{
        angle:yawTo(this.previous,this.boss),length:flatDistance(this.previous,this.boss),width:1.45,
      }),player,bodyRadius)) a.chargeHit=this.ports.damage(22*phases[this.phase].power,this.boss,true,damageScale.heavy)
    }
    this.motion=a.motion
    this.progress=this.poseProgress(a)
    if(a.age>=a.duration-1e-6) {
      this.action=undefined
      this.recoveryUntil=this.time+a.recovery
      this.walkUntil=this.recoveryUntil
      if(a.id!=='phase') {
        this.walkUntil+=.65
        this.turnSide*=-1
      }
      if(a.id==='ultimate') { this.motion='fall'; this.progress=1 }
      else { this.motion='idle'; this.progress=undefined; this.callout='攻撃後の隙' }
    }
  }

  private poseProgress(a:Action) {
    if(a.id==='dive') {
      if(a.motion==='shikoukiTakeoff') return a.age/1.3
      if(a.motion==='shikoukiHover') return (a.age-1.3)/2
      return (a.age-2.2)/1.4
    }
    if(a.id==='ultimate') {
      if(a.motion==='leap') return (a.age-8.6)/1.4
      if(a.motion==='fall') return (a.age-10)/1.5
    }
    return a.age/a.duration
  }

  private addHazard(h:Hazard, warning:number, life:number) {
    const at=this.time+warning
    this.hazards.push({...h,at,end:at+life,damage:h.damage*phases[this.phase].power})
  }

  private updateHazard(h:Hazard, dt:number, player:Vector3) {
    if(this.time+1e-6<h.at || this.time>=h.end) return
    if(!h.live) {
      h.live=true
      if(h.pillar) {
        if(this.crystals.length>=crystal.limit) this.crystals.shift()
        this.crystals.push({center:h.origin,hp:crystal.hp,at:this.time,end:this.time+crystal.life})
      }
      if(h.shatter) for(const c of this.crystals.slice()) {
        if(overlaps(h,c.center,.48)) this.breakCrystal(c,true)
      }
      if(h.split) {
        const c=this.crystals.filter(c=>overlaps(h,c.center,.52))
          .sort((a,b)=>flatDistance(h.origin,a.center)-flatDistance(h.origin,b.center))[0]
        if(c) {
          for(const turn of [-.57,.57]) this.addHazard(footprint(c.center,'box',{
            angle:h.angle+turn,length:16,width:.45,damage:13,beam:true,scale:damageScale.heavy,
          }),.38,.47)
          this.callout='結晶共鳴 · 光線が分岐'
          this.ports.ring(c.center,2.2,0xba6dff)
        }
      }
      if(h.shock) this.ports.ring(h.origin,h.radius,0xe883fa)
    } else if(h.rotate) h.angle+=h.rotate*dt
    if(h.hit || !h.damage || !overlaps(h,player,bodyRadius)) return
    h.hit=this.ports.damage(h.damage,h.origin,!!h.shock,h.scale)
  }

  private crystalPoint(center:Vector3, i:number, radius:number, margin:number) {
    const p=offset(center,i*2.399963,radius)
    const factor=Math.min(1,(this.arenaRadius-margin)/(Math.hypot(p.x,p.z)||1))
    p.multiplyScalar(factor)
    p.y=this.ports.ground(p.x,p.z)
    return p
  }

  breakCrystal(c:Crystal, explode:boolean) {
    this.crystals=this.crystals.filter(item=>item!==c)
    if(explode) this.addHazard(footprint(c.center,'circle',{radius:1.55,damage:9,scale:damageScale.crystal}),.38,.16)
    else this.ports.ring(c.center,1.7,0xc574ff)
  }

  private fire(from:Vector3, angle:number, speed:number, damage:number) {
    const center=from.clone()
    center.y=this.ports.ground(center.x,center.z)+.68
    this.shots.push({center,angle,speed,damage:damage*phases[this.phase].power,end:this.time+4.5})
  }
}
