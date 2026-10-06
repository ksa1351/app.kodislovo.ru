(async function(){
  'use strict';
  const $=id=>document.getElementById(id),student=await PracticeDelivery.identity('informatics-oge1');
  const key='kodislovo:informatics:oge1:'+JSON.stringify(student);
  let answers={};try{answers=JSON.parse(localStorage.getItem(key))||{};}catch(_){}
  let index=0;
  function save(){try{localStorage.setItem(key,JSON.stringify(answers));}catch(_){$('feedback').textContent='Не удалось сохранить черновик. Не закрывайте страницу.';}}
  function stats(){$('scoreAttempts').textContent='Ответов: '+Object.values(answers).filter(v=>v.trim()).length;$('scoreCorrect').textContent='Проверяет учитель';}
  function load(n){index=(n+tasks.length)%tasks.length;const task=tasks[index];$('taskProgress').textContent=`Задача ${task.num} из ${tasks.length}`;$('taskCode').textContent='Код: '+task.code;$('taskText').textContent=task.text;$('answerInput').value=answers[String(task.num)]||'';$('jumpSelect').value=String(index);$('feedback').textContent='';}
  function record(){answers[String(tasks[index].num)]=$('answerInput').value.trim();save();stats();$('feedback').textContent='Ответ сохранён в черновике. После выполнения задач нажмите «Отправить учителю».';}
  tasks.forEach((task,n)=>{const o=document.createElement('option');o.value=n;o.textContent=`${task.num} (${task.code})`;$('jumpSelect').append(o);});
  $('answerInput').addEventListener('input',()=>{answers[String(tasks[index].num)]=$('answerInput').value;save();stats();});
  $('answerInput').addEventListener('keydown',e=>{if(e.key==='Enter')record();});
  $('checkBtn').addEventListener('click',record);$('prevBtn').addEventListener('click',()=>load(index-1));$('nextBtn').addEventListener('click',()=>load(index+1));$('randomBtn').addEventListener('click',()=>load(Math.floor(Math.random()*tasks.length)));$('jumpSelect').addEventListener('change',()=>load(Number($('jumpSelect').value)));
  $('showAnswerBtn').addEventListener('click',()=>{$('feedback').textContent='Ответы проверяет учитель. В работу войдут задачи, для которых вы записали ответ.';});
  load(0);stats();PracticeDelivery.mount({kind:'informatics-oge1',student,build:()=>({tasks:Object.entries(answers).filter(([,answer])=>answer.trim()).map(([id,answer])=>({id,answer}))}),ready:()=>Object.values(answers).some(v=>v.trim()),onNew:()=>localStorage.removeItem(key)});
})().catch(error=>{document.getElementById('feedback').textContent=error.message;});
