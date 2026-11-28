import { Vector3 } from 'three'
import { clamp, forward, smooth } from '../math'
import type { Arena } from '../world'
import { attacks, chainCount, chainGap, chainLength, paper, secondSlamGap, tactics, ultimate, type PaperAttack } from './config'

export interface Zone {
  point: Vector3
  radius: number
  at: number
  until: number
  warn: number
  damage: number
  strike: number
  kind: 'direct' | 'blast'
  end?: Vector3
  yaw?: number
  knockdown?: boolean
}
export interface CursePaper {
  point: Vector3
  radius: number
  placed: number
  at: number
  damage: number
  strike: number
  immediate: boolean
  ultimate: boolean
  warned: boolean
}
export interface Plan {
  id: PaperAttack
  origin: Vector3
  yaw: number
  path: Vector3[]
  windup: number
  active: number
  zones: Zone[]
  papers: CursePaper[]
  side: number
}

export const put = (origin:Vector3,yaw:number,distance:number) =>
  forward(yaw,new Vector3()).multiplyScalar(distance).add(origin)
export const distance2 = (a:Vector3,b:Vector3) => (a.x-b.x)**2+(a.z-b.z)**2

export function contains(zone:Zone, x:number, z:number, padding=0) {
  let dx=x-zone.point.x, dz=z-zone.point.z
  if(zone.end) {
    const sx=zone.end.x-zone.point.x, sz=zone.end.z-zone.point.z
    const t=clamp((dx*sx+dz*sz)/(sx*sx+sz*sz||1),0,1)
    dx-=t*sx; dz-=t*sz
  }
  if(dx*dx+dz*dz>(zone.radius+padding)**2) return false
  return zone.yaw===undefined || dx*Math.sin(zone.yaw)+dz*Math.cos(zone.yaw)>=-padding
}

export function walkable(arena:Pick<Arena,'radius'|'obstacles'>, x:number,z:number,radius:number) {
  if(x*x+z*z>(arena.radius-radius+.001)**2) return false
  return !arena.obstacles.some(o=>(x-o.x)**2+(z-o.z)**2<(o.radius+radius-.001)**2)
}

function clipPath(arena:Arena, points:Vector3[], radius:number) {
  const clipped=[points[0]]
  for(let i=1;i<points.length;i++) {
    const from=clipped[i-1], to=points[i]
    const steps=Math.ceil(Math.sqrt(distance2(from,to))/.22)
    let last=from
    for(let j=1;j<=steps;j++) {
      const x=from.x+(to.x-from.x)*j/steps, z=from.z+(to.z-from.z)*j/steps
      if(!walkable(arena,x,z,radius)) {
        clipped.push(last)
        return clipped
      }
      last=new Vector3(x,arena.height(x,z),z)
    }
    clipped.push(last)
  }
  return clipped
}

export function circle(point:Vector3,radius:number,at:number,warn:number,damage:number,strike:number,kind:Zone['kind']='direct'):Zone {
  return {point,radius,at,until:at+.035,warn,damage,strike,kind}
}

