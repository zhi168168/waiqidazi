import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseBuddyReply,streamingBuddyReply,selectMemories} from '../server/buddy-policy.mjs';

test('streamed structured reply never leaks JSON or the separate English tip',()=>{
 const body='这安排太离谱了。\n你说“忙不过来”，我听见了。';
 const output=JSON.stringify({reply:body,englishTip:{expression:"I just can't keep up.",explanation:'忙不过来。'}});
 for(let i=0;i<=output.length;i++){
  const partial=streamingBuddyReply(output.slice(0,i));
  assert.ok(body.startsWith(partial));
  assert.ok(!partial.includes('englishTip'));
 }
 assert.deepEqual(parseBuddyReply(output),{reply:body,englishTip:{expression:"I just can't keep up.",explanation:'忙不过来。'}});
 assert.equal(streamingBuddyReply('{"reply":"a\\u4f'), 'a');
 assert.equal(parseBuddyReply('旧的纯文本回复').englishTip,null);
 assert.throws(()=>parseBuddyReply('{"englishTip":{}}'));
});

test('stable role and workplace survive keyword-free venting and many interests',()=>{
 const memories=[{id:'role',type:'career',text:'用户是产品经理',updatedAt:'2026-01-01'}, {id:'team',type:'workplace',text:'公司没有测试部门',updatedAt:'2026-01-01'},...Array.from({length:55},(_,i)=>({id:String(i),type:'interest',text:'用户喜欢活动'+i,updatedAt:'2026-10-01'}))];
 const selected=selectMemories(memories,'好烦啊');
 assert.equal(selected.length,40);
 assert.ok(selected.some(m=>m.text==='用户是产品经理'));
 assert.ok(selected.some(m=>m.text==='公司没有测试部门'));
});
