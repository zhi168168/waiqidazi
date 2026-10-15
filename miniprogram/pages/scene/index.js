const api = require('../../utils/api');
Page({
  data: { sceneName: '', sceneDescription: '', subs: [], category: '', subcategory: '', entries: [], q: '', channel: '', formality: '', channels: ['全部方式', '口头', '邮件', '即时消息'], tones: ['全部语气', '自然', '正式', '轻松'], loading: true, error: '' },
  onLoad(query) {
    this.setData({ category: query.id || '', sceneName: query.name || '场景语料', sceneDescription: query.description || '找到此刻用得上的好表达。' });
    wx.setNavigationBarTitle({ title: this.data.sceneName });
    if (!this.data.category) { this.setData({ loading: false, error: '场景不存在，请返回重新选择。' }); return; }
    api.request('/categories').then(categories => this.setData({ subs: categories.filter(c => c.parentId === this.data.category) })).catch(api.notify);
    this.search();
  },
  input(e) { this.setData({ q: e.detail.value }); clearTimeout(this.timer); this.timer = setTimeout(() => this.search(), 350); },
  onUnload() { clearTimeout(this.timer); this.generation = (this.generation || 0) + 1; },
  sub(e) { this.setData({ subcategory: e.currentTarget.dataset.id }); this.search(); },
  channel(e) { this.setData({ channel: Number(e.detail.value) ? this.data.channels[e.detail.value] : '' }); this.search(); },
  tone(e) { this.setData({ formality: Number(e.detail.value) ? this.data.tones[e.detail.value] : '' }); this.search(); },
  async search() {
    if (!this.data.category) return;
    clearTimeout(this.timer);
    const generation = (this.generation || 0) + 1; this.generation = generation;
    this.setData({ loading: true, error: '' });
    const params = ['q', 'category', 'subcategory', 'channel', 'formality'].map(k => k + '=' + encodeURIComponent(this.data[k])).join('&');
    try {
      const entries = await api.request('/corpus?' + params);
      if (this.generation === generation) this.setData({ entries });
    } catch (e) { if (this.generation === generation) this.setData({ error: e.message }); }
    finally { if (this.generation === generation) this.setData({ loading: false }); }
  },
  detail(e) { wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(e.currentTarget.dataset.id) }); }
});
