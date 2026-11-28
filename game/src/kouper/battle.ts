import { Vector3 } from 'three'
import { Battle, dodgeTiming, type BossState } from '../battle'
import type { Motion } from '../config'
import { clamp, flatDistance, forward, wrap, yawTo } from '../math'
import { DangerMap, HuntHistory, evaluate, type Candidate, type PlayerTrack } from './ai'
import { attacks, attackIds, paper, tactics, ultimate, type PaperAttack } from './config'
import { circle, contains, distance2, motionPosition, plannedPaper, put, ultimatePattern, walkable, type CursePaper, type Plan, type Zone } from './plan'
import { PaperVisuals } from './visuals'

type State = 'Idle' | 'Observe' | 'Approach' | 'Strafe' | 'Retreat' | 'Turn' | 'Windup' |
  'Attack' | 'ComboTransition' | 'Recovery' | 'RageTransition' | 'Ultimate' | 'UltimateRecovery' | 'Stagger' | 'Death'
const stateFor:Record<State,BossState> = {
  Idle:'idle',Observe:'search',Approach:'approach',Strafe:'approach',Retreat:'approach',Turn:'turn',
  Windup:'windup',Attack:'attack',ComboTransition:'recovery',Recovery:'recovery',RageTransition:'rage',
  Ultimate:'attack',UltimateRecovery:'recovery',Stagger:'stagger',Death:'defeat',
}
const cues = {
  head:'paper-head', double:'paper-double', slide:'paper-slide', sweep:'paper-sweep',
  leap:'paper-leap', spin:'paper-spin', chain:'paper-chain',
} as const
const paperColor=0xe9d9ba

export class KouperBattle extends Battle {
  readonly visuals=new PaperVisuals(this.arena.height)
  private state:State='Idle'
  private stateAt=0
  private readonly history=new HuntHistory()
  private readonly danger=new DangerMap(this.arena)
  private readonly readyAt=new Map<PaperAttack,number>()
  private readonly recent:PaperAttack[]=[]
  private readonly stamps:CursePaper[]=[]
  private readonly touched=new Set<CursePaper>()
  private readonly spent=new Map<number,number>()
  private readonly origin=new Vector3()
  private readonly motion=new Vector3()
  private readonly travel=new Vector3()
  private readonly faceDirection=new Vector3()
  private readonly previous=new Vector3()
  private readonly velocity=new Vector3()
  private readonly player:PlayerTrack={
    point:this.p,velocity:this.velocity,walk:this.weapon.walk,roll:this.weapon.roll,
    rollDirection:this.dodgeDirection,rollPhase:-1,evadeDelay:0,rollWait:0,
  }
  private readonly paperSource=new Vector3()
  private readonly nextTravel=new Vector3()
  private plan?:Plan
  private attackStarted=0
  private events=0
  private paperEvents=0
  private attackSerial=100
  private last?:PaperAttack
  private chainCount=0
  private recovery=0
  private nearTime=0
  private farTime=0
  private guardingAt=-1
  private nextSense=0
  private nextThink=0
  private nextMove=0
  private waitUntil=.35
  private orbitSide=1
  private mode='索敵'
  private attachedUntil=0
  private removes=0
  private attachCooldown=0
  private pattern?:ReturnType<typeof ultimatePattern>
  private patternStart=0
  private ultimateRound=0
  private firedUltimates=0
  private finishedUltimates=0
  private nextUltimate=0
  private dustAt=0
  private rageLight=false
  private terminated=false
  private debug?:HTMLPreElement
  private debugDanger?:DangerMap
  private debugScores:Candidate[]=[]
  private debugPath:Vector3[]=[]
  private debugZones:Vector3[]=[]
  private debugTime=0
  private debugFrame=1/60
  private debugAt=0
  private selection=''

