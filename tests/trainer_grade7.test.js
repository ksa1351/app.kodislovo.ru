const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const lesson=JSON.parse(fs.readFileSync(path.join(__dirname,'../trainers/data/russian/7/lesson-012.json'),'utf8'));
const modules=Promise.all(['scoring','storage','results','submitter'].map(name=>import('../trainers/shared/'+name+'.js')));
test('grade 7: full source, three own theses, independent mode and separate manual rubric',async()=>{
 const [s]=await modules;s.validateLesson(lesson);assert.equal(lesson.mode,'independent');assert.equal(lesson.tasks.length,11);
 assert.equal(lesson.material.paragraphs.length,4);assert.equal(lesson.material.samples.length,0);
 assert.equal(lesson.tasks.reduce((n,t)=>n+t.points,0),10);
 const last=lesson.tasks.at(-1);assert.equal(last.type,'open-response');assert(last.showFullText);assert.match(last.context,/абзацы 2–3/);
 assert.deepEqual(lesson.manualGroups[0].task_ids,[last.id]);assert.equal(lesson.manualGroups[0].criteria.reduce((n,c)=>n+c.points,0),6);
 assert.equal(s.gradeTask(last,'Совсем своя формулировка').correct,null);
 assert.equal(s.gradeTask(last,'').needs_review,true);
});
test('all closed keys work, wrong classifications and over-selection fail',async()=>{
 const [s]=await modules;
 for(const t of lesson.tasks.filter(t=>t.type!=='open-response'))assert.equal(s.gradeTask(t,t.answer).points,1,t.id);
 const sources=lesson.tasks.find(t=>t.id==='sources');assert.equal(s.gradeTask(sources,[...sources.answer].reverse()).points,1);assert.equal(s.gradeTask(sources,[...sources.answer,'web']).points,0);
 const classification=lesson.tasks.find(t=>t.id==='main-detail');assert.equal(s.gradeTask(classification,{...classification.answer,rain:'main'}).points,0);
 const order=lesson.tasks.find(t=>t.type==='order');assert.equal(s.gradeTask(order,[...order.answer].reverse()).points,0);
});
test('grade 7 snapshot and readable download preserve own wording without technical mappings',async()=>{
 const [,storage,r]=await modules;const draft=storage.newDraft(lesson,'LOCAL QA','7');
 for(const t of lesson.tasks)draft.answers[t.id]=t.type==='open-response'?'1. Своя мысль.\n2. Сбор и проверка.\n3. Значение памяти.':t.answer;
 const result=r.buildResult(lesson,draft);assert.equal(result.auto_score,10);assert.equal(result.auto_max,10);assert.equal(result.manual_groups[0].earned,null);
 assert.equal(result.answers.at(-1).answer,draft.answers['own-plan']);assert(result.answers.every(a=>a.skill&&'error_tag' in a));
 const download=r.readableWork(lesson,draft,result);assert.match(download,/Своя мысль/);assert.match(download,/→ Главная информация/);assert(!download.includes('"generations"'));assert(!download.includes('шкала ОГЭ'));
});
test('registered packs can send; unknown versions and preview cannot',async()=>{
 const [,storage,r,send]=await modules;assert.equal(send.collectorForLesson(lesson),send.COLLECTOR_URL);
 assert.equal(send.collectorForLesson({...lesson,version:"1.0.0"}),null);
 assert.equal(send.collectorForLesson({id:'russian.9.lesson-013',version:'1.0.0'}),send.COLLECTOR_URL);
 assert.equal(send.collectorForLesson({id:'russian.9.lesson-013',version:'2.0.0'}),null);
 const state=storage.newDraft(lesson,'LOCAL QA','7');state.pending=r.buildResult(lesson,state);let posts=0;
 const wrapper=send.transport(state.pending);assert.match(wrapper.assignment,/Тезисный план/);
 state.preview=true;await assert.rejects(send.submitResult(send.COLLECTOR_URL,state,()=>{},async()=>{posts++;}),/Предпросмотр/);assert.equal(posts,0);assert(!state.transportStarted);
 assert.throws(()=>send.transport({...state.pending,pack_version:'unknown'}),/для просмотра/);
});
