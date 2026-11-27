import {
  Box3, BoxGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight,
  DodecahedronGeometry, FogExp2, Group, HemisphereLight, InstancedMesh, Mesh, MeshStandardMaterial,
  Object3D, PlaneGeometry, RepeatWrapping, Scene, SphereGeometry, SRGBColorSpace, Vector3, BufferAttribute, InstancedBufferAttribute, DynamicDrawUsage,
  ShaderMaterial, BackSide, Material, Matrix4, Texture, type WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { Obstacle, RegisteredField } from './fields'
import { clamp, damp } from './math'
import { buildSummit } from './wanda/summit'

type Prop = [number, number, number, number, number, number, number, Color]
interface CameraProp { x: number; z: number; radius: number; bottom: number; top: number }
interface CameraBatch { props: CameraProp[]; opacity: InstancedBufferAttribute }

function blocksView(prop: CameraProp, eye: Vector3, target: Vector3, margin: number) {
  const dx=target.x-eye.x, dz=target.z-eye.z, lengthSquared=dx*dx+dz*dz
  if (lengthSquared<.0001) return false
  const x=prop.x-eye.x, z=prop.z-eye.z
  const t=(x*dx+z*dz)/lengthSquared
  const distanceSquared=x*x+z*z-t*t*lengthSquared
  const radius=prop.radius+margin
  if (distanceSquared>=radius*radius) return false
  const halfSpan=Math.sqrt((radius*radius-distanceSquared)/lengthSquared)
  if (t+halfSpan<0 || t-halfSpan>1) return false
  const enterY=eye.y+(target.y-eye.y)*clamp(t-halfSpan,0,1)
  const exitY=eye.y+(target.y-eye.y)*clamp(t+halfSpan,0,1)
  return Math.min(enterY,exitY)<=prop.top+margin && Math.max(enterY,exitY)>=prop.bottom-margin
}
const earth = (x: number, z: number) => {
  const r = Math.hypot(x, z)
  return (.14 * Math.sin(x * .35) * Math.cos(z * .28) + .07 * Math.sin(z * .65 + x * .27)) * Math.min(1, r / 12)
}
function sandTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const pixels = ctx.createImageData(128, 128)
  let seed = 197
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const tint = 207 + (seed >>> 27) + 11 * Math.sin(x * .196 + 1.6 * Math.sin(y * .098))
    const i = (y * 128 + x) * 4
    pixels.data.set([tint + 5, tint + 1, tint - 9, 255], i)
  }
  ctx.putImageData(pixels, 0, 0)
  const texture = new CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.repeat.set(19, 19)
  texture.colorSpace = SRGBColorSpace
  return texture
}
export class Arena {
  readonly root = new Group()
  readonly obstacles: Obstacle[] = []
  readonly sun = new DirectionalLight(0xffd3a0, 2.5)
  get radius() { return this.data.radius }
  readonly height: (x: number, z: number) => number
  private readonly scenery = new Group()
  private cameraBatches: CameraBatch[] = []
  private prepared = false

