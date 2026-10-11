(async()=>{
  'use strict';
  const student=await StudentEntry.open({id:'russian.11.lesson-017',title:'Деепричастные обороты · «Лес и степь»'});
  StudentEntry.badge(student);
  function answerFilename(extension){
    const name=student.name.replace(/[<>:"\/\\|?*\u0000-\u001f]/g,'').replace(/\s+/g,'_').slice(0,90);
    return student.class+'_РУС_17_'+name+'_Ответы.'+extension;
  }
'use strict';
    const config=JSON.parse(document.getElementById('assignment-data').textContent);
    const $=id=>document.getElementById(id);
    const sourceText=config.paragraphs.join('\n\n');
    function textHash(text){let value=2166136261;for(const c of text)value=Math.imul(value^c.charCodeAt(0),16777619)>>>0;return value;}
    const hash=textHash(sourceText);
    const storeKey='kodislovo:gerund-phrases:'+hash.toString(16)+':'+config.release+':'+StudentEntry.key(student);
    const tokens=[],parts=[];
    config.paragraphs.forEach((paragraph,pi)=>{const list=[];let pos=0;for(const m of paragraph.matchAll(/[\p{L}\p{N}]+(?:[-‑][\p{L}\p{N}]+)*/gu)){if(m.index>pos)list.push({kind:'sep',value:paragraph.slice(pos,m.index),after:tokens.length-1});const t={id:tokens.length,word:m[0],paragraph:pi,start:m.index,end:m.index+m[0].length};tokens.push(t);list.push({kind:'word',id:t.id});pos=t.end;}if(pos<paragraph.length)list.push({kind:'sep',value:paragraph.slice(pos),after:tokens.length-1});parts.push(list);});
    const blank=()=>({subjects:[],predicates:[],mainActions:[],turns:[],links:[],next:1});
    const validId=n=>Number.isInteger(n)&&n>=0&&n<tokens.length;
    const clone=x=>JSON.parse(JSON.stringify(x));
    function clean(raw){
      const m=blank();if(!raw||typeof raw!=='object')return m;
      for(const field of ['subjects','predicates'])m[field]=[...new Set((Array.isArray(raw[field])?raw[field]:[]).filter(validId))];
      const actionIds=Array.isArray(raw.mainActions)?raw.mainActions:raw.predicates;
      m.mainActions=[...new Set((Array.isArray(actionIds)?actionIds:[]).filter(validId))];
      const ranges=Array.isArray(raw.turns)?raw.turns:[];m.turns=ranges.filter(r=>validId(r.start)&&validId(r.end)&&r.start<=r.end).map((r,i)=>({id:'r'+(i+1),start:r.start,end:r.end}));
      const links=Array.isArray(raw.links)?raw.links:[];m.links=links.filter(l=>validId(l.from)&&validId(l.to)&&l.from!==l.to).map((l,i)=>({id:'l'+(i+1),from:l.from,to:l.to,question:typeof l.question==='string'?l.question.slice(0,200):'',aspect:['impf','pf'].includes(l.aspect)?l.aspect:'',timing:['simultaneous','before','after'].includes(l.timing)?l.timing:'',actor:typeof l.actor==='string'?l.actor.slice(0,150):''}));
      m.next=Math.max(m.turns.length,m.links.length)+1;return m;
    }
    let editorAnswers=cleanEditing(null),writing=cleanWriting(null),activeStep=0;
    let model=config.mode==='teacher'&&config.initialAnswer?clean(config.initialAnswer):blank(),history=[],tool='subject',pending=null,lastCheck=null;
    let editingQuestion=null;
    const questionAnchors=new Map();
    try{const saved=JSON.parse(localStorage.getItem(storeKey));if(saved?.version===1&&saved.text===sourceText){model=clean(saved.answer);editorAnswers=cleanEditing(saved.editing);writing=cleanWriting(saved.writing);activeStep=Number.isInteger(saved.step)?Math.max(0,Math.min(3,saved.step)):0;}}catch(_){}
    function save(){refreshProgress();try{localStorage.setItem(storeKey,JSON.stringify({version:1,text:sourceText,answer:model,editing:editorAnswers,writing,step:activeStep}));$('save-note').textContent='Черновик сохраняется в этом браузере. Скачайте файл, чтобы перенести ответы на другое устройство.';}catch(_){$('save-note').textContent='Автосохранение недоступно. Скачивайте ответы, чтобы сохранить работу.';}}
    function clearCheck(){lastCheck=null;$('summary-result').replaceChildren();$('editor-result').textContent='';$('results').replaceChildren();document.querySelectorAll('.feedback').forEach(el=>el.textContent='');}
    function snapshot(){history.push(clone(model));if(history.length>60)history.shift();clearCheck();$('undo').disabled=false;}
    function phrase(range){if(!range)return '';return tokens.slice(range.start,range.end+1).map(t=>t.word).join(' ');}
    function instruction(){
      const words={subject:'Нажмите на подлежащее, чтобы отметить его одной линией.',predicate:'Нажмите на сказуемое, чтобы отметить его двумя линиями.',action:'Нажмите на слово, обозначающее основное действие, чтобы поставить или снять крестик.',turn:'Нажмите на первое, затем на последнее слово оборота.',arrow:'Нажмите на сказуемое, затем на деепричастие.',erase:'Нажмите на слово внутри отметки, которую хотите снять.'};
      $('tool-message').textContent=pending!==null?(tool==='arrow'?'Начало стрелки отмечено. Нажмите на деепричастие.':'Начало оборота отмечено. Нажмите на последнее слово.'):words[tool];
    }
    function mutate(fn){snapshot();fn();save();renderMarks();renderLinks();instruction();}
    function clickWord(id){
      if(['subject','predicate','action'].includes(tool)){const field={subject:'subjects',predicate:'predicates',action:'mainActions'}[tool];mutate(()=>{model[field]=model[field].includes(id)?model[field].filter(n=>n!==id):[...model[field],id];});return;}
      if(tool==='erase'){mutate(()=>{model.subjects=model.subjects.filter(n=>n!==id);model.predicates=model.predicates.filter(n=>n!==id);model.mainActions=model.mainActions.filter(n=>n!==id);model.turns=model.turns.filter(r=>!(id>=r.start&&id<=r.end));model.links=model.links.filter(l=>l.from!==id&&l.to!==id);});return;}
      if(pending===null){pending=id;renderMarks();instruction();return;}
      const from=pending;pending=null;
      if(tool==='arrow'){
        if(from===id){instruction();$('tool-message').textContent='Начало и конец стрелки должны быть разными словами.';renderMarks();return;}
        if(model.links.some(l=>l.from===from&&l.to===id)){instruction();$('tool-message').textContent='Такая стрелка уже есть.';renderMarks();return;}
        mutate(()=>model.links.push({id:'l'+model.next++,from,to:id,question:'',aspect:'',timing:'',actor:''}));return;
      }
      const range={start:Math.min(from,id),end:Math.max(from,id)};
      if(tool==='turn'){
        if(model.turns.some(r=>range.start<=r.end&&range.end>=r.start)){renderMarks();instruction();$('tool-message').textContent='Фрагменты пересекаются. Снимите прежнюю отметку, если хотите изменить её границы.';return;}
        mutate(()=>model.turns.push({id:'r'+model.next++,...range}));
      }
    }
    function buildText(){
      $('text').replaceChildren();parts.forEach(list=>{const p=document.createElement('p');list.forEach(part=>{if(part.kind==='word'){const b=document.createElement('button');b.type='button';b.className='token';b.dataset.token=part.id;b.textContent=tokens[part.id].word;b.setAttribute('aria-label',tokens[part.id].word+', слово '+(part.id+1));b.addEventListener('click',()=>clickWord(part.id));p.append(b);}else{const span=document.createElement('span');span.className='separator';span.dataset.after=part.after;span.textContent=part.value;p.append(span);}});$('text').append(p);});
    }
    function renderMarks(){
      document.querySelectorAll('[data-token]').forEach(el=>{const id=Number(el.dataset.token);el.classList.toggle('subject',model.subjects.includes(id));el.classList.toggle('predicate',model.predicates.includes(id));el.classList.toggle('adverbial',model.turns.some(r=>id>=r.start&&id<=r.end));el.classList.toggle('pending',id===pending);const marks=[model.subjects.includes(id)?'подлежащее':'',model.predicates.includes(id)?'сказуемое':'',model.mainActions.includes(id)?'основное действие, крестик':'',model.turns.some(r=>id>=r.start&&id<=r.end)?'деепричастный оборот':''].filter(Boolean);el.setAttribute('aria-label',tokens[id].word+', слово '+(id+1)+(marks.length?', '+marks.join(', '):''));});
      document.querySelectorAll('[data-after]').forEach(el=>{const i=Number(el.dataset.after);el.classList.toggle('adverbial',model.turns.some(r=>i>=r.start&&i<r.end));});
      requestAnimationFrame(drawArrows);
    }
    const ns='http://www.w3.org/2000/svg';
    function svg(tag,attrs){const el=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;}
    function wordRect(id){const el=document.querySelector('[data-token="'+id+'"]');if(!el)return null;const range=document.createRange();range.selectNodeContents(el);return range.getBoundingClientRect();}
    function positionQuestionEditor(){
      if(!editingQuestion)return;const link=model.links.find(l=>l.id===editingQuestion),point=questionAnchors.get(editingQuestion),box=$('inline-question'),stage=$('text-stage');
      if(!link){editingQuestion=null;box.hidden=true;return;}if(!point||!stage.clientWidth)return;
      const width=Math.min(210,stage.clientWidth-16);box.style.width=width+'px';box.style.left=Math.max(8,Math.min(stage.clientWidth-width-8,point.x-width/2))+'px';box.style.top=Math.max(4,point.editorTop)+'px';
    }
    function openQuestionEditor(id){
      const link=model.links.find(l=>l.id===id);if(!link)return;editingQuestion=id;const input=$('inline-question-input');input.value=link.question;input.setAttribute('aria-label','Вопрос: '+tokens[link.from].word+' → '+tokens[link.to].word);$('inline-question').hidden=false;positionQuestionEditor();drawArrows();input.focus();input.select();
    }
    function closeQuestionEditor(){editingQuestion=null;$('inline-question').hidden=true;requestAnimationFrame(drawArrows);}
    function initInlineQuestions(){
      const input=$('inline-question-input');input.addEventListener('input',()=>{const link=model.links.find(l=>l.id===editingQuestion);if(!link)return;link.question=input.value;const field=$('question-'+link.id);if(field)field.value=link.question;clearCheck();save();requestAnimationFrame(drawArrows);});
      input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();input.blur();}});input.addEventListener('blur',closeQuestionEditor);$('inline-question-done').addEventListener('click',closeQuestionEditor);
    }
    function drawArrows(){
      const stage=$('text-stage');if(!stage.clientWidth)return;const bounds=stage.getBoundingClientRect(),overlay=$('arrows');overlay.replaceChildren();overlay.setAttribute('viewBox','0 0 '+stage.clientWidth+' '+stage.clientHeight);
      questionAnchors.clear();
      const defs=svg('defs',{}),marker=svg('marker',{id:'question-arrowhead',viewBox:'0 0 12 12',refX:10,refY:6,markerWidth:12,markerHeight:12,markerUnits:'userSpaceOnUse',orient:'auto',overflow:'visible'});
      marker.append(svg('polyline',{points:'2,1 10,6 2,11',fill:'none',stroke:'var(--green)','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round'}));defs.append(marker);overlay.append(defs);
      model.mainActions.forEach(id=>{const r=wordRect(id);if(!r)return;const mark=svg('text',{x:r.left+r.width/2-bounds.left,y:r.top-bounds.top-5,'text-anchor':'middle',class:'cross','data-main-action':id,'aria-hidden':'true'});mark.textContent='×';overlay.append(mark);});
      model.links.forEach(l=>{const a=wordRect(l.from),b=wordRect(l.to);if(!a||!b)return;const ax=a.left+a.width/2-bounds.left+12,ay=a.top-bounds.top-17,bx=b.left+b.width/2-bounds.left,by=b.top-bounds.top-5,sameLine=Math.abs(a.top-b.top)<8;
        const rowTop=Math.min(a.top,b.top)-bounds.top,rowHeight=Math.max(a.height,b.height),lineHeight=parseFloat(getComputedStyle($('text')).lineHeight);
        let d,tx,ty;if(sameLine){const lift=Math.min(28,20+Math.abs(ax-bx)*.03),top=Math.min(ay,by)-lift;d='M '+ax+' '+ay+' C '+ax+' '+top+' '+bx+' '+top+' '+bx+' '+by;tx=bx;ty=b.top-bounds.top-20;}else{const gutter=stage.clientWidth-6;d='M '+ax+' '+ay+' C '+ax+' '+(ay-18)+' '+gutter+' '+(ay-18)+' '+gutter+' '+ay+' L '+gutter+' '+(by-26)+' C '+gutter+' '+(by-36)+' '+bx+' '+(by-36)+' '+bx+' '+by;tx=bx;ty=b.top-bounds.top-20;}
        const line=svg('path',{d,'marker-end':'url(#question-arrowhead)','data-from':l.from,'data-to':l.to,'stroke-linecap':'round',style:'stroke-width:2','aria-hidden':'true'});line.addEventListener('click',()=>openQuestionEditor(l.id));overlay.append(line);
        questionAnchors.set(l.id,{x:tx,y:ty,editorTop:b.top-bounds.top-(lineHeight-rowHeight)+1});const group=svg('g',{class:'question-label','data-question-link':l.id,role:'button',tabindex:0,'aria-label':(l.question.trim()?'Изменить вопрос «'+l.question+'»':'Записать вопрос')+': '+tokens[l.from].word+' → '+tokens[l.to].word});
        const label=svg('text',{x:tx,y:ty,'text-anchor':'middle'});label.textContent=l.question.trim()||'Вопрос…';group.append(label);overlay.append(group);const labelWidth=label.getBBox().width;tx=Math.max(labelWidth/2+6,Math.min(stage.clientWidth-labelWidth/2-6,tx));label.setAttribute('x',tx);questionAnchors.get(l.id).x=tx;const rect=label.getBBox();group.insertBefore(svg('rect',{x:rect.x-5,y:rect.y-4,width:Math.max(rect.width+10,44),height:Math.max(rect.height+8,28),fill:'transparent'}),label);if(editingQuestion===l.id)group.style.visibility='hidden';
        group.addEventListener('click',()=>openQuestionEditor(l.id));group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openQuestionEditor(l.id);}});
      });
      positionQuestionEditor();
    }
    function element(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
    const labels={aspect:{impf:'Несовершенный',pf:'Совершенный'},timing:{simultaneous:'Одновременно с основным',before:'Перед основным',after:'После основного'}};
    function renderLinks(){
      $('connections').replaceChildren();$('empty-links').hidden=model.links.length>0;
      model.links.forEach((l,i)=>{const card=document.createElement('article');card.className='connection';card.dataset.link=l.id;const row=document.createElement('div');row.className='row';row.append(element('h3','Связь '+(i+1)+': '+tokens[l.from].word+' → '+tokens[l.to].word));const remove=element('button','Удалить связь');remove.type='button';remove.className='remove';remove.addEventListener('click',()=>mutate(()=>model.links=model.links.filter(x=>x.id!==l.id)));row.append(remove);card.append(row);const marked=model.turns.find(r=>l.to>=r.start&&l.to<=r.end);if(marked){const fragment=element("p","Выделенный оборот: "+phrase(marked));fragment.className="small";card.append(fragment);}
        const lab=element('label','Вопрос');lab.className='field';lab.htmlFor='question-'+l.id;const input=document.createElement('input');input.type='text';input.id=lab.htmlFor;input.value=l.question;input.autocomplete='off';input.addEventListener('input',()=>{l.question=input.value;clearCheck();save();requestAnimationFrame(drawArrows);});card.append(lab,input);
        const forms=document.createElement('div');forms.className='forms';for(const [name,title]of [['aspect','Вид деепричастия'],['timing','Добавочное действие происходит']]){const group=document.createElement('div'),fl=element('label',title);fl.className='field';fl.htmlFor=name+'-'+l.id;const select=document.createElement('select');select.id=fl.htmlFor;const empty=element('option','Выберите');empty.value='';select.append(empty);for(const [value,label]of Object.entries(labels[name])){const op=element('option',label);op.value=value;select.append(op);}select.value=l[name];select.addEventListener('change',()=>{snapshot();l[name]=select.value;save();});group.append(fl,select);forms.append(group);}card.append(forms);const actorLabel=element('label','Исполнитель обоих действий');actorLabel.className='field';actorLabel.htmlFor='actor-'+l.id;const actor=document.createElement('input');actor.type='text';actor.id=actorLabel.htmlFor;actor.maxLength=150;actor.value=l.actor;actor.addEventListener('input',()=>{l.actor=actor.value;clearCheck();save();});card.append(actorLabel,actor);const f=element('p','');f.className='feedback';f.id='feedback-'+l.id;card.append(f);$('connections').append(card);
      });
    }
    function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    function normalize(s){return String(s).normalize('NFC').trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').replace(/\s*([,.;:!?])\s*/g,'$1 ').trim();}
    function question(s){return normalize(s).replace(/[?？]+$/,'').trim();}
    function compare(actual,key){
      const expected=clean(key.answer),rows=[];let all=true;
      function sets(title,aa,bb){const a=new Set(aa),b=new Set(bb),correct=[...a].filter(x=>b.has(x)).length,extra=[...a].filter(x=>!b.has(x)).length,missing=[...b].filter(x=>!a.has(x)).length,ok=!extra&&!missing;all=all&&ok;rows.push({title,ok,message:title+': совпало '+correct+' из '+b.size+'. Лишних отметок: '+extra+'; пропущено: '+missing+'.'});}
      sets('Подлежащие',actual.subjects,expected.subjects);sets('Сказуемые',actual.predicates,expected.predicates);sets('Основное действие (крестик)',actual.mainActions,expected.mainActions);
      sets('Границы оборотов',actual.turns.map(r=>r.start+':'+r.end),expected.turns.map(r=>r.start+':'+r.end));sets('Направление и концы стрелок',actual.links.map(l=>l.from+':'+l.to),expected.links.map(l=>l.from+':'+l.to));
      const isQuestionOK=value=>['что делая','как'].includes(question(value));
      const detail=actual.links.map(l=>{const e=expected.links.find(x=>x.from===l.from&&x.to===l.to),errors=[];if(!e)errors.push('Проверьте начало и конец стрелки.');else{if(!isQuestionOK(l.question))errors.push('Проверьте вопрос к добавочному действию.');for(const [name,title]of [['aspect','Вид'],['timing','Соотношение действий'],['actor','Исполнитель']])if(normalize(l[name])!==normalize(e[name]))errors.push(title+' не совпал с ключом.');}return {id:l.id,ok:errors.length===0,message:errors.length?errors.join(' '):'Вопрос, вид, связь действий и исполнитель совпали с ключом.'};});
      for(const [name,title]of [['question','Вопросы'],['aspect','Вид деепричастий'],['timing','Соотношение действий'],['actor','Исполнитель обоих действий']]){
        const correct=expected.links.filter(e=>{const l=actual.links.find(x=>x.from===e.from&&x.to===e.to);return l&&(name==='question'?isQuestionOK(l[name]):normalize(l[name])===normalize(e[name]));}).length,ok=correct===expected.links.length;all=all&&ok;rows.push({title,ok,message:title+': совпало '+correct+' из '+expected.links.length+'.'});
      }
      return {all,rows,detail};
    }
    function showComparison(){
      if(!config.key||config.key.text!==sourceText){$('results').textContent='Для этого текста нет подходящего ключа учителя.';return;}
      lastCheck=compare(model,config.key);$('results').replaceChildren(element('p',lastCheck.all?'Все части работы совпали с ключом учителя.':'Проверьте отмеченные части работы.'));const ul=document.createElement('ul');lastCheck.rows.forEach(r=>{const li=element('li',r.message);li.className=r.ok?'':'error';ul.append(li);});$('results').append(ul);lastCheck.detail.forEach(d=>{const el=$('feedback-'+d.id);if(el){el.textContent=d.message;el.classList.toggle('good',d.ok);}});
    }
    function report(){
      const lines=[student.class+' · Русский язык · Урок 17 · Деепричастные обороты','Ученик: '+student.name,'Класс: '+student.class,'Самостоятельная работа','','Исходный текст:',sourceText,'','Подлежащие: '+model.subjects.map(id=>tokens[id].word+' (слово '+(id+1)+')').join('; '),'Сказуемые: '+model.predicates.map(id=>tokens[id].word+' (слово '+(id+1)+')').join('; '),'Основное действие (крестик): '+model.mainActions.map(id=>tokens[id].word+' (слово '+(id+1)+')').join('; '),'Деепричастные обороты:'];
      model.turns.forEach((r,i)=>lines.push((i+1)+'. '+phrase(r)+' (слова '+(r.start+1)+'–'+(r.end+1)+')'));
      lines.push('','Связи, вопросы и действия:');model.links.forEach((l,i)=>lines.push((i+1)+'. '+tokens[l.from].word+' → '+tokens[l.to].word+'; вопрос: '+(l.question||'не записан')+'; вид: '+(labels.aspect[l.aspect]||'не выбран')+'; добавочное действие: '+(labels.timing[l.timing]||'не выбрано')+'; исполнитель: '+(l.actor||'не записан')));
      if(lastCheck){lines.push('','Сравнение с ключом:');lastCheck.rows.forEach(r=>lines.push(r.message));}return lines.join('\n');
    }
    document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>{tool=b.dataset.tool;pending=null;document.querySelectorAll('[data-tool]').forEach(el=>el.setAttribute('aria-pressed',el===b));renderMarks();instruction();}));
    $('undo').addEventListener('click',()=>{if(!history.length)return;model=history.pop();pending=null;clearCheck();$('undo').disabled=!history.length;save();renderMarks();renderLinks();instruction();});
    $('check-work').addEventListener('click',showComparison);
    $('student-panel').hidden=config.mode!=='student';$('mode-label').textContent='Тренажёр · самостоятельная работа';$('text-source').textContent=config.sourceNote;const title=document.createElement('p');title.className='meta';title.textContent=config.title;document.querySelector('.hero').append(title);$('source-footer').append(document.createTextNode('Источник основного текста: '));const sourceLink=document.createElement('a');sourceLink.href=config.source;sourceLink.target='_blank';sourceLink.rel='noopener';sourceLink.textContent='Русская виртуальная библиотека — И. С. Тургенев, «Лес и степь»';$('source-footer').append(sourceLink);document.title='Деепричастные обороты — '+config.title;
    initInlineQuestions();
    document.getElementById('main').hidden=false;
    document.getElementById('boot-note').hidden=true;
    $('lesson-meta').textContent=student.class+' · Русский язык · 2026–2027 · Урок 17';
    buildText();renderMarks();renderLinks();instruction();
    function cleanEditing(raw){return config.editing.map((_,i)=>{const r=Array.isArray(raw)&&raw[i]||{};return {decision:['yes','no'].includes(r.decision)?r.decision:'',solution:typeof r.solution==='string'?r.solution.slice(0,6000):'',explanation:typeof r.explanation==='string'?r.explanation.slice(0,6000):''};});}
    function editorComplete(r){return !!(r.decision&&r.solution.trim()&&r.explanation.trim());}
    function refreshProgress(){
      $('marks-progress').textContent='Подлежащих: '+model.subjects.length+' · сказуемых: '+model.predicates.length+' · крестиков: '+model.mainActions.length+' · деепричастных оборотов: '+model.turns.length+' · стрелок: '+model.links.length;
      $('editor-progress').textContent='Заполнено заданий редактора: '+editorAnswers.filter(editorComplete).length+' из '+config.editing.length;
    }
    function showStep(index,focus=false){
      activeStep=Math.max(0,Math.min(3,index));
      document.querySelectorAll('[data-step-panel]').forEach(p=>p.hidden=Number(p.dataset.stepPanel)!==activeStep);
      document.querySelectorAll('[data-step]').forEach(b=>{const on=Number(b.dataset.step)===activeStep;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
      $('step-caption').textContent=['1 / 4 · Разметка текста','2 / 4 · Вопросы и действия','3 / 4 · Редактирование предложений','4 / 4 · Итог работы'][activeStep];
      save();requestAnimationFrame(drawArrows);
      if(focus){$('tab-'+activeStep).focus();$('lesson-nav').scrollIntoView({block:'start',behavior:'auto'});}
    }
    function buildEditor(){
      $('editor-items').replaceChildren();
      config.editing.forEach((task,i)=>{
        const card=document.createElement('article');card.className='edit-card';card.dataset.exercise=i;
        card.append(element('h3','Предложение '+(i+1)),element('p',task.text));
        if(task.fact){const p=element('p',task.fact);p.className='small';card.append(p);}
        const label=element('label','Нужно ли исправление?');label.className='field';label.htmlFor='decision-'+i;
        const select=document.createElement('select');select.id=label.htmlFor;select.append(new Option('Выберите решение',''),new Option('Нужно исправить','yes'),new Option('Исправление не нужно','no'));select.value=editorAnswers[i].decision;
        select.addEventListener('change',()=>{editorAnswers[i].decision=select.value;clearCheck();save();});card.append(label,select);
        for(const [name,title]of [['solution','Запишите предложение целиком'],['explanation','Объясните своё решение']]){
          const lab=element('label',title);lab.className='field';lab.htmlFor=name+'-'+i;
          const input=document.createElement('textarea');input.id=lab.htmlFor;input.value=editorAnswers[i][name];input.spellcheck=true;
          input.addEventListener('input',()=>{editorAnswers[i][name]=input.value;clearCheck();save();});card.append(lab,input);
        }
        const feedback=element('p','');feedback.className='feedback';feedback.id='edit-feedback-'+i;feedback.setAttribute('role','status');card.append(feedback);$('editor-items').append(card);
      });
    }
    function compareEditing(){return config.editing.map((task,i)=>{
      const r=editorAnswers[i],decisionOK=r.decision===task.decision,solutionOK=task.answers.map(normalize).includes(normalize(r.solution));
      return {decisionOK,solutionOK,explanationWritten:!!r.explanation.trim(),ok:decisionOK&&solutionOK};
    });}
    function showEditing(){
      const rows=compareEditing();rows.forEach((result,i)=>{
        const r=editorAnswers[i],messages=[];
        if(!r.decision)messages.push('Выберите, нужно ли исправление.');else if(!result.decisionOK)messages.push('Пересмотрите решение о необходимости исправления.');
        if(!r.solution.trim())messages.push('Запишите предложение целиком.');else if(!result.solutionOK)messages.push('Формулировка не совпала с допустимыми вариантами. Проверьте исполнителя основного и добавочного действия, смысл и запятые. Другой правильный вариант может принять учитель.');
        if(!result.explanationWritten)messages.push('Запишите объяснение.');
        if(result.ok&&result.explanationWritten)messages.push('Решение и предложение совпали с допустимым вариантом. Объяснение проверяет учитель.');
        const f=$('edit-feedback-'+i);f.textContent=messages.join(' ');f.classList.toggle('good',result.ok&&result.explanationWritten);
      });
      $('editor-result').textContent='Решения и предложения совпали: '+rows.filter(r=>r.ok).length+' из '+rows.length+'. Объяснений записано: '+rows.filter(r=>r.explanationWritten).length+' из '+rows.length+'.';
      return rows;
    }
    function checkAll(){
      showComparison();const edits=showEditing();const completed=lastCheck.rows.filter(r=>r.ok).length;
      $('summary-result').replaceChildren();
      const overall=element('p',lastCheck.all&&edits.every(r=>r.ok&&r.explanationWritten)&&writing.text.trim()&&writing.explanation.trim()?'Все автоматически проверяемые части выполнены. Покажите объяснения учителю.':'Есть части работы, которые стоит проверить ещё раз.');overall.className='summary-lead';$('summary-result').append(overall);
      const grid=document.createElement('div');grid.className='score-grid';
      for(const [value,label]of [[completed+' / '+lastCheck.rows.length,'критериев разметки выполнено'],[edits.filter(r=>r.ok).length+' / '+edits.length,'решений редактора совпало'],[edits.filter(r=>r.explanationWritten).length+' / '+edits.length,'объяснений записано']]){
        const box=document.createElement('div');box.append(element('strong',value),element('p',label));grid.append(box);
      }
      $('summary-result').append(grid,element('p','Рассказ: '+(writing.text.trim()?'записан':'не записан')+'. Объяснение к рассказу: '+(writing.explanation.trim()?'записано':'не записано')+'. Рассказ, объяснения и иные правильные формулировки проверяет учитель.'));
      const list=document.createElement('ul');lastCheck.rows.forEach(r=>{const li=element('li',r.message);if(!r.ok)li.className='error';list.append(li);});$('summary-result').append(list);
    }
    function fullReport(){
      const lines=[report(),'','Редактирование предложений:'];
      config.editing.forEach((t,i)=>{const r=editorAnswers[i];lines.push('',(i+1)+'. '+t.text,t.fact||'','Решение: '+({yes:'Нужно исправить',no:'Исправление не нужно'}[r.decision]||'Не выбрано'),'Предложение: '+(r.solution||'Не записано'),'Объяснение: '+(r.explanation||'Не записано'));});
      if(lastCheck){const rows=compareEditing();lines.push('','Редактор — решения и предложения совпали: '+rows.filter(r=>r.ok).length+' из '+rows.length+'.','Объяснения проверяет учитель.');}
      lines.push('','Свой рассказ:','Факты: '+config.facts,writing.text||'Не записан','Объяснение к рассказу:',writing.explanation||'Не записано','Дополнительно (по желанию):',writing.extra||'Не выполнено');return lines.join('\n');
    }
    document.querySelectorAll('[data-step]').forEach(b=>{
      b.addEventListener('click',()=>showStep(Number(b.dataset.step)));
      b.addEventListener('keydown',e=>{const steps={ArrowRight:(activeStep+1)%4,ArrowLeft:(activeStep+3)%4,Home:0,End:3};if(Object.hasOwn(steps,e.key)){e.preventDefault();showStep(steps[e.key],true);}});
    });
    document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>showStep(Number(b.dataset.go),true)));
    $('check-editor').addEventListener('click',showEditing);$('check-all').addEventListener('click',checkAll);
    $('restart').addEventListener('click',()=>{
      if(!confirm('Начать работу заново? Текущие ответы будут очищены. Если нужно их сохранить, сначала скачайте файл ответов.'))return;
      model=blank();editorAnswers=cleanEditing(null);writing=cleanWriting(null);renderWriting();history=[];pending=null;tool='subject';$('undo').disabled=true;document.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool==='subject')));
      clearCheck();renderMarks();renderLinks();buildEditor();instruction();showStep(0,true);
    });
    $('save-answers').addEventListener('click',()=>download(answerFilename('json'),JSON.stringify({kind:'russian-gerund-trainer-answers',version:1,student:clone(student),text:sourceText,exerciseTexts:config.editing.map(t=>t.text),answer:clone(model),editing:clone(editorAnswers),writing:clone(writing),annotationCheck:lastCheck,editingCheck:lastCheck?compareEditing():null},null,2),'application/json;charset=utf-8'));
    $('save-text').addEventListener('click',()=>download(answerFilename('txt'),'\uFEFF'+fullReport(),'text/plain;charset=utf-8'));
    $('share-answers').addEventListener('click',async()=>{
      const button=$('share-answers'),status=$('share-message');
      const filename=answerFilename('txt'),contents='\uFEFF'+fullReport();
      const fallback=()=>{
        download(filename,contents,'text/plain;charset=utf-8');
        status.textContent='Файл ответов подготовлен для скачивания. В MAX откройте чат класса, нажмите скрепку и прикрепите «'+filename+'» из папки загрузок. Затем отправьте сообщение.';
      };
      button.disabled=true;status.textContent='';
      try{
        const file=new File([contents],filename,{type:'text/plain'});
        if(typeof navigator.share!=='function'||typeof navigator.canShare!=='function'||!navigator.canShare({files:[file]})){
          fallback();return;
        }
        await navigator.share({files:[file],title:'Русский язык · '+student.class+' · '+student.name+' — ответы'});
        status.textContent='Файл передан выбранному приложению. Проверьте, что выбран чат класса, и завершите отправку в приложении.';
      }catch(e){
        if(e.name==='AbortError')status.textContent='Передача отменена. Ответы остались в тренажёре. Можно повторить передачу или скачать файл.';
        else fallback();
      }finally{button.disabled=false;}
    });
    $('print').addEventListener('click',()=>{$('print-report').textContent=fullReport();window.print();});
    $('load-answers').addEventListener('click',()=>$('answer-file').click());
    $('answer-file').addEventListener('change',async()=>{
      const file=$('answer-file').files[0];if(!file)return;
      try{const raw=JSON.parse(await file.text());if(raw.kind!=='russian-gerund-trainer-answers'||raw.version!==1||raw.text!==sourceText||JSON.stringify(raw.exerciseTexts)!==JSON.stringify(config.editing.map(t=>t.text)))throw new Error('Этот файл ответов относится к другому заданию.');
        if(raw.student&&StudentEntry.key(raw.student)!==StudentEntry.key(student))throw new Error('Этот файл принадлежит другому ученику. Нажмите «Сменить ученика» и введите его фамилию, имя и класс.');
        model=clean(raw.answer);editorAnswers=cleanEditing(raw.editing);writing=cleanWriting(raw.writing);renderWriting();pending=null;history=[];$('undo').disabled=true;clearCheck();renderMarks();renderLinks();buildEditor();instruction();save();$('import-message').textContent='Ответы загружены. Можно продолжить работу или проверить её.';
      }catch(e){$('import-message').textContent=e.message;}$('answer-file').value='';
    });
    function cleanWriting(raw){return Object.fromEntries(['text','explanation','extra'].map(k=>[k,typeof raw?.[k]==='string'?raw[k].slice(0,6000):'']));}
    function renderWriting(){for(const [name,id]of [['text','own-text'],['explanation','own-explanation'],['extra','own-extra']])$(id).value=writing[name];}
    $('writing-facts').textContent=config.facts;renderWriting();
    for(const [name,id]of [['text','own-text'],['explanation','own-explanation'],['extra','own-extra']])$(id).addEventListener('input',()=>{writing[name]=$(id).value;clearCheck();save();});
    buildEditor();showStep(activeStep);refreshProgress();

    function syncStickyOffsets(){
      const root=document.documentElement;
      root.style.setProperty('--lesson-nav-height',Math.ceil($('lesson-nav').getBoundingClientRect().height)+'px');
      root.style.setProperty('--marking-tools-height',Math.ceil($('marking-tools').getBoundingClientRect().height)+'px');
    }
    const stickyObserver=new ResizeObserver(syncStickyOffsets);
    stickyObserver.observe($('lesson-nav'));stickyObserver.observe($('marking-tools'));syncStickyOffsets();
    new ResizeObserver(drawArrows).observe($('text-stage'));document.fonts?.ready.then(drawArrows);addEventListener('resize',drawArrows);

})().catch(()=>{
  const note=document.getElementById('boot-note');
  note.hidden=false;note.textContent='Не удалось открыть тренажёр. Обновите страницу и повторите вход.';
});
