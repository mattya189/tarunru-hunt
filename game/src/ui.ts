import type { FieldData, MonsterData, WeaponData } from './config'
import type { Battle } from './battle'
import type { BattleMusic } from './battle-music'
import { clamp } from './math'
import { listScores, rankingTime, saveScore, type RankingRun } from './rankings'

const select = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
export type Screen = 'loading' | 'title' | 'quest' | 'paused' | 'help' | 'victory' | 'failure' | 'error' | 'rankings'
export type Command = 'start' | 'resume' | 'title' | 'help' | 'back' | 'retry' | 'refresh' | 'rankings'
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

  constructor(private data: MonsterData, private field: FieldData, private weapon: WeaponData, private coarse: boolean, private send: (command: Command) => void, private onQuality: (quality: Quality) => void, private roster: readonly MonsterData[], private choose: (id:string) => void, private music:BattleMusic) {
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
      if (button.dataset.bgm) {
        this.music.setEnabled(button.dataset.bgm==='on')
        for(const el of this.panel.querySelectorAll<HTMLButtonElement>('[data-bgm]')) el.setAttribute('aria-pressed',String(el===button))
      }
    })
  }
  selectMonster(data:MonsterData) {
    this.data=data
    this.bossName.textContent=data.name
  }
  show(screen: Screen | null, quality: Quality, battle?: Battle, error?: string, run?:RankingRun, result?:Promise<number|null>) {
    this.current=screen
    this.menu.hidden=!screen
    this.menu.dataset.screen=screen??''
    document.body.dataset.screen=screen??'battle'
    this.hud.hidden=!!screen && screen!=='paused'
    this.touch.hidden=!!screen||!this.coarse
    if (!screen) return
    const button = (cmd: Command, name: string, primary=false) => `<button class="${primary?'primary':'secondary'}" data-cmd="${cmd}">${name}${primary?'<span aria-hidden="true">→</span>':''}</button>`
    const settings = `<div class="options"><div class="settings"><span>画質</span><div role="group" aria-label="画質">${(Object.keys(qualityLabels) as Quality[]).map(q=>`<button data-quality="${q}" aria-pressed="${q===quality}">${qualityLabels[q]}</button>`).join('')}</div></div>
      <div class="settings bgm-settings"><span>戦闘BGM</span><div role="group" aria-label="戦闘BGM"><button data-bgm="on" aria-pressed="${this.music.enabled}">あり</button><button data-bgm="off" aria-pressed="${!this.music.enabled}">なし</button></div></div></div>`
    if (screen==='loading') this.panel.innerHTML='<div class="eyebrow">SHIOSAI HUNT</div><h1>潮鳴りの狩場</h1><p role="status">闘技場を読み込み中…</p><div class="loading-line"></div>'
    if (screen==='title') this.panel.innerHTML=`
      <div class="eyebrow">3D モンスター討伐</div><h1>潮鳴りの<br><em>狩場</em></h1>
      <p class="title-note">大剣を手に、夕凪の石浜へ。</p>
      <div class="menu-actions monster-menu" aria-label="討伐対象を選ぶ">${this.roster.map(monster=>
        `<button class="primary" data-monster="${monster.id}">${monster.name}<span aria-hidden="true">→</span></button>`).join('')}</div>
      <div class="menu-actions">${button('rankings','世界ランキング')}${button('help','操作方法')}</div>${settings}`
    if (screen==='rankings') {
      this.panel.innerHTML=`
        <div class="eyebrow">TIME ATTACK</div><h2>世界ランキング</h2>
        <label for="ranking-boss">討伐対象</label>
        <select id="ranking-boss" class="ranking-field">${this.roster.map(monster=>
          `<option value="${monster.id}"${monster.id===this.data.id?' selected':''}>${monster.name}</option>`).join('')}</select>
        <div id="ranking-list" aria-live="polite"></div>
        <div class="menu-actions">${button('title','タイトルへ')}</div>`
      const boss=select<HTMLSelectElement>('ranking-boss')
      const list=select('ranking-list')
      boss.addEventListener('change',()=>void this.refreshRankings(boss,list))
      void this.refreshRankings(boss,list)
    }
    if (screen==='quest') this.panel.innerHTML=`
      <div class="eyebrow">討伐クエスト</div><h2>${this.data.name}</h2>
      <dl><div><dt>狩場</dt><dd>${this.field.name}</dd></div><div><dt>武器</dt><dd>${this.weapon.name}</dd></div></dl>
      <p>${this.data.id==='revotenshi'?'竜巻に当たると移動方向が5秒間逆になる。無敵バリア中は本体のHPが少しずつ回復する。分身体を2体倒すとバリアが壊れる。':this.data.id==='shikouki'?'結晶は大剣で破壊できる。紫煌天獄の着地点から離れ、着地後のダウンを狙え。':'予兆を見極めてかわし、攻撃後の隙に大剣を振り込め。'}</p>
      <p class="ranking-note">世界ランキングのタイムには一時停止中の時間も含まれる。</p>
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
      ${screen==='victory'?'<div id="ranking-result"></div>':''}
      <div class="menu-actions">${button('retry','再挑戦',true)}${button('title','タイトルへ')}${screen==='victory'?button('rankings','世界ランキング'):''}</div>`
    if (screen==='victory') void this.showRankingResult(select('ranking-result'),run,result)
    if (screen==='error') {
      this.panel.innerHTML=`<div class="eyebrow">読み込みエラー</div><h2>狩場を開けない</h2><p id="error-detail"></p><div class="menu-actions">${button('refresh','再読み込み',true)}</div>`
      select('error-detail').textContent=error??'読み込みに失敗した。'
    }
    this.panel.scrollTop=0
  }
  private async refreshRankings(boss:HTMLSelectElement, list:HTMLElement) {
    const selected=boss.value
    const loading=document.createElement('p')
    loading.textContent='ランキングを読み込み中…'
    list.replaceChildren(loading)
    try {
      const scores=await listScores(selected)
      if(!loading.isConnected) return
      if(!scores.length) {
        loading.textContent='このボスの討伐記録はまだない。'
        return
      }
      const table=document.createElement('table')
      table.className='ranking-table'
      table.innerHTML='<thead><tr><th scope="col">順位</th><th scope="col">プレイヤー</th><th scope="col">討伐タイム</th></tr></thead>'
      const body=table.createTBody()
      for(const [index,score] of scores.entries()) {
        const row=body.insertRow()
        for(const value of [String(index+1),score.nickname,rankingTime(score.time_ms)]) row.insertCell().textContent=value
      }
      list.replaceChildren(table)
    } catch {
      if(!loading.isConnected) return
      loading.textContent='ランキングに接続できなかった。'
      const retry=document.createElement('button')
      retry.type='button'; retry.className='secondary'; retry.textContent='再読み込み'
      retry.addEventListener('click',()=>void this.refreshRankings(boss,list))
      list.append(retry)
    }
  }
  private async showRankingResult(container:HTMLElement,run?:RankingRun,result?:Promise<number|null>) {
    container.innerHTML='<p class="ranking-note" role="status">ランキング用の討伐タイムを確認中…</p>'
    const status=container.querySelector('p')!
    const time=await result
    if(!container.isConnected) return
    if(!run || time==null) {
      status.textContent='今回は世界ランキングに登録できない。'
      return
    }
    const label=`世界ランキング用タイム ${rankingTime(time)}`
    status.textContent=label
    const form=document.createElement('form')
    form.className='ranking-entry'
    form.innerHTML=`<label for="ranking-nickname">公開ニックネーム</label>
      <input id="ranking-nickname" class="ranking-field" type="text" required autocomplete="nickname" maxlength="32">
      <button class="secondary" type="submit">記録を登録</button>`
    const input=form.querySelector('input')!
    const submit=form.querySelector('button')!
    try { input.value=localStorage.getItem('shiosai-ranking-nickname')??'' } catch { /* Optional preference. */ }
    form.addEventListener('submit',async event=>{
      event.preventDefault()
      if(submit.disabled) return
      const nickname=input.value.trim()
      if(!nickname || [...nickname].length>16 || /[<>\u0000-\u001f\u007f]/.test(nickname)) {
        status.textContent='ニックネームは1〜16文字で入力して。記号の < と > は使えない。'
        return
      }
      submit.disabled=true; input.disabled=true
      status.textContent='記録を登録中…'
      try {
        const saved=await saveScore(run,nickname)
        try { localStorage.setItem('shiosai-ranking-nickname',nickname) } catch { /* Optional preference. */ }
        form.remove()
        status.textContent=saved.personal_best?`自己ベストを登録した · ${rankingTime(saved.time_ms)}`:
          `${label} · 登録済みの自己ベスト ${rankingTime(saved.time_ms)}`
      } catch {
        input.disabled=false; submit.disabled=false
        status.textContent='記録を登録できなかった。もう一度試して。'
      }
    })
    container.append(form)
  }
  status(b: Battle, lock: boolean) {
    if (this.current && this.current!=='paused') return
    this.write(this.clock,clock(b.elapsed))
    this.gauge(this.hp,b.hp,this.weapon.hp)
    this.gauge(this.stamina,Math.floor(b.stamina),this.weapon.stamina)
    this.gauge(this.bossHp,b.bossHp,this.data.hp,true)
    const notice=b.callout || (lock?'ロックオン中':'')
    const reverse=b.reverseMovement>0 ? `移動反転 ${Math.ceil(b.reverseMovement)}秒` : ''
    this.write(this.callout,[reverse,notice].filter(Boolean).join(' · '))
    this.callout.classList.toggle('warning',b.bossState==='windup'||b.bossState==='rage'||b.reverseMovement>0)
    this.rage.hidden=!b.rage
    this.write(this.rage,b.rageLabel)
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
