const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// In-memory Apps Script services. Tests execute the actual deployable Code.gs.
function harness() {
  const env = {locked: false, busy: false, failSummary: false, calls: [], props: {}};
  class Sheet {
    constructor(name, id) { this.name = name; this.id = id; this.rows = []; this.formulas = new Map(); }
    getName() { return this.name; }
    getSheetId() { return this.id; }
    getMaxColumns() { return 26; }
    setFrozenRows() {}
    getLastRow() { return this.rows.length; }
    getRange(r,c,n=1,m=1) {
      const sh=this;
      return {
        getValues() { return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>sh.value(r+i,c+j))); },
        setValues(rows) {
          assert.equal(env.locked,true,'writes require the script lock');
          if(env.failSummary && sh.name==='Сводка' && r>1) { env.failSummary=false; throw Error('summary failed'); }
          rows.forEach((row,i)=>row.forEach((v,j)=>{
            if(typeof v==='string' && v.startsWith("'")) v=v.slice(1);
            sh.rows[r+i-1] ||= [];
            sh.rows[r+i-1][c+j-1]=v;
            sh.formulas.delete(`${r+i}:${c+j}`);
          }));
        },
        setFormula(formula) {
          // The two real source sheets use ru_RU; commas cause #ERROR! there.
          assert.equal(formula.includes(','),false,'ru_RU formula arguments require semicolons');
          sh.formulas.set(`${r}:${c}`,formula);
        },
      };
    }
    value(r,c) {
      if(this.formulas.has(`${r}:${c}`)) {
        const row=this.rows[r-1];
        return row[9]>0 && row[10]==='' ? '' : Number(row[7])+Number(row[10]||0);
      }
      return this.rows[r-1]?.[c-1] ?? '';
    }
  }
  const books=new Map();
  function book(id) {
    if(!books.has(id)) books.set(id,{
      sheets:new Map(),getId(){return id;},getSheetByName(n){return this.sheets.get(n);},
      insertSheet(n){const s=new Sheet(n,n==='Ответы'?1327309985:2);this.sheets.set(n,s);return s;},
    });
    return books.get(id);
  }
  env.fetch=body=>({status:'accepted',journal:'teacher',submissionId:'cloud-'+body.row[1],sourceSubmissionId:body.row[1],grading:{earnedPoints:null,maxPoints:9,needsManualReview:true}});
  const context=vm.createContext({Date,JSON,console,
    SpreadsheetApp:{openById:book,flush(){}},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>env.props[k]??null,setProperty(k,v){env.props[k]=v;},deleteProperty(k){delete env.props[k];}})},
    LockService:{getScriptLock:()=>({tryLock(){if(env.busy)return false;assert.equal(env.locked,false);env.locked=true;return true;},waitLock(){assert.equal(env.locked,false);env.locked=true;},releaseLock(){env.locked=false;}})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
    UrlFetchApp:{fetch(url,opts){assert.equal(env.locked,false,'network calls must release the lock');assert.equal(opts.followRedirects,false);const body=JSON.parse(opts.payload);env.calls.push(body);const response=env.fetch(body);return {getResponseCode:()=>response.http||200,getContentText:()=>JSON.stringify(response)};}},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../integrations/google-apps-script/Code.gs'),'utf8'),context);
  env.context=context;
  env.book=book('1cL_3oGqAyYJdod1WOTbSAUa6HvvT-wS1Tc1v3-KOogQ');
  env.post=p=>JSON.parse(context.doPost({parameter:{payload:JSON.stringify(p)}}).text);
  env.teacher=()=>{env.props.JOURNAL_MODE='teacher';env.props.KODISLOVO_JOURNAL_TOKEN='t'.repeat(40);};
  return env;
}
function payload(extra={}) { return {submission_id:'abc-1',klass:'9В',student:'Ученик',subject:'Русский язык',code:'lesson',assignment:'Урок',auto_score:5,auto_max:6,open_max:3,open_text:'Ответ',answers:{choice:['a','b'],text:'Ответ'},client_time:'2026-09-18T09:00:00Z',...extra}; }

