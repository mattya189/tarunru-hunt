import {
  BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Object3D,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, Shape, ExtrudeGeometry, SphereGeometry, Vector3,
} from 'three'

const warning = 0xef9c54
const violet = 0xfa55b1
const point = new Vector3()

// Preallocated meshes follow the terrain for ground warnings. Their vertices
// are reused when a sight line rotates or a countdown circle changes size.
export class GroundWarning {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>
  private data = new Float32Array(32 * 18)
  private position = new BufferAttribute(this.data,3).setUsage(DynamicDrawUsage)
  private vertices=0

  constructor(private height:(x:number,z:number)=>number) {
    const geometry=new BufferGeometry()
    geometry.setAttribute('position',this.position)
    geometry.setDrawRange(0,0)
    this.mesh=new Mesh(geometry,new MeshBasicMaterial({
      color:warning,transparent:true,depthWrite:false,side:DoubleSide,toneMapped:false,
      polygonOffset:true,polygonOffsetFactor:-3,
    }))
    this.mesh.visible=false
    this.mesh.frustumCulled=false
    this.mesh.renderOrder=2
  }

  hide() { this.mesh.visible=false }

  private vertex(x:number,z:number) {
    const index=this.vertices++*3
    this.data[index]=x
    this.data[index+1]=this.height(x,z)+.056
    this.data[index+2]=z
  }

  private show(color:number,opacity:number) {
    this.mesh.material.color.setHex(color)
    this.mesh.material.opacity=opacity
    this.mesh.geometry.setDrawRange(0,this.vertices)
    this.position.needsUpdate=true
    this.mesh.visible=true
  }

  sector(center:Vector3,yaw:number,range:number,halfAngle:number,progress:number,inner=0,color=warning) {
    this.vertices=0
    const segments=32
    for(let i=0;i<segments;i++) {
      const a=yaw-halfAngle+2*halfAngle*i/segments
      const b=yaw-halfAngle+2*halfAngle*(i+1)/segments
      const ix=center.x+Math.sin(a)*inner, iz=center.z+Math.cos(a)*inner
      const jx=center.x+Math.sin(b)*inner, jz=center.z+Math.cos(b)*inner
      const ax=center.x+Math.sin(a)*range, az=center.z+Math.cos(a)*range
      const bx=center.x+Math.sin(b)*range, bz=center.z+Math.cos(b)*range
      this.vertex(ix,iz); this.vertex(ax,az); this.vertex(bx,bz)
      this.vertex(ix,iz); this.vertex(bx,bz); this.vertex(jx,jz)
    }
    this.show(color,.19+.26*progress)
  }

  lane(center:Vector3,yaw:number,range:number,width:number,progress:number,color=warning) {
    this.vertices=0
    const dx=Math.sin(yaw), dz=Math.cos(yaw), sx=dz*width/2, sz=-dx*width/2
    for(let i=0;i<24;i++) {
      const a=range*i/24, b=range*(i+1)/24
      const x=center.x+dx*a, z=center.z+dz*a, u=center.x+dx*b, v=center.z+dz*b
      this.vertex(x+sx,z+sz); this.vertex(x-sx,z-sz); this.vertex(u+sx,v+sz)
      this.vertex(x-sx,z-sz); this.vertex(u-sx,v-sz); this.vertex(u+sx,v+sz)
    }
    this.show(color,.23+.35*progress)
  }
}

