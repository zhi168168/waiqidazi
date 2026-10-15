import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_PERSONA, MEMORY_FIELDS } from "./buddy-policy.mjs";
import { id, now, passwordHash } from "./crypto.mjs";

// A private schema: browser clients never receive database credentials or table access.
export function createWebStore({
  connectionString = process.env.DATABASE_URL,
  sql: suppliedSql,
} = {}) {
  if (!connectionString && !suppliedSql)
    throw Error("请配置 DATABASE_URL（Supabase PostgreSQL 事务连接池）。");
  const sql =
    suppliedSql ||
    postgres(connectionString, {
      max: 3,
      prepare: false,
      connect_timeout: 15,
      idle_timeout: 20,
      ssl: process.env.DATABASE_SSL === "false" ? false : "require",
    });
  const context = new AsyncLocalStorage();
  let closing;
  const execute = (query, params = []) => {
    let index = 0;
    const text = query
      .replaceAll("?", () => `$${++index}`)
      .replace(/\b(entities|sessions|requests|audio_keys)\b/g, "buddy.$1");
    return (context.getStore() || sql).unsafe(text, params);
  };
  const db = {
    prepare(query) {
      return {
        all: (...args) => execute(query, args),
        get: async (...args) => (await execute(query, args))[0] || null,
        run: async (...args) => {
          const rows = await execute(query, args);
          return { changes: rows.count };
        },
      };
    },
  };
  const get = async (kind, key) =>
    key == null
      ? null
      : (
          await db
            .prepare("SELECT body FROM entities WHERE kind=? AND id=?")
            .get(kind, key)
        )?.body || null;
  const list = async (kind) =>
    (
      await db
        .prepare("SELECT body FROM entities WHERE kind=? ORDER BY id")
        .all(kind)
    ).map((row) => row.body);
  const put = async (kind, value) => {
    await db
      .prepare(
        "INSERT INTO entities VALUES(?,?,?::jsonb) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
      )
      .run(kind, value.id, JSON.stringify(value));
    return value;
  };
  const del = (kind, key) =>
    db.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind, key);
  const tx = async (fn) =>
    context.getStore()
      ? fn()
      : sql.begin(async (connection) => context.run(connection, fn));
  // Lock one subject across all Vercel instances, including conversation creation and generation.
  const lock = async (key) => {
    if (!context.getStore()) throw Error("数据库锁必须位于事务内。");
    await context.getStore()`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  };
  async function initialize() {
    if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)
      throw Error("ADMIN_PASSWORD 至少 12 位。");
    await sql`CREATE SCHEMA IF NOT EXISTS buddy`;
    await sql`REVOKE ALL ON SCHEMA buddy FROM PUBLIC`;
    await sql`CREATE TABLE IF NOT EXISTS buddy.entities(kind text NOT NULL,id text NOT NULL,body jsonb NOT NULL,PRIMARY KEY(kind,id))`;
    await sql`CREATE TABLE IF NOT EXISTS buddy.sessions(token text PRIMARY KEY,subject text NOT NULL,type text NOT NULL,expires bigint NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS buddy.requests(user_id text NOT NULL,request_id text NOT NULL,message_id text NOT NULL,PRIMARY KEY(user_id,request_id))`;
    await sql`CREATE TABLE IF NOT EXISTS buddy.audio_keys(cache_key text PRIMARY KEY,audio_id text NOT NULL)`;
    await sql`CREATE INDEX IF NOT EXISTS buddy_entities_user ON buddy.entities(kind, (body->>'userId'))`;
    await tx(async () => {
      await lock("bootstrap");
      if (!(await list("admin")).length)
        await put("admin", {
          id: id(),
          username: process.env.ADMIN_USERNAME || "admin",
          password: passwordHash(process.env.ADMIN_PASSWORD),
          role: "system",
        });
      for (const [index, name] of [
        "工作汇报",
        "协调同事",
        "客户沟通",
        "面试",
      ].entries()) {
        if (!(await get("category", `root-${index}`)))
          await put("category", {
            id: `root-${index}`,
            name,
            parentId: null,
            enabled: true,
            sort: index,
          });
      }
      if (!(await get("settings", "current")))
        await put("settings", {
          id: "current",
          version: 1,
          persona: DEFAULT_PERSONA,
          buddyVersion: 1,
          englishVariant: "neutral",
          maxTokens: 1100,
          recentMessages: 16,
          memoryEnabled: true,
          memoryFields: [...MEMORY_FIELDS],
          retentionDays: 0,
          privacyText: "请在正式开放前，由运营方在管理后台填写完整的隐私说明。",
          safetyRequired: true,
        });
    });
  }
  return {
    db,
    get,
    list,
    put,
    del,
    tx,
    lock,
    initialize,
    audit: (actor, action, object) =>
      put("audit", { id: id(), actor, action, object, time: now() }),
    close: () => (closing ||= sql.end({ timeout: 5 })),
  };
}
