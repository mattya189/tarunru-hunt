import { ACESFilmicToneMapping, PCFShadowMap, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import { Battle } from './battle'
import { BattleMusic } from './battle-music'
import { HuntCamera } from './camera'
import { ContactShadow } from './contact'
import { coast, greatsword, tidebeast, type MonsterData } from './config'
import { Effects } from './effects'
import { HunterModel } from './hunter'
import { Controls } from './input'
import { MonsterModel } from './monster-model'
import { beginRun, finishRun, type RankingRun } from './rankings'
import { recordClearTime } from './clear-times'
import { quests, type Difficulty } from './quests'
import { Interface, type Command, type Quality, type Screen } from './ui'
import { Arena } from './world'
import { sabotProfiles } from './sabottenanbon/config'
import { AttackRuntime, effectData } from './sabottenanbon/attack-runtime'
import { SabotBattle } from './sabottenanbon/battle'
import { BreathBloom } from './sabottenanbon/bloom'
import { RevotenshiBattle } from './revotenshi/battle'
import { minion, revotenshi } from './revotenshi/config'
import { ShikoukiBattle } from './shikouki/battle'
import { shikouki } from './shikouki/config'
import './style.css'

const canvas=document.querySelector<HTMLCanvasElement>('#view')!
const input=new Controls(canvas)
const music=new BattleMusic()
const ratios={low:.78,medium:1.16,high:1.78}
let quality: Quality=input.coarse?'low':'high'
try {
  const preference=localStorage.getItem('shiosai-quality')
  if (preference==='low'||preference==='medium'||preference==='high') quality=preference
} catch { /* Storage may be disabled. */ }

let screen: Screen | null='loading'
let helpFrom: Screen='title'
let rankingFrom: 'title' | 'quest' | 'victory'='title'
let difficulty: Difficulty=1
let selectedMonster=tidebeast
let huntStarted: number | undefined
let renderer: WebGLRenderer
let scene: Scene
let arena: Arena
let bloom: BreathBloom | undefined
let hunter: HunterModel
const battles=new Map<string,Battle>()
let camera: HuntCamera
let fx: Effects
let battle: Battle
let rankingRun: RankingRun | undefined
let rankingResult: Promise<number|null> | undefined
let hunterShadow: ContactShadow, bossShadow: ContactShadow
let dirty=true, frameCount=0
let latest=performance.now(), titleTime=0, accumulator=0, uiTimer=0
const step=1/60
const ui=new Interface(tidebeast,greatsword,input.coarse,command,applyQuality,chooseDifficulty,chooseMonster,music)
ui.show(screen,quality)
const testMode=import.meta.env.DEV && new URLSearchParams(location.search).has('test')
const lockPoint=new Vector3()
const reticle=document.createElement('b')
reticle.id='reticle'; reticle.hidden=true
document.querySelector('#hud')!.append(reticle)

function switchTo(next: Screen | null) {
  if(next===null) music.resume()
  else music.pause()
  screen=next
  input.clear(); input.enabled=next===null
  accumulator=0
  dirty=true
  reticle.hidden=true
  if(battle) battle.monster.root.visible=next!=='difficulty' && next!=='monsters' && next!=='quest' && next!=='boss-rankings' && next!=='rankings'
  ui.show(next,quality,battle,undefined,rankingRun,rankingResult,difficulty)
}
async function loadBattle(data:MonsterData) {
  const cached=battles.get(data.id)
  if(cached) return cached
  const monster=await MonsterModel.load(data)
  let next:Battle
  const profile=sabotProfiles.get(data.id)
  if(profile) {
    const runtime=await AttackRuntime.load(scene,arena,monster,quality,profile)
    const encounter=new SabotBattle(monster,hunter,arena,fx,greatsword)
    encounter.attachRuntime(runtime)
    next=encounter
  } else if(data.id===revotenshi.id) {
    const clones=await Promise.all([MonsterModel.load(minion),MonsterModel.load(minion)])
    const encounter=new RevotenshiBattle(monster,hunter,arena,fx,greatsword)
    encounter.attach(scene,clones)
    next=encounter
  } else if(data.id===shikouki.id) {
    const encounter=new ShikoukiBattle(monster,hunter,arena,fx,greatsword)
    scene.add(encounter.visuals.root)
    next=encounter
  } else next=new Battle(monster,hunter,arena,fx,greatsword)
  battles.set(data.id,next)
  return next
}
function chooseDifficulty(level:Difficulty) {
  if(screen!=='difficulty') return
  difficulty=level
  switchTo('monsters')
}
function chooseMonster(id:string) {
  if(screen!=='monsters') return
  const quest=quests.find(candidate=>candidate.difficulty===difficulty && candidate.monster.id===id)
  if(!quest) return
  selectedMonster=quest.monster
  ui.selectMonster(selectedMonster)
  switchTo('quest')
}
async function startHunt() {
  if(screen!=='quest' && screen!=='paused' && screen!=='victory' && screen!=='failure') return
  switchTo('loading')
  // Safari requires the first play() call inside the Start/Retry tap.
  music.start()
  try {
    const next=await loadBattle(selectedMonster)
    if(battle!==next) {
      battle.reset()
      scene.remove(battle.monster.root)
      battle=next
      scene.add(battle.monster.root)
    }
    if(testMode) Object.assign(window,{huntTest:{battle,camera,renderer,input}})
    rankingRun=await beginRun(battle.monster.data.id).catch(()=>undefined)
    rankingResult=undefined
    battle.reset(); camera.reset(battle)
    huntStarted=performance.now()
    switchTo(null)
    ui.status(battle,battle.lock)
  } catch(error) { fail(error) }
}
function command(action: Command) {
  if(action==='refresh') { location.reload(); return }
  if(!battle) return
  switch(action) {
    case 'title': huntStarted=undefined; battle.reset(); switchTo('title'); break
    case 'difficulty': switchTo('difficulty'); break
    case 'monsters': switchTo('monsters'); break
    case 'rankings':
    case 'boss-rankings':
      if(screen==='title' || screen==='quest' || screen==='victory') {
        rankingFrom=screen
        switchTo(action)
      }
      break
    case 'ranking-back': switchTo(rankingFrom); break
    case 'start':
    case 'retry': void startHunt(); break
    case 'resume': switchTo(null); break
    case 'help': helpFrom=screen==='paused'?'paused':'title'; switchTo('help'); break
    case 'back': switchTo(helpFrom); break
  }
}
function resize() {
  if(!renderer) return
  dirty=true
  const w=window.innerWidth,h=window.innerHeight
  const bounded=Math.min(devicePixelRatio||1,ratios[quality],Math.sqrt(3_400_000/(w*h)))
  renderer.setPixelRatio(bounded)
  renderer.setSize(w,h,false)
  camera.resize(w,h)
  bloom?.resize(w,h)
}
function applyQuality(next: Quality) {
  quality=next
  try { localStorage.setItem('shiosai-quality',next) } catch { /* Optional preference. */ }
  if(!renderer) return
  const size=quality==='high'?1536:quality==='medium'?768:512
  if (arena.sun.shadow.mapSize.x!==size) {
    arena.sun.shadow.map?.dispose(); arena.sun.shadow.map=null
    arena.sun.shadow.mapSize.set(size,size)
  }
  arena.sun.shadow.needsUpdate=true
  fx.limit=quality==='low'?6:quality==='medium'?11:16
  for(const encounter of battles.values()) if(encounter instanceof SabotBattle) encounter.attacksRuntime.setQuality(quality)
  resize()
}
function frame(now: number) {
  if(screen==='error') return
  requestAnimationFrame(frame)
  const dt=Math.min(.07,Math.max(0,(now-latest)/1000)); latest=now
  if(input.take('pause') && battle && !battle.outcome) {
    if(screen===null) switchTo('paused')
    else if(screen==='paused') switchTo(null)
  }
  if(screen===null) {
    const lookX=input.lookX
    input.lookX=0
    accumulator+=dt
    while(accumulator>=step) {
      accumulator-=step
      if(fx.hitstop>0) fx.hitstop=Math.max(0,fx.hitstop-step)
      else { battle.update(step,input,camera.yaw); input.endFrame() }
    }
    if(battle.outcome) music.pause()
    if(battle.outcome==='victory' && huntStarted!==undefined) {
      recordClearTime(battle.monster.data.id,Math.max(1,Math.round(performance.now()-huntStarted)))
      huntStarted=undefined
    }
    if(battle.outcome==='victory' && rankingRun && !rankingResult) {
      rankingResult=finishRun(rankingRun).catch(()=>null)
    }
    camera.update(dt,battle,lookX,fx.shake)
    fx.update(dt,p=>p.project(camera.camera))
    if(battle.lock&&!battle.outcome) {
      if(battle instanceof ShikoukiBattle) {
        lockPoint.copy(battle.monster.parts[0].center)
      } else if(battle instanceof SabotBattle) {
        lockPoint.copy(battle.monster.parts[0].center)
        lockPoint.y+=.60
      } else if(battle instanceof RevotenshiBattle) {
        const target=battle.lockTarget
        if(target===battle.m) lockPoint.copy(battle.monster.parts[0].center)
        else { lockPoint.copy(target); lockPoint.y+=.96 }
      } else { lockPoint.copy(battle.m); lockPoint.y+=battle.monster.data.scale*3.22 }
      lockPoint.project(camera.camera)
      reticle.hidden=lockPoint.z<-1||lockPoint.z>1||Math.abs(lockPoint.x)>.98||Math.abs(lockPoint.y)>.97
      reticle.style.left=`${(lockPoint.x*.5+.5)*100}%`; reticle.style.top=`${(.5-lockPoint.y*.5)*100}%`
    } else reticle.hidden=true
    uiTimer+=dt
    if(uiTimer>=.05) { ui.status(battle,battle.lock); uiTimer=0 }
    if(battle.outcome&&battle.outcomeTime>(battle.outcome==='victory'?Math.max(2.45,battle.defeatDuration+.35):1.45)) switchTo(battle.outcome)
  } else if(screen==='title'||screen==='help'&&helpFrom==='title') {
    titleTime+=dt
    battle.monster.animate('idle',dt)
    camera.update(dt,battle,0,0,false,titleTime+.01)
  }
  const moving=screen===null||screen==='title'||screen==='help'&&helpFrom==='title'
  if (dirty||moving) {
    hunterShadow.follow(battle.p,.64)
    bossShadow.follow(battle.m,battle instanceof ShikoukiBattle ? 1.18 : battle.bossState==='attack' && battle.callout==='跳躍プレス'?.46:.72)
    if (quality!=='low'||frameCount++%2===0||dirty) renderer.shadowMap.needsUpdate=true
    const runtime=battle instanceof SabotBattle?battle.attacksRuntime:undefined
    if(quality!=='low' && runtime?.glowing && renderer.extensions.has('EXT_color_buffer_float')) {
      if(!bloom) {
        bloom=new BreathBloom(renderer,scene,camera.camera,effectData.effects.fire_breath.bloomThreshold)
        bloom.resize(innerWidth,innerHeight)
      }
      bloom.render(runtime.glowLayer,effectData.quality[quality].bloom)
    } else renderer.render(scene,camera.camera)
    dirty=false
  }
}

function fail(error: unknown) {
  console.error(error)
  music.pause()
  screen='error'; input.clear(); input.enabled=false
  ui.show('error',quality,undefined,error instanceof Error?error.message:'3Dデータを読み込めなかった。')
}
async function init() {
  try {
    renderer=new WebGLRenderer({canvas,antialias:!input.coarse,powerPreference:'high-performance'})
    renderer.outputColorSpace=SRGBColorSpace
    renderer.toneMapping=ACESFilmicToneMapping
    renderer.toneMappingExposure=1.17
    renderer.shadowMap.enabled=true; renderer.shadowMap.type=PCFShadowMap
    renderer.shadowMap.autoUpdate=false
    scene=new Scene()
    arena=new Arena(scene,coast)
    fx=new Effects(); scene.add(fx.root)
    camera=new HuntCamera(arena)
    hunter=new HunterModel()
    battle=await loadBattle(tidebeast)
    hunterShadow=new ContactShadow(.92,.64); bossShadow=new ContactShadow(1.95,.72)
    scene.add(hunter.root,battle.monster.root,hunterShadow.mesh,bossShadow.mesh)
    camera.reset(battle)
    applyQuality(quality)
    addEventListener('resize',resize)
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden) music.pause()
      else if(screen===null && !battle.outcome) music.resume()
    })
    window.visualViewport?.addEventListener('resize',resize)
    canvas.addEventListener('webglcontextlost',event=>{
      event.preventDefault()
      fail(new Error('WebGLの描画が停止した。再読み込みで復帰できる。'))
    })
    document.querySelector('#pause')!.addEventListener('click',()=>{ if(screen===null&&!battle.outcome) switchTo('paused') })
    if(testMode) Object.assign(window,{huntTest:{battle,camera,renderer,input}})
    switchTo('title')
    requestAnimationFrame(frame)
  } catch(error) { fail(error) }
}
void init()
