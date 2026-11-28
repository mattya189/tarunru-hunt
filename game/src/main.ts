import { ACESFilmicToneMapping, PCFShadowMap, Scene, SRGBColorSpace, WebGLRenderer } from 'three'
import { Battle, battleStep } from './battle'
import { BattleAudio } from './battle-audio'
import { HuntCamera } from './camera'
import { ContactShadow } from './contact'
import { ControlLayout } from './control-layout'
import { greatsword, tidebeast, type MonsterData } from './config'
import { Effects } from './effects'
import { defaultFieldId, fieldFor, type FieldId } from './fields'
import { EmperorBattle } from './emperor/battle'
import { emperor } from './emperor/config'
import { FlareModel } from './flare/model'
import { HunterModel } from './hunter'
import { Controls } from './input'
import { MonsterModel } from './monster-model'
import { beginRun, finishRun, type HunterId, type RankingRun } from './rankings'
import { bestClearTime, recordClearTime } from './clear-times'
import { Reticles } from './reticles'
import { quests, type Difficulty } from './quests'
import { Interface, type ClearResult, type Command, type Quality, type Screen } from './ui'
import { Arena } from './world'
import { sabotProfiles } from './sabottenanbon/config'
import { AttackRuntime, effectData } from './sabottenanbon/attack-runtime'
import { SabotBattle } from './sabottenanbon/battle'
import { BreathBloom } from './sabottenanbon/bloom'
import { RevotenshiBattle } from './revotenshi/battle'
import { VariantBattle } from './revotenshi/variant-battle'
import { minion, revotenshi, variant } from './revotenshi/config'
import { ShikoukiBattle } from './shikouki/battle'
import { shikouki } from './shikouki/config'
import { KouperBattle } from './kouper/battle'
import { kouper } from './kouper/config'
import { KogobonBattle } from './kogobon/battle'
import { kogobon } from './kogobon/config'
import { RavenBattle } from './raven/battle'
import { raven } from './raven/config'
import { KouenchoBattle } from './kouencho/battle'
import { kouencho } from './kouencho/config'
import { WandaBattle } from './wanda/battle'
import { wanda } from './wanda/config'
import './style.css'

const game=document.querySelector<HTMLElement>('#game')!
const landscape=matchMedia('(orientation: landscape)')
const canvas=document.querySelector<HTMLCanvasElement>('#view')!
const input=new Controls(canvas)
const audio=new BattleAudio()
const ratios={low:.78,medium:1.16,high:1.78}
let quality: Quality=input.coarse?'low':'high'
try {
  const preference=localStorage.getItem('shiosai-quality')
  if (preference==='low'||preference==='medium'||preference==='high') quality=preference
} catch { /* Storage may be disabled. */ }

let screen: Screen | null='loading'
let helpFrom: Screen='title'
let wideTouch=false
let rankingFrom: 'title' | 'quest' | 'victory'='title'
let difficulty: Difficulty=1
let selectedMonster=tidebeast
let selectedHunter:HunterId='greatsword'
let flareModel:FlareModel|undefined
let huntStarted: number | undefined
let clearResult: ClearResult | undefined
let startCuePending=false
let renderer: WebGLRenderer
let scene: Scene
let arena: Arena
const fields=new Map<FieldId,Arena>()
let bloom: BreathBloom | undefined
let hunter: HunterModel
const battles=new Map<string,Battle>()
let camera: HuntCamera
let fx: Effects
let battle: Battle
let titleBattle: Battle
let rankingRun: RankingRun | undefined
let rankingResult: Promise<number|null> | undefined
let hunterShadow: ContactShadow, bossShadow: ContactShadow
let dirty=true, frameCount=0
let latest=performance.now(), titleTime=0, accumulator=0, uiTimer=0
const step=battleStep
const ui=new Interface(tidebeast,greatsword,input.coarse,command,applyQuality,chooseDifficulty,chooseMonster,audio,chooseHunter)
ui.show(screen,quality)
const testMode=import.meta.env.DEV && new URLSearchParams(location.search).has('test')
const reticles=new Reticles(model => {
  if (screen!==null) return
  battle.selectLockTarget(model)
})
const controlsLayout=new ControlLayout(() => switchTo('title'))
updateViewport()
landscape.addEventListener('change',updateViewport)
window.addEventListener('resize',updateViewport)
window.visualViewport?.addEventListener('resize',updateViewport)

