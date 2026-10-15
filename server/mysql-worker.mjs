import { parentPort,workerData } from 'node:worker_threads';
import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';

const control=new Int32Array(workerData.control),bytes=new Uint8Array(workerData.bytes);
let connection;
const ready=(async()=>{
  connection=await mysql.createConnection({...workerData.config,charset:'utf8mb4',connectTimeout:10000});
  // Background jobs currently require a single application owner. Fail closed
  // rather than let another container mark live jobs failed or duplicate billing.
  const lock='waiqi:'+createHash('sha256').update(workerData.config.database).digest('hex').slice(0,50);
  const [rows]=await connection.execute('SELECT GET_LOCK(?, 0) AS acquired',[lock]);
  if(Number(rows[0].acquired)!==1){const error=Error('正在等待旧服务实例释放数据库锁。');error.code='APP_INSTANCE_BUSY';throw error;}
  const statements=[
    `CREATE TABLE IF NOT EXISTS entities (kind VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,body LONGTEXT NOT NULL,PRIMARY KEY(kind,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    `CREATE TABLE IF NOT EXISTS sessions (token VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,subject VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,expires BIGINT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS requests (user_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,request_id VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,message_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,PRIMARY KEY(user_id,request_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS audio_keys (cache_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,audio_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL) ENGINE=InnoDB`
  ];
  for(const sql of statements)await connection.query(sql);
})();
// Attach rejection handler immediately, even if the first message hasn't arrived.
ready.catch(()=>{});
function respond(value){
  let encoded=new TextEncoder().encode(JSON.stringify(value));
  if(encoded.length>bytes.length)encoded=new TextEncoder().encode(JSON.stringify({error:'数据库查询结果过大，请减少记录或增加分页。'}));
  bytes.set(encoded);Atomics.store(control,1,encoded.length);Atomics.store(control,0,1);Atomics.notify(control,0);
}
parentPort.on('message',async message=>{
  try {
    await ready;
    if(message.op==='ready'){respond({value:true});return;}
    if(message.op==='close'){await connection.end();respond({value:true});return;}
    let sql=message.sql;
    if(sql==='BEGIN IMMEDIATE')sql='START TRANSACTION';
    sql=sql.replace('ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body','ON DUPLICATE KEY UPDATE body=VALUES(body)');
    const [result]=await connection.query({sql,timeout:20000},message.params || []);
    const value=message.mode==='get'?(result[0] || null):message.mode==='run'?{changes:result.affectedRows}:message.op==='exec'?true:result;
    respond({value});
  }catch(error){
    const code=error.code || (/closed state|connection.*closed/i.test(error.message || '')?'MYSQL_CONNECTION_CLOSED':'MYSQL_OPERATION_FAILED');
    respond({error:code==='APP_INSTANCE_BUSY'?error.message:`MySQL 操作失败（${code}）`,code});
  }
});
