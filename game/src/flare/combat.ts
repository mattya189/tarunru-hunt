import { Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry, Vector3 } from 'three'
import { clamp, flatDistance, forward, pointSegmentSquared } from '../math'
import type { Arena } from '../world'

export const emberHop = {
  distanceRatio:.7, moveDuration:.20, duration:.28, cooldown:8,
  delay:.60, radius:1.5, damageRatio:.3, color:0xff792c,
} as const

export const maxEnergy = 300
export const flareSpells = [
  { name:'フレアⅠ', sound:'flare-1', clip:'Flare1', cost:75, damage:140, radius:2.5, release:.20, duration:.50, dodgeDelay:.18, color:0xff792c },
  { name:'フレアⅡ', sound:'flare-2', clip:'Flare2', cost:180, damage:400, radius:4, release:.60, duration:1.20, dodgeDelay:.30, color:0xef183b },
  { name:'フレアⅢ', sound:'flare-3', clip:'Flare3', cost:300, damage:880, radius:6, release:1.20, duration:2.20, dodgeDelay:.45, color:0xffbc42 },
] as const
export type Spell = (typeof flareSpells)[number]
type Cast = {
  clip: 'EnergyShot' | Spell['clip']; release:number; duration:number; dodgeDelay:number; spell?:Spell; aimed?:boolean
}
export type HitVolume = (center:Vector3,radius:number)=>number

const shotRange = 8
const shotSpeed = 25
const shotFullDamageRange = 2
const shotMaxDamage = 40
const shotMinDamage = 1

export class FlareCombat {
  energy = 0
  cast?: Cast
  private shot!: Mesh
  private ember!: Mesh
  private emberAt?: number
  private shotReady = 0
  private releasedAt?: number
  private start = new Vector3()
  private previous = new Vector3()
  private direction = new Vector3()
  private ground = new Vector3()
  private traveled = 0

  attach(root:Group) {
    if(this.shot) return
    this.shot=new Mesh(new SphereGeometry(.19,10,8),new MeshBasicMaterial({color:0xff823e,toneMapped:false}))
    this.shot.visible=false
    this.ember=new Mesh(new RingGeometry(.86,1,40).rotateX(-Math.PI/2),
      new MeshBasicMaterial({color:emberHop.color,depthWrite:false,toneMapped:false}))
    this.ember.scale.setScalar(emberHop.radius)
    this.ember.visible=false
    root.add(this.shot,this.ember)
  }

  reset() {
    this.energy=0; this.cast=undefined; this.shotReady=0
    if(this.shot) this.stop()
  }

  get available() { return this.energy>=flareSpells[2].cost?flareSpells[2]:this.energy>=flareSpells[1].cost?flareSpells[1]:this.energy>=flareSpells[0].cost?flareSpells[0]:undefined }

  begin(attack:boolean, special:boolean, elapsed:number, aimed:boolean) {
    const spell=special?this.available:undefined
    if(spell) {
      this.energy-=spell.cost
      this.cast={...spell,spell}
    } else if(attack && elapsed>=this.shotReady && !this.shot.visible) {
      this.shotReady=elapsed+.90
      this.cast={clip:'EnergyShot',release:.25,duration:.50,dodgeDelay:.10,aimed}
    } else return false
    this.releasedAt=undefined
    return true
  }

  release(time:number) {
    if(!this.cast || this.releasedAt!==undefined || time<this.cast.release) return
    this.releasedAt=time
    return this.cast
  }

  canDodge(time:number) {
    return !!this.cast && this.releasedAt!==undefined && time-this.releasedAt+1e-9>=this.cast.dodgeDelay
  }

  launch(hand:Vector3,yaw:number,aim?:Vector3) {
    this.start.copy(hand)
    this.previous.copy(hand)
    this.shot.position.copy(hand)
    if(aim) this.direction.subVectors(aim,hand).normalize()
    else forward(yaw,this.direction)
    this.traveled=0
    this.shot.visible=true
  }

  tick(dt:number,arena:Arena,hit:(volume:HitVolume,damage:number)=>number) {
    if(!this.shot.visible) return
    const p=this.shot.position
    this.previous.copy(p)
    const travel=Math.min(shotRange-this.traveled,dt*shotSpeed)
    this.traveled+=travel
    p.copy(this.start).addScaledVector(this.direction,this.traveled)
    this.ground.copy(p); arena.resolve(this.ground,.05)
    if(this.ground.y>=p.y || flatDistance(this.ground,p)>.02) {
      this.shot.visible=false
      return
    }
    const falloff=clamp((this.traveled-shotFullDamageRange)/(shotRange-shotFullDamageRange),0,1)
    const damage=Math.round(shotMaxDamage-(shotMaxDamage-shotMinDamage)*falloff)
    const dealt=hit((center,radius)=>pointSegmentSquared(center,this.previous,p)/(radius+.19)**2,damage)
    if(dealt>=0 || this.traveled>=shotRange) this.shot.visible=false
    if(dealt>0) this.energy=Math.min(maxEnergy,this.energy+dealt*.375)
  }

  plantEmber(position:Vector3, elapsed:number) {
    this.ember.position.copy(position)
    this.ember.position.y+=.06
    this.ember.visible=true
    this.emberAt=elapsed+emberHop.delay
  }

  releaseEmber(elapsed:number) {
    if(this.emberAt===undefined || elapsed+1e-9<this.emberAt) return
    this.emberAt=undefined
    this.ember.visible=false
    return this.ember.position
  }

  stop() {
    this.cast=undefined
    this.shot.visible=false
    this.emberAt=undefined
    this.ember.visible=false
  }
}
