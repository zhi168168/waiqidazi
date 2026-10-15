const api = require('../../utils/api');
const scenes = {
  '工作汇报': { icon: 'report', description: '汇报进展，清楚表达重点', tone: 'green' },
  '协调同事': { icon: 'team', description: '对齐信息，让协作更顺畅', tone: 'blue' },
  '客户沟通': { icon: 'client', description: '回应需求，沟通更有分寸', tone: 'sand' },
  '面试': { icon: 'interview', description: '介绍自己，从容回答问题', tone: 'violet' }
};
Page({
  data: { roots: [], loading: true, error: '' },
  onLoad() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const categories = await api.request('/categories');
      this.setData({ roots: categories.filter(c => !c.parentId).map(c => ({ ...c, ...(scenes[c.name] || scenes['工作汇报']) })) });
    } catch (e) { this.setData({ error: e.message }); }
    finally { this.setData({ loading: false }); }
  },
  scene(e) {
    const scene = this.data.roots.find(c => c.id === e.currentTarget.dataset.id);
    if (scene) wx.navigateTo({ url: '/pages/scene/index?id=' + encodeURIComponent(scene.id) + '&name=' + encodeURIComponent(scene.name) + '&description=' + encodeURIComponent(scene.description) });
  }
});
