import { AnimationMixer, Box3, Group, LoopOnce, type AnimationAction, type Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { gunzip } from 'three/addons/libs/fflate.module.js'

const modelParts=9

export class FlareModel {
  readonly root = new Group()
  readonly hand: Object3D
  private mixer: AnimationMixer
  private actions = new Map<string,AnimationAction>()
  private current?: AnimationAction

  static async load() {
    const base=import.meta.env.BASE_URL+'models/flare/'
    const parts=await Promise.all(Array.from({length:modelParts},async (_,i)=>{
      const file=await fetch(base+'v12.gz.'+String(i).padStart(2,'0'))
      if(!file.ok) throw new Error('フレアの3Dモデルを読み込めなかった。')
      return new Uint8Array(await file.arrayBuffer())
    }))
    const compressed=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0))
    let offset=0
    for(const part of parts) {
      compressed.set(part,offset)
      offset+=part.length
    }
    const buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{
      gunzip(compressed,(error,data)=>{
        if(error) reject(error)
        else resolve(data.buffer as ArrayBuffer)
      })
    })
    const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    return new FlareModel(await loader.parseAsync(buffer,base))
  }

  private constructor(asset: Awaited<ReturnType<GLTFLoader['loadAsync']>>) {
    const bounds=new Box3().setFromObject(asset.scene)
    const height=bounds.max.y-bounds.min.y
    this.root.add(asset.scene)
    this.root.scale.setScalar(2.1/height)
    asset.scene.position.y=-bounds.min.y
    this.hand=asset.scene.getObjectByName('hand1') ?? asset.scene
    this.mixer=new AnimationMixer(asset.scene)
    for(const clip of asset.animations) this.actions.set(clip.name,this.mixer.clipAction(clip))
  }

  reset() {
    this.mixer.stopAllAction()
    this.current=undefined
    this.pose('Idle',0)
  }

  pose(name:string,dt:number,time?:number) {
    const next=this.actions.get(name)!
    if(next!==this.current || time===0) {
      this.current?.stop()
      this.current=next.reset().play()
      if(name!=='Idle' && name!=='Run' && name!=='Guard') {
        next.setLoop(LoopOnce,1)
        next.clampWhenFinished=true
      }
    }
    if(time!==undefined) next.time=Math.min(time,next.getClip().duration)
    const before=next.time
    this.mixer.update(time===undefined?dt:0)
    const duration=next.getClip().duration
    return name==='Run' && Math.floor(before * 2 / duration + .18) !== Math.floor(next.time * 2 / duration + .18)
  }
}
