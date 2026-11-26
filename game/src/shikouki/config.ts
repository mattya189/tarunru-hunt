import type { MonsterData, Motion } from '../config'

export const shikouki: MonsterData = {
  id: 'shikouki', name: '紫煌機', model: 'models/shikouki/model.glb',
  hp: 5000, speed: 3.5, power: .43, scale: 1.12, yawOffset: 0, footOffset: .03, radius: 1.28,
  parts: [
    { name: '頭', bone: 'head', offset: [0,.09,.15], radius: .58, multiplier: 1.22, stagger: 1.25 },
    { name: '胸部', bone: 'core', offset: [0,0,.14], radius: .95, multiplier: 1, stagger: 1 },
    { name: '左前脚', bone: 'leg_1_1knee', offset: [0,-.25,0], radius: .52, multiplier: .90, stagger: 1.15 },
    { name: '右前脚', bone: 'leg_-1_1knee', offset: [0,-.25,0], radius: .52, multiplier: .90, stagger: 1.15 },
    { name: '胴', bone: 'torso', offset: [0,.39,-.12], radius: 1.14, multiplier: 1, stagger: 1 },
  ],
  rigidMeshes: true,
  ai: { wake: 24, turnSpeed: 7.2, stagger: 220, topple: 410, enabledAttacks: [] },
  motions: {
    idle: { clip: 'idle' }, walk: { clip: 'walk' },
    hit: { clip: 'hit' }, stagger: { clip: 'hit' }, fall: { clip: 'down' }, defeat: { clip: 'death' },
    swipe: { clip: 'slash_horizontal' }, shikoukiPierce: { clip: 'leg_pierce' },
    rush: { clip: 'charge' }, spin: { clip: 'wing_spin' }, shikoukiBarrage: { clip: 'wing_barrage' },
    summon: { clip: 'crystal_summon' }, beamFire: { clip: 'beam' },
    shikoukiTakeoff: { clip: 'takeoff' }, shikoukiHover: { clip: 'hover' }, leap: { clip: 'dive' },
    special: { clip: 'ultimate' }, enrage: { clip: 'enrage' }, shikoukiBerserk: { clip: 'berserk' },
  },
  rage: { hpRatio: .60, speed: 1.3, tempo: 1.25, chainDelay: .20 },
}

export const phases = [
  { name: '通常', threshold: 1, move: 1, speed: 1, power: 1, recovery: 1, bullets: 24 },
  { name: '怒り', threshold: shikouki.rage.hpRatio, move: 1.3, speed: 1.25, power: 1, recovery: 1, bullets: 36 },
  { name: '暴走', threshold: .25, move: 1.6, speed: 1.5, power: 1.3, recovery: .6, bullets: 36 },
]

export const damageScale = {
  crystal: 6,
  melee: 7,
  heavy: 8,
  ultimateImpact: 9,
} as const

export const crystal = { hp: 95, life: 13, limit: 48 }

export const moves = {
  slash_horizontal: { label: '水平斬撃', clip: 1.2, cooldown: 3.2, recovery: 1.04, motion: 'swipe' },
  leg_pierce: { label: '連続穿刺', clip: 2.4, cooldown: 6, recovery: 1.02, motion: 'shikoukiPierce' },
  charge: { label: '四脚突進', clip: 1.5, cooldown: 7, recovery: 1.24, motion: 'rush' },
  wing_spin: { label: '翼回転斬撃', clip: 1.5, cooldown: 8, recovery: 1.22, motion: 'spin' },
  wing_barrage: { label: '結晶弾幕', clip: 2, cooldown: 9, recovery: 1.10, motion: 'shikoukiBarrage' },
  crystal_summon: { label: '結晶生成', clip: 2, cooldown: 14, recovery: .96, motion: 'summon' },
  beam: { label: '紫煌光線', clip: 2.5, cooldown: 11, recovery: 1.34, motion: 'beamFire' },
  dive: { label: '飛翔急降下', clip: 3.6, cooldown: 16, recovery: 1.38, motion: 'shikoukiTakeoff' },
  ultimate: { label: '紫煌天獄', clip: 12, cooldown: Infinity, recovery: 1.5, motion: 'special' },
} satisfies Record<string,{ label: string; clip: number; cooldown: number; recovery: number; motion: Motion }>

export type MoveId = keyof typeof moves
