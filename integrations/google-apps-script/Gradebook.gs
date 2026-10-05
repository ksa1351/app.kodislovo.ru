// Add this file to the existing collector project. No credentials go in this file.
const GRADEBOOK_ID = '1eQ1VjuEqWk3HklSv6ul8rRcg5nmLlu_t-ql1Er0C4Lc';
const GRADEBOOK_FEED = 'https://bbae5ggs5hjqgfo6htv8.containers.yandexcloud.net/api/internal/sheets/gradebook';

function gradebookRequest_(raw) {
  try {
    const request=JSON.parse(raw);
    if(request.action!=='sync_gradebook')return null;
    const token=PropertiesService.getScriptProperties().getProperty('KODISLOVO_JOURNAL_TOKEN')||'';
    const supplied=typeof request.token==='string'?request.token:'';
    let diff=token.length^supplied.length;
    for(let i=0;i<token.length;i++)diff|=token.charCodeAt(i)^(supplied.charCodeAt(i)||0);
    if(token.length<32 || diff!==0)throw new Error('Нет доступа');
    return json_(syncGradebook());
  }catch(error){return json_({schemaVersion:'kodislovo.gradebook-sync.v1',status:'error',message:String(error.message||error)});}
}

function syncGradebook() {
  const token=PropertiesService.getScriptProperties().getProperty('KODISLOVO_JOURNAL_TOKEN');
  if(!token || token.length<32)throw new Error('Не настроена связь с кабинетом');
  const response=UrlFetchApp.fetch(GRADEBOOK_FEED,{headers:{'X-Sheets-Token':token},muteHttpExceptions:true,followRedirects:false});
  if(response.getResponseCode()!==200)throw new Error('Кабинет временно недоступен. Журнал не изменён.');
  const data=JSON.parse(response.getContentText());
  if(data.schemaVersion!=='kodislovo.gradebook.v1' || !Array.isArray(data.headers) || !Array.isArray(data.rows))throw new Error('Некорректный ответ кабинета');
  const idColumn=data.headers.indexOf('ID работы'),stateColumn=data.headers.indexOf('Состояние');
  if(idColumn<0 || stateColumn<0)throw new Error('Не найдены служебные колонки журнала');
  const incoming=new Set();
  data.rows.forEach(row=>{if(row.length!==data.headers.length || !row[idColumn] || incoming.has(row[idColumn]))throw new Error('Некорректные или повторные ID');incoming.add(row[idColumn]);});
  const lock=LockService.getScriptLock();lock.waitLock(25000);
  try {
    const ss=SpreadsheetApp.openById(GRADEBOOK_ID),sh=ss.getSheetByName('Журнал');
    if(!sh)throw new Error('Не найден лист Журнал');
    ss.setSpreadsheetTimeZone('Asia/Yekaterinburg');
    const headers=sh.getRange(1,1,1,data.headers.length).getValues()[0];
    if(headers.some((v,i)=>v!==data.headers[i]))throw new Error('Заголовки журнала изменены. Верните названия колонок.');
    const old=sh.getLastRow()>1?sh.getRange(2,1,sh.getLastRow()-1,data.headers.length).getValues():[];
    const positions=new Map();old.forEach((row,i)=>{if(row[idColumn]){if(positions.has(String(row[idColumn])))throw new Error('Повторный ID в журнале');positions.set(String(row[idColumn]),i);}});
    const rows=old.map(row=>row.slice());
    data.rows.forEach(source=>{
      const row=source.map((v,i)=>i===0?new Date(v):v==null?'':literal_(v));
      const id=String(source[idColumn]);
      if(positions.has(id))rows[positions.get(id)]=row;
      else{positions.set(id,rows.length);rows.push(row);}
    });
    old.forEach((row,i)=>{if(row[idColumn] && !incoming.has(String(row[idColumn])))rows[i][stateColumn]='Удалена в кабинете';});
    if(sh.getMaxRows()<rows.length+1)sh.insertRowsAfter(sh.getMaxRows(),rows.length+1-sh.getMaxRows());
    if(rows.length)sh.getRange(2,1,rows.length,data.headers.length).setValues(rows);
    sh.getRange(2,1,Math.max(rows.length,1),1).setNumberFormat('dd.MM.yyyy HH:mm');
    ss.setSpreadsheetTimeZone('Asia/Yekaterinburg');
    PropertiesService.getScriptProperties().setProperty('GRADEBOOK_LAST_SYNC',new Date().toISOString());
    SpreadsheetApp.flush();
    return {schemaVersion:'kodislovo.gradebook-sync.v1',status:'synced',spreadsheetId:GRADEBOOK_ID,rows:data.rows.length};
  }finally{lock.releaseLock();}
}

// Run once in the Apps Script editor after publishing the new version.
function installGradebookSync() {
  const result=syncGradebook();
  if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='syncGradebook'))
    ScriptApp.newTrigger('syncGradebook').timeBased().everyMinutes(5).create();
  return result;
}
