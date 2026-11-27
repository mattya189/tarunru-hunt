const cues = {
  'sword-light': .61, 'sword-heavy': .72, 'sword-charge': .48, footstep: .31, dodge: .56,
  'guard-raise': .38, 'guard-hit': .79, 'hit-flesh': .74, 'hit-armor': .68, 'hit-player': .80,
  'magic-charge': .46, 'magic-shot': .64, 'magic-hit': .62,
  'flare-1': .69, 'flare-2': .77, 'flare-3': .86,
  'beast-swipe': .63, 'beast-rush': .68, 'beast-spin': .65, 'earth-slam': .74,
  shockwave: .68, 'emperor-impact': .84, 'elastic-slam': .68, 'air-pressure': .71,
  'thorn-volley': .62, 'thorn-explode': .66, 'breath-fire': .68, 'flame-shot': .61,
  'fire-wave': .82, 'wing-dive': .68, vortex: .69, 'beam-charge': .52, 'beam-release': .76,
  'shield-on': .62, 'shield-break': .79, summon: .68, 'metal-swipe': .63,
  'feather-volley': .59, crystal: .52, 'crystal-burst': .68,
} as const

export type SoundCue = keyof typeof cues
type Bus = 'bgm' | 'sfx'
type Point = { x: number; z: number }
type Voice = { source: AudioBufferSourceNode; gain: GainNode; pan?: StereoPannerNode }
const clipNames = Object.keys(cues) as SoundCue[]
const bgmKey = 'shiosai-battle-bgm'
const volumeKey = (bus: Bus) => `shiosai-${bus}-volume`
const base = import.meta.env.BASE_URL + 'audio/'
const maxVoices = 14

function initialVolume(bus: Bus, fallback: number) {
  try {
    const raw = localStorage.getItem(volumeKey(bus))
    const value = raw === null ? fallback : Number(raw)
    if (Number.isFinite(value)) return Math.min(100, Math.max(0, value))
  } catch { /* Optional preference. */ }
  return fallback
}

async function loadClip(cue: SoundCue) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 7000)
  try {
    const response = await fetch(base + 'sfx/' + cue + '.wav', { signal: controller.signal })
    return response.ok ? await response.arrayBuffer() : undefined
  } catch { return undefined }
  finally { clearTimeout(timeout) }
}

export class BattleAudio {
  enabled = true
  private readonly levels = { bgm: initialVolume('bgm', 55), sfx: initialVolume('sfx', 75) }
  private context?: AudioContext
  private bgm?: GainNode
  private sfx?: GainNode
  private track?: HTMLAudioElement
  private musicOutput?: MediaElementAudioSourceNode
  private pending?: Map<SoundCue, Promise<ArrayBuffer | undefined>>
  private decoding = false
  private readonly buffers = new Map<SoundCue, AudioBuffer>()
  private readonly voices = new Set<Voice>()
  private readonly recent = new Map<SoundCue, number>()
  private readonly listener = { x: 0, z: 0, yaw: 0 }
  private preparing?: Promise<void>
  private variationSeed = crypto.getRandomValues(new Uint32Array(1))[0] || 1

  constructor() {
    try { this.enabled = localStorage.getItem(bgmKey) !== 'off' } catch { /* Optional preference. */ }
  }

  volume(bus: Bus) { return this.levels[bus] }

  setVolume(bus: Bus, percent: number) {
    if (!Number.isFinite(percent)) return
    this.levels[bus] = Math.round(Math.min(100, Math.max(0, percent)))
    try { localStorage.setItem(volumeKey(bus), String(this.levels[bus])) } catch { /* Optional preference. */ }
    const node = bus === 'bgm' ? this.bgm : this.sfx
    if (node) node.gain.value = this.levels[bus] / 100
    if (bus === 'bgm' && this.track && !this.musicOutput) this.track.volume = this.levels.bgm / 100
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (!enabled) this.pauseMusic()
    try { localStorage.setItem(bgmKey, enabled ? 'on' : 'off') } catch { /* Optional preference. */ }
  }

  preload() {
    if (!this.pending && !this.decoding) {
      this.pending = new Map(clipNames.map(cue => [cue, loadClip(cue)]))
    }
  }