  override get defeatDuration() { return 2.2 }
  override get statusNotice() {
    return this.attachedUntil>this.elapsed ? `呪紙付着 ${(this.attachedUntil-this.elapsed).toFixed(1)}秒 · 回避あと${paper.dodgeCount-this.removes}回` : ''
  }
  protected override get attackDamageMultiplier() { return this.rage?tactics.rageDamage:1 }
  protected override magicPartBonus(part:KouperBattle['monster']['parts'][number]) { return part.config.multiplier }

  override reset() {
    this.monster.groundHeight=this.arena.height
    super.reset()
    // The base constructor calls reset before the subclass fields exist.
    if(!this.visuals) return
    this.monster.setFlightOffset(0)
    this.monster.animate('idle',0)
    this.visuals.clear()
    this.readyAt.clear(); this.recent.length=0; this.stamps.length=0; this.touched.clear(); this.spent.clear()
    this.history.clear()
    this.plan=undefined; this.last=undefined; this.pattern=undefined
    this.state='Idle'; this.stateAt=0; this.attackStarted=0; this.chainCount=0; this.dustAt=0
    this.nextThink=this.nextSense=this.nextMove=this.nearTime=this.farTime=this.nextUltimate=0
    this.firedUltimates=this.finishedUltimates=this.ultimateRound=0
    this.attachedUntil=this.removes=this.attachCooldown=0
    this.guardingAt=-1; this.waitUntil=.35; this.orbitSide=1; this.mode='索敵'
    this.rageLight=this.terminated=false
    this.previous.copy(this.p); this.velocity.set(0,0,0)
    this.debugAt=0; this.debugScores=[]; this.debugPath=[]; this.debugZones=[]; this.selection=''
    if(this.debug) this.debug.hidden=true
  }

  enableDebug(host:HTMLElement) {
    if(!new URLSearchParams(location.search).has('kouper-debug')) return
    const panel=document.createElement('pre')
    panel.className='kouper-debug'
    panel.hidden=true
    host.append(panel)
    this.debug=panel
    this.debugDanger=new DangerMap(this.arena)
  }
  frame(dt:number,active:boolean) {
    if(this.debug) this.debug.hidden=!active
    if(!active) return
    if(this.debug && dt>0) {
      this.debugFrame+=(dt-this.debugFrame)*.12
      if(this.elapsed>=this.debugAt) {
        this.debugAt=this.elapsed+tactics.rethink
        const hazards=this.stamps.map(stamp=>plannedPaper(stamp))
        if(this.plan) hazards.push(...this.immediateWarnings)
        if(this.pattern) hazards.push(...this.pattern.lanes,this.pattern.final)
        this.debugDanger?.update(this.elapsed,hazards)
        this.refreshDebug()
      }
    }
    const warning=this.plan ? this.plan.zones : this.pattern ? this.pattern.lanes : []
    const telegraphs:readonly Zone[]=this.pattern
      ? [...warning,this.pattern.final] : this.plan && this.rage ? this.immediateWarnings : warning
    this.visuals.draw(this.elapsed,telegraphs,this.stamps,this.p,Math.max(0,this.attachedUntil-this.elapsed),this.rageLight,this.m,
      this.debug?{map:this.debugZones,path:this.debugPath}:undefined)
  }

  override update(...args:Parameters<Battle['update']>) {
    super.update(...args)
    if(!this.outcome || this.terminated) return
    this.terminated=true
    this.plan=undefined; this.pattern=undefined; this.stamps.length=0; this.touched.clear(); this.spent.clear()
    this.attachedUntil=0; this.rageLight=false
    this.monster.setFlightOffset(0)
    this.visuals.clear()
    if(this.outcome==='victory') this.enter('Death')
  }

