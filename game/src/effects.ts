import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, Vector3 } from 'three'
import { clamp } from './math'
import type { BattleAudio, SoundCue } from './battle-audio'

type Fx = { mesh: Mesh<RingGeometry | SphereGeometry, MeshBasicMaterial>; life: number; total: number; size: number; end: number; strength: number; vx: number; vy: number; vz: number; ring: boolean }
type NumberFx = { node: HTMLSpanElement; p: Vector3; life: number }
export class Effects {
  readonly root = new Group()
  private entries: Fx[] = []
  private numbers: NumberFx[] = []
  private parent = document.querySelector('#numbers')!
  private screen = new Vector3()
  shake = 0
  hitstop = 0
  limit = 32
  private trailLife = 0
  private trailing = false
  private trailCount = 0
  private trailSamples = new Float32Array(48)
  private trailPositions = new Float32Array(126)
  private trail: Mesh<BufferGeometry,MeshBasicMaterial>

  constructor(private readonly audio?: BattleAudio) {
    const ribbon = new BufferGeometry()
    ribbon.setAttribute('position',new BufferAttribute(this.trailPositions,3))
    this.trail = new Mesh(ribbon,new MeshBasicMaterial({transparent:true,opacity:0,side:DoubleSide,depthWrite:false,toneMapped:false}))
    this.trail.visible=false; this.trail.frustumCulled=false; this.trail.renderOrder=4
    this.root.add(this.trail)
    const ring = new RingGeometry(.90,1,48).rotateX(-Math.PI/2)
    const spark = new SphereGeometry(.055,5,3)
    for (let i = 0; i < 58; i++) {
      const isRing = i < 13
      const mat = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide, toneMapped: false })
      const mesh = new Mesh(isRing ? ring : spark,mat)
      mesh.visible = false; mesh.renderOrder = 3
      this.root.add(mesh)
      this.entries.push({ mesh, life: 0, total: 0, size: 0, end: 0, strength: 0, vx: 0, vy: 0, vz: 0, ring: isRing })
    }
    for (let i = 0; i < 14; i++) {
      const node = document.createElement('span')
      node.hidden = true; this.parent.append(node)
      this.numbers.push({node,p:new Vector3(),life:0})
    }
  }
  blade(a: Vector3, b: Vector3, charged: boolean) {
    if (!this.trailing) this.trailCount=0
    this.trailing=true
    const samples=this.trailSamples
    samples.copyWithin(6,0,42)
    samples.set([a.x+(b.x-a.x)*.27,a.y+(b.y-a.y)*.27,a.z+(b.z-a.z)*.27,b.x,b.y,b.z])
    this.trailCount=Math.min(8,this.trailCount+1)
    let offset=0
    for (let i=0;i<this.trailCount-1;i++) {
      for (const index of [i*6,i*6+3,i*6+6,i*6+6,i*6+3,i*6+9]) {
        this.trailPositions[offset++]=samples[index]
        this.trailPositions[offset++]=samples[index+1]
        this.trailPositions[offset++]=samples[index+2]
      }
    }
    this.trail.geometry.setDrawRange(0,offset/3)
    this.trail.geometry.attributes.position.needsUpdate=true
    this.trail.material.color.setHex(charged?0xffb756:0xe7f9dc)
    this.trailLife=.118
  }
  endBlade() { this.trailing=false }
  ring(p: Vector3, from: number, to: number, life: number, color: number, opacity = .79) {
    const item = this.entries.find(e => e.ring && !e.life)
    if (!item) return
    this.spawn(item,p,life,from,to,color,opacity)
    item.mesh.position.y += .055
  }
  burst(p: Vector3,color: number,heavy: boolean,spread=1) {
    let count = Math.min(heavy ? 14 : 8,this.limit)
    for (const e of this.entries) {
      if (e.ring || e.life || count <= 0) continue
      count--
      this.spawn(e,p,.28+Math.random()*.25,heavy ? 2 : 1.3,.3,color,.93)
      e.vx = (Math.random()-.5)*8*spread; e.vy = 1+Math.random()*4; e.vz = (Math.random()-.5)*8*spread
    }
  }
  sound(cue: SoundCue, point: Vector3, intensity = 1) { this.audio?.play(cue,point,intensity) }

  hit(p: Vector3, value: number, caption: string, color: number, heavy: boolean, playerHit: boolean,
      cue: SoundCue = playerHit ? 'hit-player' : 'hit-flesh') {
    this.sound(cue,p,heavy ? 1 : .79)
    this.burst(p,color,heavy)
    const number = this.numbers.find(n => !n.life) ?? this.numbers[0]
    number.p.copy(p); number.life = .88
    number.node.textContent = String(value)
    if (caption) {
      const label = document.createElement('small')
      label.textContent = caption; number.node.append(label)
    }
    number.node.className = playerHit ? 'hurt-number' : heavy ? 'heavy-number' : ''
    this.shake = Math.max(this.shake,heavy ? .32 : .14)
    this.hitstop = Math.max(this.hitstop,heavy ? .082 : .042)
  }
  private spawn(e: Fx,p: Vector3,life: number,from: number,to: number,color: number,opacity: number) {
    e.life=e.total=life; e.size=from; e.end=to; e.strength=opacity
    e.mesh.material.color.setHex(color)
    e.mesh.material.opacity=opacity; e.mesh.visible=true
    e.mesh.position.copy(p); e.mesh.scale.setScalar(from)
  }
  update(dt: number, project: (p: Vector3) => Vector3) {
    this.trailLife=Math.max(0,this.trailLife-dt)
    this.trail.visible=this.trailLife>0 && this.trailCount>1
    this.trail.material.opacity=this.trailLife*4.4
    for (const e of this.entries) {
      if (!e.life) continue
      e.life = Math.max(0,e.life-dt)
      e.mesh.visible = e.life > 0
      const t = 1-e.life/e.total
      e.mesh.scale.setScalar(e.size+(e.end-e.size)*t)
      e.mesh.material.opacity = e.strength*(1-t*t)
      if (!e.ring) {
        e.mesh.position.x += e.vx*dt; e.mesh.position.y += e.vy*dt; e.mesh.position.z += e.vz*dt; e.vy -= 9*dt
      }
    }
    for (const n of this.numbers) {
      if (!n.life) continue
      n.life = Math.max(0,n.life-dt)
      this.screen.copy(n.p).y += (1-n.life)*.94
      const screen = project(this.screen)
      n.node.hidden = !n.life || screen.z < -1 || screen.z > 1 || Math.abs(screen.x) > 1.05 || Math.abs(screen.y) > 1.05
      n.node.style.left = `${(screen.x*.5+.5)*100}%`
      n.node.style.top = `${(.5-screen.y*.5)*100}%`
      n.node.style.opacity = String(clamp(n.life*3,0,1))
    }
    this.shake = Math.max(0,this.shake-dt*1.35)
  }
  clear() {
    this.hitstop = this.shake = this.trailLife = 0
    this.trailing=this.trail.visible=false
    for (const e of this.entries) { e.life=0; e.mesh.visible=false }
    for (const n of this.numbers) { n.life=0; n.node.hidden=true }
  }
}
