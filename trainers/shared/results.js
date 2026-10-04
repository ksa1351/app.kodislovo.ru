import {gradeTask} from './scoring.js';
export function buildResult(lesson,state,now=new Date()){
  const answers=lesson.tasks.map(task=>({task_id:task.id,type:task.type,skill:task.skill,answer:state.answers[task.id]??null,...gradeTask(task,state.answers[task.id]),attempts:state.attempts[task.id]||0,hint_used:!!state.hint_used[task.id],duration_sec:Math.round((state.duration[task.id]||0)/1000),optional:!!task.optional}));
  const automatic=answers.filter(row=>!row.optional&&!row.needs_review);
  return {schema_version:2,submission_id:crypto.randomUUID(),attempt_id:state.attempt_id,student:state.student,class:state.class,subject:lesson.subject,grade:lesson.grade,lesson:lesson.lesson,pack_id:lesson.id,pack_version:lesson.version,mode:lesson.mode,preview:state.preview,started_at:state.started_at,completed_at:now.toISOString(),duration_sec:Math.max(0,Math.floor((now-new Date(state.started_at))/1000)),auto_score:automatic.reduce((n,r)=>n+r.points,0),auto_max:automatic.reduce((n,r)=>n+r.max_points,0),answers,manual_groups:structuredClone((lesson.manualGroups||[]).map(group=>({...group,earned:null,status:'needs_review'}))),versions:structuredClone(state.versions),hint_history:structuredClone(state.hint_history||[]),samples_viewed_at:state.samples_viewed_at,checklist:[...state.checklist]};
}
export function readableWork(lesson,state,result){
  const text=[lesson.title,`${state.student} · ${state.class}`,`Подготовка: ${result.auto_score} из ${result.auto_max}.`,...result.manual_groups.map(g=>`${g.title}: ожидает проверки, до ${g.criteria.length} условных баллов.`),'Это учебная диагностика, не шкала ОГЭ.',''];
  for(const group of result.manual_groups)text.push('Критерии: '+group.title,...group.criteria.map((criterion,i)=>`${i+1}. ${criterion.text} — ${criterion.points} балл.`),'');
  for(const task of lesson.tasks){let value=state.answers[task.id];if(value==null) value='Нет ответа';else if(task.options){const ids=Array.isArray(value)?value:[value];value=ids.map(id=>task.options.find(o=>o.id===id)?.text||id).join('; ');}else if(typeof value==='object')value=JSON.stringify(value);text.push(task.prompt,String(value),'');}
  for(const version of state.versions)text.push(`Редакция: ${version.label} · ${version.at}`,version.text,'');
  text.push('Самопроверка:',...(lesson.checklist||[]).map((item,i)=>(state.checklist.includes(i)?'✓ ':'□ ')+item));
  if(state.samples_viewed_at)text.push('Образец просмотрен: '+state.samples_viewed_at);
  return text.join('\n');
}
