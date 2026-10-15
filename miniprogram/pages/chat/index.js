const format=require('../../utils/format');
const api=require('../../utils/api');
Page({
 data:{sid:'',messages:[],text:'',pending:false,busy:false,error:'',scrollInto:'bottom'},
 async onShow(){
  const loginReady=getApp().globalData.loginReady;if(loginReady)await loginReady;
  if(!wx.getStorageSync('token')){this.setData({messages:[],sid:''});return;}
  this.pendingMessageId=wx.getStorageSync('pendingMessageId')||null;
  const sid=getApp().globalData.activeSessionId;this.setData({sid});if(sid)this.refresh();
 },
 onHide(){clearTimeout(this.timer);},onUnload(){clearTimeout(this.timer);},
 input(e){this.setData({text:e.detail.value});},
 async refresh(){
  clearTimeout(this.timer);
  try{
   if(this.pendingMessageId){
    const latest=await api.request('/messages/'+this.pendingMessageId);
    if(latest.sessionId!==this.data.sid){api.active(latest.sessionId);this.setData({sid:latest.sessionId});}
    if(!['queued','generating'].includes(latest.status)){this.pendingMessageId=null;wx.removeStorageSync('pendingMessageId');}
   }
   const messages=await api.request(`/conversations/${this.data.sid}/messages`);
   const pending=messages.some(m=>['queued','generating'].includes(m.status));
   messages.forEach(m=>{if(m.status==='complete')m.replyNodes=format.replyNodes(m.reply);m.tipExpanded=Boolean(this.openTips && this.openTips[m.id]);m.englishExpanded=Boolean(this.openEnglish && this.openEnglish[m.id]);m.englishLoading=Boolean(this.translationPending && this.translationPending[m.id]);m.englishError=this.translationErrors && this.translationErrors[m.id] || '';if(m.englishReply)m.englishNodes=format.replyNodes(m.englishReply);});
   this.setData({messages,pending,scrollInto:'bottom'});
   if(pending)this.timer=setTimeout(()=>this.refresh(),600);
  }catch(e){this.setData({error:e.message});}
 },
 async createSession(){if(!await api.ensureLogin())return;try{const s=await api.request('/conversations','POST',{});api.active(s.id);this.setData({sid:s.id,messages:[],pending:false,error:''});clearTimeout(this.timer);}catch(e){api.notify(e);}},
 async login(){if(await api.ensureLogin())this.onShow();},
 suggest(e){this.setData({text:e.currentTarget.dataset.text});},
 async send(){
  if(!await api.ensureLogin()||!this.data.text.trim()||this.data.pending||this.data.busy)return;
  this.setData({busy:true,error:''});
  try{
   if(!this.data.sid)await this.createSession();if(!this.data.sid)throw Error('创建会话失败');
   let attempt=this.attempt;
   if(!attempt || attempt.text!==this.data.text || attempt.sid!==this.data.sid)attempt={text:this.data.text,requestId:api.requestId(),sid:this.data.sid};
   this.attempt=attempt;
   const accepted=await api.request(`/conversations/${this.data.sid}/messages`,'POST',attempt);
   this.pendingMessageId=accepted.id;wx.setStorageSync('pendingMessageId',accepted.id);this.attempt=null;this.setData({text:''});await this.refresh();
  }catch(e){this.setData({error:e.message});}finally{this.setData({busy:false});}
 },
 toggleTip(e){
  const key=e.currentTarget.dataset.id;this.openTips=this.openTips || {};this.openTips[key]=!this.openTips[key];
  this.setData({messages:this.data.messages.map(m=>m.id===key?Object.assign({},m,{tipExpanded:this.openTips[key]}):m)});
 },
 copyTip(e){const m=this.data.messages.find(m=>m.id===e.currentTarget.dataset.id);if(m && m.englishTip)wx.setClipboardData({data:m.englishTip.expression});},
 async toggleEnglish(e){
  const key=e.currentTarget.dataset.id,m=this.data.messages.find(m=>m.id===key);
  if(!m || m.status!=='complete')return;
  this.openEnglish=this.openEnglish || {};this.translationPending=this.translationPending || {};this.translationErrors=this.translationErrors || {};
  if(this.translationPending[key])return;
  const update=fields=>this.setData({messages:this.data.messages.map(row=>row.id===key?Object.assign({},row,fields):row)});
  if(m.englishReply){this.openEnglish[key]=!this.openEnglish[key];update({englishExpanded:this.openEnglish[key],englishNodes:format.replyNodes(m.englishReply)});return;}
  this.openEnglish[key]=true;this.translationPending[key]=true;this.translationErrors[key]='';
  update({englishExpanded:true,englishLoading:true,englishError:''});
  try{
   const result=await api.request(`/messages/${key}/english`,'POST',{});
   update({englishReply:result.english,englishNodes:format.replyNodes(result.english),englishExpanded:true});
  }catch(err){this.translationErrors[key]=err.message;update({englishError:err.message});}
  finally{this.translationPending[key]=false;update({englishLoading:false});}
 },
 async retry(e){try{await api.request(`/messages/${e.currentTarget.dataset.id}/retry`,'POST',{});await this.refresh();}catch(err){api.notify(err);}},
 async cancel(e){try{await api.request(`/messages/${e.currentTarget.dataset.id}/cancel`,'POST',{});await this.refresh();}catch(err){api.notify(err);}},
});