test('receipts follow storage; pending final score stays blank; duplicates use one row',()=>{
  const h=harness();const p=payload();
  assert.equal(h.post(p).status,'accepted');
  const a=h.book.getSheetByName('Ответы');
  assert.equal(a.value(2,12),'');
  assert.equal(h.post(p).duplicate,true);
  assert.equal(a.getLastRow(),2);
  assert.equal(a.value(2,15),1);
  assert.equal(h.book.getSheetByName('Сводка').getLastRow(),2);
  a.rows[1][10]=0;
  assert.equal(h.post(p).status,'accepted');
  assert.equal(a.value(2,12),5,'explicit zero is a checked grade');
  assert.equal(h.book.getSheetByName('Сводка').value(2,11),0);
});
test('retry repairs a partial summary failure without appending an attempt',()=>{
  const h=harness();h.failSummary=true;
  assert.equal(h.post(payload()).status,'error');
  assert.equal(h.post(payload()).status,'accepted');
  assert.equal(h.book.getSheetByName('Ответы').getLastRow(),2);
  assert.equal(h.book.getSheetByName('Сводка').getLastRow(),2);
});
test('retry of an old ID cannot replace the latest attempt or mutate its answers',()=>{
  const h=harness();h.post(payload());
  h.post(payload({submission_id:'abc-2',open_text:'Новая попытка',answers:{text:'Новая попытка'}}));
  assert.equal(h.post(payload()).status,'accepted');
  assert.equal(h.book.getSheetByName('Сводка').value(2,2),'abc-2');
  assert.equal(h.post(payload({answers:{text:'Подмена'}})).status,'error');
  assert.equal(h.book.getSheetByName('Ответы').getLastRow(),3);
});
test('busy collector and malformed payloads cannot claim acceptance',()=>{
  const h=harness();h.busy=true;
  assert.equal(h.post(payload()).status,'error');h.busy=false;
  for(const patch of [{lesson_day:'01.01.2027'},{auto_score:8},{auto_max:''},{open_max:true},{answers:[]},{submission_id:''}]) assert.equal(h.post(payload(patch)).status,'error');
  assert.equal(h.book.getSheetByName('Ответы'),undefined);
});
test('unexpected headers are preserved',()=>{
  const h=harness();h.post(payload());
  const a=h.book.getSheetByName('Ответы');a.rows[0][1]='Changed';
  assert.equal(h.post(payload({submission_id:'next'})).status,'error');
  assert.equal(a.rows[0][1],'Changed');assert.equal(a.getLastRow(),2);
});
test('teacher outage keeps source for exact retry and never returns acceptance',()=>{
  const h=harness();h.teacher();const real=h.fetch;h.fetch=()=>({http:503});
  assert.equal(h.post(payload()).status,'error');
  assert.equal(h.book.getSheetByName('Ответы').getLastRow(),2);
  assert.equal(h.book.getSheetByName('Журнал сайта').value(2,6),'Ожидает передачи');
  h.fetch=real;const ok=h.post(payload());
  assert.equal(ok.journal,'teacher');assert.equal(ok.submissionId,'cloud-abc-1');
  assert.equal(h.book.getSheetByName('Ответы').getLastRow(),2);
  assert.equal(h.book.getSheetByName('Журнал сайта').value(2,7),'');
});
test('mismatched acknowledgement is rejected and refresh failure preserves last grade',()=>{
  const h=harness();h.teacher();h.fetch=()=>({status:'accepted',journal:'teacher',submissionId:'cloud',sourceSubmissionId:'wrong'});
  assert.equal(h.post(payload()).status,'error');
  h.fetch=()=>({status:'accepted',journal:'teacher',submissionId:'cloud',sourceSubmissionId:'abc-1',grading:{earnedPoints:8,maxPoints:9,needsManualReview:false}});
  assert.equal(h.post(payload()).status,'accepted');
  h.fetch=()=>({http:503});assert.equal(h.post(payload()).status,'error');
  const report=h.book.getSheetByName('Журнал сайта');
  assert.equal(report.value(2,2),'cloud');assert.equal(report.value(2,7),8);assert.ok(report.value(2,10));
});
test('batch cursor only moves after acceptance; source dates preserve UTC+5',()=>{
  const h=harness();h.post(payload());h.post(payload({submission_id:'abc-2'}));h.teacher();
  const real=h.fetch;h.fetch=b=>b.row[1]==='abc-2'?{http:503}:real(b);
  assert.throws(()=>h.context.syncNextBatch());
  const key='SYNC_ROW_'+h.book.getId();assert.equal(h.props[key],'3');
  const sent=h.calls[0].row[0];const date=h.book.getSheetByName('Ответы').rows[1][0];
  assert.ok(Math.abs((sent-25569-5/24)*86400000-date.getTime())<2);
  h.fetch=real;assert.equal(h.context.syncNextBatch().processed,1);assert.equal(h.props[key],'4');
});
test('formula-looking answers remain literal and can be retried',()=>{
  const h=harness();const p=payload({student:'=name',open_text:'=IMPORTXML("example")'});
  assert.equal(h.post(p).status,'accepted');assert.equal(h.post(p).duplicate,true);
  const a=h.book.getSheetByName('Ответы');assert.equal(a.value(2,13),p.open_text);
  assert.equal(a.formulas.has('2:13'),false);
});
