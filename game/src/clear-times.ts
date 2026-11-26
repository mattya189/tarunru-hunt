const prefix = 'shiosai-clear-time:'
const times = new Map<string,number>()

export function bestClearTime(id:string): number | undefined {
  const cached = times.get(id)
  try {
    const time = Number(localStorage.getItem(prefix+id))
    if(Number.isFinite(time) && time>0 && (cached===undefined || time<cached)) times.set(id,time)
  } catch { /* Keep records available for the current session. */ }
  return times.get(id)
}

export function recordClearTime(id:string,time:number) {
  const previous=bestClearTime(id)
  if(!Number.isFinite(time) || time<=0 || (previous!==undefined && previous<=time)) return
  times.set(id,time)
  try { localStorage.setItem(prefix+id,String(time)) } catch { /* Optional persistence. */ }
}
