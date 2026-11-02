import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryReceipts } from '../src/deliveries.js';
import { FakeTable } from '../fixtures/fake-table.js';
test('only one worker can claim a device/event and completed receipts survive restarts',async()=>{
  const table=new FakeTable(),ready=async()=>{},a=createDeliveryReceipts(table,ready),b=createDeliveryReceipts(table,ready);
  const claims=await Promise.all([a.claim('one','event','phone'),b.claim('one','event','phone')]);
  const owner=claims.find(c=>typeof c==='object');assert.ok(owner);assert.equal(claims.filter(c=>c==='busy').length,1);
  await a.complete(owner);assert.equal(await createDeliveryReceipts(table,ready).claim('one','event','phone'),'sent');
  assert.equal(typeof await a.claim('two','event','phone'),'object');
  assert.equal(typeof await a.claim('one','event','another-phone'),'object');
});
test('an expired claim is recoverable and a stale worker cannot delete or complete its replacement',async()=>{
  const table=new FakeTable();let clock=100000;
  const receipts=createDeliveryReceipts(table,async()=>{},()=>clock);
  const old=await receipts.claim('one','event','phone');
  clock+=60001;const replacement=await receipts.claim('one','event','phone');assert.equal(typeof replacement,'object');
  await receipts.release(old);
  await assert.rejects(receipts.complete(old),{statusCode:412});
  assert.equal(await receipts.claim('one','event','phone'),'busy');
  await receipts.complete(replacement);assert.equal(await receipts.claim('one','event','phone'),'sent');
});
