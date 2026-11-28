import { Vector3 } from 'three'
import { dodgeTiming } from '../battle'
import { clamp, wrap } from '../math'
import type { Arena } from '../world'
import { attacks, attackIds, chains, tactics, type PaperAttack } from './config'
import { contains, distance2, makePlan, motionPosition, plannedPaper, walkable, type Plan, type Zone } from './plan'

type Habit = 'left' | 'right' | 'back' | 'close' | 'far' | 'guard' | 'counter'
type Sample = { at:number; habit:Habit; weight:number }
export type Habits = Record<Habit,number>
export class HuntHistory {
  private readonly samples:Sample[]=[]
  readonly habits:Habits={left:0,right:0,back:0,close:0,far:0,guard:0,counter:0}
  clear() { this.samples.length=0; for(const key of Object.keys(this.habits) as Habit[]) this.habits[key]=0 }
  add(at:number,habit:Habit,weight=1) { this.samples.push({at,habit,weight}) }
  read(now:number) {
    while(this.samples.length && now-this.samples[0].at>tactics.history) this.samples.shift()
    for(const key of Object.keys(this.habits) as Habit[]) this.habits[key]=0
    if(this.samples.length<tactics.minSamples) return this.habits
    let total=0
    for(const sample of this.samples) {
      const weight=(1-(now-sample.at)/tactics.history)*sample.weight
      this.habits[sample.habit]+=weight
      total+=weight
    }
    for(const key of Object.keys(this.habits) as Habit[]) this.habits[key]/=Math.max(1,total)
    return this.habits
  }
}

export interface PlayerTrack {
  point:Vector3
  velocity:Vector3
  walk:number
  roll:number
  evadeDelay:number
  rollPhase:number
  rollDirection:Vector3
  rollWait:number
}
const slices=Math.round(tactics.horizon/tactics.timeSlice)
const safetyStep=.05
const hunterRadius=.44

export class DangerMap {
  private readonly gridSize:number
  private readonly span:number
  private readonly fixed:Int8Array
  private readonly danger:Uint8Array
  private readonly baseByTime:Zone[][]=Array.from({length:slices},()=>[])
  private readonly bodyPosition=new Vector3()
  constructor(private readonly arena:Arena) {
    this.gridSize=Math.ceil(arena.radius*2/tactics.grid)+1
    this.span=this.gridSize*this.gridSize
    this.fixed=new Int8Array(this.span)
    this.danger=new Uint8Array(this.span*slices)
    for(let i=0;i<this.span;i++) {
      const x=i%this.gridSize*tactics.grid-arena.radius
      const z=Math.floor(i/this.gridSize)*tactics.grid-arena.radius
      this.fixed[i]=walkable(arena,x,z,hunterRadius)?0:1
    }
  }

  update(now:number,zones:readonly Zone[]) {
    this.danger.fill(0)
    for(const slot of this.baseByTime) slot.length=0
    for(const zone of zones) {
      const first=Math.max(0,Math.floor((zone.at-now)/tactics.timeSlice))
      const last=Math.min(slices-1,Math.floor((zone.until-now)/tactics.timeSlice))
      const minX=this.gridCoord(Math.min(zone.point.x,zone.end?.x??zone.point.x)-zone.radius)
      const maxX=this.gridCoord(Math.max(zone.point.x,zone.end?.x??zone.point.x)+zone.radius)
      const minZ=this.gridCoord(Math.min(zone.point.z,zone.end?.z??zone.point.z)-zone.radius)
      const maxZ=this.gridCoord(Math.max(zone.point.z,zone.end?.z??zone.point.z)+zone.radius)
      for(let t=first;t<=last;t++) {
        this.baseByTime[t].push(zone)
        for(let iz=minZ;iz<=maxZ;iz++) for(let ix=minX;ix<=maxX;ix++) {
          if(contains(zone,ix*tactics.grid-this.arena.radius,iz*tactics.grid-this.arena.radius,tactics.grid*.72)) {
            this.danger[t*this.span+iz*this.gridSize+ix]=1
          }
        }
      }
    }
  }

  private gridCoord(value:number) {
    return clamp(Math.round((value+this.arena.radius)/tactics.grid),0,this.gridSize-1)
  }
  private index(x:number,z:number) {
    return this.gridCoord(z)*this.gridSize+this.gridCoord(x)
  }

  risk(x:number,z:number,time:number) {
    const index=this.index(x,z)
    const slot=clamp(Math.floor(time/tactics.timeSlice),0,slices-1)
    return this.fixed[index] ? 1 : this.danger[slot*this.span+index]
  }

