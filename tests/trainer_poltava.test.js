const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const lesson=JSON.parse(fs.readFileSync(path.join(__dirname,'../trainers/data/literature/7/lesson-008.json'),'utf8'));
const modules=Promise.all(['scoring','storage','results','submitter'].map(name=>import('../trainers/shared/'+name+'.js')));

test('Poltava: independent comparison with original verse and separate manual assessment',async()=>{
 const [s]=await modules;s.validateLesson(lesson);
 assert.equal(lesson.tasks.length,14);assert.equal(lesson.mode,'independent');
 assert.equal(lesson.material.format,'verse');assert.equal(lesson.material.paragraphs.length,4);
 assert.equal(lesson.material.paragraphLabels.length,4);
 assert(lesson.material.paragraphs.every(p=>p.includes('\n')));
 const last=lesson.tasks.at(-1);assert.equal(last.type,'open-response');assert(last.showFullText);
 assert.equal(s.gradeTask(last,'Другая обоснованная интерпретация').correct,null);
 assert.equal(s.gradeTask(last,'').needs_review,true);
 assert.deepEqual(lesson.manualGroups[0].task_ids,[last.id]);
 assert.equal(lesson.manualGroups[0].criteria.reduce((n,c)=>n+c.points,0),6);
});

test('Poltava: evidence selection distinguishes Peter, his horse and companions',async()=>{
 const [s]=await modules;
 for(const task of lesson.tasks.filter(t=>t.type!=='open-response'))assert.equal(s.gradeTask(task,task.answer).points,1,task.id);
 const movement=lesson.tasks.find(t=>t.id==='movement');
 assert.equal(s.gradeTask(movement,[...movement.answer].reverse()).points,1);
 for(const extra of ['3','5'])assert.equal(s.gradeTask(movement,[...movement.answer,extra]).points,0);
 const facts=lesson.tasks.find(t=>t.id==='hero-facts');assert.equal(s.gradeTask(facts,{...facts.answer,'3':'peter'}).points,0);
 const wound=lesson.tasks.find(t=>t.id==='wound-limit');assert.equal(s.gradeTask(wound,'1').points,0);
 const unsupported=lesson.tasks.find(t=>t.id==='text-or-assumption');
 assert.equal(s.gradeTask(unsupported,{...unsupported.answer,'2':'supported'}).points,0);
});

test('Poltava: answers survive storage/export and a registered lesson preserves the preview boundary',async()=>{
 const [s,storage,r,send]=await modules;
 const state=storage.newDraft(lesson,'LOCAL QA','7');
 for(const t of lesson.tasks)state.answers[t.id]=t.type==='open-response'?'Мой вывод.\nДве опоры и их объяснение.':structuredClone(t.answer);
 const map=new Map(),local={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 const key=storage.draftKey(lesson,state.student,state.class,false);storage.persist(local,key,state);
 const restored=storage.loadDraft(local,key,lesson);assert.deepEqual(restored.answers,state.answers);
 const result=r.buildResult(lesson,restored);assert.equal(result.auto_score,13);assert.equal(result.auto_max,13);
 assert.equal(result.manual_groups[0].earned,null);assert.equal(result.answers.at(-1).correct,null);
 assert(result.answers.every(a=>a.skill&&'error_tag' in a));
 const text=r.readableWork(lesson,restored,result);assert(text.includes('→ Пётр I'));assert(text.includes('Две опоры'));
 assert(!text.includes('"peter"'));assert(!text.includes('шкала ОГЭ'));
 assert.equal(send.collectorForLesson(lesson),send.COLLECTOR_URL);
 const wrapper=send.transport(result);assert.equal(wrapper.subject,'Литература');assert.match(wrapper.assignment,/Полтава/);
 assert.throws(()=>send.transport({...result,pack_version:'unknown'}),/для просмотра/);
 state.preview=true;state.pending=result;let posts=0;await assert.rejects(send.submitResult(send.COLLECTOR_URL,state,()=>{},async()=>{posts++;}),/Предпросмотр/);assert.equal(posts,0);
});
