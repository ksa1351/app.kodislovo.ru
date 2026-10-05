// Replace the old collector, do not add this beside another doPost definition.
// Default mode preserves collection in Sheets. Set JOURNAL_MODE=teacher only
// after the backend bridge and KODISLOVO_JOURNAL_TOKEN have been configured.
const DESTINATIONS = {
  "18.09.2026": "1cL_3oGqAyYJdod1WOTbSAUa6HvvT-wS1Tc1v3-KOogQ",
  "21.09.2026": "1u95beFOGWgYwN8HU6e1-bEvQnKtYwmk-vFkQ6oyH110"
};
const DEFAULT_DAY = "18.09.2026";
const HEADERS = ["Время","ID отправки","Класс","Фамилия, имя","Предмет","Код задания","Задание","Автобалл","Автомакс.","Макс. за открытую часть","Балл учителя","Итог","Открытые ответы","Все ответы (JSON)","Попытка","Статус","Время на устройстве","День урока"];
const JOURNAL_URL = "https://bbae5ggs5hjqgfo6htv8.containers.yandexcloud.net/api/internal/sheets/results";
const REPORT_HEADERS = ["ID отправки", "Номер работы в кабинете", "Класс", "Фамилия, имя", "Задание", "Состояние", "Итог в кабинете", "Максимум", "Обновлено", "Ошибка"];

function doGet() {
  return json_({service:"kodislovo-collector", version:2, receiptProtocol:"kodislovo.collector-receipt.v1",gradebookProtocol:typeof syncGradebook==='function'?'kodislovo.gradebook-sync.v1':null});
}

function doPost(e) {
  let id = "";
  try {
    const raw = (e && e.parameter && e.parameter.payload) || (e && e.postData && e.postData.contents) || "{}";
    if (raw.length > 120000) throw new Error("Слишком большой ответ");
    if(typeof gradebookRequest_==='function') { const gradebook=gradebookRequest_(raw);if(gradebook)return gradebook; }
    const p = validate_(JSON.parse(raw));
    id = p.submission_id;
    const ss = SpreadsheetApp.openById(DESTINATIONS[p.lesson_day]);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) throw new Error("Приёмщик занят. Повторите отправку с тем же ID.");
    let row, number, duplicate;
    try {
      const answers = ensureSheet_(ss, "Ответы", HEADERS);
      const summary = ensureSheet_(ss, "Сводка", HEADERS);
      number = findId_(answers, id);
      duplicate = number > 0;
      if (duplicate) {
        row = answers.getRange(number,1,1,18).getValues()[0];
        if (!matches_(row,p)) throw new Error("Этот ID уже связан с другими ответами");
      } else {
        const attempt = nextAttempt_(answers,p);
        row = [new Date(),id,p.klass,p.student,p.subject,p.code,p.assignment,p.auto_score,p.auto_max,p.open_max,"","",p.open_text,JSON.stringify(p.answers),attempt,"Отправлено",p.client_time,p.lesson_day];
        number = answers.getLastRow()+1;
        answers.getRange(number,1,1,18).setValues([row.map(literal_)]);
      }
      setTotal_(answers,number);
      // Retry also repairs a failure after appendRow but before updating summary.
      refreshSummary_(answers,summary,row);
      SpreadsheetApp.flush();
      row = answers.getRange(number,1,1,18).getValues()[0];
    } finally { lock.releaseLock(); }
    const mode = PropertiesService.getScriptProperties().getProperty("JOURNAL_MODE") || "sheets";
    if (mode !== "sheets" && mode !== "teacher") throw new Error("Неизвестный режим журнала");
    if (mode === "teacher") {
      const receipt = sendToJournal_(ss,number,row);
      if (receipt.status === "excluded_test") return json_({schemaVersion:"kodislovo.collector-receipt.v1",status:"excluded_test",sourceSubmissionId:id});
      return json_(Object.assign({schemaVersion:"kodislovo.collector-receipt.v1"},receipt));
    }
    return json_({schemaVersion:"kodislovo.collector-receipt.v1",status:"accepted",journal:"google-sheets",sourceSubmissionId:id,submissionId:id,duplicate:duplicate});
  } catch(err) {
    return json_({schemaVersion:"kodislovo.collector-receipt.v1",status:"error",sourceSubmissionId:id,message:String(err.message||err)});
  }
}

