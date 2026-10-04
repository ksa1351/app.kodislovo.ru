const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const lesson=JSON.parse(fs.readFileSync(path.join(__dirname,'../trainers/data/russian/9/lesson-013.json'),'utf8'));
const modules=Promise.all(['scoring','storage','results','submitter'].map(name=>import('../trainers/shared/'+name+'.js')));
test('pilot is complete: 9 techniques, 13 auto points, separate 6 manual criteria',async()=>{
 const schema=JSON.parse(fs.readFileSync(path.join(__dirname,'../trainers/schemas/lesson.schema.json'),'utf8'));
 assert(schema.$defs.task);assert(schema.required.includes('tasks'));
 const [s]=await modules;s.validateLesson(lesson);
 assert.equal(lesson.tasks.length,24);assert.equal(lesson.tasks.filter(t=>t.id.startsWith('technique-')).length,9);
 assert.equal(lesson.tasks.reduce((n,t)=>n+t.points,0),13);assert.equal(lesson.manualGroups[0].criteria.length,6);
 assert.throws(()=>s.validateLesson({...lesson,tasks:[{...lesson.tasks[0],type:'unknown'}]}),/не поддерживается/);
});
test('all seven automatic mechanics check actual answers and reject over-selection',async()=>{
 const [s]=await modules;const base={points:1,errorTags:['specific-error']};
 for(const [type,answer,value,wrong] of [
  ['single-choice','a','a','b'],['multi-choice',['a','b'],['b','a'],['a','b','c']],
  ['select-text',['a'],['a'],['a','a']],['order',['a','b'],['a','b'],['b','a']],
  ['match',{a:'x',b:'y'},{a:'x',b:'y'},{a:'y',b:'x'}],['classify',{a:'x',b:'x'},{a:'x',b:'x'},{a:'x'}],
 ]){const t={...base,type,answer,items:[{id:'a'},{id:'b'}]};assert.equal(s.gradeTask(t,value).points,1,type);assert.equal(s.gradeTask(t,wrong).points,0,type);}
 const fill={...base,type:'fill',items:[{id:'a'}],answers:{a:['Ёлка','ель']}};
 assert.equal(s.gradeTask(fill,{a:'  елка '}).correct,true);assert.equal(s.gradeTask(fill,{a:'дуб'}).error_tag,'specific-error');
});
test('draft identity includes pack, version, normalized pupil and class; reload preserves open text',async()=>{
 const [,s]=await modules;const key=s.draftKey(lesson,'Анна  Иванова','9В');
 assert.equal(key,s.draftKey(lesson,' анна иванова ','9в'));assert.notEqual(key,s.draftKey(lesson,'Иван','9В'));assert.notEqual(key,s.draftKey({...lesson,version:'2'},'Анна Иванова','9В'));
 assert.notEqual(key,s.draftKey(lesson,'Анна Иванова','9В',true));
 const memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
 const draft=s.newDraft(lesson,'Анна Иванова','9В');draft.answers['paragraph-2']='Своя формулировка';s.persist(storage,key,draft);
 assert.equal(s.loadDraft(storage,key,lesson).answers['paragraph-2'],'Своя формулировка');
 memory.set(key,'broken');assert.throws(()=>s.loadDraft(storage,key,lesson));assert.equal(memory.get(key),'broken');
});
test('result keeps open answers, skills, error tags, revisions and ungraded manual group',async()=>{
 const [s,storage,r]=await modules;const draft=storage.newDraft(lesson,'QA','9');
 for(const task of lesson.tasks)draft.answers[task.id]=task.type==='open-response'?'Свой открытый ответ':task.answer;
 draft.versions.push({kind:'first',text:'Изначальный вариант'});const result=r.buildResult(lesson,draft);
 assert.equal(result.schema_version,2);assert.equal(result.auto_score,13);assert.equal(result.auto_max,13);
 assert.equal(result.manual_groups[0].earned,null);assert.equal(result.manual_groups[0].criteria.length,6);
 const row=result.answers.find(r=>r.task_id==='paragraph-2');assert.equal(row.correct,null);assert.equal(row.points,null);assert.equal(row.needs_review,true);assert(row.skill);assert('error_tag' in row);
 draft.versions[0].text='Изменено';assert.equal(result.versions[0].text,'Изначальный вариант');
 assert.match(r.readableWork(lesson,draft,result),/Свой открытый ответ/);
});
test('submission retry keeps exact snapshot and requires a matching teacher receipt',async()=>{
 const [,storage,results,s]=await modules;const draft=storage.newDraft(lesson,'QA','9');draft.answers['paragraph-2']='Открытый ответ';const state={pending:results.buildResult(lesson,draft),receipt:null};state.pending.submission_id='fixed';const bodies=[];
 const fetcher=async(url,opts)=>{bodies.push(opts.body.get('payload'));if(bodies.length===1)throw new TypeError('network');return {ok:true,json:async()=>({schemaVersion:'kodislovo.collector-receipt.v1',trainerSchemaVersion:2,status:'accepted',journal:'teacher',sourceSubmissionId:'fixed',submissionId:'cloud',trainerGrading:{automatic:{max:13},manualGroups:[]}})};};
 await assert.rejects(s.submitResult('https://example.org',state,()=>{},fetcher),/Подтверждение не получено/);
 await s.submitResult('https://example.org',state,()=>{},fetcher);assert.equal(bodies[0],bodies[1]);assert.match(bodies[1],/Открытый ответ/);
 await s.submitResult('https://example.org',state,()=>{},fetcher);assert.equal(bodies.length,2);
 await assert.rejects(s.submitResult(null,state,()=>{},fetcher),/пока недоступна/);
 await assert.rejects(s.submitResult('https://example.org',{...state,receipt:null},()=>{throw new Error('storage');},fetcher),/storage/);assert.equal(bodies.length,2);
 await assert.rejects(s.submitResult('https://example.org',{...state,receipt:null},()=>{},async()=>({ok:true,json:async()=>({status:'accepted'})})),/не подтвердил/);
});
