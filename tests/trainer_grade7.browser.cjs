const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TRAINER_BASE||'http://127.0.0.1:8765',output=process.env.QA_OUTPUT;
const lesson=JSON.parse(fs.readFileSync(path.join(__dirname,'../trainers/data/russian/7/lesson-012.json'),'utf8'));
const url=base+'/trainers/play.html?subject=russian&grade=7&lesson=12';
const own='1. Школьная липа хранит воспоминания разных поколений выпускников.\n2. Семиклассники собрали историю дерева из разных источников и проверили сведения.\n3. Созданная летопись дерева показывает связь людей разных поколений через одно место.';
(async()=>{const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});try{
 const context=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true});let posts=0;
 await context.route('**/*',route=>{if(route.request().method()==='POST')posts++;return new URL(route.request().url()).origin===base?route.continue():route.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const noOverflow=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow');
 const screenshot=async name=>{if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});}};
 const state=()=>page.evaluate(()=>JSON.parse(Object.entries(localStorage).find(([key])=>key.startsWith('kodislovo.trainer.v2:'))[1]));
 await page.goto(url);await page.locator('#student').waitFor();await screenshot('grade7-start-desktop');
 await page.setViewportSize({width:360,height:800});await noOverflow();await screenshot('grade7-start-mobile');
 await page.locator('#student').fill('LOCAL QA PLAN');await page.locator('#klass').fill('7Б');await page.locator('#start-form button').click();
 for(let index=0;index<lesson.tasks.length;index++){
  const task=lesson.tasks[index];assert.equal(await page.locator('#check').count(),0);assert.equal(await page.getByRole('button',{name:'Подсказка',exact:true}).count(),0);
  if(task.type==='single-choice'){await page.locator(`input[value="${task.answer}"]`).focus();await page.keyboard.press('Space');}
  if(['multi-choice','select-text'].includes(task.type))for(const id of task.answer)await page.locator(`input[value="${id}"]`).check();
  if(['match','classify'].includes(task.type))for(const [id,value] of Object.entries(task.answer))await page.locator(`select[data-item="${id}"]`).selectOption(value);
  if(task.type==='order'){await page.getByRole('button',{name:'Пункт 1 вниз'}).click();await page.getByRole('button',{name:'Пункт 2 вниз'}).click();await page.getByRole('button',{name:'Подтвердить порядок',exact:true}).click();}
  if(task.type==='open-response'){
   assert.equal(await page.locator('.inline-source p:not(.small)').count(),4);assert.match(await page.locator('.panel').textContent(),/абзацы 2–3/);
   await page.locator('textarea').fill(own);assert.match(await page.locator('#answer-count').textContent(),/символов/);
   for(const box of await page.locator('.checklist input').all())await box.check();
   for(const width of [360,768,1366]){await page.setViewportSize({width,height:900});await noOverflow();await screenshot('grade7-own-plan-'+width);}
   await page.reload();await page.locator('#student').fill('LOCAL QA PLAN');await page.locator('#klass').fill('7Б');await page.locator('#start-form button').click();assert.equal(await page.locator('textarea').inputValue(),own);
  }
  if(index===3){await noOverflow();await screenshot('grade7-classify-mobile');}
  assert.equal(await page.locator('#feedback').textContent(),'');await page.locator('#next').click();
 }
 await page.locator('#finish').click();assert.match(await page.locator('.score-big').textContent(),/10\s*\/ 10/);assert.equal(await page.locator('#send').count(),1);
 assert.match(await page.locator('#delivery-status').textContent(),/ещё не отправлена/);assert.equal((await state()).versions.length,1);assert.equal((await state()).pending.answers.at(-1).answer,own);
 assert.equal((await state()).pending.answers.at(-1).correct,null);assert.equal((await state()).pending.manual_groups[0].earned,null);
 const event=page.waitForEvent('download');await page.locator('#download').click();const download=await event;const text=fs.readFileSync(await download.path(),'utf8');assert(text.includes(own));assert(text.includes('→ Главная информация'));assert(!text.includes('schema_version'));
 await screenshot('grade7-result');await noOverflow();await page.locator('#edit').click();assert.equal(await page.locator('textarea').inputValue(),own);
 await page.locator('#switch-profile').click();await page.locator('#student').fill('LOCAL QA OTHER');await page.locator('#klass').fill('7Б');await page.locator('#start-form button').click();assert.equal(await page.locator('input:checked').count(),0);
 await page.locator('#review').click();assert.match(await page.locator('.panel').textContent(),/Не заполнено/);
 assert.equal(posts,0);assert.deepEqual(errors,[]);console.log('PASS grade 7: 11 tasks, independent mode, keyboard, 360/768/1366, full source, reload, profiles, manual plan, readable download, no POST.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
