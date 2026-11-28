import assert from 'node:assert/strict'

const {chromium,devices}=await import(process.env.HUNT_PLAYWRIGHT??'playwright')
const executablePath=process.env.HUNT_CHROMIUM
const browser=await chromium.launch({
  executablePath,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
})
try {
  const context=await browser.newContext({...devices['iPhone 13'],viewport:{width:390,height:744}})
  const page=await context.newPage()
  const errors=[]
  const rankingCalls=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('https://*.supabase.co/**',async route=>{
    const operation=route.request().url().split('/').at(-1)
    rankingCalls.push({operation,body:route.request().postDataJSON()})
    await route.fulfill({
      headers:{'access-control-allow-origin':'*'},
      json:operation==='hunt_begin_run'?'duo-test':operation==='hunt_finish_run'?85000:[],
    })
  })
  await page.goto((process.env.HUNT_URL??'http://127.0.0.1:5173')+'/?test')
  await page.getByRole('button',{name:'狩りに出る'}).click()
  await page.locator('[data-hunter="greatsword"]').click()
  await page.locator('[data-difficulty="4"]').click()
  const row=page.locator('[data-monster="kouper-raven-duo"]')
  assert.equal(await row.locator('img').count(),2)
  await row.click()
  assert.match(await page.locator('#panel').innerText(),/古代神殿跡地/)
  await page.locator('[data-cmd="start"]').click()
  await page.locator('[data-action="dodge"]').waitFor({timeout:45000})
  assert.equal(await page.locator('#boss-name').innerText(),'コウパートイパー')
  assert.equal(await page.locator('#second-boss-name').innerText(),'テラキュラーレイヴン')
  assert.equal(await page.locator('#boss-hp').getAttribute('aria-valuemax'),'2400')
  assert.equal(await page.locator('#second-boss-hp').getAttribute('aria-valuemax'),'1750')
  await page.waitForFunction(()=>document.querySelectorAll('#reticles button').length===2)
  await page.getByRole('button',{name:'テラキュラーレイヴンをロックオン'}).dispatchEvent('click')
  await page.waitForFunction(()=>window.huntTest.battle.selectedLockTarget?.data.id==='terracular-raven')
  await page.locator('#pause').tap()

  const results=await page.evaluate(async()=>{
    const {battle,battle: {paperBoss,ravenBoss}}=window.huntTest
    const {FlareModel}=await import('/src/flare/model.ts')
    const fail=(condition,message)=>{if(!condition) throw Error(message)}
    let seed=413807
    Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
    const input={
      take:()=>false, has:()=>false, held:()=>false, movement:out=>{out.x=out.y=0},
      takeChargeCancel:()=>false,takeChargeRelease:()=>false,clearCombatBuffer:()=>{},
    }
    const dt=1/60
    const stopAttacking=()=>{paperBoss.waitUntil=Infinity;ravenBoss.nextDecisionAt=Infinity}
    const step=()=>battle.update(dt,input,Math.PI)
    const danger=b=>['windup','attack','rage'].includes(b.bossState)
    const reset=()=>{battle.reset();fail(battle.reticleTargets.length===2,'two live targets after reset')}
    reset()
    const actions=new Set()
    for(let frame=0;frame<1200;frame++) {
      // Isolate AI scheduling from the idle test hunter's HP.
      battle.hp=battle.weapon.hp
      step()
      fail(!(danger(paperBoss)&&danger(ravenBoss)),'two new attack sequences at once')
      if(danger(paperBoss)) actions.add('paper')
      if(danger(ravenBoss)) actions.add('raven')
    }
    fail(actions.size===2,'both bosses need to attack')

    reset()
    stopAttacking()
    step()
    const before=battle.hp
    fail(ravenBoss.damagePlayer({damage:10,knockdown:false},ravenBoss.m),'Raven hit the shared hunter')
    fail(!paperBoss.damagePlayer({damage:10,knockdown:false},paperBoss.m,1),'shared hit immunity')
    fail(battle.hp===before-10,'one hunter health pool')
    paperBoss.attachedUntil=battle.elapsed+6
    battle.onDodge(paperBoss.m.clone().set(1,0,0))
    fail(paperBoss.removes===1,'single dodge forwarded once')
    battle.onDodge(paperBoss.m.clone().set(0,0,1))
    fail(paperBoss.attachedUntil===0,'two dodges clear cursed paper')

    const contact=(position,radius=1)=>center=>center.distanceToSquared(position)/radius**2
    const touchAll=()=>0
    reset()
    stopAttacking()
    step()
    const paperHealth=paperBoss.bossHp,ravenHealth=ravenBoss.bossHp
    const bolt=battle.strikeWithMagic(contact(ravenBoss.monster.parts[0].center,.9),20)
    fail(bolt>0 && ravenBoss.bossHp<ravenHealth && paperBoss.bossHp===paperHealth,'bolt only hits the contacted opponent')
    const beforeArea=ravenBoss.bossHp
    battle.strikeWithMagic(touchAll,30,'フレアⅠ')
    fail(ravenBoss.bossHp<beforeArea&&paperBoss.bossHp<paperHealth,'area magic hits both')
    const targets=new Set()
    battle.strikeSecondary(30,touchAll,true,targets)
    const paperOnce=paperBoss.bossHp,ravenOnce=ravenBoss.bossHp
    fail(targets.size===2,'greatsword skill can reach both')
    battle.strikeSecondary(30,touchAll,true,targets)
    fail(paperBoss.bossHp===paperOnce&&ravenBoss.bossHp===ravenOnce,'one hit per opponent per skill')

    for(const [first,second] of [[paperBoss,ravenBoss],[ravenBoss,paperBoss]]) {
      reset()
      stopAttacking()
      battle.selectLockTarget(first.monster)
      if(first===paperBoss) paperBoss.finishedUltimates=2
      battle.strikeWithMagic(contact(first.monster.parts[0].center),first.bossHp+5)
      fail(first.outcome==='victory'&&!battle.outcome,'first kill must not finish the quest')
      fail(battle.reticleTargets.length===1&&battle.reticleTargets[0]===second.monster,'defeated opponent removed from lock targets')
      step()
      fail(battle.selectedLockTarget===second.monster,'lock transfers to surviving opponent')
      if(second===paperBoss) paperBoss.finishedUltimates=2
      battle.strikeWithMagic(contact(second.monster.parts[0].center),second.bossHp+5)
      fail(battle.outcome==='victory'&&battle.reticleTargets.length===0,'both kills finish the quest')
      fail(battle.cameraMonster===second.monster,'victory camera follows the last defeated target')
    }

    reset()
    stopAttacking()
    step()
    ravenBoss.damagePlayer({damage:999,knockdown:false},ravenBoss.m)
    step()
    fail(battle.outcome==='failure'&&paperBoss.outcome==='failure'&&ravenBoss.outcome==='failure','hunt failure clears both opponents')
    const flare=await FlareModel.load()
    reset()
    battle.selectHunter(flare)
    fail(battle.flare&&battle.hunter.root.children.includes(flare.root),'Flare uses the shared hunter model')
    battle.selectHunter()
    reset()
    paperBoss.finishedUltimates=2
    battle.strikeWithMagic(touchAll,9999,'フレアⅢ')
    fail(battle.outcome==='victory','one area attack may finish both remaining targets')
    return [...actions]
  })
  assert.deepEqual(new Set(results),new Set(['paper','raven']))
  await page.locator('[data-cmd="resume"]').tap()
  await page.getByRole('heading',{name:'討伐成功'}).waitFor()
  assert(rankingCalls.some(call=>call.operation==='hunt_finish_run' && call.body.p_boss==='kouper-raven-duo'))
  await page.locator('[data-cmd="title"]').tap()
  assert.equal(await page.evaluate(()=>window.huntTest.battle.sceneModels.every(model=>!model.root.parent)),true)
  assert(rankingCalls.some(call=>call.operation==='hunt_begin_run' && call.body.p_boss==='kouper-raven-duo'))
  await page.getByRole('button',{name:'狩りに出る'}).click()
  await page.locator('[data-hunter="greatsword"]').click()
  await page.locator('[data-difficulty="2"]').click()
  await page.locator('[data-monster="terracular-raven"]').click()
  await page.locator('[data-cmd="start"]').click()
  await page.locator('[data-action="dodge"]').waitFor({timeout:45000})
  assert.equal(await page.locator('#boss-name').innerText(),'テラキュラーレイヴン')
  assert.equal(await page.locator('#second-boss-status').isHidden(),true)
  assert.deepEqual(errors,[])
  console.log('Duo hunt: both attacks, shared player damage, weapon hits, both kill orders, lock transfer, retry, failure and scene cleanup.')
} finally {
  await browser.close()
}
