import { AnimationAction, AnimationClip, AnimationMixer, Color, Euler, Group, LoopOnce, LoopRepeat, Mesh, MeshStandardMaterial, Object3D, Quaternion, QuaternionKeyframeTrack, Texture, Vector3, VectorKeyframeTrack, type SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { MonsterData, MonsterPose, Motion } from './config'
import { batchRigidMeshes } from './rigid-meshes'

import { prepareVariant } from './revotenshi/variant-model'

type Parts = { config: MonsterData['parts'][number]; bone: Object3D; local: Vector3; center: Vector3 }
const emberGlow = new Color(0xd45414)
const monarchGlow = new Color(0xe82ca0)
const eyeGlow = new Color(0xe63a92)
const neutral: MonsterPose = [0,0,0,0,0,0,0]
const axes: number[][] = []
for (const x of [-1,0,1]) for (const y of [-1,0,1]) for (const z of [-1,0,1]) {
  if (x||y||z) axes.push([x,y,z])
}

function contactVertices(mesh: Mesh) {
  const positions=mesh.geometry.attributes.position
  const skin=mesh.geometry.attributes.skinIndex
  const weights=mesh.geometry.attributes.skinWeight
  const regions=new Map<number,{scores: number[]; indices: number[]}>()
  for (let i=0;i<positions.count;i++) {
    let joint=0
    if (skin && weights) {
      const values=[weights.getX(i),weights.getY(i),weights.getZ(i),weights.getW(i)]
      const slot=values.indexOf(Math.max(...values))
      joint=skin.getComponent(i,slot)
    }
    let region=regions.get(joint)
    if (!region) {
      region={scores:axes.map(()=>-Infinity),indices:axes.map(()=>i)}
      regions.set(joint,region)
    }
    const x=positions.getX(i), y=positions.getY(i), z=positions.getZ(i)
    axes.forEach(([dx,dy,dz],j) => {
      const score=x*dx+y*dy+z*dz
      if (score>region.scores[j]) { region.scores[j]=score; region.indices[j]=i }
    })
  }
  return [...new Set([...regions.values()].flatMap(region=>region.indices))]
}

export class MonsterModel {
  readonly root = new Group()
  readonly parts: Parts[]
  readonly details: { clips: string[]; bones: string[] }
  private readonly visual = new Group()
  private readonly mixer: AnimationMixer
  private readonly asset: Group
  private readonly actions = new Map<Motion, AnimationAction>()
  private current?: AnimationAction
  private readonly materials = new Map<MeshStandardMaterial, { color: Color; intensity: number }>()
  private motion?: Motion
  private readonly emitters = new Map<string, Object3D>()
  private mantling = false
  private accentGlow = -1
  private flightOffset = 0
  groundHeight?: (x:number,z:number)=>number
  private support: { mesh: Mesh; indices: number[] }[] = []
  private contact = new Vector3()

  static async load(data: MonsterData) {
    const loader = new GLTFLoader()
    if(data.meshopt) loader.setMeshoptDecoder(MeshoptDecoder)
    const asset = await loader.loadAsync(import.meta.env.BASE_URL + data.model)
    if (data.id === 'revotenshi-variant') prepareVariant(asset.scene,asset.animations)
    return new MonsterModel(data, asset.scene, asset.animations)
  }

  private constructor(readonly data: MonsterData, asset: Group, clips: AnimationClip[]) {
    this.asset=asset
    this.root.add(this.visual)
    this.visual.add(asset)
    this.visual.scale.setScalar(data.scale)
    this.visual.position.y=data.footOffset*data.scale
    this.visual.rotation.y = data.yawOffset
    if(data.rigidMeshes && !data.meshopt) batchRigidMeshes(asset,clips)
    const bones: string[] = []
    asset.traverse(object => {
      if (object instanceof Mesh) {
        if(!data.rigidMeshes || data.groundRigid || data.flightFloorContact!==undefined) this.support.push({mesh:object,indices:contactVertices(object)})
        object.castShadow = !data.rigidMeshes
        object.receiveShadow = false
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material instanceof MeshStandardMaterial && !this.materials.has(material)) {
            this.materials.set(material,{ color: material.emissive.clone(), intensity: material.emissiveIntensity })
          }
        }
        // Animated skin bounds may exceed the rest mesh.
        if ((object as SkinnedMesh).isSkinnedMesh) object.frustumCulled = false
      }
      if (object.type === 'Bone') bones.push(object.name)
      if (object.name==='MuzzleL' || object.name==='MuzzleR' || object.name==='Wing' || data.emitters?.includes(object.name)) this.emitters.set(object.name,object)
    })
    this.details = { clips: clips.map(c => c.name), bones }
    const bone = (name: string) => {
      const object = asset.getObjectByName(name)
      if (!object) throw new Error(`GLBにボーン「${name}」がありません`)
      return object
    }
    this.parts = data.parts.map(config => ({ config, bone: bone(config.bone), local: new Vector3(...config.offset), center: new Vector3() }))
    this.mixer = new AnimationMixer(asset)
    const create = (name: Motion, poses: readonly MonsterPose[]) => {
      const time = poses.map((_,i) => i/(poses.length-1))
      const rig = data.rig!
      const root = bone(rig.root)
      const q = new Quaternion(), e = new Euler()
      const rotate = (key: string, getEuler: (p: MonsterPose) => Euler) => new QuaternionKeyframeTrack(
        key+'.quaternion', time, poses.flatMap(p => q.setFromEuler(getEuler(p)).toArray()))
      return new AnimationClip(name, 1, [
        rotate(rig.root,p => e.set(p[0],p[1],p[2])),
        rotate(rig.head,p => e.set(-p[0]*.24,-p[1]*.25,0)),
        rotate(rig.leftArm,p => e.set(p[4],0,-.28*Math.abs(p[4]))),
        rotate(rig.rightArm,p => e.set(p[5],0,.28*Math.abs(p[5]))),
        rotate(rig.leftLeg,p => e.set(p[6],0,0)),
        rotate(rig.rightLeg,p => e.set(-p[6],0,0)),
        new VectorKeyframeTrack(rig.root+'.position',time,poses.flatMap(p => [root.position.x,root.position.y+p[3],root.position.z])),
      ])
    }
    const custom = data.rig ? {
      spinPrep: create('spinPrep',[neutral,[.06,-.24,.12,-.04,-.43,-.18,.24],[.15,-.72,.23,-.14,-.76,.25,.18]]),
      leapPrep: create('leapPrep',[neutral,[.14,0,0,-.10,.24,.24,.20],[.34,0,0,-.26,.42,.42,.40],[.30,0,0,-.21,.36,.36,.38]]),
      turn: create('turn',[neutral,[.03,.25,-.09,.05,-.15,.18,.22],[.03,-.17,.09,.04,.15,-.18,-.22],neutral]),
      hit: create('hit',[neutral,[-.29,0,.17,.05,.13,.18,0],neutral]),
      stagger: create('stagger',[neutral,[-.33,.19,-.19,.04,-.37,-.13,.24],[.28,-.21,.15,-.12,.26,.52,-.27],neutral]),
      fall: create('fall',[neutral,[.25,0,.36,-.08,-.23,.51,.14],[.22,0,1.44,-.14,-.38,.42,.26],[.19,0,1.43,-.14,-.36,.41,.24],[.20,0,1.43,-.14,-.37,.41,.26],[.16,0,.48,-.22,.25,-.23,.18],neutral]),
      special: create('special',[neutral,[.37,0,0,-.22,-.38,-.38,.3],[-.58,0,0,.28,-1.25,-1.25,0],[.58,0,0,-.24,-.55,-.55,0],[.27,0,.05,-.12,-.23,-.42,0],neutral]),
    } : {}
    for (const motion of Object.keys(data.motions) as Motion[]) {
      const entry = data.motions[motion]!
      const clip = AnimationClip.findByName(clips,entry.clip)
      if (!clip) throw new Error(`GLBにクリップ「${entry.clip}」がありません`)
      // Walk, run and rush can share source data but must remain distinct actions.
      this.actions.set(motion,this.mixer.clipAction(clip.clone()))
    }
    for (const [name,clip] of Object.entries(custom)) {
      if (!this.actions.has(name as Motion)) this.actions.set(name as Motion,this.mixer.clipAction(clip))
    }
    if (data.rig && data.extraPoses) {
      for (const [name,poses] of Object.entries(data.extraPoses)) {
        const motion=name as Motion
        this.actions.set(motion,this.mixer.clipAction(create(motion,poses)))
      }
    }
    this.animate('idle',0)
  }

  emitter(name: string, target: Vector3) {
    return (this.emitters.get(name) ?? this.root).getWorldPosition(target)
  }

  setFlightOffset(lift: number) {
    this.flightOffset=lift
    this.visual.position.y=this.data.footOffset*this.data.scale+lift
  }

  setAccentGlow(strength:number) {
    if(strength===this.accentGlow) return
    this.accentGlow=strength
    for(const [material,original] of this.materials) {
      if(!/^(Jade blade|Violet crown enamel|Crown cabochon|Sage feather keratin)/.test(material.name)) continue
      material.emissive.copy(original.color).lerp(monarchGlow,strength)
      material.emissiveIntensity=original.intensity+strength*.39
    }
  }

  setEmberGlow(strength: number) {
    for (const [material,original] of this.materials) {
      if (!/^(Oxidized crimson armor|Heat-tempered copper ridge|Coal and ember plumage)/.test(material.name)) continue
      material.emissive.copy(original.color).lerp(emberGlow,strength)
      material.emissiveIntensity=original.intensity+strength*.14
    }
  }

  setEyeGlow(strength: number, spread: boolean) {
    this.mantling=spread
    for (const [material,original] of this.materials) {
      if (!material.name.startsWith('Amber iris')) continue
      material.emissive.copy(original.color).lerp(eyeGlow,strength)
      material.emissiveIntensity=original.intensity
    }
  }

  dispose() {
    this.mixer.stopAllAction()
    this.mixer.uncacheRoot(this.asset)
    const textures=new Set<Texture>()
    const geometries=new Set<Mesh['geometry']>()
    this.asset.traverse(node=>{
      if(node instanceof Mesh) geometries.add(node.geometry)
    })
    for(const geometry of geometries) geometry.dispose()
    for(const material of this.materials.keys()) {
      for(const property of Object.values(material)) if(property instanceof Texture) textures.add(property)
      material.dispose()
    }
    for(const texture of textures) {
      if(typeof ImageBitmap!=='undefined' && texture.image instanceof ImageBitmap) texture.image.close()
      texture.dispose()
    }
  }

  duration(motion: Motion) { return this.actions.get(motion)?.getClip().duration ?? 1 }

  setEnraged(value: boolean) {
    if (this.data.id === 'revotenshi-variant') {
      for (const [material] of this.materials) if (material.name === 'Copper wing lining') material.emissive.set(value ? 0xde580c : 0x281005)
    }
    if (!this.data.rig) return
    for (const [material,original] of this.materials) {
      material.emissive.copy(original.color)
      if (value) material.emissive.lerp(new Color(0xa52c0b),.78)
      material.emissiveIntensity = value ? Math.max(.39,original.intensity*.85) : original.intensity
    }
  }

  animate(motion: Motion, dt: number, progress?: number) {
    const action = this.actions.get(motion) ?? this.actions.get('idle')!
    if (this.motion !== motion) {
      const previous = this.current
      action.reset().setEffectiveWeight(1)
      action.setLoop(progress === undefined ? LoopRepeat : LoopOnce, progress === undefined ? Infinity : 1)
      action.clampWhenFinished = true
      action.play()
      if (previous && previous !== action) action.crossFadeFrom(previous, motion === 'defeat' ? .16 : .12, false)
      this.current = action
      this.motion = motion
    }
    action.paused = progress !== undefined
    if (progress !== undefined) action.time = Math.min(action.getClip().duration - .0001, progress * action.getClip().duration)
    else action.timeScale = this.data.motions[motion]?.speed ?? 1
    this.mixer.update(dt)
    if(this.data.groundRigid) {
      const wing=this.emitters.get('Wing')!
      // Every clip supplies a wing track. Apply the rage stance to the sampled pose.
      if(this.mantling && motion!=='defeat') wing.rotateY(-.19)
    }
    this.root.updateMatrixWorld(true)
    // Sparse extremal vertices give the floor contact of each animated stance,
    // including the original Defeat clip, whose unadjusted body crosses the floor.
    let lowest=Infinity
    const terrain=this.groundHeight
    if(this.data.flightFloorContact===undefined || this.flightOffset<this.data.flightFloorContact) {
      for (const {mesh,indices} of this.support) for (const index of indices) {
        const position=mesh.getVertexPosition(index,this.contact).applyMatrix4(mesh.matrixWorld)
        lowest=Math.min(lowest,position.y-(terrain?.(position.x,position.z)??this.root.position.y))
      }
    }
    const base=this.data.footOffset*this.data.scale+this.flightOffset
    const contact=this.visual.position.y-lowest
    const grounded=this.data.groundRigid ? contact : Math.max(base,contact-.018)
    if (Math.abs(grounded-this.visual.position.y)>.0015) {
      this.visual.position.y=grounded
      this.root.updateMatrixWorld(true)
    }
    for (const part of this.parts) part.center.copy(part.local).applyMatrix4(part.bone.matrixWorld)
  }
}
