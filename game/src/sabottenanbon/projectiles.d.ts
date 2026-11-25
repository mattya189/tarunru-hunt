import type { Object3D, Plane, Vector3 } from 'three'
import type { Burst, Shot, SocketReader } from './timeline-types'
export function createSocketReader(monster: Object3D, sockets: Record<string,{node:string;offset:number[];forward:number[]}>): SocketReader
export function projectilePosition(shot: Shot, seconds: number, result?: Vector3): Vector3
export function planBurst(event: Burst, definition: object, readSocket: SocketReader, planes: Plane[], firstIndex?: number,
  resolveContact?: (shot: Shot, duration: number) => {time:number;plane:Plane}|undefined): Shot[]
