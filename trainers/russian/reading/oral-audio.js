(function(root){
  'use strict';
  const MAX=2500000,API='https://bbae5ggs5hjqgfo6htv8.containers.yandexcloud.net';
  async function mount(profile){
    const key='oral:'+JSON.stringify(profile);
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('kodislovo-audio',1);r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Разрешите сохранение данных в браузере для записи аудио.'));});
    function stored(mode,value){return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',mode==='get'?'readonly':'readwrite'),s=tx.objectStore('drafts');const r=mode==='get'?s.get(key):mode==='delete'?s.delete(key):s.put(value,key);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(Error('Не удалось сохранить аудио на устройстве. Освободите место и повторите.'));tx.onabort=()=>reject(Error('Сохранение аудио прервано.'));});}
    let draft=await stored('get'),recorder=null,stream=null,timer=null,url='',saving=false,starting=false;
    const box=document.createElement('section');box.className='kd-panel reading-panel oral-audio';
    box.innerHTML='<h2>Аудиоответ учителю</h2><p>Запишите ответ, прослушайте его и отправьте вместе с работой. Перед записью назовите задание: чтение, пересказ, монолог или диалог. Можно записать несколько частей подряд.</p><div style="display:flex;flex-wrap:wrap;gap:10px"><button type="button" class="kd-button" data-action="start">Начать запись</button><button type="button" class="kd-button kd-button-secondary" data-action="stop" disabled>Остановить</button><button type="button" class="kd-button kd-button-secondary" data-action="remove">Удалить запись</button></div><p><label>Или загрузите готовый аудиофайл<input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg" style="display:block;max-width:100%;margin-top:8px"></label></p><p>Одна запись до 10 минут или файл до 2,5 МБ. Новая запись заменяет предыдущую после остановки.</p><audio controls hidden style="width:100%;max-width:100%"></audio><p role="status" aria-live="polite"></p>';
    document.querySelector('#step-reading').before(box);
    const player=box.querySelector('audio'),status=box.querySelector('[role=status]'),start=box.querySelector('[data-action=start]'),stop=box.querySelector('[data-action=stop]'),remove=box.querySelector('[data-action=remove]'),input=box.querySelector('input');
    const busy=()=>starting||saving||(recorder&&recorder.state!=='inactive');
    function controls(){start.disabled=!!busy();stop.disabled=!recorder||recorder.state!=='recording';remove.disabled=!!busy()||!draft;input.disabled=!!busy();}
    function show(){if(url)URL.revokeObjectURL(url);url=draft?URL.createObjectURL(draft.blob):'';player.hidden=!draft;if(draft){player.src=url;status.textContent='Аудио сохранено на этом устройстве. Для передачи учителю нажмите «Отправить учителю».';}else{player.removeAttribute('src');player.load();status.textContent='Аудиоответ пока не записан.';}controls();}
    async function save(blob){
      saving=true;controls();
      try{
        if(!blob.size||blob.size>MAX)throw Error('Файл должен быть не больше 2,5 МБ. Запишите более короткий ответ или выберите другой файл.');
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
        const next={blob,sha256:hash,size:blob.size};await stored('put',next);draft=next;show();
      }finally{saving=false;controls();}
    }
    function release(){clearTimeout(timer);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;}
    start.addEventListener('click',async()=>{
      starting=true;controls();status.textContent='Разрешите доступ к микрофону…';
      try{
        if(!navigator.mediaDevices?.getUserMedia||!root.MediaRecorder)throw Error('В этом браузере запись недоступна. Загрузите готовый аудиофайл.');
        stream=await navigator.mediaDevices.getUserMedia({audio:true});
        const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
        recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:24000});
        const chunks=[];let size=0,failed=false;
        recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);size+=e.data.size;if(size>MAX&&recorder.state==='recording')recorder.stop();}};
        recorder.onerror=()=>{failed=true;saving=false;status.textContent='Запись прервана. Повторите запись или загрузите файл.';release();controls();};
        recorder.onstop=async()=>{release();if(failed){controls();return;}try{await save(new Blob(chunks,{type:recorder.mimeType||mime||'audio/webm'}));}catch(e){status.textContent=e.message;}controls();};
        recorder.start(1000);timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},600000);
        status.textContent='Идёт запись. Закончив ответ, нажмите «Остановить».';
      }catch(e){release();status.textContent=e.name==='NotAllowedError'?'Нет доступа к микрофону. Разрешите его в браузере или загрузите готовый файл.':e.message;}
      finally{starting=false;controls();}
    });
    stop.addEventListener('click',()=>{if(recorder?.state==='recording'){saving=true;controls();recorder.stop();}});
    input.addEventListener('change',async()=>{const file=input.files[0];if(!file)return;try{await save(file);}catch(e){status.textContent=e.message;}input.value='';});
    async function clear(){await stored('delete');draft=null;show();}
    remove.addEventListener('click',async()=>{try{await clear();}catch(e){status.textContent=e.message;}});
    window.addEventListener('beforeunload',e=>{if(busy()){e.preventDefault();e.returnValue='';}});
    show();
    return {has:()=>!!draft,busy,clear,descriptor:async()=>{if(busy())throw Error('Сначала остановите запись и дождитесь её сохранения.');return draft?{sha256:draft.sha256,size:draft.size}:null;},upload:async payload=>{
      const audio=payload.result.audio;if(!audio)return;
      if(!draft||draft.sha256!==audio.sha256)throw Error('Не найдено аудио этой отправки на устройстве. Вернитесь в браузер, где записывали ответ.');
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),85000);
      try{
        const response=await fetch(API+'/api/public/practice/oral/audio/'+encodeURIComponent(payload.submission_id)+'/'+audio.sha256,{method:'POST',body:draft.blob,headers:{'Content-Type':'application/octet-stream'},credentials:'omit',signal:controller.signal});
        const data=await response.json();if(!response.ok){const error=Error(data.error?.message||'Не удалось загрузить аудио. Повторите отправку.');error.status=response.status;throw error;}
        if(data.sha256!==audio.sha256||data.size!==audio.size)throw Error('Не получено подтверждение загрузки аудио. Повторите отправку.');
      }catch(e){if(e.name==='AbortError'||e instanceof TypeError||e instanceof SyntaxError)throw Error('Загрузка аудио прервалась. Запись сохранена на устройстве — повторите отправку.');throw e;}finally{clearTimeout(timeout);}
    }};
  }
  root.OralAudio={mount};
})(globalThis);
