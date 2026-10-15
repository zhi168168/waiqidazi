import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MySQLSync} from '../server/mysql-sync.mjs';
import {createAudioStorage} from '../server/audio-storage.mjs';

test('MySQL bridge preserves Unicode values and errors and rejects use after close',()=>{
 const db=new MySQLSync({workerURL:new URL('./fixtures/mysql-bridge-worker.mjs',import.meta.url),config:{host:'test',user:'test',database:'test',password:'test'}});
 try {
  assert.deepEqual(db.prepare('SELECT ?').get('中文😀'),{sql:'SELECT ?',params:['中文😀']});
  assert.throws(()=>db.exec('FAIL'),/test query failure/);
  assert.equal(db.exec('ROLLBACK'),true);
 }finally{db.close();}
 assert.throws(()=>db.exec('SELECT 1'),/已关闭/);
});

test('cloud client uses configured container routing, real login, token and private audio endpoint',async()=>{
 const calls=[],tokens=new Map();let initialized=0;
 const config={transport:'cloud',cloudEnv:'test-env',cloudService:'test-service',baseUrl:'',devLogin:false};
 const wx={getStorageSync:k=>tokens.get(k),setStorageSync:(k,v)=>tokens.set(k,v),removeStorageSync:k=>tokens.delete(k),getDeviceInfo:()=>({platform:'devtools'}),showToast:()=>{},navigateTo:o=>queueMicrotask(()=>context.module.exports.finishPrivacy(true)),login:o=>o.success({code:'real-wechat-code'}),cloud:{init:o=>{assert.equal(o.env,'test-env');initialized++;},callContainer:o=>{calls.push(o);o.success({statusCode:200,data:o.path.endsWith('/privacy')?{text:'policy'}:o.path.endsWith('/audio')?{url:'https://storage.example/signed'}:{token:'user-token'}});}}};
 const context={module:{exports:{}},require:()=>config,wx};vm.runInNewContext(readFileSync('miniprogram/utils/api.js','utf8'),context);const api=context.module.exports;
 assert.equal(await api.ensureLogin(),true);assert.equal(initialized,1);
 const login=calls.find(c=>c.path==='/api/auth/login');assert.equal(login.data.code,'real-wechat-code');assert.equal(login.data.dev,undefined);
 assert.equal(await api.audioSource({id:'published-corpus'}),'https://storage.example/signed');
 assert.equal(calls.at(-1).header.Authorization,'Bearer user-token');assert.equal(calls.at(-1).header['X-WX-SERVICE'],'test-service');
 wx.cloud.callContainer=o=>o.success({statusCode:401,data:{error:'请登录'}});
 await assert.rejects(api.request('/me'),/请登录/);assert.equal(tokens.has('token'),false);
});

test('private COS upload includes official metadata and playback signs an expiring HTTPS URL',async()=>{
 const previous={...process.env};const directory=mkdtempSync(join(tmpdir(),'waiqi-cos-'));const calls=[];
 process.env.AUDIO_STORAGE='cos';process.env.COS_BUCKET='test-bucket';process.env.COS_REGION='ap-shanghai';
 try {
  const client={putObject:(p,cb)=>{calls.push(p);cb(null,{});},getObjectUrl:(p,cb)=>{calls.push(p);cb(null,{Url:'https://test.example/audio?sign=temporary'});},getObject:(p,cb)=>cb(null,{Body:Buffer.from('audio')})};
  const storage=createAudioStorage(directory,{client,fetchImpl:async(url,o)=>{
   assert.equal(url,'http://api.weixin.qq.com/_/cos/metaid/encode');assert.equal(JSON.parse(o.body).openid,'');return {ok:true,json:async()=>({errcode:0,respdata:{x_cos_meta_field_strs:['signed-metadata']}})};
  }});
  await storage.save('test.wav',Buffer.from('audio'));assert.equal(calls[0].Headers['x-cos-meta-fileid'],'signed-metadata');assert.equal(calls[0].ContentType,'audio/wav');
  assert.match(await storage.url('test.wav'),/^https:/);assert.equal(calls[1].Sign,true);assert.equal(calls[1].Expires,600);
  assert.equal((await storage.read('test.wav')).toString(),'audio');
 }finally{process.env=previous;rmSync(directory,{recursive:true,force:true});}
});
