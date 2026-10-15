import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import COS from 'cos-nodejs-sdk-v5';
import { createClient } from '@supabase/supabase-js';

export function createAudioStorage(directory,{client,fetchImpl=fetch}={}) {
  if(process.env.AUDIO_STORAGE==='supabase') {
    if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('请配置 Supabase 服务端存储凭证。');
    const storage=(client || createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})).storage.from(process.env.SUPABASE_AUDIO_BUCKET || 'buddy-audio');
    return {cloud:true,
      async save(key,bytes){const {error}=await storage.upload(key,bytes,{contentType:key.endsWith('.wav')?'audio/wav':'audio/mpeg',upsert:true});if(error)throw Error('音频保存失败，请检查私有存储桶配置。');return {storage:'supabase',objectKey:key};},
      async read(key){const {data,error}=await storage.download(key);if(error)throw Error('音频读取失败。');return Buffer.from(await data.arrayBuffer());},
      async url(key){const {data,error}=await storage.createSignedUrl(key,120);if(error)throw Error('音频授权失败。');return data.signedUrl;}
    };
  }
  const cloud=process.env.AUDIO_STORAGE==='cos';
  const audioDir=resolve(directory,'audio');
  if(!cloud){mkdirSync(audioDir,{recursive:true});return {
    cloud:false,
    save:async(key,bytes)=>{writeFileSync(resolve(audioDir,key),bytes);return {storage:'local'};},
    read:async key=>readFileSync(resolve(audioDir,key)),
    url:async key=>`/audio/${key}`
  };}
  const Bucket=process.env.COS_BUCKET,Region=process.env.COS_REGION;
  if(!Bucket || !Region)throw Error('对象存储需要配置 COS_BUCKET 和 COS_REGION。');
  async function internal(path,body) {
    // Official cloud-hosting open API proxy. No user-supplied endpoint or keys.
    const response=await fetchImpl(`http://api.weixin.qq.com/_/cos/${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('云托管对象存储授权服务暂不可用。');
    const data=await response.json();if(data.errcode)throw Error('云托管对象存储授权失败。');return data;
  }
  const cos=client || new COS({Protocol:'https:',Timeout:20000,getAuthorization:(_options,callback)=>{
    internal('getauth').then(data=>{
      if(!data.TmpSecretId || !data.TmpSecretKey || !data.Token)throw Error('对象存储临时授权不完整。');
      callback({TmpSecretId:data.TmpSecretId,TmpSecretKey:data.TmpSecretKey,SecurityToken:data.Token,ExpiredTime:Number(data.ExpiredTime)});
    }).catch(error=>callback({error}));
  }});
  const params=key=>({Bucket,Region,Key:`audio/${key}`});
  const call=(method,args)=>new Promise((resolve,reject)=>cos[method](args,(error,data)=>error?reject(error):resolve(data)));
  return {
    cloud:true,
    async save(key,bytes){
      const Key=params(key).Key;
      const meta=await internal('metaid/encode',{openid:'',bucket:Bucket,paths:[Key]});
      const fileid=meta.respdata?.x_cos_meta_field_strs?.[0];if(!fileid)throw Error('对象存储文件元数据获取失败。');
      await call('putObject',{...params(key),Body:bytes,ContentLength:bytes.length,ContentType:key.endsWith('.wav')?'audio/wav':'audio/mpeg',Headers:{'x-cos-meta-fileid':fileid}});
      return {storage:'cos',objectKey:Key};
    },
    async read(key){const data=await call('getObject',params(key));return Buffer.from(data.Body);},
    async url(key){const data=await call('getObjectUrl',{...params(key),Sign:true,Expires:600});if(!data.Url?.startsWith('https://'))throw Error('音频链接生成失败。');return data.Url;}
  };
}
