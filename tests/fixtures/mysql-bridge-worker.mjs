import {parentPort,workerData} from 'node:worker_threads';
const control=new Int32Array(workerData.control),bytes=new Uint8Array(workerData.bytes);
parentPort.on('message',message=>{
  const result=message.sql==='FAIL'?{error:'test query failure',code:'TEST_ERROR'}:{value:message.op==='query'?{sql:message.sql,params:message.params}:true};
  const encoded=new TextEncoder().encode(JSON.stringify(result));bytes.set(encoded);Atomics.store(control,1,encoded.length);Atomics.store(control,0,1);Atomics.notify(control,0);
});
