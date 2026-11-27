import { Vector3 } from 'three'
import { Battle } from '../battle'
import type { Attack } from '../config'
import { clamp, flatDistance, forward, wrap, yawTo } from '../math'
import { emperorMoves, type EmperorMoveId, type EmperorStrike } from './config'
import { EmperorTelegraph, inEmperorHitbox } from './telegraph'

const habitWindow = 7

export class EmperorBattle extends Battle {
  private readonly telegraph = new EmperorTelegraph(this.arena.height)
  readonly warning = this.telegraph.mesh
  private readonly attackCenter = new Vector3()
  private readonly guardFlank = new Vector3()
  private moveId?: EmperorMoveId
  private strikeIndex = 0
  private strikeYaw = 0
  private cooldownsByMove: Record<EmperorMoveId, number> = { fang: 0, cutoff: 0, combo: 0 }
  private lastRetreat = -Infinity
  private retreats = 0
  private lastQuickPunish = -Infinity
  private counterOpening = false
  private guardHold = 0
  private flankUntil = 0
  private nextFlank = 0

  override reset() {
    super.reset()
    this.moveId = undefined
    this.strikeIndex = this.retreats = this.guardHold = this.flankUntil = this.nextFlank = 0
    this.lastRetreat = this.lastQuickPunish = -Infinity
    this.counterOpening = false
    this.cooldownsByMove = { fang: 0, cutoff: 0, combo: 0 }
    this.telegraph?.hide()
  }

  protected override get attackDamageMultiplier() { return 1 }

  protected override canInterruptBoss() {
    return this.bossState === 'recovery' && !this.moveId
  }

  protected override onDodge(direction: Vector3) {
    const away = forward(yawTo(this.m, this.p), this.delta)
    if (away.dot(direction) > .62) {
      this.retreats = this.elapsed - this.lastRetreat <= habitWindow ? Math.min(2, this.retreats + 1) : 1
      this.lastRetreat = this.elapsed
    } else {
      this.retreats = Math.max(0, this.retreats - 1)
    }
  }

  protected override onAttackFinished(attack: Attack, hit: boolean) {
    this.counterOpening = !hit && (attack.id === 'swipe' || attack.id === 'spin' || attack.id === 'rush')
  }

  override update(...args: Parameters<Battle['update']>) {
    super.update(...args)
    if (this.outcome) this.telegraph.hide()
  }

  protected override updateBoss(dt: number) {
    this.guardHold = this.guarding ? this.guardHold + dt : 0
    if (this.moveId) {
      this.updateEmperorMove(this.moveId, dt)
      return
    }
    const distance = flatDistance(this.m, this.p)
    if (this.rage || this.bossHp > this.monster.data.hp * this.monster.data.rage.hpRatio) {
      if (this.bossState === 'recovery' && this.counterOpening && this.bt <= .24 && distance <= 4.3) {
        const side = Math.abs(wrap(yawTo(this.m, this.p) - this.bossYaw))
        if (side >= .55 && (this.playerState === 'swing' || this.playerState === 'cast')) {
          this.counterOpening = false
          const repeating = this.elapsed - this.lastQuickPunish <= 12
          this.lastQuickPunish = this.elapsed
          if (repeating && this.ready('fang')) {
            this.beginEmperorMove('fang', dt)
            return
          }
        }
      }
      if (this.bossState === 'approach' || this.bossState === 'turn') {
        if (this.rage && distance <= 5.3 && this.ready('combo')) {
          this.beginEmperorMove('combo', dt)
          return
        }
        if (distance >= 2.1 && distance <= 8.5 && this.retreats >= 2 &&
            this.elapsed - this.lastRetreat <= habitWindow && this.ready('cutoff')) {
          this.retreats = 0
          this.beginEmperorMove('cutoff', dt)
          return
        }
        if (this.updateGuardFlank(distance, dt)) return
      }
    }
    super.updateBoss(dt)
  }

  private ready(id: EmperorMoveId) {
    return this.elapsed >= this.cooldownsByMove[id]
  }

