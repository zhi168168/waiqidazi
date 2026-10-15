import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
function page(name, request) {
 let definition; const navigations=[], titles=[];
 vm.runInNewContext(readFileSync(`miniprogram/pages/${name}/index.js`,'utf8'),{
  Page:d=>definition=d,require:()=>({request,notify:()=>{}}),
  wx:{navigateTo:o=>navigations.push(o.url),setNavigationBarTitle:o=>titles.push(o.title)},setTimeout,clearTimeout
 });
 definition.data=structuredClone(definition.data);
 definition.setData=updates=>Object.assign(definition.data,updates);
 return {page:definition,navigations,titles};
}
const categories=[{id:'root-1',name:'工作汇报',parentId:null},{id:'root-2',name:'协调同事',parentId:null},{id:'root-3',name:'客户沟通',parentId:null},{id:'root-4',name:'面试',parentId:null},{id:'sub-1',name:'进度汇报',parentId:'root-1'},{id:'sub-2',name:'任务协调',parentId:'root-2'}];
test('library shows large root entrances and navigates to a scoped scene without fetching corpus',async()=>{
 const calls=[];const p=page('library',async path=>{calls.push(path);return categories;});
 await p.page.load();assert.deepEqual(calls,['/categories']);assert.equal(p.page.data.roots.length,4);
 for(const scene of p.page.data.roots){assert.ok(existsSync(`miniprogram/assets/icons/scene-${scene.icon}.png`));p.page.scene({currentTarget:{dataset:{id:scene.id}}});const url=new URL(p.navigations.at(-1),'https://test');assert.equal(url.pathname,'/pages/scene/index');assert.equal(url.searchParams.get('id'),scene.id);assert.equal(url.searchParams.get('name'),scene.name);}
});
test('scene searches only its selected root, retains filters and opens detail',async()=>{
 const calls=[];const p=page('scene',async path=>{calls.push(path);return path==='/categories'?categories:[{id:'entry-1'}];});
 p.page.onLoad({id:'root-1',name:'工作汇报'});await new Promise(r=>setImmediate(r));
 assert.equal(p.titles[0],'工作汇报');assert.equal(p.page.data.subs.length,1);assert.equal(p.page.data.subs[0].id,'sub-1');
 p.page.setData({q:'项目 & 进展',subcategory:'sub-1',channel:'邮件',formality:'正式'});await p.page.search();
 const query=new URL(calls.at(-1),'https://test').searchParams;
 assert.equal(query.get('category'),'root-1');assert.equal(query.get('subcategory'),'sub-1');assert.equal(query.get('q'),'项目 & 进展');assert.equal(query.get('channel'),'邮件');assert.equal(query.get('formality'),'正式');
 p.page.detail({currentTarget:{dataset:{id:'entry-1'}}});assert.equal(p.navigations[0],'/pages/detail/index?id=entry-1');
});
test('missing scene never fetches unscoped corpus and stale searches cannot replace current results',async()=>{
 const missing=page('scene',async()=>{throw Error('unexpected');});missing.page.onLoad({});assert.match(missing.page.data.error,/场景不存在/);
 const resolvers=[];const p=page('scene',()=>new Promise(resolve=>resolvers.push(resolve)));p.page.setData({category:'root-1'});
 const first=p.page.search();p.page.setData({q:'最新'});const second=p.page.search();resolvers[1]([{id:'new'}]);await second;resolvers[0]([{id:'old'}]);await first;assert.equal(p.page.data.entries[0].id,'new');
});
