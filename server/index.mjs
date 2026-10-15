import { createApp } from './app.mjs';
import { createCloudApp } from './cloud-setup.mjs';
const host=process.env.HOST || '127.0.0.1';
const cloud=process.env.DEPLOYMENT_TARGET==='wechat-cloudrun';
if(cloud){
  if(process.env.DB_DRIVER!=='mysql' || process.env.AUDIO_STORAGE!=='cos')throw Error('云托管必须使用 MySQL 和对象存储，不能使用容器临时磁盘保存业务数据。');
  if(process.env.ALLOW_DEV_LOGIN==='true')throw Error('云托管不能开启开发登录。');
}
if(process.env.ALLOW_DEV_LOGIN==='true' && !['localhost','127.0.0.1','::1'].includes(host))throw new Error('开发登录只能在回环地址开启。');
const app=cloud?createCloudApp(createApp,{onState:state=>{
  if(state.status==='ready')console.log('职场英语搭子初始化完成，业务接口已开放。');
  else if(state.status==='configuration_required')console.log(`职场英语搭子等待环境变量配置：${state.missing.join(', ')}。业务接口关闭。`);
  else if(state.status==='waiting_for_previous_instance')console.log('职场英语搭子等待旧实例退出，每 5 秒自动重试。业务接口关闭。');
  else console.error('职场英语搭子初始化失败，业务接口关闭：',state.message);
}}):createApp();
app.server.listen(Number(process.env.PORT || 8838),host,()=>console.log(`职场英语搭子进程已监听：http://${host}:${process.env.PORT || 8838}`));
process.on('SIGINT',async()=>{await app.close();process.exit(0);});
process.on('SIGTERM',async()=>{await app.close();process.exit(0);});
