import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../push-client.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
function phone({ permission = 'default', failStore = false, existing = null } = {}) {
  const log = [];
  let sub = existing;
  const reg = { pushManager: { getSubscription: async()=>sub, subscribe:async()=>{
    log.push('subscribe'); sub = { endpoint:'https://web.push.apple.com/a', toJSON:()=>({endpoint:'https://web.push.apple.com/a',keys:{}}), unsubscribe:async()=>{log.push('unsubscribe');sub=null;return true;} }; return sub;
  } } };
  const sandbox = { window:{isSecureContext:true,PushManager:{},Notification:{}}, navigator:{serviceWorker:{register:async()=>{log.push('register');return reg;},ready:Promise.resolve(reg),getRegistration:async()=>reg}},
    Notification:{permission,requestPermission:()=>{log.push('permission');return Promise.resolve('granted');}},
    Headers, Uint8Array, URL, AbortSignal, setTimeout, clearTimeout, atob, btoa, location:{href:'https://one.example/'},
    fetch:async(url,options)=>{log.push(url.includes('/config')?'config':'store'); if(url.includes('/config'))return {ok:true,json:async()=>({publicKey:'BAEBAQ'})}; if(failStore) return {ok:false,status:503};return {ok:true,status:200,json:async()=>({ok:true})};}
  };
  vm.createContext(sandbox); vm.runInContext(source,sandbox);
  const client = sandbox.createPushClient({appId:'one',apiBaseUrl:'https://push.example/api',getToken:async()=>{log.push('token');return 'token';},onChange:()=>{},isDemo:()=>false,standalone:()=>true,ios:()=>true});
  return {client,log};
}
test('requests permission immediately from the user tap before worker/network waits', async()=>{
  const {client,log}=phone(); await client.init(); log.length=0;
  const pending=client.enable(); assert.equal(log[0],'permission'); await pending;
  assert.ok(log.indexOf('permission')<log.indexOf('subscribe'));
  assert.match(client.panel(),/Notifications are enabled/);
  await client.disable(); assert.ok(log.includes('unsubscribe'));assert.doesNotMatch(client.panel(),/Notifications are enabled/);
});
test('permission alone does not claim the phone is registered after a server failure', async()=>{
  const {client}=phone({failStore:true});await client.init();await client.enable();
  assert.doesNotMatch(client.panel(),/Notifications are enabled/);assert.match(client.panel(),/role="alert"/);
});
test('reopening an already subscribed app re-registers with the current signed-in account', async()=>{
  const {client,log}=phone({permission:'granted',existing:{toJSON:()=>({}),options:{}}}); await client.init();
  assert.ok(log.includes('store'));assert.match(client.panel(),/Notifications are enabled/);assert.ok(!log.includes('permission'));
});
test('worker shows fallback notifications and blocks off-site click destinations', async()=>{
  const handlers={},shown=[],opened=[];
  const sandbox={URL,Request,Response, self:{location:{origin:'https://one.example'},registration:{scope:'https://one.example/rci-productions/',showNotification:async(...args)=>shown.push(args)},addEventListener:(name,fn)=>{handlers[name]=fn;},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}}};
  vm.createContext(sandbox);vm.runInContext(worker,sandbox);
  let pending;const waitUntil=p=>{pending=p;};
  handlers.push({data:{json:()=>{throw new Error();}},waitUntil});await pending;
  assert.equal(shown[0][0],'RCI Team Update');
  handlers.push({data:{json:()=>({title:'Request',url:'https://evil.example/'})},waitUntil});await pending;
  assert.equal(shown[1][1].data.url,'https://one.example/rci-productions/');
  handlers.notificationclick({notification:{close(){},data:{url:'https://one.example/rci-security/'}},waitUntil});await pending;
  assert.equal(opened[0],'https://one.example/rci-productions/');
});
