import { AnimationClip, Euler, Group, Mesh, MeshStandardMaterial, Quaternion, QuaternionKeyframeTrack } from 'three'

// Pose coordinates are wing elevation, forward sweep, body pitch and tail lift.
type Pose = [number, number, number, number, number, number]
const neutral: Pose = [0,0,0,0,0,0]
const poses: Record<string, Pose> = {
  sweepLeft: [.72,0,-.45,0,-.08,0], sweepRight: [0,.72,0,-.45,-.08,0],
  leapPrep: [-.32,-.32,0,0,-.22,.12], tailPrep: [0,0,0,0,.12,1.05],
  clawPrep: [.9,.9,.95,.95,-.12,0], fissurePrep: [-.65,-.65,-.28,-.28,.16,0],
  sweepLeftHit: [-.65,0,1,0,.2,0], sweepRightHit: [0,-.65,0,1,.2,0],
  leapHit: [-.56,-.56,0,0,.26,.25], tailHit: [0,0,0,0,-.14,-.55],
  clawHit: [-1.15,-1.15,.85,.85,.32,0], fissureHit: [-1.28,-1.28,-.25,-.25,.42,.14],
}

export function prepareVariant(asset: Group, clips: AnimationClip[]) {
  asset.traverse(node => {
    if (!(node instanceof Mesh)) return
    const tint = (source: MeshStandardMaterial) => {
      const material = source.clone()
      const wing = /^wing_[LR]_/.test(node.name)
      material.color.set(wing ? (node.name.endsWith('back') ? 0xff842e : 0x403733) : 0xc17951)
      if (wing && node.name.endsWith('back')) material.name = 'Copper wing lining'
      return material
    }
    node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material)
  })
  for (const [name, pose] of Object.entries(poses)) {
    const tracks = ['Wing_L_Pivot','Wing_R_Pivot','world','Tail_Pivot_0'].map((bone,i) => {
      const rotation = (p: Pose) => {
        const e = [new Euler(0,p[2],-p[0]),new Euler(0,-p[3],p[1]),new Euler(p[4],0,0),new Euler(p[5],0,0)][i]
        return new Quaternion().setFromEuler(e).toArray()
      }
      return new QuaternionKeyframeTrack(bone+'.quaternion',[0,1],[...rotation(neutral),...rotation(pose)])
    })
    clips.push(new AnimationClip(name,1,tracks))
  }
}
