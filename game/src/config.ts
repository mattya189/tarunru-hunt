export type Motion = 'emperorFang' | 'emperorCutoff' | 'emperorComboFirst' | 'emperorComboSecond' | 'emperorComboLast' | 'emperorRest' | 'fireShot' | 'featherDrop' | 'fireBreath' | 'ultimateCharge' | 'kouenchoRecovery' | 'ravenArms' | 'ravenArmsRage' | 'ravenLaser' | 'ravenFeathers' | 'ravenMarks' | 'kogobonJumpCharge' | 'kogobonJump' | 'kogobonScreamCharge' | 'kogobonScream' | 'kogobonSlamCharge' | 'kogobonSlam' | 'kogobonRecovery' | 'kogobonExhausted' | 'shikoukiPierce' | 'shikoukiBarrage' | 'shikoukiTakeoff' | 'shikoukiHover' | 'shikoukiBerserk' | 'beamPrep' | 'beamFire' | 'beamRecover' | 'spinRecover' | 'tornadoPrep' | 'tornadoRelease' | 'tornadoRecover' | 'summon' | 'barrierIdle' | 'barrierBreak' | 'downLoop' | 'rageIdle' | 'attack_01' | 'attack_05' | 'special_01' | 'enrage' | 'getUp' | 'turnRight' | 'leapPrep' | 'spinPrep' | 'idle' | 'walk' | 'run' | 'turn' | 'roar' | 'swipe' | 'rush' | 'spin' | 'leap' | 'special' | 'hit' | 'stagger' | 'fall' | 'defeat'
export type AttackId = 'swipe' | 'rush' | 'spin' | 'leap' | 'special'
export interface Attack {
  id: AttackId
  label: string
  tells: string
  damage: number
  windup: number
  active: number
  recovery: number
  range: number
  cooldown: number
  knockdown: boolean
}
// Root pitch, yaw, roll and lift, followed by left arm, right arm and leg swing.
export type MonsterPose = readonly [number, number, number, number, number, number, number]
export interface MonsterData {
  id: string
  name: string
  model: string
  hp: number
  speed: number
  power: number
  scale: number
  yawOffset: number
  footOffset: number
  radius: number
  parts: { name: string; bone: string; offset: [number, number, number]; radius: number; multiplier: number; stagger: number }[]
  attacks?: Record<AttackId, Attack>
  ai: { wake: number; turnSpeed: number; stagger: number; topple: number; enabledAttacks: AttackId[] }
  motions: Partial<Record<Motion, { clip: string; speed?: number }>>
  extraPoses?: Partial<Record<Motion, readonly MonsterPose[]>>
  reticle?: { anchor?: 'root' | 'first-part'; offsetY?: number; size?: number; icon?: string }
  metallic?: boolean
  meshopt?: boolean
  emitters?: readonly string[]
  rigidMeshes?: boolean
  groundRigid?: boolean
  rig?: Record<'root' | 'head' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg', string>
  rage: { hpRatio: number; speed: number; tempo: number; chainDelay: number }
}
export const tidebeast: MonsterData = {
  id: 'monster001', name: 'タルンルソルク', model: 'models/monster001_v4.glb', hp: 1160,
  speed: 2.65, power: 1, scale: 1.36, yawOffset: 0, footOffset: -.026, radius: 1.04,
  reticle: { anchor: 'root', offsetY: 3.22 * 1.36 },
  parts: [
    { name: '頭', bone: 'Head', offset: [0, .26, .45], radius: .72, multiplier: 1.42, stagger: 1.45 },
    { name: '左腕', bone: 'ArmL', offset: [-.34, -.22, .02], radius: .58, multiplier: 1.08, stagger: 1 },
    { name: '右腕', bone: 'ArmR', offset: [.34, -.22, .02], radius: .58, multiplier: 1.08, stagger: 1 },
    { name: '左脚', bone: 'LegL', offset: [-.04, -.31, .02], radius: .47, multiplier: .8, stagger: 1.7 },
    { name: '右脚', bone: 'LegR', offset: [.04, -.31, .02], radius: .47, multiplier: .8, stagger: 1.7 },
    { name: '胴', bone: 'Root', offset: [0, .08, 0], radius: .99, multiplier: 1, stagger: 1 },
  ],
  attacks: {
    swipe: { id: 'swipe', label: '腕薙ぎ', tells: '片腕を引いた', damage: 17, windup: .65, active: .28, recovery: .7, range: 3.35, cooldown: 2, knockdown: false },
    rush: { id: 'rush', label: '突進', tells: '身を屈めた', damage: 29, windup: .95, active: .8, recovery: 1, range: 1.85, cooldown: 6, knockdown: true },
    spin: { id: 'spin', label: '回転攻撃', tells: '身体を捻った', damage: 22, windup: .78, active: .62, recovery: .87, range: 3.65, cooldown: 5, knockdown: false },
    leap: { id: 'leap', label: '跳躍プレス', tells: '着地点から離れろ', damage: 33, windup: .88, active: .91, recovery: 1.22, range: 3.3, cooldown: 8, knockdown: true },
    special: { id: 'special', label: '潮鳴り震波', tells: '波の隙間を抜けろ', damage: 39, windup: 1.5, active: 1.64, recovery: 1.55, range: 13, cooldown: 14, knockdown: true },
  },
  ai: { wake: 22, turnSpeed: 4.2, stagger: 155, topple: 300, enabledAttacks: ['swipe','rush','spin','leap','special'] },
  motions: { idle: { clip: 'Idle' }, walk: { clip: 'Run', speed: .61 }, run: { clip: 'Run' }, roar: { clip: 'Roar' }, swipe: { clip: 'Attack' }, rush: { clip: 'Run', speed: 1.6 }, spin: { clip: 'Spin' }, leap: { clip: 'Jump' }, defeat: { clip: 'Defeat' } },
  rig: { root: 'Root', head: 'Head', leftArm: 'ArmL', rightArm: 'ArmR', leftLeg: 'LegL', rightLeg: 'LegR' },
  rage: { hpRatio: .52, speed: 1.24, tempo: 1.21, chainDelay: .19 },
}
export interface WeaponStrike { windup: number; active: number; recovery: number; damage: number; lunge: number }
export interface WeaponData {
  name: string
  hp: number
  stamina: number
  walk: number
  roll: number
  swings: [WeaponStrike, WeaponStrike, WeaponStrike]
  charge: WeaponStrike
}
export interface FieldData {
  name: string
  radius: number
  playerSpawn: readonly [number, number]
  monsterSpawn: readonly [number, number]
}
export const greatsword: WeaponData = {
  name: '大剣', hp: 130, stamina: 100, walk: 6.35, roll: 9,
  swings: [
    { windup: .23, active: .19, recovery: .26, damage: 46, lunge: 2.9 },
    { windup: .22, active: .2, recovery: .29, damage: 55, lunge: 3.3 },
    { windup: .36, active: .23, recovery: .46, damage: 77, lunge: 3.6 },
  ],
  charge: { windup: .18, active: .26, recovery: .56, damage: 63, lunge: 4.4 },
}
export const coast: FieldData = { name: '夕凪の石浜', radius: 24, playerSpawn: [0, 8], monsterSpawn: [0, -2] }
