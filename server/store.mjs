import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { id,now,hash,passwordHash,checkPassword } from './crypto.mjs';
export { id,now,hash,passwordHash,checkPassword } from './crypto.mjs';
import { DEFAULT_PERSONA, MEMORY_FIELDS } from './buddy-policy.mjs';
import { MySQLSync } from './mysql-sync.mjs';

export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  const mysql=process.env.DB_DRIVER==='mysql';
  if(mysql && !process.env.ADMIN_PASSWORD)throw Error('云端首次启动必须配置 ADMIN_PASSWORD，不能依赖临时磁盘保存管理员密码。');
  const db = mysql ? new MySQLSync() : new DatabaseSync(resolve(directory, 'app.sqlite'));
  if(!mysql)db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS entities (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, subject TEXT NOT NULL, type TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (user_id TEXT NOT NULL, request_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(user_id,request_id));
    CREATE TABLE IF NOT EXISTS audio_keys (cache_key TEXT PRIMARY KEY, audio_id TEXT NOT NULL);
  `);
  const get = (kind, key) => { if(key === undefined || key === null)return null; const row = db.prepare('SELECT body FROM entities WHERE kind=? AND id=?').get(kind, key); return row ? JSON.parse(row.body) : null; };
  const list = kind => db.prepare('SELECT body FROM entities WHERE kind=?').all(kind).map(row => JSON.parse(row.body));
  const put = (kind, value) => { db.prepare('INSERT INTO entities VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind, value.id, JSON.stringify(value)); return value; };
  const del = (kind, key) => db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, key);
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const audit = (actor, action, object) => put('audit', {id:id(), actor, action, object, time:now()});
  if (!list('admin').length) {
    const password = process.env.ADMIN_PASSWORD || randomBytes(18).toString('base64url');
    put('admin', {id:id(), username: process.env.ADMIN_USERNAME || 'admin', password:passwordHash(password), role:'system'});
    if (!process.env.ADMIN_PASSWORD) { const path = resolve(directory, 'admin-bootstrap.txt'); writeFileSync(path, `username=${process.env.ADMIN_USERNAME || 'admin'}\npassword=${password}\n`, {mode:0o600}); try { chmodSync(path, 0o600); } catch {} }
  }
  const roots = ['工作汇报','协调同事','客户沟通','面试'];
  if (!list('category').length) roots.forEach((name, index) => put('category', {id:`root-${index}`, name, parentId:null, enabled:true, sort:index}));
  if (!get('settings','current')) put('settings', {id:'current', version:1, persona:DEFAULT_PERSONA, buddyVersion:1, englishVariant:'neutral', maxTokens:1100, recentMessages:16, memoryEnabled:true, memoryFields:[...MEMORY_FIELDS], retentionDays:0, privacyText:'本应用提供 AI 职场英语练习。请使用脱敏信息。聊天和记忆会发送至配置的模型服务商；具体服务商、训练政策与保留期限将在上线前公布。当前版本仅用于本地内测。', safetyRequired:true});
  // Versioned migration preserves prior settings and every conversation/memory.
  const current=get('settings','current');
  if(!current.buddyVersion)tx(()=>{
    put('settings-version',{...current,id:id(),savedAt:now()});
    put('settings',{...current,persona:current.persona.startsWith('You are an AI workplace English practice buddy.') ? DEFAULT_PERSONA : current.persona,memoryFields:[...new Set([...current.memoryFields,...MEMORY_FIELDS])],maxTokens:Math.max(current.maxTokens,1100),buddyVersion:1,version:current.version+1});
  });
  return {db, get, list, put, del, tx, audit, close:() => db.close()};
}
