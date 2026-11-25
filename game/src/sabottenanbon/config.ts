import type { MonsterData } from '../config'
import events from './attack_events.json'

const maxHp=1000, enrageHp=550

export const sabottenanbon: MonsterData = {
  id: events.monster.id, name: events.monster.name, model: 'models/sabottenanbon/model_animated.glb',
  hp: maxHp, speed: 2.3, power: 1, scale: 1, yawOffset: 0, footOffset: .033, radius: .55,
  parts: [
    { name: '頭', bone: 'head', offset: [0,.17,.06], radius: .42, multiplier: 1.35, stagger: 1.35 },
    { name: '胴', bone: 'spine_01', offset: [0,.15,0], radius: .54, multiplier: 1, stagger: 1 },
    { name: '左枝', bone: 'branch_L_02', offset: [.08,.12,0], radius: .35, multiplier: 1, stagger: 1 },
    { name: '右枝', bone: 'branch_R_02', offset: [-.10,.12,0], radius: .35, multiplier: 1, stagger: 1 },
  ],
  ai: {wake:22,turnSpeed:4.2,stagger:175,topple:320,enabledAttacks:[]},
  rage: {hpRatio:enrageHp/maxHp,speed:1.15,tempo:1,chainDelay:0},
  motions:{
    idle:{clip:'idle'},walk:{clip:'walk'},run:{clip:'run'},turn:{clip:'turn_left'},turnRight:{clip:'turn_right'},
    roar:{clip:'roar'},enrage:{clip:'enrage'},hit:{clip:'hit_light'},stagger:{clip:'stagger'},
    fall:{clip:'knockdown'},getUp:{clip:'get_up'},defeat:{clip:'death'},
    attack_01:{clip:'attack_01'},attack_05:{clip:'attack_05'},special_01:{clip:'special_01'},
  },
}

export type SabotAttack = 'attack_01' | 'attack_05' | 'special_01'
export const combat = {
  // This absolute threshold stays explicit when max HP is rebalanced.
  enrageHp,
  retreatSpeed: .82,
  rageApproachDistance: 3.9,
  thorn: {direct:10, blast:16},
  attacks: {
    attack_01: {min:1.5,max:5.5,angle:1.0,cooldown:3,aimUntil:.96,breath:0,detonation:0},
    attack_05: {min:2,max:4.5,angle:.58,cooldown:7,aimUntil:2.356,breath:9,detonation:0},
    special_01:{min:1.1,max:5.5,angle:1.1,cooldown:18,aimUntil:1.5,breath:11,detonation:30},
  } satisfies Record<SabotAttack,{min:number;max:number;angle:number;cooldown:number;aimUntil:number;breath:number;detonation:number}>,
}
