// Explicit isolated browser-QA fixture. Never used by the production entry point.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureStore} from '../tests/helpers/web-fixture.mjs';
import {createWebApp} from '../server/web-app.mjs';
import {AppError} from '../server/providers.mjs';
process.env.ADMIN_PASSWORD='fixture-admin-password';process.env.PRIVACY_POLICY_CONFIRMED='true';process.env.AUDIO_STORAGE='local';
const directory=mkdtempSync(join(tmpdir(),'buddy-web-qa-'));
const store=fixtureStore(directory),port=Number(process.env.QA_PORT || 8840),base='http://127.0.0.1:'+port;
const account={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',role:'authenticated',email:'demo@example.test',email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{nickname:'小林'},identities:[]};
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const accessToken=[encode({alg:'HS256',typ:'JWT'}),encode({sub:account.id,aud:'authenticated',exp:Math.floor(Date.now()/1000)+86400,iat:Math.floor(Date.now()/1000),role:'authenticated'}),'fixture-signature'].join('.');
const token=()=>({access_token:accessToken,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user:account});
const identity={config:{configured:true,url:base,anonKey:'fixture-public-key'},verify:async req=>{if(req.headers.authorization!=='Bearer '+accessToken)throw new AppError(401,'请先登录。');return account;},remove:async()=>{}};
store.put('settings',{...store.get('settings','current'),privacyText:'浏览器验收专用测试环境。所有账号、回复和语料均为隔离测试数据，不调用真实模型或邮件服务。'});
const user={id:account.id,authProvider:'supabase',email:account.email,nickname:'小林',preferences:{job:'供应链协调'},memoryEnabled:true,memoryEpoch:0,createdAt:new Date().toISOString()};store.put('user',user);
store.put('memory',{id:'fixture-memory',userId:user.id,type:'career',key:'career.role',text:'我在外企做供应链协调。',status:'active',version:1,source:'user-explicit'});
const models={moderate:async()=>{},synthesize:async()=>{
 const sampleRate=8000,buffer=Buffer.alloc(44+sampleRate*2);buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(sampleRate,24);buffer.writeUInt32LE(sampleRate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(sampleRate*2,40);for(let i=0;i<sampleRate;i++)buffer.writeInt16LE(Math.sin(i/sampleRate*Math.PI*880)*3000,44+i*2);return buffer;
},chat:async(messages,options)=>{
 if(options.type==='topic')return {text:'{"newTopic":false}'};
 if(options.type==='memory')return {text:'{"facts":[]}'};
 if(messages[0].content.startsWith('Translate the ENTIRE'))return {text:JSON.stringify({english:'That sounds exhausting. You have a lot on your plate, and it makes sense that you feel frustrated. What happened today?'})};
 await new Promise(r=>setTimeout(r,650));
 return {text:JSON.stringify({reply:'这也太让人憋屈了。事情都堆到你一个人身上，换谁都会觉得不公平。\n\n先跟我说说，这次又是什么事？我陪你一起捋。',englishTip:{expression:'I feel like everything is being dumped on me.',explanation:'dump something on someone 可以表示把工作或责任一股脑推给某人。适合向熟悉的同事或朋友表达委屈。'}})};
}};
const app=createWebApp({directory,store,identity,models});
app.server.removeAllListeners('request');
app.server.on('request',async(req,res)=>{
 if(!req.url.startsWith('/auth/v1/'))return app.handler(req,res);
 const path=new URL(req.url,base).pathname;let raw='';for await(const chunk of req)raw+=chunk;const data=raw?JSON.parse(raw):{};
 res.setHeader('Content-Type','application/json');
 if(path.endsWith('/token')){if(data.grant_type==='refresh_token'||data.refresh_token || data.email==='demo@example.test'&&data.password==='fixture-password-123'){res.end(JSON.stringify(token()));return;}res.statusCode=400;res.end(JSON.stringify({msg:'Invalid login credentials',error_code:'invalid_credentials'}));return;}
 if(path.endsWith('/signup')){res.end(JSON.stringify({user:{...account,email:data.email,email_confirmed_at:null},session:null}));return;}
 if(path.endsWith('/user')){res.end(JSON.stringify(account));return;}
 res.end('{}');
});
await new Promise(resolve=>app.server.listen(port,'127.0.0.1',resolve));
// Seed one published, playable corpus through the real admin routes.
const call=async(path,body,token)=>{const response=await fetch(base+'/api'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return response.json();};
const admin=(await call('/admin/login',{username:'admin',password:process.env.ADMIN_PASSWORD})).token;
process.env.TTS_FORMAT='wav';
const entry=await call('/admin/corpus',{title:'给自己争取一点准备时间',categoryId:'root-1',english:'Could we allow a little more time to prepare?',chinese:'我们能多留一点准备时间吗？',situation:'任务临时增加，需要协调准备时间。',notes:'委婉提出请求，不承诺新的日期。',channel:'口头',formality:'自然',tags:['协调','时间']},admin);
await app.settle();await call('/admin/corpus/'+entry.corpusId+'/publish',{reviewed:true},admin);
console.log('ISOLATED FIXTURE '+base+' | user demo@example.test / fixture-password-123 | admin / fixture-admin-password');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.settle();await app.close();rmSync(directory,{recursive:true,force:true});process.exit(0);});