function switchTo(next: Screen | null) {
  if(next===null) audio.resume()
  else { audio.pauseMusic(); audio.stopEffects() }
  screen=next
  input.clear(); input.enabled=next===null
  accumulator=0
  dirty=true
  reticles.clear()
  if(battle) battle.monster.root.visible=next!=='hunters' && next!=='difficulty' && next!=='monsters' && next!=='quest' && next!=='quest-guide' && next!=='boss-rankings' && next!=='rankings'
  ui.show(next,quality,battle,undefined,rankingRun,rankingResult,difficulty,next==='rankings' && rankingFrom==='title'?'greatsword':selectedHunter,clearResult)
  if (next==='layout') {
    controlsLayout.open()
    showBattlePreview()
  } else {
    controlsLayout.close()
    controlsLayout.refresh()
  }
  if(next===null && startCuePending) {
    startCuePending=false
    audio.play('quest-start')
  }
  if(next==='victory') audio.play('quest-clear')
  if(next==='failure') audio.play('quest-failed')
}
function arenaFor(id?:FieldId) {
  const config=fieldFor(id)
  let field=fields.get(config.id)
  if(!field) {
    field=new Arena(config)
    fields.set(config.id,field)
  }
  return field
}

function battleKey(monster:MonsterData, field:Arena) {
  return `${monster.id}:${field.data.id}`
}

async function loadBattle(data:MonsterData, field:Arena, fieldReady?:Promise<boolean>) {
  const key=battleKey(data,field)
  const cached=battles.get(key)
  if(cached) return cached
  const [monster]=await Promise.all([MonsterModel.load(data),fieldReady])
  let next:Battle
  const profile=sabotProfiles.get(data.id)
  if(profile) {
    const runtime=await AttackRuntime.load(scene,field,monster,quality,profile,(cue,point,level)=>fx.sound(cue,point,level))
    const encounter=new SabotBattle(monster,hunter,field,fx,greatsword)
    encounter.attachRuntime(runtime)
    next=encounter
  } else if(data.id===emperor.id) {
    const encounter=new EmperorBattle(monster,hunter,field,fx,greatsword)
    scene.add(encounter.warning)
    next=encounter
  } else if(data.id===variant.id) {
    const encounter=new VariantBattle(monster,hunter,field,fx,greatsword)
    scene.add(encounter.warning)
    next=encounter
  } else if(data.id===revotenshi.id) {
    const clones=await Promise.all([MonsterModel.load(minion),MonsterModel.load(minion)])
    const encounter=new RevotenshiBattle(monster,hunter,field,fx,greatsword)
    encounter.attach(scene,clones)
    next=encounter
  } else if(data.id===shikouki.id) {
    const encounter=new ShikoukiBattle(monster,hunter,field,fx,greatsword)
    scene.add(encounter.visuals.root)
    next=encounter
  } else if(data.id===kogobon.id) {
    const encounter=new KogobonBattle(monster,hunter,field,fx,greatsword)
    scene.add(encounter.warning)
    next=encounter
  } else if(data.id===kouencho.id) {
    const encounter=new KouenchoBattle(monster,hunter,field,fx,greatsword)
    scene.add(encounter.visuals.root)
    next=encounter
  } else if(data.id===wanda.id) {
    const encounter=new WandaBattle(monster,hunter,field,fx,greatsword)
    encounter.visuals.quality=quality
    scene.add(encounter.visuals.root)
    next=encounter
  } else if(data.id===kouper.id) {
    const encounter=new KouperBattle(monster,hunter,field,fx,greatsword)
    encounter.visuals.quality=quality
    encounter.enableDebug(game)
    scene.add(encounter.visuals.root)
    next=encounter
  } else if(data.id===raven.id) {
    const encounter=new RavenBattle(monster,hunter,field,fx,greatsword)
    scene.add(encounter.visuals.root)
    next=encounter
  } else next=new Battle(monster,hunter,field,fx,greatsword)
  battles.set(key,next)
  return next
}

