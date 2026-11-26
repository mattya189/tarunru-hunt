import { BoxGeometry, CylinderGeometry, DodecahedronGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Shape, Vector3 } from 'three'
import { clamp, mix, smooth } from './math'

export type HunterPose = 'idle' | 'run' | 'dodge' | 'charge' | 'swing' | 'guard' | 'hit' | 'down' | 'rise'
type Segment = { group: Group; length: number }
const up = new Vector3(0,1,0)
export class HunterModel {
  root = new Group()
  private posture = new Group()
  private torso = new Group()
  private head = new Group()
  private scarf = new Group()
  private weapon = new Group()
  private grip = new Object3D()
  private secondGrip = new Object3D()
  private heel = new Object3D()
  private tip = new Object3D()
  private shoulders: Segment[] = []
  private arms: Segment[] = []
  private thighs: Group[] = []
  private shins: Group[] = []
  private elbow = new Vector3()
  private hand = new Vector3()
  private shoulder = new Vector3()
  private dir = new Vector3()
  private stride = 0

  constructor() {
    const iron = new MeshStandardMaterial({ color: '#85948a', roughness: .42, metalness: .27 })
    const edge = new MeshStandardMaterial({ color: '#dbd8be', roughness: .33, metalness: .55 })
    const cloth = new MeshStandardMaterial({ color: '#294342', roughness: .94 })
    const leather = new MeshStandardMaterial({ color: '#372e24', roughness: .91 })
    const gold = new MeshStandardMaterial({ color: '#b49050', roughness: .55, metalness: .42 })
    const red = new MeshStandardMaterial({ color: '#a54734', roughness: .93 })
    const dark = new MeshStandardMaterial({ color: '#141d1c', roughness: .65 })
    const box = (parent: Object3D, m: MeshStandardMaterial, w: number,h: number,d: number,x=0,y=0,z=0) => {
      const mesh = new Mesh(new BoxGeometry(w,h,d),m)
      mesh.position.set(x,y,z); mesh.castShadow = true; parent.add(mesh); return mesh
    }
    const oval = (parent: Object3D, m: MeshStandardMaterial, w: number,h: number,d: number,x=0,y=0,z=0) => {
      const mesh = new Mesh(new DodecahedronGeometry(1,0),m)
      mesh.position.set(x,y,z); mesh.scale.set(w,h,d); mesh.castShadow = true; parent.add(mesh); return mesh
    }
    this.root.add(this.posture)
    this.posture.add(this.torso, this.weapon)
    this.torso.position.y = 1.04
    oval(this.torso,cloth,.40,.51,.25,0,.28)
    oval(this.torso,iron,.42,.36,.25,0,.41,.065)
    box(this.torso,leather,.62,.135,.48,0,-.07,0)
    box(this.torso,gold,.18,.15,.05,0,-.075,.255)
    box(this.torso,leather,.12,.73,.067,.03,.29,-.25).rotation.z = -.57
    box(this.torso,gold,.24,.11,.025,0,.4,.318)
    for(const side of [-1,1]) {
      const plate = oval(this.torso,iron,.21,.31,.17,side*.29,-.18,.065)
      plate.rotation.z = side*.15
      box(this.torso,cloth,.17,.36,.07,side*.22,-.23,.23)
      const pack = box(this.torso,leather,.16,.25,.21,side*.31,-.08,-.22)
      pack.rotation.z = side*.1
    }
    this.head.position.set(0,.76,0)
    this.torso.add(this.head)
    oval(this.head,iron,.24,.27,.225,0,.15)
    box(this.head,dark,.32,.072,.12,0,.151,.173)
    box(this.head,edge,.36,.044,.10,0,.21,.174)
    box(this.head,iron,.22,.09,.15,0,.067,.16)
    oval(this.head,red,.255,.11,.263,0,-.01,0)
    this.scarf.position.set(.11,.01,-.18)
    this.head.add(this.scarf)
    box(this.scarf,red,.19,.62,.035,.035,-.25,-.17).rotation.x = .55
    for (const side of [-1,1]) {
      const thigh = new Group(), shin = new Group()
      thigh.position.set(side*.20,1.05,.015)
      shin.position.y = -.47
      this.thighs.push(thigh); this.shins.push(shin)
      this.posture.add(thigh); thigh.add(shin)
      oval(thigh,cloth,.177,.3,.18,0,-.20,0)
      oval(shin,iron,.148,.22,.15,0,-.11,.04)
      box(shin,leather,.23,.27,.23,0,-.34,0)
      box(shin,dark,.26,.15,.39,0,-.44,.08)
      box(shin,iron,.24,.075,.20,0,-.42,.19)
      const upper = new Group(), lower = new Group()
      this.torso.add(upper,lower)
      oval(upper,iron,.224,.21,.205)
      oval(upper,cloth,.14,.24,.14,0,-.20,0)
      oval(lower,iron,.135,.22,.13,0,-.155,0)
      oval(lower,leather,.10,.12,.095,0,-.30,0)
      this.shoulders.push({group: upper,length: .38})
      this.arms.push({group: lower,length: .37})
    }
    const handle = new Mesh(new CylinderGeometry(.06,.06,.48,7),leather)
    this.weapon.add(handle)
    box(this.weapon,gold,.53,.09,.16,0,.26,0)
    box(this.weapon,iron,.22,.12,.13,0,-.25,0)
    const profile = new Shape()
    profile.moveTo(-.18,.29); profile.lineTo(.18,.29); profile.lineTo(.23,.51)
    profile.lineTo(.20,1.77); profile.lineTo(.04,2.06); profile.lineTo(-.21,1.81); profile.lineTo(-.23,.50); profile.closePath()
    const blade = new Mesh(new ExtrudeGeometry(profile,{ depth: .045, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .027, bevelThickness: .025 }),[iron,edge])
    blade.position.z = -.025
    blade.castShadow = true; this.weapon.add(blade)
    box(this.weapon,edge,.064,1.42,.033,0,1.06,.04)
    box(this.weapon,gold,.16,.16,.041,0,.54,.049).rotation.z = Math.PI/4
    this.grip.position.y = .105; this.secondGrip.position.y = -.12
    this.heel.position.y = .31; this.tip.position.y = 2.06
    this.weapon.add(this.grip,this.secondGrip,this.heel,this.tip)
  }

