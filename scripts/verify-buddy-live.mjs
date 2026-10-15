// Isolated synthetic conversation; never writes to the user's live database.
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.mjs';
import {id} from '../server/store.mjs';

process.env.ALLOW_DEV_LOGIN='true';
const directory=mkdtempSync(join(tmpdir(),'waiqi-buddy-live-'));
const app=createApp({directory});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${app.server.address().port}/api`;
let token='';
async function request(path,method='GET',body){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw Error(result.error);return result;
}
async function wait(check){
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,300));}
 throw Error('真实模型验证超时');
}
const transcript=[];
async function send(session,text){
 const accepted=await request(`/conversations/${session.id}/messages`,'POST',{text,requestId:id()});
 const m=await wait(async()=>{const m=await request('/messages/'+accepted.id);if(m.status==='failed')throw Error(m.error);return m.status==='complete' && m;});
 assert.ok(m.englishTip?.expression && m.englishTip?.explanation,'缺少独立英文便签');
 assert.ok(!m.reply.startsWith('{'),'聊天主体泄露 JSON');
 transcript.push({user:text,reply:m.reply,englishTip:m.englishTip});
 console.log(JSON.stringify(transcript.at(-1)));
 await wait(()=>app.store.list('job').filter(j=>j.messageId===m.id).every(j=>['done','failed'].includes(j.status)));
 return m;
}
try{
 token=(await request('/auth/login','POST',{dev:true,deviceId:'isolated-buddy-verification',consent:true})).token;
 const s=await request('/conversations','POST',{});
 await send(s,'我是产品经理。我好烦啊，这个项目我既要做产品经理，还要测试，我根本做不完。我平时喜欢跑步，也喜欢读书。');
 await send(s,'我也想找人帮忙啊，可是我们公司就没有专门的测试部门。');
 let memories=await request('/memory');
 assert.ok(memories.some(m=>m.type==='career' && m.text.includes('产品经理')),'岗位未记住');
 assert.ok(memories.some(m=>m.type==='workplace' && m.text.includes('测试')),'公司条件未记住');
 assert.ok(memories.filter(m=>m.type==='interest').length>=2,'两条爱好未独立保存');
 const oldTeamIds=memories.filter(m=>m.type==='workplace' && /没有.*测试/.test(m.text)).map(m=>m.id);
 const fresh=await request('/conversations','POST',{});
 await send(fresh,'今天又被产品和测试的活压得喘不过气了。你还记得我做什么、公司有没有测试部门吗？');
 await send(fresh,'更正一下，我们公司现在已经招了两位专职测试，不是没有测试部门了。');
 memories=await request('/memory');
 console.log('纠正后记忆：'+JSON.stringify(memories.map(({type,key,text})=>({type,key,text}))));
 assert.ok(memories.some(m=>m.type==='workplace' && /两|2/.test(m.text)),'纠正后的测试人员未记住');
 assert.ok(!memories.some(m=>oldTeamIds.includes(m.id)),'旧测试条件仍然有效');
 const report='# 上班搭子真实模型验证\n\n使用隔离临时数据库与虚构用户；没有修改已有用户记录。\n\n'+transcript.map((t,i)=>`## 对话 ${i+1}\n\n用户：${t.user}\n\n搭子：${t.reply}\n\n英语便签：${t.englishTip.expression}\n\n说明：${t.englishTip.explanation}\n`).join('\n')+'\n## 有效长期记忆\n\n'+memories.map(m=>`- ${m.type} / ${m.key}：${m.text}`).join('\n')+'\n';
 writeFileSync('docs/qa/buddy-live-verification.md',report);
 console.log('真实模型：主体/便签分离、岗位/公司条件、多爱好、跨会话与自然纠正验证通过。');
}finally{await app.close();rmSync(directory,{recursive:true,force:true});}