function updateArena() {
  const next=battle.field
  if(next!==arena) {
    arena.deactivate()
    arena=next
    arena.activate(scene)
    camera.setArena(arena)
    applyQuality(quality)
  }
}

function chooseHunter(value:string) {
  if(screen!=='hunters' || (value!=='greatsword' && value!=='flare')) return
  selectedHunter=value
  switchTo('difficulty')
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
  audio.start()
  try {
    const field=arenaFor(selectedMonster.fieldId)
    const fieldReady=field.prepare()
    const [next,model,fieldLoaded]=await Promise.all([
      loadBattle(selectedMonster,field,fieldReady),
      selectedHunter==='flare'?flareModel ?? FlareModel.load():undefined,
      fieldReady,
      audio.ready(),
      audio.prepareAmbiance(field.data.ambiance),
    ])
    if(model) flareModel=model
    if(battle!==next) {
      battle.reset()
      battle.selectHunter()
      scene.remove(battle.monster.root)
      if(battle instanceof RavenBattle || battle instanceof KouenchoBattle) {
        battle.visuals.dispose()
        battle.monster.dispose()
        battles.delete(battleKey(battle.monster.data,battle.field))
      }
      battle=next
      scene.add(battle.monster.root)
    }
    battle.selectHunter(model)
    updateArena()
    battle.reset(); camera.reset(battle)
    if(fieldLoaded && typeof field.data.landscape==='object') {
      field.warmTextures(renderer)
      await renderer.compileAsync(scene,camera.camera)
    }
    if(testMode) Object.assign(window,{huntTest:{battle,camera,renderer,input}})
    rankingRun=await beginRun(battle.monster.data.id,selectedHunter).catch(()=>undefined)
    rankingResult=undefined
    clearResult=undefined
    huntStarted=performance.now()
    startCuePending=true
    switchTo(null)
    ui.status(battle,battle.lock)
  } catch(error) { fail(error) }
}
function command(action: Command) {
  if(action==='refresh') { location.reload(); return }
  if(!battle) return
  switch(action) {
    case 'title':
      huntStarted=undefined; startCuePending=false
      void audio.prepareAmbiance()
      battle.selectHunter(); battle.reset()
      if(battle.field.data.id!==defaultFieldId) {
        scene.remove(battle.monster.root)
        battle=titleBattle
        battle.reset()
        scene.add(battle.monster.root)
        updateArena()
      }
      switchTo('title')
      break
    case 'hunters': switchTo('hunters'); break
    case 'difficulty': switchTo('difficulty'); break
    case 'monsters': switchTo('monsters'); break
    case 'quest': if(screen==='quest-guide') switchTo('quest'); break
    case 'quest-guide': if(screen==='quest') switchTo('quest-guide'); break
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
    case 'layout':
      if (screen==='title') switchTo('layout')
      break
    case 'help': helpFrom=screen==='paused'?'paused':'title'; switchTo('help'); break
    case 'back': switchTo(helpFrom); break
  }
}
function updateViewport() {
  const next=input.coarse && landscape.matches
  if (next!==wideTouch) {
    wideTouch=next
    input.clear()
    controlsLayout.setLandscape(wideTouch)
  }
  resize()
}

function resize() {
  controlsLayout.refresh()
  if(!renderer) return
  const w=game.clientWidth,h=game.clientHeight
  if (!w || !h) return
  dirty=true
  const bounded=Math.min(devicePixelRatio||1,ratios[quality],Math.sqrt(3_400_000/(w*h)))
  renderer.setPixelRatio(bounded)
  renderer.setSize(w,h,false)
  camera.resize(w,h)
  bloom?.resize(w,h)
  if (screen==='layout') showBattlePreview()
}

