// Run explicitly against a deployed instance. Creates and deletes its own test accounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";

const base = process.env.SELFHOST_BASE_URL;
test(
  "self-hosted real PostgreSQL auth, recovery, isolation, chat, deletion and cookies",
  { skip: !base, timeout: 240000 },
  async () => {
    const origin = process.env.SELFHOST_ORIGIN || new URL(base).origin;
    function client() {
      const cookies = new Map();
      return async (path, method = "GET", body, headers = {}) => {
        const response = await fetch(base + path, {
          method,
          headers: {
            Origin: origin,
            "Content-Type": "application/json",
            Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
            ...(process.env.QA_IP ? { "x-real-ip": process.env.QA_IP } : {}),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: "manual",
        });
        for (const cookie of response.headers.getSetCookie()) {
          const first = cookie.split(";")[0],
            eq = first.indexOf("=");
          if (first.slice(eq + 1))
            cookies.set(first.slice(0, eq), first.slice(eq + 1));
          else cookies.delete(first.slice(0, eq));
        }
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
        return { status: response.status, data, headers: response.headers };
      };
    }
    const a = client(),
      b = client(),
      anonymous = client();
    const suffix = randomBytes(6).toString("hex");
    const username = `qa_${suffix}`;
    const password = randomBytes(20).toString("hex"),
      nextPassword = randomBytes(20).toString("hex");
    const config = (await anonymous("/api/auth/config")).data;
    assert.equal(config.provider, "better-auth");
    assert.equal(config.usernameRegistration, true);
    assert.equal(config.emailVerification, false);
    assert.equal(JSON.stringify(config).includes("secret"), false);
    let aCreated = false,
      bCreated = false;
    try {
      const signup = await a("/api/accounts/sign-up/username", "POST", {
        username,
        password,
        confirmPassword: password,
      });
      assert.equal(signup.status, 200, JSON.stringify(signup.data));
      aCreated = true;
      assert.equal(signup.data.user.username, username);
      assert.equal((await anonymous("/api/accounts/sign-up/username", "POST", { username: username.toUpperCase(), password, confirmPassword: password })).status, 400);
      assert.equal((await anonymous("/api/accounts/sign-up/username", "POST", { username: `wrong_${suffix}`, password, confirmPassword: "mismatch" })).status, 400);
      assert.equal((await anonymous("/api/accounts/sign-up/username", "POST", { username: "bad name", password, confirmPassword: password })).status, 400);
      assert.equal((await anonymous("/api/accounts/sign-up/email", "POST", {email: `old-${suffix}@example.test`, password, name: "old"})).status, 400);
      assert.match(signup.headers.get("set-cookie"), /HttpOnly/i);
      if (origin.startsWith("https:"))
        assert.match(signup.headers.get("set-cookie"), /Secure/i);
      assert.equal(
        (await a("/api/auth/session", "POST", { consent: true })).status,
        200,
      );
    const entries = (await anonymous("/api/corpus")).data;
    if (entries.length) {
      assert.equal((await anonymous(entries[0].audioUrl)).status, 401);
      const audio = await a(entries[0].audioUrl, "GET", undefined, { Range: "bytes=0-43" });
      assert.equal(audio.status, 206);
      assert.match(audio.headers.get("content-type"), /audio\//);
    }
      assert.equal((await a("/api/me")).data.username, username);
      const code = (await a("/api/accounts/recovery-code", "POST", {})).data
        .code;
      assert.match(code, /^[a-f0-9]{48}$/);
      assert.equal(
        (
          await a(
            "/api/me",
            "PATCH",
            {},
            { Origin: "https://attacker.invalid" },
          )
        ).status,
        403,
      );
      assert.equal(
        (await a("/api/accounts/delete-user", "POST", { password })).status >=
          400,
        true,
      );
      const signupB = await b("/api/accounts/sign-up/username", "POST", {
        username: `qa_b_${suffix}`,
        password,
        confirmPassword: password,
      });
      assert.equal(signupB.status, 200);
      bCreated = true;
      await b("/api/auth/session", "POST", { consent: true });
      const conversation = (await a("/api/conversations", "POST", {})).data;
      assert.ok(conversation.id);
      assert.equal(
        (await b("/api/conversations/" + conversation.id + "/messages")).status,
        404,
      );
      assert.equal((await b("/api/admin/settings")).status, 401);
      if (process.env.LIVE_MODEL_TEST === "true") {
        const accepted = await a(
          `/api/conversations/${conversation.id}/messages`,
          "POST",
          {
            text: "今天把工作做完了，终于可以休息一下。",
            requestId: randomUUID(),
            noMemory: true,
          },
        );
        assert.equal(accepted.status, 200);
        let message;
        for (let i = 0; i < 100; i++) {
          message = (await a("/api/messages/" + accepted.data.id)).data;
          if (!["queued", "generating"].includes(message.status)) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        assert.equal(
          message.status,
          "complete",
          message.error || "Real model reply did not complete",
        );
        assert.ok(message.reply?.length > 0);
        console.log(
          "Real chat completed; English sidecar:",
          Boolean(message.englishTip),
        );
      }
      assert.equal(
        (
          await anonymous("/api/accounts/recover", "POST", {
            username,
            code: "0".repeat(48),
            password: nextPassword,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await anonymous("/api/accounts/recover", "POST", {
            username,
            code,
            password: nextPassword,
          })
        ).status,
        200,
      );
      assert.equal((await a("/api/me")).status, 401);
      assert.equal(
        (
          await anonymous("/api/accounts/recover", "POST", {
            username,
            code,
            password,
          })
        ).status,
        400,
      );
      assert.equal(
        (await a("/api/accounts/sign-in/username", "POST", { username, password }))
          .status,
        401,
      );
      assert.equal(
        (
          await a("/api/accounts/sign-in/username", "POST", {
            username,
            password: nextPassword,
          })
        ).status,
        200,
      );
      assert.equal((await a("/api/me")).status, 200);
      const rotated = (await a("/api/accounts/recovery-code", "POST", {})).data
        .code;
      assert.notEqual(code, rotated);
      assert.equal(
        (
          await a("/api/accounts/change-password", "POST", {
            currentPassword: password,
            newPassword: password,
            revokeOtherSessions: true,
          })
        ).status >= 400,
        true,
      );
      assert.equal(
        (
          await a("/api/accounts/change-password", "POST", {
            currentPassword: nextPassword,
            newPassword: password,
            revokeOtherSessions: true,
          })
        ).status,
        200,
      );
      assert.equal((await a("/api/me", "DELETE")).status, 200);
      aCreated = false;
      assert.equal((await a("/api/me")).status, 401);
      assert.equal((await b("/api/me")).status, 200);
      assert.equal((await b("/api/me", "DELETE")).status, 200);
      bCreated = false;
    } finally {
      if (aCreated) await a("/api/me", "DELETE");
      if (bCreated) await b("/api/me", "DELETE");
    }
  },
);