  protected override onDodge(direction:Vector3) {
    const escapeHeading=yawTo(this.m,this.p)
    const offset=wrap(Math.atan2(direction.x,direction.z)-escapeHeading)
    this.history.add(this.elapsed,Math.abs(offset)<.53?'back':offset>0?'left':'right')
    if(this.attachedUntil<=this.elapsed || ++this.removes<paper.dodgeCount) return
    this.attachedUntil=0
    this.attachCooldown=this.elapsed+.22
    this.fx.sound('paper-clear',this.p)
    this.visuals.emit(this.p,this.elapsed,0x9df5cb,16,3.4)
  }
  protected override onBossHit(_magic:boolean, damage:number) {
    if(damage>0 && this.state==='Recovery' && this.elapsed-this.stateAt<.40) this.history.add(this.elapsed,'counter')
  }
  protected override preserveBossHealth(damage:number) {
    return this.finishedUltimates<ultimate.thresholds.length?Math.min(damage,Math.max(0,this.bossHp-1)):damage
  }
  protected override canInterruptBoss() {
    return this.state==='Idle'||this.state==='Observe'||this.state==='Approach'||this.state==='Strafe'||this.state==='Retreat'||this.state==='Turn'
  }

  private enter(state:State,notice='') {
    this.state=state; this.stateAt=this.elapsed
    this.setBoss(stateFor[state])
    this.callout=notice
  }

  protected override updateBoss(dt:number) {
    if(this.elapsed>=this.nextSense) this.observe()
    if(this.outcome) return
    if(this.canInterruptBoss() && (this.bossState==='hit'||this.bossState==='stagger'||this.bossState==='fall')) {
      this.enter('Stagger',this.bossState==='hit'?'':this.callout)
    }
    const age=this.elapsed-this.stateAt
    if(this.plan && (this.state==='Windup'||this.state==='Attack')) this.runAttack(this.plan,dt)
    else if(this.state==='Ultimate') this.runUltimate(dt,age)
    else if(this.state==='UltimateRecovery') {
      this.monster.animate('paperRest',dt,clamp(age/ultimate.fatigue,0,1))
      if(age>=ultimate.fatigue) {
        this.finishedUltimates++
        this.nextUltimate=this.elapsed+.85
        this.endSequence()
      }
    } else if(this.state==='Recovery') {
      this.monster.animate('paperRecover',dt,clamp(age/this.recovery,0,1))
      if(age>=this.recovery) this.finishRecovery()
    } else if(this.state==='ComboTransition') {
      this.monster.animate('idle',dt)
      if(age>=.12) {
        if(!this.checkPhase() && !this.decide(true)) this.endSequence()
      }
    } else if(this.state==='RageTransition') {
      this.monster.animate('enrage',dt,clamp(age/.92,0,1))
      if(age>=.92) this.startUltimate()
    } else if(this.state==='Stagger') {
      const duration=this.callout ? .55 : .24
      this.monster.animate(this.callout?'stagger':'hit',dt,clamp(age/duration,0,1))
      if(age>=duration) this.endSequence()
    } else if(!this.checkPhase()) {
      if(this.elapsed>=this.waitUntil && this.elapsed>=this.nextThink && this.decide(false)) {
        this.monster.animate(this.plan!.id==='leap'?'paperJump':this.attackMotion(this.plan!),dt,0)
      } else this.moveTactically(dt)
    }
    if(!this.outcome) this.updatePaper()
  }

  private observe() {
    const interval=Math.max(tactics.observe,this.elapsed-this.nextSense+tactics.observe)
    this.velocity.subVectors(this.p,this.previous).setY(0).divideScalar(interval).clampLength(0,this.weapon.roll)
    if(this.nextSense===0) this.velocity.set(0,0,0)
    this.previous.copy(this.p)
    this.nextSense=this.elapsed+tactics.observe
    const distance=flatDistance(this.m,this.p)
    this.nearTime=distance<=tactics.tightRange?this.nearTime+interval:Math.max(0,this.nearTime-interval*1.6)
    this.farTime=distance>=tactics.farRange?this.farTime+interval:Math.max(0,this.farTime-interval*1.6)
    if(distance<tactics.tightRange) this.history.add(this.elapsed,'close',.18)
    if(distance>tactics.farRange) this.history.add(this.elapsed,'far',.18)
    if(this.guarding && this.elapsed>=this.guardingAt+.42) {
      this.guardingAt=this.elapsed
      this.history.add(this.elapsed,'guard',.65)
    }
  }

