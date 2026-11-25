import type { Group, Object3D, Scene, Vector3 } from 'three'
export function createEffects(scene: Scene, actor: Object3D, config: {
  beamLength: number
  barrierRadius: number
  spinRadius: number
  height: number
}): {
  mouth(out:Vector3):Vector3
  charge():void
  beam():void
  spin():void
  tornado(position:Vector3):Group
  barrier():void
  summon(positions:Vector3[]):void
  rage():void
  burst(position:Vector3, color?:number):void
  stop(tag:string):void
  breakBarrier():void
  update(dt:number):void
  dispose():void
}
