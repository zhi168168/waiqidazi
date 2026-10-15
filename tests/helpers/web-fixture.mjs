import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../../server/store.mjs";
import { createWebApp } from "../../server/web-app.mjs";
import { AppError } from "../../server/providers.mjs";

// Local test fixture only: production always uses PostgreSQL and Supabase identities.
export function fixtureStore(directory) {
  const store = createStore(directory),
    context = new AsyncLocalStorage();
  let tail = Promise.resolve();
  return {
    ...store,
    lock: async () => {},
    async tx(fn) {
      if (context.getStore()) return fn();
      const previous = tail;
      let release;
      tail = new Promise((resolve) => (release = resolve));
      await previous;
      store.db.exec("BEGIN IMMEDIATE");
      try {
        const value = await context.run(true, fn);
        store.db.exec("COMMIT");
        return value;
      } catch (error) {
        store.db.exec("ROLLBACK");
        throw error;
      } finally {
        release();
      }
    },
  };
}
export async function webFixture(
  t,
  { models = {}, identity, listen = true, store: suppliedStore } = {},
) {
  process.env.ADMIN_PASSWORD = "test-admin-password-12345";
  process.env.PRIVACY_POLICY_CONFIRMED = "true";
  process.env.AUDIO_STORAGE = "local";
  const directory = mkdtempSync(join(tmpdir(), "buddy-web-"));
  const store = suppliedStore || fixtureStore(directory),
    accounts = new Map([
      [
        "test-user-a",
        {
          id: "11111111-1111-4111-8111-111111111111",
          email: "a@example.test",
          email_confirmed_at: "2026-10-15",
        },
      ],
      [
        "test-user-b",
        {
          id: "22222222-2222-4222-8222-222222222222",
          email: "b@example.test",
          email_confirmed_at: "2026-10-15",
        },
      ],
    ]);
  const auth = identity || {
    config: {
      configured: true,
      url: "http://127.0.0.1",
      anonKey: "fixture-public-key",
    },
    verify: async (req) => {
      const key = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (!accounts.has(key)) throw new AppError(401, "请先登录。");
      return accounts.get(key);
    },
    remove: async (id) => {
      for (const [key, a] of accounts) if (a.id === id) accounts.delete(key);
    },
  };
  const defaults = {
    moderate: async () => {},
    synthesize: async () => Buffer.from("ID3 fixture audio"),
    chat: async (_messages, options) => {
      if (options.type === "topic") return { text: '{"newTopic":false}' };
      if (options.type === "memory") return { text: '{"facts":[]}' };
      return {
        text: JSON.stringify({
          reply: "今天确实不容易，我在呢。",
          englishTip: {
            expression: "It has been a long day.",
            explanation: "忙碌一天后可以这样说。",
          },
        }),
        usage: { total_tokens: 20 },
      };
    },
  };
  const deferred = [];
  const app = createWebApp({
    directory,
    store,
    identity: auth,
    models: { ...defaults, ...models },
    defer: (p) => deferred.push(p),
  });
  if (listen)
    await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = listen ? "http://127.0.0.1:" + app.server.address().port : "";
  const request = async (path, token = "", method = "GET", body) => {
    const response = await fetch(base + "/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const login = async (token = "test-user-a") =>
    request("/auth/session", token, "POST", { consent: true });
  const cleanup = async () => {
    await app.settle();
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  };
  t?.after(cleanup);
  return { ...app, base, request, login, accounts, deferred, cleanup };
}