  private readPlayer() {
    this.player.evadeDelay=this.playerEvadeDelay
    this.player.rollPhase=this.playerState==='dodge'?this.playerStateTime:-1
    this.player.rollWait=this.stamina>=20?0:(20-this.stamina)/24+this.staminaRecoveryDelay
    return this.player
  }

  private decide(combo:boolean) {
    this.nextThink=this.elapsed+tactics.rethink
    const start=performance.now()
    this.danger.update(this.elapsed,this.stamps.map(stamp=>plannedPaper(stamp)))
    const result=evaluate({
      arena:this.arena,body:this.m,bodyRadius:this.monster.data.radius,yaw:this.bossYaw,
      player:this.readPlayer(),now:this.elapsed,ready:this.readyAt,rage:this.rage,rageTempo:this.monster.data.rage.tempo,
      habits:this.history.read(this.elapsed),nearTime:this.nearTime,farTime:this.farTime,last:this.last,
      lastUses:this.recent,combo,
    },this.danger)
    this.debugTime=performance.now()-start
    this.debugScores=result.options
    this.debugPath=result.chosen?.escape??[]
    this.selection=result.chosen?.reason??'移動で間合い調整'
    if(!result.chosen?.plan) return false
    this.beginAttackPlan(result.chosen.plan)
    return true
  }

  private moveTactically(dt:number) {
    const distance=flatDistance(this.m,this.p)
    const toward=yawTo(this.m,this.p)
    const turn=wrap(toward-this.bossYaw)
    if(this.elapsed>=this.nextMove) {
      this.nextMove=this.elapsed+tactics.rethink
      if(Math.hypot(this.m.x,this.m.z)>this.arena.radius-4) this.mode='壁から中央へ'
      else if(Math.abs(turn)>1.1) this.mode='方向転換'
      else if(distance>9.3) this.mode='高速接近'
      else if(distance>5.9) this.mode='蛇行接近'
      else if(distance<2 && this.nearTime>.38) this.mode='短距離後退'
      else if(this.elapsed<this.waitUntil && Math.random()<.22) this.mode='短時間待機'
      else this.mode=distance<3.5?'側面への回り込み':'円周移動'
      const left=put(this.m,toward-Math.PI*.5,2), right=put(this.m,toward+Math.PI*.5,2)
      const risk=(p:Vector3) => {
        let value=walkable(this.arena,p.x,p.z,this.monster.data.radius)?0:2
        for(const stamp of this.stamps) {
          if(stamp.at-this.elapsed<1.3 && distance2(stamp.point,p)<=stamp.radius**2) value++
        }
        return value+Math.hypot(p.x,p.z)/this.arena.radius*.35
      }
      if(Math.abs(risk(left)-risk(right))>.08) this.orbitSide=risk(left)>risk(right)?1:-1
    }
    let target=toward,speed=1,state:State='Approach',motion:Motion='walk'
    switch(this.mode) {
      case '壁から中央へ': target=yawTo(this.m,this.origin); speed=.95; break
      case '方向転換': state='Turn'; motion=turn>0?'turn':'turnRight'; speed=0; break
      case '高速接近': speed=1.3; motion='run'; break
      case '蛇行接近': target+=Math.sin(this.elapsed*4.8)*.54; break
      case '短距離後退': target+=Math.PI; speed=.61; state='Retreat'; motion='paperBack'; break
      case '短時間待機': state='Observe'; speed=0; motion='idle'; break
      default: target+=this.orbitSide*(this.mode==='側面への回り込み'?Math.PI*.56:Math.PI*.36)
        speed=.72; state='Strafe'; motion='paperStrafe'
    }
    if(state!==this.state) this.enter(state)
    this.turnToward(state==='Approach'&&speed>0?target:toward,dt)
    if(speed) this.moveEntity(this.m,forward(target,this.motion),dt*this.monster.data.speed*speed*(this.rage?this.monster.data.rage.speed:1),this.monster.data.radius,this.p,.44)
    this.monster.animate(motion,dt*(this.rage?1.25:1))
  }

