import assert from 'node:assert/strict'
const {chromium}=await import(process.env.KOUPER_PLAYWRIGHT ?? 'playwright')
const browserPath=process.env.KOUPER_CHROMIUM
const browser=await chromium.launch(browserPath?{executablePath:browserPath,args:['--no-sandbox']}:{})
const origin=process.env.KOUPER_URL ?? 'http://127.0.0.1:5173'
try {
  const page=await browser.newPage()
  await page.route('**/kouper-qa',route=>route.fulfill({contentType:'text/html',body:'<main id="numbers"></main>'}))
  await page.goto(origin+'/kouper-qa')
  const result=await page.evaluate(async()=>{
    const [{MonsterModel},{HunterModel},{Arena},{fieldFor},{Effects},{greatsword},{FlareModel},
      {KouperBattle},{kouper,attacks,attackIds,paper},{DangerMap},{makePlan,contains,walkable,plannedPaper},{Vector3}
    ]=await Promise.all([import('/src/monster-model.ts'),import('/src/hunter.ts'),import('/src/world.ts'),import('/src/fields.ts'),
      import('/src/effects.ts'),import('/src/config.ts'),import('/src/flare/model.ts'),import('/src/kouper/battle.ts'),
      import('/src/kouper/config.ts'),import('/src/kouper/ai.ts'),import('/src/kouper/plan.ts'),import('/node_modules/.vite/deps/three.js')])
    const arena=new Arena(fieldFor('FIELD_002')); await arena.prepare()
    const monster=await MonsterModel.load(kouper), hunter=new HunterModel(), fx=new Effects()
    const b=new KouperBattle(monster,hunter,arena,fx,greatsword)
    const point=(x,z)=>new Vector3(x,0,z)
    const ok=(test,detail)=>{if(!test)throw new Error(detail)}
    const step=1/60
    let direction=point(0,0), guard=false, moves=new Set()
    const input={
      take:k=>moves.delete(k),has:k=>moves.has(k),held:k=>k==='guard'?guard:moves.has(k),
      movement:p=>{p.x=-direction.x;p.y=-direction.z}, clearCombatBuffer:()=>moves.clear(),
      takeChargeRelease:()=>false,takeChargeCancel:()=>false,
    }
    const tick=()=>b.update(step,input,0)
    const secs=(n,callback)=>{for(let i=0;i<Math.ceil(n/step);i++){callback?.(i);tick()}}
    const mode=(x,z)=>{direction.x=x;direction.z=z;direction.normalize()}
    const freeze=()=>{b.reset();b.waitUntil=Infinity;direction.set(0,0,0);guard=false;moves.clear();b.m.copy(point(0,0))}
    let seed=73491
    Math.random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296)
    const model={animations:monster.details.clips.length,bones:monster.details.bones.length, head:monster.parts[0].center.toArray()}
    ok(model.animations===25 && model.bones===12,'rig and animation count')
    const plans=[]
    for(const id of attackIds) for(const rage of [false,true]) {
      if(id==='chain'&&!rage) continue
      freeze(); b.rage=rage
      const player=point(0,attacks[id].ideal), body=point(0,0)
      b.p.copy(player)
      const plan=makePlan(id,arena,body,player,0,0,rage,1,kouper.radius)
      const tm=new DangerMap(arena)
      tm.update(0,[])
      const route=tm.escape({point:player,velocity:point(0,0),walk:greatsword.walk,roll:greatsword.roll,
        evadeDelay:0,rollPhase:-1,rollDirection:point(0,0),rollWait:0},0,
        [...plan.zones,...plan.papers.map(x=>plannedPaper(x))],body,kouper.radius,plan)
      ok(route?.length>0,id+' safe escape '+rage)
      ok(route.every(p=>walkable(arena,p.x,p.z,.44)),id+' blocked escape')
      b.beginAttackPlan(plan)
      const impact=plan.zones[0]
      secs(plan.windup+plan.active+.04,(i)=>{
        const at=(i+1)*step
        const zone=plan.zones.find(z=>at>=z.at && at<=z.until+.01)??impact
        if(id==='sweep') b.p.copy(zone.point).add(point(0,2))
        else b.p.copy(zone.point)
        if(id==='chain'||rage) b.immune=0
      })
      ok(b.hp<b.weapon.hp,id+' direct damage '+rage)
      ok(b.stamps.length<=paper.max,id+' paper cap')
      ok(b.state==='Recovery',id+' recovery')
      ok(Math.abs(b.recovery-attacks[id].recovery*(rage?.8:1))<1e-8,id+' recovery time')
      if(id==='chain') ok(b.hp===b.weapon.hp-Math.round(32*1.3*1.3),'chain multiple hits')
      plans.push([id,rage,+(b.weapon.hp-b.hp).toFixed(1),route.length])
    }
    const lockedPlayer={point:point(21,0),velocity:point(0,0),walk:greatsword.walk,roll:greatsword.roll,
      evadeDelay:1.25,rollPhase:-1,rollDirection:point(0,0),rollWait:1.25}
    const trappedMap=new DangerMap(arena)
    trappedMap.update(0,[])
    ok(!trappedMap.escape(lockedPlayer,0,[{
      point:lockedPlayer.point, radius:7, at:.35, until:.54, warn:0, damage:30, strike:1, kind:'blast',
    }],point(19,0),kouper.radius),'must reject inescapable wall/lock combination')
    const sampleStamp=(at)=>({point:b.p.clone(),radius:paper.radius,placed:b.elapsed,at,damage:paper.damage,strike:300,
      immediate:false,ultimate:false,warned:false})
    freeze();b.p.copy(point(11,1));b.place(sampleStamp(2.5));tick()
    let expires=b.attachedUntil, life=b.hp
    ok(expires-b.elapsed>=5.99,'attach timer')
    secs(.1)
    ok(b.attachedUntil===expires,'attachment refreshed')
    b.p.copy(point(15,2));mode(1,0);moves.add('dodge');tick()
    ok(b.removes===1&&b.attachedUntil===expires,'first dodge')
    secs(.68);moves.add('dodge');tick()
    ok(b.attachedUntil===0 && b.hp===life,'second dodge clears')
    freeze();b.p.copy(point(11,1));b.place(sampleStamp(2.5));tick();b.p.copy(point(16,1))
    secs(6.05)
    ok(b.hp===97.5,'exact 25% expiry')
    freeze();b.p.copy(point(11,1));for(let i=0;i<18;i++) b.place({...sampleStamp(2.5),strike:i})
    ok(b.stamps.length===12,'paper 12 cap')
    freeze();b.p.copy(point(18,0));b.bossHp=b.monster.data.hp*.49
    secs(.1);ok(b.state==='RageTransition','rage threshold')
    secs(8.1)
    ok(b.state==='UltimateRecovery','first ultimate one')
    let rest=b.stateAt
    b.bossHp=b.monster.data.hp*.19
    secs(2.6)
    ok(b.state==='UltimateRecovery' && b.stateAt===rest,'cannot cancel fatigue')
    secs(9)
    ok(b.firedUltimates===2,'second ultimate threshold')
    for(let i=0;i<8/step&&b.finishedUltimates<2;i++) tick()
    ok(b.finishedUltimates===2 && b.stamps.length===0,'ultimates and cleanup')
    ok(b.hp===b.weapon.hp,'safe ultimate region '+b.hp)
    const flare=await FlareModel.load()
    const runs=[]
    for(const style of ['front','long','guard','dodge','flank','rear','flee','wall','counter','novice','expert','flare','expert-safe','counter-safe','counter-b','counter-c','counter-d']) {
      const weapon=style==='flare'
      const careful=style.endsWith('-safe')
      b.selectHunter(weapon?flare:undefined)
      freeze();b.waitUntil=.35
      if(style==='wall'){b.m.copy(point(18,0));b.p.copy(point(20.4,0));b.bossYaw=1.57}
      else if(style==='rear') b.p.copy(point(0,-3))
      else b.p.copy(point(0,6))
      b.selectLockTarget(monster)
      const timeToStop=style==='flee'||style==='wall'?35:155
      const choices={}, states={}
      let last, lastState, lastDamage=b.bossHp, prevHit=0, panicAt=0, start=performance.now(), maxAI=0
      const nav=point(0,0)
      const hazards=[]
      for(let i=0;i<timeToStop/step && !b.outcome;i++) {
        moves.clear()
        const d=b.p.distanceTo(b.m)
        const head=monster.parts[0].center
        const seek=weapon?4.6:style==='long'?6.1:2.55
        nav.subVectors(b.m,b.p).setY(0).normalize()
        const side=style==='flank'?1:-1
        if(style==='flee') mode(1,0)
        else if(style==='rear'||style==='flank') {
          const bearing=b.bossYaw+(style==='rear'?Math.PI:Math.PI*.5)
          const x=b.m.x+Math.sin(bearing)*2.35-b.p.x,z=b.m.z+Math.cos(bearing)*2.35-b.p.z
          mode(x,z)
        } else if(d>seek+.12) mode(nav.x,nav.z)
        else if(d<seek-.65) mode(-nav.x,-nav.z)
        else mode(0,0)
        hazards.length=0
        if(b.plan) hazards.push(...b.plan.zones,...b.plan.papers.filter(x=>x.immediate).map(x=>plannedPaper(x)))
        if(b.pattern) hazards.push(...b.pattern.lanes,b.pattern.final)
        hazards.push(...b.stamps.map(x=>plannedPaper(x)))
        const precise=careful||['expert','dodge','counter','flare','guard','flank','rear','wall'].includes(style)
        const danger=hazards.filter(z=>z.at>b.elapsed-.03 && z.at<b.elapsed+(careful?1.13:precise?.78:.51) && contains(z,b.p.x,b.p.z,.33)).sort((a,c)=>a.at-c.at)
        const next=danger[0]
        const recovery=['Recovery','UltimateRecovery','Stagger'].includes(b.state)
        let reaction=false
        if(next && style!=='flee' && (precise || Math.random()<.82 || b.elapsed<panicAt)) {
          reaction=true;panicAt=b.elapsed+.3
          const span=Math.max(.12,next.at-b.elapsed)
          let best=-Infinity,bestX=-nav.z*side,bestZ=nav.x*side
          for(let h=0;h<16;h++) {
            const a=h*Math.PI/8,x=Math.sin(a),z=Math.cos(a),reach=greatsword.walk*span
            const x2=b.p.x+x*reach,z2=b.p.z+z*reach
            if(!walkable(arena,x2,z2,.44)) continue
            const risk=hazards.filter(q=>q.at>b.elapsed-.03&&q.at<b.elapsed+span+.3&&contains(q,x2,z2,.28)).length
            const score=-risk*4 + (recovery?-1:.45)*(Math.hypot(x2-b.m.x,z2-b.m.z)-d)+.14*(x*direction.x+z*direction.z)
            if(score>best){best=score;bestX=x;bestZ=z}
          }
          mode(bestX,bestZ)
          if(style!=='guard' && span<=.255 && b.stamina>=20 && (careful || best<-.5 || style==='dodge')) moves.add('dodge')
        }
        guard=(style==='guard' || careful && !!next && b.playerState==='free' && !moves.has('dodge') && next.at-b.elapsed<.14) && !recovery && (d<5.8 || !!next)
        if(style!=='flee' && style!=='wall' && !reaction && !guard && d<(weapon?7.3:3.55)) {
          const counterOnly=style.startsWith('counter')||careful
          const attackWindow=!counterOnly || recovery || careful && style==='expert-safe' && b.state==='Observe' && d<2.8
          if(attackWindow && (precise || i%4===0)) moves.add('attack')
          if((style==='expert'||style==='expert-safe')&&recovery&&d>2.65&&!b.skillCooldown) moves.add('skill')
          if(weapon&&recovery) moves.add('charge')
        }
        if(b.attachedUntil>b.elapsed && !next && b.stamina>=20 && style!=='guard' && style!=='flee') moves.add('dodge')
        tick()
        ok(b.chainCount<=(b.rage?3:2),'combo cap')
        if(b.plan && b.plan!==last){choices[b.plan.id]=(choices[b.plan.id]??0)+1;last=b.plan}
        if(b.state!==lastState){states[b.state]=(states[b.state]??0)+1;lastState=b.state}
        if(b.bossHp!==lastDamage){prevHit=b.elapsed;lastDamage=b.bossHp}
        maxAI=Math.max(maxAI,b.debugTime)
      }
      runs.push({style,result:b.outcome??'active',time:+b.elapsed.toFixed(1),bossHp:+b.bossHp.toFixed(2),hp:+b.hp.toFixed(2),
        ult:b.finishedUltimates,choices,states,prevHit:+prevHit.toFixed(1),maxAI:+maxAI.toFixed(2),simMs:Math.round(performance.now()-start)})
    }
    return {model,plans,runs}
  })
  const expert=result.runs.find(x=>x.style==='expert')
  const counter=result.runs.find(x=>x.style==='counter')
  assert.equal(expert?.result,'victory','greatsword full clear')
  assert(expert.time>=60&&expert.time<=80,'expert clear time')
  assert.equal(counter?.result,'victory','counter-focused greatsword full clear')
  assert(counter.time>=105&&counter.time<=135,'counter-focused clear time')
  assert.equal(result.runs.find(x=>x.style==='flare')?.result,'victory','Flare full clear')
  console.log(JSON.stringify(result,null,2))
} finally {await browser.close()}
