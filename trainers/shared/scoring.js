export const TYPES = ['single-choice','multi-choice','match','order','classify','select-text','fill','open-response'];
const norm = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
const setEqual = (a,b) => Array.isArray(a) && a.length === new Set(a).size && a.length === b.length && [...a].sort().join('\0') === [...b].sort().join('\0');
export function answered(task,value) {
  if (task.type === 'open-response' || task.type === 'single-choice') return typeof value === 'string' && !!value.trim();
  if (['multi-choice','select-text','order'].includes(task.type)) return Array.isArray(value) && value.length > 0;
  return !!value && task.items.every(item => String(value[item.id] ?? '').trim());
}
export function gradeTask(task,value) {
  if(task.type === 'open-response') return {correct:null,points:null,max_points:0,needs_review:true,error_tag:null};
  let correct = false;
  if(task.type === 'single-choice') correct = value === task.answer;
  if(['multi-choice','select-text'].includes(task.type)) correct = setEqual(value, task.answer);
  if(task.type === 'order') correct = Array.isArray(value) && JSON.stringify(value) === JSON.stringify(task.answer);
  if(['match','classify'].includes(task.type)) correct = !!value && task.items.every(item=>value[item.id] === task.answer[item.id]);
  if(task.type === 'fill') correct = !!value && task.items.every(item=>(task.answers[item.id] || []).some(key=>norm(key)===norm(value[item.id])));
  return {correct,points:correct?task.points:0,max_points:task.points,needs_review:false,error_tag:correct?null:(!answered(task,value)?'unanswered':task.errorTags?.[0]||'needs-practice')};
}
export function validateLesson(lesson) {
  if (!lesson || !Array.isArray(lesson.tasks) || !lesson.tasks.length) throw new Error('В уроке нет заданий.');
  if(!['practice','independent','control'].includes(lesson.mode)) throw new Error('Неизвестный режим урока.');
  for(const key of ['id','version','title','subject']) if(!lesson[key]) throw new Error('В уроке отсутствует поле '+key+'.');
  const ids=new Set();
  const stages=new Set((lesson.stages||[]).map(stage=>stage.id));
  if(!stages.size||!lesson.material?.paragraphs?.length||!/^https:\/\//.test(lesson.material.sourceUrl||''))throw new Error('В уроке не хватает этапов или исходного материала.');
  if(!lesson.display||!Array.isArray(lesson.display.pills)||!Array.isArray(lesson.display.journey)||!lesson.manualGroups?.length)throw new Error('Не заполнено описание урока или критерии.');
  for(const task of lesson.tasks){
    if(!TYPES.includes(task.type)) throw new Error('Тип задания «'+task.type+'» пока не поддерживается.');
    if(ids.has(task.id)||!task.id) throw new Error('Повторяется или отсутствует ID задания.'); ids.add(task.id);
    if(!task.prompt||!task.skill||!Number.isFinite(task.points)||task.points<0) throw new Error('Некорректное задание '+task.id+'.');
    if(task.type==='open-response' && task.points!==0) throw new Error('Открытый ответ нельзя включать в автобаллы.');
    if(task.type!=='open-response' && !('answer' in task) && !('answers' in task)) throw new Error('Нет ключа задания '+task.id+'.');
    if(!stages.has(task.stage))throw new Error('Неизвестный этап задания '+task.id+'.');
    if(task.paragraph && !lesson.material.paragraphs[task.paragraph-1])throw new Error('Не найден абзац задания '+task.id+'.');
    const items=['single-choice','multi-choice','select-text'].includes(task.type)?task.options:task.items;
    if(task.type!=='open-response'){
      if(!Array.isArray(items)||!items.length||new Set(items.map(item=>item.id)).size!==items.length)throw new Error('Неверные варианты задания '+task.id+'.');
      const allowed=new Set(items.map(item=>item.id));
      if(task.type==='single-choice'&&!allowed.has(task.answer))throw new Error('Ключ не соответствует вариантам '+task.id+'.');
      if(['multi-choice','select-text','order'].includes(task.type)&&(!Array.isArray(task.answer)||new Set(task.answer).size!==task.answer.length||task.answer.some(id=>!allowed.has(id))))throw new Error('Ключ не соответствует вариантам '+task.id+'.');
      if(task.type==='order'&&task.answer.length!==items.length)throw new Error('Неполный порядок в задании '+task.id+'.');
      if(['match','classify'].includes(task.type)&&(!task.groups?.length||items.some(item=>!task.groups.some(group=>group.id===task.answer[item.id]))))throw new Error('Неверное соответствие в задании '+task.id+'.');
      if(task.type==='fill'&&items.some(item=>!Array.isArray(task.answers[item.id])||!task.answers[item.id].length))throw new Error('Нет допустимых ответов для поля '+task.id+'.');
    }
  }
  return lesson;
}