  diagnostic(time:number,cap=100) {
    const slot=clamp(Math.floor(time/tactics.timeSlice),0,slices-1)
    const points:Vector3[]=[]
    for(let i=0;i<this.span && points.length<cap;i++) if(this.danger[slot*this.span+i]) {
      points.push(new Vector3(i%this.gridSize*tactics.grid-this.arena.radius,0,Math.floor(i/this.gridSize)*tactics.grid-this.arena.radius))
    }
    return points
  }

  escape(player:PlayerTrack, now:number, addition:readonly Zone[], body:Vector3, bodyRadius:number, plan?:Plan) {
    const heading=Math.atan2(player.point.x-body.x,player.point.z-body.z)
    const until=Math.min(tactics.horizon,Math.max(1.35,...addition.map(zone=>zone.kind==='direct'||zone.at-now<2.05?zone.until-now+.34:0)))
    const rollEarliest=Math.max(tactics.reaction,player.evadeDelay,player.rollWait)
    const instant=addition.find(zone=>zone.at>=now)?.at??now+1
    const rollOptions=[Infinity,rollEarliest,Math.max(rollEarliest,instant-now-.21)]
    const overlay=Array.from({length:slices},(_,i)=>{
      const lo=now+i*tactics.timeSlice, hi=lo+tactics.timeSlice+safetyStep
      return addition.filter(zone=>zone.at<=hi && zone.until>=lo-safetyStep)
    })
    for(const rollAt of rollOptions) for(let route=0;route<17;route++) {
      const direction=heading+(((route+1)>>1)*(route%2===0?1:-1))*Math.PI/8
      const second=direction+(route%2===0?1:-1)*Math.PI/5
      let x=player.point.x, z=player.point.z, valid=true
      const trace:Vector3[]=[]
      for(let t=safetyStep;t<=until+safetyStep*.5;t+=safetyStep) {
        const forced=t<player.evadeDelay
        const previousRoll=player.rollPhase>=0 && t+player.rollPhase<dodgeTiming.duration
        const phase=t-rollAt
        const rolling=phase>=0 && phase<dodgeTiming.duration
        let speed=0, dx=0, dz=0
        if(previousRoll) {
          speed=player.roll*(1-dodgeTiming.slowdown*(t+player.rollPhase)/dodgeTiming.duration)
          dx=player.rollDirection.x; dz=player.rollDirection.z
        } else if(forced || t<tactics.reaction) {
          dx=player.velocity.x; dz=player.velocity.z; speed=1
        } else {
          const angle=t>1.05 && !rolling?second:direction
          dx=Math.sin(angle); dz=Math.cos(angle)
          speed=rolling?player.roll*(1-dodgeTiming.slowdown*phase/dodgeTiming.duration):player.walk
        }
        const nextX=x+dx*speed*safetyStep, nextZ=z+dz*speed*safetyStep
        if(plan) motionPosition(plan,(t-plan.windup)/plan.active,this.bodyPosition)
        else this.bodyPosition.copy(body)
        const gap=bodyRadius+hunterRadius
        const freeBody=(nextX-this.bodyPosition.x)**2+(nextZ-this.bodyPosition.z)**2>=gap*gap
        if(freeBody && walkable(this.arena,nextX,nextZ,hunterRadius)) {
          x=nextX; z=nextZ
        } else if(rolling && !previousRoll) {
          valid=false
          break
        }
        if(t>=trace.length*.20) trace.push(new Vector3(x,0,z))
        const invulnerable=(previousRoll?t+player.rollPhase:phase)>=dodgeTiming.invincibleFrom &&
          (previousRoll?t+player.rollPhase:phase)<dodgeTiming.invincibleFrom+dodgeTiming.invincibleFor
        if(invulnerable) continue
        const slot=clamp(Math.floor(t/tactics.timeSlice),0,slices-1)
        const check=(zone:Zone) => zone.at<=now+t+.005 && zone.until>=now+t-safetyStep && contains(zone,x,z,.13)
        const index=this.index(x,z)
        if(overlay[slot].some(check) || this.danger[slot*this.span+index] && this.baseByTime[slot].some(check) ||
          slot>0 && this.danger[(slot-1)*this.span+index] && this.baseByTime[slot-1].some(check)) {
          valid=false
          break
        }
      }
      if(valid) return trace
    }
  }
}

export interface Candidate {
  id:PaperAttack
  score:number
  reason:string
  plan?:Plan
  escape?:Vector3[]
}
export interface Situation {
  arena:Arena
  body:Vector3
  bodyRadius:number
  yaw:number
  player:PlayerTrack
  now:number
  ready:ReadonlyMap<PaperAttack,number>
  rage:boolean
  rageTempo:number
  habits:Habits
  nearTime:number
  farTime:number
  last?:PaperAttack
  lastUses:readonly PaperAttack[]
  combo:boolean
}

