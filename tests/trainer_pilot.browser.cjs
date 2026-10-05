const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TRAINER_BASE||'http://127.0.0.1:8765';
const lesson=JSON.parse(fs.readFileSync(path.join(__dirname,'../trainers/data/russian/9/lesson-013.json'),'utf8'));
const url=base+'/trainers/play.html?subject=russian&grade=9&lesson=13';
const output=process.env.QA_OUTPUT;
async function startNamed(page){await page.locator('#student').fill('LOCAL QA START');await page.locator('#klass').fill(String(lesson.grade));await page.locator('#start-form button').click();}
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true});
  let posts=0;await context.route('**/*',route=>{if(route.request().method()==='POST')posts++;return new URL(route.request().url()).origin===base?route.continue():route.abort();});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
  const snapshot=async name=>{if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});}};
  const state=()=>page.evaluate(()=>JSON.parse(Object.entries(localStorage).find(([key])=>key.startsWith('kodislovo.trainer.v2:'))[1]));
  await page.goto(url);await page.locator('#student').waitFor();
  await snapshot('pilot-desktop-start');await noOverflow();
  await page.setViewportSize({width:360,height:800});await noOverflow();await snapshot('pilot-mobile-start');
  await startNamed(page);await page.locator('input[type=radio]').first().focus();await page.keyboard.press('Space');
  assert.equal(await page.locator('input[type=radio]').first().isChecked(),true);
  await page.getByRole('button',{name:'Подсказка',exact:true}).click();
  assert.equal((await state()).hint_used['micro-1'],true);
  await page.reload();await startNamed(page);assert.equal(await page.locator('input[type=radio]').first().isChecked(),true);
  for(let index=0;index<lesson.tasks.length;index++){
   const task=lesson.tasks[index];
   if(task.type==='single-choice')await page.locator(`input[value="${task.answer}"]`).check();
   else if(task.type==='multi-choice')for(const id of task.answer)await page.locator(`input[value="${id}"]`).check();
   else if(task.composeFrom){
    await page.locator('#assemble').click();assert.match(await page.locator('textarea').inputValue(),/Свой абзац 2/);
    const before=structuredClone((await state()).versions[0]);
    await page.locator('#sample').click();assert.match(await page.locator('#hint').textContent(),/Один из возможных/);
    await page.locator('textarea').fill('Исправленный текст.\n\nСохранён смысл второго абзаца.\n\nПоказано взаимное влияние друзей.');
    assert.deepEqual((await state()).versions[0],before);
    for(const input of await page.locator('.checklist input').all())await input.check();
    await snapshot('pilot-mobile-revision');
   }else await page.locator('textarea').fill(task.id==='paragraph-2'?'Свой абзац 2: Пущин оставался верен другу и узнавал его через память и творчество.':'Свой ответ: '+task.prompt);
   if(task.type!=='open-response'){
    await page.locator('#check').click();assert.match(await page.locator('#feedback').textContent(),/✓ Верно/);
   }
   if(index===4){
    for(const width of [360,768,1366]){await page.setViewportSize({width,height:900});await noOverflow();await snapshot('pilot-technique-'+width);}
    await page.setViewportSize({width:360,height:800});
   }
   await page.locator('#next').click();
  }
  await page.locator('#finish').click();assert.match(await page.locator('.score-big').textContent(),/13\s*\/ 13/);
  assert.match(await page.locator('#delivery-status').textContent(),/ещё не отправлена/);
  const saved=await state();assert.equal(saved.pending.auto_max,13);assert.equal(saved.pending.manual_groups[0].earned,null);assert.equal(saved.pending.checklist.length,6);assert(saved.samples_viewed_at);
  assert.equal(saved.versions.filter(v=>v.kind==='first').length,1);assert.equal(saved.versions.length,2);
  const downloadEvent=page.waitForEvent('download');await page.locator('#download').click();const download=await downloadEvent;
  const text=fs.readFileSync(await download.path(),'utf8');assert.match(text,/Первая самостоятельная редакция/);assert.match(text,/Свой абзац 2/);assert.match(text,/Исправленный текст/);assert(!text.includes('schema_version'));
  await page.setViewportSize({width:1366,height:900});await snapshot('pilot-result');await noOverflow();
  await page.reload();await startNamed(page);assert.match(await page.locator('.score-big').textContent(),/13\s*\/ 13/);
  await page.locator('#switch-profile').click();
  await page.locator('#student').fill('LOCAL QA ONE');await page.locator('#klass').fill('9В');await page.locator('#start-form button').click();
  assert.equal(await page.locator('input:checked').count(),0);await page.locator('input[value="1"]').check();
  await page.locator('#switch-profile').click();await page.locator('#student').fill('LOCAL QA TWO');await page.locator('#klass').fill('9В');await page.locator('#start-form button').click();assert.equal(await page.locator('input:checked').count(),0);
  await page.locator('#switch-profile').click();await page.locator('#student').fill('LOCAL QA ONE');await page.locator('#klass').fill('9В');await page.locator('#start-form button').click();assert.equal(await page.locator('input[value="1"]').isChecked(),true);
  await page.locator('#review').click();assert.match(await page.locator('.panel').textContent(),/Не заполнено/);await page.locator('#finish').click();assert.match(await page.locator('#delivery-status').textContent(),/ещё не отправлена/);assert.equal(await page.locator('#send').count(),1);
  await page.locator('#edit').click();
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Quota','QuotaExceededError');};});
  await page.locator('input[value="2"]').check();assert.match(await page.locator('#save-status').textContent(),/Не удалось сохранить/);
  await page.locator('#review').click();await page.locator('#finish').click();assert.match(await page.locator('#main').textContent(),/Скачай работу/);
  assert.equal(posts,0);assert.deepEqual(errors,[]);
  // Render and operate the less frequent reusable mechanics with a local data fixture.
  const fixtureContext=await browser.newContext();const fixture=await fixtureContext.newPage();
  const mechanics=[
   {id:'m',type:'match',items:[{id:'a',text:'Фрагмент'}],groups:[{id:'x',text:'Группа'}],answer:{a:'x'}},
   {id:'c',type:'classify',items:[{id:'a',text:'Фрагмент'}],groups:[{id:'x',text:'Группа'}],answer:{a:'x'}},
   {id:'o',type:'order',items:[{id:'a',text:'Второй'},{id:'b',text:'Первый'}],answer:['b','a']},
   {id:'s',type:'select-text',options:[{id:'x',text:'Нужный фрагмент'},{id:'y',text:'Лишний'}],answer:['x']},
   {id:'f',type:'fill',items:[{id:'a',text:'Слово'}],answers:{a:['ёлка']}}
  ];
  await fixtureContext.route('**/lesson-013.json',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({...lesson,tasks:mechanics.map(t=>({...t,stage:'meaning',prompt:'Проверка механики',skill:'qa',points:1}))})}));
  await fixture.goto(url);await startNamed(fixture);
  for(const t of mechanics){
   if(['match','classify'].includes(t.type))await fixture.locator('#answer-slot select').selectOption('x');
   if(t.type==='order'){await fixture.getByRole('button',{name:'Пункт 1 вниз'}).click();}
   if(t.type==='select-text')await fixture.locator('input[value="x"]').check();
   if(t.type==='fill')await fixture.locator('#answer-slot input').fill('елка');
   await fixture.locator('#check').click();assert.match(await fixture.locator('#feedback').textContent(),/Верно/);await fixture.locator('#next').click();
  }
  console.log('PASS: 24 tasks, keyboard, 360/768/1366, reload, profiles, first/revised text, download, storage failure, 8 renderers; no network submission.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
