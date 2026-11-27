import type { MonsterData, Motion } from '../config'

export const ravenMotions = {
  idle: {clip:'Idle'}, walk: {clip:'Walk'}, turn: {clip:'TurnLeft'}, turnRight: {clip:'TurnRight'},
  ravenArms: {clip:'ArmCombo'}, ravenArmsRage: {clip:'ArmComboRage'}, spin: {clip:'WingSpin'},
  ravenLaser: {clip:'EyeLaser'}, ravenFeathers: {clip:'FeatherShot'}, rush: {clip:'Charge'},
  ravenMarks: {clip:'EyeMark'}, special: {clip:'Ultimate'}, enrage: {clip:'Rage'},
  hit: {clip:'Hit'}, defeat: {clip:'Death'},
} satisfies Partial<Record<Motion, {clip:string}>>

export const raven: MonsterData = {
  metallic: true,
  id:'terracular-raven', name:'テラキュラーレイヴン', model:'models/raven/raven.glb',
  hp:2400, speed:3, power:1, scale:.66, footOffset:.03, yawOffset:0, radius:1.02,
  rigidMeshes:true, groundRigid:true,
  parts:[
    {name:'胴',bone:'Hull',offset:[0,-1.55,-.12],radius:1.37,multiplier:1.26,stagger:1},
    {name:'上胴',bone:'Hull',offset:[0,.04,-.22],radius:1.43,multiplier:1.29,stagger:1},
    {name:'顔',bone:'Portrait',offset:[0,.55,.19],radius:.64,multiplier:1.34,stagger:1},
    {name:'左眼装甲',bone:'ShieldL',offset:[-.30,-1.45,.49],radius:.84,multiplier:1.16,stagger:1},
    {name:'右眼装甲',bone:'ShieldR',offset:[.30,-1.45,.49],radius:.84,multiplier:1.16,stagger:1},
    {name:'左眼装甲',bone:'ShieldL',offset:[-.33,.57,.50],radius:.85,multiplier:1.16,stagger:1},
    {name:'右眼装甲',bone:'ShieldR',offset:[.33,.57,.50],radius:.85,multiplier:1.16,stagger:1},
    {name:'左腕',bone:'ArmL',offset:[-1.08,-1.65,.70],radius:.86,multiplier:1.25,stagger:1},
    {name:'右腕',bone:'ArmR',offset:[1.04,-1.65,.70],radius:.86,multiplier:1.25,stagger:1},
    {name:'左支持脚',bone:'SupportL',offset:[-1.3,.12,-.55],radius:1.16,multiplier:1.29,stagger:1},
    {name:'右支持脚',bone:'SupportR',offset:[1.3,.12,-.55],radius:1.16,multiplier:1.29,stagger:1},
    {name:'黒翼',bone:'Wing',offset:[1.95,-.76,.39],radius:1.12,multiplier:1.26,stagger:1},
  ],
  ai:{wake:24,turnSpeed:3.35,stagger:150,topple:300,enabledAttacks:[]},
  motions:ravenMotions, rage:{hpRatio:.4,speed:1.25,tempo:1.25,chainDelay:0},
}

export const baseDamage = 20
export const ragePower = 1.3
export const rageDuration = 1.12
export const decisionDelay = .54
export const attacks = {
  arms: {name:'双腕連撃',hint:'両腕の間合いから離れろ',motion:'ravenArms',windup:.72,active:.50,recovery:.8,cooldown:2.8,range:3,multiplier:.7},
  spin: {name:'黒翼回転斬り',hint:'翼が開いたら円の外へ',motion:'spin',windup:.8,active:.6,recovery:1,cooldown:5.3,range:4.5,multiplier:1.2},
  laser: {name:'双眼焼却光線',hint:'赤紫の射線から横へ',motion:'ravenLaser',windup:1,active:1.8,recovery:1.5,cooldown:6,range:18,multiplier:.9},
  feathers: {name:'黒羽散弾',hint:'羽の隙間を抜けろ',motion:'ravenFeathers',windup:.7,active:.24,recovery:.7,cooldown:4.5,range:20,multiplier:.6},
  charge: {name:'装甲突進',hint:'直線から横へ',motion:'rush',windup:.9,active:1,recovery:1.6,cooldown:5,range:12,multiplier:1.6},
  marks: {name:'邪眼刻印',hint:'光る刻印から歩いて出ろ',motion:'ravenMarks',windup:.64,active:2,recovery:.8,cooldown:6,range:1.8,multiplier:.85},
  ultimate: {name:'千眼黒翼陣',hint:'射線を外し、最後に本体から離れろ',motion:'special',windup:1.5,active:5.55,recovery:3,cooldown:45,range:6,multiplier:1.8},
} as const satisfies Record<string,{name:string;hint:string;motion:Motion;windup:number;active:number;recovery:number;cooldown:number;range:number;multiplier:number}>
export type RavenAttack = keyof typeof attacks
export type NormalAttack = Exclude<RavenAttack,'ultimate'>
export const normalWeights: ReadonlyArray<ReadonlyArray<readonly [NormalAttack,number]>> = [
  [['arms',50],['spin',30],['charge',10],['marks',10]],
  [['laser',30],['feathers',30],['charge',25],['marks',15]],
  [['marks',35],['charge',30],['laser',25],['feathers',10]],
]
export const feather = {speed:14,range:20,angle:Math.PI*2/3,radius:.14}
export const laser = {width:.65,sweep:.36,tick:.58}
export const circle = {count:8,radius:10,interval:.45,warning:.75,beamTime:.15,featherTime:4.25,shockTime:5.55}
