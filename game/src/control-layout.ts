import { clamp } from './math'

const labels = {
  stick: '移動スティック', attack: '斬撃', charge: '溜め斬り', skill: '踏み込み／残火',
  guard: 'ガード', dodge: '回避', lock: '照準', pause: '一時停止',
}
type Control = keyof typeof labels
const controls = Object.keys(labels) as Control[]
type Placement = { x: number; y: number; scale: number }
type Layout = Partial<Record<Control, Placement>>
type Orientation = 'portrait' | 'landscape'
type Dimensions = { width: number; height: number; gameWidth: number; left: number }
const storageKeys = { portrait: 'shiosai-control-layout', landscape: 'shiosai-control-layout-landscape' }
const minScale = .65
const maxScale = 1.60
const keyboardSteps: Record<string, readonly [number, number]> = { ArrowLeft: [-1,0], ArrowRight: [1,0], ArrowUp: [0,-1], ArrowDown: [0,1] }

function readLayout(orientation: Orientation): Layout {
  const layout: Layout = {}
  try {
    const saved = JSON.parse(localStorage.getItem(storageKeys[orientation]) ?? '{}')
    for (const id of controls) {
      const value = saved?.[id]
      if (!value || ![value.x, value.y, value.scale].every(Number.isFinite)) continue
      layout[id] = { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1), scale: clamp(value.scale, minScale, maxScale) }
    }
  } catch { /* Storage is optional. */ }
  return layout
}

export class ControlLayout {
  private readonly surface = document.querySelector<HTMLElement>('#touch')!
  private readonly editor = document.querySelector<HTMLElement>('#control-editor')!
  private readonly panelSide = this.editor.querySelector<HTMLButtonElement>('#layout-panel-side')!
  private readonly panelToggle = this.editor.querySelector<HTMLButtonElement>('#layout-panel-toggle')!
  private readonly select = this.editor.querySelector<HTMLSelectElement>('#control-item')!
  private readonly range = this.editor.querySelector<HTMLInputElement>('#control-size')!
  private readonly output = this.editor.querySelector<HTMLOutputElement>('output')!
  private readonly elements = new Map(controls.map(id => [id, this.surface.querySelector<HTMLElement>(`[data-control="${id}"]`)!]))
  private readonly game = document.querySelector<HTMLElement>('#game')!
  private orientation: Orientation = 'portrait'
  private saved = { portrait: readLayout('portrait'), landscape: readLayout('landscape') }
  private draft?: Record<Orientation, Layout>
  private selected: Control = 'stick'
  private drag?: { pointer: number; offsetX: number; offsetY: number }
  private readonly centers = new Map<Control, { x: number; y: number }>()

