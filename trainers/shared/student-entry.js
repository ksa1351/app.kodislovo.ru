(function(root){
  'use strict';
  const style=document.createElement('style');
  style.textContent=`.student-entry{box-sizing:border-box;width:calc(100% - 32px);max-width:480px;max-height:90vh;overflow:auto;padding:28px;border:1px solid var(--border,#30445a);border-radius:24px;background:var(--card,#101e31);color:var(--text,#edf4fa);font:18px/1.6 var(--ks-font-sans,system-ui)}.student-entry::backdrop{background:#08111eee}.student-entry h2{font:30px/1.2 var(--ks-font-serif,Georgia);color:inherit;margin:0 0 12px}.student-entry .entry-title{color:var(--muted,#a4b9cd);font-size:15px;margin:0 0 20px}.student-entry label{display:block;margin:14px 0;font-size:15px}.student-entry input{box-sizing:border-box;display:block;width:100%;padding:12px;margin-top:6px;min-height:48px;border:1px solid var(--border,#30445a);border-radius:12px;background:var(--bg,#0d1728);color:inherit;font:inherit}.student-entry button,.student-profile button{font:inherit;cursor:pointer;padding:12px 18px;min-height:44px;border:1px solid var(--border,#30445a);border-radius:12px;background:var(--card,#101e31);color:var(--text,#edf4fa)}.student-entry button{width:100%;background:var(--primary,#2ac3de);color:var(--ks-bg,#081725);font-weight:700}.student-entry button:disabled{opacity:.5}.student-entry [role=status]{font-size:15px;color:var(--text,#edf4fa)}.student-profile{box-sizing:border-box;max-width:1220px;margin:16px auto;padding:0 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--muted,#a4b9cd);font:15px/1.5 var(--ks-font-sans,system-ui)}.student-profile button{font-size:14px;padding:8px 12px}html:not([data-theme=dark]) .student-entry button{color:#fff}`;
  document.head.append(style);
  function read(key){try{return JSON.parse(localStorage.getItem(key));}catch(_){return null;}}
  function key(p){return JSON.stringify([p.name.trim().replace(/\s+/g,' ').toLocaleLowerCase('ru'),StudentClass.normalize(p.class)]);}
  async function open({id,title='',storageKey='kodislovo:entry:'+id,validate=async()=>{}}){
    const dialog=document.createElement('dialog');dialog.className='student-entry';
    dialog.innerHTML='<form><h2>Начать работу</h2><p class="entry-title"></p><label>Фамилия и имя<input name="student" autocomplete="name" maxlength="150" required></label><label>Класс<input name="klass" placeholder="Например, 11А" maxlength="30" required></label><button type="submit">Начать или продолжить</button><p role="status" aria-live="polite"></p></form>';
    dialog.querySelector('.entry-title').textContent=title;
    const form=dialog.querySelector('form'),status=dialog.querySelector('[role=status]'),saved=read(storageKey);
    form.elements.student.value=saved?.name||'';form.elements.klass.value=saved?.class||'';
    document.body.append(dialog);dialog.addEventListener('cancel',e=>e.preventDefault());dialog.showModal();
    return new Promise(resolve=>form.addEventListener('submit',async e=>{
      e.preventDefault();const profile={name:form.elements.student.value.trim(),class:StudentClass.normalize(form.elements.klass.value)};
      if(!profile.name||!StudentClass.valid(profile.class)){status.textContent='Укажите фамилию, имя и класс с русской буквой, например 11А.';return;}
      const button=form.querySelector('button');button.disabled=true;status.textContent='Открываем работу…';
      try{await validate(profile);try{localStorage.setItem(storageKey,JSON.stringify(profile));}catch(_){}dialog.close();dialog.remove();resolve(profile);}
      catch(error){status.textContent=error.message||'Не удалось открыть работу. Повторите попытку.';}
      finally{button.disabled=false;}
    }));
  }
  function badge(profile,{onSwitch=()=>location.reload()}={}){
    document.querySelector('.student-profile')?.remove();
    const bar=document.createElement('div');bar.className='student-profile';
    const name=document.createElement('span');name.textContent=profile.name+' · '+profile.class;
    const button=document.createElement('button');button.type='button';button.textContent='Сменить ученика';button.onclick=onSwitch;
    bar.append(name,button);document.querySelector('main').before(bar);return bar;
  }
  root.StudentEntry={open,badge,key};
})(globalThis);
