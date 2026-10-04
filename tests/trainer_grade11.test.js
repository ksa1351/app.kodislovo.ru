const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const lesson=JSON.parse(fs.readFileSync(path.join(__dirname,'../trainers/data/russian/11/lesson-014.json'),'utf8'));
const modules=Promise.all(['scoring','storage','results','submitter'].map(name=>import('../trainers/shared/'+name+'.js')));
const expected=['72946','38164','84629','59273','26835','93481'];

test('Grade 11: 20 tasks; separate open assessment; exam inputs use the approved permutations',async()=>{
 const [s]=await modules;s.validateLesson(lesson);
 assert.equal(lesson.tasks.length,20);assert.equal(lesson.mode,'practice');
 assert.equal(lesson.tasks.filter(t=>t.type==='open-response').length,3);
 assert.equal(lesson.manualGroups[0].criteria.reduce((n,c)=>n+c.points,0),6);
 assert.deepEqual(lesson.manualGroups[0].task_ids,lesson.writingTaskIds);
 assert.equal(lesson.display.showStartNotes,false);
 const exams=lesson.tasks.slice(14);
 exams.forEach((t,i)=>{
  assert.equal(t.answers.sequence[0],expected[i]);assert.equal(t.exam.errors.length,5);assert.equal(t.exam.sentences.length,9);
  assert.equal(new Set(expected[i]).size,5);
  assert.equal(s.gradeTask(t,{sequence:expected[i]}).points,1);
  for(const value of ['',expected[i].slice(0,4),expected[i].split('').reverse().join(''),'11111',expected[i]+'2'])assert.equal(s.gradeTask(t,{sequence:value}).points,0);
  t.exam.sentences.forEach((text,j)=>assert(t.context.includes(`${j+1}. ${text}`)));
 });
 for(let col=0;col<5;col++)assert.equal(new Set(expected.map(key=>key[col])).size,6);
 // Distinct grammatical triggers are still attached to their intended letters after shuffling.
 const triggers=[['рассматривали и любовались','висевшему','у школьников возникли','Капитанской дочке','подготовил'],['а также','Согласно расписания','троих','выбрал','у участников появилось'],['интересовались и изучали','присланных','Благодаря поддержки','сохранил','Школьных новостях'],['у меня возник','но и скульптуры','обоих участниц','подготовившие','оказался'],['Хамелеоне','Вопреки прогноза','восхищались и благодарили','Закрыв книгу','посвящённый'],['и которые','получил благодарственные','четырёхста','Обломове','у школьников появились']];
 exams.forEach((t,i)=>[...expected[i]].forEach((digit,j)=>assert(t.exam.sentences[Number(digit)-1].includes(triggers[i][j]))));
});

test('Grade 11: all answers persist, export with context, and registered work keeps the preview boundary',async()=>{
 const [s,storage,r,send]=await modules;
 const state=storage.newDraft(lesson,'LOCAL QA','11');
 for(const t of lesson.tasks)state.answers[t.id]=t.type==='open-response'?'Свой ответ '+t.id:t.type==='fill'?{sequence:t.answers.sequence[0]}:structuredClone(t.answer);
 const map=new Map(),local={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 const key=storage.draftKey(lesson,state.student,state.class,false);storage.persist(local,key,state);
 const restored=storage.loadDraft(local,key,lesson);assert.deepEqual(restored.answers,state.answers);
 const result=r.buildResult(lesson,restored);assert.equal(result.auto_score,17);assert.equal(result.auto_max,17);
 assert.equal(result.manual_groups[0].earned,null);
 assert.equal(result.answers.filter(a=>a.needs_review).length,3);
 const text=r.readableWork(lesson,restored,result);
 for(const id of lesson.writingTaskIds)assert(text.includes('Свой ответ '+id));
 for(const t of lesson.tasks.slice(14))for(const sentence of t.exam.sentences)assert(text.includes(sentence));
 assert.equal(send.collectorForLesson(lesson),send.COLLECTOR_URL);assert.match(send.transport(result).assignment,/11 класс/);assert.throws(()=>send.transport({...result,pack_version:'unknown'}),/для просмотра/);
 state.preview=true;state.pending=result;let posts=0;await assert.rejects(send.submitResult(send.COLLECTOR_URL,state,()=>{},async()=>{posts++;}),/Предпросмотр/);assert.equal(posts,0);
});
