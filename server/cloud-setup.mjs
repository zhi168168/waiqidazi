import http from 'node:http';

export function missingCloudConfig(env=process.env){
  return ['MYSQL_HOST','MYSQL_USER','MYSQL_DATABASE','MYSQL_PASSWORD','ADMIN_PASSWORD','COS_BUCKET','COS_REGION'].filter(key=>!env[key]?.trim());
}

// Container readiness and business readiness are separate during first setup.
// This server never opens a database, creates an admin, or accepts credentials.
export function createSetupApp({missing=[],errorCode=null}={}){
  let status=missing.length?'configuration_required':'initialization_failed';
  let active=null,closing=null;
  const server=http.createServer((req,res)=>{
    if(active){active.server.emit('request',req,res);return;}
    const health=req.method==='GET' && req.url?.split('?')[0]==='/api/health';
    res.writeHead(health?200:503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(health?{ok:false,status,missing,errorCode,devLogin:false,database:'not_ready',audioStorage:'not_ready'}:{error:'服务正在配置中，暂未开放。',status}));
  });
  server.requestTimeout=120000;
  return {
    server,
    update(next){status=next.status;errorCode=next.errorCode;},
    activate(app){if(active || closing)throw Error('不能重复激活服务。');active=app;},
    close(){return closing ||= (async()=>{await new Promise(resolve=>server.close(resolve));if(active)await active.close();})();}
  };
}

export function createCloudApp(factory,{env=process.env,retryDelay=5000,onState=()=>{}}={}){
  const missing=missingCloudConfig(env),app=createSetupApp({missing});
  let timer=null,closed=false;
  const attempt=()=>{
    if(closed)return;
    try{
      const active=factory();app.activate(active);
      onState({status:'ready'});
    }catch(error){
      const busy=error.code==='APP_INSTANCE_BUSY';
      const state={status:busy?'waiting_for_previous_instance':'initialization_failed',errorCode:error.code || 'STARTUP_ERROR'};
      app.update(state);onState({...state,message:error.message});
      // Only contention is retried. Never retry authentication/schema failures,
      // and never remove another process's lock or start concurrent model jobs.
      if(busy)timer=setTimeout(attempt,retryDelay);
    }
  };
  if(missing.length)onState({status:'configuration_required',missing});else attempt();
  const close=app.close;
  app.close=()=>{closed=true;clearTimeout(timer);return close();};
  return app;
}
