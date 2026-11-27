import {
  BackSide, Color, CylinderGeometry, DodecahedronGeometry, Group, InstancedMesh, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, RingGeometry, ShaderMaterial, SphereGeometry,
} from 'three'

export function buildSummit(root:Group, radius:number) {
  const sky=new Mesh(new SphereGeometry(122,32,20),new ShaderMaterial({
    side:BackSide, depthWrite:false,
    vertexShader:'varying vec3 v; void main(){v=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`
      varying vec3 v;
      void main(){
        vec3 d=normalize(v);
        vec3 sun=normalize(vec3(-.4,.20,-.78));
        float a=max(0.,dot(d,sun));
        vec3 c=mix(vec3(.96,.62,.61),vec3(.24,.17,.47),smoothstep(-.02,.80,d.y));
        c=mix(c,vec3(.54,.58,.81),smoothstep(.0,.44,-d.y));
        c+=vec3(.95,.69,.31)*(pow(a,11.)*.51+pow(a,290.)*1.4);
        float cloud=sin(d.x*31.+sin(d.z*14.))*sin(d.z*25.+d.y*9.);
        c=mix(c,vec3(.85,.75,.97),smoothstep(-.04,.72,cloud)*exp(-pow((d.y+.11)*6.,2.))*.46);
        gl_FragColor=vec4(c,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }))
  root.add(sky)
  const stone=new Mesh(new CylinderGeometry(radius+.55,radius-4,6,72),new MeshStandardMaterial({
    color:0x706687, roughness:.81, flatShading:true,
  }))
  stone.position.y=-3
  stone.receiveShadow=true
  root.add(stone)
  const markings=new Group()
  const bronze=new MeshBasicMaterial({color:0xb7a28f, transparent:true,opacity:.54,depthWrite:false})
  for(const r of [2.75,6.8,12,17.78,18.22]) {
    const seal=new Mesh(new RingGeometry(r-.042,r+.042,96).rotateX(-Math.PI/2),bronze)
    seal.position.y=.012
    markings.add(seal)
  }
  for(let i=0;i<12;i++) {
    const angle=i*Math.PI/6
    const seal=new Mesh(new RingGeometry(.30,.36,4).rotateX(-Math.PI/2),bronze)
    seal.position.set(Math.sin(angle)*16.75,.014,Math.cos(angle)*16.75)
    seal.rotation.y=angle
    seal.scale.z=2.3
    markings.add(seal)
  }
  root.add(markings)
  const peaks=new InstancedMesh(new DodecahedronGeometry(1,0),new MeshStandardMaterial({roughness:1,flatShading:true}),48)
  const clouds=new InstancedMesh(new SphereGeometry(1,12,7),new MeshBasicMaterial({
    color:0xc0b7db,transparent:true,opacity:.23,depthWrite:false,
  }),32)
  const obj=new Object3D()
  for(let i=0;i<48;i++) {
    const angle=i*2.39996, r=24+(i*41%83)
    obj.position.set(Math.sin(angle)*r,-11-(i*7%13),Math.cos(angle)*r)
    obj.scale.set(2.4+(i*13%8),8+(i*31%15),3+(i*11%11))
    obj.rotation.set(.12*Math.sin(i),angle,.18*Math.cos(i))
    obj.updateMatrix()
    peaks.setMatrixAt(i,obj.matrix)
    peaks.setColorAt(i,new Color().setHSL(.69+(i%6)*.018,.26,.31+(i%7)*.035))
    if(i>=32) continue
    const range=24+i*43%71
    obj.position.set(Math.sin(angle)*range,-5-i%7,Math.cos(angle)*range)
    obj.scale.set(7+i%6,1.2+i%3,4+i%6)
    obj.rotation.set(0,angle,0)
    obj.updateMatrix()
    clouds.setMatrixAt(i,obj.matrix)
  }
  root.add(peaks,clouds)
}
