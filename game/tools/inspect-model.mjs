import { readFile } from 'node:fs/promises'

const file = process.argv[2] ?? 'public/models/monster001_v4.glb'
const glb = await readFile(file)
if (glb.toString('ascii', 0, 4) !== 'glTF' || glb.readUInt32LE(4) !== 2 ||
    glb.toString('ascii', 16, 20) !== 'JSON') {
  throw new Error('glTF 2.0 の GLB ファイルを指定してください。')
}
const json = JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)))
const nodes = json.nodes ?? []
const accessors = json.accessors ?? []
const skins = (json.skins ?? []).map(skin => ({
  root: nodes[skin.skeleton]?.name ?? '(unspecified)',
  joints: skin.joints.map(i => ({
    name:nodes[i].name, translation:nodes[i].translation ?? [0,0,0],
    parent:nodes.find(n=>n.children?.includes(i))?.name ?? '(scene)',
  })),
}))
const clips = (json.animations ?? []).map(clip => ({
  name:clip.name,
  seconds:Number(Math.max(...clip.samplers.map(s=>accessors[s.input].max?.[0] ?? 0)).toFixed(3)),
  channels:clip.channels.map(c=>nodes[c.target.node]?.name+'.'+c.target.path),
}))
const meshes = (json.meshes ?? []).flatMap(mesh=>mesh.primitives.map(p=>({
  vertices:accessors[p.attributes.POSITION].count,
  triangles:(p.mode===undefined || p.mode===4) ? (accessors[p.indices]?.count ?? accessors[p.attributes.POSITION].count)/3 : null,
  color:typeof p.attributes.COLOR_0==='number',
})))
console.log(JSON.stringify({file,bytes:glb.length,skins,clips,meshes,images:json.images?.length??0},null,2))
