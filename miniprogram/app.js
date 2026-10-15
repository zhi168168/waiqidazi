const api = require('./utils/api');
App({globalData:{activeSessionId:'',loginReady:null},onLaunch(){this.globalData.activeSessionId=wx.getStorageSync('activeSessionId')||'';this.globalData.loginReady=api.ensureLogin();}});
