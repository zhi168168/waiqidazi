import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSetupApp,missingCloudConfig,createCloudApp} from '../server/cloud-setup.mjs';
import http from 'node:http';

test('missing cloud configuration reports names, never values, and keeps all business APIs closed',async t=>{
 const env={MYSQL_PASSWORD:'test-secret',MYSQL_HOST:'127.0.0.1',MYSQL_USER:'root',MYSQL_DATABASE:'test',COS_BUCKET:'test',COS_REGION:'ap-shanghai'};
 assert.deepEqual(missingCloudConfig(env),['ADMIN_PASSWORD']);
 const app=createSetupApp({missing:missingCloudConfig(env)});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const health=await fetch(base+'/api/health');assert.equal(health.status,200);
 const value=await health.json();assert.equal(value.ok,false);assert.equal(value.status,'configuration_required');assert.deepEqual(value.missing,['ADMIN_PASSWORD']);assert.equal(JSON.stringify(value).includes('test-secret'),false);
 for(const path of ['/api/admin/login','/api/auth/login','/api/conversations','/audio/test.mp3','/']){
  const response=await fetch(base+path,{method:'POST',body:'test-secret'});assert.equal(response.status,503);assert.equal((await response.text()).includes('test-secret'),false);
 }
});
test('cloud initialization failures remain observable without opening business endpoints',async t=>{
 const app=createSetupApp({errorCode:'ECONNREFUSED'});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const response=await fetch(`http://127.0.0.1:${app.server.address().port}/api/health`);
 const value=await response.json();assert.equal(value.ok,false);assert.equal(value.status,'initialization_failed');assert.equal(value.errorCode,'ECONNREFUSED');
});

const configured={MYSQL_HOST:'test',MYSQL_USER:'test',MYSQL_DATABASE:'test',MYSQL_PASSWORD:'test-only',ADMIN_PASSWORD:'test-only',COS_BUCKET:'test',COS_REGION:'test'};
test('version handoff waits for ownership then enables business on the same HTTP port once',async t=>{
 let owned=true,attempts=0,closed=0;
 const app=createCloudApp(()=>{
  attempts++;
  if(owned){const error=Error('busy');error.code='APP_INSTANCE_BUSY';throw error;}
  return {server:http.createServer((_req,res)=>{res.writeHead(200);res.end(JSON.stringify({ok:true}));}),close:async()=>{closed++;}};
 },{env:configured,retryDelay:15});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.server.address().port}`;
 assert.equal((await (await fetch(base+'/api/health')).json()).status,'waiting_for_previous_instance');
 assert.equal((await fetch(base+'/api/conversations')).status,503);
 owned=false;let ready=false;
 for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,10));if((await (await fetch(base+'/api/health')).json()).ok){ready=true;break;}}
 assert.ok(ready);assert.equal((await fetch(base+'/api/conversations')).status,200);
 const count=attempts;await new Promise(r=>setTimeout(r,45));assert.equal(attempts,count);
 await app.close();await app.close();assert.equal(closed,1);
});
test('authentication errors do not retry; shutdown cancels ownership retries',async()=>{
 for(const code of ['ER_ACCESS_DENIED_ERROR','APP_INSTANCE_BUSY']){
  let attempts=0;
  const app=createCloudApp(()=>{attempts++;const error=Error('failure');error.code=code;throw error;},{env:configured,retryDelay:10});
  if(code==='ER_ACCESS_DENIED_ERROR'){await new Promise(r=>setTimeout(r,35));assert.equal(attempts,1);}
  await app.close();const count=attempts;await new Promise(r=>setTimeout(r,35));assert.equal(attempts,count);
 }
});