  private turnToward(target:number,dt:number) {
    const step=dt*this.monster.data.ai.turnSpeed
    this.bossYaw+=clamp(wrap(target-this.bossYaw),-step,step)
    this.monster.root.rotation.y=this.bossYaw
  }

  private immediateWarnings:Zone[]=[]
  private beginAttackPlan(plan:Plan) {
    this.plan=plan
    this.attackStarted=this.elapsed
    this.immediateWarnings=plan.zones.slice()
    const serial=this.attackSerial+=100
    for(const zone of plan.zones) zone.strike+=serial
    for(const [index,stamp] of plan.papers.entries()) {
      stamp.strike+=serial+(stamp.immediate?0:20+index*4)
      if(stamp.immediate) {
        const warning=plannedPaper(stamp,plan.id==='double'&&index===1?this.elapsed+plan.windup+.15:this.elapsed)
        this.immediateWarnings.push(warning)
      }
    }
    this.events=this.paperEvents=0
    this.bossYaw=plan.yaw; this.monster.root.rotation.y=plan.yaw
    this.last=plan.id
    this.recent.push(plan.id)
    if(this.recent.length>5) this.recent.shift()
    this.chainCount++
    this.enter('Windup',attacks[plan.id].name+' · '+attacks[plan.id].hint)
    this.fx.sound(cues[plan.id],this.m,.64)
  }

  private attackMotion(plan:Plan):Motion {
    if(plan.id==='double' && plan.side<0) return 'paperDoubleRight'
    return attacks[plan.id].motion
  }

  private runAttack(plan:Plan,dt:number) {
    const t=this.elapsed-this.attackStarted
    const elapsed=t-plan.windup
    const f=clamp(elapsed/plan.active,0,1)
    if(elapsed>=0 && this.state==='Windup') this.enter('Attack',this.callout)
    if(elapsed>=0 && plan.path.length>1) {
      motionPosition(plan,f,this.travel)
      if(plan.id==='slide' && f<.99) {
        motionPosition(plan,Math.min(1,f+.05),this.nextTravel)
        if(distance2(this.travel,this.nextTravel)>.001) this.turnToward(yawTo(this.travel,this.nextTravel),dt)
      }
      this.m.copy(this.travel)
      if(plan.id==='slide' && this.elapsed>this.dustAt) {
        this.dustAt=this.elapsed+.075
        this.visuals.emit(this.m,this.elapsed,paperColor,5,3.2)
      }
    }
    if(plan.id==='leap') {
      const lifting=elapsed>=0 && f<.96
      this.monster.setFlightOffset(lifting?2.95*Math.sin(Math.PI*f/.96):0)
      if(elapsed<0) this.monster.animate('paperJump',dt,clamp(t/plan.windup,0,1))
      else if(f<.82) this.monster.animate('paperAir',dt,f/.82)
      else this.monster.animate('paperLand',dt,clamp((f-.82)/.18,0,1))
    } else {
      const key=plan.id==='head'?.34:plan.id==='double'?.35:plan.id==='spin'?.33:.35
      let pose=elapsed<0?key*clamp(t/plan.windup,0,1):key+(1-key)*f
      if(plan.id==='double' && elapsed>=0) {
        pose=elapsed<.08?.35+clamp(elapsed/.08,0,1)*.13:
          elapsed<.53?.48+(elapsed-.08)/.45*.48:.96+clamp((elapsed-.53)/.07,0,1)*.04
      }
      this.monster.animate(this.attackMotion(plan),dt,pose)
    }

    for(let i=0;i<plan.zones.length;i++) {
      const zone=plan.zones[i]
      if(this.elapsed+1e-7<zone.at) continue
      const bit=1<<i
      if(!(this.events&bit)) {
        this.events|=bit
        if(zone.kind==='blast') this.visuals.blast(zone,this.elapsed)
        if(zone.kind==='blast'||plan.id!=='slide') {
          if(zone.kind==='direct') this.visuals.emit(zone.point,this.elapsed,paperColor,13,3.1)
          this.fx.sound(plan.id==='chain'?'paper-pop':cues[plan.id],zone.point,plan.id==='chain'?.78:1)
        }
      }
      if(this.elapsed<=zone.until+.0001) this.hitZone(zone,attacks[plan.id].name)
    }
    while(this.paperEvents<plan.papers.length && this.elapsed+1e-7>=plan.papers[this.paperEvents].placed) {
      this.place(plan.papers[this.paperEvents++])
    }
    if(elapsed+1e-7<plan.active) return
    this.monster.setFlightOffset(0)
    this.readyAt.set(plan.id,this.elapsed+attacks[plan.id].cooldown)
    this.recovery=attacks[plan.id].recovery*(this.rage?tactics.rageRecovery:1)
    this.enter('Recovery','攻撃後の隙 · 頭部を狙え')
  }

