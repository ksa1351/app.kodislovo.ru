(function(){
'use strict';
const {tasks,stages,reasons,version,sources}=NE_CONTENT;
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY='kodislovo:ne-advanced:60:v'+version;
const normalize=s=>String(s??'').toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim().replace(/[.!?;:,]+$/,'').trim();
const fresh=()=>({version,started:false,finished:false,i:0,elapsed:0,answers:{},first:{},checked:{},hintUsed:{}});
let state=fresh(),running=false,last=performance.now(),storageFailed=false,reviewIds=null;
try{const saved=JSON.parse(localStorage.getItem(KEY));if(saved?.version===version&&Number.isInteger(saved.i)&&saved.i>=0&&saved.i<tasks.length&&Number.isFinite(saved.elapsed)&&saved.elapsed>=0&&saved.answers&&saved.first&&saved.checked){state={...fresh(),...saved,hintUsed:saved.hintUsed||{}};delete state.notes;}}
catch(_){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(_){if(!storageFailed){storageFailed=true;const p=document.createElement('p');p.className='storage-warning';p.textContent='Браузер не разрешил автосохранение. Скачайте результат перед закрытием страницы.';$('#session').prepend(p);}}}
function tick(){const now=performance.now();if(running){state.elapsed+=(now-last)/1000;}last=now;$('#timer').textContent=format(Math.max(0,3600-state.elapsed));$('#time-notice').hidden=state.elapsed<3600;}
function format(sec){sec=Math.floor(sec);return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');}
function setRunning(value){tick();running=value;last=performance.now();$('#pause').textContent=running?'Пауза':'Продолжить';$('#pause').setAttribute('aria-pressed',String(!running));save();}
function evaluate(t,a){if(!a)return {score:0,max:t.type==='word'?2:t.type==='editor'?6:1,parts:[]};if(t.type==='word'){const spelling=a.spelling===(t.answer.startsWith('не ')?'apart':'together'),reason=a.reason===t.reason;return {score:Number(spelling)+Number(reason),max:2,parts:[spelling,reason]};}if(t.type==='editor'){const parts=t.fields.map((f,i)=>normalize(a.fields?.[i])===normalize(f.key));return {score:parts.filter(Boolean).length,max:6,parts};}const correct=Number(a.choice)===t.key;return {score:Number(correct),max:1,parts:[correct]};}
function complete(t,a){return t.type==='word'?['apart','together'].includes(a?.spelling)&&t.reasonOptions.includes(a?.reason):t.type==='editor'?a?.fields?.length===6&&a.fields.every(x=>String(x).trim()):a?.choice!==undefined&&a.choice!==''&&Number.isInteger(Number(a.choice))&&Number(a.choice)>=0&&Number(a.choice)<t.options.length;}
function option(name,value,label,selected){return `<label class="option"><input type="radio" name="${esc(name)}" value="${esc(value)}" ${String(value)===String(selected)?'checked':''}><span>${esc(label)}</span></label>`;}
function currentIndices(){return reviewIds||tasks.map((_,i)=>i);}
function go(i){state.i=i;save();render();$('#workspace').focus({preventScroll:true});}
function render(){
const t=tasks[state.i],a=state.answers[t.id]||{},st=stages[t.stage];
$('#welcome').hidden=state.started;$('#session').hidden=!state.started;
$('.hero').hidden=state.started;$('.sources').hidden=!state.started;
$('#stages').innerHTML=stages.map((s,j)=>{const total=tasks.filter(t=>t.stage===j),done=total.filter(t=>state.first[t.id]).length;return `<button class="stage-button" data-stage="${j}" ${j===t.stage?'aria-current="step"':''}><span class="stage-num">${j+1}</span><span>${esc(s.title)}<small>${s.minutes} мин · ${done}/${total.length} проверено</small></span></button>`;}).join('');
$('#stage-kicker').textContent=reviewIds?'ПОВТОРЕНИЕ ОШИБОК · ПЕРВЫЕ БАЛЛЫ СОХРАНЯЮТСЯ':`ЭТАП ${t.stage+1} ИЗ 6`;
$('#stage-title').textContent=st.title;$('#stage-subtitle').textContent=st.subtitle;$('#stage-time').textContent=st.minutes+' минут';$('#theory').textContent=st.theory;$('.theory').open=false;
const indices=currentIndices();$('#task-select').innerHTML=indices.map(i=>`<option value="${i}" ${i===state.i?'selected':''}>${tasks[i].id}. ${esc(tasks[i].type==='word'?tasks[i].sentence.slice(0,53):tasks[i].title)}${state.first[tasks[i].id]?' ✓':''}</option>`).join('');
$('#task-counter').textContent=reviewIds?`${indices.indexOf(state.i)+1} из ${indices.length} для повторения`:`${state.i+1} из ${tasks.length}`;
let html=`<h3>${esc(t.title)}</h3>`;
if(t.type==='word'){
html+='<p class="muted">Выбери, как пишется выделенное слово, и объясни почему.</p><div class="sentence">'+esc(t.sentence).replace(/\(не\)[а-яё]+/gi,'<span class="blank">$&</span>')+'</div>';
html+=`<fieldset class="answer-group"><legend>1. Как пишется НЕ?</legend><div class="spelling">${option('spelling','together','Слитно',a.spelling)}${option('spelling','apart','Раздельно',a.spelling)}</div></fieldset>`;
html+=`<fieldset class="answer-group"><legend>2. Почему?</legend><div class="options">${t.reasonOptions.map(k=>option('reason',k,reasons[k],a.reason)).join('')}</div></fieldset>`;
}else if(t.type==='editor'){
html+=`<p>${esc(t.prompt)}</p><div class="editor-text">${esc(t.text)}</div><div class="editor-fields">${t.fields.map((f,i)=>`<label for="editor-${i}">${i+1}. ${esc(f.label)}<input id="editor-${i}" data-editor="${i}" type="text" maxlength="100" autocomplete="off" spellcheck="false" value="${esc(a.fields?.[i]||'')}"></label>`).join('')}</div>`;
}else{html+=`<p>${esc(t.prompt)}</p><fieldset class="answer-group"><legend>Верное объяснение</legend><div class="options">${t.options.map((o,i)=>option('choice',i,o,a.choice)).join('')}</div></fieldset>`;}
$('#task').innerHTML=html;$('#notice').textContent='';$('#check').textContent=state.first[t.id]?'Проверить ещё раз':'Проверить ответ';
$('#feedback').hidden=!state.checked[t.id];if(state.checked[t.id])feedback(t,a);
const pos=indices.indexOf(state.i);$('#prev').disabled=pos<=0;$('#next').disabled=pos>=indices.length-1;
$('#next').textContent=state.i===tasks.length-1?'Последнее задание':'Дальше →';
const done=tasks.filter(t=>state.first[t.id]).length;$('#progress').value=done;$('#progress-label').textContent=`${done} из ${tasks.length} заданий проверено`;
$('#task').querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>{const v=state.answers[t.id]||{};if(input.dataset.editor!==undefined){v.fields=Array.from($('#task').querySelectorAll('[data-editor]')).map(x=>x.value);}else v[input.name]=input.value;state.answers[t.id]=v;delete state.checked[t.id];$('#feedback').hidden=true;$('#notice').textContent='';save();}));
$('#stages').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{reviewIds=null;go(tasks.findIndex(t=>t.stage===Number(b.dataset.stage)));}));
}
function feedback(t,a){
const result=evaluate(t,a);let html=`<h3 class="${result.score===result.max?'good':'bad'}">${result.score===result.max?'Верно':'Есть что уточнить'} · ${result.score} из ${result.max}</h3>`;
if(t.type==='word'){html+=`<p><span class="${result.parts[0]?'good':'bad'}">${result.parts[0]?'✓':'✗'} Написание</span> · <span class="${result.parts[1]?'good':'bad'}">${result.parts[1]?'✓':'✗'} Объяснение</span></p><p>Правильно: <b>${esc(t.answer)}</b>.</p><p>${esc(t.why)}</p>`;}
else if(t.type==='editor'){html+='<ol>'+t.fields.map((f,i)=>`<li><span class="${result.parts[i]?'good':'bad'}">${result.parts[i]?'✓':'✗'}</span> <b>${esc(f.key)}</b> — ${esc(f.why)}</li>`).join('')+'</ol>';}
else html+=`<p>${esc(t.options[t.key])}</p><p>${esc(t.why)}</p>`;
const pairs={7:'В задании 8 «с детства» не называет исполнителя действия.',8:'В задании 7 «матерью» называет исполнителя действия.',9:'В заданиях 11 и 13 исключение работает у «непобедимый», но не у «зависимый».',11:'Слово с НИ не отменяет слитного написания слова, которое без НЕ не употребляется.',13:'В задании 11 слово без НЕ не употребляется. «Зависимый» — самостоятельное слово.',14:'«Поступок необъясним» — его невозможно объяснить; это краткое прилагательное. «Поступок не объяснён» — его не объяснили; это краткое причастие. С кратким причастием НЕ пишется раздельно и без слова «никем».',21:'В задании 22 «до конца» поясняет действие, а «крайне» показывает степень признака.',22:'В задании 21 «крайне» показывает степень признака, а «до конца» поясняет действие.'};
if(pairs[t.id])html+=`<p><b>Для сравнения:</b> ${esc(pairs[t.id])}</p>`;
$('#feedback').innerHTML=html;
}
function check(){const t=tasks[state.i],a=state.answers[t.id];if(!complete(t,a)){$('#notice').textContent=t.type==='word'?'Выберите и написание, и объяснение.':t.type==='editor'?'Заполните все шесть фрагментов.':'Выберите объяснение.';return;}if(!state.first[t.id])state.first[t.id]=JSON.parse(JSON.stringify(a));state.checked[t.id]=true;save();render();}
function summary(){const rows=tasks.map(t=>({t,a:state.first[t.id],...evaluate(t,state.first[t.id])}));const answered=rows.filter(r=>r.a);const score=rows.reduce((n,r)=>n+r.score,0),max=rows.reduce((n,r)=>n+r.max,0);const words=rows.filter(r=>r.t.type==='word');return {rows,answered,score,max,writing:words.filter(r=>r.parts[0]).length,reason:words.filter(r=>r.parts[1]).length,wordTotal:words.length};}
function answerText(t,a){if(!a)return 'Не проверено';if(t.type==='word')return `${a.spelling==='together'?'Слитно':'Раздельно'}; ${reasons[a.reason]||'нет объяснения'}`;if(t.type==='editor')return (a.fields||[]).join(' | ');return t.options[Number(a.choice)]||'Нет ответа';}
function showReport(){
tick();save();const s=summary(),mistakes=s.rows.filter(r=>r.a&&r.score<r.max),missing=s.rows.filter(r=>!r.a);
let html=`<div class="report-header"><div><p class="eyebrow">${state.finished?'ЗАНЯТИЕ ЗАВЕРШЕНО':'ПРОМЕЖУТОЧНЫЙ РЕЗУЛЬТАТ'}</p><h2>Что уже получается?</h2><p class="muted">Первый результат · ${s.answered.length}/40 заданий · активное время ${format(state.elapsed)}</p></div><button id="back-to-work" class="quiet">К заданиям ↑</button></div>`;
html+=`<div class="stats"><div class="stat"><b>${s.score} / ${s.max}</b><small>баллов за первые ответы</small></div><div class="stat"><b>${s.writing} / ${s.wordTotal}</b><small>верных написаний в заданиях 5–36</small></div><div class="stat"><b>${s.reason} / ${s.wordTotal}</b><small>верных объяснений в заданиях 5–36</small></div></div>`;
html+='<div class="tablewrap"><table><thead><tr><th scope="col">Этап</th><th scope="col">Проверено</th><th scope="col">Баллы</th></tr></thead><tbody>'+stages.map((st,j)=>{const rs=s.rows.filter(r=>r.t.stage===j);return `<tr><th scope="row">${j+1}. ${esc(st.title)}</th><td>${rs.filter(r=>r.a).length}/${rs.length}</td><td>${rs.reduce((n,r)=>n+r.score,0)}/${rs.reduce((n,r)=>n+r.max,0)}</td></tr>`;}).join('')+'</tbody></table></div>';
if(missing.length)html+=`<p class="first-note">Ещё не проверены: ${missing.map(r=>r.t.id).join(', ')}. Непроверенные задания пока не приносят баллов.</p>`;
const weak=stages.map((st,j)=>{const rs=s.rows.filter(r=>r.t.stage===j&&r.a);return {title:st.title,count:rs.filter(r=>r.score<r.max).length};}).filter(x=>x.count).sort((a,b)=>b.count-a.count).slice(0,2);
html+=weak.length?`<h3>Что повторить</h3><p>${weak.map(x=>esc(x.title)).join('; ')}. Вернитесь к ошибочным заданиям и объясните, какое условие вы пропустили.</p>`:s.answered.length===40?'<h3>Все первые ответы верны</h3><p>Для закрепления составьте свою пару предложений, в которой изменение контекста меняет написание НЕ.</p>':'';
if(mistakes.length){html+='<h3>Разбор первых ошибок</h3>'+mistakes.map(r=>{const t=r.t;return `<details><summary>Задание ${t.id} · ${r.score}/${r.max} · ${esc(t.sentence||t.title)}</summary><p><b>Ваш первый ответ:</b> ${esc(answerText(t,r.a))}</p>${t.type==='editor'?'<ol>'+t.fields.map(f=>`<li><b>${esc(f.key)}</b> — ${esc(f.why)}</li>`).join('')+'</ol>':`<p><b>Правильно:</b> ${esc(t.answer||t.options[t.key])}</p><p>${esc(t.why)}</p>`}</details>`;}).join('');}
html+=`<div class="actions">${mistakes.length?'<button id="review" class="primary">Повторить ошибки</button>':''}<button id="download" class="quiet">Скачать отчёт</button><button id="print" class="quiet">Распечатать</button><button id="reset" class="quiet">Начать заново</button></div><p class="download-status" role="status"></p>`;
$('#report').innerHTML=html;$('#report').hidden=false;$('#report').focus();$('#report').scrollIntoView({behavior:'smooth',block:'start'});
$('#back-to-work').onclick=()=>{$('#report').hidden=true;$('#workspace').focus();$('#workspace').scrollIntoView({behavior:'smooth',block:'start'});};
if($('#review'))$('#review').onclick=()=>{reviewIds=mistakes.map(r=>tasks.indexOf(r.t));$('#report').hidden=true;go(reviewIds[0]);$('#workspace').scrollIntoView({behavior:'smooth',block:'start'});};
$('#download').onclick=download;$('#print').onclick=()=>{document.querySelectorAll('#report details').forEach(d=>d.open=true);window.print();};$('#reset').onclick=()=>$('#reset-dialog').showModal();
}
function download(){
const s=summary();
const text=['Кодислово — НЕ: сложные случаи','Первый результат: '+s.score+' из '+s.max+' баллов','Проверено: '+s.answered.length+' из 40 заданий','Активное время: '+format(state.elapsed),'Написание: '+s.writing+'/'+s.wordTotal,'Объяснение: '+s.reason+'/'+s.wordTotal,'',...s.rows.map(r=>{
const t=r.t,solution=r.a?(t.type==='editor'?t.fields.map(f=>f.key+' — '+f.why).join('; '):(t.answer||t.options[t.key])+' — '+t.why):'Разбор появится после проверки задания.';
return `${t.id}. ${t.sentence||t.title}\nПервый ответ: ${answerText(t,r.a)}\nБаллы: ${r.score}/${r.max}\nПравильно: ${solution}\n`;
}),'','Источники:',...sources.map(([name,url])=>name+' — '+url)].join('\n');
const blob=new Blob(['\ufeff'+text],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='НЕ-сложные-случаи-результат.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('.download-status').textContent='Отчёт подготовлен для скачивания.';
}
$('#start').onclick=()=>{state.started=true;setRunning(true);render();$('#workspace').focus();};
$('#pause').onclick=()=>setRunning(!running);$('#check').onclick=check;$('#task-select').onchange=e=>go(Number(e.target.value));
$('#prev').onclick=()=>{const ids=currentIndices(),pos=ids.indexOf(state.i);if(pos>0)go(ids[pos-1]);};
$('#next').onclick=()=>{const ids=currentIndices(),pos=ids.indexOf(state.i);if(pos<ids.length-1)go(ids[pos+1]);};
$('#results').onclick=showReport;
$('#finish').onclick=()=>{const missing=tasks.findIndex(t=>!state.first[t.id]);if(missing>=0){reviewIds=null;go(missing);$('#notice').textContent='Перед завершением проверьте все задания. Следующее непроверенное — № '+(missing+1)+'.';$('#workspace').scrollIntoView({behavior:'smooth',block:'start'});return;}state.finished=true;setRunning(false);showReport();};
$('.theory').addEventListener('toggle',()=>{if($('.theory').open){state.hintUsed[tasks[state.i].id]=true;save();}});
$('#cancel-reset').onclick=()=>$('#reset-dialog').close();$('#confirm-reset').onclick=()=>{state=fresh();running=false;reviewIds=null;save();$('#report').hidden=true;$('#reset-dialog').close();render();tick();$('#welcome').scrollIntoView({behavior:'smooth'});};
$('#sources').innerHTML=sources.map(([name,url])=>`<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a></li>`).join('');
window.addEventListener('pagehide',()=>{tick();save();});document.addEventListener('visibilitychange',()=>{if(document.hidden){tick();save();}});
setInterval(()=>{tick();if(running)save();},1000);
render();tick();$('#pause').textContent='Продолжить';$('#pause').setAttribute('aria-pressed','true');
if(state.finished)showReport();
})();
