const config = require('../config');
function isDevLoginAllowed(){
 const device=typeof wx.getDeviceInfo==='function'?wx.getDeviceInfo():wx.getSystemInfoSync();
 return config.transport!=='cloud' && config.devLogin===true && device.platform==='devtools' && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(config.baseUrl);
}
let cloudInitialized=false;
function initCloud(){
 if(config.transport!=='cloud' || cloudInitialized)return;
 if(!wx.cloud || !wx.cloud.callContainer)throw Error('请更新微信或开发者工具后重试。');
 wx.cloud.init({env:config.cloudEnv,traceUser:true});cloudInitialized=true;
}
function request(path,method='GET',data) {
 if(config.transport==='cloud'){
  initCloud();
  return new Promise((resolve,reject)=>wx.cloud.callContainer({config:{env:config.cloudEnv},path:'/api'+path,method,data,timeout:60000,header:{'X-WX-SERVICE':config.cloudService,'Content-Type':'application/json',Authorization:'Bearer '+(wx.getStorageSync('token')||'')},success(res){if(res.statusCode>=200&&res.statusCode<300)resolve(res.data);else{if(res.statusCode===401)wx.removeStorageSync('token');reject(Error(res.data && res.data.error || '服务暂不可用'));}},fail(){reject(Error('云服务连接失败，请稍后重试。'));}}));
 }
 return new Promise((resolve,reject)=>wx.request({url:config.baseUrl+'/api'+path,method,data,timeout:100000,header:{'Content-Type':'application/json',Authorization:'Bearer '+(wx.getStorageSync('token')||'')},success(res){if(res.statusCode>=200&&res.statusCode<300)resolve(res.data);else {if(res.statusCode===401)wx.removeStorageSync('token');reject(Error(res.data.error||'服务暂不可用'));}},fail(){reject(Error('网络连接失败，请检查连接后重试。'));}}));
}
let loginPending=null;
let privacyPending=null;
async function showPrivacy(consent=false){
 const privacy=await request('/privacy');
 if(privacyPending)return privacyPending.promise;
 let resolvePrivacy,rejectPrivacy;
 const promise=new Promise((resolve,reject)=>{resolvePrivacy=resolve;rejectPrivacy=reject;});
 privacyPending={promise,resolve:resolvePrivacy,privacy,consent};
 wx.navigateTo({url:'/pages/privacy/index',fail(){privacyPending=null;rejectPrivacy(Error('无法打开隐私说明，请重试。'));}});
 return promise;
}
function privacyState(){return privacyPending?{text:privacyPending.privacy.text,consent:privacyPending.consent}:null;}
function finishPrivacy(agreed){const pending=privacyPending;privacyPending=null;if(pending)pending.resolve(agreed===true);}
async function ensureLogin(){
 if(wx.getStorageSync('token'))return true;
 if(loginPending)return loginPending;
 loginPending=(async()=>{
  try{
   if(!await showPrivacy(true))return false;
   const payload={consent:true};
   if(isDevLoginAllowed()){
    let deviceId=wx.getStorageSync('devDevice');
    if(!deviceId){deviceId=requestId();wx.setStorageSync('devDevice',deviceId);}
    payload.dev=true;payload.deviceId=deviceId;
   }else{
    payload.code=await new Promise((resolve,reject)=>wx.login({success:r=>r.code?resolve(r.code):reject(Error('微信登录失败')),fail:()=>reject(Error('微信登录失败，请重试。'))}));
   }
   const result=await request('/auth/login','POST',payload);
   wx.setStorageSync('token',result.token);return true;
  }catch(e){notify(e);return false;}
 })();
 try{return await loginPending;}finally{loginPending=null;}
}
function notify(error){wx.showToast({title:error.message||String(error),icon:'none',duration:3000});}
function active(id){getApp().globalData.activeSessionId=id;wx.setStorageSync('activeSessionId',id);}
function confirm(content){return new Promise(resolve=>wx.showModal({title:'请确认',content,success:r=>resolve(r.confirm)}));}
function requestId(){return Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);}
async function audioSource(entry){
 if(config.transport==='cloud'){
  if(!await ensureLogin())throw Error('请先登录后播放。');
  const result=await request('/corpus/'+encodeURIComponent(entry.id)+'/audio');return result.url;
 }
 return config.baseUrl+entry.audioUrl;
}
module.exports={request,ensureLogin,showPrivacy,privacyState,finishPrivacy,notify,active,confirm,requestId,isDevLoginAllowed,initCloud,audioSource,baseUrl:config.baseUrl};
