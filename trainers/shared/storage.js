const normalize = text => String(text).normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export function draftKey(lesson,student,klass,preview=false){return 'kodislovo.trainer.v2:'+JSON.stringify([lesson.id,String(lesson.version),preview?'preview':'student',normalize(student),normalize(klass)]);}
export function newDraft(lesson,student,klass,preview=false){return {student,class:klass,pack_id:lesson.id,pack_version:lesson.version,preview,attempt_id:crypto.randomUUID(),started_at:new Date().toISOString(),answers:{},attempts:{},hint_used:{},checked:{},duration:{},versions:[],checklist:[],index:0,samples_viewed_at:null,pending:null,receipt:null};}
export function loadDraft(storage,key,lesson){
  const raw=storage.getItem(key); if(!raw)return null;
  const value=JSON.parse(raw);
  if(value.pack_id!==lesson.id||value.pack_version!==lesson.version||!value.answers||!Array.isArray(value.versions)||!value.attempt_id)throw new Error('Черновик не удалось прочитать. Он сохранён без изменений.');
  return value;
}
export function persist(storage,key,state){storage.setItem(key,JSON.stringify(state));}