export function evaluate(s:Situation,map:DangerMap,random=Math.random) {
  const {arena,body,yaw,player,now,ready,rage,habits,last,combo}=s
  const d=Math.sqrt(distance2(body,player.point))
  const predicted=player.point.clone().addScaledVector(player.velocity,tactics.lookAhead)
  arena.resolve(predicted,hunterRadius)
  const targetYaw=Math.atan2(predicted.x-body.x,predicted.z-body.z)
  const currentYaw=Math.atan2(player.point.x-body.x,player.point.z-body.z)
  const offset=Math.abs(wrap(currentYaw-yaw))
  const options:Candidate[]=[]
  let bestPlan:Candidate|undefined
  for(const id of attackIds) {
    const a=attacks[id]
    const reject=(reason:string)=>options.push({id,score:0,reason})
    if(id==='chain' && !rage) { reject('怒り限定'); continue }
    if(id===last || now<(ready.get(id)??0)) { reject(id===last?'直前に使用':'再使用待ち'); continue }
    if(combo && !(last && chains[last]?.includes(id) || rage && last==='head' && id==='chain')) { reject('連携対象外');continue }
    if(d<a.min || d>a.max || id==='spin' && s.nearTime<.58 && !combo) { reject('間合い・密着時間');continue }
    if(id!=='spin' && offset>(combo?1.56:1.20)) { reject('向き');continue }
    const side=habits.left>habits.right+.08?1:habits.right>habits.left+.08?-1:random()<.5?-1:1
    const adjustedYaw=targetYaw+(id==='sweep'?clamp(habits.left-habits.right,-.2,.2):0)
    const plan=makePlan(id,arena,body,predicted,id==='spin'?yaw:adjustedYaw,now,rage,side,s.bodyRadius,s.rageTempo)
    const end=plan.path.at(-1)!
    if(!plan.zones.length || id==='slide' && distance2(body,end)<16 || id==='head' && distance2(body,end)<1.8 ||
      id==='leap' && distance2(predicted,end)>(a.radius*.73)**2) { reject('壁・着地点'); continue }
    const closePaper=plan.papers.map(stamp=>plannedPaper(stamp,stamp.immediate?now:stamp.placed))
    const danger=[...plan.zones,...closePaper]
    const escape=map.escape(player,now,danger,body,s.bodyRadius,plan)
    if(!escape) { reject('回避経路なし'); continue }
    const distance=clamp(1-Math.abs(d-a.ideal)/Math.max(a.ideal-a.min,a.max-a.ideal),0,1)
    const aim=id==='spin'?.9:clamp(1-offset/1.7,0,1)
    const impact=plan.zones[0]
    const impactTarget=player.point.clone().addScaledVector(player.velocity,Math.min(.58,impact.at-now))
    const hit=plan.zones.some(z=>contains(z,impactTarget.x,impactTarget.z,.28))?.95:.36
    let synergy=0
    const retreatYaw=currentYaw
    for(const angle of [-.86,0,.86]) {
      const x=impactTarget.x+Math.sin(retreatYaw+angle)*2.5
      const z=impactTarget.z+Math.cos(retreatYaw+angle)*2.5
      synergy+=Math.max(map.risk(x,z,impact.at-now),map.risk(x,z,impact.at-now+.3))
    }
    synergy/=3
    const adaptation=clamp(
      (id==='head'?habits.back:0)+(id==='spin'?habits.close:0)+
      (id==='slide'||id==='leap'?habits.far+Math.min(.18,s.farTime*.03):0)+
      (plan.papers.length?habits.guard:0)+(id==='double'?habits.counter:0)+
      (id==='sweep'||id==='double'||id==='slide'?Math.max(habits.left,habits.right):0),0,1)
    const penalty=s.lastUses.filter(used=>used===id).length*.055
    const position=clamp((arena.radius-Math.hypot(end.x,end.z))/7,0,1)*
      (1-map.risk(end.x,end.z,impact.at-now+.4)*.55)
    const comboScore=combo?1:(a.terminal?.56:.7)
    const base=distance*.25+aim*.15+hit*.15+synergy*.20+comboScore*.10+position*.05
    const behaviorBonus=Math.min(adaptation*.10,base*tactics.adaptation)
    const score=Math.max(.01,base+behaviorBonus-penalty)
    const reason=synergy>.35?'退路制限・時間差挟撃':adaptation>.22?'過去の行動に対応':combo?'コンボ派生':'間合いと角度'
    const candidate={id,score,reason,plan,escape}
    options.push(candidate)
    if(!bestPlan || score>bestPlan.score) bestPlan=candidate
  }
  if(!bestPlan) return {options,chosen:undefined}
  const ranked=options.filter(option=>option.plan).sort((a,b)=>b.score-a.score).slice(0,3)
  let roll=random()*ranked.reduce((sum,candidate)=>sum+candidate.score**2,0)
  const chosen=ranked.find(candidate=>(roll-=candidate.score**2)<=0)??ranked[0]
  return {options,chosen}
}
