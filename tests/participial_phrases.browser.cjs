// Conditional profiles below are test fixtures, not real pupils.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/koval/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base=process.env.TRAINER_BASE||'http://127.0.0.1:8876';
const qa=process.env.TRAINER_QA||path.join(os.tmpdir(),'kodislovo-participial-qa');
(async()=>{
 await fs.mkdir(qa,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const ctx=await browser.newContext({viewport:{width:1366,height:960},acceptDownloads:true}),p=await ctx.newPage(),errors=[],external=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{
   // The local antivirus injects its own scripts; they are outside the site source.
   if(!r.url().startsWith(base)&&!new URL(r.url()).hostname.endsWith('.scr.kaspersky-labs.com'))external.push({url:r.url(),method:r.method()});
  });
  await p.goto(base+'/trainers/russian/participial-phrases/');
  const config=await p.locator('#assignment-data').evaluate(n=>JSON.parse(n.textContent));
  assert.equal(await p.locator('#main').isVisible(),false);await p.locator('.student-entry').waitFor({state:'visible'});
  await p.locator('.student-entry').press('Escape');assert.equal(await p.locator('.student-entry').isVisible(),true);
  await p.screenshot({path:path.join(qa,'entry-dark.png')});
  async function enter(name,klass){
   await p.locator('.student-entry input[name=student]').fill(name);
   await p.locator('.student-entry input[name=klass]').fill(klass);
   await p.locator('.student-entry button[type=submit]').click();
   await p.locator('#main').waitFor({state:'visible'});
  }
  await p.locator('.student-entry input[name=student]').fill('Тестовый Ученик');
  await p.locator('.student-entry input[name=klass]').fill('11A');
  await p.locator('.student-entry button[type=submit]').click();assert.equal(await p.locator('#main').isVisible(),false);
  await enter('Тестовый Ученик','11а');
  assert.equal(await p.locator('.student-profile span').textContent(),'Тестовый Ученик · 11А');
  assert.match(await p.locator('#lesson-meta').textContent(),/^11А/);
  assert.equal(await p.locator('[data-token]').count(),219);
  assert.equal(await p.locator('.token.noun').count(),0);
  assert.equal((await p.locator('#text').innerText()).replace(/\s+/g,' ').trim(),config.key.text.replace(/\s+/g,' ').trim());
  assert.equal(await p.locator('#text p').count(),5);
  assert.doesNotMatch(await p.locator('body').innerText(),/придаточ|Учебные примеры из материалов урока № 16/);
  const initialColor=await p.locator('body').evaluate(n=>getComputedStyle(n).color);
  await p.locator('.theme-toggle').click();assert.equal(await p.locator('html').getAttribute('data-theme'),'light');
  assert.notEqual(await p.locator('body').evaluate(n=>getComputedStyle(n).color),initialColor);
  await p.screenshot({path:path.join(qa,'text-light.png')});
  await p.locator('#tab-0').press('ArrowRight');assert.equal(await p.locator('#panel-1').isVisible(),true);await p.locator('#tab-1').press('Home');
  async function tool(name){await p.locator('[data-tool='+name+']').click();}
  async function word(id){await p.locator('[data-token="'+id+'"]').click();}
  const key=config.key.answer;
  await tool('noun');for(const id of key.nouns)await word(id);
  await tool('turn');for(const r of key.turns){await word(r.start);await word(r.end);}
  await tool('arrow');for(const l of key.links){await word(l.from);await word(l.to);}
  await p.waitForFunction(()=>document.querySelectorAll('#arrows path').length===7);
  await p.locator('#arrows .question-label').first().click();
  await p.locator('#inline-question-input').fill(key.links[0].question);await p.locator('#inline-question-input').press('Enter');
  assert.equal(await p.locator('#inline-question').isVisible(),false);
  await p.locator('#tab-1').click();assert.equal(await p.locator('#connections .connection').count(),7);
  assert.equal(await p.locator('#connections .connection').first().locator('input').inputValue(),key.links[0].question);
  for(let i=0;i<key.links.length;i++){
   const card=p.locator('#connections .connection').nth(i),l=key.links[i];await card.locator('input').fill(l.question);
   for(const f of ['gender','number','case'])await card.locator('select[id^='+f+'-]').selectOption(l[f]);
  }
  await p.locator('#check-work').click();assert.doesNotMatch(await p.locator('#results').textContent(),/пропущено: [1-9]/);
  await p.locator('#tab-2').click();assert.equal(await p.locator('.edit-card').count(),4);
  assert.doesNotMatch(await p.locator('#panel-2').innerText(),/Учебные примеры из материалов урока № 16/);
  for(let i=0;i<config.editing.length;i++){
   await p.locator('#decision-'+i).selectOption(config.editing[i].decision);
   await p.locator('#solution-'+i).fill(config.editing[i].answers[0]);
   await p.locator('#explanation-'+i).fill('Проверяю согласование и положение оборота.');
  }
  await p.locator('#tab-3').click();await p.locator('#check-all').click();
  assert.match(await p.locator('#summary-result').textContent(),/Все автоматически/);assert.match(await p.locator('#summary-result').textContent(),/7 \/ 7/);assert.match(await p.locator('#summary-result').textContent(),/4 \/ 4/);
  let pending=p.waitForEvent('download');await p.locator('#save-answers').click();let dl=await pending;
  assert.equal(dl.suggestedFilename(),'11А_РУС_16_Тестовый_Ученик_Ответы.json');
  const saved=JSON.parse(await fs.readFile(await dl.path(),'utf8'));
  assert.deepEqual(saved.student,{name:'Тестовый Ученик',class:'11А'});assert.equal(saved.annotationCheck.all,true);assert.ok(saved.editingCheck.every(r=>r.ok));
  const payload={name:'answers.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))};
  pending=p.waitForEvent('download');await p.locator('#save-text').click();dl=await pending;
  const report=await fs.readFile(await dl.path(),'utf8');assert.match(report,/Ученик: Тестовый Ученик/);assert.match(report,/Класс: 11А/);assert.match(report,/Редактирование предложений/);assert.match(report,/вопрос:/);
  await p.evaluate(()=>{
   Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
   Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.testShare={name:data.files[0].name,text:await data.files[0].text()};}});
  });
  await p.locator('#share-answers').click();await p.waitForFunction(()=>document.querySelector('#share-message').textContent.includes('Файл передан'));
  const shared=await p.evaluate(()=>window.testShare);assert.equal(shared.name,'11А_РУС_16_Тестовый_Ученик_Ответы.txt');assert.equal(shared.text.replace(/^\uFEFF/,''),report.replace(/^\uFEFF/,''));
  await p.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));
  pending=p.waitForEvent('download');await p.locator('#share-answers').click();dl=await pending;
  assert.match(await p.locator('#share-message').textContent(),/MAX.*чат класса.*скрепку/);
  assert.equal((await fs.readFile(await dl.path(),'utf8')).replace(/^\uFEFF/,''),report.replace(/^\uFEFF/,''));
  await p.locator('#share-answers').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(qa,'summary-light.png')});
  await p.evaluate(()=>{window.print=()=>window.testPrint=true});await p.locator('#print').click();assert.equal(await p.evaluate(()=>window.testPrint),true);assert.match(await p.locator('#print-report').textContent(),/Тестовый Ученик/);
  await p.reload();await enter('Тестовый Ученик','11А');assert.equal(await p.locator('.token.noun').count(),6);assert.equal(await p.locator('html').getAttribute('data-theme'),'light');
  await p.locator('.student-profile button').click();await enter('Другой Тестовый','11А');
  assert.equal(await p.locator('.token.noun').count(),0);await p.locator('#tab-2').click();assert.equal(await p.locator('#solution-0').inputValue(),'');
  await p.locator('#answer-file').setInputFiles(payload);await p.waitForFunction(()=>document.querySelector('#import-message').textContent.includes('другому ученику'));
  assert.equal(await p.locator('#solution-0').inputValue(),'');
  await p.locator('.student-profile button').click();await enter('Тестовый Ученик','11А');assert.equal(await p.locator('.token.noun').count(),6);
  await p.locator('.student-profile button').click();await enter('Тестовый Ученик','11Б');assert.equal(await p.locator('.token.noun').count(),0);
  await p.locator('.student-profile button').click();await enter('Тестовый Ученик','11А');
  await p.locator('#answer-file').setInputFiles(payload);await p.waitForFunction(()=>document.querySelector('#import-message').textContent.includes('Ответы загружены'));
  await p.locator('#tab-3').click();await p.locator('#check-all').click();assert.match(await p.locator('#summary-result').textContent(),/Все автоматически/);
  for(const width of [320,360,768,1366]){
   await p.setViewportSize({width,height:900});
   for(const theme of ['light','dark']){
    if(await p.locator('html').getAttribute('data-theme')!==theme)await p.locator('.theme-toggle').click();
    for(let step=0;step<4;step++){
     await p.locator('#tab-'+step).click();await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+width+' '+theme+' '+step);
     if(width===360&&step===0)await p.locator('#text-stage').screenshot({path:path.join(qa,'marked-mobile-'+theme+'.png')});
    }
   }
  }
  await p.setViewportSize({width:1366,height:960});await p.locator('#tab-0').click();await p.locator('#text-stage').screenshot({path:path.join(qa,'marked-desktop-dark.png')});
  p.once('dialog',d=>d.accept());await p.locator('#restart').click();assert.equal(await p.locator('.token.noun').count(),0);
  assert.deepEqual(external,[],'the trainer does not send pupil data to a server');
  await p.goto(base+'/trainers/russian/');assert.equal(await p.locator('a[href="./participial-phrases/"]').count(),2);
  await p.goto(base+'/');assert.equal(await p.locator('a[href="./trainers/russian/participial-phrases/"]').count(),1);
  assert.deepEqual(errors,[]);assert.ok(external.every(r=>r.method==='GET'&&r.url==='https://bbae5ggs5hjqgfo6htv8.containers.yandexcloud.net/api/public/site-works'),'catalog may only fetch the existing public list');
  if(process.env.TRAINER_VERIFY_DOMAIN==='1'){
   await p.goto('https://кодислово.рф/');
   const liveLink=p.locator('a[href="https://ksa1351.github.io/app.kodislovo.ru/trainers/russian/participial-phrases/"]');
   await liveLink.waitFor({state:'visible'});await liveLink.click();await p.locator('.student-entry').waitFor({state:'visible'});
   assert.match(p.url(),/trainers\/russian\/participial-phrases\/$/);
  }
  await ctx.close();
  console.log('PASS: shared entry gate, exact 219-word text/key, all marking/forms/editor tasks, inline question, theme persistence, named TXT/JSON/print/share, profile isolation/import, reset, navigation and 320/360/768/1366px in both themes. No real MAX sharing. QA: '+qa);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
