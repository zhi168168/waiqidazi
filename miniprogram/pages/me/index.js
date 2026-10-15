const api = require('../../utils/api');

Page({
  data: { me: null, avatarUrl: '', saving: false, loggingIn: false },
  async onShow() {
    const ready = getApp().globalData.loginReady;
    if (ready) await ready;
    if (wx.getStorageSync('token')) await this.load();
    else this.setData({ me: null, avatarUrl: '' });
  },
  showProfile(me) {
    let avatarUrl = '';
    if (me.avatar) {
      try {
        const match = me.avatar.match(/^data:image\/(png|jpeg);base64,(.+)$/);
        if (match) {
          avatarUrl = wx.env.USER_DATA_PATH + '/profile-avatar.' + (match[1] === 'png' ? 'png' : 'jpg');
          wx.getFileSystemManager().writeFileSync(avatarUrl, match[2], 'base64');
        }
      } catch (e) { api.notify(Error('头像加载失败，请重新选择。')); }
    }
    this.setData({ me, avatarUrl });
  },
  async load() {
    try { this.showProfile(await api.request('/me')); }
    catch (e) {
      if (!wx.getStorageSync('token')) this.setData({ me: null, avatarUrl: '' });
      api.notify(e);
    }
  },
  async login() {
    this.setData({ loggingIn: true });
    try { if (await api.ensureLogin()) await this.load(); }
    finally { this.setData({ loggingIn: false }); }
  },
  showPrivacy(){wx.navigateTo({url:'/pages/privacy/index'});},
  async saveProfile(updates) {
    this.setData({ saving: true });
    try { this.showProfile(await api.request('/me/profile', 'PATCH', updates)); }
    catch (e) { api.notify(e); }
    finally { this.setData({ saving: false }); }
  },
  async saveNickname(e) {
    const nickname = e.detail.value.trim();
    if (nickname && nickname !== this.data.me.nickname) await this.saveProfile({ nickname });
  },
  async chooseAvatar(e) {
    if (!e.detail.avatarUrl || this.data.saving) return;
    this.setData({ saving: true });
    try {
      const image = await new Promise((resolve, reject) => wx.compressImage({
        src: e.detail.avatarUrl, quality: 80, compressedWidth: 256, compressedHeight: 256,
        success: resolve, fail: reject
      }));
      const bytes = wx.getFileSystemManager().readFileSync(image.tempFilePath);
      const signature = new Uint8Array(bytes);
      const type = signature[0] === 137 ? 'png' : 'jpeg';
      await this.saveProfile({ avatar: 'data:image/' + type + ';base64,' + wx.arrayBufferToBase64(bytes) });
    } catch (e) { api.notify(Error('头像保存失败，请重新选择。')); }
    finally { this.setData({ saving: false }); }
  }
});
