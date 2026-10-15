import { test } from "node:test";
import assert from "node:assert/strict";
import { webFixture } from "./helpers/web-fixture.mjs";
import { id } from "../server/store.mjs";
import { createWebApp } from "../server/web-app.mjs";
import { AppError } from "../server/providers.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const cloud of [true, false]) test(`private ${cloud ? "cloud" : "local"} audio authorizes users and admins`, async (t) => {
  const f = await webFixture(t);
  await f.login();
  const admin = (
    await f.request("/admin/login", "", "POST", {
      username: "admin",
      password: process.env.ADMIN_PASSWORD,
    })
  ).data.token;
  const audioId = id(),
    versionId = id(),
    corpusId = id();
  f.store.put("audio", {
    id: audioId,
    status: "done",
    config: { format: "wav" },
  });
  f.store.put("version", { id: versionId, audioId, categoryId: "root-0" });
  f.store.put("corpus", {
    id: corpusId,
    enabled: true,
    publishedVersion: versionId,
    draftVersion: versionId,
  });
  const app = createWebApp({
    store: { ...f.store, close: async () => {} },
    identity: {
      config: { configured: true },
      verify: async (req) => {
        const account = f.accounts.get(
          (req.headers.authorization || "").replace(/^Bearer /, ""),
        );
        if (!account) throw new AppError(401, "请先登录。");
        return account;
      },
    },
    audioStorage: {
      cloud,
      url: async (key) =>
        "https://storage.example.test/private/" + key + "?signed=short-lived",
      read: async () => {
        if (cloud) throw Error("must not proxy audio bytes");
        return Buffer.from("RIFF-test-audio");
      },
    },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const base =
      "http://127.0.0.1:" +
      app.server.address().port +
      "/api/audio/" +
      audioId +
      ".wav";
    const anonymous = await fetch(base, { redirect: "manual" });
    assert.equal(anonymous.status, 401);
    for (const token of ["test-user-a", admin]) {
      const response = await fetch(base, {
        headers: { Authorization: "Bearer " + token },
        redirect: "manual",
      });
      assert.equal(response.status, cloud ? 302 : 200);
      if (cloud) assert.ok(
        response.headers.get("location").includes("signed=short-lived"),
      );
      else assert.equal(await response.text(), "RIFF-test-audio");
    }
    f.store.put("corpus", {
      id: corpusId,
      enabled: false,
      publishedVersion: versionId,
    });
    assert.equal(
      (
        await fetch(base, {
          headers: { Authorization: "Bearer test-user-a" },
          redirect: "manual",
        })
      ).status,
      401,
    );
  } finally {
    await app.close();
  }
});
test("Vercel pre-parsed bodies are accepted and still enforce the size limit", async (t) => {
  const f = await webFixture(t);
  await f.login();
  async function invoke(body) {
    const response = {
      headersSent: false,
      writableEnded: false,
      setHeader() {},
      writeHead(status) {
        this.status = status;
        this.headersSent = true;
      },
      end(text) {
        this.data = JSON.parse(text);
        this.writableEnded = true;
      },
    };
    await f.handler(
      {
        method: "POST",
        url: "/api/feedback",
        headers: { authorization: "Bearer test-user-a" },
        body,
      },
      response,
    );
    return response;
  }
  assert.equal((await invoke({ text: "Vercel 表单反馈" })).status, 200);
  assert.equal(f.store.list("feedback")[0].text, "Vercel 表单反馈");
  assert.equal(
    (await invoke({ text: "x".repeat(1024 * 1024 + 1) })).status,
    413,
  );
  assert.equal((await invoke("{bad json")).status, 400);
});

