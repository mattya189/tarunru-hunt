import {
  AdditiveBlending, BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry,
  DodecahedronGeometry, DynamicDrawUsage, ExtrudeGeometry, Group, InstancedBufferAttribute, InstancedMesh, Mesh,
  MeshBasicMaterial, Object3D, ShaderMaterial, Shape, Vector3, type Material,
} from 'three'

export const violet=0xf35daa
export const ice=0x87ffed
const danger=0xff657d
const up=new Vector3(0,1,0)

function crescent() {
  const edge=new Shape()
  edge.moveTo(-.75,0)
  edge.quadraticCurveTo(0,1.07,.75,0)
  edge.quadraticCurveTo(0,.49,-.75,0)
  return new ExtrudeGeometry(edge,{depth:.082,bevelEnabled:true,bevelSize:.028,
    bevelThickness:.025,bevelSegments:1,curveSegments:12}).rotateX(Math.PI/2).translate(0,0,-.22)
}

export class WandaVisuals {
  readonly root=new Group()
  private readonly transform=new Object3D()
  private readonly tint=new Color()
  private readonly axis=new Vector3()
  private readonly discData=new InstancedBufferAttribute(new Float32Array(128*2),2).setUsage(DynamicDrawUsage)
  private readonly discGeometry=new CircleGeometry(1,64).rotateX(-Math.PI*.5)
  private readonly disc=this.make(this.discGeometry,new ShaderMaterial({
    transparent:true,depthWrite:false, uniforms:{fieldRadius:{value:0}},
    vertexShader:`
      attribute vec2 profile;
      varying vec2 local;
      varying vec2 ground;
      varying vec2 shape;
      varying vec3 tint;
      void main(){
        local=position.xz; shape=profile; tint=instanceColor;
        vec4 world=modelMatrix*instanceMatrix*vec4(position,1.);
        ground=world.xz;
        gl_Position=projectionMatrix*viewMatrix*world;
      }`,
    fragmentShader:`
      varying vec2 local;
      varying vec2 ground;
      varying vec2 shape;
      varying vec3 tint;
      uniform float fieldRadius;
      void main(){
        if(length(ground)>fieldRadius) discard;
        float r=length(local);
        float rim=1.-smoothstep(.973,1.,r);
        float band=1.-smoothstep(.92,.975,r);
        float inside=smoothstep(shape.x-.009,abs(shape.x)+.002,r);
        float stripes=.80+.20*sin((local.x+local.y)*67.);
        float a=rim*inside*(shape.y+(1.-band)*.48);
        gl_FragColor=vec4(tint*(1.10+(1.-band)*.58),a*stripes);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }),128,4)
  private readonly lines=this.make(new BoxGeometry(1,1,1),this.glow(.38),96,5)
  private readonly shafts=this.make(new CylinderGeometry(1,1,1,10),this.glow(.65),36,7)
  private readonly blades=this.make(crescent(),this.glow(.88),32,9)
  private readonly bolts=this.make(new DodecahedronGeometry(1,0),this.glow(.92),72,8)
  private readonly motes=this.make(new DodecahedronGeometry(1,0),this.glow(.56),220,7)
  private readonly air=this.make(new CylinderGeometry(1,1.18,1,14,1,true),this.glow(.14),50,6)
  private readonly shade=new Mesh(new CircleGeometry(1,72).rotateX(-Math.PI*.5),new ShaderMaterial({
    transparent:true,depthWrite:false,uniforms:{safe:{value:new Vector3()},fade:{value:0}},
    vertexShader:`varying vec3 world; void main(){
      vec4 p=modelMatrix*vec4(position,1.); world=p.xyz;
      gl_Position=projectionMatrix*viewMatrix*p;
    }`,
    fragmentShader:`varying vec3 world; uniform vec3 safe; uniform float fade;
      void main(){
        if(distance(world.xz,safe.xz)<safe.y) discard;
        float band=.82+.18*sin((world.x-world.z)*5.);
        gl_FragColor=vec4(.65,.055,.20,fade*band);
      }`,
  }))
  private readonly pools=[this.disc,this.lines,this.shafts,this.blades,this.bolts,this.motes,this.air]
  quality: 'low'|'medium'|'high'='high'

  constructor(private readonly fieldRadius:number) {
    (this.disc.material as ShaderMaterial).uniforms.fieldRadius.value=fieldRadius
    this.discGeometry.setAttribute('profile',this.discData)
    this.shade.scale.setScalar(fieldRadius)
    this.shade.position.y=.022
    this.shade.renderOrder=3
    this.root.add(this.shade)
    this.clear()
  }

  private glow(opacity:number) {
    return new MeshBasicMaterial({color:0xffffff,transparent:true,opacity,blending:AdditiveBlending,depthWrite:false})
  }

  private make(geometry:BufferGeometry,material:Material,count:number,order:number) {
    const mesh=new InstancedMesh(geometry,material,count)
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.setColorAt(0,new Color(0xffffff))
    mesh.instanceColor!.setUsage(DynamicDrawUsage)
    mesh.count=0
    mesh.frustumCulled=false
    mesh.renderOrder=order
    this.root.add(mesh)
    return mesh
  }

  clear() {
    for(const pool of this.pools) pool.count=0
    this.shade.visible=false
  }

  flush() {
    for(const pool of this.pools) if(pool.count) {
      pool.instanceMatrix.needsUpdate=true
      pool.instanceColor!.needsUpdate=true
    }
    if(this.disc.count) this.discData.needsUpdate=true
  }

  private put(mesh:InstancedMesh,color:number) {
    if(mesh.count>=mesh.instanceMatrix.count) return
    this.transform.updateMatrix()
    mesh.setMatrixAt(mesh.count,this.transform.matrix)
    mesh.setColorAt(mesh.count++,this.tint.setHex(color))
  }

  area(x:number,z:number,radius:number,intensity=.2,color=danger,inner=0) {
    if(radius<.001 || this.disc.count>=this.discData.count) return
    this.transform.position.set(x,.035,z)
    this.transform.scale.set(radius,1,radius)
    this.transform.rotation.set(0,0,0)
    this.discData.setXY(this.disc.count,inner/radius,intensity)
    this.put(this.disc,color)
  }

  line(ax:number,az:number,bx:number,bz:number,halfWidth:number,color=danger) {
    const dx=bx-ax,dz=bz-az
    const quadratic=dx*dx+dz*dz
    if(quadratic<.001) return
    const along=ax*dx+az*dz
    const det=along*along-quadratic*(ax*ax+az*az-this.fieldRadius*this.fieldRadius)
    if(det<0) return
    const span=Math.sqrt(det)
    const start=Math.max(0,(-along-span)/quadratic), end=Math.min(1,(-along+span)/quadratic)
    if(start>=end) return
    bx=ax+dx*end; bz=az+dz*end
    ax+=dx*start; az+=dz*start
    const distance=Math.hypot(bx-ax,bz-az)
    this.transform.position.set((ax+bx)*.5,.046,(az+bz)*.5)
    this.transform.scale.set(halfWidth*2,.025,distance)
    this.transform.rotation.set(0,Math.atan2(bx-ax,bz-az),0)
    this.put(this.lines,color)
  }

  shaft(ax:number,ay:number,az:number,bx:number,by:number,bz:number,radius:number,color=violet) {
    this.transform.position.set((ax+bx)*.5,(ay+by)*.5,(az+bz)*.5)
    const length=this.axis.set(bx-ax,by-ay,bz-az).length()
    if(length<.001) return
    this.transform.scale.set(radius,length,radius)
    this.transform.quaternion.setFromUnitVectors(up,this.axis.multiplyScalar(1/length))
    this.put(this.shafts,color)
  }

  blade(x:number,y:number,z:number,yaw:number,color:number) {
    this.transform.position.set(x,y,z)
    this.transform.scale.set(1,1,1)
    this.transform.rotation.set(.18,yaw,.09)
    this.put(this.blades,color)
  }

  bolt(x:number,y:number,z:number,sx:number,sy:number,sz:number,yaw:number,color=violet) {
    this.transform.position.set(x,y,z)
    this.transform.scale.set(sx,sy,sz)
    this.transform.rotation.set(0,yaw,0)
    this.put(this.bolts,color)
  }

  cyclone(x:number,z:number,r:number,height:number,time:number,color:number) {
    this.area(x,z,r,.16,color)
    for(let i=0;i<4;i++) {
      const width=r*(.51+.10*i)
      this.transform.position.set(x,height*(.13+i*.23),z)
      this.transform.scale.set(width,height*.32,width)
      this.transform.rotation.set(.12*Math.sin(time*9+i),time*3+i,.13*Math.cos(time*8+i))
      this.put(this.air,color)
    }
    const count=this.quality==='low'?7:this.quality==='medium'?13:20
    for(let i=0;i<count;i++) {
      const f=i/count, a=time*4.8+i*2.4, width=r*(.54+.44*f)
      this.mote(x+Math.sin(a)*width,.17+height*f,z+Math.cos(a)*width,.045+f*.08,color)
    }
  }

  burst(x:number,y:number,z:number,range:number,phase:number,color=violet) {
    const count=this.quality==='low'?5:this.quality==='medium'?9:15
    for(let i=0;i<count;i++) {
      const angle=i*2.39996
      const spread=range*phase*(.45+(i%7)*.08)
      this.mote(x+Math.sin(angle)*spread,y+Math.sin(phase*Math.PI)*(.33+(i%5)*.42),z+Math.cos(angle)*spread,
        (.08+(i%5)*.03)*(1-phase*.65),color)
    }
  }

  private mote(x:number,y:number,z:number,radius:number,color:number) {
    this.transform.position.set(x,y,z)
    this.transform.scale.set(radius,radius*1.5,radius)
    this.transform.rotation.set(0,x*.31,z*.5)
    this.put(this.motes,color)
  }

  storm(safeX:number,safeZ:number,safeR:number,opacity:number) {
    this.shade.visible=true
    this.shade.material.uniforms.safe.value.set(safeX,safeR,safeZ)
    this.shade.material.uniforms.fade.value=opacity
  }
}