  constructor(back: () => void) {
    for (const id of controls) this.select.add(new Option(labels[id], id))
    this.select.addEventListener('change', () => this.selectControl(this.select.value as Control))
    this.range.addEventListener('input', () => {
      const scale = this.range.valueAsNumber / 100
      this.change({ ...this.placement(this.selected, this.dimensions()), scale })
    })
    this.bindButton('layout-panel-side', () => this.placePanel(this.editor.dataset.edge === 'top' ? 'bottom' : 'top'))
    this.bindButton('layout-panel-toggle', () => {
      this.collapsePanel(this.editor.dataset.collapsed !== 'true')
      this.keepPanelClear()
    })
    this.bindButton('layout-default', () => {
      this.draft![this.orientation] = {}
      this.refresh()
      this.keepPanelClear()
    })
    this.bindButton('layout-cancel', back)
    this.bindButton('layout-save', () => {
      this.saved = this.draft!
      try {
        localStorage.setItem(storageKeys.portrait, JSON.stringify(this.saved.portrait))
        localStorage.setItem(storageKeys.landscape, JSON.stringify(this.saved.landscape))
      } catch { /* Use the layout for this session. */ }
      back()
    })
    this.surface.addEventListener('pointerdown', event => this.beginDrag(event))
    this.surface.addEventListener('pointermove', event => {
      if (event.pointerId !== this.drag?.pointer) return
      const point = this.pointerPosition(event)
      this.placeAt(point.x + this.drag.offsetX, point.y + this.drag.offsetY)
    })
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      this.surface.addEventListener(eventName, event => {
        if (event.pointerId !== this.drag?.pointer) return
        this.cancelDrag()
        this.keepPanelClear()
      })
    }
    this.editor.addEventListener('keydown', event => {
      const offset = keyboardSteps[event.key]
      if (!this.draft || !offset || !event.altKey) return
      event.preventDefault()
      const center = this.centers.get(this.selected)!
      this.placeAt(center.x + offset[0] * 5, center.y + offset[1] * 5)
      this.keepPanelClear()
    })
  }

  open() {
    this.draft = { portrait: { ...this.saved.portrait }, landscape: { ...this.saved.landscape } }
    this.editor.hidden = false
    this.placePanel('top')
    this.collapsePanel(false)
    this.surface.classList.add('editing')
    this.selectControl(this.selected)
    this.editor.querySelector<HTMLElement>('h2')!.focus({ preventScroll: true })
  }

  close() {
    if (!this.draft) return
    this.draft = undefined
    this.cancelDrag()
    this.surface.classList.remove('editing')
    this.editor.hidden = true
  }

  setLandscape(landscape: boolean) {
    this.cancelDrag()
    this.orientation=landscape?'landscape':'portrait'
  }

  private cancelDrag() {
    const pointer = this.drag?.pointer
    this.drag = undefined
    this.editor.classList.remove('dragging')
    if (pointer !== undefined && this.surface.hasPointerCapture(pointer)) this.surface.releasePointerCapture(pointer)
  }

  refresh() {
    const screen = this.dimensions()
    const { width, height, gameWidth } = screen
    if (!width || !height) return
    for (const [id, node] of this.elements) {
      const choice = this.placement(id, screen)
      const size = Math.min(width, height, this.baseSize(id, gameWidth) * choice.scale)
      const radius = size * .5
      const x = clamp(choice.x * width, radius, width - radius)
      const y = clamp(choice.y * height, radius, height - radius)
      this.centers.set(id, { x, y })
      node.style.setProperty('--control-size', `${size}px`)
      node.style.left = `${x}px`
      node.style.top = `${y}px`
      node.classList.toggle('selected-control', !!this.draft && id === this.selected)
    }
    if (this.draft) {
      const percent = Math.round(this.placement(this.selected, screen).scale * 100)
      this.range.value = String(percent)
      this.output.value = `${percent}%`
    }
  }

  private bindButton(id: string, action: () => void) {
    const button = this.editor.querySelector<HTMLButtonElement>('#' + id)!
    let touch: { id: number; x: number; y: number } | undefined
    const activate = () => { if (this.draft) action() }
    button.addEventListener('click', event => {
      if (!('pointerType' in event) || event.pointerType !== 'touch') activate()
    })
    // Handle a tap even when the browser suppresses the click after a drag.
    button.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') touch = { id: event.pointerId, x: event.clientX, y: event.clientY }
    })
    button.addEventListener('pointercancel', () => { touch = undefined })
    button.addEventListener('pointerup', event => {
      if (touch?.id !== event.pointerId) return
      const traveled = Math.hypot(event.clientX - touch.x, event.clientY - touch.y)
      touch = undefined
      if (traveled <= 10 && button.contains(document.elementFromPoint(event.clientX, event.clientY))) activate()
    })
  }

  private dimensions(): Dimensions {
    return { width: this.surface.clientWidth, height: this.surface.clientHeight,
      gameWidth: this.game.clientWidth, left: this.surface.offsetLeft }
  }

  private baseSize(id: Control, width: number) {
    const base = clamp(width * .16, 49, 70)
    return { stick: clamp(width * .31, 102, 142), attack: base, guard: .93 * base,
      dodge: 1.06 * base, skill: base, charge: 1.19 * base, lock: 48, pause: 44 }[id]
  }

  private placement(id: Control, {width: w, height: h, gameWidth, left}: Dimensions): Placement {
    const chosen = (this.draft ?? this.saved)[this.orientation][id]
    if (chosen) return chosen
    const base = this.baseSize('attack', gameWidth)
    const radius = this.baseSize(id, gameWidth) * .5
    const defaults: Record<Control, [number, number]> = {
      stick: [this.orientation==='landscape'?radius+24:gameWidth * .28 - left, h - radius - 31],
      attack: [w - radius, h - 1.22 * base - radius],
      guard: [w - 1.18 * base - radius, h - 1.10 * base - radius],
      dodge: [w - 1.38 * base - radius, h - radius],
      charge: [w - radius, h - radius],
      skill: [w - 1.18 * base - radius, h - 2.24 * base - radius],
      lock: [w - radius, 52 + radius],
      pause: [w - radius, radius],
    }
    const [x,y] = defaults[id]
    return { x: clamp(x / w, 0, 1), y: clamp(y / h, 0, 1), scale: 1 }
  }

  private selectControl(id: Control) {
    this.selected = id
    this.select.value = id
    this.refresh()
    this.keepPanelClear()
  }

  private placePanel(edge: 'top' | 'bottom') {
    this.editor.dataset.edge = edge
    this.panelSide.textContent = edge === 'top' ? 'パネルを下へ' : 'パネルを上へ'
  }

  private collapsePanel(collapsed: boolean) {
    this.editor.dataset.collapsed = String(collapsed)
    this.panelToggle.setAttribute('aria-expanded', String(!collapsed))
    this.panelToggle.textContent = collapsed ? '設定を開く' : 'たたむ'
  }

  private keepPanelClear() {
    const control = this.elements.get(this.selected)!
    const bounds = (this.selected === 'stick' ? control.querySelector('#stick')! : control).getBoundingClientRect()
    const panel = this.editor.getBoundingClientRect()
    if (bounds.top < panel.bottom && bounds.bottom > panel.top) {
      const game = this.game.getBoundingClientRect()
      this.placePanel((bounds.top + bounds.bottom) / 2 < game.top + game.height / 2 ? 'bottom' : 'top')
    }
  }

  private beginDrag(event: PointerEvent) {
    if (!this.draft || this.drag || event.button !== 0) return
    const id = (event.target as HTMLElement).closest<HTMLElement>('[data-control]')?.dataset.control as Control | undefined
    if (!id) return
    event.preventDefault()
    this.selectControl(id)
    const center = this.centers.get(id)!
    const point = this.pointerPosition(event)
    this.drag = { pointer: event.pointerId, offsetX: center.x - point.x, offsetY: center.y - point.y }
    this.editor.classList.add('dragging')
    this.surface.setPointerCapture(event.pointerId)
  }

  private pointerPosition(event: PointerEvent) {
    const rect = this.surface.getBoundingClientRect()
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  private placeAt(x: number, y: number) {
    const screen = this.dimensions()
    this.change({
      ...this.placement(this.selected, screen),
      x: clamp(x / screen.width, 0, 1),
      y: clamp(y / screen.height, 0, 1),
    })
  }

  private change(placement: Placement) {
    if (!this.draft) return
    this.draft[this.orientation][this.selected] = placement
    this.refresh()
  }
}
