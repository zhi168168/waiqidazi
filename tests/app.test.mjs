import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.mjs';
import {id} from '../server/store.mjs';
import {audioKey,ttsConfig} from '../server/providers.mjs';

process.env.ALLOW_DEV_LOGIN='true';process.env.ADMIN_PASSWORD='test-only-password-12345';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function eventually(fn){for(let i=0;i<150;i++){const v=await fn();if(v)return v;await delay(20);}throw Error('Timed out waiting for asynchronous task');}
async function fixture(t, overrides={}) {
 const directory=mkdtempSync(join(tmpdir(),'waiqi-test-'));let chats=0,tts=0;
 const models={moderate:async()=>{},chat:async(messages,options)=>{
   if(options.type==='topic')return {text:'{"newTopic":false}'};
   if(options.type==='memory'){return {text:JSON.stringify({facts:[{type:'career',text:'供应链协调岗位',evidence:'我做供应链协调'}]}),usage:{}};}
   chats++;options.onChunk?.('Could we');await delay(180);if(options.signal?.aborted)throw Error('Aborted');return {text:'Could we allow a little more time to prepare?',usage:{total_tokens:30}};
 },synthesize:async()=>{tts++;await delay(20);return Buffer.from('ID3-test-audio');},...overrides};
 const app=createApp({directory,models});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const request=async(path,token='',method='GET',body)=>{const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
 const login=async name=>(await request('/auth/login','','POST',{dev:true,deviceId:name,consent:true})).data.token;
 const admin=(await request('/admin/login','','POST',{username:'admin',password:process.env.ADMIN_PASSWORD})).data.token;
 t.after(async()=>{await app.close();rmSync(directory,{recursive:true,force:true});});
 return {...app,base,request,login,admin,counts:()=>({chats,tts})};
}
const entry={title:'协调准备时间',categoryId:'root-1',english:'Could we allow a little more time to prepare?',chinese:'我们能多留一点准备时间吗？',situation:'协调准备时间',notes:'委婉提出请求，不承诺新日期。',channel:'口头',formality:'自然',tags:['延期'],readingText:''};
test('full reply English translation is lazy, coalesced, cached, private and does not alter chat or tips',async t=>{
 let translations=0,release,started=false;
 const waiting=new Promise(r=>release=r);
 const f=await fixture(t,{chat:async(messages,options)=>{
  if(options.type==='topic')return {text:'{"newTopic":false}'};
  if(options.type==='memory')return {text:'{"facts":[]}'};
  if(messages[0].content.startsWith('Translate the ENTIRE')){
   translations++;started=true;await waiting;
   assert.deepEqual(JSON.parse(messages[1].content),{reply:'这安排太离谱了，你一个人怎么扛得住？'});
   return {text:JSON.stringify({english:'This setup is ridiculous. How are you supposed to handle it all on your own?'})};
  }
  return {text:JSON.stringify({reply:'这安排太离谱了，你一个人怎么扛得住？',englishTip:{expression:'I am swamped.',explanation:'忙不过来。'}})};
 }});
 const a=await f.login('english-owner'),b=await f.login('english-other'),s=(await f.request('/conversations',a,'POST',{})).data;
 const accepted=(await f.request(`/conversations/${s.id}/messages`,a,'POST',{text:'好烦',requestId:id()})).data;
 const original=await eventually(async()=>{const m=(await f.request('/messages/'+accepted.id,a)).data;return m.status==='complete' && m;});
 assert.equal(translations,0);
 assert.equal((await f.request(`/messages/${accepted.id}/english`,b,'POST',{})).status,404);
 const one=f.request(`/messages/${accepted.id}/english`,a,'POST',{});await eventually(()=>started);
 const two=f.request(`/messages/${accepted.id}/english`,a,'POST',{});await delay(30);release();
 const results=await Promise.all([one,two]);assert.equal(translations,1);assert.deepEqual(results[0].data,results[1].data);
 assert.equal((await f.request(`/messages/${accepted.id}/english`,a,'POST',{})).data.english,results[0].data.english);assert.equal(translations,1);
 const stored=(await f.request('/messages/'+accepted.id,a)).data;
 assert.equal(stored.reply,original.reply);assert.deepEqual(stored.englishTip,original.englishTip);assert.equal(stored.englishReply,results[0].data.english);
 assert.equal((await f.request(`/conversations/${s.id}/messages`,a)).data[0].englishReply,stored.englishReply);
});

test('deleting a conversation during translation prevents a late translation from restoring the message',async t=>{
 let release,started=false;const waiting=new Promise(r=>release=r);
 const f=await fixture(t,{chat:async(messages,options)=>{
  if(options.type==='memory')return {text:'{"facts":[]}'};
  if(messages[0].content.startsWith('Translate the ENTIRE')){started=true;await waiting;return {text:'{"english":"That sounds exhausting."}'};}
  return {text:'听着就累。'};
 }});
 const a=await f.login('delete-english'),s=(await f.request('/conversations',a,'POST',{})).data;
 const m=(await f.request(`/conversations/${s.id}/messages`,a,'POST',{text:'好烦',requestId:id()})).data;
 await eventually(async()=>(await f.request('/messages/'+m.id,a)).data.status==='complete');
 const translating=f.request(`/messages/${m.id}/english`,a,'POST',{});await eventually(()=>started);
 await f.request(`/conversations/${s.id}`,a,'DELETE');release();
 assert.equal((await translating).status,404);assert.equal(f.store.get('message',m.id),null);
});
test('buddy separates English tips and remembers independent facts and targeted corrections across sessions',async t=>{
 let captured='';
 const f=await fixture(t,{chat:async(messages,options)=>{
  if(options.type==='topic')return {text:'{"newTopic":false}'};
  if(options.type==='memory'){
   const input=messages.at(-1).content;
   const facts=input.includes('产品经理') ? [
    {type:'career',key:'career.role',text:'用户是产品经理',evidence:'我是产品经理'},
    {type:'workplace',key:'workplace.testing_team',text:'公司没有测试部门',evidence:'公司没有测试部门'},
    {type:'interest',key:'interest.running',text:'用户喜欢跑步',evidence:'喜欢跑步'},
    {type:'interest',key:'interest.reading',text:'用户喜欢读书',evidence:'喜欢读书'},
    {type:'personality',key:'personality.introversion',text:'用户性格内向',evidence:'我性格内向'}
   ] : input.includes('招了') ? [{type:'workplace',key:'workplace.testing_team',text:'公司现在招了一位专职测试',evidence:'现在招了一位专职测试'}] : [];
   return {text:JSON.stringify({facts})};
  }
  assert.equal(options.json,true);captured=messages[0].content;
  const text=JSON.stringify({reply:'这些事情全压到你身上，难怪你这么烦。想先吐槽一下也行。',englishTip:{expression:"I just can't keep up.",explanation:'keep up 表示跟上，这里就是忙不过来。'}});
  options.onChunk?.(text.slice(0,20));return {text};
 }});
 const a=await f.login('buddy'),b=await f.login('other-buddy');
 const send=async(s,text)=>{
  const accepted=(await f.request(`/conversations/${s.id}/messages`,a,'POST',{text,requestId:id()})).data;
  return eventually(async()=>{const m=(await f.request('/messages/'+accepted.id,a)).data;return m.status==='complete' && m;});
 };
 const s=(await f.request('/conversations',a,'POST',{})).data;
 const m=await send(s,'我是产品经理，公司没有测试部门。我喜欢跑步，也喜欢读书。我性格内向。');
 assert.ok(!m.reply.includes('englishTip'));assert.equal(m.englishTip.expression,"I just can't keep up.");
 await eventually(async()=>(await f.request('/memory',a)).data.length===5);
 assert.equal((await f.request('/memory',b)).data.length,0);
 await send(s,'更正一下，公司现在招了一位专职测试');
 await eventually(async()=>(await f.request('/memory',a)).data.some(m=>m.text.includes('专职测试')));
 const active=(await f.request('/memory',a)).data;
 assert.equal(active.length,5);assert.ok(!active.some(m=>m.text==='公司没有测试部门'));
 assert.equal(active.filter(m=>m.type==='interest').length,2);
 const fresh=(await f.request('/conversations',a,'POST',{})).data;
 await send(fresh,'我今天好烦啊');
 assert.ok(captured.includes('用户是产品经理'));assert.ok(captured.includes('公司现在招了一位专职测试'));assert.ok(!captured.includes('"text":"公司没有测试部门"'));
 assert.equal((await f.request(`/conversations/${s.id}/messages`,a)).data[0].englishTip.expression,m.englishTip.expression);
 // A manually corrected slot does not block unrelated memories of the same type.
 await f.request('/memory/'+active.find(m=>m.key==='interest.running').id,a,'PATCH',{text:'用户喜欢徒步'});
 assert.ok((await f.request('/memory',a)).data.some(m=>m.text==='用户喜欢读书'));
});

test('automatic topics preserve history and memory, select context, and keep request retries idempotent',async t=>{
 let firstId,captured;
 const f=await fixture(t,{chat:async(messages,options)=>{
  if(options.type==='topic')return {text:JSON.stringify({newTopic:messages.at(-1).content.includes('准备客户邮件'),confidence:0.98,title:'客户邮件',carryMessageIds:[firstId]})};
  if(options.type==='memory')return {text:'{"facts":[{"type":"career","text":"供应链协调岗位","evidence":"我做供应链协调"}]}'};
  captured=messages[0].content;return {text:'Let’s work on that.'};
 }});
 const a=await f.login('topics'),s=(await f.request('/conversations',a,'POST',{})).data;
 const send=async text=>{const payload={text,requestId:id()};const accepted=(await f.request(`/conversations/${s.id}/messages`,a,'POST',payload)).data;const m=await eventually(async()=>{const value=(await f.request('/messages/'+accepted.id,a)).data;return value.status==='complete' && value;});return {payload,m};};
 firstId=(await send('我做供应链协调')).m.id;
 await eventually(async()=>(await f.request('/memory',a)).data.length===1);
 const follow=await send('这句话能更简洁吗？');assert.equal(follow.m.sessionId,s.id);
 const next=await send('现在准备客户邮件');assert.notEqual(next.m.sessionId,s.id);
 assert.ok(captured.includes('prior-topic-user-context'));assert.ok(captured.includes('我做供应链协调'));
 assert.equal((await f.request(`/conversations/${s.id}/messages`,a)).data.length,2);
 assert.equal((await f.request(`/conversations/${s.id}/memory`,a)).data.recentMessageIds.length,2);
 assert.equal((await f.request('/memory',a)).data.length,1);
 const duplicate=await f.request(`/conversations/${s.id}/messages`,a,'POST',next.payload);assert.equal(duplicate.data.id,next.m.id);assert.equal(duplicate.data.sessionId,next.m.sessionId);
 assert.equal((await f.request('/conversations',a)).data.length,2);
});
test('automatic practice mode excludes later fictional facts and exits without a switch',async t=>{
 const f=await fixture(t),a=await f.login('auto-policy');
 const s=(await f.request('/conversations',a,'POST',{})).data;
 assert.equal(s.roleplay,false);
 const send=async text=>{
  const m=(await f.request(`/conversations/${s.id}/messages`,a,'POST',{text,requestId:id()})).data;
  await eventually(async()=>(await f.request('/messages/'+m.id,a)).data.status==='complete');
  return m;
 };
 assert.equal((await send('陪我练一场面试')).roleplay,true);
 assert.equal((await send('我做供应链协调')).noMemory,true);
 assert.equal((await f.request('/memory',a)).data.length,0);
 assert.equal((await send('结束模拟，回到正常聊天')).roleplay,false);
 for(const text of ['不要记住：我做供应链协调','我的密码是123，我做供应链协调','帮我翻译：我做供应链协调'])assert.equal((await send(text)).noMemory,true);
 assert.equal((await f.request('/memory',a)).data.length,0);
 assert.equal((await send('我做供应链协调')).noMemory,false);
 await eventually(async()=>(await f.request('/memory',a)).data.length===1);
 assert.equal((await f.request('/conversations',a,'POST',{})).data.roleplay,false);
});
test('identity isolation, duplicate requests, sequential conversation, recovery',async t=>{
 const f=await fixture(t),a=await f.login('a'),b=await f.login('b');const s=(await f.request('/conversations',a,'POST',{})).data;
 assert.equal((await f.request(`/conversations/${s.id}/messages`,b)).status,404);
 const payload={text:'I need more time.',requestId:id()};const first=await f.request(`/conversations/${s.id}/messages`,a,'POST',payload);const duplicate=await f.request(`/conversations/${s.id}/messages`,a,'POST',payload);assert.equal(first.data.id,duplicate.data.id);
 const busy=await f.request(`/conversations/${s.id}/messages`,a,'POST',{text:'Another',requestId:id()});assert.equal(busy.status,409);
 await eventually(async()=>(await f.request('/messages/'+first.data.id,a)).data.status==='complete');assert.equal(f.counts().chats,1);
 assert.equal((await f.request('/messages/'+first.data.id,b)).status,404);
 assert.equal((await f.request(`/conversations/${s.id}/messages`,a)).data.length,1);
 assert.equal((await f.request(`/conversations/${s.id}/memory`,b)).status,404);
 assert.equal((await f.request(`/conversations/${s.id}/messages`,a,'POST',{text:'Changed',requestId:payload.requestId})).status,409);
});
test('memory source validation, corrections, deletion and roleplay exclusion',async t=>{
 const f=await fixture(t),a=await f.login('m-a'),b=await f.login('m-b');const s=(await f.request('/conversations',a,'POST',{})).data;
 const m=(await f.request(`/conversations/${s.id}/messages`,a,'POST',{text:'我做供应链协调',requestId:id()})).data;
 await eventually(async()=>(await f.request('/memory',a)).data.length===1);
 const fact=(await f.request('/memory',a)).data[0];assert.equal(fact.messageId,m.id);assert.equal((await f.request('/memory/'+fact.id,b,'DELETE')).status,404);
 await f.request('/memory/'+fact.id,a,'PATCH',{text:'我现在做市场'});assert.equal((await f.request('/memory',a)).data[0].source,'user-correction');
 await f.request('/memory/'+fact.id,a,'DELETE');assert.equal((await f.request('/memory',a)).data.length,0);
 const role=(await f.request('/conversations',a,'POST',{roleplay:true})).data;
 const fake=(await f.request(`/conversations/${role.id}/messages`,a,'POST',{text:'我做供应链协调',requestId:id()})).data;
 await eventually(async()=>(await f.request('/messages/'+fake.id,a)).data.status==='complete');await delay(80);assert.equal((await f.request('/memory',a)).data.length,0);
});
test('deleting memory while extraction is in flight prevents late writes',async t=>{
 let release,started=false;const waiting=new Promise(r=>release=r);
 const f=await fixture(t,{chat:async(messages,options)=>{if(options.type==='memory'){started=true;await waiting;return {text:JSON.stringify({facts:[{type:'career',text:'供应链协调岗位',evidence:'我做供应链协调'}]})};}return {text:'Let’s practice your update.'};}});
 const a=await f.login('late'),s=(await f.request('/conversations',a,'POST',{})).data;
 await f.request(`/conversations/${s.id}/messages`,a,'POST',{text:'我做供应链协调',requestId:id()});await eventually(()=>started);
 await f.request('/memory',a,'DELETE');release();await delay(100);assert.equal((await f.request('/memory',a)).data.length,0);
});
test('no-memory marker and false evidence do not persist facts',async t=>{
 const f=await fixture(t),a=await f.login('private');const s=(await f.request('/conversations',a,'POST',{})).data;
 for(const [text,noMemory] of [['我做供应链协调',true],['I am learning English.',false],['假设我做供应链协调',false]]){
  const m=(await f.request(`/conversations/${s.id}/messages`,a,'POST',{text,noMemory,requestId:id()})).data;
  await eventually(async()=>(await f.request('/messages/'+m.id,a)).data.status==='complete');await delay(40);
 }
 assert.equal((await f.request('/memory',a)).data.length,0);
});
test('TTS deduplication and atomic published text/audio versions',async t=>{
 const f=await fixture(t);
 const [one,two]=await Promise.all([f.request('/admin/corpus',f.admin,'POST',entry),f.request('/admin/corpus',f.admin,'POST',{...entry,title:'另一个表达'})]);
 assert.equal(one.data.audio.id,two.data.audio.id);await eventually(()=>f.store.get('audio',one.data.audio.id).status==='done');assert.equal(f.counts().tts,1);
 await f.request(`/admin/corpus/${one.data.corpusId}/publish`,f.admin,'POST',{reviewed:true});
 const old=(await f.request('/corpus/'+one.data.corpusId)).data;assert.equal(old.english,entry.english);
 const zh=await f.request('/admin/corpus',f.admin,'POST',{...entry,id:one.data.corpusId,chinese:'新的中文说明'});assert.equal(zh.data.audio.id,one.data.audio.id);assert.equal(f.counts().tts,1);
 const edited=await f.request('/admin/corpus',f.admin,'POST',{...entry,id:one.data.corpusId,english:'Could we revisit the timeline?'});assert.notEqual(edited.data.audio.id,one.data.audio.id);
 assert.equal((await f.request('/corpus/'+one.data.corpusId)).data.english,entry.english);
 await eventually(()=>f.store.get('audio',edited.data.audio.id).status==='done');await f.request(`/admin/corpus/${one.data.corpusId}/publish`,f.admin,'POST',{reviewed:true});
 const fresh=(await f.request('/corpus/'+one.data.corpusId)).data;assert.equal(fresh.english,'Could we revisit the timeline?');assert.notEqual(fresh.audioUrl,old.audioUrl);
 for(let i=0;i<3;i++){const r=await fetch(f.base+fresh.audioUrl);assert.equal(r.status,200);await r.arrayBuffer();}assert.equal(f.counts().tts,2);
 const range=await fetch(f.base+fresh.audioUrl,{headers:{Range:'bytes=0-2'}});assert.equal(range.status,206);
 await f.request(`/admin/corpus/${one.data.corpusId}/unpublish`,f.admin,'POST',{});assert.equal((await f.request('/corpus/'+one.data.corpusId)).status,404);assert.equal((await fetch(f.base+fresh.audioUrl)).status,401);
});
test('failed synthesis blocks publication, preserves old versions, explicit retry only',async t=>{
 let attempts=0;const f=await fixture(t,{synthesize:async()=>{attempts++;if(attempts===1)throw Error('test timeout');return Buffer.from('ID3-recovered');}});
 const draft=(await f.request('/admin/corpus',f.admin,'POST',entry)).data;await eventually(()=>f.store.get('audio',draft.audio.id).status==='failed');
 assert.equal((await f.request(`/admin/corpus/${draft.corpusId}/publish`,f.admin,'POST',{reviewed:true})).status,400);assert.equal((await f.request('/corpus')).data.length,0);
 const job=f.store.list('job').find(j=>j.audioId===draft.audio.id);assert.equal((await f.request('/admin/jobs/'+job.id+'/retry',f.admin,'POST',{})).status,400);
 await f.request('/admin/jobs/'+job.id+'/retry',f.admin,'POST',{confirmed:true});await eventually(()=>f.store.get('audio',draft.audio.id).status==='done');assert.equal(attempts,2);
});
test('permissions, four fixed root categories, safe config and rollback',async t=>{
 const f=await fixture(t),u=await f.login('u');assert.equal((await f.request('/admin/corpus',u)).status,401);
 await f.request('/admin/admins',f.admin,'POST',{username:'editor',password:'content-password-123',role:'content'});
 const editor=(await f.request('/admin/login','','POST',{username:'editor',password:'content-password-123'})).data.token;
 assert.equal((await f.request('/admin/settings',editor)).status,403);
 const editorAccount=(await f.request('/admin/admins',f.admin)).data.find(a=>a.username==='editor');
 await f.request('/admin/admins/'+editorAccount.id,f.admin,'PATCH',{role:'system'});
 assert.equal((await f.request('/admin/corpus',editor)).status,401);
 const refreshed=(await f.request('/admin/login','','POST',{username:'editor',password:'content-password-123'})).data.token;
 assert.equal((await f.request('/admin/settings',refreshed)).status,200);
 await f.request('/admin/admins/'+editorAccount.id,f.admin,'DELETE');assert.equal((await f.request('/admin/settings',refreshed)).status,401);
 assert.equal((await f.request('/admin/categories',f.admin,'POST',{name:'第五场景',parentId:null})).status,400);
 assert.equal((await f.request('/admin/categories',f.admin,'DELETE',{id:'root-0'})).status,400);
 const cfg=(await f.request('/admin/settings',f.admin)).data;assert.ok(!JSON.stringify(cfg).includes('API_KEY'));
 await f.request('/admin/settings',f.admin,'POST',{...cfg,persona:'A concise English workplace buddy.'});const versions=(await f.request('/admin/settings/versions',f.admin)).data;assert.equal(versions.length,1);
 await f.request('/admin/settings/rollback',f.admin,'POST',{id:versions[0].id});assert.equal((await f.request('/admin/settings',f.admin)).data.persona,cfg.persona);
});
test('cancellation and deleting conversation or account terminate ownership and results',async t=>{
 const f=await fixture(t,{chat:async(_,options)=>{await delay(120);if(options.signal?.aborted)throw Error('aborted');return {text:'Finished.'};}}),a=await f.login('delete');const s=(await f.request('/conversations',a,'POST',{})).data;
 const m=(await f.request(`/conversations/${s.id}/messages`,a,'POST',{text:'Hello',requestId:id()})).data;
 await f.request(`/messages/${m.id}/cancel`,a,'POST',{});await delay(150);assert.equal((await f.request('/messages/'+m.id,a)).data.status,'cancelled');
 await f.request(`/messages/${m.id}/retry`,a,'POST',{});await f.request(`/conversations/${s.id}?deleteMemory=true`,a,'DELETE');await delay(160);assert.equal((await f.request('/messages/'+m.id,a)).status,404);
 await f.request('/me',a,'DELETE');assert.equal((await f.request('/me',a)).status,401);
});
test('audio reuse key includes voice/version/parameters but excludes credentials',()=>{
 const c=ttsConfig();assert.equal(audioKey('hello',{...c,key:'a'}),audioKey('hello',{...c,key:'b'}));for(const key of ['voice','version','accent','model','provider','speed'])assert.notEqual(audioKey('hello',c),audioKey('hello',{...c,[key]:'changed'}));
});
test('WAV resources publish with matching URL and MIME type, and reject wrong extensions',async t=>{
 const prior=process.env.TTS_FORMAT;process.env.TTS_FORMAT='wav';
 t.after(()=>{if(prior===undefined)delete process.env.TTS_FORMAT;else process.env.TTS_FORMAT=prior;});
 const f=await fixture(t);const draft=(await f.request('/admin/corpus',f.admin,'POST',entry)).data;
 await eventually(()=>f.store.get('audio',draft.audio.id).status==='done');await f.request(`/admin/corpus/${draft.corpusId}/publish`,f.admin,'POST',{reviewed:true});
 const resource=(await f.request('/corpus/'+draft.corpusId)).data;assert.ok(resource.audioUrl.endsWith('.wav'));
 const response=await fetch(f.base+resource.audioUrl);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/wav');await response.arrayBuffer();
 assert.equal((await fetch(f.base+resource.audioUrl.replace('.wav','.mp3'))).status,404);
 const job=(await f.request('/admin/jobs',f.admin)).data[0];assert.equal(job.audioFormat,'wav');
});
test('short summaries preserve session boundaries and cross-session preference context',async t=>{
 const captured=[];const f=await fixture(t,{chat:async(messages,options)=>{
  captured.push(messages);
  if(options.type==='memory' && messages[0].content.startsWith('Update the prior summary'))return {text:'Temporary constraint: do not promise a specific completion date.'};
  if(options.type==='memory')return {text:'{"facts":[]}'};
  return {text:'Could we allow more preparation time?'};
 }}),a=await f.login('summary');
 const settings=(await f.request('/admin/settings',f.admin)).data;await f.request('/admin/settings',f.admin,'POST',{...settings,recentMessages:4});
 const s=(await f.request('/conversations',a,'POST',{})).data;
 f.store.put('memory',{id:id(),userId:f.store.list('user')[0].id,type:'preference',text:'Keep replies concise.',status:'active',updatedAt:new Date().toISOString()});
 for(let i=0;i<5;i++){
  const m=(await f.request(`/conversations/${s.id}/messages`,a,'POST',{text:i?'Continue the draft.':'Do not promise a specific completion date.',noMemory:true,requestId:id()})).data;
  await eventually(async()=>(await f.request('/messages/'+m.id,a)).data.status==='complete');
 }
 await eventually(async()=>(await f.request(`/conversations/${s.id}/memory`,a)).data.summary.includes('do not promise'));
 const next=(await f.request('/conversations',a,'POST',{roleplay:true})).data;
 const m=(await f.request(`/conversations/${next.id}/messages`,a,'POST',{text:'Practice an interview.',requestId:id()})).data;
 await eventually(async()=>(await f.request('/messages/'+m.id,a)).data.status==='complete');
 const prompt=captured.at(-1)[0].content;assert.ok(prompt.includes('Keep replies concise.'));assert.ok(!prompt.includes('do not promise'));assert.ok(prompt.includes('"roleplay":true'));
});
test('restart preserves completed messages and marks interrupted requests as recoverable failures',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'waiqi-restart-'));let app=createApp({directory,models:{chat:async()=>({text:'A saved reply.'}),moderate:async()=>{},synthesize:async()=>Buffer.from('ID3')}});
 t.after(async()=>{await app.close();rmSync(directory,{recursive:true,force:true});});
 const user=app.store.put('user',{id:id(),openid:'restart-test',preferences:{},memoryEpoch:0,memoryEnabled:false});
 const s=app.store.put('conversation',{id:id(),userId:user.id,title:'Saved topic',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 const complete=app.store.put('message',{id:id(),userId:user.id,sessionId:s.id,text:'Saved input',reply:'Saved reply',status:'complete'});
 const interrupted=app.store.put('message',{id:id(),userId:user.id,sessionId:s.id,text:'Interrupted',status:'generating'});
 await app.close();app=createApp({directory});
 assert.equal(app.store.get('message',complete.id).reply,'Saved reply');assert.equal(app.store.get('message',interrupted.id).status,'failed');assert.ok(app.store.get('message',interrupted.id).error.includes('重启'));
});

test('profile saves per user and preserves memory preferences',async t=>{
 const f=await fixture(t),a=await f.login('profile-a'),b=await f.login('profile-b');
 await f.request('/me',a,'PATCH',{preferences:{job:'产品经理'},memoryEnabled:false});
 const before=(await f.request('/me',a)).data;
 const avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 const saved=await f.request('/me/profile',a,'PATCH',{nickname:'小林',avatar});
 assert.equal(saved.status,200);assert.equal(saved.data.nickname,'小林');assert.equal(saved.data.avatar,avatar);
 assert.equal(saved.data.memoryEnabled,false);assert.deepEqual(saved.data.preferences,before.preferences);assert.equal(saved.data.memoryEpoch,before.memoryEpoch);
 assert.equal(saved.data.openid,undefined);
 assert.equal((await f.request('/me',a)).data.nickname,'小林');
 assert.equal((await f.request('/me',b)).data.nickname,undefined);
 assert.equal((await f.request('/me/profile','','PATCH',{nickname:'匿名'})).status,401);
 assert.equal((await f.request('/me/profile',a,'PATCH',{avatar:'data:image/png;base64,YmFk'})).status,400);
 assert.equal((await f.request('/me/profile',a,'PATCH',{nickname:' '})).status,400);
});