  private updateGuardFlank(distance: number, dt: number) {
    if (this.elapsed >= this.flankUntil) {
      if (this.guardHold < .72 || this.elapsed < this.nextFlank || distance < 1.9 || distance > 4.8) return false
      const yaw = yawTo(this.m, this.p)
      const outward = forward(yaw + Math.PI / 2, this.delta)
      const side = this.m.dot(outward) > 0 ? -1 : 1
      this.guardFlank.set(Math.cos(yaw) * side, 0, -Math.sin(yaw) * side)
      this.flankUntil = this.elapsed + .54
      this.nextFlank = this.elapsed + 4.4
      this.setBoss('turn')
    }
    this.bossYaw = yawTo(this.m, this.p)
    this.monster.root.rotation.y = this.bossYaw
    this.moveEntity(this.m, this.guardFlank, 4.7 * dt, this.monster.data.radius, this.p, .44)
    this.monster.animate('turn', dt)
    this.callout = '側面に回り込んでいる'
    return true
  }

  private beginEmperorMove(id: EmperorMoveId, dt: number) {
    this.moveId = id
    this.strikeIndex = 0
    this.cooldownsByMove[id] = this.elapsed + emperorMoves[id].cooldown
    this.beginStrike(id, dt)
  }

  private beginStrike(id: EmperorMoveId, dt: number) {
    const { strikes, label } = emperorMoves[id]
    const strike: EmperorStrike = strikes[this.strikeIndex]
    this.strikeYaw = this.bossYaw = yawTo(this.m, this.p)
    this.monster.root.rotation.y = this.bossYaw
    this.attackCenter.copy(this.m)
    if (strike.hitbox.kind === 'band') {
      // Place the strip across the escape route, about one backward roll away.
      this.attackCenter.copy(this.p).addScaledVector(forward(this.strikeYaw, this.delta), 2.25)
      this.attackCenter.y = this.arena.height(this.attackCenter.x, this.attackCenter.z)
    }
    this.telegraph.show(this.attackCenter, this.strikeYaw, strike.hitbox)
    this.monster.animate(strike.motion, dt, 0)
    this.setBoss('windup')
    this.callout = label + ' · ' + strike.warning
  }

  private updateEmperorMove(id: EmperorMoveId, dt: number) {
    const move = emperorMoves[id]
    const strike: EmperorStrike = move.strikes[this.strikeIndex]
    if (this.bossState === 'windup') {
      const t = clamp(this.bt / strike.windup, 0, 1)
      this.telegraph.pulse(t)
      this.monster.animate(strike.motion, dt, .60 * t)
      if (t >= 1) {
        this.setBoss('attack')
        this.callout = move.label
      }
      return
    }
    if (this.bossState === 'attack') {
      const t = clamp(this.bt / strike.active, 0, 1)
      this.telegraph.flash(t)
      this.monster.animate(strike.motion, dt, .60 + .40 * t)
      const impact = strike.active * .5
      if (this.bt >= impact && this.bt - dt < impact) this.impact(strike)
      if (t < 1 || this.outcome) return

      if (this.strikeIndex + 1 < move.strikes.length) {
        this.strikeIndex++
        this.beginStrike(id, 0)
        return
      }
      this.telegraph.hide()
      this.setBoss('recovery')
      this.callout = '攻撃後の隙'
      return
    }

    const t = clamp(this.bt / move.recovery, 0, 1)
    if (id === 'combo') this.monster.animate('emperorRest', dt, t)
    else this.monster.animate('idle', dt)
    if (t >= 1) {
      this.moveId = undefined
      this.callout = ''
      this.setBoss('approach')
    }
  }

  private impact(strike: EmperorStrike) {
    const heavy = strike.knockdown ?? false
    if (heavy) this.fx.shake = Math.max(this.fx.shake, .23)
    if (strike.hitbox.kind === 'band') this.fx.burst(this.attackCenter, 0xff9658, true, 1.3)
    if (inEmperorHitbox(this.p, this.attackCenter, this.strikeYaw, strike.hitbox)) {
      this.damagePlayer({ damage: Math.round(this.weapon.hp * strike.damageRatio), knockdown: heavy }, this.m)
    }
  }
}
