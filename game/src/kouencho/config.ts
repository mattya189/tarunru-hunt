import type { MonsterData, Motion } from '../config'

export const fireColor = 0xff541c
export const normalAttacks = ['shot', 'dive', 'spin', 'feathers', 'breath'] as const
export type FireAttack = typeof normalAttacks[number]
export const fireAttacks = {
  shot: { label: '火炎弾', hint: '横へ移動', motion: 'fireShot', damage: 6, windup: 1.2, active: .54, recovery: 1.5, range: 18, lift: 1.68 },
  dive: { label: '火翼急襲', hint: '突進の横へ', motion: 'rush', damage: 15, windup: 1.5, active: .83, recovery: 2.5, range: 13, lift: .88 },
  spin: { label: '火翼回転', hint: '円の外へ', motion: 'spin', damage: 10, windup: .9, active: .58, recovery: 1.8, range: 3, lift: .57 },
  feathers: { label: '火羽落とし', hint: '着弾点から離れろ', motion: 'featherDrop', damage: 9, windup: 1, active: 1.5, recovery: 2, range: 17, lift: 1.68 },
  breath: { label: '火炎放射', hint: '扇形の横へ', motion: 'fireBreath', damage: 15, windup: 1.3, active: 1.8, recovery: 2, range: 7, lift: .77 },
} satisfies Record<FireAttack, {
  label: string; hint: string; motion: Motion; damage: number; windup: number; active: number; recovery: number; range: number; lift: number
}>

export const weights = [
  [15, 15, 40, 10, 20],
  [30, 25, 10, 20, 15],
  [40, 35, 0, 20, 5],
] as const

export const fireWave = {
  thresholds: [.60, .25],
  windup: 3,
  spin: .8,
  travel: 2,
  recovery: 4,
  halfWidth: .47,
  damage: 25,
} as const

export const featherRadius = 1.5
export const diveHalfWidth = 1.65
export const breathHalfAngle = Math.PI / 6
export const ragePower = 1.10

export const kouencho: MonsterData = {
  id: 'kouencho', name: 'コウエン鳥', model: 'models/kouencho/kouencho.glb',
  hp: 2500, speed: 2.18, power: 1, scale: .66, yawOffset: 0, footOffset: .015, radius: 1.16,
  rigidMeshes: true,
  meshopt: true,
  emitters: ['FireMuzzle', 'FireWingL', 'FireWingR', 'Body'],
  parts: [
    { name: '胴', bone: 'Body', offset: [0, -.17, -.08], radius: 1.20, multiplier: 1.24, stagger: 1 },
    { name: '頭', bone: 'Head', offset: [0, .35, .41], radius: .61, multiplier: 1.34, stagger: 1.15 },
    { name: '左翼', bone: 'PrimaryL', offset: [-.13, -.08, -.46], radius: .69, multiplier: 1.23, stagger: 1 },
    { name: '右翼', bone: 'PrimaryR', offset: [.13, -.08, -.46], radius: .69, multiplier: 1.23, stagger: 1 },
    { name: '左脚', bone: 'FootL', offset: [0, -.46, .17], radius: .52, multiplier: 1.16, stagger: 1 },
    { name: '右脚', bone: 'FootR', offset: [0, -.46, .17], radius: .52, multiplier: 1.16, stagger: 1 },
  ],
  motions: {
    idle: { clip: 'Idle' }, walk: { clip: 'FlyMove' }, fireShot: { clip: 'FireShot' },
    rush: { clip: 'DiveAttack' }, spin: { clip: 'WingSpin' }, featherDrop: { clip: 'FeatherDrop' },
    fireBreath: { clip: 'FireBreath' }, ultimateCharge: { clip: 'UltimateCharge' },
    special: { clip: 'UltimateSpin' }, kouenchoRecovery: { clip: 'Recovery' },
    enrage: { clip: 'Enrage' }, hit: { clip: 'Hit' }, defeat: { clip: 'Death' },
  },
  ai: { wake: 24, turnSpeed: 3.1, stagger: Infinity, topple: Infinity, enabledAttacks: [] },
  rage: { hpRatio: .40, speed: 1.15, tempo: 1.10, chainDelay: 0 },
}
