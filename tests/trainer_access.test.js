const test=require('node:test'),assert=require('node:assert/strict');
const access=import('../trainers/shared/access.js');
const lesson={id:'russian.9.lesson-013',version:'1.0.0'};
const reply=enabled=>({schemaVersion:'kodislovo.trainer-access.v1',packId:lesson.id,packVersion:lesson.version,enabled});

test('trainer access uses a fresh credential-free request and distinguishes open/closed',async()=>{
 const {trainerAccess}=await access;
 for(const enabled of [true,false]){
  assert.equal(await trainerAccess(lesson,async(url,options)=>{
   assert(url.endsWith('/api/public/trainers/russian.9.lesson-013/1.0.0/access'));
   assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');
   return new Response(JSON.stringify(reply(enabled)));
  }),enabled);
 }
});

test('network errors and incorrect access replies never grant entry',async()=>{
 const {trainerAccess}=await access;
 for(const fetcher of [
  async()=>{throw new TypeError('network');},
  async()=>new Response('unavailable',{status:503}),
  async()=>new Response('not JSON'),
  ...[{...reply(true),enabled:'true'},{...reply(true),packId:'other'},{...reply(true),packVersion:'old'},{...reply(true),schemaVersion:'other'}].map(value=>async()=>new Response(JSON.stringify(value)))
 ])await assert.rejects(trainerAccess(lesson,fetcher),/Не удалось проверить доступ/);
});
