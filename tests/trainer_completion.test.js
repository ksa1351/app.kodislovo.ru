const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const lesson=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../trainers/data/russian/9/lesson-013.json'),'utf8'));
async function setup(){
 const storage=await import('../trainers/shared/storage.js'),results=await import('../trainers/shared/results.js'),submitter=await import('../trainers/shared/submitter.js');
 const state=storage.newDraft(lesson,'QA','9');state.pending=results.buildResult(lesson,state);
 const receipt={schemaVersion:'kodislovo.collector-receipt.v1',trainerSchemaVersion:2,status:'accepted',journal:'teacher',sourceSubmissionId:state.pending.submission_id,submissionId:'server-id',trainerGrading:{automatic:{earned:0,max:13},manualGroups:[]}};
 return {state,receipt,submitter};
}
test('confirmed acceptance survives failed local receipt persistence without another POST',async()=>{
 const {state,receipt,submitter}=await setup();let posts=0,saves=0;
 const fetcher=async()=>{posts++;return {ok:true,json:async()=>receipt}};
 const save=()=>{if(++saves>1)throw Error('disk full')};
 assert.equal(await submitter.submitResult('https://qa',state,save,fetcher),receipt);
 assert.equal(await submitter.submitResult('https://qa',state,save,fetcher),receipt);assert.equal(posts,1);
});
test('failure before network keeps editability; invalid stored receipt retries original snapshot',async()=>{
 const {state,receipt,submitter}=await setup();const original=JSON.stringify(state.pending);let posts=0;
 const fetcher=async()=>{posts++;return {ok:true,json:async()=>receipt}};
 await assert.rejects(submitter.submitResult('https://qa',state,()=>{throw Error('storage')},fetcher),/storage/);
 assert.equal(posts,0);assert(!state.transportStarted);
 state.receipt={status:'accepted'};
 await submitter.submitResult('https://qa',state,()=>{},fetcher);
 assert.equal(posts,1);assert.equal(JSON.stringify(state.pending),original);assert.equal(state.receipt,receipt);
});
