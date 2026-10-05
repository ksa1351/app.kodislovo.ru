(function(){
  'use strict';
  const api='https://bbae5ggs5hjqgfo6htv8.containers.yandexcloud.net';
  const list=document.getElementById('site-work-list'),status=document.getElementById('site-work-status'),select=document.getElementById('site-work-class');
  const links=[...document.querySelectorAll('a[data-managed-work]')];
  let items=[],busy=false;
  const key=url=>{const u=new URL(url,location.href);return u.pathname+u.search;};
  const labels={russian:'Русский язык',literature:'Литература',informatics:'Информатика',other:'Задание'};
  function render(){
    if(!list)return;list.replaceChildren();const filtered=items.filter(item=>!select.value||item.class===select.value);
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
      if(select){const value=select.value;select.replaceChildren(new Option('Все классы',''));[...new Set(items.map(x=>x.class).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru',{numeric:true})).forEach(c=>select.add(new Option(c,c)));select.value=[...select.options].some(o=>o.value===value)?value:'';render();}
    }catch(_){links.forEach(a=>a.hidden=true);if(list)list.replaceChildren();if(status)status.textContent='Не удалось загрузить каталог. Проверьте подключение и нажмите «Обновить».';}
    finally{clearTimeout(timer);busy=false;}
  }
  select?.addEventListener('change',render);document.getElementById('site-work-reload')?.addEventListener('click',load);
  load();setInterval(()=>{if(!document.hidden)load();},30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
})();
