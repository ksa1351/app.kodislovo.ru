const {test}=require('node:test'),assert=require('node:assert/strict');
const {send}=require('../trainers/russian/summary-trainer/summary-delivery.js');
const payload={submission_id:'summary-test-0001',revision:1};
test('Summary requires exact receipt; old success messages never confirm delivery',async()=>{
 const good={schemaVersion:'kodislovo.summary-receipt.v1',status:'accepted',journal:'teacher',submissionId:'server-id',sourceSubmissionId:payload.submission_id,revision:1};
 assert.equal((await send('/submit',payload,async()=>new Response(JSON.stringify(good)))).submissionId,'server-id');
 for(const body of [{ok:true},{...good,revision:2},{...good,sourceSubmissionId:'wrong'},{...good,journal:'sheet'}])await assert.rejects(()=>send('/submit',payload,async()=>new Response(JSON.stringify(body))),/не подтвердил/);
 await assert.rejects(()=>send('/submit',payload,async()=>{throw new TypeError('Network failed');}),/повторите отправку/);
 try{await send('/submit',payload,async()=>new Response(JSON.stringify({error:{message:'Проверьте имя'}}),{status:400}));assert.fail();}catch(e){assert.equal(e.safeToEdit,true);}
});
