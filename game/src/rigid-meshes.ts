import { AnimationClip, Group, Matrix4, Mesh, Object3D, PropertyBinding, type BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export function batchRigidMeshes(asset:Group, clips:AnimationClip[]) {
  const driven=new Set(clips.flatMap(clip=>clip.tracks.map(track=>PropertyBinding.parseTrackName(track.name).nodeName)))
  const groups=new Map<string,{pivot:Object3D; meshes:Mesh[]}>()
  asset.updateMatrixWorld(true)
  asset.traverse(object=>{
    if(!(object instanceof Mesh) || Array.isArray(object.material) || object.morphTargetInfluences || driven.has(object.name)) return
    let pivot=object.parent!
    while(pivot!==asset && !driven.has(pivot.name)) pivot=pivot.parent!
    const attributes=Object.keys(object.geometry.attributes).sort().join(',')
    const key=pivot.uuid+':'+object.material.uuid+':'+attributes
    const group=groups.get(key)??{pivot,meshes:[]}
    group.meshes.push(object)
    groups.set(key,group)
  })
  const inverse=new Matrix4()
  const transform=new Matrix4()
  for(const {pivot,meshes} of groups.values()) {
    if(meshes.length<2) continue
    inverse.copy(pivot.matrixWorld).invert()
    const pieces:BufferGeometry[]=meshes.map(mesh=>{
      const geometry=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone()
      return geometry.applyMatrix4(transform.multiplyMatrices(inverse,mesh.matrixWorld))
    })
    const geometry=mergeGeometries(pieces)
    for(const piece of pieces) piece.dispose()
    if(!geometry) continue
    pivot.add(new Mesh(geometry,meshes[0].material))
    for(const mesh of meshes) {
      // Keep the model's named nodes and child transforms, including sword hit targets.
      const node=new Object3D()
      node.name=mesh.name
      node.position.copy(mesh.position)
      node.quaternion.copy(mesh.quaternion)
      node.scale.copy(mesh.scale)
      mesh.parent!.add(node)
      while(mesh.children.length) node.add(mesh.children[0])
      mesh.removeFromParent()
    }
  }
}