  private finishRecovery() {
    const canCombo=this.plan && !attacks[this.plan.id].terminal && this.chainCount<tactics.combo[this.rage?1:0]
    this.plan=undefined
    if(this.checkPhase()) return
    if(canCombo) this.enter('ComboTransition','連携に注意')
    else this.endSequence()
  }

  private endSequence() {
    this.chainCount=0
    this.plan=undefined
    const [min,max]=this.rage?tactics.rageWait:tactics.wait
    this.waitUntil=this.elapsed+min+Math.random()*(max-min)
    this.enter('Observe')
  }

  private checkPhase() {
    const ratio=this.bossHp/this.monster.data.hp
    if(!this.rage && ratio<=this.monster.data.rage.hpRatio) {
      this.rage=true
      this.rageLight=true
      this.monster.setEnraged(true)
      this.enter('RageTransition','怒り · 呪紙が着弾直後に爆発する')
      this.fx.sound('paper-rage',this.m)
      this.visuals.emit(this.m,this.elapsed,0xff5841,22,3.5)
      return true
    }
    if(this.firedUltimates<ultimate.thresholds.length && ratio<=ultimate.thresholds[this.firedUltimates] && this.elapsed>=this.nextUltimate) {
      this.startUltimate()
      return true
    }
    return false
  }

  private startUltimate() {
    this.chainCount=0; this.pattern=undefined
    this.ultimateRound=++this.firedUltimates
    this.enter('Ultimate',ultimate.name+' · 神殿中央へ移動')
    this.events=0; this.paperEvents=0
  }

