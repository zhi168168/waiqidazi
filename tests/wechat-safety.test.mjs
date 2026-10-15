import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moderate,safetyReady} from '../server/providers.mjs';

test('WeChat safety uses authenticated identity, bounded Unicode chunks and fails closed',async t=>{
  const oldFetch=globalThis.fetch,oldProvider=process.env.CONTENT_SAFETY_PROVIDER;
  t.after(()=>{globalThis.fetch=oldFetch;if(oldProvider===undefined)delete process.env.CONTENT_SAFETY_PROVIDER;else process.env.CONTENT_SAFETY_PROVIDER=oldProvider;});
  process.env.CONTENT_SAFETY_PROVIDER='wechat-cloudrun';
  assert.equal(safetyReady(),true);
  const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return Response.json({errcode:0,result:{suggest:'pass'}});};
  await assert.rejects(()=>moderate('hello'),/真实小程序用户/);
  await assert.rejects(()=>moderate('hello',{openid:'dev:test'}),/真实小程序用户/);
  assert.equal(calls.length,0);
  const text='🙂'.repeat(5000);await moderate(text,{openid:'verified-user'});
  assert.equal(calls.length,3);
  assert.equal(calls[0].url,'http://api.weixin.qq.com/wxa/msg_sec_check');
  for(const call of calls){assert.equal(call.body.openid,'verified-user');assert.equal(call.body.version,2);assert.equal(call.body.scene,2);assert.ok(Array.from(call.body.content).length<=2400);assert.equal(call.options.headers.Authorization,undefined);}
  assert.equal(calls[0].body.content+Array.from(calls[1].body.content).slice(100).join('')+Array.from(calls[2].body.content).slice(100).join(''),text);
  for(const suggest of ['risky','review']){globalThis.fetch=async()=>Response.json({errcode:0,result:{suggest}});await assert.rejects(()=>moderate('text',{openid:'verified-user'}),error=>error.status===422);}
  for(const payload of [{errcode:0},{errcode:0,result:{suggest:'unknown'}},{errcode:48001,errmsg:'private-provider-detail'}]){globalThis.fetch=async()=>Response.json(payload);await assert.rejects(()=>moderate('text',{openid:'verified-user'}),error=>error.status===503&&!error.message.includes('private-provider-detail'));}
  globalThis.fetch=async()=>Response.json({errcode:61010});await assert.rejects(()=>moderate('text',{openid:'verified-user'}),error=>error.status===401);
  globalThis.fetch=async()=>{throw new Error('private-network-details');};await assert.rejects(()=>moderate('text',{openid:'verified-user'}),error=>error.status===503&&!error.message.includes('private-network-details'));
});