function validate_(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("Неверный формат ответа");
  const day = String(p.lesson_day || DEFAULT_DAY).trim();
  if (!Object.prototype.hasOwnProperty.call(DESTINATIONS,day)) throw new Error("Неизвестный день урока: "+day);
  const out = {lesson_day:day};
  ["submission_id","klass","student","subject","code","assignment","open_text","client_time"].forEach(k=>{out[k]=String(p[k] == null ? "" : p[k]).trim();});
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(out.submission_id)) throw new Error("Нет корректного ID отправки");
  if (!out.klass || !out.student || !out.code) throw new Error("Укажите имя, класс и код задания");
  if (out.student.length>200 || out.klass.length>40 || out.code.length>160 || out.subject.length>200 || out.assignment.length>500 || out.client_time.length>80 || out.open_text.length>40000) throw new Error("Слишком длинное поле");
  ["auto_score","auto_max","open_max"].forEach(k=>{
    if (p[k] === "" || p[k] == null || typeof p[k] === "boolean") throw new Error("Нет значения "+k);
    const n=Number(p[k]); if(!Number.isFinite(n)||n<0) throw new Error("Неверное значение "+k); out[k]=n;
  });
  if(out.auto_score>out.auto_max) throw new Error("Балл выше максимума");
  if(!p.answers || typeof p.answers!=="object" || Array.isArray(p.answers)) throw new Error("Нет объекта ответов");
  if(JSON.stringify(p.answers).length>40000) throw new Error("Слишком много ответов");
  out.answers=p.answers;
  return out;
}

function ensureSheet_(ss,name,headers) {
  let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  if(sh.getMaxColumns()<headers.length) sh.insertColumnsAfter(sh.getMaxColumns(),headers.length-sh.getMaxColumns());
  if(sh.getLastRow()===0) sh.getRange(1,1,1,headers.length).setValues([headers]);
  else {
    const got=sh.getRange(1,1,1,headers.length).getValues()[0];
    if(got.some((v,i)=>String(v)!==headers[i])) throw new Error("Структура листа «"+name+"» изменилась. Данные не перезаписаны.");
  }
  sh.setFrozenRows(1); return sh;
}
function findId_(sh,id) {
  if(sh.getLastRow()<2) return 0;
  const values=sh.getRange(2,sh.getName()==="Журнал сайта"?1:2,sh.getLastRow()-1,1).getValues();
  const index=values.findIndex(r=>String(r[0])===id); return index<0?0:index+2;
}
function sameIdentity_(row,klass,student,code) {
  return String(row[2])===klass && String(row[3]).trim().toLowerCase()===student.trim().toLowerCase() && String(row[5])===code;
}
function nextAttempt_(sh,p) {
  if(sh.getLastRow()<2) return 1;
  return 1+sh.getRange(2,1,sh.getLastRow()-1,18).getValues().filter(r=>sameIdentity_(r,p.klass,p.student,p.code)).length;
}
function canonical_(v) {
  if(Array.isArray(v)) return v.map(canonical_);
  if(v && typeof v==="object") return Object.keys(v).sort().reduce((a,k)=>{a[k]=canonical_(v[k]);return a;},Object.create(null));
  return v;
}
function matches_(r,p) {
  return sameIdentity_(r,p.klass,p.student,p.code) && String(r[12]||"").trim()===p.open_text && Number(r[7])===p.auto_score && Number(r[8])===p.auto_max && Number(r[9])===p.open_max && JSON.stringify(canonical_(JSON.parse(r[13])))===JSON.stringify(canonical_(p.answers));
}
function literal_(v) {
  // Text beginning with '=' must never turn into a spreadsheet formula.
  return typeof v==="string" && /^[=+@-]/.test(v) ? "'"+v : v;
}
function setTotal_(sh,r) {
  // Both registered spreadsheets use ru_RU: formula arguments need semicolons.
  sh.getRange(r,12).setFormula(`=IF(AND(J${r}>0;K${r}="");"";H${r}+IF(K${r}="";0;K${r}))`);
}
function refreshSummary_(answers,summary,row) {
  const rows=answers.getRange(2,1,answers.getLastRow()-1,18).getValues();
  const latest=rows.filter(r=>sameIdentity_(r,String(row[2]),String(row[3]),String(row[5]))).pop();
  let target=0;
  if(summary.getLastRow()>1) {
    const values=summary.getRange(2,1,summary.getLastRow()-1,18).getValues();
    const i=values.findIndex(r=>sameIdentity_(r,String(row[2]),String(row[3]),String(row[5])));if(i>=0)target=i+2;
  }
  if(!target) target=summary.getLastRow()+1;
  const out=latest.slice();out[15]="Последняя попытка";out[11]="";
  summary.getRange(target,1,1,18).setValues([out.map(literal_)]);setTotal_(summary,target);
}

