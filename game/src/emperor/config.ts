import { tidebeast, type MonsterData, type Motion } from '../config'

const base = tidebeast.attacks!

export const emperor: MonsterData = {
  ...tidebeast,
  id: 'tarunru-emperor',
  name: 'タルンルソルクエンペラー',
  hp: 1450,
  speed: 3.7,
  attacks: {
    swipe: { ...base.swipe, damage: 45, windup: .51, recovery: .52, cooldown: 1.5 },
    rush: { ...base.rush, damage: 49, windup: .76, recovery: .74, cooldown: 4.9 },
    spin: { ...base.spin, damage: 46, windup: .64, recovery: .58, cooldown: 3.9 },
    leap: { ...base.leap, damage: 70, windup: .78, recovery: 1.18, cooldown: 6.7 },
    special: { ...base.special, damage: 72, windup: 1.19, recovery: 1.29, cooldown: 11.5 },
  },
  ai: { ...tidebeast.ai, turnSpeed: 5.4, stagger: 290, topple: 465 },
  rage: { hpRatio: .5, speed: 1.12, tempo: 1.13, chainDelay: .26 },
  extraPoses: {
    emperorFang: [
      [0, 0, 0, 0, 0, 0, 0],
      [.12, .40, -.18, -.08, -.22, .58, -.20],
      [.22, .87, -.31, -.18, -.53, .95, -.32],
      [.18, .69, -.22, -.15, -.44, .80, -.26],
      [.32, -.94, .30, -.08, -1.28, -.36, .43],
      [.16, -.51, .20, -.04, -.65, -.15, .18],
    ],
    emperorCutoff: [
      [0, 0, 0, 0, 0, 0, 0],
      [.25, -.27, .11, -.15, .42, -.45, .29],
      [-.33, -.17, .06, .12, -.86, -1.22, .32],
      [-.41, -.04, 0, .14, -1.05, -1.35, .28],
      [.62, .05, -.06, -.25, .14, .51, -.39],
      [.35, 0, 0, -.13, .03, .22, -.10],
    ],
    emperorComboFirst: [
      [.13, .13, 0, -.06, .18, -.26, -.18],
      [.12, -.24, .17, -.09, -.42, .18, -.21],
      [.22, -.54, .21, -.14, -.71, .46, -.32],
      [.22, -.61, .27, -.14, -.75, .52, -.35],
      [.36, .74, -.30, -.20, .57, -1.26, .39],
      [.28, .45, -.19, -.17, .17, -.70, .31],
    ],
    emperorComboSecond: [
      [.28, .45, -.19, -.17, .17, -.70, .31],
      [.19, .58, -.17, -.21, .62, -.34, .39],
      [.14, .78, -.22, -.25, .92, -.18, .46],
      [.15, .87, -.24, -.27, 1.07, -.14, .50],
      [.29, -.76, .25, -.16, -1.30, .23, -.35],
      [.16, -.35, .13, -.08, -.68, .16, -.25],
    ],
    emperorComboLast: [
      [.16, -.35, .13, -.08, -.68, .16, -.25],
      [-.22, -.15, .05, .07, -.92, -.92, -.27],
      [-.48, .02, 0, .17, -1.50, -1.46, -.36],
      [-.43, 0, 0, .18, -1.58, -1.55, -.31],
      [.76, 0, 0, -.28, .48, .50, .49],
      [.51, 0, 0, -.22, .26, .28, .38],
    ],
    emperorRest: [
      [.51, 0, 0, -.22, .26, .28, .38],
      [.47, 0, 0, -.19, .23, .25, .32],
      [.41, 0, 0, -.14, .20, .20, .24],
      [.22, 0, 0, -.08, .14, .12, .11],
      [0, 0, 0, 0, 0, 0, 0],
    ],
  },
}

export interface EmperorStrike {
  motion: Motion
  windup: number
  active: number
  damageRatio: number
  knockdown?: boolean
  warning: string
  hitbox: { kind: 'arc'; range: number; halfAngle: number } | { kind: 'band'; halfLength: number; halfWidth: number }
}

interface EmperorMove {
  label: string
  strikes: readonly EmperorStrike[]
  recovery: number
  cooldown: number
}

export const emperorMoves = {
  fang: {
    label: '返し牙', recovery: .65, cooldown: 4.4,
    strikes: [{
      motion: 'emperorFang', windup: .47, active: .23, damageRatio: .36,
      warning: '半身をひねった · 追撃に備えろ',
      hitbox: { kind: 'arc', range: 4.35, halfAngle: 1.23 },
    }],
  },
  cutoff: {
    label: '退路狩り', recovery: .76, cooldown: 5.5,
    strikes: [{
      motion: 'emperorCutoff', windup: .58, active: .24, damageRatio: .38,
      warning: '後ろに衝撃波 · 横か斜め前へ',
      hitbox: { kind: 'band', halfLength: 4.5, halfWidth: 1.42 },
    }],
  },
  combo: {
    label: '皇圧三連', recovery: 1.2, cooldown: 9,
    strikes: [
      {
        motion: 'emperorComboFirst', windup: .40, active: .17, damageRatio: .34,
        warning: '一撃目 · 素早い薙ぎ払い',
        hitbox: { kind: 'arc', range: 4.7, halfAngle: 1.09 },
      },
      {
        motion: 'emperorComboSecond', windup: .81, active: .17, damageRatio: .36,
        warning: '二撃目 · 溜めを見て回避',
        hitbox: { kind: 'arc', range: 5.35, halfAngle: 1.26 },
      },
      {
        motion: 'emperorComboLast', windup: .65, active: .27, damageRatio: .55, knockdown: true,
        warning: '三撃目 · 正面から横へ',
        hitbox: { kind: 'arc', range: 6.5, halfAngle: .66 },
      },
    ],
  },
} satisfies Record<string, EmperorMove>

export type EmperorMoveId = keyof typeof emperorMoves
