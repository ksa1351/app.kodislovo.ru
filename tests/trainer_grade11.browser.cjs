const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const lesson=JSON.parse(fs.readFileSync(path.join(__dirname,'../trainers/data/russian/11/lesson-014.json'),'utf8'));
const base=process.env.TRAINER_BASE||'http://127.0.0.1:8765';
const url=process.env.TRAINER_URL||base+'/trainers/play.html?subject=russian&grade=11&lesson=14';
const output=process.env.QA_OUTPUT;
async function startNamed(page){await page.locator('#student').fill('LOCAL QA START');await page.locator('#klass').fill(String(lesson.grade));await page.locator('#start-form button').click();}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1366,height:1000},acceptDownloads:true});
  let posts=0;const errors=[];
  await context.route('**/*',route=>{if(route.request().method()==='POST'){posts++;return route.abort();}return ['127.0.0.1',''].includes(new URL(route.request().url()).hostname)?route.continue():route.abort();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const state=()=>page.evaluate(()=>JSON.parse(Object.entries(localStorage).find(([k])=>k.startsWith('kodislovo.trainer.v2:'))[1]));
  const overflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow');
  const shot=async name=>{if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});}};
  await page.goto(url);await page.locator('#student').waitFor();await overflow();await shot('start-desktop');
  await page.setViewportSize({width:360,height:800});await overflow();await shot('start-mobile');
  await startNamed(page);
  for(let i=0;i<lesson.tasks.length;i++){
   const t=lesson.tasks[i];
   if(t.type==='single-choice')await page.locator(`input[value="${t.answer}"]`).check();
   else if(t.type==='multi-choice')for(const id of t.answer)await page.locator(`input[value="${id}"]`).check();
   else if(['match','classify'].includes(t.type))for(const [id,v] of Object.entries(t.answer))await page.locator(`select[data-item="${id}"]`).selectOption(v);
   else if(t.type==='order'){
    let ids=t.items.map(row=>row.id);
    for(let position=0;position<t.answer.length;position++){
     let current=ids.indexOf(t.answer[position]);
     while(current>position){await page.locator(`[data-index="${current}"][data-move="-1"]`).click();[ids[current-1],ids[current]]=[ids[current],ids[current-1]];current--;}
    }
    await page.locator('[data-confirm]').click();
   }else if(t.type==='open-response'){
    await page.locator('textarea').fill('СВОЙ ОТВЕТ '+t.id+' — проверка сохранения.');
    assert.equal(await page.locator('#check').count(),0);
   }else if(t.type==='fill'){
    assert.equal(await page.locator('.exam-errors li').count(),5);assert.equal(await page.locator('.exam-sentences li').count(),9);
    assert.equal(await page.locator('#feedback').textContent(),'');
    const input=page.locator('input[data-item="sequence"]');
    assert.equal(await input.getAttribute('inputmode'),'numeric');
    if(i===14){
     await input.fill('11111');await page.locator('#check').click();assert((await page.locator('#feedback').textContent()).startsWith('Пока нет.'));
     await page.setViewportSize({width:1366,height:1000});await overflow();await shot('ege-desktop');
     await page.setViewportSize({width:360,height:800});await overflow();await shot('ege-mobile');
    }
    await input.fill(t.answers.sequence[0]);
   }
   if(t.type!=='open-response'){
    await page.locator('#check').click();assert((await page.locator('#feedback').textContent()).startsWith('✓ Верно.'),t.id);
   }
   await overflow();
   if(i===12||i===16){
    const before=(await state()).answers;await page.reload();await startNamed(page);assert.deepEqual((await state()).answers,before);
   }
   await page.locator('#next').click();
  }
  assert.match(await page.locator('#main').textContent(),/Все обязательные задания заполнены/);
  for(const id of lesson.writingTaskIds)assert((await page.locator('.paper').first().textContent()).includes('СВОЙ ОТВЕТ '+id));
  await page.locator('#finish').click();
  const saved=await state();assert.equal(saved.pending.auto_score,17);assert.equal(saved.pending.auto_max,17);
  assert.equal(saved.pending.answers.length,20);assert.equal(saved.versions.length,1);assert.equal(saved.pending.manual_groups[0].earned,null);
  for(const id of lesson.writingTaskIds){assert(saved.versions[0].text.includes(id));assert((await page.locator('.paper').first().textContent()).includes(id));}
  assert.equal(await page.locator('#send').count(),1);await overflow();await shot('result-mobile');
  const downloadPromise=page.waitForEvent('download');await page.locator('#download').click();const download=await downloadPromise;
  const text=fs.readFileSync(await download.path(),'utf8');
  for(const id of lesson.writingTaskIds)assert(text.includes('СВОЙ ОТВЕТ '+id));
  assert(text.includes(lesson.tasks[19].exam.sentences[8]));
  await page.setViewportSize({width:1366,height:1000});await overflow();await shot('result-desktop');
  await page.locator('#edit').click();await page.locator('#theme').click();await overflow();await shot('ege-light');
  assert.equal(posts,0);assert.deepEqual(errors,[]);
  // A different learner starts with a separate empty draft.
  await page.locator('#switch-profile').click();await page.locator('#student').fill('LOCAL QA SECOND');await page.locator('#klass').fill('11');await page.locator('#start-form').evaluate(form=>form.requestSubmit());
  assert.equal(await page.locator('input:checked').count(),0);
  console.log(JSON.stringify({tasks:20,examTasks:6,score:17,manualPending:true,allWrittenAnswersPreserved:true,reload:true,download:true,viewports:[360,1366],posts,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
