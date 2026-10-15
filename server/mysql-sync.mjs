import { Worker } from 'node:worker_threads';

// Preserve the existing synchronous store/transaction contract. Network I/O runs
// in a dedicated worker; each call has a hard deadline and never falls back to disk.
export class MySQLSync {
  constructor({workerURL=new URL('./mysql-worker.mjs',import.meta.url), config}={}) {
    const env=process.env;
    config ||= {host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT || 3306),user:env.MYSQL_USER,database:env.MYSQL_DATABASE,password:env.MYSQL_PASSWORD};
    for(const key of ['host','user','database','password'])if(!config[key])throw Error(`缺少 MySQL 配置：${key}`);
    this.control=new Int32Array(new SharedArrayBuffer(8));
    this.bytes=new Uint8Array(new SharedArrayBuffer(16*1024*1024));
    this.worker=new Worker(workerURL,{workerData:{config,control:this.control.buffer,bytes:this.bytes.buffer}});
    this.worker.on('error',()=>{this.failed=true;});
    this.worker.on('exit',()=>{this.failed=true;});
    try {this.call({op:'ready'});}catch(error){this.worker.terminate();throw error;}
  }
  call(message) {
    if(this.failed){const error=Error('MySQL 连接已关闭。');error.code='MYSQL_CONNECTION_CLOSED';throw error;}
    Atomics.store(this.control,0,0);
    this.worker.postMessage(message);
    if(Atomics.wait(this.control,0,0,30000)==='timed-out'){
      this.failed=true;this.worker.terminate();
      const error=Error('MySQL 请求超时，连接已关闭；请检查数据库后重启服务。');error.code='MYSQL_BRIDGE_TIMEOUT';throw error;
    }
    const result=JSON.parse(new TextDecoder().decode(this.bytes.subarray(0,Atomics.load(this.control,1))));
    if(result.error){const error=Error(result.error);error.code=result.code;throw error;}
    return result.value;
  }
  exec(sql){return this.call({op:'exec',sql});}
  prepare(sql){return {
    get:(...params)=>this.call({op:'query',sql,params,mode:'get'}),
    all:(...params)=>this.call({op:'query',sql,params,mode:'all'}),
    run:(...params)=>this.call({op:'query',sql,params,mode:'run'})
  };}
  close(){if(this.failed)return;try{this.call({op:'close'});}finally{this.failed=true;this.worker.terminate();}}
}
