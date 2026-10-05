const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function harness(){
 const h={rows:[['Дата сдачи','Итоговая отметка','Состояние','ID работы','Ученик']],props:{KODISLOVO_JOURNAL_TOKEN:'t'.repeat(40)},http:200,triggers:[],locked:false};
 h.feed={schemaVersion:'kodislovo.gradebook.v1',headers:h.rows[0],rows:[['2026-10-05T08:00:00Z',null,'Ожидает проверки','id1','=bad()']]};
 const sh={getLastRow:()=>h.rows.length,getMaxRows:()=>1000,getRange(r,c,n,m){return {getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>h.rows[r+i-1]?.[c+j-1]??'')),setValues(rows){assert(h.locked);rows.forEach((row,i)=>h.rows[r+i-1]=row.slice());},setNumberFormat(){}};}};
 const ss={getSheetByName:n=>n==='Журнал'?sh:null,setSpreadsheetTimeZone:z=>h.zone=z};
 const context=vm.createContext({Date,JSON,Map,Set,
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>h.props[k],setProperty:(k,v)=>h.props[k]=v})},
  SpreadsheetApp:{openById:()=>ss,flush(){}},LockService:{getScriptLock:()=>({waitLock(){assert(!h.locked);h.locked=true;},releaseLock(){h.locked=false;}})},
  UrlFetchApp:{fetch(url,options){assert(!h.locked);assert.equal(options.headers['X-Sheets-Token'],h.props.KODISLOVO_JOURNAL_TOKEN);return {getResponseCode:()=>h.http,getContentText:()=>JSON.stringify(h.feed)};}},
  ScriptApp:{getProjectTriggers:()=>h.triggers,newTrigger(name){return {timeBased(){return this;},everyMinutes(n){assert.equal(n,5);return this;},create(){h.triggers.push({getHandlerFunction:()=>name});}};}},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})}
 });
 for(const f of ['Code.gs','Gradebook.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../integrations/google-apps-script',f),'utf8'),context);
 h.api=context;return h;
}
test('gradebook sync upserts by ID after reordering; missing grade stays blank; formula text stays literal',()=>{
 const h=harness();assert.equal(h.api.syncGradebook().rows,1);assert.equal(h.rows[1][1],'');assert.equal(h.rows[1][4],"'=bad()");
 h.rows.push(['2026',5,'old','id2','Second']);h.rows.reverse();h.rows.unshift(h.rows.pop());
 h.feed.rows=[['2026-10-05T08:00:00Z',4,'Отметка учителя','id1','=bad()']];
 h.api.syncGradebook();assert.equal(h.rows.length,3);assert.equal(h.rows.find(r=>r[3]==='id1')[1],4);assert.equal(h.rows.find(r=>r[3]==='id2')[2],'Удалена в кабинете');
 h.api.syncGradebook();assert.equal(h.rows.length,3);assert.equal(h.zone,'Asia/Yekaterinburg');
});
test('HTTP outage, duplicate IDs or changed headers cannot overwrite the existing report',()=>{
 const h=harness();h.api.syncGradebook();const before=JSON.stringify(h.rows);h.http=503;assert.throws(()=>h.api.syncGradebook());assert.equal(JSON.stringify(h.rows),before);
 h.http=200;h.feed.rows.push(h.feed.rows[0]);assert.throws(()=>h.api.syncGradebook());assert.equal(JSON.stringify(h.rows),before);
 h.feed.rows.pop();h.feed.headers=['Other'];assert.throws(()=>h.api.syncGradebook());assert.equal(JSON.stringify(h.rows),before);
});
test('sync action requires existing secret; ordinary collector payload falls through; one timer',()=>{
 const h=harness();assert.equal(h.api.gradebookRequest_(JSON.stringify({submission_id:'student'})),null);
 const call=token=>JSON.parse(h.api.doPost({postData:{contents:JSON.stringify({action:'sync_gradebook',token})}}).text);
 assert.equal(call('wrong').status,'error');assert.equal(h.rows.length,1);
 assert.equal(call('t'.repeat(40)).status,'synced');h.api.installGradebookSync();h.api.installGradebookSync();assert.equal(h.triggers.length,1);
 assert.equal(JSON.parse(h.api.doGet().text).gradebookProtocol,'kodislovo.gradebook-sync.v1');
});
