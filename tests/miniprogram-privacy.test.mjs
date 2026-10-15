import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('privacy page hides full policy initially and consent/back resolve without accidental login',async()=>{
 let page,finished=[],back=0;
 const api={privacyState:()=>({text:'姓名与完整政策',consent:true}),finishPrivacy:value=>finished.push(value)};
 vm.runInNewContext(readFileSync('miniprogram/pages/privacy/index.js','utf8'),{require:()=>api,Page:p=>page=p,wx:{navigateBack:()=>back++}});
 page.setData=values=>Object.assign(page.data,values);await page.onLoad();
 assert.equal(page.data.expanded,false);assert.equal(page.data.accepted,false);
 page.agree();assert.equal(back,0);assert.equal(finished.length,0);
 page.togglePolicy();assert.equal(page.data.expanded,true);
 page.acceptChange({detail:{value:['accepted']}});page.agree();assert.deepEqual(finished,[true]);assert.equal(back,1);
 page.onUnload();assert.deepEqual(finished,[true,false]);
});

test('privacy page opened from profile fetches full policy without requesting consent',async()=>{
 let page;
 const api={privacyState:()=>null,request:async path=>{assert.equal(path,'/privacy');return {text:'完整政策'};}};
 vm.runInNewContext(readFileSync('miniprogram/pages/privacy/index.js','utf8'),{require:()=>api,Page:p=>page=p});page.setData=values=>Object.assign(page.data,values);
 await page.onLoad();assert.equal(page.data.text,'完整政策');assert.equal(page.data.expanded,true);assert.equal(page.data.consent,false);
});
