const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'push-client.js'), 'utf8');

function phone({ hub = true, permission = 'granted', existing = null, failStore = false, installing = false, storageThrows = false } = {}) {
  const log = [], requests = [], workerEvents = new Map(), registrationEvents = new Map();
  let sub = existing;
  const makeSub = () => ({ endpoint: 'https://web.push.apple.com/this-installation', options: {}, toJSON: () => ({ endpoint: 'https://web.push.apple.com/this-installation', keys: {} }), unsubscribe: async () => { log.push('unsubscribe'); sub = null; return true; } });
  const worker = { state: 'installing', addEventListener: (name, fn) => workerEvents.set(name, fn), removeEventListener: name => workerEvents.delete(name) };
  const reg = {
    active: installing ? null : {}, installing: installing ? worker : null,
    addEventListener: (name, fn) => registrationEvents.set(name, fn), removeEventListener: name => registrationEvents.delete(name),
    pushManager: { getSubscription: async () => sub, subscribe: async options => { log.push('subscribe'); assert.equal(options.userVisibleOnly, true); sub = makeSub(); return sub; } }
  };
  const notification = { permission, requestPermission: () => { log.push('permission'); notification.permission = 'granted'; return Promise.resolve('granted'); } };
  const serviceWorker = { register: async () => { log.push('register'); return reg; }, getRegistration: async () => reg };
  Object.defineProperty(serviceWorker, 'ready', { get() { log.push('wrong-root-worker'); return Promise.resolve({ pushManager: { getSubscription: async () => null } }); } });
  const sandbox = {
    window: { isSecureContext: true, PushManager: {}, Notification: notification }, Notification: notification,
    navigator: { serviceWorker }, sessionStorage: { getItem: () => { if (storageThrows) throw Error('unavailable'); return hub ? '1' : null; } },
    localStorage: { getItem: () => assert.fail('permission must not be inferred from persistent cross-app state') },
    Uint8Array, URL, AbortSignal, setTimeout, clearTimeout, atob, btoa, location: { href: 'https://one.example/rci-productions/' },
    fetch: async (url, options) => { requests.push([url, options]); if (url.includes('/config')) return { ok: true, json: async () => ({ publicKey: 'BAEBAQ' }) }; log.push('store'); return failStore ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => ({ ok: true }) }; }
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const client = sandbox.createPushClient({ appId: 'team', apiBaseUrl: 'https://push.example/api', getToken: async () => 'token', onChange: () => {}, isDemo: () => false, standalone: () => true, ios: () => true });
  return { client, log, requests, notification, registrationEvents, workerEvents, setSubscription: value => { sub = value; }, makeSub,
    activate: () => { reg.active = {}; worker.state = 'activated'; workerEvents.get('statechange')?.(); } };
}

test('Serve permission hides team prompts immediately and after startup', async () => {
  const {client,log}=phone(); assert.equal(client.panel(),''); await client.init();
  assert.equal(client.panel(),''); assert.equal(log.filter(x=>x==='permission').length,0);
});
test('a team reached through Serve registers in the background using existing consent', async () => {
  const {client,log,requests}=phone(); await client.init();
  assert.equal(log.filter(x=>x==='subscribe').length,1); assert.equal(log.filter(x=>x==='store').length,1);
  assert.ok(!log.includes('permission')); assert.ok(!log.includes('wrong-root-worker'));
  const body=JSON.parse(requests.find(([url])=>url.includes('/subscriptions'))[1].body);
  assert.equal(body.appId,'team'); assert.equal(body.action,'upsert');
});
test('a stale team enable button cannot request permission again inside Serve', async () => {
  const {client,log}=phone(); await client.enable(); assert.ok(log.includes('subscribe')); assert.ok(!log.includes('permission'));
});
test('separate team installs retain explicit permission and activation controls', async () => {
  const {client,log}=phone({hub:false,permission:'default'});await client.init();
  assert.match(client.panel(),/Enable Notifications/);assert.ok(!log.includes('subscribe'));
  log.length=0;const pending=client.enable();assert.equal(log[0],'permission');await pending;assert.ok(log.includes('subscribe'));
});
test('permission granted to a separate team install does not silently subscribe it', async () => {
  const {client,log}=phone({hub:false});await client.init();
  assert.match(client.panel(),/Enable Notifications/);assert.ok(!log.includes('subscribe'));
});
test('the Serve navigation marker alone does not count as notification consent', async () => {
  for(const permission of ['default','denied']){
    const {client,log}=phone({permission});await client.init();assert.notEqual(client.panel(),'');assert.ok(!log.includes('subscribe'));assert.ok(!log.includes('permission'));
  }
});
test('unavailable session storage safely retains the team activation controls', async () => {
  const {client,log}=phone({storageThrows:true});await client.init();assert.match(client.panel(),/Enable Notifications/);assert.ok(!log.includes('subscribe'));
});
test('a first team-worker install waits for that worker instead of using Serve root readiness', async () => {
  const p=phone({installing:true});const pending=p.client.init();await new Promise(setImmediate);
  assert.ok(!p.log.includes('subscribe'));assert.ok(!p.log.includes('wrong-root-worker'));assert.ok(p.workerEvents.has('statechange'));
  p.activate();await pending;assert.equal(p.log.filter(x=>x==='subscribe').length,1);
  assert.equal(p.workerEvents.size,0);assert.equal(p.registrationEvents.size,0);
});
test('an existing team subscription is refreshed without creating another one', async () => {
  const p=phone();p.setSubscription(p.makeSub());await p.client.init();assert.ok(!p.log.includes('subscribe'));assert.equal(p.log.filter(x=>x==='store').length,1);
});
test('a changed VAPID key renews Serve subscriptions but preserves standalone opt-in',async()=>{
  for(const hub of [true,false]){
    const p=phone({hub}),old=p.makeSub();old.options.applicationServerKey=new Uint8Array([4,9]);p.setSubscription(old);
    await p.client.init();assert.ok(p.log.includes('unsubscribe'));assert.equal(p.log.includes('subscribe'),hub);assert.ok(!p.log.includes('permission'));
    if(!hub)assert.match(p.client.panel(),/Enable Notifications/);
  }
});
test('revoking permission restores the appropriate team settings message', async () => {
  const p=phone();await p.client.init();p.notification.permission='denied';assert.match(p.client.panel(),/Notifications are off/);
});
test('background registration failure does not reinstate an activation prompt inside Serve', async () => {
  const {client,log}=phone({failStore:true});await client.init();assert.equal(client.panel(),'');assert.ok(!log.includes('permission'));
});
