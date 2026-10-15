import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';

test('existing database upgrade preserves chats, facts and custom persona and runs only once',()=>{
 const directory=mkdtempSync(join(tmpdir(),'buddy-migration-'));
 let store=createStore(directory);
 try{
  const cfg=store.get('settings','current');
  store.put('settings',{...cfg,buddyVersion:undefined,version:4,persona:'保留这个自定义语气',memoryFields:['career','preference'],maxTokens:700});
  store.put('message',{id:'existing-message',text:'原聊天',reply:'原回复',status:'complete'});
  store.put('memory',{id:'existing-memory',text:'原记忆',type:'career',status:'active'});
  store.close();store=createStore(directory);
  assert.equal(store.get('settings','current').persona,'保留这个自定义语气');
  assert.ok(store.get('settings','current').memoryFields.includes('workplace'));
  assert.equal(store.get('settings','current').version,5);
  assert.equal(store.get('message','existing-message').reply,'原回复');
  assert.equal(store.get('memory','existing-memory').text,'原记忆');
  assert.equal(store.list('settings-version').length,1);
  store.close();store=createStore(directory);
  assert.equal(store.get('settings','current').version,5);
  assert.equal(store.list('settings-version').length,1);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
