const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../assets/js/lesson-submitter.js'),'utf8');
const url='https://script.google.com/macros/s/deployment-test/exec';
const payload=(id='first')=>({submission_id:id,student:'Ученик',klass:'9В',code:'lesson',auto_score:1,auto_max:2,open_max:3,answers:{x:['a','b']},client_time:id});
function harness(storage=new Map()) {
  const h={calls:[],storage};
  h.reply=p=>({schemaVersion:'kodislovo.collector-receipt.v1',status:'accepted',journal:'teacher',sourceSubmissionId:p.submission_id,submissionId:'cloud-id'});
  const root={AbortController,URLSearchParams,setTimeout,clearTimeout,TypeError,
    localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){storage.set(k,v);}},
    async fetch(u,opts){const p=JSON.parse(opts.body.get('payload'));h.calls.push(p);return {ok:true,json:async()=>h.reply(p)};},
  };
  vm.runInNewContext(code,root);h.api=root.KodislovoLessonSubmitter;h.root=root;return h;
}
test('network loss then reload retries exact original ID and answers once',async()=>{
  const h=harness();h.reply=()=>{throw new TypeError('Network');};
  await assert.rejects(h.api.submit(url,payload()));
  const next=harness(h.storage);const input={...payload('new-random-id'),answers:{x:['changed']}};
  const receipt=await next.api.submit(url,input);
  assert.equal(next.calls[0].submission_id,'first');
  assert.deepEqual(next.calls[0].answers,{x:['a','b']});
  assert.equal(receipt.usedSavedAnswers,true);assert.equal(input.submission_id,'first');
  assert.equal(JSON.parse([...h.storage.values()][0]).status,'accepted');
});
test('accepted unchanged work uses receipt; changed work becomes a new attempt',async()=>{
  const h=harness();await h.api.submit(url,payload());
  await h.api.submit(url,payload('unused-id'));assert.equal(h.calls.length,1);
  await h.api.submit(url,{...payload('second'),answers:{x:['c']}});
  assert.equal(h.calls.length,2);assert.equal(h.calls[1].submission_id,'second');
});
test('plain OK, Sheets-only success and wrong-ID receipts never count as accepted',async()=>{
  for(const response of ['OK',{status:'error',message:'failed'},{schemaVersion:'kodislovo.collector-receipt.v1',status:'accepted',journal:'google-sheets',sourceSubmissionId:'first',submissionId:'first'},{schemaVersion:'kodislovo.collector-receipt.v1',status:'accepted',journal:'teacher',sourceSubmissionId:'other',submissionId:'cloud'}]) {
    const h=harness();h.reply=()=>response;
    await assert.rejects(h.api.submit(url,payload()));
    assert.equal(JSON.parse([...h.storage.values()][0]).status,'pending');
  }
});
test('blocked storage prevents sending without a durable retry ID',async()=>{
  const h=harness();h.root.localStorage.setItem=()=>{throw Error('Quota');};
  await assert.rejects(h.api.submit(url,payload()));assert.equal(h.calls.length,0);
});
test('parallel clicks and different students remain isolated',async()=>{
  const h=harness();await Promise.all([h.api.submit(url,payload()),h.api.submit(url,payload('other-id'))]);
  assert.equal(h.calls.length,1);
  await h.api.submit(url,{...payload('student-2'),student:'Другой ученик'});
  assert.equal(h.calls.length,2);assert.equal(h.storage.size,2);
});
