import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function client(consent) {
 const storage=new Map(), calls=[],modals=[];
 const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),getDeviceInfo:()=>({platform:'devtools'}),
  request:options=>{calls.push(options);options.success({statusCode:200,data:options.url.endsWith('/privacy')?{text:'完整隐私说明'}:{token:'test-token'}});},
  navigateTo:options=>{modals.push(options);queueMicrotask(()=>context.module.exports.finishPrivacy(consent));},showToast:()=>{}};
 const context={module:{exports:{}},require:()=>({baseUrl:'http://127.0.0.1:8838',devLogin:true}),wx};
 vm.runInNewContext(readFileSync('miniprogram/utils/api.js','utf8'),context);
 return {api:context.module.exports,storage,calls,modals};
}
test('privacy page coalesces login, continues the action and does not overwrite preferences',async()=>{
 const c=client(true);
 assert.deepEqual(await Promise.all([c.api.ensureLogin(),c.api.ensureLogin()]),[true,true]);
 assert.equal(c.modals.length,1);assert.equal(c.modals[0].url,'/pages/privacy/index');
 assert.equal(c.calls.filter(r=>r.url.endsWith('/auth/login')).length,1);
 assert.equal(c.calls.some(r=>r.method==='PATCH'),false);
 assert.equal(c.storage.get('token'),'test-token');
 assert.equal(await c.api.ensureLogin(),true);assert.equal(c.modals.length,1);
});
test('declining privacy prevents login and allows a later attempt',async()=>{
 const c=client(false);
 assert.equal(await c.api.ensureLogin(),false);
 assert.equal(c.calls.some(r=>r.url.endsWith('/auth/login')),false);
 assert.equal(c.storage.has('token'),false);
 assert.equal(await c.api.ensureLogin(),false);assert.equal(c.modals.length,2);
});

test('launch starts login and exposes its completion to pages',async()=>{
 let app, calls=0;
 const ready=Promise.resolve(true);
 vm.runInNewContext(readFileSync('miniprogram/app.js','utf8'),{
  App:definition=>{app=definition;},require:()=>({ensureLogin:()=>{calls++;return ready;}}),
  wx:{getStorageSync:()=> 'existing-session'}
 });
 app.onLaunch();assert.equal(calls,1);assert.equal(app.globalData.loginReady,ready);
 assert.equal(app.globalData.activeSessionId,'existing-session');
});
