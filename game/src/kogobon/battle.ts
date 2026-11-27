import { Vector3 } from 'three'
import { Battle } from '../battle'
import { clamp, flatDistance, forward, smooth, wrap, yawTo } from '../math'
import { attacks, exhaustedTime, jumpRange, type KogobonAttack } from './config'
import { KogobonTelegraph } from './telegraph'

const attackVoices = {
  scream: 'kogobon-voice-1',
  slam: 'kogobon-voice-2',
  jump: 'kogobon-voice-3',
} as const

export class KogobonBattle extends Battle {
  private readonly telegraph = new KogobonTelegraph(this.arena.height)
  readonly warning = this.telegraph.mesh
  private readonly origin = new Vector3()
  private readonly impactCenter = new Vector3()
  private readonly ground = new Vector3()
  private readonly heading = new Vector3()
  private attackId: KogobonAttack | undefined
  private last: KogobonAttack | undefined
  private completed = 0
  private resolved = false

  override reset() {
    super.reset()
    this.attackId = this.last = undefined
    this.completed = 0
    this.resolved = false
    this.telegraph?.hide()
  }

  override get defeatDuration() { return 3 }

  protected override canInterruptBoss() { return false }

  override update(...args: Parameters<Battle['update']>) {
    super.update(...args)
    if (this.outcome) this.telegraph.hide()
  }

  protected override updateBoss(dt: number) {
    if (this.attackId) {
      this.updateAttack(dt, this.attackId)
      return
    }

    const distance = flatDistance(this.m, this.p)
    const next = this.chooseKogobonAttack(distance)
    const yaw = yawTo(this.m, this.p)
    if (next) {
      this.bossYaw = yaw
      this.monster.root.rotation.y = yaw
      this.beginKogobonAttack(next)
      this.monster.animate(attacks[next].charge, dt, 0)
      return
    }

    if (this.bossState !== 'approach') this.setBoss('approach')
    this.bossYaw += clamp(wrap(yaw - this.bossYaw), -dt * this.monster.data.ai.turnSpeed, dt * this.monster.data.ai.turnSpeed)
    this.monster.root.rotation.y = this.bossYaw
    this.moveEntity(this.m, forward(yaw, this.heading), dt * this.monster.data.speed,
      this.monster.data.radius, this.p, .44)
    this.monster.animate('walk', dt)
  }

  private chooseKogobonAttack(distance: number): KogobonAttack | undefined {
    if (!this.last) return distance <= attacks.scream.radius ? 'scream' : undefined
    if (distance <= attacks.slam.radius && this.last !== 'slam') return 'slam'
    if (distance <= attacks.scream.radius && this.last !== 'scream') return 'scream'
    if (distance >= 4.5 && distance <= jumpRange && this.last !== 'jump') return 'jump'
    return undefined
  }

  private beginKogobonAttack(id: KogobonAttack) {
    const attack = attacks[id]
    this.attackId = id
    this.resolved = false
    this.origin.copy(this.m)
    this.impactCenter.copy(id === 'jump' ? this.p : this.origin)
    if (id === 'jump') this.arena.resolve(this.impactCenter, this.monster.data.radius)
    this.telegraph.show(this.impactCenter, this.bossYaw, attack.radius, attack.halfAngle)
    this.setBoss('windup')
    this.callout = attack.label + ' · ' + attack.hint
  }

  private updateAttack(dt: number, id: KogobonAttack) {
    const attack = attacks[id]
    if (this.bossState === 'windup') {
      const progress = clamp(this.bt / attack.windup, 0, 1)
      this.telegraph.pulse(progress)
      this.monster.animate(attack.charge, dt, progress)
      if (progress >= 1 - 1e-6) {
        this.setBoss('attack')
        this.fx.sound(attackVoices[id], this.m)
      }
      return
    }

    if (this.bossState === 'attack') {
      const progress = clamp(this.bt / attack.duration, 0, 1)
      if (id === 'jump') {
        this.m.lerpVectors(this.origin, this.impactCenter, smooth(progress))
        this.m.y = this.arena.height(this.m.x, this.m.z)
      }
      this.monster.animate(attack.action, dt, progress)
      if (!this.resolved && this.bt + 1e-6 >= attack.impact) {
        this.resolved = true
        this.telegraph.hide()
        this.resolveImpact(id)
      }
      if (this.bt + 1e-6 >= attack.duration && !this.outcome) {
        this.completed++
        this.setBoss('recovery')
        this.callout = this.completed % 3 === 0 ? '息切れ · 反撃のチャンス' : '攻撃後の隙'
      }
      return
    }

    const exhausted = this.completed % 3 === 0
    const duration = exhausted ? exhaustedTime : attack.recovery
    this.monster.animate(exhausted ? 'kogobonExhausted' : 'kogobonRecovery', dt, clamp(this.bt / duration, 0, 1))
    if (this.bt + 1e-6 >= duration) {
      this.last = id
      this.attackId = undefined
      this.callout = ''
      this.setBoss('idle')
    }
  }

  private resolveImpact(id: KogobonAttack) {
    const attack = attacks[id]
    const distance = flatDistance(this.impactCenter, this.p)
    const angle = Math.abs(wrap(yawTo(this.impactCenter, this.p) - this.bossYaw))
    this.fx.sound(id === 'scream' ? 'air-pressure' : 'elastic-slam', this.impactCenter, id === 'jump' ? 1 : .88)
    if (id !== 'scream') this.fx.ring(this.impactCenter, .45, attack.radius, .36, 0xffa263)
    if (distance > attack.radius || distance > .01 && angle > attack.halfAngle) return

    // Direct landings still give guard a meaningful facing direction.
    const source = distance < .01
      ? this.ground.copy(this.impactCenter).add(forward(this.bossYaw + Math.PI, this.heading))
      : this.impactCenter
    this.damagePlayer(
      { damage: Math.round(this.weapon.hp * attack.damagePercent / 100), knockdown: false },
      source, 1, 1, { damageScale: 0, push: attack.push },
    )
  }
}