export class RavenVisuals {
  readonly root=new Group()
  readonly zone: GroundWarning
  readonly lines: GroundWarning[]
  readonly marks: {ring:GroundWarning; timer:GroundWarning; iris:GroundWarning; pupil:GroundWarning; time:number; center:Vector3}[]
  readonly feathers: {mesh:Object3D; start:Vector3; yaw:number; distance:number; phase:boolean}[]
  readonly eyes: Group[]
  private readonly beams: Mesh[]
  private readonly sparks: InstancedMesh
  private readonly featherBatch: InstancedMesh
  private readonly eyeBatches: InstancedMesh[]
  private readonly eyePartTransforms: Matrix4[]
  private readonly transform = new Object3D()
  private readonly matrix = new Matrix4()
  private readonly eyeShell = new MeshStandardMaterial({color:0x35242e,metalness:.55,roughness:.44})
  private readonly eyeIris = new MeshStandardMaterial({color:0xbf346d,emissive:0x8e205a,emissiveIntensity:.45,metalness:.38,roughness:.48})
  private readonly eyePupil = new MeshStandardMaterial({color:0x180817,roughness:.42})

  constructor(height:(x:number,z:number)=>number) {
    this.zone=new GroundWarning(height)
    this.lines=Array.from({length:12},()=>new GroundWarning(height))
    this.marks=Array.from({length:5},()=>{
      const ring=new GroundWarning(height)
      const timer=new GroundWarning(height)
      const iris=new GroundWarning(height)
      const pupil=new GroundWarning(height)
      this.root.add(ring.mesh,timer.mesh,iris.mesh,pupil.mesh)
      return {ring,timer,iris,pupil,time:0,center:new Vector3()}
    })
    this.root.add(this.zone.mesh,...this.lines.map(line=>line.mesh))
    const featherShape=new Shape()
    featherShape.moveTo(0,.54); featherShape.lineTo(.13,.17); featherShape.lineTo(.11,-.19)
    featherShape.lineTo(.045,-.29); featherShape.lineTo(0,-.51); featherShape.lineTo(-.12,-.19)
    featherShape.lineTo(-.15,.02); featherShape.lineTo(-.08,.12); featherShape.closePath()
    const featherGeo=new ExtrudeGeometry(featherShape,{depth:.045,bevelEnabled:true,bevelSegments:1,bevelSize:.025,bevelThickness:.02})
    featherGeo.rotateX(Math.PI/2)
    const featherMat=new MeshStandardMaterial({color:0x37273a,emissive:0x24112a,emissiveIntensity:.36,metalness:.4,roughness:.45})
    this.feathers=Array.from({length:24},()=>({
      mesh:new Object3D(),start:new Vector3(),yaw:0,distance:0,phase:false,
    }))
    this.featherBatch=this.batch(featherGeo,featherMat,this.feathers.length)
    this.eyes=Array.from({length:8},()=>new Group())
    const shell=new SphereGeometry(.5,12,8), iris=new SphereGeometry(.31,12,8), pupil=new SphereGeometry(.14,10,7)
    this.eyeBatches=[
      this.batch(shell,this.eyeShell,this.eyes.length),
      this.batch(iris,this.eyeIris,this.eyes.length),
      this.batch(pupil,this.eyePupil,this.eyes.length),
    ]
    this.eyePartTransforms=[
      new Matrix4().makeScale(1,.78,.90).setPosition(0,.40,0),
      new Matrix4().makeScale(1,.80,.36).setPosition(0,.41,.40),
      new Matrix4().makeScale(.53,1,.40).setPosition(0,.41,.51),
    ]
    const beamGeo=new BoxGeometry(1,1,1).translate(0,0,.5)
    const beamMat=new MeshBasicMaterial({color:violet,transparent:true,opacity:.68,depthWrite:false,toneMapped:false})
    this.beams=Array.from({length:2},()=>{
      const mesh=new Mesh(beamGeo,beamMat)
      this.root.add(mesh)
      return mesh
    })
    const sparkGeo=new IcosahedronGeometry(.065,0)
    const sparkMat=new MeshBasicMaterial({color:0xc553a9,toneMapped:false,transparent:true,opacity:.68})
    this.sparks=this.batch(sparkGeo,sparkMat,10)
    this.clear()
  }

  private batch(geometry:BufferGeometry,material:MeshBasicMaterial|MeshStandardMaterial,capacity:number) {
    const mesh=new InstancedMesh(geometry,material,capacity)
    mesh.count=0
    mesh.frustumCulled=false
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.root.add(mesh)
    return mesh
  }

