const preferenceKey='shiosai-battle-bgm'

export class BattleMusic {
  private track?:HTMLAudioElement
  enabled=true

  constructor() {
    try { this.enabled=localStorage.getItem(preferenceKey)!=='off' } catch { /* Storage may be disabled. */ }
  }

  setEnabled(enabled:boolean) {
    this.enabled=enabled
    if(!enabled) this.pause()
    try { localStorage.setItem(preferenceKey,enabled?'on':'off') } catch { /* Keep the current setting. */ }
  }

  start() {
    if(this.track) this.track.currentTime=0
    this.resume()
  }

  resume() {
    if(!this.enabled || document.hidden) return
    if(!this.track) {
      this.track=new Audio(import.meta.env.BASE_URL+'audio/shadow-protocol.mp3')
      this.track.loop=true
      this.track.volume=.55
    }
    if(this.track.paused) void this.track.play().catch(()=>{ /* Audio restrictions and loading errors leave gameplay accessible. */ })
  }

  pause() { this.track?.pause() }
}
