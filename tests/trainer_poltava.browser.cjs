const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TRAINER_BASE||'http://127.0.0.1:8765',output=process.env.QA_OUTPUT;
const lesson=JSON.parse(fs.readFileSync(path.join(__dirname,'../trainers/data/literature/7/lesson-008.json'),'utf8'));
const url=base+'/trainers/play.html?subject=literature&grade=7&lesson=8';
const own='Пушкин противопоставляет энергию Петра растерянности раненого Карла. Пётр «промчался пред полками»: глагол подчёркивает стремительность героя. Карл показан «бледен, недвижим», и эти детали передают его физическую слабость. При этом он продолжает командовать, поэтому нельзя назвать его трусом только на основании раны. Слово «прекрасен» выражает восхищение Петром. Контраст помогает увидеть, кому автор отдаёт предпочтение.';
async function startNamed(page){await page.locator('#student').fill('LOCAL QA START');await page.locator('#klass').fill(String(lesson.grade));await page.locator('#start-form button').click();}
(async()=>{const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true});let posts=0;
 await context.route('**/*',route=>{if(route.request().method()==='POST')posts++;return new URL(route.request().url()).origin===base?route.continue():route.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow');
 const shot=async name=>{if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});}};
 const state=()=>page.evaluate(()=>JSON.parse(Object.entries(localStorage).find(([key])=>key.startsWith('kodislovo.trainer.v2:'))[1]));
 await page.goto(base+'/index.html');await page.locator('a[href="./trainers/literature/"]').click();
 for(const width of [360,768,1366]){await page.setViewportSize({width,height:900});await noOverflow();await shot('literature-catalog-'+width);}
 await page.locator('a[href*="subject=literature"]').click();assert.equal(page.url(),url);await page.locator('#student').waitFor();await shot('poltava-start-desktop');
 for(const width of [360,768]){await page.setViewportSize({width,height:900});await noOverflow();await shot('poltava-start-'+width);}
 assert.equal(await page.locator('.assignment-note').count(),0);await startNamed(page);
 for(let index=0;index<lesson.tasks.length;index++){
  const task=lesson.tasks[index];assert.equal(await page.locator('#check').count(),0);
  assert.equal(await page.getByRole('button',{name:'Подсказка',exact:true}).count(),0);
  if(task.type==='single-choice'){await page.locator(`input[value="${task.answer}"]`).focus();await page.keyboard.press('Space');}
  if(['multi-choice','select-text'].includes(task.type))for(const id of task.answer)await page.locator(`input[value="${id}"]`).check();
  if(['match','classify'].includes(task.type))for(const [id,value] of Object.entries(task.answer))await page.locator(`select[data-item="${id}"]`).selectOption(value);
  if(index===0){
   assert.equal(await page.locator('.source .source-part').count(),4);
   assert.equal(await page.locator('.source-part p').first().evaluate(el=>getComputedStyle(el).whiteSpace),'pre-wrap');
   for(const width of [360,768,1366]){await page.setViewportSize({width,height:900});await noOverflow();await shot('poltava-facts-'+width);}
   await page.locator('.glossary summary').click();assert.match(await page.locator('.glossary').textContent(),/Знак, движение руки/);
  }
  if(task.type==='open-response'){
   assert.equal(await page.locator('.inline-source .source-part').count(),4);
   for(let i=0;i<4;i++)assert.equal(await page.locator('.inline-source .source-part p').nth(i).textContent(),lesson.material.paragraphs[i]);
   await page.locator('textarea').fill(own);assert.match(await page.locator('#answer-count').textContent(),/символов/);
   for(const box of await page.locator('.checklist input').all())await box.check();
   for(const width of [360,768,1366]){await page.setViewportSize({width,height:900});await noOverflow();await shot('poltava-own-'+width);}
   await page.locator('#theme').click();await shot('poltava-own-light');await page.locator('#theme').click();
   await page.reload();await startNamed(page);assert.equal(await page.locator('textarea').inputValue(),own);
  }
  assert.equal(await page.locator('#feedback').textContent(),'');await page.locator('#next').click();
 }
 await page.locator('#finish').click();assert.match(await page.locator('.score-big').textContent(),/13\s*\/ 13/);
 assert.equal(await page.locator('#send').count(),1);assert.match(await page.locator('#delivery-status').textContent(),/ещё не отправлена/i);
 const saved=await state();assert.equal(saved.versions.length,1);assert.equal(saved.pending.answers.at(-1).answer,own);
 assert.equal(saved.pending.answers.at(-1).correct,null);assert.equal(saved.pending.manual_groups[0].earned,null);
 const event=page.waitForEvent('download');await page.locator('#download').click();const download=await event;
 const text=fs.readFileSync(await download.path(),'utf8');assert(text.includes(own));assert(text.includes('→ Пётр I'));assert(!text.includes('schema_version'));
 await shot('poltava-result');await noOverflow();await page.locator('#edit').click();assert.equal(await page.locator('textarea').inputValue(),own);
 await page.locator('#switch-profile').click();await page.locator('#student').fill('LOCAL QA OTHER');await page.locator('#klass').fill('7Б');await page.locator('#start-form button').click();
 assert.equal(await page.locator('select').first().inputValue(),'');await page.locator('#review').click();assert.match(await page.locator('.panel').textContent(),/Не заполнено/);
 await page.locator('#finish').click();assert.match(await page.locator('#delivery-status').textContent(),/ещё не отправлена/);assert.equal(await page.locator('#send').count(),1);
 assert.equal(posts,0);assert.deepEqual(errors,[]);
 console.log('PASS Poltava: 14 tasks, verse and glossary, keyboard, 360/768/1366, light/dark, reload, profiles, manual review, TXT export, no POST.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
