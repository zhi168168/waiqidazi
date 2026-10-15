import assert from 'node:assert/strict';
import {mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import net from 'node:net';

// Run outside the checkout so an accidental external require cannot find the
// project's node_modules. Never load the user's .env or historical database.
const directory=await mkdtemp(join(tmpdir(),'waiqi-runtime-qa-'));
let app;
try {
 await cp(resolve(process.argv[2]),join(directory,'runtime'),{recursive:true});
 const {createApp}=await import(pathToFileURL(join(directory,'runtime/server/app.mjs')));
 process.env.ADMIN_PASSWORD='runtime-test-admin-only';process.env.ALLOW_DEV_LOGIN='true';
 delete process.env.DB_DRIVER;delete process.env.AUDIO_STORAGE;
 const models={moderate:async()=>{},synthesize:async()=>Buffer.from('audio-test'),chat:async(_messages,options)=>({text:options.type==='memory'?'{"facts":[]}':options.type==='topic'?'{"newTopic":false}':'{"reply":"这是部署包验证回复。"}'})};
 app=createApp({directory:join(directory,'data'),models});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const request=async(path,body,token='')=>{
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal(response.status,200);return response.json();
 };
 assert.equal((await request('/health')).ok,true);
 assert.ok((await request('/admin/login',{username:'admin',password:process.env.ADMIN_PASSWORD})).token);
 const login=await request('/auth/login',{dev:true,consent:true,deviceId:'runtime-qa'});
 const conversation=await request('/conversations',{title:'runtime'},login.token);
 const message=await request(`/conversations/${conversation.id}/messages`,{text:'测试',requestId:'runtime-qa-request'},login.token);
 let complete=false;
 for(let i=0;i<30;i++){
  const saved=await request('/messages/'+message.id,null,login.token);
  if(saved.status==='complete'){assert.equal(saved.reply,'这是部署包验证回复。');complete=true;break;}
  await new Promise(r=>setTimeout(r,30));
 }
 assert.ok(complete,'Bundled chat did not complete');await app.close();app=null;
 // Instantiate the bundled COS SDK; actual cloud credentials are not requested.
 process.env.AUDIO_STORAGE='cos';process.env.COS_BUCKET='test-bucket';process.env.COS_REGION='ap-shanghai';
 app=createApp({directory:join(directory,'cos-data'),models});await app.close();app=null;
 // Check that the sibling bundled MySQL worker loads its driver correctly.
 process.env.DB_DRIVER='mysql';process.env.MYSQL_HOST='127.0.0.1';process.env.MYSQL_PORT='1';
 process.env.MYSQL_USER='test';process.env.MYSQL_DATABASE='test';process.env.MYSQL_PASSWORD='test';
 assert.throws(()=>createApp({directory:join(directory,'mysql-data'),models}),/ECONNREFUSED/);
 // Exercise the packaged entrypoint, not just the exported application API.
 for(const configured of [false,true]){
  const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const child=spawn(process.execPath,[join(directory,'runtime/server/index.mjs')],{windowsHide:true,cwd:join(directory,'runtime'),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DEPLOYMENT_TARGET:'wechat-cloudrun',ALLOW_DEV_LOGIN:'false',DB_DRIVER:'mysql',AUDIO_STORAGE:'cos',ADMIN_PASSWORD:configured?'test-only':'',MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'1',MYSQL_USER:'test',MYSQL_DATABASE:'test',MYSQL_PASSWORD:'test-only',COS_BUCKET:'test',COS_REGION:'ap-shanghai'}});
  const exited=new Promise(r=>child.once('exit',r));
  try{
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Packaged entrypoint did not listen')),10000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('Packaged entrypoint exited early'));});
    child.stdout.on('data',chunk=>{if(chunk.toString().includes('进程已监听')){clearTimeout(timer);resolve();}});
    child.stderr.resume();
   });
   const health=await fetch(`http://127.0.0.1:${port}/api/health`);assert.equal(health.status,200);const state=await health.json();
   assert.equal(state.ok,false);assert.equal(state.status,configured?'initialization_failed':'configuration_required');
   assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/login`,{method:'POST'})).status,503);
  }finally{child.kill();await exited;}
 }
 console.log('Isolated runtime verified: health, admin/user login, saved chat, COS SDK initialization, MySQL worker loading.');
 console.log('Packaged setup mode verified: missing credentials and database refusal keep process alive and business APIs closed.');
 console.log('Live cloud database/storage authorization and Docker image pull still require cloud verification.');
} finally {if(app)await app.close();await rm(directory,{recursive:true,force:true});}
