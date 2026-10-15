import { test } from "node:test";
import assert from "node:assert/strict";
import { createWebAuth, publicAuthConfig } from "../server/web-auth.mjs";
import { webFixture } from "./helpers/web-fixture.mjs";

test("public config never returns service credentials", () => {
  assert.deepEqual(
    publicAuthConfig({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "public",
      SUPABASE_SERVICE_ROLE_KEY: "secret",
      DATABASE_URL: "secret",
    }),
    { configured: true, url: "https://project.supabase.co", anonKey: "public" },
  );
});
test("web identity verifies the bearer token with Supabase and rejects unverified accounts", async () => {
  const seen = [];
  const auth = createWebAuth({
    client: {
      auth: {
        getUser: async (token) => {
          seen.push(token);
          return token === "valid"
            ? { data: { user: { id: "user", email_confirmed_at: "today" } } }
            : token === "unverified"
              ? { data: { user: { id: "user" } } }
              : { error: { message: "invalid" } };
        },
      },
    },
  });
  await assert.rejects(() => auth.verify({ headers: {} }), { status: 401 });
  await assert.rejects(
    () => auth.verify({ headers: { authorization: "Bearer forged" } }),
    { status: 401 },
  );
  await assert.rejects(
    () => auth.verify({ headers: { authorization: "Bearer unverified" } }),
    { status: 403 },
  );
  assert.equal(
    (await auth.verify({ headers: { authorization: "Bearer valid" } })).id,
    "user",
  );
  assert.deepEqual(seen, ["forged", "unverified", "valid"]);
});
test("registration consent is required, repeated login preserves profile, and user cannot become admin", async (t) => {
  const f = await webFixture(t);
  assert.equal(
    (
      await f.request("/auth/session", "test-user-a", "POST", {
        consent: false,
      })
    ).status,
    400,
  );
  assert.equal((await f.request("/me", "test-user-a")).status, 403);
  assert.equal((await f.login()).status, 200);
  assert.equal(
    (
      await f.request("/me/profile", "test-user-a", "PATCH", {
        nickname: "小林",
      })
    ).status,
    200,
  );
  assert.equal((await f.login()).data.user.nickname, "小林");
  assert.equal((await f.request("/admin/overview", "test-user-a")).status, 401);
  assert.equal(
    (await f.request("/auth/login", "", "POST", { dev: true, consent: true }))
      .status,
    401,
  );
});
test("deleting account removes identity and owned data but preserves another user", async (t) => {
  const f = await webFixture(t);
  await f.login();
  await f.login("test-user-b");
  const s = (await f.request("/conversations", "test-user-a", "POST", {})).data;
  await f.request("/feedback", "test-user-a", "POST", { text: "请继续优化" });
  assert.equal((await f.request("/me", "test-user-a", "DELETE")).status, 200);
  assert.equal(f.accounts.has("test-user-a"), false);
  assert.equal(f.store.get("conversation", s.id), null);
  assert.equal(f.store.list("feedback").length, 0);
  assert.equal((await f.request("/me", "test-user-a")).status, 401);
  assert.equal((await f.request("/me", "test-user-b")).status, 200);
});

test("failed identity deletion keeps content removed and supports a safe account deletion retry", async (t) => {
  const f = await webFixture(t);
  await f.login();
  const original = f.accounts.get("test-user-a");
  await f.request("/conversations", "test-user-a", "POST", {});
  const identity = {
    config: { configured: true },
    verify: async () => original,
    remove: async () => {
      throw Object.assign(Error("账号服务暂不可用"), { status: 503 });
    },
  };
  // A second application instance shares the persistent business store.
  const { createWebApp } = await import("../server/web-app.mjs");
  const app = createWebApp({
    store: { ...f.store, close: async () => {} },
    identity,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(
      "http://127.0.0.1:" + app.server.address().port + "/api/me",
      { method: "DELETE", headers: { Authorization: "Bearer test-user-a" } },
    );
    assert.equal(response.status, 503);
    assert.equal(f.store.list("conversation").length, 0);
    assert.equal(f.store.get("user", original.id).deletionPending, true);
    assert.equal((await f.request("/me", "test-user-a")).status, 403);
    assert.equal((await f.request("/me", "test-user-a", "DELETE")).status, 200);
    assert.equal(f.accounts.has("test-user-a"), false);
  } finally {
    await app.close();
  }
});