function showBattlePreview() {
  camera.reset(battle)
  ui.status(battle,battle.lock)
  reticles.render(battle,camera.camera)
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
  for(const encounter of battles.values()) {
    if(encounter instanceof SabotBattle) encounter.attacksRuntime.setQuality(quality)
    if(encounter instanceof WandaBattle || encounter instanceof KouperBattle) encounter.visuals.quality=quality
  }
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
    audio.setListener(battle.p,camera.yaw)
    accumulator+=dt
    while(accumulator>=step) {
      accumulator-=step
      if(fx.hitstop>0) fx.hitstop=Math.max(0,fx.hitstop-step)
      else { battle.update(step,input,camera.yaw); input.endFrame() }
    }
    if(battle.outcome) audio.pauseMusic()
    if(battle.outcome==='victory' && huntStarted!==undefined) {
      const boss=battle.monster.data.id
      const time=Math.max(1,Math.round(performance.now()-huntStarted))
      clearResult={time,previousBest:bestClearTime(boss,selectedHunter)}
      recordClearTime(boss,selectedHunter,time)
      huntStarted=undefined
    }
    if(battle.outcome==='victory' && rankingRun && !rankingResult) {
      rankingResult=finishRun(rankingRun).catch(()=>null)
    }
    camera.update(dt,battle,lookX,fx.shake)
    fx.update(dt,p=>p.project(camera.camera))
    reticles.render(battle,camera.camera)
    uiTimer+=dt
    if(uiTimer>=.05) { ui.status(battle,battle.lock); uiTimer=0 }
    if(battle.outcome&&battle.outcomeTime>(battle.outcome==='victory'?Math.max(2.45,battle.defeatDuration+.35):1.45)) switchTo(battle.outcome)
  } else if(screen==='title'||screen==='help'&&helpFrom==='title') {
    titleTime+=dt
    battle.monster.animate('idle',dt)
    camera.update(dt,battle,0,0,false,titleTime+.01)
  }
  if(battle instanceof KouperBattle) battle.frame(dt,screen===null && !battle.outcome)
  const moving=screen===null||screen==='title'||screen==='help'&&helpFrom==='title'
  if (dirty||moving) {
    renderer.toneMappingExposure=1.17*(1-battle.fieldDarkness)
    hunterShadow.follow(battle.p,.64)
    bossShadow.follow(battle.m,battle instanceof ShikoukiBattle ? 1.18 : battle.bossState==='attack' && battle.callout==='跳躍プレス'?.46:.72)
    if (quality!=='low'||frameCount++%2===0||dirty) renderer.shadowMap.needsUpdate=true
    const runtime=battle instanceof SabotBattle?battle.attacksRuntime:undefined
    if(quality!=='low' && runtime?.glowing && renderer.extensions.has('EXT_color_buffer_float')) {
      if(!bloom) {
        bloom=new BreathBloom(renderer,scene,camera.camera,effectData.effects.fire_breath.bloomThreshold)
        bloom.resize(game.clientWidth,game.clientHeight)
      }
      bloom.render(runtime.glowLayer,effectData.quality[quality].bloom)
    } else renderer.render(scene,camera.camera)
    dirty=false
  }
}

function fail(error: unknown) {
  console.error(error)
  audio.pauseMusic(); audio.stopEffects()
  screen='error'; input.clear(); input.enabled=false
  reticles.clear(); controlsLayout.close()
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
    arena=arenaFor()
    await arena.prepare()
    arena.activate(scene)
    fx=new Effects(audio); scene.add(fx.root)
    camera=new HuntCamera(arena)
    hunter=new HunterModel()
    battle=titleBattle=await loadBattle(tidebeast,arena)
    hunterShadow=new ContactShadow(.92,.64); bossShadow=new ContactShadow(1.95,.72)
    scene.add(hunter.root,battle.monster.root,hunterShadow.mesh,bossShadow.mesh)
    camera.reset(battle)
    applyQuality(quality)
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden) { audio.pauseMusic(); audio.stopEffects() }
      else if(screen===null && !battle.outcome) audio.resume()
    })
    canvas.addEventListener('webglcontextlost',event=>{
      event.preventDefault()
      fail(new Error('WebGLの描画が停止した。再読み込みで復帰できる。'))
    })
    document.querySelector('#pause')!.addEventListener('click',()=>{ if(screen===null&&!battle.outcome) switchTo('paused') })
    if(testMode) Object.assign(window,{huntTest:{battle,camera,renderer,input}})
    const recoverAudio=()=>{
      if (screen===null && !battle.outcome) audio.resume()
    }
    window.addEventListener('pointerup',recoverAudio)
    window.addEventListener('keydown',recoverAudio)
    switchTo('title')
    audio.preload()
    requestAnimationFrame(frame)
  } catch(error) { fail(error) }
}
void init()