  private runUltimate(dt:number,age:number) {
    if(!this.pattern) {
      const target=this.origin
      const distance=flatDistance(this.m,target)
      if(distance>.17 && age<ultimate.approach) {
        const yaw=yawTo(this.m,target)
        this.turnToward(yaw,dt)
        this.moveEntity(this.m,forward(yaw,this.motion),Math.min(distance,dt*Math.max(7.5,distance/(ultimate.approach-age+.08))),this.monster.data.radius,this.p,.44)
        this.monster.animate('run',dt*1.35)
        return
      }
      const center=this.m.clone()
      // Relocate to the clear central arena if body contact temporarily blocked the approach.
      if(distance>2.2) {
        const path=put(center,yawTo(center,target),Math.min(distance,.60))
        if(walkable(this.arena,path.x,path.z,this.monster.data.radius) && flatDistance(path,this.p)>1.55 && age<ultimate.approach+.8) {
          this.m.copy(path); this.monster.animate('run',dt*1.3); return
        }
      }
      const existingClear=this.stamps.reduce((clear,entry)=>Math.max(clear,entry.at),this.elapsed)
      this.patternStart=Math.max(this.elapsed,existingClear-ultimate.scatter+.06)
      this.pattern=this.pickPattern(center)
      const serial=this.attackSerial+=100
      for(const zone of this.pattern.lanes) zone.strike+=serial
      this.pattern.final.strike+=serial
      for(const stamp of this.pattern.papers) stamp.strike+=serial
      this.callout=ultimate.name+' · 圧縮と呪紙散布'
      this.fx.sound('paper-ultimate',this.m)
    }
    const pattern=this.pattern
    const time=this.elapsed-this.patternStart
    if(time<ultimate.scatter) {
      this.monster.animate('paperScatter',dt,.63*clamp(time/ultimate.charge,0,1))
      return
    }
    if(!this.paperEvents) {
      for(const stamp of pattern.papers) this.place(stamp)
      this.paperEvents=1
      this.visuals.emit(this.m,this.elapsed,paperColor,44,7)
      this.fx.sound('paper-stamp',this.m)
    }
    if(time<ultimate.laneStart) {
      this.callout=ultimate.name+' · 3本の爆発列の隙間へ'
      this.monster.animate('paperScatter',dt,.63+.37*clamp((time-ultimate.scatter)/(ultimate.laneStart-ultimate.scatter),0,1))
    } else if(time<ultimate.finalAt-ultimate.finalTell) {
      this.monster.animate('idle',dt)
      if(time>=ultimate.residualStart) this.callout=ultimate.name+' · 光る呪紙から順に爆発'
    } else {
      this.callout=ultimate.name+' · 大爆破の円から離れろ'
      this.monster.animate('paperFinal',dt,clamp((time-ultimate.finalAt+ultimate.finalTell)/ultimate.finalTell,0,1))
    }
    for(const [i,zone] of pattern.lanes.entries()) {
      const bit=1<<i
      if(this.elapsed+1e-7<zone.at || this.events&bit) continue
      this.events|=bit
      this.visuals.blast(zone,this.elapsed)
      if(i%6<4) this.fx.sound('paper-pop',zone.point,.64)
      this.hitZone(zone,'三方向連鎖爆破')
    }
    if(this.elapsed+1e-7<pattern.final.at || this.outcome) return
    this.visuals.blast(pattern.final,this.elapsed,0xff7144)
    this.fx.sound('paper-final',pattern.final.point)
    this.fx.shake=Math.max(this.fx.shake,.15)
    this.hitZone(pattern.final,'爆紙地獄・大爆破',1)
    this.pattern=undefined
    this.enter('UltimateRecovery','疲労 · 3.5秒の反撃チャンス')
  }

  private pickPattern(center:Vector3) {
    const headings=Array.from({length:5},(_,i)=>(this.ultimateRound===2?Math.PI/3:0)+i*Math.PI*2/15)
    this.danger.update(this.elapsed,this.stamps.map(stamp=>plannedPaper(stamp)))
    for(const heading of headings) {
      const pattern=ultimatePattern(this.arena,center,heading,this.patternStart,this.ultimateRound)
      const escape=this.danger.escape(this.readPlayer(),this.elapsed,pattern.lanes,center,this.monster.data.radius)
      if(escape) { this.debugPath=escape; return pattern }
    }
    // Fixed lanes converge at the center. The player has a new warning window before any lane fires.
    this.patternStart+=.75
    return ultimatePattern(this.arena,center,headings[0],this.patternStart,this.ultimateRound)
  }

  private place(stamp:CursePaper) {
    if(this.stamps.length>=paper.max) return
    this.stamps.push(stamp)
    this.visuals.emit(stamp.point,this.elapsed,paperColor,6,2.4)
    if(!stamp.immediate && !stamp.ultimate) this.fx.sound('paper-stamp',stamp.point,.57)
  }

