import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chat,synthesize,moderate,normalizeWave} from '../server/providers.mjs';

test('compatible model HTTP adapters: JSON, streaming, TTS, safety and sanitized failures',async t=>{
 const seen=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const p of req)raw+=p;const data=JSON.parse(raw);seen.push({path:req.url,data,auth:req.headers.authorization});
  if(req.url==='/v1/chat/completions'){
   if(data.model==='bad'){res.writeHead(401);res.end('provider-secret-error');return;}
   if(data.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});const line='data: '+JSON.stringify({choices:[{delta:{content:'Could we revisit the timeline?'}}]})+'\n\n';res.write(line.slice(0,18));res.write(line.slice(18));res.end('data: [DONE]\n\n');}
   else {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:data.response_format?'{}':'Hello.'}}],usage:{total_tokens:9}}));}
  }else if(req.url==='/v1/audio/speech'){res.setHeader('Content-Type','audio/mpeg');res.end(Buffer.from('ID3-test-audio'));}
  else if(req.url==='/safety'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({allowed:data.text!=='blocked'}));}
  else {res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const names=['LLM_BASE_URL','LLM_MODEL','LLM_API_KEY','MEMORY_MODEL','MEMORY_BASE_URL','MEMORY_API_KEY','CONTENT_SAFETY_URL'];const prior=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 t.after(async()=>{await new Promise(r=>server.close(r));for(const n of names){if(prior[n]===undefined)delete process.env[n];else process.env[n]=prior[n];}});
 process.env.LLM_BASE_URL=base+'/v1';process.env.LLM_MODEL='test-model';process.env.LLM_API_KEY='local-test-token';process.env.CONTENT_SAFETY_URL=base+'/safety';
 const plain=await chat([{role:'user',content:'Hello'}]);assert.equal(plain.text,'Hello.');assert.equal(plain.usage.total_tokens,9);
 const chunks=[];const streaming=await chat([{role:'user',content:'Hello'}],{onChunk:c=>chunks.push(c)});assert.equal(streaming.text,'Could we revisit the timeline?');assert.equal(chunks.length,1);
 process.env.MEMORY_MODEL='memory-model';process.env.MEMORY_BASE_URL=base+'/v1';process.env.MEMORY_API_KEY='memory-test-key';await chat([{role:'user',content:'explicit facts'}],{type:'memory',json:true});assert.equal(seen.at(-1).data.model,'memory-model');assert.deepEqual(seen.at(-1).data.response_format,{type:'json_object'});
 const bytes=await synthesize('Hello',{baseUrl:base+'/v1',key:'speech-test-key',model:'speech-model',voice:'voice-a',speed:1,format:'mp3'});assert.equal(bytes.toString(),'ID3-test-audio');assert.equal(seen.at(-1).data.input,'Hello');
 await moderate('hello');await assert.rejects(()=>moderate('blocked'),/安全检查/);
 process.env.LLM_MODEL='bad';await assert.rejects(()=>chat([{role:'user',content:'hello'}]),error=>error.status===502&&!error.message.includes('provider-secret-error'));
 process.env.LLM_API_KEY='';await assert.rejects(()=>chat([{role:'user',content:'hello'}]),/尚未配置/);
});
test('Aliyun Qwen-Audio uses native synthesis, downloads WAV without credential forwarding',async t=>{
 const originalFetch=globalThis.fetch,seen=[];
 const wav=Buffer.alloc(48);wav.write('RIFF',0);wav.writeUInt32LE(40,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);
 globalThis.fetch=async(url,options)=>{seen.push({url:String(url),options});if(seen.length===1)return new Response(JSON.stringify({output:{audio:{url:'https://test-audio.example/generated.wav'}}}),{status:200,headers:{'Content-Type':'application/json'}});return new Response(wav,{status:200,headers:{'Content-Type':'audio/wav'}});};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const config={baseUrl:'https://test-workspace.cn-beijing.maas.aliyuncs.com/api/v1',key:'test-only',model:'qwen-audio-3.0-tts-flash',voice:'longanhuan_v3.6',provider:'aliyun-qwen-audio',format:'wav',sampleRate:24000,speed:1};
 const result=await synthesize('Could we have more preparation time?',config);
 assert.deepEqual(result,wav);assert.ok(seen[0].url.endsWith('/services/audio/tts/SpeechSynthesizer'));
 assert.deepEqual(JSON.parse(seen[0].options.body).input,{text:'Could we have more preparation time?',voice:'longanhuan_v3.6',format:'wav',sample_rate:24000});assert.equal(seen[0].options.headers.Authorization,'Bearer test-only');assert.equal(seen[1].options.headers,undefined);
 globalThis.fetch=async()=>new Response(JSON.stringify({output:{audio:{url:'http://localhost/private'}}}),{status:200});await assert.rejects(()=>synthesize('hello',config),/HTTPS/);
 const ossCalls=[];globalThis.fetch=async(url,options)=>{ossCalls.push({url:String(url),options});return ossCalls.length===1?new Response(JSON.stringify({output:{audio:{url:'http://test-bucket.oss-cn-beijing.aliyuncs.com/audio.wav?signature=preserved'}}}),{status:200}):new Response(wav,{status:200});};
 await synthesize('hello',config);assert.equal(ossCalls[1].url,'https://test-bucket.oss-cn-beijing.aliyuncs.com/audio.wav?signature=preserved');assert.equal(ossCalls[1].options.headers,undefined);
 await assert.rejects(()=>synthesize('hello',{...config,speed:1.25}),/默认合成语速/);
 const streamingWave=Buffer.from(wav);streamingWave.writeUInt32LE(2147483583,4);streamingWave.writeUInt32LE(2147483547,40);const repaired=normalizeWave(streamingWave);assert.equal(repaired.readUInt32LE(4),40);assert.equal(repaired.readUInt32LE(40),4);
});
