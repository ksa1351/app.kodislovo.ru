(function(){
'use strict';
const {theory,groups,bank}=NE_EXTRA,$=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
$('#reference-content').innerHTML=theory.map((t,i)=>`<details class="reference-topic"><summary>${i+1}. ${esc(t.title)}</summary>${t.paragraphs.map(p=>'<p>'+esc(p)+'</p>').join('')}${t.examples.length?'<div class="tablewrap"><table><tbody>'+t.examples.map(([label,text])=>`<tr><th scope="row">${esc(label)}</th><td>${esc(text)}</td></tr>`).join('')+'</tbody></table></div>':''}</details>`).join('');
document.querySelectorAll('[data-open-reference]').forEach(b=>b.onclick=()=>$('#reference-dialog').showModal());$('#reference-dialog [data-close-reference]').onclick=()=>$('#reference-dialog').close();
$('#reference-content').insertAdjacentHTML('beforeend','<p class="muted" style="margin-top:20px">Источники: <a href="https://gramota.ru/uchebnik/pravila/ne-s-prilagatelnymi" target="_blank" rel="noopener noreferrer">Грамота.ру</a>, <a href="https://old-rozental.ru/orfografia.php?sid=77" target="_blank" rel="noopener noreferrer">справочник Розенталя</a>, <a href="https://www.orthographia.ru/orfografia.php?sid=0" target="_blank" rel="noopener noreferrer">полный академический справочник</a>.</p>');
$('#extra-group').innerHTML=groups.map((g,i)=>`<option value="${i}">${esc(g)}</option>`).join('');
const KEY='kodislovo:ne:extra-examples:v1';let state={group:0,pos:0,answers:{},first:{},checked:{}};
try{const saved=JSON.parse(localStorage.getItem(KEY));if(saved&&Number.isInteger(saved.group)&&saved.group>=0&&saved.group<groups.length&&Number.isInteger(saved.pos)&&saved.pos>=0&&saved.answers&&saved.first&&saved.checked){state=saved;}}catch(_){}
const list=()=>bank.filter(t=>t.group===state.group),together=t=>!t.key.startsWith('не ');
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(_){$('.extra-progress').textContent='Не удалось сохранить ответы. Оставь страницу открытой до конца работы.';}}
function show(){
const items=list();state.pos=Math.min(state.pos,items.length-1);const t=items[state.pos];$('#extra-group').value=String(state.group);
const topics=[1,2,3,4,5,6,7,8,9];$('#extra-theory').textContent=theory[topics[state.group]].paragraphs.join(' ');
$('#extra-count').textContent=`Пример ${state.pos+1} из ${items.length}`;
$('#extra-question').innerHTML=`<div class="sentence">${esc(t.prompt).replace(/\(не\)[а-яё]+/gi,'<span class="blank">$&</span>')}</div><fieldset class="answer-group"><legend>Как пишется НЕ?</legend><div class="spelling">${['Слитно','Раздельно'].map((label,i)=>`<label class="option"><input type="radio" name="extra-answer" value="${i===0?'together':'apart'}" ${state.answers[t.id]===(i===0?'together':'apart')?'checked':''}><span>${label}</span></label>`).join('')}</div></fieldset>`;
$('#extra-feedback').hidden=!state.checked[t.id];if(state.checked[t.id])feedback(t);
$('#extra-notice').textContent='';$('#extra-prev').disabled=state.pos===0;$('#extra-next').disabled=state.pos===items.length-1;
const done=items.filter(t=>state.first[t.id]),right=done.filter(t=>state.first[t.id]===(together(t)?'together':'apart'));
$('.extra-progress').textContent=`В этой теме проверено ${done.length} из ${items.length}. Верно с первой попытки: ${right.length}.`;
$('#extra-question').querySelectorAll('input').forEach(el=>el.onchange=()=>{state.answers[t.id]=el.value;delete state.checked[t.id];$('#extra-feedback').hidden=true;$('#extra-notice').textContent='';save();});
}
function feedback(t){const good=state.answers[t.id]===(together(t)?'together':'apart');$('#extra-feedback').innerHTML=`<h3 class="${good?'good':'bad'}">${good?'Верно':'Проверь правило'}</h3><p>Правильно: <b>${esc(t.key)}</b>.</p><p>${esc(t.why)}</p>`;}
document.querySelectorAll('[data-open-extra]').forEach(b=>b.onclick=()=>{show();$('#extra-dialog').showModal();});$('#extra-dialog [data-close-extra]').onclick=()=>$('#extra-dialog').close();
$('#extra-group').onchange=e=>{state.group=Number(e.target.value);state.pos=0;save();show();};
$('#extra-prev').onclick=()=>{if(state.pos>0){state.pos--;save();show();}};$('#extra-next').onclick=()=>{if(state.pos<list().length-1){state.pos++;save();show();}};
$('#extra-check').onclick=()=>{const t=list()[state.pos];if(!state.answers[t.id]){$('#extra-notice').textContent='Выбери написание.';return;}if(!state.first[t.id])state.first[t.id]=state.answers[t.id];state.checked[t.id]=true;save();show();};
$('#confirm-reset').addEventListener('click',()=>{state={group:0,pos:0,answers:{},first:{},checked:{}};save();});
})();
