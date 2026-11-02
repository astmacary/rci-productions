import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers, endpoint, subscription, notification } from '../src/core.js';
import { createDeliveryReceipts } from '../src/deliveries.js';
import { FakeTable } from '../fixtures/fake-table.js';
const app = { id: 'one', site: 'example.sharepoint.com:/sites/one', baseUrl: 'https://one.example/' };
const sub = { endpoint: 'https://web.push.apple.com/device', keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') } };
function setup(send) {
  const rows = new Map(), delivered = [], graphCalls = [];
  const h = createHandlers({ apps: { one: app, two: { ...app, id: 'two' } }, publicKey: 'public', deliveries: createDeliveryReceipts(new FakeTable(), async () => {}),
    table: {
      get: async (p,r) => rows.get(p + r), put: async row => rows.set(row.partitionKey + row.rowKey, row),
      remove: async (p,r) => rows.delete(p + r),
      find: async (p, emails) => [...rows.values()].filter(r => r.partitionKey === p && (emails.includes(r.email) || emails.includes(r.principal)))
    },
    send: async (s,p) => { if (send) await send(s,p); delivered.push([s,p]); },
    graph: async path => { graphCalls.push(path); return { id: 'user-1', mail: 'Member@Example.com', userPrincipalName: 'member_example.com#EXT#@tenant.onmicrosoft.com' }; }
  });
  return { h, rows, delivered, graphCalls };
}
const req = { headers: new Headers({ authorization: 'Bearer verified-by-graph' }) };
const body = { appId: 'one', recipients: ['member@example.com'], title: 'Schedule request', body: 'Open the app.', eventId: 'row-12:version-2' };
test('rejects internal addresses, credentials, non-HTTPS and lookalike push providers', () => {
  for (const e of ['http://web.push.apple.com/x','https://localhost/x','https://127.0.0.1/x','https://web.push.apple.com.evil.test/x','https://evilpush.apple.com/x','https://user:pass@web.push.apple.com/x','https://web.push.apple.com:444/x']) assert.throws(() => endpoint(e));
  assert.equal(endpoint(sub.endpoint), sub.endpoint);
});
test('validates subscription encryption material', () => {
  assert.deepEqual(subscription(sub), sub);
  assert.throws(() => subscription({ ...sub, keys: { ...sub.keys, auth: 'bad' } }));
  assert.throws(() => subscription({ ...sub, keys: { ...sub.keys, p256dh: 'bad' } }));
});
test('binds subscriptions to Graph identity and verifies team site access', async () => {
  const {h,rows,graphCalls} = setup();
  await h.subscriptions(req, { appId:'one', action:'upsert', subscription:sub, email:'attacker@example.com' });
  assert.equal([...rows.values()][0].email, 'member@example.com');
  assert.equal(graphCalls.length, 2); assert.match(graphCalls[1], /sites\/example.sharepoint.com/);
  await assert.rejects(h.subscriptions({headers:new Headers()}, {appId:'one'}), {status:401});
  await assert.rejects(h.subscriptions(req, {appId:'unknown'}), {status:400});
});
test('push only reaches matching recipients in the selected app', async () => {
  const {h,delivered} = setup();
  await h.subscriptions(req, {appId:'one', action:'upsert', subscription:sub});
  assert.deepEqual(await h.dispatch({...body,appId:'two'}), {matched:0,sent:0,expired:0,failed:0});
  assert.deepEqual(await h.dispatch({...body,recipients:['other@example.com']}), {matched:0,sent:0,expired:0,failed:0});
  assert.equal((await h.dispatch(body)).sent, 1);
  assert.equal(delivered.length, 1);
  assert.equal(JSON.parse(delivered[0][1]).url, app.baseUrl);
});
test('another identity cannot remove a subscription', async () => {
  const {h,rows} = setup();
  await h.subscriptions(req, {appId:'one', action:'upsert', subscription:sub});
  [...rows.values()][0].oid = 'someone-else';
  await assert.rejects(h.subscriptions(req, {appId:'one',action:'remove',endpoint:sub.endpoint}), {status:403});
  [...rows.values()][0].oid = 'user-1';
  await h.subscriptions(req, {appId:'one',action:'remove',endpoint:sub.endpoint});
  assert.equal(rows.size, 0);
});
test('invalid recipients and oversized payloads fail before sending', () => {
  assert.throws(() => notification({...body,recipients:[]}, app));
  assert.throws(() => notification({...body,recipients:['invalid']}, app));
  assert.throws(() => notification({...body,body:'x'.repeat(1001)}, app));
  assert.throws(() => notification({...body,body:'界'.repeat(1000)}, app));
  assert.throws(() => notification({...body,eventId:''}, app));
  assert.equal(JSON.parse(notification(body,app).payload).tag, JSON.parse(notification(body,app).payload).tag);
});
test('expired endpoints are pruned while transient failures remain for retry', async () => {
  for (const code of [404,410,429,500]) {
    const rows = [{partitionKey:'one',rowKey:'a',subscription:JSON.stringify(sub)}];
    const h = createHandlers({ apps:{one:app}, deliveries:createDeliveryReceipts(new FakeTable(),async()=>{}), table:{find:async()=>rows, remove:async()=>rows.pop()}, send:async()=>{throw {statusCode:code};} });
    const result = await h.dispatch(body);
    assert.equal(result.expired, [404,410].includes(code) ? 1 : 0);
    assert.equal(rows.length, [404,410].includes(code) ? 0 : 1);
    assert.equal(result.failed, [404,410].includes(code) ? 0 : 1);
  }
});
test('replayed events do not send again, but a new event does', async () => {
  const {h,delivered}=setup();
  await h.subscriptions(req,{appId:'one',action:'upsert',subscription:sub});
  assert.equal((await h.dispatch(body)).sent,1);
  assert.deepEqual(await h.dispatch(body),{matched:1,sent:0,expired:0,failed:0});
  assert.equal((await h.dispatch({...body,eventId:'next-request'})).sent,1);
  assert.equal(delivered.length,2);
});
test('overlapping flow runs share a receipt; a retry after completion does not send again', async () => {
  let finish; const gate=new Promise(resolve=>{finish=resolve;});
  let started; const sending=new Promise(resolve=>{started=resolve;});
  const {h,delivered}=setup(async()=>{started();await gate;});
  await h.subscriptions(req,{appId:'one',action:'upsert',subscription:sub});
  const first=h.dispatch(body); await sending;
  assert.equal((await h.dispatch(body)).failed,1);
  finish(); assert.equal((await first).sent,1);
  assert.equal((await h.dispatch(body)).sent,0);
  assert.equal(delivered.length,1);
});
test('retry sends only the failed device, preserving delivery to the other phone', async () => {
  let fail=true;
  const {h,delivered}=setup(async s=>{if(fail&&s.endpoint.endsWith('/second'))throw {statusCode:503};});
  await h.subscriptions(req,{appId:'one',action:'upsert',subscription:sub});
  await h.subscriptions(req,{appId:'one',action:'upsert',subscription:{...sub,endpoint:'https://web.push.apple.com/second'}});
  const first=await h.dispatch(body);assert.equal(first.sent,1);assert.equal(first.failed,1);
  fail=false;const retry=await h.dispatch(body);assert.equal(retry.sent,1);assert.equal(retry.failed,0);
  assert.equal(delivered.length,2);
});
test('storage failures never delete a valid phone subscription',async()=>{
  let removed=0;
  const h=createHandlers({apps:{one:app},table:{find:async()=>[{rowKey:'a'}],remove:async()=>{removed++;}},deliveries:{claim:async()=>{throw {statusCode:404};}}});
  assert.equal((await h.dispatch(body)).failed,1);assert.equal(removed,0);
});
test('a receipt write failure after provider acceptance does not release the active claim',async()=>{
  let released=0,removed=0;
  const h=createHandlers({apps:{one:app},table:{find:async()=>[{rowKey:'a',subscription:JSON.stringify(sub)}],remove:async()=>{removed++;}},send:async()=>{},deliveries:{claim:async()=>({etag:'1'}),complete:async()=>{throw {statusCode:404};},release:async()=>{released++;}}});
  assert.equal((await h.dispatch(body)).failed,1);assert.equal(released,0);assert.equal(removed,0);
});