export function makePlan(id:PaperAttack, arena:Arena, origin:Vector3, target:Vector3, yaw:number, now:number, rage:boolean, side:number, bodyRadius:number, rageTempo=1.2):Plan {
  const attack=attacks[id], tempo=rage?rageTempo:1
  const windup=Math.max(tactics.lockLead,tactics.minWindup,attack.windup/tempo)
  const interval=id==='double' || id==='chain' ? 1 : tempo
  const active=Math.max(id==='leap'?.46:0,attack.active/interval)
  const begins=now+windup
  const zones:Zone[]=[], papers:CursePaper[]=[]
  let path=[origin.clone()]
  const center=(point:Vector3) => {
    const grounded=point.clone()
    arena.resolve(grounded,.08)
    return grounded
  }
  const curse=(point:Vector3,at:number,strike:number) => {
    const stamp=center(point)
    papers.push({
      point:stamp, radius:rage?paper.rageRadius:paper.radius,
      placed:at, at:at+(rage?paper.rageFuse:paper.fuse),
      damage:paper.damage, strike, immediate:rage, ultimate:false, warned:false,
    })
  }
  const impact=(point:Vector3,radius:number,at:number,strike:number) => {
    const zone=circle(center(point),radius,at,now,attack.damage,strike)
    zone.knockdown=id==='leap'||id==='spin'
    zones.push(zone)
    return zone
  }

  switch(id) {
    case 'head': {
      path=clipPath(arena,[origin.clone(),put(origin,yaw,attack.travel)],bodyRadius)
      const end=path.at(-1)!
      const hit=impact(put(end,yaw,.72),attack.radius,begins+active*.88,1)
      hit.until=begins+active
      curse(hit.point,hit.at,1)
      break
    }
    case 'double': {
      for(let i=0;i<2;i++) {
        const point=put(origin,yaw+side*(i===0?-.48:.48),2.15)
        const hit=impact(point,attack.radius,begins+.08+i*secondSlamGap,i+1)
        if(i) hit.warn=begins+.15
        curse(hit.point,hit.at,i+1)
      }
      break
    }
    case 'slide': {
      const points=Array.from({length:13},(_,i)=>{
        const p=put(origin,yaw,attack.travel*i/12)
        return put(p,yaw+Math.PI/2,side*1.45*Math.sin(i/12*Math.PI*2))
      })
      path=clipPath(arena,points,bodyRadius)
      for(let i=1;i<path.length;i++) {
        const at=begins+(i-1)*active/(path.length-1)
        zones.push({...circle(path[i-1],attack.radius,at,now,attack.damage,1),end:path[i],until:begins+i*active/(path.length-1)})
      }
      for(let i=1;i<=4;i++) {
        const index=Math.round(i*(path.length-1)/4)
        curse(path[index],begins+i*active/4,1)
      }
      break
    }
    case 'sweep': {
      const at=begins+active*.43
      const hit=impact(origin,attack.radius,at,1)
      hit.yaw=yaw
      hit.until=at+.07
      for(const angle of [-.95,0,.95]) curse(put(origin,yaw+angle,3.55),at,1)
      break
    }
    case 'leap': {
      const end=put(origin,yaw,Math.min(attack.travel,Math.sqrt(distance2(origin,target))))
      path=clipPath(arena,[origin.clone(),end],bodyRadius)
      const hit=impact(path.at(-1)!,attack.radius,begins+active*.96,1)
      for(let i=0;i<3;i++) curse(put(hit.point,yaw+i*Math.PI*2/3,2.5),hit.at,1)
      break
    }
    case 'spin': {
      impact(origin,attack.radius,begins+active*.48,1)
      break
    }
    case 'chain': {
      for(let i=0;i<chainCount;i++) {
        const p=put(origin,yaw,chainLength*(i+1)/chainCount)
        if(!walkable(arena,p.x,p.z,.12)) break
        const zone=circle(p,attack.radius,begins+.08+i*chainGap,now,attack.damage,1,'blast')
        zone.knockdown=true
        zones.push(zone)
      }
      break
    }
  }
  return {id,origin:origin.clone(),yaw,path,windup,active,zones,papers,side}
}

export function plannedPaper(stamp:CursePaper, warning=stamp.placed):Zone {
  return circle(stamp.point,stamp.radius,stamp.at,warning,stamp.damage,stamp.strike,'blast')
}

export function motionPosition(plan:Plan,progress:number,out:Vector3) {
  const eased=plan.id==='head'?smooth(progress/.86):plan.id==='leap'?smooth(progress/.96):clamp(progress,0,1)
  const point=eased*(plan.path.length-1)
  const index=Math.floor(point)
  return out.copy(plan.path[index]).lerp(plan.path[index+1]??plan.path[index],point-index)
}

export function ultimatePattern(arena:Arena, center:Vector3, yaw:number, now:number, round:number) {
  const lanes:Zone[]=[]
  for(let arm=0;arm<3;arm++) for(let step=0;step<6;step++) {
    const point=put(center,yaw+arm*Math.PI*2/3,2.1*(step+1))
    if(walkable(arena,point.x,point.z,.1)) lanes.push(circle(point,ultimate.laneRadius,now+ultimate.laneStart+step*ultimate.laneGap,now+.75,ultimate.laneDamage,1,'blast'))
  }
  const papers:CursePaper[]=[]
  for(const [ring,radius] of ultimate.rings.entries()) for(let i=0;i<ultimate.perRing;i++) {
    const angle=yaw+(i+.5+ring*.5)*(Math.PI*2/ultimate.perRing)
    const point=put(center,angle,radius)
    if(!walkable(arena,point.x,point.z,.1)) continue
    const sequence=(round===1?i:(ultimate.perRing-i)%ultimate.perRing)*2+(round===1?ring:1-ring)
    papers.push({
      point,radius:paper.radius,placed:now+ultimate.scatter,
      at:now+ultimate.residualStart+sequence*ultimate.residualGap,
      damage:paper.damage,strike:10+sequence,immediate:false,ultimate:true,warned:false,
    })
  }
  const final=circle(center.clone(),ultimate.finalRadius,now+ultimate.finalAt,now+ultimate.finalAt-ultimate.finalTell,ultimate.finalDamage,2,'blast')
  final.knockdown=true
  return {lanes, papers, final}
}
