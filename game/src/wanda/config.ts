import type { FieldData, MonsterData, Motion } from '../config'

export const summit: FieldData = {
  name: '神の山頂', radius: 18, playerSpawn: [0, 7.5], monsterSpawn: [0, .5], landscape: 'summit',
}

export const wanda: MonsterData = {
  id: 'wanda-butterfly-king', name: 'ワンダ・バタフ・キング',
  model: 'models/wanda/monarch.glb', hp: 3200, speed: 4.8, power: 1, scale: .83,
  yawOffset: 0, footOffset: -4.36, radius: .65, rigidMeshes: true, meshopt: true, flightFloorContact: 6.2,
  emitters: ['Body', 'Crown', 'WingUpperL', 'WingUpperR', 'BladeL', 'BladeR'],
  parts: [{ name: '天翼皇の影', bone: 'Body', offset: [0,0,0], radius: 1.5, multiplier: 1.51, stagger: 0 }],
  reticle: { anchor: 'root', offsetY: .2 },
  motions: {
    idle: { clip: 'Idle' }, walk: { clip: 'FlyForward' }, turn: { clip: 'Turn' },
    wandaBack: { clip: 'FlyBackward' }, wandaLeft: { clip: 'FlyLeft' }, wandaRight: { clip: 'FlyRight' },
    wandaWind: { clip: 'WindBlade' }, wandaCross: { clip: 'CrossSlash' },
    wandaBomb: { clip: 'SkyBombardment' }, wandaPull: { clip: 'GravityPull' },
    wandaWave: { clip: 'TripleShockwave' }, wandaBeam: { clip: 'SweepingBeam' },
    wandaDive: { clip: 'DiveSlash' }, wandaTornado: { clip: 'TrackingTornado' },
    wandaCollapse: { clip: 'Ultimate1' }, wandaJudgment: { clip: 'Ultimate2' },
    enrage: { clip: 'Enrage' }, hit: { clip: 'Hit' }, defeat: { clip: 'Death' },
  },
  ai: { wake: 36, turnSpeed: 4.4, stagger: Infinity, topple: Infinity, enabledAttacks: [] },
  rage: { hpRatio: .4, speed: 1.4, tempo: 1.3, chainDelay: .4 },
}

export const attacks = {
  wind:     { name:'天翼刃', hint:'風刃を横にかわす／ガード', motion:'wandaWind', windup:.70, active:1.10, cooldown:4.5 },
  cross:    { name:'皇刃十字斬', hint:'X字の外へ／ガード', motion:'wandaCross', windup:.94, active:.28, cooldown:6 },
  bomb:     { name:'天空爆撃', hint:'着弾予告から走り続ける', motion:'wandaBomb', windup:.88, active:1.36, cooldown:7 },
  pull:     { name:'重力吸引', hint:'引力に逆らい紫の円の外へ', motion:'wandaPull', windup:.74, active:2.5, cooldown:9 },
  wave:     { name:'三連天空波', hint:'3回、輪が来る瞬間に回避', motion:'wandaWave', windup:.96, active:2.28, cooldown:9 },
  beam:     { name:'天断光線', hint:'光線と床に残る光を避ける', motion:'wandaBeam', windup:1.15, active:2, cooldown:9 },
  dive:     { name:'超高速降下斬撃', hint:'予告された直線の横へ／ガード', motion:'wandaDive', windup:1.08, active:.40, cooldown:7 },
  tornado:  { name:'追跡暴風渦', hint:'足を止めず渦を引き離す', motion:'wandaTornado', windup:.79, active:.38, cooldown:11 },
  collapse: { name:'天空崩壊', hint:'青緑の安全地帯へ', motion:'wandaCollapse', windup:0, active:7, cooldown:0 },
  judgment: { name:'天皇終焉陣', hint:'光線の間を回り、最後は中心から離れる', motion:'wandaJudgment', windup:0, active:8, cooldown:0 },
} satisfies Record<string,{ name:string; hint:string; motion:Motion; windup:number; active:number; cooldown:number }>

export const normal = ['wind','cross','bomb','pull','wave','beam','dive','tornado'] as const
export type NormalAttack = typeof normal[number]
export type WandaAttack = keyof typeof attacks

export const damage = {
  wind:12, cross:32, bomb:22, pull:38, wave:24, beam:36, scorch:9,
  dive:48, tornado:15, collapseBomb:18, collapseFinal:80,
  judgmentBeam:28, judgmentWave:24, judgmentFinal:95,
} as const
