import type { MonsterData } from '../config'
import animation from './revotenshi_animation.json'
import effects from './effects.json'

export const revotenshi: MonsterData = {
  id: 'revotenshi', name: 'レボテンシ', model: 'models/revotenshi/revotenshi_animated.glb',
  hp: 1500, speed: 2.8, power: 1, scale: .94, footOffset: 1.88, yawOffset: 0, radius: .93,
  parts: [
    { name: '顎', bone: 'Jaw_Pivot', offset: [0,.11,.22], radius: .78, multiplier: 1.3, stagger: 1.25 },
    { name: '胴', bone: 'world', offset: [0,-.44,-.43], radius: 1.08, multiplier: 1, stagger: 1 },
    { name: '尾', bone: 'Tail_Pivot_1', offset: [0,-.13,-.18], radius: .62, multiplier: .84, stagger: 1.15 },
  ],
  ai: { wake: 23, turnSpeed: 3.8, stagger: 190, topple: 310, enabledAttacks: [] },
  motions: {
    idle: {clip:'Idle'}, walk: {clip:'MoveForward'}, roar: {clip:'Roar'},
    beamPrep: {clip:'BeamWindup'}, beamFire: {clip:'BeamFire'}, beamRecover: {clip:'BeamRecover'},
    spinPrep: {clip:'SpinWindup'}, spin: {clip:'SpinAttack'}, spinRecover: {clip:'SpinRecover'},
    tornadoPrep: {clip:'TornadoWindup'}, tornadoRelease: {clip:'TornadoRelease'}, tornadoRecover: {clip:'TornadoRecover'},
    summon: {clip:'Summon'}, barrierIdle: {clip:'BarrierIdle'}, barrierBreak: {clip:'BarrierBreak'},
    enrage: {clip:'RageEnter'}, rageIdle: {clip:'RageIdle'}, hit: {clip:'HitSmall'}, stagger: {clip:'HitHeavy'},
    fall: {clip:'Fall'}, downLoop: {clip:'DownLoop'}, getUp: {clip:'Recover'}, defeat: {clip:'Death'},
  },
  rage: { hpRatio:.30, speed:1.30, tempo:1, chainDelay:0 },
}

export const combat = {
  ...effects, summonHpRatio:.50, minionHpRatio:.08, minionPower:.65, ragePower:1.25,
  beamWidth:.53, spinRadius:2.85, tornadoRadius:1.1, barrierDown:4, barrierHealPerSecond:3,
  beamDamage:33, spinDamage:26, tornadoDamage:19,
}

export const minion: MonsterData = {
  ...revotenshi, name: 'レボテンシの分身', hp:Math.round(revotenshi.hp*combat.minionHpRatio),
  reticle: { anchor: 'root', offsetY: .96 },
  scale:revotenshi.scale*combat.minionScale, radius:.45,
  parts: revotenshi.parts.map(part=>({...part,radius:part.radius*2.5})),
}

function eventTime(clip: keyof typeof animation.events, name: string) {
  const cue=animation.events[clip].find(entry=>entry.event===name)
  if(!cue) throw new Error(`Missing レボテンシ animation cue: ${clip}/${name}`)
  return cue.time
}

export const cues = {
  tornado:eventTime('TornadoRelease','spawn_tornado'),
  barrier:eventTime('Summon','barrier_on'),
  minions:eventTime('Summon','spawn_minions'),
}

export const variant: MonsterData = {
  ...revotenshi, id: 'revotenshi-variant', name: 'レボテンシ亜種', fieldId: 'FIELD_002', hp: 1220,
  scale: 1.20, radius: 1.16,
  rage: {...revotenshi.rage, hpRatio: .5},
  parts: [
    ...revotenshi.parts.map(part => ({...part, multiplier: 1})),
    ...(['L','R'] as const).map(side => ({
      name: side === 'L' ? '左翼爪' : '右翼爪', bone: 'Wing_'+side+'_Pivot',
      offset: [side === 'L' ? -1.45 : 1.45,.55,.08] as [number,number,number],
      radius: .82, multiplier: 1, stagger: 1,
    })),
  ],
  motions: {...revotenshi.motions, leapPrep: {clip: 'leapPrep'}, sweepLeft: {clip: 'sweepLeft'}, sweepRight: {clip: 'sweepRight'}, tailPrep: {clip: 'tailPrep'}, clawPrep: {clip: 'clawPrep'}, fissurePrep: {clip: 'fissurePrep'}, sweepLeftHit: {clip: 'sweepLeftHit'}, sweepRightHit: {clip: 'sweepRightHit'}, leapHit: {clip: 'leapHit'}, tailHit: {clip: 'tailHit'}, clawHit: {clip: 'clawHit'}, fissureHit: {clip: 'fissureHit'}},
}
