(function(root){
  'use strict';
  const code=document.documentElement.dataset.lessonCode,api='https://bbae5ggs5hjqgfo6htv8.containers.yandexcloud.net';
  const summary=document.documentElement.dataset.summaryTrainer==='true';
  let pending=null,box;
  function lock(message){
    if(!box){box=document.createElement('section');box.id='lesson-access-message';box.style.cssText='max-width:720px;margin:40px auto;padding:24px;line-height:1.7';document.body.append(box);}
    for(const child of document.body.children)if(child!==box){child.setAttribute('data-access-locked','');child.inert=true;}
    box.replaceChildren();const h=document.createElement('h1');h.textContent='Работа сейчас недоступна';const p=document.createElement('p');p.textContent=message;
    const note=document.createElement('p');note.textContent='Уже введённые ответы не удалены. После открытия доступа можно продолжить работу.';
    const button=document.createElement('button');button.type='button';button.textContent='Проверить снова';button.onclick=()=>check().catch(()=>{});box.append(h,p,note,button);
    document.documentElement.dataset.accessState='checked';
  }
  async function check(){
    if(pending)return pending;
    pending=(async()=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let data;
      try{const r=await fetch(summary?`${api}/api/public/summary-trainer/access`:`${api}/api/public/lessons/${encodeURIComponent(code)}/access`,{cache:'no-store',credentials:'omit',signal:controller.signal});if(!r.ok)throw Error();data=await r.json();if((summary?data.schemaVersion!=='kodislovo.summary-access.v1':data.schemaVersion!=='kodislovo.lesson-access.v1'||data.code!==code)||typeof data.enabled!=='boolean')throw Error();}
      catch(_){const message='Не удалось проверить доступ. Проверьте подключение к интернету и повторите.';lock(message);throw Error(message);}
      finally{clearTimeout(timer);}
      if(!data.enabled){const message='Учитель закрыл доступ к этой работе. Новые ответы пока не принимаются.';lock(message);throw Error(message);}
      document.querySelectorAll('[data-access-locked]').forEach(el=>{el.removeAttribute('data-access-locked');el.inert=false;});box?.remove();box=null;document.documentElement.dataset.accessState='checked';return true;
    })();try{return await pending;}finally{pending=null;}
  }
  root.KodislovoLessonAccess={check};
  document.addEventListener('DOMContentLoaded',()=>{check().catch(()=>{});setInterval(()=>{if(!document.hidden)check().catch(()=>{});},30000);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check().catch(()=>{});});
})(globalThis);