  private updatePaper() {
    for(let i=this.stamps.length-1;i>=0 && !this.outcome;i--) {
      const stamp=this.stamps[i]
      const left=stamp.at-this.elapsed
      if(left<=1e-7) {
        const zone=plannedPaper(stamp)
        this.visuals.blast(zone,this.elapsed,stamp.immediate?0xff452d:0xff8953)
        this.fx.sound('paper-pop',stamp.point,stamp.immediate?.93:.77)
        this.hitZone(zone,stamp.ultimate?'爆紙地獄・残留爆破':stamp.immediate?'怒り呪紙爆発':'呪紙の時間差爆発',stamp.immediate?tactics.rageDamage:1)
        this.touched.delete(stamp)
        this.stamps.splice(i,1)
        continue
      }
      if(!stamp.warned && left<=paper.red) {
        stamp.warned=true
        if(!stamp.immediate) this.fx.sound('paper-warning',stamp.point)
      }
      if(stamp.immediate || this.attachedUntil>0 || this.elapsed<this.attachCooldown || this.playerCollisionImmune || this.touched.has(stamp)) continue
      if(distance2(this.p,stamp.point)>paper.contact**2) continue
      this.touched.add(stamp)
      this.attachedUntil=this.elapsed+paper.attachedTime
      this.removes=0
      this.fx.sound('paper-stick',this.p)
    }
    if(this.attachedUntil>0 && this.elapsed>=this.attachedUntil && !this.outcome) {
      this.attachedUntil=0
      this.attachCooldown=this.elapsed+.3
      this.paperSource.copy(this.p).addScaledVector(forward(this.playerYaw,this.faceDirection),.25)
      this.visuals.blast(circle(this.p,1.05,this.elapsed,this.elapsed,0,0,'blast'),this.elapsed)
      this.fx.sound('paper-pop',this.p)
      this.damagePlayer({damage:this.weapon.hp*paper.attachedDamage,knockdown:false},this.paperSource,1,1,'status-expiry','付着した呪紙')
    }
    for(const [strike,expiry] of this.spent) if(this.elapsed>expiry) this.spent.delete(strike)
  }

  private hitZone(zone:Zone,label:string,multiplier=this.attackDamageMultiplier) {
    if(this.outcome || this.spent.has(zone.strike) || !contains(zone,this.p.x,this.p.z)) return
    this.spent.set(zone.strike,this.elapsed+ultimate.finalAt)
    this.damagePlayer({damage:zone.damage*this.weapon.hp/100,knockdown:zone.knockdown??false},zone.point,
      multiplier,1,undefined,label)
  }

  private refreshDebug() {
    if(!this.debug) return
    this.debugZones=this.debugDanger?.diagnostic(.75)??[]
    const habit=Object.entries(this.history.habits).map(([name,v])=>name+' '+v.toFixed(2)).join(' / ')
    const score=this.debugScores.map(x=>`${x.id.padEnd(7)} ${x.score.toFixed(2)}  ${x.reason}`).join('\n')
    const cooldown=attackIds.map(id=>id+' '+Math.max(0,(this.readyAt.get(id)??0)-this.elapsed).toFixed(1)).join(' / ')
    const fuses=this.stamps.map(x=>`${(x.at-this.elapsed).toFixed(2)}s@(${x.point.x.toFixed(1)},${x.point.z.toFixed(1)})`).join(' ')
    this.debug.textContent=`${this.state} · ${this.mode} · combo ${this.chainCount} · ${Math.round(1/this.debugFrame)} FPS · AI ${this.debugTime.toFixed(2)}ms\n${this.selection}\n${score}\nCLK ${cooldown}\n傾向 ${habit}\n呪紙 ${fuses||'—'}\n紫 0.75秒先の危険 · 水色 回避経路`
  }
}
