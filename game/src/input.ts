const actions = ['attack','charge','dodge','guard','lock','pause'] as const
export type Action = (typeof actions)[number]
const mapping: Record<string, Action> = { KeyJ: 'attack', KeyK: 'charge', Space: 'dodge', KeyL: 'guard', KeyQ: 'lock', Escape: 'pause', KeyP: 'pause' }
const movement = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'])
export class Controls {
  enabled = false
  coarse = matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0
  private keys = new Set<string>()
  private pointers = new Map<number, Action>()
  private pressed = new Set<Action>()
  private released = new Set<Action>()
  private stickId: number | null = null
  private lookId: number | null = null
  private stickX = 0
  private stickY = 0
  private stickOriginX = 0
  private stickOriginY = 0
  private stickRange = 30
  lookX = 0
  private stick: HTMLElement
  private knob: HTMLElement
  private lastX = 0

  constructor(canvas: HTMLCanvasElement) {
    this.stick = document.querySelector('#stick')!
    this.knob = this.stick.querySelector('i')!
    const stickZone = document.querySelector<HTMLElement>('#stick-zone')!
    addEventListener('keydown', e => {
      if (mapping[e.code] === 'pause' && !e.repeat) { this.pressed.add('pause'); e.preventDefault(); return }
      if (!this.enabled || !(mapping[e.code] || movement.has(e.code))) return
      e.preventDefault()
      const action = mapping[e.code]
      if (action && !e.repeat) this.pressed.add(action)
      this.keys.add(e.code)
    })
    addEventListener('keyup', e => {
      if (this.keys.delete(e.code) && mapping[e.code] && !this.held(mapping[e.code])) this.released.add(mapping[e.code])
    })
    addEventListener('blur', () => {
      if (this.enabled) { this.clear(); this.pressed.add('pause') }
    })
    document.addEventListener('visibilitychange', () => {
      if (this.enabled && document.hidden) { this.clear(); this.pressed.add('pause') }
    })
    document.addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault() })
    document.addEventListener('gesturestart', e => { if (this.enabled) e.preventDefault() }, { passive: false })
    stickZone.onpointerdown = e => {
      if (!this.enabled || this.stickId !== null) return
      this.stickId = e.pointerId
      stickZone.setPointerCapture(e.pointerId)
      const bounds = this.stick.getBoundingClientRect()
      const zone = stickZone.getBoundingClientRect()
      const radius = bounds.width / 2
      const centerX = bounds.left + radius, centerY = bounds.top + radius
      const onStick = Math.hypot(e.clientX-centerX,e.clientY-centerY)<=radius
      this.stickOriginX = onStick ? centerX : e.clientX
      this.stickOriginY = onStick ? centerY : e.clientY
      this.stickRange = Math.max(24,radius*.49)
      if (!onStick) {
        const x = Math.max(zone.left+radius+6,Math.min(zone.right-radius,e.clientX))
        const y = Math.max(zone.top+radius,Math.min(zone.bottom-radius-10,e.clientY))
        this.stick.style.translate = `${x-centerX}px ${y-centerY}px`
      }
      this.stick.classList.add('steering')
      this.steer(e)
    }
    stickZone.onpointermove = e => { if (e.pointerId === this.stickId) this.steer(e) }
    const endStick = (e: PointerEvent) => { if (e.pointerId === this.stickId) this.resetStick() }
    stickZone.onpointerup = stickZone.onpointercancel = stickZone.onlostpointercapture = endStick
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      const action = button.dataset.action as Action
      button.onpointerdown = e => {
        if (!this.enabled) return
        e.preventDefault()
        button.setPointerCapture(e.pointerId)
        this.pointers.set(e.pointerId,action)
        this.pressed.add(action)
        button.classList.add('held')
      }
      const release = (e: PointerEvent) => {
        if (this.pointers.get(e.pointerId) !== action) return
        this.pointers.delete(e.pointerId)
        if (!this.held(action)) { this.released.add(action); button.classList.remove('held') }
      }
      button.onpointerup = button.onpointercancel = button.onlostpointercapture = release
    }
    canvas.onpointerdown = e => {
      if (!this.enabled || this.lookId !== null || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return
      this.lookId = e.pointerId
      this.lastX = e.clientX
      canvas.setPointerCapture(e.pointerId)
    }
    canvas.onpointermove = e => {
      if (this.lookId !== e.pointerId) return
      this.lookX += e.clientX - this.lastX
      this.lastX = e.clientX
    }
    const endLook = (e: PointerEvent) => { if (this.lookId === e.pointerId) this.lookId = null }
    canvas.onpointerup = canvas.onpointercancel = canvas.onlostpointercapture = endLook
  }

  private steer(e: PointerEvent) {
    const x=e.clientX-this.stickOriginX, y=e.clientY-this.stickOriginY
    const length=Math.hypot(x,y)
    const strength=Math.min(1,Math.max(0,(length-3)/(this.stickRange-3)))
    const response=strength ** .82
    this.stickX = length ? x/length*response : 0
    this.stickY = length ? y/length*response : 0
    this.knob.style.translate = `${this.stickX*this.stickRange}px ${this.stickY*this.stickRange}px`
  }
  private resetStick() {
    this.stickId = null
    this.stickX = this.stickY = 0
    this.stick.classList.remove('steering')
    this.stick.style.translate = ''
    this.knob.style.translate = ''
  }
  movement(out: {x: number; y: number}) {
    const has = (a: string,b: string) => Number(this.keys.has(a) || this.keys.has(b))
    const x = this.stickX + has('KeyD','ArrowRight') - has('KeyA','ArrowLeft')
    const y = this.stickY + has('KeyS','ArrowDown') - has('KeyW','ArrowUp')
    const size = Math.max(1,Math.hypot(x,y))
    out.x=x/size; out.y=y/size
  }
  take(action: Action) { return this.pressed.delete(action) }
  wasReleased(action: Action) { return this.released.delete(action) }
  held(action: Action) {
    for (const key of this.keys) if (mapping[key] === action) return true
    for (const value of this.pointers.values()) if (value === action) return true
    return false
  }
  endFrame() { this.pressed.clear(); this.released.clear(); this.lookX=0 }
  clear() {
    this.endFrame()
    this.keys.clear(); this.pointers.clear()
    this.lookId = null
    this.resetStick()
    for (const button of document.querySelectorAll('.held')) button.classList.remove('held')
  }
}
