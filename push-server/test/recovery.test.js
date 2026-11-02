import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const sandbox={setTimeout,Promise};vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../../app-recovery.js',import.meta.url),'utf8'),sandbox);
const {singleFlight,createScheduleLoader,createPushRefresh,scheduleErrorMessage}=sandbox;
test('startup retries transient wake-up failures while sharing concurrent requests',async()=>{
  let count=0;const waits=[];
  const load=createScheduleLoader(async()=>{if(++count<3)throw {status:503};return 'schedule';},async ms=>waits.push(ms));
  assert.deepEqual(await Promise.all([load(),load()]),['schedule','schedule']);
  assert.equal(count,3);assert.deepEqual(waits,[500,1000]);
});
test('permission failures do not retry, and persistent network failures stop after three attempts',async()=>{
  for(const status of [401,403]){
    let count=0;const load=createScheduleLoader(async()=>{count++;throw {status};},async()=>{throw Error('unexpected wait');});
    await assert.rejects(load(),{status});assert.equal(count,1);
  }
  let count=0;const load=createScheduleLoader(async()=>{count++;throw {name:'TypeError'};},async()=>{});
  await assert.rejects(load());assert.equal(count,3);
});
test('the startup guard resets after failures rather than getting stuck on the rejected promise',async()=>{
  let count=0;const start=singleFlight(async()=>{if(++count===1)throw Error('offline');return 'ready';});
  await assert.rejects(start());assert.equal(await start(),'ready');assert.equal(count,2);
});
test('notification refresh updates data once and preserves drafts started during the request',async()=>{
  let finish,editing=false,loads=0,applied=0;
  const refresh=createPushRefresh({isReady:()=>true,isEditing:()=>editing,load:()=>{loads++;return new Promise(resolve=>{finish=resolve;});},apply:()=>{applied++;},onError:()=>assert.fail('unexpected error')});
  const first=refresh(),second=refresh();await Promise.resolve();editing=true;finish('new schedule');
  assert.deepEqual(await Promise.all([first,second]),[false,false]);assert.equal(loads,1);assert.equal(applied,0);
  editing=false;const next=refresh();await Promise.resolve();finish('new schedule');assert.equal(await next,true);assert.equal(applied,1);
});
test('startup errors explain recovery without exposing raw Microsoft codes',()=>{
  assert.match(scheduleErrorMessage({status:403,message:'secret identifier'}),/does not have access/);
  assert.match(scheduleErrorMessage({errorCode:'interaction_in_progress',message:'long stack'}),/sign-in/);
  assert.doesNotMatch(scheduleErrorMessage({message:'500 long server code'}),/500|server code/);
});
