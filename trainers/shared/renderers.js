export const escapeHTML = value => String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const wordCount = text => (String(text).match(/[\p{L}\p{N}]+(?:[-‑][\p{L}\p{N}]+)*/gu)||[]).length;
const e=escapeHTML;
function choices(task,value,onChange,multiple){
  const node=document.createElement('fieldset');
  node.innerHTML=`<legend>${e(task.instruction||'Выбери '+(multiple?'все подходящие варианты.':'один вариант.'))}</legend><div class="options">${task.options.map(option=>`<label class="option"><input type="${multiple?'checkbox':'radio'}" name="answer-${e(task.id)}" value="${e(option.id)}" ${(multiple?(value||[]).includes(option.id):value===option.id)?'checked':''}><span>${e(option.text)}</span></label>`).join('')}</div>`;
  node.addEventListener('change',()=>{const ids=[...node.querySelectorAll('input:checked')].map(el=>el.value);onChange(multiple?ids:ids[0]);});return node;
}
export function singleChoice(task,value,onChange){return choices(task,value,onChange,false);}
export function multiChoice(task,value,onChange){return choices(task,value,onChange,true);}
export function selectText(task,value,onChange){return choices(task,value,onChange,true);}
function mapping(task,value,onChange){
  const node=document.createElement('fieldset');const groups=task.groups||task.options;
  node.innerHTML=`<legend>${e(task.instruction||'Подбери соответствие для каждого фрагмента.')}</legend>`+task.items.map(item=>`<label class="select-row">${e(item.text)}<select data-item="${e(item.id)}"><option value="">Выбрать…</option>${groups.map(group=>`<option value="${e(group.id)}" ${value?.[item.id]===group.id?'selected':''}>${e(group.text)}</option>`).join('')}</select></label>`).join('');
  node.addEventListener('change',()=>onChange(Object.fromEntries([...node.querySelectorAll('select')].map(el=>[el.dataset.item,el.value]))));return node;
}
export function match(task,value,onChange){return mapping(task,value,onChange);}
export function classify(task,value,onChange){return mapping(task,value,onChange);}
export function examReference(task){
  if(!task.exam)return '';
  return `<div class="exam-reference"><section aria-labelledby="exam-errors-title"><h3 id="exam-errors-title">Грамматические ошибки</h3><ul class="exam-errors">${task.exam.errors.map(row=>`<li><b>${e(row.letter)}.</b> ${e(row.text)}</li>`).join('')}</ul></section><section aria-labelledby="exam-sentences-title"><h3 id="exam-sentences-title">Предложения</h3><ol class="exam-sentences">${task.exam.sentences.map(text=>`<li>${e(text)}</li>`).join('')}</ol></section></div>`;
}
export function fill(task,value,onChange){
  const node=document.createElement('fieldset');node.innerHTML=`<legend>${e(task.instruction||'Заполни пропуски.')}</legend>`+task.items.map(item=>`<label class="select-row">${e(item.text)}<input type="text" data-item="${e(item.id)}" value="${e(value?.[item.id]||'')}" autocomplete="off"></label>`).join('');
  if(task.exam)for(const input of node.querySelectorAll('input')){input.inputMode='numeric';input.maxLength=5;input.pattern='[1-9]{5}';input.placeholder='Например: 12345';}
  node.addEventListener('input',()=>onChange(Object.fromEntries([...node.querySelectorAll('input')].map(el=>[el.dataset.item,el.value]))));return node;
}
export function order(task,value,onChange){
  const node=document.createElement('div');let ids=Array.isArray(value)&&value.length===task.items.length?[...value]:task.items.map(i=>i.id);
  function draw(){node.innerHTML='<p class="small">Меняй порядок стрелками. Кнопки доступны с клавиатуры.</p><ol class="order-list">'+ids.map((id,i)=>`<li><span>${i+1}. ${e(task.items.find(item=>item.id===id)?.text)}</span><button type="button" data-index="${i}" data-move="-1" ${i===0?'disabled':''} aria-label="Пункт ${i+1} вверх">↑</button><button type="button" data-index="${i}" data-move="1" ${i===ids.length-1?'disabled':''} aria-label="Пункт ${i+1} вниз">↓</button></li>`).join('')+'</ol><button type="button" data-confirm>Подтвердить порядок</button>';}
  node.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.hasAttribute('data-confirm')){onChange([...ids]);return;}const i=Number(button.dataset.index),next=i+Number(button.dataset.move);[ids[i],ids[next]]=[ids[next],ids[i]];onChange([...ids]);draw();node.querySelector(`[data-index="${next}"]:not(:disabled)`)?.focus();});draw();return node;
}
export function openResponse(task,value,onChange){
  const node=document.createElement('div');node.innerHTML=`<label for="open-answer" class="small">${e(task.answerLabel||'Твой ответ')}</label><textarea id="open-answer" placeholder="${e(task.placeholder||'Пиши своими словами…')}" aria-describedby="answer-count">${e(value||'')}</textarea><div id="answer-count" class="counter"></div>`;
  const area=node.querySelector('textarea'),counter=node.querySelector('.counter');const count=()=>counter.textContent=`${wordCount(area.value)} слов · ${area.value.length} символов`;
  area.addEventListener('input',()=>{count();onChange(area.value);});count();return node;
}
export const renderers={'single-choice':singleChoice,'multi-choice':multiChoice,'match':match,'order':order,'classify':classify,'select-text':selectText,'fill':fill,'open-response':openResponse};
