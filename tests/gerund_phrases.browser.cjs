// Synthetic profiles and writing below are test fixtures; no pupil data is sent.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/koval/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.TRAINER_BASE||'http://127.0.0.1:8877';
const qa=process.env.TRAINER_QA||path.join(os.tmpdir(),'kodislovo-gerund-qa');
(async()=>{
 await fs.mkdir(qa,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const ctx=await browser.newContext({viewport:{width:1366,height:960},acceptDownloads:true}),p=await ctx.newPage(),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/trainers/russian/gerund-phrases/');
  const config=await p.locator('#assignment-data').evaluate(n=>JSON.parse(n.textContent)),key=config.key.answer;
  assert.equal(await p.locator('#main').isVisible(),false);
  await p.locator('.student-entry').press('Escape');assert.equal(await p.locator('.student-entry').isVisible(),true);
  await p.screenshot({path:path.join(qa,'entry-dark.png')});
  async function enter(name='Тестовый Ученик',klass='11А'){
   await p.locator('.student-entry input[name=student]').fill(name);await p.locator('.student-entry input[name=klass]').fill(klass);
   await p.locator('.student-entry button[type=submit]').click();await p.locator('#main').waitFor({state:'visible'});
  }
  await p.locator('.student-entry input[name=student]').fill('Тестовый Ученик');await p.locator('.student-entry input[name=klass]').fill('11A');
  await p.locator('.student-entry button[type=submit]').click();assert.equal(await p.locator('#main').isVisible(),false);
  await enter('Тестовый Ученик','11а');
  assert.equal(await p.locator('.student-profile span').textContent(),'Тестовый Ученик · 11А');
  assert.match(await p.locator('#lesson-meta').textContent(),/Урок 17/);assert.equal(await p.locator('[data-token]').count(),159);
  assert.equal(await p.locator('#text p').count(),3);assert.equal((await p.locator('#text').innerText()).replace(/\s+/g,' ').trim(),config.key.text.replace(/\s+/g,' ').trim());
  assert.match(await p.locator('#text-source').textContent(),/159 слов/);assert.equal(await p.locator('.token.subject').count(),0);
  assert.equal(await p.locator('.token.predicate').count(),0);assert.doesNotMatch(await p.locator('#panel-1').innerText(),/Род|Падеж|образец/i);
  async function tool(name){await p.locator('[data-tool='+name+']').click();}
  async function word(id){await p.locator('[data-token="'+id+'"]').click();}
  async function check(){await p.locator('#tab-1').click();await p.locator('#check-work').click();}
  await tool('subject');for(const id of key.subjects)await word(id);
  await tool('predicate');for(const id of key.predicates)await word(id);
  assert.equal(await p.locator('#arrows .cross').count(),0);
  await tool('action');for(const id of key.mainActions)await word(id);
  await p.locator('#arrows .cross').waitFor();
  await tool('turn');for(const r of key.turns){await word(r.start);await word(r.end);}
  await tool('arrow');for(const l of key.links){await word(l.from);await word(l.to);}
  await p.waitForFunction(()=>document.querySelectorAll('#arrows path').length===2);
  for(let i=0;i<2;i++){
   const arrow=p.locator('#arrows path').nth(i);assert.equal(await arrow.getAttribute('data-from'),String(key.links[i].from));assert.equal(await arrow.getAttribute('data-to'),String(key.links[i].to));
  }
  await p.locator('#arrows .question-label').first().click();await p.locator('#inline-question-input').fill('что делая?');await p.locator('#inline-question-input').press('Enter');
  assert.equal(await p.locator('#inline-question').isVisible(),false);
  await p.locator('#tab-1').click();
  assert.equal(await p.locator('#connections .connection').count(),2);
  for(let i=0;i<2;i++){
   const c=p.locator('#connections .connection').nth(i);
   await c.locator('input[id^=question-]').fill(i?'КАК ?':'что делая?');await c.locator('select[id^=aspect-]').selectOption('impf');await c.locator('select[id^=timing-]').selectOption('simultaneous');await c.locator('input[id^=actor-]').fill('МОШКИ');
  }
  await check();assert.match(await p.locator('#results').textContent(),/Все части/);assert.equal(await p.locator('#results li').count(),9);
  const first=p.locator('#connections .connection').first();await first.locator('select[id^=aspect-]').selectOption('pf');await p.locator('#check-work').click();assert.match(await first.locator('.feedback').textContent(),/Вид не совпал/);
  await first.locator('select[id^=aspect-]').selectOption('impf');assert.equal(await p.locator('#results').textContent(),'');await check();
  await p.locator('#tab-0').click();await tool('turn');
  const participle=await p.locator('[data-token]').evaluateAll(ns=>ns.find(n=>n.textContent==='испещренной').dataset.token);
  await word(participle);await word(Number(participle)+1);await check();assert.match(await p.locator('#results').textContent(),/Лишних отметок: 1/);
  await p.locator('#tab-0').click();await p.locator('#undo').click();await check();assert.match(await p.locator('#results').textContent(),/Все части/);
  await p.locator('#tab-2').click();assert.equal(await p.locator('.edit-card').count(),4);
  await p.locator('#decision-0').selectOption('no');await p.locator('#solution-0').fill(config.editing[0].text);await p.locator('#check-editor').click();assert.match(await p.locator('#edit-feedback-0').textContent(),/Пересмотрите/);
  for(let i=0;i<4;i++){
   await p.locator('#decision-'+i).selectOption(config.editing[i].decision);await p.locator('#solution-'+i).fill(config.editing[i].answers.at(-1));await p.locator('#explanation-'+i).fill('Называю общего исполнителя основного и добавочного действия.');
  }
  assert.match(await p.locator('#writing-facts').textContent(),/Условная ситуация/);
  const story='Выбрав фотографии, ученики подготовились к выставке. Прочитав подписи, они записали вопросы. Затем они обсудили вопросы с учителем. Работа над выставкой продолжилась. В конце ученики разместили фотографии на стенде.';
  await p.locator('#own-text').fill(story);await p.locator('#own-explanation').fill('Выбрав фотографии; прочитав подписи. Исполнители — ученики. Сначала прочитали, затем записали.');
  await p.locator('.optional-task summary').click();await p.locator('#own-extra').fill('Записывать — инфинитив; исполнитель обоих действий подразумевается один.');
  await p.locator('#tab-3').click();await p.locator('#check-all').click();assert.match(await p.locator('#summary-result').textContent(),/Все автоматически/);assert.match(await p.locator('#summary-result').textContent(),/7 \/ 7/);assert.match(await p.locator('#summary-result').textContent(),/4 \/ 4/);
  let pending=p.waitForEvent('download');await p.locator('#save-answers').click();let dl=await pending;
  assert.equal(dl.suggestedFilename(),'11А_РУС_17_Тестовый_Ученик_Ответы.json');const saved=JSON.parse(await fs.readFile(await dl.path(),'utf8'));
  assert.deepEqual(saved.student,{name:'Тестовый Ученик',class:'11А'});assert.equal(saved.annotationCheck.all,true);assert.deepEqual(saved.answer.mainActions,key.mainActions);assert.equal(saved.annotationCheck.basis.points,1);assert.equal(saved.annotationCheck.gerunds.correct,7);assert.equal(saved.writing.text,story);assert.ok(saved.editingCheck.every(r=>r.ok));
  const payload={name:'answers.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))};
  pending=p.waitForEvent('download');await p.locator('#save-text').click();dl=await pending;const report=await fs.readFile(await dl.path(),'utf8');assert.match(report,/Ученик: Тестовый Ученик/);assert.match(report,/вопрос:/);assert.ok(report.includes(story));assert.match(report,/инфинитив/);
  await p.evaluate(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.testShare={name:data.files[0].name,text:await data.files[0].text()};}});});
  await p.locator('#share-answers').click();await p.waitForFunction(()=>document.querySelector('#share-message').textContent.includes('Файл передан'));
  assert.equal((await p.evaluate(()=>window.testShare)).text.replace(/^\uFEFF/,''),report.replace(/^\uFEFF/,''));
  await p.evaluate(()=>Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{throw new DOMException('cancel','AbortError')}}));await p.locator('#share-answers').click();await p.waitForFunction(()=>document.querySelector('#share-message').textContent.includes('Передача отменена'));
  await p.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));pending=p.waitForEvent('download');await p.locator('#share-answers').click();dl=await pending;assert.match(await p.locator('#share-message').textContent(),/MAX.*скрепку/);
  await p.evaluate(()=>{window.print=()=>window.testPrint=true});await p.locator('#print').click();assert.equal(await p.evaluate(()=>window.testPrint),true);assert.ok((await p.locator('#print-report').textContent()).includes(story));
  await p.reload();await enter();await p.locator('#tab-2').click();assert.equal(await p.locator('#own-text').inputValue(),story);
  await p.locator('.student-profile button').click();await enter('Другой Тестовый');assert.equal(await p.locator('.token.subject').count(),0);await p.locator('#tab-2').click();assert.equal(await p.locator('#own-text').inputValue(),'');
  await p.locator('#answer-file').setInputFiles(payload);await p.waitForFunction(()=>document.querySelector('#import-message').textContent.includes('другому ученику'));assert.equal(await p.locator('#own-text').inputValue(),'');
  await p.locator('.student-profile button').click();await enter();await p.locator('#answer-file').setInputFiles(payload);await p.waitForFunction(()=>document.querySelector('#import-message').textContent.includes('Ответы загружены'));
  for(const width of [320,360,768,1366]){
   await p.setViewportSize({width,height:900});
   for(const theme of ['light','dark']){
    if(await p.locator('html').getAttribute('data-theme')!==theme)await p.locator('.theme-toggle').click();
    for(let step=0;step<4;step++){
     await p.locator('#tab-'+step).click();await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+width+' '+theme+' '+step);
     if(step===0){
      await p.evaluate(id=>{const token=document.querySelector('[data-token="'+id+'"]');window.scrollTo({top:token.getBoundingClientRect().top+scrollY-innerHeight*.62,behavior:'instant'});},83);
      await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      const r=await p.evaluate(id=>{const n=document.querySelector('#lesson-nav').getBoundingClientRect(),t=document.querySelector('#marking-tools').getBoundingClientRect(),w=document.querySelector('[data-token="'+id+'"] ').getBoundingClientRect();return {nb:n.bottom,tt:t.top,tb:t.bottom,wt:w.top,wb:w.bottom,y:scrollY,h:innerHeight};},83);
      assert.ok(Math.abs(r.tt-r.nb)<2,'sticky tools below tabs');assert.ok(r.wt>r.tb&&r.wb<r.h,'word visible below tools');
      await tool('subject');assert.ok(Math.abs(await p.evaluate(()=>scrollY)-r.y)<2,'tool must not jump');
      await word(83);assert.equal(await p.locator('.token.subject').count(),key.subjects.length-1);await p.locator('#undo').click();assert.equal(await p.locator('.token.subject').count(),key.subjects.length);
      await tool('arrow');await word(key.predicates[0]);assert.match(await p.locator('#tool-message').textContent(),/Начало стрелки/);await tool('subject');
      if(width===360||width===1366)await p.screenshot({path:path.join(qa,'sticky-'+width+'-'+theme+'.png')});
      const overlaps=await p.locator('#arrows .question-label').evaluateAll(ns=>{const rs=ns.map(n=>n.getBoundingClientRect());return rs.some((a,i)=>rs.some((b,j)=>i<j&&a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top));});assert.equal(overlaps,false,'question labels overlap '+width);
     }
     if(width===360&&step===2)await p.screenshot({path:path.join(qa,'editor-mobile-'+theme+'.png')});
    }
   }
  }
  // A lesson 16 draft must remain independent when lesson 17 is reset.
  const sentinel='kodislovo:participial-phrases:test-fixture';await p.evaluate(k=>localStorage.setItem(k,'unchanged'),sentinel);
  p.once('dialog',d=>d.accept());await p.locator('#restart').click();assert.equal(await p.locator('.token.subject').count(),0);await p.locator('#tab-2').click();assert.equal(await p.locator('#own-text').inputValue(),'');assert.equal(await p.evaluate(k=>localStorage.getItem(k),sentinel),'unchanged');
  assert.deepEqual(errors,[]);await ctx.close();console.log('PASS: identity, 159-word source, annotation, arrows/questions, feedback, editor/writing, persistence/import, exports/share/print, sticky layouts and profile isolation. Screenshots: '+qa);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
