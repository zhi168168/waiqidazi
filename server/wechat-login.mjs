import {AppError} from './providers.mjs';

export async function exchangeWechatCode(code,{appid=process.env.WECHAT_APP_ID,secret=process.env.WECHAT_APP_SECRET,fetchImpl=fetch}={}) {
 const endpoint=new URL('https://api.weixin.qq.com/sns/jscode2session');
 endpoint.search=new URLSearchParams({appid,secret,js_code:code,grant_type:'authorization_code'}).toString();
 let data;
 try {
  const response=await fetchImpl(endpoint,{signal:AbortSignal.timeout(15000)});
  if(!response.ok){const error=new AppError(503,'微信登录服务暂不可用，请稍后重试。');error.code='WECHAT_LOGIN_HTTP_ERROR';throw error;}
  data=await response.json();
 }catch(cause){
  if(cause instanceof AppError)throw cause;
  const raw=cause.cause?.code || cause.code;
  const code=/^[A-Z0-9_]{1,80}$/.test(raw || '')?raw:'WECHAT_LOGIN_NETWORK_ERROR';
  const error=new AppError(503,`微信登录连接失败（${code}），请稍后重试或联系管理员。`);error.code=code;throw error;
 }
 if(typeof data?.openid!=='string' || !data.openid){
  const providerCode=Number.isInteger(data?.errcode)?data.errcode:'unknown';
  const credentialsError=[40013,40125].includes(providerCode);
  const error=new AppError(credentialsError?503:401,credentialsError?'微信登录配置有误，请联系管理员。':`微信登录失败（错误码 ${providerCode}），请重新登录。`);
  error.code=Number.isInteger(providerCode)?`WECHAT_LOGIN_${providerCode}`:'WECHAT_LOGIN_INVALID_RESPONSE';throw error;
 }
 return data.openid;
}