  constructor(readonly data: RegisteredField) {
    this.root.add(this.scenery)
    const { landscape, lighting } = data
    this.height = landscape === 'shore' ? earth : () => typeof landscape === 'object' ? landscape.floor : 0
    this.sun.position.set(...(lighting.sun?.position ?? [-25, 35, -30]))
    if (lighting.sun) {
      this.sun.color.setHex(lighting.sun.color)
      this.sun.intensity = lighting.sun.intensity
    }
    this.sun.castShadow = true
    Object.assign(this.sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 100 })
    this.sun.shadow.normalBias = .045
    this.sun.shadow.bias = -.00015
    this.root.add(new HemisphereLight(lighting.sky, lighting.ground, lighting.fill), this.sun)
  }

  async prepare() {
    if (this.prepared) return false
    const landscape = this.data.landscape
    this.obstacles.push(...(this.data.obstacles ?? []))
    try {
      if (landscape === 'shore') this.buildShore()
      else if (landscape === 'summit') buildSummit(this.scenery, this.radius)
      else {
        const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
        const { scene } = await loader.loadAsync(import.meta.env.BASE_URL + landscape.path)
        scene.scale.setScalar(landscape.scale)
        scene.position.y = landscape.floor
        this.scenery.add(scene)
        this.prepareArchitecture(scene, landscape.floor)
        if (landscape.surround !== undefined) {
          const ground = new Mesh(new CircleGeometry(112, 48).rotateX(-Math.PI / 2),
            new MeshStandardMaterial({ color: landscape.surround, roughness: 1 }))
          ground.position.y = landscape.floor - .34
          this.scenery.add(ground)
        }
      }
    } catch (error) {
      this.releaseScenery()
      throw error
    }
    this.prepared = true
    return true
  }

  private prepareArchitecture(scene: Group, floor: number) {
    scene.updateMatrixWorld(true)
    const walls: Mesh[] = []
    scene.traverse(object => {
      if (!(object instanceof Mesh)) return
      object.receiveShadow = true
      object.geometry.computeBoundingBox()
      const world = new Box3().setFromObject(object)
      if (world.max.y <= floor + .1) return
      object.castShadow = true
      walls.push(object)
    })
    const matrix = new Matrix4(), bounds = new Box3(), center = new Vector3(), size = new Vector3()
    for (const object of walls) {
      // Keep singleton features (such as the entrance) on the same fade path as repeated columns.
      let wall: InstancedMesh
      if (object instanceof InstancedMesh) wall = object
      else {
        wall = new InstancedMesh(object.geometry, object.material, 1)
        wall.setMatrixAt(0, matrix.identity())
        wall.position.copy(object.position)
        wall.quaternion.copy(object.quaternion)
        wall.scale.copy(object.scale)
        wall.castShadow = wall.receiveShadow = true
        for (const child of [...object.children]) wall.add(child)
        object.parent!.add(wall)
        object.removeFromParent()
        wall.updateMatrixWorld(true)
      }
      if (wall.geometry.hasAttribute('cameraOpacity')) wall.geometry = wall.geometry.clone()
      const props: CameraProp[] = []
      for (let i = 0; i < wall.count; i++) {
        wall.getMatrixAt(i,matrix)
        bounds.copy(wall.geometry.boundingBox!).applyMatrix4(matrix.premultiply(wall.matrixWorld))
        bounds.getCenter(center); bounds.getSize(size)
        props.push({ x: center.x, z: center.z, radius: Math.hypot(size.x,size.z)*.5,
          bottom: bounds.min.y, top: bounds.max.y })
      }
      this.fadeBatch(wall, props)
    }
  }

  private fadeBatch(mesh: InstancedMesh, props: CameraProp[]) {
    const opacity = new InstancedBufferAttribute(new Float32Array(props.length).fill(1),1)
    opacity.setUsage(DynamicDrawUsage)
    mesh.geometry.setAttribute('cameraOpacity',opacity)
    this.cameraBatches.push({ props, opacity })
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      material.alphaHash = true
      material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <common>',
          '#include <common>\nattribute float cameraOpacity;\nvarying float vCameraOpacity;')
          .replace('#include <begin_vertex>','#include <begin_vertex>\nvCameraOpacity = cameraOpacity;')
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
          '#include <common>\nvarying float vCameraOpacity;')
          .replace('#include <alphahash_fragment>',
            'if (vCameraOpacity < 0.999 && vCameraOpacity < getAlphaHashThreshold(vPosition)) discard;')
      }
    }
  }

  warmTextures(renderer: WebGLRenderer) {
    for (const texture of this.textures()) renderer.initTexture(texture)
  }

  private textures() {
    const textures = new Set<Texture>()
    this.scenery.traverse(object => {
      if (!(object instanceof Mesh)) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
      }
    })
    return textures
  }

  deactivate() {
    this.root.removeFromParent()
    this.sun.shadow.dispose()
    this.sun.shadow.map = null
    if (this.data.landscape !== 'shore') this.releaseScenery()
  }

  private releaseScenery() {
    const geometries = new Set<Mesh['geometry']>()
    const materials = new Set<Material>()
    const images = new Set<ImageBitmap>()
    for (const texture of this.textures()) {
      if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) images.add(texture.image)
      texture.dispose()
    }
    for (const image of images) image.close()
    this.scenery.traverse(object => {
      if (!(object instanceof Mesh)) return
      geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
      if (object instanceof InstancedMesh) object.dispose()
    })
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
    this.scenery.clear()
    this.cameraBatches = []
    this.obstacles.length = 0
    this.prepared = false
  }

  private buildShore() {
    const sky = new Mesh(new SphereGeometry(125, 24, 16), new ShaderMaterial({
      side: BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 dir; void main(){dir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `
        varying vec3 dir;
        void main(){
          vec3 d=normalize(dir);
          float u=max(d.y,0.);
          vec3 sky=mix(vec3(.79,.62,.43),vec3(.12,.29,.36),smoothstep(0.,.61,u));
          float h=max(dot(d,normalize(vec3(-.67,.21,-.81))),0.);
          sky+=vec3(.43,.20,.065)*pow(h,15.);
          sky=mix(sky, vec3(1.0,.88,.54)*1.5, smoothstep(.9987,.9993,h));
          float clouds=sin(d.x*17.+sin(d.z*8.))*sin(d.z*26.+d.y*21.);
          sky+=vec3(.18,.135,.105)*smoothstep(.20,.85,clouds)*exp(-pow((d.y-.18)*5.,2.))*.48;
          gl_FragColor=vec4(sky,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    }))
    sky.frustumCulled = false
    this.scenery.add(sky)
    const plane = new PlaneGeometry(96, 96, 96, 96).rotateX(-Math.PI / 2)
    const pos = plane.attributes.position
    const colors = []
    const sand = new Color('#a99a7c'), edge = new Color('#746c49'), pale = new Color('#d3bc95')
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z)
      pos.setY(i, earth(x, z))
      const meander = Math.sin(x * .33 + z * .19) * Math.sin(z * .36 - x * .11)
      const c = sand.clone().lerp(pale, .2 + .35 * meander).lerp(edge, clamp((r - 13 + meander * 3) / 14, 0, 1))
      colors.push(c.r, c.g, c.b)
    }
    plane.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
    plane.computeVertexNormals()
    const floor = new Mesh(plane, new MeshStandardMaterial({ vertexColors: true, map: sandTexture(), roughness: 1 }))
    floor.receiveShadow = true
    this.scenery.add(floor)
    const ocean = new Mesh(new PlaneGeometry(250, 150).rotateX(-Math.PI / 2), new MeshStandardMaterial({ color: '#467e85', roughness: .45, metalness: .17 }))
    ocean.position.set(0, -.4, -102)
    this.scenery.add(ocean)
    let seed = 445
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
    const rocks: Prop[] = [], grass: Prop[] = [], trunks: Prop[] = [], crowns: Prop[] = [], waves: Prop[] = []
    const rock = (x: number, z: number, width: number, height: number, solid: boolean, y = earth(x, z)) => {
      rocks.push([x, y + height * .36, z, width, height, width * (.75 + rand() * .45), rand() * 6, new Color('#aaa18c').lerp(new Color('#4b5659'), rand())])
      if (solid) this.obstacles.push({ x, z, radius: width * .84, height: y + height * 1.28 })
    }
    for (let i = 0; i < 80; i++) {
      const a = i * Math.PI * 2 / 80, r = 27 + rand() * 9
      const x = Math.sin(a) * r, z = Math.cos(a) * r
      const open = z < -15 && Math.abs(x) < 19
      rock(x, z, open ? 1.1 + rand() * 2.1 : 2 + rand() * 3.5, open ? .6 + rand() * 1.7 : 2 + rand() * 7.5, true)
    }
    for (const [x, z, w, h] of [[-13,-4,2.1,2.4],[13,0,2.45,2.9],[9,-13,2.2,2.5],[-9,-14,2.4,2.3],[-12,12,2.15,2.55],[12,13,2,2.4],[0,-21,2.15,1.7]]) {
      rock(x, z, w, h, true)
      rock(x + w * .9, z + .65, .8, .7, true)
    }
    for (let i = 0; i < 115; i++) {
      const x = (rand() - .5) * 51, z = (rand() - .5) * 51, r = Math.hypot(x,z)
      if (r > 11 && r < 28) rock(x, z, .14 + rand() * .51, .10 + rand() * .48, false)
    }
    for (let i = 0; i < 34; i++) {
      const a = rand() * Math.PI * 2, r = 19 + rand() * 16
      const x = Math.sin(a) * r, z = Math.cos(a) * r
      if (z < -13 && Math.abs(x) < 16) continue
      const y = earth(x,z), h = 3 + rand() * 3.5
      trunks.push([x, y+h*.47, z, .18, h, .18, a, new Color('#6c5040')])
      for (let k = 0; k < 3; k++) crowns.push([x + k*.17,y+h*(.62+k*.21),z, h*(.36-k*.075), h*.45, h*(.34-k*.072), a+k, new Color('#475c43').lerp(new Color('#858660'), rand() * .63)])
      this.obstacles.push({ x,z,radius:.29,height:y+h })
    }
    for (let i = 0; i < 2250; i++) {
      const a = rand() * Math.PI * 2, r = 7 + rand() * 23
      const x = Math.sin(a) * r, z = Math.cos(a) * r
      if (r < 17 && (Math.sin(x*.6) + Math.cos(z*.5) < 1.18 || rand() < .60)) continue
      const h = .12 + rand() * .45
      grass.push([x,earth(x,z)+h*.47,z,.075+rand()*.1,h,.075+rand()*.09,a,new Color('#6b723c').lerp(new Color('#b8a964'),rand())])
    }
    for (let i = 0; i < 45; i++) {
      waves.push([(rand()-.5)*115,-.37,-45-rand()*68,1+rand()*9,.02,.05+rand()*.27,0,new Color('#6f9b9b')])
    }
    const batch = (g: BoxGeometry | ConeGeometry | CylinderGeometry | DodecahedronGeometry, props: Prop[], shadow: boolean, cameraFade = false) => {
      const mesh = new InstancedMesh(g, new MeshStandardMaterial({ roughness: .94, flatShading: true }), props.length)
      if (cameraFade) {
        g.computeBoundingBox()
        const bounds=g.boundingBox!
        this.fadeBatch(mesh,props.map(([x,y,z,sx,sy,sz])=>({
          x,z,radius:Math.max(sx,sz)*Math.max(bounds.max.x,bounds.max.z),
          bottom:y+sy*bounds.min.y,top:y+sy*bounds.max.y,
        })))
      }
      const obj = new Object3D()
      props.forEach(([x,y,z,sx,sy,sz,angle,color], i) => {
        obj.position.set(x,y,z); obj.scale.set(sx,sy,sz); obj.rotation.y = angle; obj.updateMatrix()
        mesh.setMatrixAt(i,obj.matrix); mesh.setColorAt(i,color)
      })
      mesh.castShadow = shadow; mesh.receiveShadow = shadow
      this.scenery.add(mesh)
    }
    batch(new DodecahedronGeometry(1, 0), rocks, true, true)
    batch(new CylinderGeometry(.52, 1, 1, 6), trunks, true, true)
    batch(new ConeGeometry(1, 1, 7), crowns, true, true)
    batch(new ConeGeometry(1, 1, 3), grass, false)
    batch(new BoxGeometry(1,1,1), waves, false)
  }
  activate(scene:Scene) {
    scene.background = new Color(this.data.background)
    scene.fog = new FogExp2(this.data.fog.color,this.data.fog.density)
    scene.add(this.root)
  }
  resolve(pos: Vector3, radius: number) {
    const limit = Math.max(0,this.radius - radius)
    const clampToArena = () => {
      const r=Math.hypot(pos.x,pos.z)
      if(r>limit) { pos.x*=limit/r; pos.z*=limit/r }
    }
    for (let pass = 0; pass < 3; pass++) {
      clampToArena()
      for (const o of this.obstacles) {
        const dx = pos.x - o.x, dz = pos.z - o.z, d = Math.hypot(dx,dz), gap = o.radius + radius
        if (d < gap) {
          pos.x = o.x + (d ? dx / d : 1) * gap
          pos.z = o.z + (d ? dz / d : 0) * gap
        }
      }
    }
    clampToArena()
    pos.y = this.height(pos.x, pos.z)
  }
  updateCameraVisibility(dt: number, eye?: Vector3, subject?: Vector3, secondSubject?: Vector3) {
    const reveal=damp(8,dt), hide=damp(33,dt)
    for (const batch of this.cameraBatches) {
      const {props,opacity}=batch
      let changed=false
      for(let i=0;i<props.length;i++) {
        const prop=props[i], current=opacity.getX(i)
        const obscures=eye && subject && (blocksView(prop,eye,subject,.40) ||
          (secondSubject && blocksView(prop,eye,secondSubject,.47)))
        const next=obscures?Math.min(.22,current)*(1-hide):current+(1-current)*reveal
        const value=next<.015?0:next>.99?1:next
        if(value!==current) { opacity.setX(i,value); changed=true }
      }
      if(changed) opacity.needsUpdate=true
    }
  }
}
