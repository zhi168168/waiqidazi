const api=require('../../utils/api');
Page({
 data:{text:'',consent:false,expanded:false,accepted:false,loading:false,error:''},
 async onLoad(){
  const pending=api.privacyState();
  if(pending){this.setData(pending);return;}
  this.setData({loading:true});
  try{const policy=await api.request('/privacy');this.setData({text:policy.text,expanded:true});}
  catch(error){this.setData({error:error.message});}
  finally{this.setData({loading:false});}
 },
 togglePolicy(){this.setData({expanded:!this.data.expanded});},
 acceptChange(e){this.setData({accepted:e.detail.value.includes('accepted')});},
 agree(){if(!this.data.accepted)return;api.finishPrivacy(true);wx.navigateBack();},
 decline(){api.finishPrivacy(false);wx.navigateBack();},
 onUnload(){api.finishPrivacy(false);}
});
