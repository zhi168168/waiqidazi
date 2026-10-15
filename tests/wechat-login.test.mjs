import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exchangeWechatCode} from '../server/wechat-login.mjs';

test('WeChat login verifies code and sanitizes credential, network and malformed failures',async()=>{
 const config={appid:'test-app',secret:'secret-do-not-display'};
 const openid=await exchangeWechatCode('one-time-code',{...config,fetchImpl:async url=>{
  assert.equal(url.protocol,'https:');assert.equal(url.hostname,'api.weixin.qq.com');assert.equal(url.searchParams.get('js_code'),'one-time-code');assert.equal(url.searchParams.get('secret'),config.secret);
  return Response.json({openid:'verified-user',session_key:'never-exposed'});
 }});assert.equal(openid,'verified-user');
 const tls=Object.assign(Error('url-with-secret'),{cause:{code:'SELF_SIGNED_CERT_IN_CHAIN'}});
 await assert.rejects(()=>exchangeWechatCode('code',{...config,fetchImpl:async()=>{throw tls;}}),error=>error.status===503&&error.code==='SELF_SIGNED_CERT_IN_CHAIN'&&!error.message.includes('url-with-secret'));
 for(const errcode of [40125,40013,40029]){
  await assert.rejects(()=>exchangeWechatCode('code',{...config,fetchImpl:async()=>Response.json({errcode,errmsg:config.secret})}),error=>error.code===`WECHAT_LOGIN_${errcode}`&&!error.message.includes(config.secret));
 }
 await assert.rejects(()=>exchangeWechatCode('code',{...config,fetchImpl:async()=>new Response('bad',{status:502})}),error=>error.code==='WECHAT_LOGIN_HTTP_ERROR');
 await assert.rejects(()=>exchangeWechatCode('code',{...config,fetchImpl:async()=>Response.json({openid:{invalid:true}})}),error=>error.code==='WECHAT_LOGIN_INVALID_RESPONSE');
});
