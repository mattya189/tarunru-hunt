import type { Plane, Vector3 } from 'three'
import type { SabotAttack } from './config'

export type SocketReader = (id: string) => {position: Vector3; direction: Vector3}
export interface Burst {
  type: 'thorn_burst'
  time: number
  id: string
  object: string
  emitters: string[]
  countPerEmitter: number
  layers?: number
  spreadDegrees: number
  speed: number
  lift: number
  liftVariance?: number
  scale: number
  hit: {radius: number; explosionRadius: number; explosionDuration: number}
  detonateAt?: number
}
export interface Breath {
  type: 'breath'
  time: number
  start: number
  end: number
  fadeEnd: number
  attachment: string
  speed: number
  hit: {range: number; halfAngleDegrees: number; nearRadius: number; tickSeconds: number}
}
export type Event = Burst | Breath |
  {type:'thorn_charge';time:number;end:number;emitters:string[];effect:string} |
  {type:'detonate_thorns'|'motion_end'|'attack_end';time:number}
export interface AttackTimeline { id: SabotAttack; label: string; clip: string; duration: number; events: Event[] }
export interface Shot {
  index: number; launchTime: number; origin: Vector3; velocity: Vector3; acceleration: Vector3;
  scale: number; duration: number; impactTime: number; impactCenter: Vector3; impactNormal: Vector3|null;
  contactPoint: Vector3; detonateTime: number; hit: Burst['hit'];
}
export interface BreathFrame {
  position: Vector3; direction: Vector3; distance: number; slope: number; near: number;
  contact: Plane|null; contactPoint: Vector3|null;
}
export type BreathReader = (event: Breath, time: number, read: SocketReader, full: boolean) => BreathFrame
