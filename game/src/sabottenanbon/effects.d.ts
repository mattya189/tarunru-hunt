import type { Group, Object3D, Plane, Vector3 } from 'three'
import type { Quality } from '../ui'
import type { AttackTimeline, Breath, BreathFrame, BreathReader, Shot, SocketReader } from './timeline-types'
export function sampleBreath(event: Breath, time: number, readSocket: SocketReader, planes: Plane[], fullLength?: boolean): BreathFrame
export function pointInBreath(point: Vector3, frame: BreathFrame): boolean
export class AttackEffects {
  constructor(options: {scene: Object3D; thornModel: Group; objects: object; config: object; events: object; quality:Quality; breathReader:BreathReader})
  glow:number
  layer:Group
  breathGroup:Group
  setQuality(quality:Quality):void
  present(attack: AttackTimeline|undefined, time: number, readSocket:SocketReader, shots:Shot[], shotTime:number): void
}