test("expired background jobs become explicitly retryable instead of staying running forever", async (t) => {
  const f = await webFixture(t);
  const admin = (
    await f.request("/admin/login", "", "POST", {
      username: "admin",
      password: process.env.ADMIN_PASSWORD,
    })
  ).data.token;
  f.store.put("audio", {
    id: "interrupted-audio",
    status: "running",
    config: { format: "mp3" },
  });
  f.store.put("job", {
    id: "interrupted-job",
    type: "tts",
    audioId: "interrupted-audio",
    status: "running",
    attempts: 1,
    startedAt: new Date(Date.now() - 400000).toISOString(),
  });
  const jobs = (await f.request("/admin/jobs", admin)).data;
  assert.equal(jobs[0].status, "failed");
  assert.equal(jobs[0].costStatus, "unknown");
  assert.equal(f.store.get("audio", "interrupted-audio").status, "failed");
});
async function complete(f, token, key) {
  for (let i = 0; i < 100; i++) {
    const response = await f.request("/messages/" + key, token);
    if (response.data.status === "complete") return response.data;
    if (response.data.status === "failed") throw Error(response.data.error);
    await sleep(10);
  }
  throw Error("reply timeout");
}
test("web chat retains tips, translates lazily, isolates users, and registers deferred work", async (t) => {
  let translate = 0;
  const f = await webFixture(t, {
    models: {
      chat: async (messages, options) => {
        if (options.type === "topic") return { text: '{"newTopic":false}' };
        if (options.type === "memory") return { text: '{"facts":[]}' };
        if (messages[0].content.startsWith("Translate the ENTIRE")) {
          translate++;
          return { text: '{"english":"That is a lot to deal with."}' };
        }
        await sleep(30);
        return {
          text: '{"reply":"这确实让人烦。","englishTip":{"expression":"I am swamped.","explanation":"忙不过来。"}}',
        };
      },
    },
  });
  await f.login();
  await f.login("test-user-b");
  const s = (await f.request("/conversations", "test-user-a", "POST", {})).data;
  const accepted = await f.request(
    `/conversations/${s.id}/messages`,
    "test-user-a",
    "POST",
    { text: "今天好烦", requestId: id() },
  );
  assert.equal(accepted.status, 200);
  const m = await complete(f, "test-user-a", accepted.data.id);
  assert.equal(m.reply, "这确实让人烦。");
  assert.equal(m.englishTip.expression, "I am swamped.");
  assert.equal(translate, 0);
  assert.ok(f.deferred.length);
  assert.equal(
    (await f.request("/messages/" + m.id, "test-user-b")).status,
    404,
  );
  assert.equal(
    (await f.request(`/messages/${m.id}/english`, "test-user-a", "POST", {}))
      .data.english,
    "That is a lot to deal with.",
  );
  await f.request(`/messages/${m.id}/english`, "test-user-a", "POST", {});
  assert.equal(translate, 1);
});
test("concurrent duplicate requests create one message; concurrent separate message is rejected", async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const f = await webFixture(t, {
    models: {
      chat: async (_messages, options) => {
        if (options.type === "topic") return { text: '{"newTopic":false}' };
        if (options.type === "memory") return { text: '{"facts":[]}' };
        await gate;
        return { text: '{"reply":"我在。"}' };
      },
    },
  });
  await f.login();
  const s = (await f.request("/conversations", "test-user-a", "POST", {})).data,
    body = { text: "你好", requestId: id() };
  const both = await Promise.all([
    f.request(`/conversations/${s.id}/messages`, "test-user-a", "POST", body),
    f.request(`/conversations/${s.id}/messages`, "test-user-a", "POST", body),
  ]);
  assert.equal(both[0].data.id, both[1].data.id);
  assert.equal(f.store.list("message").length, 1);
  const next = await f.request(
    `/conversations/${s.id}/messages`,
    "test-user-a",
    "POST",
    { text: "再说一句", requestId: id() },
  );
  assert.equal(next.status, 409);
  release();
  await f.settle();
});
test("cancelled generation never returns after a late model completion", async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const f = await webFixture(t, {
    models: {
      chat: async (_messages, options) => {
        if (options.type === "topic") return { text: '{"newTopic":false}' };
        if (options.type === "memory") return { text: '{"facts":[]}' };
        await gate;
        return { text: '{"reply":"不应交付"}' };
      },
    },
  });
  await f.login();
  const s = (await f.request("/conversations", "test-user-a", "POST", {})).data,
    m = (
      await f.request(
        `/conversations/${s.id}/messages`,
        "test-user-a",
        "POST",
        { text: "hi", requestId: id() },
      )
    ).data;
  await f.request("/messages/" + m.id + "/cancel", "test-user-a", "POST", {});
  release();
  await f.settle();
  assert.equal(f.store.get("message", m.id).status, "cancelled");
  assert.equal(f.store.get("message", m.id).reply, undefined);
});

