(function(root){
  'use strict';
  const API='https://bbae5ggs5hjqgfo6htv8.containers.yandexcloud.net';
  async function request(path,options={}){
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),45000);
    try{
      const response=await fetch(API+path,{credentials:'omit',cache:'no-store',...options,signal:abort.signal});
      const data=await response.json();
      if(!response.ok){const error=Error(data.error?.message||'Сервис временно недоступен. Повторите попытку.');error.status=response.status;throw error;}
      return data;
    }catch(error){
      if(error.name==='AbortError'||error instanceof TypeError||error instanceof SyntaxError)throw Error('Подтверждение не получено. Проверьте подключение и повторите попытку.');
      throw error;
    }finally{clearTimeout(timer);}
  }
  function read(key){try{return JSON.parse(localStorage.getItem(key));}catch(_){return null;}}
  function validReceipt(data,payload){return data?.schemaVersion==='kodislovo.practice-receipt.v1'&&data.status==='accepted'&&data.journal==='teacher'&&data.sourceSubmissionId===payload.submission_id&&data.kind===payload.kind&&typeof data.submissionId==='string'&&!!data.submissionId;}
  async function identity(kind){
    const dialog=document.createElement('dialog');dialog.className='practice-identity';
    dialog.innerHTML='<form><h2>Начать работу</h2><label>Фамилия и имя<input name="student" autocomplete="name" maxlength="150" required></label><label>Класс<input name="klass" placeholder="Например, 7Б" maxlength="30" required></label><button type="submit">Продолжить</button><p role="status"></p></form>';
    const style=document.createElement('style');style.textContent='.practice-identity{max-width:420px;width:calc(100% - 48px);border:1px solid #567;background:#122135;color:#fff;border-radius:20px;padding:22px}.practice-identity::backdrop{background:#08111ee8}.practice-identity label{display:block;margin:14px 0}.practice-identity input{box-sizing:border-box;width:100%;font:inherit;padding:12px;margin-top:6px;border-radius:10px}.practice-identity button,.practice-delivery button{font:inherit;padding:12px 18px;border:0;border-radius:12px;background:#27c4cd;color:#081725;font-weight:700;cursor:pointer}.practice-delivery{margin:20px 0;padding:18px;border:1px solid #4b697c;border-radius:16px}.practice-delivery button{margin:4px}.practice-delivery p{overflow-wrap:anywhere}.practice-identity button:disabled,.practice-delivery button:disabled{opacity:.6}';document.head.append(style);
    document.body.append(dialog);dialog.addEventListener('cancel',e=>e.preventDefault());dialog.showModal();
    const saved=read('kodislovo:practice:profile:'+kind),form=dialog.querySelector('form'),status=dialog.querySelector('[role=status]');
    if(saved){form.elements.student.value=saved.name||'';form.elements.klass.value=saved.class||'';}
    return new Promise(resolve=>form.addEventListener('submit',async event=>{
      event.preventDefault();const student={name:form.elements.student.value.trim(),class:form.elements.klass.value.trim()};
      if(!student.name||!student.class){status.textContent='Укажите фамилию, имя и класс.';return;}
      const button=form.querySelector('button');button.disabled=true;status.textContent='Проверяем доступ…';
      try{
        const data=await request('/api/public/practice/'+kind+'/access');
        if(data.schemaVersion!=='kodislovo.practice-access.v1'||data.kind!==kind||typeof data.enabled!=='boolean')throw Error('Не удалось проверить доступ. Повторите попытку.');
        const pending=read('kodislovo:practice:delivery:'+kind+':'+JSON.stringify(student))?.pending;
        if(!data.enabled&&!pending)throw Error('Учитель закрыл доступ к этой работе.');
        try{localStorage.setItem('kodislovo:practice:profile:'+kind,JSON.stringify(student));}catch(_){}
        dialog.close();dialog.remove();resolve(student);
      }catch(e){status.textContent=e.message;}finally{button.disabled=false;}
    }));
  }
  function mount({kind,student,build,ready=()=>true,onNew=()=>{},beforeSend=async()=>{},target}){
    const key='kodislovo:practice:delivery:'+kind+':'+JSON.stringify(student);
    let state=read(key)||{},busy=false;const frozen=new Map();
    if(state.pending&&(state.pending.kind!==kind||JSON.stringify(state.pending.student)!==JSON.stringify(student)))state={};
    if(state.receipt&&!validReceipt(state.receipt,state.pending))state.receipt=null;
    const box=document.createElement('section');box.className='practice-delivery';box.innerHTML='<button type="button" class="practice-send">Отправить учителю</button><button type="button" class="practice-new" hidden>Начать новую работу</button><p role="status" aria-live="polite"></p>';
    (target||document.querySelector('main')).append(box);
    const button=box.querySelector('.practice-send'),next=box.querySelector('.practice-new'),status=box.querySelector('[role=status]');
    function freeze(){
      const main=document.querySelector('main');if(main.contains(box))main.after(box);main.inert=true;
      const mobile=document.querySelector('.trainer-mobile-bar');if(mobile)mobile.inert=true;
      document.querySelectorAll('main input,main textarea,main select,main button').forEach(el=>{if(!frozen.has(el))frozen.set(el,el.disabled);el.disabled=true;});
    }
    function render(){
      if(state.pending)freeze();button.disabled=busy||!!state.receipt;next.hidden=!state.receipt;
      button.textContent=state.pending&&!state.receipt?'Повторить отправку':'Отправить учителю';
      if(state.receipt)status.textContent='Работа сохранена в кабинете учителя.';
      else if(state.pending)status.textContent='Ответы зафиксированы для отправки. Повторная отправка не создаст копию работы.';
    }
    button.addEventListener('click',async()=>{
      if(busy||state.receipt)return;busy=true;button.disabled=true;
      try{
        if(!state.pending){
          if(!await ready())throw Error('Сначала завершите задания тренировки.');
          const payload={schema:'kodislovo.practice.v1',version:1,kind,submission_id:crypto.randomUUID(),student,result:await build()};
          // Persist before transmitting, so an uncertain response can always be retried with the same ID.
          try{localStorage.setItem(key,JSON.stringify({pending:payload}));}catch(_){throw Error('Не удалось сохранить отправку на устройстве. Разрешите сохранение данных в браузере или скачайте результат.');}
          state={pending:payload};freeze();
        }
        status.textContent='Отправляем работу…';
        await beforeSend(state.pending);
        const receipt=await request('/api/public/practice/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state.pending)});
        if(!validReceipt(receipt,state.pending))throw Error('Кабинет не подтвердил сохранение. Повторите отправку.');
        state.receipt=receipt;try{localStorage.setItem(key,JSON.stringify(state));}catch(_){}
        render();
      }catch(e){
        if(e.status===400||e.status===422){
          try{localStorage.removeItem(key);state={};document.querySelector('main').inert=false;const mobile=document.querySelector('.trainer-mobile-bar');if(mobile)mobile.inert=false;frozen.forEach((disabled,el)=>el.disabled=disabled);frozen.clear();}catch(_){}
        }
        status.textContent=e.message;
      }finally{busy=false;button.disabled=!!state.receipt;button.textContent=state.pending&&!state.receipt?'Повторить отправку':'Отправить учителю';}
    });
    next.addEventListener('click',async()=>{next.disabled=true;try{await onNew();localStorage.removeItem(key);location.reload();}catch(e){status.textContent=e.message;next.disabled=false;}});
    render();return {state,box};
  }
  root.PracticeDelivery={identity,mount,validReceipt};
})(globalThis);
