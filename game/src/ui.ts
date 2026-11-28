import { fieldFor } from './fields'
import type { MonsterData, WeaponData } from './config'
import type { Battle } from './battle'
import type { BattleAudio } from './battle-audio'
import { maxEnergy } from './flare/combat'
import { clamp } from './math'
import { bestClearTime } from './clear-times'
import { difficulties, difficultyInfo, quests, questIcons, type Difficulty } from './quests'
import { listScores, monsterPlayerCounts, rankingTime, saveScore, type HunterId, type RankingRun } from './rankings'

const select = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
export type Screen = 'loading' | 'title' | 'hunters' | 'difficulty' | 'monsters' | 'quest' | 'quest-guide' | 'paused' | 'help' | 'victory' | 'failure' | 'error' | 'rankings' | 'boss-rankings' | 'layout'
export type Command = 'start' | 'resume' | 'title' | 'help' | 'back' | 'retry' | 'refresh' | 'hunters' | 'difficulty' | 'monsters' | 'quest' | 'quest-guide' | 'rankings' | 'boss-rankings' | 'ranking-back' | 'layout'
export type Quality = 'low' | 'medium' | 'high'
export type ClearResult = { time: number; previousBest?: number }
const hunterLabels: Record<HunterId,string> = {greatsword:'大剣',flare:'魔法使い'}
const playerCountFormat = new Intl.NumberFormat('ja-JP')
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
  private hp=select('hp')
  private stamina=select('stamina')
  private flareStatus=select('flare-status')
  private energy=select('energy')
  private energyValue=select('energy-value')
  private skillButton=document.querySelector<HTMLButtonElement>('[data-action="skill"]')!
  private skillLabel=this.skillButton.firstChild!
  private skillTimer=this.skillButton.querySelector('small')!
  private attackButton=document.querySelector<HTMLButtonElement>('[data-action="attack"]')!
  private specialButton=document.querySelector<HTMLButtonElement>('[data-action="charge"]')!
  private keyHint=select('key-hint')
  private bossName=select('boss-name')
  private bossHp=select('boss-hp')
  private secondBoss=select('second-boss-status')
  private secondBossName=select('second-boss-name')
  private secondBossHp=select('second-boss-hp')
  private callout=select('callout')
  private rage=select('rage')
  private charge=select('charge-meter')
  private banner=select('quest-banner')
  private current: Screen | null = null
  private monsterPage=0
  private cache = new Map<HTMLElement,string>()

  constructor(private data: MonsterData, private weapon: WeaponData, private coarse: boolean, private send: (command: Command) => void, private onQuality: (quality: Quality) => void, private chooseDifficulty: (level:Difficulty) => void, private choose: (id:string) => void, private audio:BattleAudio, private chooseHunter:(id:string)=>void) {
    document.documentElement.classList.toggle('coarse',coarse)
    this.panel.addEventListener('input',event=>{
      const slider=event.target as HTMLInputElement
      const bus=slider.dataset.volume
      if(bus!=='bgm' && bus!=='sfx') return
      this.audio.setVolume(bus,slider.valueAsNumber)
      const display=this.panel.querySelector<HTMLOutputElement>(`output[for="${slider.id}"]`)
      if(display) display.value=`${this.audio.volume(bus)}%`
    })
    this.panel.addEventListener('click',e => {
      const button=(e.target as HTMLElement).closest<HTMLButtonElement>('button')
      if (!button) return
      const level=difficulties.find(level=>String(level)===button.dataset.difficulty)
      if (level) this.chooseDifficulty(level)
      if (button.dataset.hunter) this.chooseHunter(button.dataset.hunter)
      if (button.dataset.monster) this.choose(button.dataset.monster)
      if (button.dataset.cmd) this.send(button.dataset.cmd as Command)
      if (button.dataset.quality) {
        this.onQuality(button.dataset.quality as Quality)
        for (const el of this.panel.querySelectorAll<HTMLButtonElement>('[data-quality]')) el.setAttribute('aria-pressed',String(el===button))
      }
      if (button.dataset.bgm) {
        this.audio.setEnabled(button.dataset.bgm==='on')
        for(const el of this.panel.querySelectorAll<HTMLButtonElement>('[data-bgm]')) el.setAttribute('aria-pressed',String(el===button))
      }
    })
  }
  selectMonster(data:MonsterData) {
    this.data=data
  }
  show(screen: Screen | null, quality: Quality, battle?: Battle, error?: string, run?:RankingRun, result?:Promise<number|null>, difficulty:Difficulty=1, hunter:HunterId='greatsword', clear?:ClearResult) {
    if(screen==='monsters' && this.current==='difficulty') this.monsterPage=0
    this.current=screen
    this.menu.hidden=!screen || screen==='layout'
    this.menu.dataset.screen=screen??''
    document.body.dataset.screen=screen??'battle'
    this.hud.hidden=!!screen && screen!=='paused' && screen!=='layout'
    this.hud.inert=screen==='layout'
    this.touch.hidden=!!screen && screen!=='layout'
    this.touch.classList.toggle('keyboard-only',!this.coarse && screen!=='layout')
    const flare=!!battle?.flare && (!screen || screen==='paused')
    this.flareStatus.hidden=!flare
    this.skillLabel.textContent=flare?'残火':'踏み込み'
    this.skillButton.setAttribute('aria-label',flare?'残火跳び':'踏み込み斬り')
    this.write(this.skillTimer,'')
    this.skillButton.removeAttribute('aria-disabled')
    this.attackButton.textContent=flare?'魔弾':'斬撃'
    this.specialButton.innerHTML=flare?'フレア':'溜め斬り<small>長押し</small>'
    this.cache.delete(this.specialButton)
    this.specialButton.classList.toggle('flare-button',flare)
    this.specialButton.removeAttribute('aria-disabled')
    this.keyHint.textContent=`WASD 移動　 J ${flare?'魔弾':'攻撃'}　 K ${flare?'フレア':'溜め'}　 E ${flare?'残火':'踏み込み'}　 Space 回避　 L ガード　 Q ロックオン`
    if (!screen || screen==='layout') return
    const button = (cmd: Command, name: string, primary=false) => `<button class="${primary?'primary':'secondary'}" data-cmd="${cmd}">${name}${primary?'<span aria-hidden="true">→</span>':''}</button>`
    const volume = (bus: 'bgm' | 'sfx', label: string) => {
      const value=this.audio.volume(bus)
      return `<div class="volume-setting"><label for="volume-${bus}">${label}</label>
        <input type="range" id="volume-${bus}" data-volume="${bus}" min="0" max="100" step="1" value="${value}">
        <output for="volume-${bus}">${value}%</output></div>`
    }
    const settings = `<div class="options"><div class="settings"><span>画質</span><div role="group" aria-label="画質">${(Object.keys(qualityLabels) as Quality[]).map(q=>`<button data-quality="${q}" aria-pressed="${q===quality}">${qualityLabels[q]}</button>`).join('')}</div></div>
      <div class="settings bgm-settings"><span>戦闘BGM</span><div role="group" aria-label="戦闘BGM"><button data-bgm="on" aria-pressed="${this.audio.enabled}">あり</button><button data-bgm="off" aria-pressed="${!this.audio.enabled}">なし</button></div></div>
      <div class="volume-settings">${volume('bgm','BGM音量')}${volume('sfx','効果音音量')}</div></div>`
    if (screen==='loading') this.panel.innerHTML='<div class="eyebrow">MEGANE HUNT</div><h1>メガネハント</h1><p role="status">闘技場を読み込み中…</p><div class="loading-line"></div>'
    if (screen==='title') this.panel.innerHTML=`
      <div class="eyebrow">3D モンスター討伐</div><h1>メガネ<em>ハント</em></h1>
      <div class="menu-actions">${button('hunters','狩りに出る',true)}${button('rankings','世界ランキング')}${button('help','操作方法')}${button('layout','操作配置')}</div>
      <details class="menu-disclosure"><summary>画質・音量</summary>${settings}</details>`
    const icon=(quest:(typeof quests)[number])=>{
      const [first,second]=questIcons(quest)
      return second
        ? `<span class="quest-icon duo-quest-icon" aria-hidden="true"><img src="${first}" alt=""><img src="${second}" alt=""></span>`
        : `<img class="quest-icon" src="${first}" alt="">`
    }
    const selected=quests.find(quest=>quest.monster.id===this.data.id)!
    if (screen==='hunters') this.panel.innerHTML=`
      <h2>キャラクターを選ぶ</h2>
      <div class="difficulty-list">
        <button class="secondary difficulty-button" data-hunter="greatsword"><strong>大剣</strong><span>ハンター</span></button>
        <button class="secondary difficulty-button" data-hunter="flare"><strong>フレア</strong><span>魔法使い</span></button>
      </div>
      <div class="menu-actions">${button('title','戻る')}</div>`
    if (screen==='difficulty') this.panel.innerHTML=`
      <h2>難易度を選ぶ</h2>
      <div class="difficulty-list">${difficulties.map(level=>
        `<button class="secondary difficulty-button" data-difficulty="${level}"><strong>${difficultyInfo[level].name}</strong><span>${difficultyInfo[level].description}</span></button>`).join('')}</div>
      <div class="menu-actions">${button('hunters','戻る')}</div>`
    const count=(boss:string)=>`<span class="player-count" data-player-count="${boss}">集計中…</span>`
    if (screen==='monsters') {
      this.panel.innerHTML=`
        <h2>${difficultyInfo[difficulty].name}のモンスター</h2>
        <ul class="quest-list" data-difficulty="${difficulty}" aria-label="討伐対象"></ul>
        <div class="menu-actions">${button('difficulty','戻る')}</div>`
      const candidates=quests.filter(quest=>quest.difficulty===difficulty)
      const list=this.panel.querySelector('.quest-list')!
      const counts=monsterPlayerCounts()
      this.paginate(controls=>list.after(controls),candidates.length,6,this.monsterPage,(start,end,page)=>{
        this.monsterPage=page
        list.innerHTML=candidates.slice(start,end).map(quest=>
          `<li><button class="secondary quest-row" data-monster="${quest.monster.id}">${icon(quest)}<span class="quest-name"><strong>${quest.name}</strong>${count(quest.monster.id)}</span></button></li>`).join('')
        void this.showPlayerCounts(list.querySelectorAll<HTMLElement>('[data-player-count]'),counts)
      })
    }
    if (screen==='rankings' || screen==='boss-rankings') {
      const dedicated=screen==='boss-rankings'
      this.panel.innerHTML=`
        <h2>世界ランキング</h2>
        <div class="ranking-target">
          ${dedicated?`<div class="ranking-monster">${icon(selected)}<strong>${selected.name}</strong></div>`:`
            <select id="ranking-boss" class="ranking-field" aria-label="討伐対象">${quests.map(quest=>
              `<option value="${quest.monster.id}"${quest.monster.id===this.data.id?' selected':''}>${quest.name}</option>`).join('')}</select>`}
          <span class="player-count-note">${count(selected.monster.id)} · 自分を除く</span>
        </div>
        <div class="ranking-hunters settings"><div role="group" aria-label="ランキングの部門">${(Object.keys(hunterLabels) as HunterId[]).map(id=>
          `<button type="button" data-ranking-hunter="${id}" aria-pressed="${id===hunter}">${hunterLabels[id]}</button>`).join('')}</div></div>
        <div id="ranking-list" aria-live="polite"></div>
        <div class="ranking-footer">${button('ranking-back','戻る')}</div>
        <small class="ranking-rule">一時停止中も計測</small>`
      const list=select('ranking-list')
      const footer=this.panel.querySelector('.ranking-footer')!
      const boss=this.panel.querySelector<HTMLSelectElement>('#ranking-boss')
      let category=hunter
      const refresh=()=>void this.refreshRankings(boss?.value??this.data.id,category,list,footer)
      const playerCount=this.panel.querySelector<HTMLElement>('[data-player-count]')!
      const counts=monsterPlayerCounts()
      void this.showPlayerCounts([playerCount],counts)
      boss?.addEventListener('change',()=>{
        playerCount.dataset.playerCount=boss.value
        void this.showPlayerCounts([playerCount],counts)
        refresh()
      })
      const tabs=this.panel.querySelectorAll<HTMLButtonElement>('[data-ranking-hunter]')
      for(const tab of tabs) tab.addEventListener('click',()=>{
        const next=tab.dataset.rankingHunter as HunterId
        if(next===category) return
        category=next
        for(const item of tabs) item.setAttribute('aria-pressed',String(item===tab))
        refresh()
      })
      refresh()
    }
    if (screen==='quest') {
      const best=bestClearTime(this.data.id,hunter)
      this.panel.innerHTML=`
        <div class="quest-heading" data-difficulty="${selected.difficulty}">${icon(selected)}<div><span class="quest-level">${difficultyInfo[selected.difficulty].name}</span><h2>${selected.name}</h2></div></div>
        <dl class="quest-facts">
          <div><dt>狩場</dt><dd>${fieldFor(selected.monster.fieldId).name}</dd></div>
          ${selected.targets?`<div><dt>討伐対象</dt><dd>${selected.targets.join('・')}</dd></div>`: ''}
          <div><dt>武器</dt><dd>${hunterLabels[hunter]}</dd></div>
          <div><dt>自己ベスト</dt><dd>${best===undefined?'未クリア':rankingTime(best)}</dd></div>
        </dl>
        <div class="menu-actions compact-actions">${button('start','出撃',true)}${button('quest-guide','攻略')}${button('boss-rankings','ランキング')}${button('monsters','戻る')}</div>`
    }
    if (screen==='quest-guide') this.panel.innerHTML=`
      <h2>${selected.name}</h2>
      ${selected.englishName?`<small>${selected.englishName}</small>`:''}
      <dl class="quest-facts">
        ${selected.species?`<div><dt>種族・属性</dt><dd>${selected.species}</dd></div>`:''}
        <div><dt>主な攻撃</dt><dd>${selected.attacks}</dd></div>
      </dl>
      <ul class="quest-tips">${selected.advice.map(tip=>`<li>${tip}</li>`).join('')}</ul>
      <div class="menu-actions">${button('quest','戻る')}</div>`
    if (screen==='paused') this.panel.innerHTML=`<div class="eyebrow">PAUSE</div><h2>一時停止</h2><dl><div><dt>経過時間</dt><dd>${clock(battle?.elapsed??0)}</dd></div></dl><div class="menu-actions">${button('resume','狩りに戻る',true)}${button('help','操作方法')}${button('retry','再挑戦')}${button('title','タイトルへ')}</div>${settings}`
    if (screen==='help') this.panel.innerHTML=`
      <div class="eyebrow">FIELD MANUAL</div><h2>狩りの操作</h2>
      <div class="manual-wrapper"><table><thead><tr><th>操作</th><th>スマホ</th><th>PC</th></tr></thead><tbody>
      <tr><th>移動</th><td>移動スティックをドラッグ</td><td>WASD / 矢印</td></tr>
      <tr><th>視点</th><td>空いている画面を左右にスワイプ</td><td>マウスで左右にドラッグ</td></tr>
      <tr><th>攻撃</th><td>斬撃</td><td>J</td></tr>
      <tr><th>溜め攻撃</th><td>溜めを長押しして離す</td><td>K を長押しして離す</td></tr>
      <tr><th>フレア</th><td>魔弾・フレア</td><td>J で魔弾 / K でフレア</td></tr>
      <tr><th>踏み込み斬り／残火跳び</th><td>踏み込み／残火</td><td>E</td></tr>
      <tr><th>回避</th><td>回避</td><td>Space</td></tr>
      <tr><th>ガード</th><td>ガードを長押し</td><td>L を長押し</td></tr>
      <tr><th>ロックオン</th><td>敵のアイコンをタップ、照準で解除</td><td>アイコンをクリック、Qで切替</td></tr>
      <tr><th>一時停止</th><td>一時停止ボタン</td><td>Esc / P</td></tr></tbody></table></div>
      <p>斬撃の終わり際にもう一度入力すると、最大3段まで繋がる。移動入力なしで回避すると後ろへ下がる。相手を正面に捉えるとガードが効く。フレアは魔弾の命中でエネルギーを貯め、使える最上位の技を発動する。スマホは縦・横どちらでも遊べる。タイトル画面の「操作配置」で向きごとにタッチ操作を調整できる。</p>
      <div class="menu-actions">${button('back','戻る',true)}</div>
      <p class="ranking-note"><a href="${import.meta.env.BASE_URL}licenses/ancient-temple.txt" target="_blank" rel="noopener">素材クレジット</a></p>`
    if (screen==='victory' || screen==='failure') {
      const victory=screen==='victory'
      const difference=clear?.previousBest===undefined?undefined:clear.time-clear.previousBest
      const record=difference===undefined?'初クリア':difference===0?'自己ベストと同タイム':
        difference<0?`自己ベスト更新 · −${rankingTime(-difference)}`:`自己ベストとの差 +${rankingTime(difference)}`
      this.panel.innerHTML=`
        <h2>${victory?'討伐成功':'討伐失敗'}</h2>
        <p class="result-target">${selected.name} · ${hunterLabels[hunter]}</p>
        <p class="result-time" aria-label="${victory?'討伐タイム':'経過時間'}">${victory && clear?rankingTime(clear.time):clock(battle?.elapsed??0)}</p>
        ${victory && clear?`<p class="result-record">${record}</p>`:''}
        <div class="menu-actions compact-actions">${button('retry','再戦',true)}${button('monsters','選択へ')}${victory?button('boss-rankings','ランキング'):''}${button('title','タイトルへ')}</div>
        ${victory?'<div id="ranking-result"></div>':''}`
    }
    if (screen==='victory') void this.showRankingResult(select('ranking-result'),run,result)
    if (screen==='error') {
      this.panel.innerHTML=`<div class="eyebrow">読み込みエラー</div><h2>狩場を開けない</h2><p id="error-detail"></p><div class="menu-actions">${button('refresh','再読み込み',true)}</div>`
      select('error-detail').textContent=error??'読み込みに失敗した。'
    }
    this.panel.scrollTop=0
  }

  private paginate(placeControls:(controls:HTMLDivElement)=>void,total:number,size:number,page:number,render:(start:number,end:number,page:number)=>void) {
    const pages=Math.ceil(total/size)
    if(pages<=1) {
      render(0,total,0)
      return
    }
    const controls=document.createElement('div')
    controls.className='page-controls'
    controls.innerHTML='<button class="secondary" type="button">前へ</button><span aria-live="polite"></span><button class="secondary" type="button">次へ</button>'
    placeControls(controls)
    const [previous,next]=controls.querySelectorAll('button')
    const indicator=controls.querySelector('span')!
    const update=(requested:number)=>{
      page=clamp(requested,0,pages-1)
      render(page*size,Math.min((page+1)*size,total),page)
      indicator.textContent=`${page+1} / ${pages}`
      previous.disabled=page===0
      next.disabled=page===pages-1
    }
    previous.addEventListener('click',()=>update(page-1))
    next.addEventListener('click',()=>update(page+1))
    update(page)
  }

  private async showPlayerCounts(labels:Iterable<HTMLElement>, request:ReturnType<typeof monsterPlayerCounts>) {
    const entries=Array.from(labels,label=>({label,boss:label.dataset.playerCount!}))
    for(const {label} of entries) label.textContent='集計中…'
    const counts=await request.catch(()=>undefined)
    for(const {label,boss} of entries) {
      if (!label.isConnected || label.dataset.playerCount!==boss) continue
      label.textContent=counts ? `挑戦者 ${playerCountFormat.format(counts.get(boss)??0)}人` : '挑戦者数 未取得'
    }
  }
  private async refreshRankings(selected:string, hunter:HunterId, list:HTMLElement, footer:Element) {
    footer.querySelector('.page-controls')?.remove()
    const loading=document.createElement('p')
    loading.textContent='ランキングを読み込み中…'
    list.replaceChildren(loading)
    try {
      const scores=await listScores(selected,hunter)
      if(!loading.isConnected) return
      if(!scores.length) {
        loading.textContent='この部門の討伐記録はまだない。'
        return
      }
      const table=document.createElement('table')
      table.className='ranking-table'
      table.innerHTML='<thead><tr><th scope="col">順位</th><th scope="col">プレイヤー</th><th scope="col">討伐タイム</th></tr></thead>'
      list.replaceChildren(table)
      const body=table.createTBody()
      this.paginate(controls=>footer.append(controls),scores.length,4,0,(start,end)=>{
        body.replaceChildren()
        for(let index=start;index<end;index++) {
          const score=scores[index]
          const row=body.insertRow()
          for(const value of [String(index+1),score.nickname,rankingTime(score.time_ms)]) row.insertCell().textContent=value
        }
      })
    } catch {
      if(!loading.isConnected) return
      loading.textContent='ランキングに接続できなかった。'
      const retry=document.createElement('button')
      retry.type='button'; retry.className='secondary'; retry.textContent='再読み込み'
      retry.addEventListener('click',()=>void this.refreshRankings(selected,hunter,list,footer))
      list.append(retry)
    }
  }
  private async showRankingResult(container:HTMLElement,run?:RankingRun,result?:Promise<number|null>) {
    container.innerHTML='<details class="menu-disclosure"><summary>ランキング記録の登録</summary><p class="ranking-note" role="status">登録できる記録を確認中…</p></details>'
    const details=container.querySelector('details')!
    const status=container.querySelector('p')!
    const time=await result
    if(!container.isConnected) return
    if(!run || time==null) {
      status.textContent='今回は世界ランキングに登録できない。'
      return
    }
    const label=`${hunterLabels[run.hunter]}の世界ランキング用タイム ${rankingTime(time)}`
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
    details.append(form)
  }
  status(b: Battle, lock: boolean) {
    if (this.current && this.current!=='paused' && this.current!=='layout') return
    this.gauge(this.hp,b.hp,this.weapon.hp)
    this.gauge(this.stamina,Math.floor(b.stamina),this.weapon.stamina)
    this.write(this.bossName,b.monster.data.name)
    if(b.flare) {
      const energy=Math.floor(b.flare.energy)
      const spell=b.flare.available
      this.gauge(this.energy,energy,maxEnergy)
      this.write(this.energyValue,`${energy} / ${maxEnergy}`)
      this.write(this.specialButton,spell?.name??'フレア')
      this.specialButton.setAttribute('aria-disabled',String(!spell))
    }
    if(this.current!=='layout') {
      const cooldown=Math.ceil(b.skillCooldown)
      this.write(this.skillTimer,cooldown ? cooldown+'秒' : '')
      this.skillButton.setAttribute('aria-disabled',String(cooldown>0 || !!b.outcome))
    }
    this.gauge(this.bossHp,b.bossHp,b.monster.data.hp)
    const second=b.secondaryBossHealth
    this.secondBoss.hidden=!second
    this.hud.classList.toggle('duo-hud',!!second)
    if(second) {
      this.write(this.secondBossName,second.name)
      this.gauge(this.secondBossHp,second.hp,second.max)
    }
    const notice=b.callout || (lock?'ロックオン中':'')
    const reverse=b.reverseMovement>0 ? `移動反転 ${Math.ceil(b.reverseMovement)}秒` : ''
    this.write(this.callout,[reverse,b.statusNotice,notice].filter(Boolean).join(' · '))
    this.callout.classList.toggle('warning',b.bossState==='windup'||b.bossState==='rage'||b.reverseMovement>0)
    this.rage.hidden=!b.rage
    this.write(this.rage,b.rageLabel)
    this.charge.hidden=b.chargeValue===0
    this.charge.style.setProperty('--value',String(b.chargeValue))
    this.charge.classList.toggle('full',b.chargeValue>=.98)
    this.banner.hidden=this.current==='layout' || b.elapsed>2.1 || b.outcome!==null
    this.write(this.banner,'クエスト開始')
    const button=document.querySelector('[data-action="lock"]')
    button?.classList.toggle('locked',lock)
    button?.setAttribute('aria-pressed',String(lock))
  }
  private gauge(el: HTMLElement,value: number,max: number) {
    const formatted=`${value}/${max}`
    if(this.cache.get(el)===formatted) return
    this.cache.set(el,formatted)
    el.style.setProperty('--value',String(clamp(value/max,0,1)))
    el.setAttribute('aria-valuemin','0'); el.setAttribute('aria-valuemax',String(max)); el.setAttribute('aria-valuenow',String(value))
  }
  private write(el: HTMLElement,text: string) {
    if(el.textContent!==text) el.textContent=text
  }
}