test("a superseded generation attempt cannot overwrite a retry from another instance", async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const f = await webFixture(t, {
    models: {
      chat: async (_messages, options) => {
        if (options.type === "topic") return { text: '{"newTopic":false}' };
        if (options.type === "memory") return { text: '{"facts":[]}' };
        await gate;
        return { text: '{"reply":"旧请求的结果"}' };
      },
    },
  });
  await f.login();
  const conversation = (
    await f.request("/conversations", "test-user-a", "POST", {})
  ).data;
  const message = (
    await f.request(
      "/conversations/" + conversation.id + "/messages",
      "test-user-a",
      "POST",
      { text: "今天好累", requestId: id() },
    )
  ).data;
  const current = f.store.get("message", message.id);
  f.store.put("message", {
    ...current,
    attemptId: "new-attempt-from-other-instance",
    status: "generating",
  });
  release();
  await f.settle();
  const saved = f.store.get("message", message.id);
  assert.equal(saved.attemptId, "new-attempt-from-other-instance");
  assert.equal(saved.reply, undefined);
});
test("admin corpus saves, reuses audio, publishes, supports favorites, playback and practice", async (t) => {
  const f = await webFixture(t);
  await f.login();
  const admin = (
    await f.request("/admin/login", "", "POST", {
      username: "admin",
      password: process.env.ADMIN_PASSWORD,
    })
  ).data.token;
  const payload = {
    title: "协调时间",
    categoryId: "root-1",
    english: "Could we have more time?",
    chinese: "可以多一点时间吗？",
    situation: "协作",
    notes: "礼貌表达",
    channel: "口头",
    formality: "自然",
    tags: ["时间"],
  };
  const a = await f.request("/admin/corpus", admin, "POST", payload);
  assert.equal(a.status, 200);
  await f.settle();
  const b = await f.request("/admin/corpus", admin, "POST", {
    ...payload,
    title: "同一朗读文本",
  });
  assert.equal(b.data.audio.id, a.data.audio.id);
  assert.equal(
    (
      await f.request(
        "/admin/corpus/" + a.data.corpusId + "/publish",
        admin,
        "POST",
        { reviewed: true },
      )
    ).status,
    200,
  );
  const corpus = (await f.request("/corpus")).data;
  assert.equal(corpus.length, 1);
  assert.equal(
    (
      await f.request("/favorites", "test-user-a", "POST", {
        corpusId: corpus[0].id,
      })
    ).status,
    200,
  );
  assert.equal((await f.request("/favorites", "test-user-a")).data.length, 1);
  const response = await fetch(f.base + corpus[0].audioUrl, {
    headers: { Authorization: "Bearer test-user-a" },
  });
  assert.equal(response.status, 200);
  assert.equal(
    (
      await f.request("/conversations", "test-user-a", "POST", {
        corpusId: corpus[0].id,
      })
    ).data.practice.english,
    payload.english,
  );
  assert.equal(
    (await f.request("/admin/logout", admin, "POST", {})).status,
    200,
  );
  assert.equal((await f.request("/admin/overview", admin)).status, 401);
});
