const endpoint='https://rncgojznjoreexjcpgwq.supabase.co/rest/v1/rpc/hunt_'
// This publishable key grants access only to the public ranking RPCs.
const apiKey='sb_publishable_DFU6z0RkXapoX8w_K_UnaQ_dPIDQTze'
const playerKey='shiosai-ranking-player'
let player:string|undefined

export type HunterId = 'greatsword' | 'flare'

export interface RankingEntry {nickname:string; time_ms:number}
export interface RankingRun {boss:string; hunter:HunterId; player:string; ticket:string}
export interface RankingSave {time_ms:number; personal_best:boolean}

async function rpc<T>(operation:string, body:Record<string,string>):Promise<T> {
  const controller=new AbortController()
  const timeout=setTimeout(()=>controller.abort(),5000)
  try {
    const response=await fetch(endpoint+operation,{
      method:'POST', headers:{apikey:apiKey,'Content-Type':'application/json'},
      body:JSON.stringify(body),signal:controller.signal,
    })
    if(!response.ok) throw new Error('Ranking request failed')
    return await response.json() as T
  } finally { clearTimeout(timeout) }
}

export function listScores(boss:string,hunter:HunterId) {
  return rpc<RankingEntry[]>('list_scores',{p_boss:boss,p_hunter:hunter})
}
export async function beginRun(boss:string,hunter:HunterId):Promise<RankingRun> {
  if(!player) {
    try { player=localStorage.getItem(playerKey)??undefined } catch { /* Private storage may be blocked. */ }
    if(!player || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(player)) player=crypto.randomUUID()
    try { localStorage.setItem(playerKey,player) } catch { /* Keep the current session playable. */ }
  }
  const ticket=await rpc<string>('begin_run',{p_boss:boss,p_hunter:hunter,p_player:player})
  return {boss,hunter,player,ticket}
}
function runArgs(run:RankingRun) { return {p_boss:run.boss,p_hunter:run.hunter,p_player:run.player,p_ticket:run.ticket} }
export function finishRun(run:RankingRun) { return rpc<number>('finish_run',runArgs(run)) }
export async function saveScore(run:RankingRun,nickname:string) {
  const [score]=await rpc<RankingSave[]>('save_score',{...runArgs(run),p_nickname:nickname})
  if(!score) throw new Error('Missing ranking result')
  return score
}

export function rankingTime(ms:number) {
  const seconds=Math.floor(ms/1000)
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`
}
