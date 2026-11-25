import type { FieldData, MonsterData, WeaponData } from './config'
import type { Battle } from './battle'
import { clamp } from './math'

const select = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
export type Screen = 'loading' | 'title' | 'quest' | 'paused' | 'help' | 'victory' | 'failure' | 'error'
export type Command = 'start' | 'resume' | 'title' | 'help' | 'back' | 'retry' | 'refresh'
export type Quality = 'low' | 'medium' | 'high'
const qualityLabels: Record<Quality,string> = {low:'低',medium:'中',high:'高'}
const clock = (seconds: number) => {
  seconds=Math.floor(seconds)
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`
}

export class Interface {
  private menu=select('menu')
  private panel=select('panel')
  private hud=select('hud')
  private touch=select('touch')
  private clock=select('timer')
  private bossName=select('boss-name')
  private hp=select('hp')
  private stamina=select('stamina')
  private bossHp=select('boss-hp')
  private callout=select('callout')
  private rage=select('rage')
  private charge=select('charge-meter')
  private banner=select('quest-banner')
  private current: Screen | null = null
  private cache = new Map<HTMLElement,string>()

  constructor(private data: MonsterData, private field: FieldData, private weapon: WeaponData, private coarse: boolean, private send: (command: Command) => void, private onQuality: (quality: Quality) => void, private roster: readonly MonsterData[], private choose: (id:string) => void) {
    this.bossName.textContent=data.name
    document.documentElement.classList.toggle('coarse',coarse)
    this.panel.addEventListener('click',e => {
      const button=(e.target as HTMLElement).closest<HTMLButtonElement>('button')
      if (!button) return
      if (button.dataset.monster) this.choose(button.dataset.monster)
      if (button.dataset.cmd) this.send(button.dataset.cmd as Command)
      if (button.dataset.quality) {
        this.onQuality(button.dataset.quality as Quality)
        for (const el of this.panel.querySelectorAll<HTMLButtonElement>('[data-quality]')) el.setAttribute('aria-pressed',String(el===button))
      }
    })
  }
  selectMonster(data:MonsterData) {
    this.data=data
    this.bossName.textContent=data.name
  }
  show(screen: Screen | null, quality: Quality, battle?: Battle, error?: string) {
    this.current=screen
    this.menu.hidden=!screen
    this.menu.dataset.screen=screen??''
    document.body.dataset.screen=screen??'battle'
    this.hud.hidden=!!screen && screen!=='paused'
    this.touch.hidden=!!screen||!this.coarse
    if (!screen) return
    const button = (cmd: Command, name: string, primary=false) => `<button class="${primary?'primary':'secondary'}" data-cmd="${cmd}">${name}${primary?'<span aria-hidden="true">→</span>':''}</button>`
    const settings = `<div class="settings"><span>画質</span><div role="group" aria-label="画質">${(Object.keys(qualityLabels) as Quality[]).map(q=>`<button data-quality="${q}" aria-pressed="${q===quality}">${qualityLabels[q]}</button>`).join('')}</div></div>`
    if (screen==='loading') this.panel.innerHTML='<div class="eyebrow">SHIOSAI HUNT</div><h1>潮鳴りの狩場</h1><p role="status">闘技場を読み込み中…</p><div class="loading-line"></div>'
    if (screen==='title') this.panel.innerHTML=`
      <div class="eyebrow">3D モンスター討伐</div><h1>潮鳴りの<br><em>狩場</em></h1>
      <p class="title-note">大剣を手に、夕凪の石浜へ。</p>
      <div class="menu-actions monster-menu" aria-label="討伐対象を選ぶ">${this.roster.map(monster=>
        `<button class="primary" data-monster="${monster.id}">${monster.name}<span aria-hidden="true">→</span></button>`).join('')}</div>
      <div class="menu-actions">${button('help','操作方法')}</div>${settings}`
    if (screen==='quest') this.panel.innerHTML=`
      <div class="eyebrow">討伐クエスト</div><h2>${this.data.name}</h2>
      <dl><div><dt>狩場</dt><dd>${this.field.name}</dd></div><div><dt>武器</dt><dd>${this.weapon.name}</dd></div></dl>
      <p>予兆を見極めてかわし、攻撃後の隙に大剣を振り込め。</p>
      <div class="menu-actions">${button('start','狩りを始める',true)}${button('title','戻る')}</div>`
    if (screen==='paused') this.panel.innerHTML=`<div class="eyebrow">PAUSE</div><h2>一時停止</h2><div class="menu-actions">${button('resume','狩りに戻る',true)}${button('help','操作方法')}${button('retry','再挑戦')}${button('title','タイトルへ')}</div>${settings}`
    if (screen==='help') this.panel.innerHTML=`
      <div class="eyebrow">FIELD MANUAL</div><h2>狩りの操作</h2>
      <div class="manual-wrapper"><table><thead><tr><th>操作</th><th>スマホ</th><th>PC</th></tr></thead><tbody>
      <tr><th>移動</th><td>画面左下を押してドラッグ</td><td>WASD / 矢印</td></tr>
      <tr><th>視点</th><td>空いている画面を左右にスワイプ</td><td>マウスで左右にドラッグ</td></tr>
      <tr><th>攻撃</th><td>斬撃</td><td>J</td></tr>
      <tr><th>溜め攻撃</th><td>溜めを長押しして離す</td><td>K を長押しして離す</td></tr>
      <tr><th>回避</th><td>回避</td><td>Space</td></tr>
      <tr><th>ガード</th><td>ガードを長押し</td><td>L を長押し</td></tr>
      <tr><th>ロックオン</th><td>照準</td><td>Q</td></tr>
      <tr><th>一時停止</th><td>右上の一時停止ボタン</td><td>Esc / P</td></tr></tbody></table></div>
      <p>斬撃中にもう一度入力すると、最大3段まで繋がる。相手を正面に捉えるとガードが効く。${this.coarse?' 横画面にすると周囲を見渡しやすい。':''}</p>
      <div class="menu-actions">${button('back','戻る',true)}</div>`
    if (screen==='victory' || screen==='failure') this.panel.innerHTML=`
      <div class="eyebrow">${screen==='victory'?'QUEST CLEARED':'QUEST FAILED'}</div>
      <h2>${screen==='victory'?'討伐成功':'討伐失敗'}</h2>
      <dl><div><dt>対象</dt><dd>${this.data.name}</dd></div><div><dt>経過時間</dt><dd>${clock(battle?.elapsed??0)}</dd></div></dl>
      <div class="menu-actions">${button('retry','再挑戦',true)}${button('title','タイトルへ')}</div>`
    if (screen==='error') {
      this.panel.innerHTML=`<div class="eyebrow">読み込みエラー</div><h2>狩場を開けない</h2><p id="error-detail"></p><div class="menu-actions">${button('refresh','再読み込み',true)}</div>`
      select('error-detail').textContent=error??'読み込みに失敗した。'
    }
    this.panel.scrollTop=0
  }
  status(b: Battle, lock: boolean) {
    if (this.current && this.current!=='paused') return
    this.write(this.clock,clock(b.elapsed))
    this.gauge(this.hp,b.hp,this.weapon.hp)
    this.gauge(this.stamina,Math.floor(b.stamina),this.weapon.stamina)
    this.gauge(this.bossHp,b.bossHp,this.data.hp,true)
    this.write(this.callout,b.callout || (lock?'ロックオン中':''))
    this.callout.classList.toggle('warning',b.bossState==='windup'||b.bossState==='rage')
    this.rage.hidden=!b.rage
    this.bossHp.classList.toggle('enraged',b.rage)
    this.charge.hidden=b.chargeValue===0
    this.charge.style.setProperty('--value',String(b.chargeValue))
    this.charge.classList.toggle('full',b.chargeValue>=.98)
    this.banner.hidden=b.elapsed>2.1 || b.outcome!==null
    this.write(this.banner,'クエスト開始')
    const button=document.querySelector('[data-action="lock"]')
    button?.classList.toggle('locked',lock)
    button?.setAttribute('aria-pressed',String(lock))
  }
  private gauge(el: HTMLElement,value: number,max: number,hideValue=false) {
    const formatted=`${value}/${max}`
    if(this.cache.get(el)===formatted) return
    this.cache.set(el,formatted)
    el.style.setProperty('--value',String(clamp(value/max,0,1)))
    el.setAttribute('aria-valuemin','0'); el.setAttribute('aria-valuemax',String(max)); el.setAttribute('aria-valuenow',String(value))
    if(!hideValue) el.querySelector('b')!.textContent=`${value} / ${max}`
  }
  private write(el: HTMLElement,text: string) {
    if(el.textContent!==text) el.textContent=text
  }
}