  syncEyes() {
    let count=0
    for(const eye of this.eyes) {
      if(!eye.visible) continue
      eye.updateMatrix()
      this.eyeBatches.forEach((batch,i)=>batch.setMatrixAt(count,this.matrix.multiplyMatrices(eye.matrix,this.eyePartTransforms[i])))
      count++
    }
    for(const batch of this.eyeBatches) {
      batch.count=count
      if(count) batch.instanceMatrix.needsUpdate=true
    }
  }

  syncFeathers() {
    let count=0
    for(const {mesh} of this.feathers) {
      if(!mesh.visible) continue
      mesh.updateMatrix()
      this.featherBatch.setMatrixAt(count++,mesh.matrix)
    }
    this.featherBatch.count=count
    if(count) this.featherBatch.instanceMatrix.needsUpdate=true
  }

  beam(index:number,from:Vector3,to:Vector3,width:number) {
    const mesh=this.beams[index]
    mesh.position.copy(from)
    mesh.lookAt(to)
    mesh.scale.set(width,.075,from.distanceTo(to))
    mesh.visible=true
  }

  hideBeams() { for(const beam of this.beams) beam.visible=false }
  hideLines() { for(const line of this.lines) line.hide() }

  mark(index:number,progress:number,radius:number) {
    const {ring,timer,iris,pupil,center}=this.marks[index]
    if(progress===0) {
      ring.sector(center,0,radius,Math.PI,.35,radius*.91,violet)
      iris.sector(center,0,.46,Math.PI,.51,.31,0xffc0e2)
      pupil.lane(point.set(center.x,center.y,center.z-.25),0,.50,.10,.51,0xffc0e2)
    }
    timer.sector(center,0,radius*(1-.86*progress),Math.PI,.35,0,violet)
  }

  hideMark(index:number) {
    const {ring,timer,iris,pupil}=this.marks[index]
    ring.hide(); timer.hide(); iris.hide(); pupil.hide()
  }

  rage(center:Vector3,yaw:number,time:number) {
    const cos=Math.cos(yaw),sin=Math.sin(yaw)
    this.sparks.count=10
    for(let i=0;i<this.sparks.count;i++) {
      const phase=(time*.76+i*.371)%1
      const x=(i%2?1:-1)*(1.0+.5*phase), z=.7*Math.sin(i+phase*4)
      this.transform.position.set(center.x+x*cos+z*sin,center.y+1.45+phase*1.75,center.z+z*cos-x*sin)
      this.transform.scale.setScalar(.37+Math.sin(phase*Math.PI)*.95)
      this.transform.updateMatrix()
      this.sparks.setMatrixAt(i,this.transform.matrix)
    }
    this.sparks.instanceMatrix.needsUpdate=true
  }

  clearUltimate() {
    for(const eye of this.eyes) eye.visible=false
    this.syncEyes()
    for(const shot of this.feathers) if(shot.phase) shot.mesh.visible=false
    this.zone.hide()
    this.hideLines()
    this.hideBeams()
  }

  dispose() {
    this.root.removeFromParent()
    const geometries=new Set<BufferGeometry>()
    const materials=new Set<MeshBasicMaterial|MeshStandardMaterial>()
    this.root.traverse(node=>{
      if(!(node instanceof Mesh)) return
      if(node instanceof InstancedMesh) node.dispose()
      geometries.add(node.geometry)
      materials.add(node.material)
    })
    for(const geometry of geometries) geometry.dispose()
    for(const material of materials) material.dispose()
  }

  clear() {
    this.clearUltimate()
    for(const shot of this.feathers) shot.mesh.visible=false
    this.marks.forEach((mark,index)=>{ mark.time=0; this.hideMark(index) })
    this.featherBatch.count=0
    this.sparks.count=0
  }
}
