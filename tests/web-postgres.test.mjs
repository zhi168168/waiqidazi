import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { createWebStore } from "../server/web-store.mjs";
import { webFixture } from "./helpers/web-fixture.mjs";

test("PostgreSQL schema, JSON records, transaction rollback and identity/session tables", async (t) => {
  process.env.ADMIN_PASSWORD = "test-admin-password-12345";
  const pg = new PGlite();
  const sql = async (strings, ...values) =>
    sql.unsafe(
      strings.reduce(
        (text, part, index) => text + (index ? "$" + index : "") + part,
        "",
      ),
      values,
    );
  sql.unsafe = async (query, values = []) => {
    const result = await pg.query(query, values);
    const rows = result.rows;
    rows.count = result.affectedRows ?? rows.length;
    return rows;
  };
  sql.begin = async (fn) => {
    await pg.exec("BEGIN");
    try {
      const result = await fn(sql);
      await pg.exec("COMMIT");
      return result;
    } catch (error) {
      await pg.exec("ROLLBACK");
      throw error;
    }
  };
  sql.end = () => pg.close();
  const store = createWebStore({ sql });
  t.after(() => store.close());
  await store.initialize();
  await store.initialize();
  assert.equal((await store.list("admin")).length, 1);
  assert.equal((await store.list("category")).length, 4);
  await store.put("message", {
    id: "message-a",
    userId: "a",
    reply: "中文回复",
    englishTip: { expression: "Hello." },
  });
  assert.equal(
    (await store.get("message", "message-a")).englishTip.expression,
    "Hello.",
  );
  await assert.rejects(() =>
    store.tx(async () => {
      await store.lock("identity:a");
      await store.put("message", { id: "message-a", reply: "should rollback" });
      throw Error("rollback");
    }),
  );
  assert.equal((await store.get("message", "message-a")).reply, "中文回复");
  await store.db
    .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
    .run("token", "a", "admin", Date.now() + 10000);
  assert.equal(
    (
      await store.db
        .prepare(
          "SELECT * FROM sessions WHERE token=? AND type=? AND expires>?",
        )
        .get("token", "admin", Date.now())
    ).subject,
    "a",
  );
  await store.db
    .prepare("INSERT INTO requests VALUES(?,?,?)")
    .run("a", "request-a", "message-a");
  assert.equal(
    (
      await store.db
        .prepare(
          "SELECT message_id FROM requests WHERE user_id=? AND request_id=?",
        )
        .get("a", "request-a")
    ).message_id,
    "message-a",
  );
  await store.del("message", "message-a");
  assert.equal(await store.get("message", "message-a"), null);
  // The real web routes also run against PostgreSQL JSON and SQL parameter types.
  const f = await webFixture(null, { store });
  try {
    assert.equal((await f.login()).status, 200);
    const admin = (
      await f.request("/admin/login", "", "POST", {
        username: "admin",
        password: process.env.ADMIN_PASSWORD,
      })
    ).data.token;
    assert.equal((await f.request("/admin/overview", admin)).status, 200);
    const conversation = (
      await f.request("/conversations", "test-user-a", "POST", {})
    ).data;
    const message = await f.request(
      "/conversations/" + conversation.id + "/messages",
      "test-user-a",
      "POST",
      { text: "今天好累", requestId: "postgres-request" },
    );
    assert.equal(message.status, 200);
    await f.settle();
    assert.equal(
      (await f.request("/messages/" + message.data.id, "test-user-a")).data
        .status,
      "complete",
    );
    assert.equal((await f.request("/me", "test-user-a", "DELETE")).status, 200);
  } finally {
    await f.cleanup();
  }
});