  // Call from the Start/Resume gesture so Safari can start the audio graph.
  unlock() {
    if (!this.context) {
      const SafariContext = (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      const Context = window.AudioContext ?? SafariContext
      if (!Context) return
      try {
        const context = new Context()
        const limiter = context.createDynamicsCompressor()
        limiter.threshold.value = -10
        limiter.knee.value = 10
        limiter.ratio.value = 10
        limiter.attack.value = .002
        limiter.release.value = .14
        const safety = context.createGain()
        safety.gain.value = .82
        const ceiling = context.createWaveShaper()
        ceiling.curve = Float32Array.from({ length: 2049 }, (_, step) => {
          const sample = (step - 1024) / 1024
          const level = Math.abs(sample)
          return Math.sign(sample) * (level <= .78 ? level : .78 + .13 * Math.tanh((level - .78) / .13))
        })
        limiter.connect(safety).connect(ceiling).connect(context.destination)
        this.bgm = context.createGain()
        this.sfx = context.createGain()
        this.bgm.gain.value = this.levels.bgm / 100
        this.sfx.gain.value = this.levels.sfx / 100
        this.bgm.connect(limiter)
        this.sfx.connect(limiter)
        this.context = context
      } catch { return }
    }
    if (this.context.state !== 'running') void this.context.resume().catch(() => {})
    if (!this.decoding) {
      this.preload()
      this.decoding = true
      const context = this.context
      const pending = this.pending!
      this.pending = undefined
      this.preparing = Promise.all(clipNames.map(async cue => {
        try {
          const bytes = await pending.get(cue)
          if (bytes) this.buffers.set(cue, await context.decodeAudioData(bytes))
        } catch { /* If one file fails, play the rest and keep combat available. */ }
      })).then(() => undefined)
    }
  }

  async ready() {
    if (!this.preparing) return
    let timer = 0
    try {
      // A slow or offline connection should never hold the quest on the loading screen.
      await Promise.race([this.preparing, new Promise<void>(resolve => { timer = window.setTimeout(resolve, 950) })])
    } finally { window.clearTimeout(timer) }
  }

  setListener(point: Point, yaw: number) {
    this.listener.x = point.x
    this.listener.z = point.z
    this.listener.yaw = yaw
  }

  play(cue: SoundCue, at?: Point, intensity = 1) {
    const context = this.context
    const buffer = this.buffers.get(cue)
    if (!context || context.state !== 'running' || !buffer || !this.levels.sfx || document.hidden) return
    const now = context.currentTime
    const interval = cue === 'crystal' || cue === 'thorn-explode' ? .095 : .039
    if (now - (this.recent.get(cue) ?? -Infinity) < interval) return
    if (this.voices.size >= maxVoices) this.fade(this.voices.values().next().value!, now)
    this.recent.set(cue, now)

    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = .954 + this.variation() * .093
    const gain = context.createGain()
    const { x, z, yaw } = this.listener
    const dx = (at?.x ?? x) - x, dz = (at?.z ?? z) - z
    const distance = Math.hypot(dx, dz)
    const falloff = 1 / (1 + .065 * Math.max(0, distance - 1.7))
    gain.gain.value = cues[cue] * falloff * intensity * (.90 + this.variation() * .15)
    const voice: Voice = { source, gain }
    source.connect(gain)
    if (distance > .2 && typeof context.createStereoPanner === 'function') {
      voice.pan = context.createStereoPanner()
      voice.pan.pan.value = (dz * Math.sin(yaw) - dx * Math.cos(yaw)) / (distance + 2.2) * .66
      gain.connect(voice.pan).connect(this.sfx!)
    } else gain.connect(this.sfx!)
    this.voices.add(voice)
    source.onended = () => {
      this.voices.delete(voice)
      source.disconnect()
      gain.disconnect()
      voice.pan?.disconnect()
    }
    source.start()
  }

  private variation() {
    let value = this.variationSeed
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.variationSeed = value >>> 0
    return this.variationSeed / 4294967296
  }

  private fade(voice: Voice, now: number) {
    voice.gain.gain.setTargetAtTime(0, now, .007)
    voice.source.stop(now + .036)
    this.voices.delete(voice)
  }

  stopEffects() {
    if (this.context) for (const voice of this.voices) this.fade(voice, this.context.currentTime)
    this.recent.clear()
  }

  start() {
    this.unlock()
    if (this.track) this.track.currentTime = 0
    this.resume()
  }

  resume() {
    this.unlock()
    if (!this.enabled || document.hidden) return
    if (!this.track) {
      this.track = new Audio(base + 'shadow-protocol.mp3')
      this.track.loop = true
    }
    if (this.context && !this.musicOutput) {
      try {
        this.musicOutput = this.context.createMediaElementSource(this.track)
        this.musicOutput.connect(this.bgm!)
        this.track.volume = 1
      } catch { /* Retain native playback if routing is unavailable. */ }
    }
    if (!this.musicOutput) this.track.volume = this.levels.bgm / 100
    if (this.track.paused) void this.track.play().catch(() => {})
  }

  pauseMusic() { this.track?.pause() }
}
