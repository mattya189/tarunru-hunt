import type { HunterId } from './rankings'

const prefix = 'shiosai-clear-time:'
const times = new Map<string,number>()

// Keep the original key for greatsword records saved before the split.
const storageKey = (boss:string,hunter:HunterId) => prefix+(hunter==='greatsword'?boss:'flare:'+boss)

export function bestClearTime(boss:string,hunter:HunterId): number | undefined {
  const key=storageKey(boss,hunter)
  const cached = times.get(key)
  try {
    const time = Number(localStorage.getItem(key))
    if(Number.isFinite(time) && time>0 && (cached===undefined || time<cached)) times.set(key,time)
  } catch { /* Keep records available for the current session. */ }
  return times.get(key)
}

export function recordClearTime(boss:string,hunter:HunterId,time:number) {
  const previous=bestClearTime(boss,hunter)
  const key=storageKey(boss,hunter)
  if(!Number.isFinite(time) || time<=0 || (previous!==undefined && previous<=time)) return
  times.set(key,time)
  try { localStorage.setItem(key,String(time)) } catch { /* Optional persistence. */ }
}
