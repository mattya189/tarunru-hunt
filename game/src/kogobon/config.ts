import { greatsword, type MonsterData, type Motion } from '../config'

interface Attack {
  label: string
  hint: string
  charge: Motion
  action: Motion
  windup: number
  duration: number
  impact: number
  recovery: number
  damagePercent: number
  radius: number
  halfAngle: number
  push: number
}

export const attacks = {
  scream: {
    label: '咆哮', hint: '正面をガード、または横へ',
    charge: 'kogobonScreamCharge', action: 'kogobonScream',
    windup: 2.5, duration: 1, impact: .25, recovery: 1.8, damagePercent: 8,
    radius: 6, halfAngle: Math.PI / 3, push: 0,
  },
  slam: {
    label: '叩きつけ', hint: '円の外へ',
    charge: 'kogobonSlamCharge', action: 'kogobonSlam',
    windup: 2, duration: .6, impact: .35, recovery: 2.2, damagePercent: 12,
    radius: 3.1, halfAngle: Math.PI, push: .35,
  },
  jump: {
    label: '跳び込み', hint: '着地点の円から横へ',
    charge: 'kogobonJumpCharge', action: 'kogobonJump',
    windup: 2, duration: .8, impact: .8, recovery: 2.5, damagePercent: 16,
    radius: 2.7, halfAngle: Math.PI, push: .65,
  },
} satisfies Record<string, Attack>

export type KogobonAttack = keyof typeof attacks
export const jumpRange = 10
export const exhaustedTime = 5

export const kogobon: MonsterData = {
  id: 'kogobon', name: 'コウゴボン', model: 'models/kogobon/kogobon.glb',
  hp: greatsword.swings[0].damage * 16, speed: greatsword.walk * .65,
  power: 1, scale: 1.1, yawOffset: 0, footOffset: 0, radius: 1.05,
  parts: [
    { name: '胴', bone: 'elastic_body', offset: [0, .75, -.12], radius: .99, multiplier: 1, stagger: 1 },
    { name: '胴', bone: 'elastic_body', offset: [0, 1.72, -.12], radius: .92, multiplier: 1, stagger: 1 },
  ],
  ai: { wake: jumpRange, turnSpeed: 5.4, stagger: 155, topple: 300, enabledAttacks: [] },
  motions: {
    idle: { clip: 'idle' },
    walk: { clip: 'move' },
    kogobonJumpCharge: { clip: 'jump_charge' },
    kogobonJump: { clip: 'jump_attack' },
    kogobonScreamCharge: { clip: 'scream_charge' },
    kogobonScream: { clip: 'scream_attack' },
    kogobonSlamCharge: { clip: 'slam_charge' },
    kogobonSlam: { clip: 'slam_attack' },
    kogobonRecovery: { clip: 'recovery' },
    kogobonExhausted: { clip: 'exhausted' },
    defeat: { clip: 'death' },
  },
  rage: { hpRatio: 0, speed: 1, tempo: 1, chainDelay: 0 },
}
