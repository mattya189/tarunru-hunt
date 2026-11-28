import type { MonsterData, Motion } from '../config'

export const motions = {
  idle: 'Idle', walk: 'Slither', run: 'FastSlither', turn: 'TurnLeft', turnRight: 'TurnRight',
  paperStrafe: 'Strafe', paperBack: 'Back', paperHead: 'Headbutt', paperDouble: 'DoubleSlam', paperDoubleRight:'DoubleSlamRight',
  paperSlide: 'Serpentine', paperSweep: 'Sweep', paperJump: 'Jump', paperAir: 'Airborne',
  paperLand: 'Landing', paperSpin: 'Uncoil', paperChain: 'ChainSlam', paperScatter: 'Scatter',
  paperFinal: 'FinalSlam', paperRest: 'Fatigue', paperRecover: 'Recover',
  enrage: 'Rage', hit: 'Hit', stagger: 'Stagger', defeat: 'Death',
} satisfies Partial<Record<Motion,string>>

const body = (joint:number, radius:number):MonsterData['parts'][number] =>
  ({name:'胴体',bone:'Paper'+joint,offset:[0,0,0],radius,multiplier:1,stagger:1})
export const kouper: MonsterData = {
  id:'kouper-toiper', name:'コウパートイパー', fieldId:'FIELD_002',
  model:'models/kouper/kouper.glb', meshopt:true, rigidMeshes:true,
  hp:3120, speed:4, power:1, scale:1, footOffset:.065, yawOffset:0, radius:.98,
  reticle:{anchor:'first-part',offsetY:.65,icon:'kouper-toiper'},
  parts:[
    {name:'頭部',bone:'Paper0',offset:[0,-.22,0],radius:.78,multiplier:1.25,stagger:1.15},
    body(2,.68), body(3,.60), body(4,.60), body(5,.64), body(6,.57),
  ],
  motions:Object.fromEntries(Object.entries(motions).map(([id,clip])=>[id,{clip}])),
  ai:{wake:22,turnSpeed:6.2,stagger:180,topple:340,enabledAttacks:[]},
  rage:{hpRatio:.5,speed:1.25,tempo:1.2,chainDelay:0},
}

export const tactics = {
  observe:.1, rethink:.25, lookAhead:.4, history:15, adaptation:.25,
  minSamples:4, reaction:.23, grid:.75, timeSlice:.15, horizon:3,
  wait:[.3,.7], rageWait:[.15,.4], combo:[2,3], lockLead:.25,
  rageDamage:1.3, rageRecovery:.8, minWindup:.49, tightRange:3.2, farRange:8,
} as const

export const paper = {
  max:12, fuse:2.5, radius:2.5, contact:.53, yellow:1, red:.30,
  rageFuse:.085, rageRadius:3.5, damage:18, attachedTime:6,
  attachedDamage:.25, dodgeCount:2,
} as const

export const ultimate = {
  name:'爆紙地獄', thresholds:[.5,.2], approach:1.85, charge:1.0, scatter:1.0,
  laneStart:2.25, laneGap:.17, laneRadius:1.65, laneDamage:23,
  residualStart:3.45, residualGap:.23, finalAt:6.8, finalTell:1.75,
  finalRadius:7.7, finalDamage:55, fatigue:3.5, rings:[5.5,9.4], perRing:6,
} as const

export const attacks = {
  head:   { name:'踏み込み頭突き', hint:'斜め前か横へ', motion:'paperHead', windup:.55, active:.34, recovery:.85, damage:22, cooldown:2.6, min:2.0, ideal:5.2, max:7.2, travel:5, radius:1.30, terminal:false },
  double: { name:'左右連続叩きつけ', hint:'二撃とも側面へ', motion:'paperDouble', windup:.60, active:.60, recovery:1.30, damage:18, cooldown:4.1, min:1.3, ideal:3.2, max:5.2, travel:0, radius:1.65, terminal:false },
  slide:  { name:'蛇行滑走', hint:'予告の帯を横に抜けろ', motion:'paperSlide', windup:.70, active:.95, recovery:1.20, damage:25, cooldown:6.7, min:4.6, ideal:8, max:13.1, travel:12, radius:1.55, terminal:false },
  sweep:  { name:'横薙ぎ頭部打撃', hint:'背中側へ回れ', motion:'paperSweep', windup:.65, active:.38, recovery:.90, damage:24, cooldown:4.2, min:1.3, ideal:3.3, max:5.35, travel:0, radius:5, terminal:true },
  leap:   { name:'飛び込み粉砕', hint:'着地円から横へ', motion:'paperJump', windup:.90, active:.74, recovery:2.00, damage:35, cooldown:7.5, min:3.0, ideal:8.4, max:13.5, travel:10, radius:4, terminal:true },
  spin:   { name:'胴体大旋回', hint:'円の外へ。間に合わなければガード', motion:'paperSpin', windup:.85, active:.47, recovery:1.20, damage:28, cooldown:6.2, min:0, ideal:2.25, max:5.6, travel:0, radius:5.5, terminal:true },
  chain:  { name:'直線連鎖爆破', hint:'前方の爆発列を横に抜けろ', motion:'paperChain', windup:.80, active:1.10, recovery:1.60, damage:32, cooldown:6.4, min:2, ideal:8.6, max:14.3, travel:0, radius:1.62, terminal:true },
} as const
export type PaperAttack = keyof typeof attacks
export const attackIds = Object.keys(attacks) as PaperAttack[]
export const chains: Partial<Record<PaperAttack,readonly PaperAttack[]>> = {
  head:['sweep','spin'], double:['head'], slide:['leap'],
}
export const secondSlamGap = .45
export const chainGap = .15
export const chainLength = 14
export const chainCount = 7