  showSword(visible:boolean) { this.posture.visible=visible }

  pose(state: HunterPose, p: number, dt: number, combo: number, moving: number) {
    this.stride += dt * 11.3
    const run = state === 'run' ? moving : 0
    const step = Math.sin(this.stride)*run
    const recover = state === 'rise' ? smooth(p) : 0
    this.posture.position.y = -.05 + Math.abs(step) * .047
    this.posture.rotation.set(0,0,0)
    this.torso.rotation.set(run*.115,0,0)
    this.head.rotation.y = step*.07
    this.scarf.rotation.x = -.35 - run*.75 + Math.sin(this.stride)*.10
    this.scarf.rotation.z = Math.cos(this.stride)*.12
    this.thighs[0].rotation.x = step*.74
    this.thighs[1].rotation.x = -step*.74
    this.shins[0].rotation.x = Math.max(0,-step)*.89
    this.shins[1].rotation.x = Math.max(0,step)*.89
    let wx = .60, wy = 1.17, wz = .13, pitch = -.56, bank = -.35
    if (run) { wx = .56; wy = .99; wz = -.13; pitch = -1.02; bank = -.42 }
    if (state === 'swing') {
      // p = 0..1 windup, 1..2 active, 2..3 recovery.
      const a = p < 1 ? smooth(p) : p < 2 ? smooth(p-1) : smooth(p-2)
      const reverse = combo === 1 ? -1 : 1
      const overhead = combo >= 2
      if (p < 1) {
        wx = mix(.6, .54*reverse,a); wy = mix(1.17,1.58,a); wz = mix(.13,-.29,a)
        pitch = mix(-.56,overhead ? -1.42 : -.27,a); bank = mix(-.35, -.96*reverse,a)
      } else if (p < 2) {
        wx = mix(.54*reverse,-.52*reverse,a); wy = mix(1.58,overhead ? .76 : 1.21,a); wz = mix(-.29,.77,Math.sin(a*Math.PI*.5))
        pitch = mix(overhead ? -1.42 : -.27,overhead ? 1.82 : 1.10,a); bank = mix(-.96*reverse,.92*reverse,a)
      } else {
        wx = mix(-.52*reverse,.60,a); wy = mix(overhead ? .76 : 1.21,1.17,a); wz = mix(.77,.13,a)
        pitch = mix(overhead ? 1.82 : 1.10,-.56,a); bank = mix(.92*reverse,-.35,a)
      }
      this.torso.rotation.y = -wx*.53
      this.torso.rotation.x = (1.23-wy)*.72
      this.thighs[1].rotation.x = -.23
    }
    if (state === 'charge') {
      wx=.57; wy=mix(1.2,1.59,smooth(p*3)); wz=mix(.13,-.32,smooth(p*3))
      pitch=mix(-.56,-1.42,smooth(p*3)); bank=mix(-.35,-.96,smooth(p*3))
      this.torso.rotation.y = -.34
    }
    if (state === 'guard') { wx=.10; wy=1.27; wz=.55; pitch=.12; bank=-1.02; this.torso.rotation.x=.20 }
    if (state === 'dodge') {
      const bend = Math.sin(p*Math.PI)
      this.posture.rotation.x = (p > .04 ? p*2*Math.PI : 0)
      this.posture.position.y += 1.02*(1-Math.cos(this.posture.rotation.x)) + .05*bend
      this.thighs[0].rotation.x = this.thighs[1].rotation.x = -1.1*bend
      this.shins[0].rotation.x = this.shins[1].rotation.x = 1.45*bend
      pitch = -.86; wy = .94; wx=.46
    }
    if (state === 'hit') this.torso.rotation.x = -.28*Math.sin(p*Math.PI)
    if (state === 'down' || state === 'rise') {
      const lean = state === 'down' ? smooth(p*4) : 1-recover
      this.posture.rotation.x = -1.47 * lean
      this.posture.position.y += .27*lean
      this.thighs[1].rotation.x = .22*lean
      wy=.93; pitch=-.26
    }
    this.weapon.position.set(wx,wy,wz)
    this.weapon.rotation.set(pitch,0,bank,'YXZ')
    this.posture.updateMatrixWorld(true)
    this.placeArm(1,this.grip,false)
    this.placeArm(0,this.secondGrip,state === 'run' || state === 'idle' || state === 'dodge')
  }
  private placeArm(i: number, grip: Object3D, free: boolean) {
    const side = i === 0 ? -1 : 1
    const shoulder = this.shoulder.set(side*.38,.45,0)
    const hand = free ? this.hand.set(-.43,-.14,.05 + Math.sin(this.stride)*.08) : this.torso.worldToLocal(grip.getWorldPosition(this.hand))
    const elbow = this.elbow.copy(shoulder).lerp(hand,.49)
    elbow.x += side*.15; elbow.y -= .17; elbow.z -= .05
    this.placeSegment(this.shoulders[i], shoulder, elbow)
    this.placeSegment(this.arms[i], elbow, hand)
  }
  private placeSegment(segment: Segment, start: Vector3, end: Vector3) {
    segment.group.position.copy(start)
    this.dir.subVectors(start,end)
    segment.group.scale.y = clamp(this.dir.length()/segment.length,.55,1.5)
    segment.group.quaternion.setFromUnitVectors(up,this.dir.normalize())
  }
  blade(start: Vector3, end: Vector3) {
    this.heel.getWorldPosition(start); this.tip.getWorldPosition(end)
  }
}
