(function(){
  'use strict';
  const api='https://bbae5ggs5hjqgfo6htv8.containers.yandexcloud.net';
  const list=document.getElementById('site-work-list'),status=document.getElementById('site-work-status'),select=document.getElementById('site-work-class');
  const links=[...document.querySelectorAll('a[data-managed-work]')];
  let items=[],busy=false;
  const key=url=>{const u=new URL(url,location.href);return u.pathname+u.search;};
  const labels={russian:'Русский язык',literature:'Литература',informatics:'Информатика',other:'Задание'};
  function schoolClass(value){
    const text=String(value||'').normalize('NFKC').trim().replace(/[«»"“”]/g,'').replace(/\s+/g,' ');
    const match=/^(\d{1,2})(?:\s*([а-яёa-z])|\s*(?:-й\s*)?класс)?$/iu.exec(text);
    if(!match || Number(match[1])<1 || Number(match[1])>11)return {key:text.toLocaleUpperCase('ru'),label:text};
    const grade=Number(match[1]),section=(match[2]||'').toLocaleUpperCase('ru');
    const label=section?`${grade}${section}`:`${grade} класс`;
    return {key:label,label,grade,section};
  }
  function matchesClass(value,selected){
    if(!selected)return true;
    const work=schoolClass(value),student=schoolClass(selected);
    return work.key===student.key || Boolean(student.section && work.grade===student.grade && work.section==='');
  }
  let chosenClass=schoolClass(new URLSearchParams(location.search).get('class')?.slice(0,60)||'').key;
  function updateClasses(){
    const classes=new Map(items.map(item=>schoolClass(item.class)).filter(c=>c.key).map(c=>[c.key,c]));
    // Keep the choice when the teacher temporarily hides the last work for this class.
    if(chosenClass&&!classes.has(chosenClass))classes.set(chosenClass,schoolClass(chosenClass));
    select.replaceChildren(new Option('Все классы',''));
    [...classes.values()].sort((a,b)=>a.label.localeCompare(b.label,'ru',{numeric:true})).forEach(c=>
      select.add(new Option(c.grade&&!c.section?`${c.label} — общие задания`:c.label,c.key)));
    select.value=chosenClass;
  }
  function render(){
    if(!list)return;list.replaceChildren();const filtered=items.filter(item=>matchesClass(item.class,chosenClass));
    for(const item of filtered){
      const url=new URL(item.studentUrl);if(url.origin!==location.origin)continue;
      const a=document.createElement('a');a.className='kd-card kd-card-live';a.href=url.href;
      const heading=document.createElement('strong');heading.textContent=item.title;
      const sub=document.createElement('span');sub.className='kd-kicker';sub.textContent=[item.class,labels[item.subject]||item.subject].filter(Boolean).join(' · ');
      const date=document.createElement('small');date.textContent=item.lessonDate ? item.lessonDate.split('-').reverse().join('.') : {trainer:'Тренажёр',control:'Контрольная',lesson:'Задание'}[item.publicationKind];
      const action=document.createElement('span');action.textContent='Открыть работу →';a.append(sub,heading,date,action);list.append(a);
    }
    status.textContent=filtered.length?`Доступно работ: ${filtered.length}`:'Для выбранного класса пока нет опубликованных работ.';
  }
  async function load(){
    if(busy)return;busy=true;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const r=await fetch(api+'/api/public/site-works',{cache:'no-store',credentials:'omit',signal:controller.signal});
      if(!r.ok)throw Error();const data=await r.json();if(data.schemaVersion!=='kodislovo.site-catalog.v1'||!Array.isArray(data.items))throw Error();items=data.items;
      const visible=new Set(items.map(x=>key(x.studentUrl)));links.forEach(a=>{a.hidden=!visible.has(key(a.href));});
      if(select){updateClasses();render();}
    }catch(_){links.forEach(a=>a.hidden=true);if(list)list.replaceChildren();if(status)status.textContent='Не удалось загрузить каталог. Проверьте подключение и нажмите «Обновить».';}
    finally{clearTimeout(timer);busy=false;}
  }
  select?.addEventListener('change',()=>{
    chosenClass=select.value;
    const url=new URL(location.href);if(chosenClass)url.searchParams.set('class',chosenClass);else url.searchParams.delete('class');
    history.replaceState(history.state,'',url);render();
  });document.getElementById('site-work-reload')?.addEventListener('click',load);
  load();setInterval(()=>{if(!document.hidden)load();},30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
})();
