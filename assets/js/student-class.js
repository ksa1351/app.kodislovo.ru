(function(root){
  'use strict';
  function normalize(value){
    const text=String(value||'').normalize('NFKC').trim();
    const compact=text.replace(/[\s«»"“”]/g,'').replace(/класс$/i,'');
    const match=/^(1[01]|[1-9])([а-яё]?)$/iu.exec(compact);
    if(!match)return text;
    return match[1]+(match[2]?match[2].toLocaleUpperCase('ru'):match[1]==='7'?'Б':'');
  }
  function valid(value){return /^(1[01]|[1-9])[А-ЯЁ]$/u.test(normalize(value));}
  root.StudentClass={normalize,valid};
  if(typeof module!=='undefined')module.exports=root.StudentClass;
  if(typeof document==='undefined')return;
  const selector='input#klass,input#studentClass,input#cls,input[name="klass"],input[name="className"]';
  function decorate(){document.querySelectorAll(selector).forEach(input=>{
    if(input.dataset.classFormat)return;input.dataset.classFormat='true';
    input.placeholder='Например, 7Б';input.title='Номер класса и русская буква: 7Б, 9В, 11А';
    input.pattern='(?:[1-9]|10|11)[А-Яа-яЁё]';input.maxLength=30;
    const hint=document.createElement('small');hint.textContent='Номер и русская буква: 7Б, 9В, 11А.';hint.style.display='block';input.after(hint);
    input.addEventListener('blur',()=>{input.value=normalize(input.value);input.setCustomValidity(input.value&&!valid(input.value)?input.title:'');});
    input.addEventListener('input',()=>input.setCustomValidity(''));
  });}
  function check(scope){
    let inputs=[...scope.querySelectorAll(selector)];if(!inputs.length)inputs=[...document.querySelectorAll(selector)];
    for(const input of inputs){if(input.disabled||input.offsetParent===null)continue;
      input.value=normalize(input.value);input.setCustomValidity(valid(input.value)?'':input.title);
      if(!input.reportValidity())return false;
    }return true;
  }
  document.addEventListener('submit',event=>{if(!check(event.target)){event.preventDefault();event.stopImmediatePropagation();}},true);
  document.addEventListener('click',event=>{const button=event.target.closest('button,input[type=submit]');if(!button)return;
    if(/начать|продолжить|отправить|сдать/i.test(button.textContent||button.value||'')){
      if(!check(button.closest('form')||document)){event.preventDefault();event.stopImmediatePropagation();}
    }
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches(selector)){event.target.value=normalize(event.target.value);}},true);
  new MutationObserver(decorate).observe(document.documentElement,{childList:true,subtree:true});decorate();
})(globalThis);
