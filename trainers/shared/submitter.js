// Existing collector transports the snapshot; the server grades v2 separately.
export const COLLECTOR_URL = 'https://script.google.com/macros/s/AKfycbxMF52C2BzQI7WRo7cmiWwvoiUIrjI60RyP6xn-ShM7oJER4FVyYECMolyszifrgQ9j/exec';
// Enable a pack only after its exact version is registered on the server.
export function collectorForLesson(lesson){return (lesson.id==='russian.9.lesson-013'&&lesson.version==='1.0.0')||(lesson.id==='russian.7.lesson-012'&&lesson.version==='1.1.0')||(lesson.id==='literature.7.lesson-008'&&lesson.version==='1.0.0')||(lesson.id==='russian.11.lesson-014'&&lesson.version==='1.0.0')?COLLECTOR_URL:null;}
export function transport(payload){
  if(!collectorForLesson({id:payload.pack_id,version:payload.pack_version}))throw new Error('Этот комплект пока доступен только для просмотра. Отправка учителю ещё не подключена.');
  const answers={__trainer_v2:payload};
  if(JSON.stringify(answers).length>40000)throw new Error('Работа слишком большая для отправки. Скачайте её целиком и передайте учителю.');
  return {schema_version:2,submission_id:payload.submission_id,student:payload.student,klass:payload.class,subject:payload.pack_id==='literature.7.lesson-008'?'Литература':'Русский язык',code:payload.pack_id+'@'+payload.pack_version,
    assignment:payload.pack_id==='russian.11.lesson-014'?'Однородные члены предложения. Синтаксические нормы · 11 класс':payload.pack_id==='literature.7.lesson-008'?'А. С. Пушкин. «Полтава»: Пётр I и Карл XII · подготовка и ответ отдельно':payload.pack_id==='russian.7.lesson-012'?'Тезисный план текста · подготовка и собственный план отдельно':'Сжатое изложение. Пушкин и Пущин · подготовка и текст отдельно',lesson_day:'18.09.2026',
    auto_score:payload.auto_score,auto_max:payload.auto_max,open_max:payload.manual_groups.reduce((n,g)=>n+g.criteria.reduce((n,c)=>n+c.points,0),0),
    open_text:payload.answers.filter(r=>r.type==='open-response').map(r=>r.task_id+': '+(r.answer||'')).join('\n\n'),answers,client_time:payload.completed_at};
}
export function validReceipt(receipt,payload){return receipt && receipt.schemaVersion==='kodislovo.collector-receipt.v1' && receipt.trainerSchemaVersion===2 && receipt.status==='accepted' && receipt.journal==='teacher' && receipt.sourceSubmissionId===payload.submission_id && typeof receipt.submissionId==='string' && !!receipt.submissionId && receipt.trainerGrading?.automatic?.max===payload.auto_max && Array.isArray(receipt.trainerGrading?.manualGroups);}
const active=new WeakMap();
export async function submitResult(url,state,save,fetcher=fetch){
  if(!url) throw new Error('Отправка в кабинет пока недоступна. Скачайте работу, чтобы передать её учителю.');
  if(!state.pending) throw new Error('Сначала завершите работу.');
  if(state.preview) throw new Error('Предпросмотр не отправляется в журнал.');
  if(state.receipt){if(!validReceipt(state.receipt,state.pending))throw new Error('Подтверждение сохранения повреждено.');return state.receipt;}
  if(active.has(state))return active.get(state);
  const promise=send(url,state,save,fetcher);active.set(state,promise);
  try{return await promise;}finally{active.delete(state);}
}
async function send(url,state,save,fetcher){
  const wrapper=transport(state.pending);state.transportStarted=true;save();
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
  try{
    const response=await fetcher(url,{method:'POST',credentials:'omit',redirect:'follow',body:new URLSearchParams({payload:JSON.stringify(wrapper)}),signal:controller.signal});
    if(!response.ok)throw new Error('Сервис временно недоступен. Повторите отправку.');
    const receipt=await response.json();
    if(!validReceipt(receipt,state.pending))throw new Error('Кабинет не подтвердил сохранение новой работы. Повторите отправку.');
    state.receipt=receipt;save();return receipt;
  }catch(error){if(error.name==='AbortError'||error instanceof TypeError||error instanceof SyntaxError)throw new Error('Подтверждение не получено. Работа сохранена на устройстве; повторите отправку.');throw error;}finally{clearTimeout(timer);}
}
