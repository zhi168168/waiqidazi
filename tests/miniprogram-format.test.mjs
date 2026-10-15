import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={module:{exports:{}}};vm.runInNewContext(readFileSync('miniprogram/utils/format.js','utf8'),context);
const {replyNodes}=context.module.exports;
const plain=nodes=>nodes.map(n=>n.type==='text'?n.text:n.name==='br'?'\n':plain(n.children||[])).join('');
test('native message formatting preserves numbers and text while emphasizing headings',()=>{
 const nodes=replyNodes('## Progress\nDelivered **12 units**.\n\nETA: 2026-10-12, 8.33%.');
 assert.equal(nodes.length,2);assert.equal(plain(nodes[0].children),'Progress\nDelivered 12 units.');
 assert.equal(plain(nodes[1].children),'ETA: 2026-10-12, 8.33%.');
 assert.equal(nodes[0].children[0].name,'strong');
});
test('model HTML remains plain text instead of active native markup',()=>{
 const input='<img src="evil" onerror="alert(1)">';
 const nodes=replyNodes(input);assert.equal(plain(nodes),input);
 assert.equal(nodes[0].children[0].type,'text');
});
