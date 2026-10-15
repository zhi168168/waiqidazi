import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decideTopic} from '../server/topic-policy.mjs';
const recent=[{id:'actual',text:'我做供应链协调',roleplay:false,noMemory:false},{id:'fiction',text:'我有十年面试经验',roleplay:true},{id:'private',text:'私密事项',roleplay:false,noMemory:true}];
test('topic carry-over excludes private, fictional and invented references',async()=>{
 const result=await decideTopic(async()=>({text:JSON.stringify({newTopic:true,confidence:0.9,title:'客户沟通',carryMessageIds:['fiction','private','unknown','actual']})}),'客户邮件',{},recent,'');
 assert.deepEqual(result.carryMessageIds,['actual']);
});
test('uncertain, invalid or unavailable topic decisions keep the current conversation',async()=>{
 for(const response of ['{"newTopic":true,"confidence":0.6}','{"newTopic":true,"confidence":"0.99"}','bad json'])assert.equal(await decideTopic(async()=>({text:response}),'继续',{},recent,''),null);
 assert.equal(await decideTopic(async()=>{throw Error('upstream unavailable');},'继续',{},recent,''),null);
});