function sourceRow_(row) {
  return row.map(v=>v instanceof Date ? (v.getTime()/86400000+25569+5/24) : v);
}
function sendToJournal_(ss,number,row) {
  const token=PropertiesService.getScriptProperties().getProperty("KODISLOVO_JOURNAL_TOKEN");
  if(!token || token.length<32) throw new Error("Запись сохранена в таблице. Связь с кабинетом ещё не настроена.");
  let receipt;
  try {
    const response=UrlFetchApp.fetch(JOURNAL_URL,{method:"post",contentType:"application/json",headers:{"X-Sheets-Token":token},payload:JSON.stringify({spreadsheetId:ss.getId(),sheetId:ss.getSheetByName("Ответы").getSheetId(),rowNumber:number,row:sourceRow_(row)}),muteHttpExceptions:true,followRedirects:false});
    if(response.getResponseCode()!==200) throw new Error("Кабинет временно не принял запись (HTTP "+response.getResponseCode()+"). Повторите отправку.");
    receipt=JSON.parse(response.getContentText());
    if(receipt.status!=="excluded_test" && (receipt.status!=="accepted" || receipt.journal!=="teacher" || receipt.sourceSubmissionId!==String(row[1]) || !receipt.submissionId)) throw new Error("Нет подтверждения из кабинета");
  } catch(err) { writeReport_(ss,row,null,String(err.message||err)); throw err; }
  writeReport_(ss,row,receipt,"");return receipt;
}
function writeReport_(ss,row,receipt,error) {
  const lock=LockService.getScriptLock();lock.waitLock(25000);
  try {
    const sh=ensureSheet_(ss,"Журнал сайта",REPORT_HEADERS);
    const r=findId_(sh,String(row[1])) || sh.getLastRow()+1;
    // A refresh failure must not erase the last confirmed journal ID or grade.
    if(error && r<=sh.getLastRow()) {
      const previous=sh.getRange(r,1,1,10).getValues()[0];
      if(previous[1]) {
        previous[9]=error;
        sh.getRange(r,1,1,10).setValues([previous.map(literal_)]);
        SpreadsheetApp.flush();return;
      }
    }
    const g=receipt && receipt.grading;
    const state=error ? "Ожидает передачи" : receipt.status==="excluded_test" ? "Техническая запись" : g && g.needsManualReview ? "Ожидает проверки" : "Проверено";
    sh.getRange(r,1,1,10).setValues([[row[1],receipt && receipt.submissionId || "",row[2],row[3],row[6],state,g && g.earnedPoints!=null?g.earnedPoints:"",g?g.maxPoints:"",new Date(),error].map(literal_)]);
    SpreadsheetApp.flush();
  } finally {lock.releaseLock();}
}

// Run manually after deploying the bridge. Each call transfers/refreshes at most
// ten historical records; repeats also refresh the site's manual grades report.
function syncNextBatch() {
  const props=PropertiesService.getScriptProperties();
  if(props.getProperty("JOURNAL_MODE")!=="teacher") throw new Error("Сначала настройте JOURNAL_MODE=teacher");
  let processed=0;
  for(const day of Object.keys(DESTINATIONS)) {
    const ss=SpreadsheetApp.openById(DESTINATIONS[day]);
    const lock=LockService.getScriptLock();lock.waitLock(25000);
    let sh;
    try { sh=ensureSheet_(ss,"Ответы",HEADERS); }
    finally { lock.releaseLock(); }
    const key="SYNC_ROW_"+ss.getId();let r=Math.max(2,Number(props.getProperty(key)||2));
    while(r<=sh.getLastRow() && processed<10) {
      sendToJournal_(ss,r,sh.getRange(r,1,1,18).getValues()[0]);
      props.setProperty(key,String(++r));processed++;
    }
    if(processed>=10) break;
  }
  return {processed:processed};
}
function restartReportRefresh() {
  const props=PropertiesService.getScriptProperties();
  Object.values(DESTINATIONS).forEach(id=>props.deleteProperty("SYNC_ROW_"+id));
  return syncNextBatch();
}
function repairFormulasAndSummary() {
  const lock=LockService.getScriptLock();lock.waitLock(25000);
  try {
    Object.values(DESTINATIONS).forEach(id=>{
      const ss=SpreadsheetApp.openById(id),a=ensureSheet_(ss,"Ответы",HEADERS),s=ensureSheet_(ss,"Сводка",HEADERS);
      if(a.getLastRow()<2)return;
      const rows=a.getRange(2,1,a.getLastRow()-1,18).getValues();
      rows.forEach((row,i)=>{setTotal_(a,i+2);refreshSummary_(a,s,row);});
    });SpreadsheetApp.flush();
  } finally {lock.releaseLock();}
}
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
