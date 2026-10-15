import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { Pool } from "pg";
import nodemailer from "nodemailer";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { AppError } from "./providers.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");

export function createSelfAuth({ pool: suppliedPool, env = process.env } = {}) {
  const origin = new URL(env.BETTER_AUTH_URL).origin;
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    throw Error("BETTER_AUTH_SECRET 至少 32 位。");
  const pool =
    suppliedPool || new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const resetContext = new AsyncLocalStorage();
  const smtp = Boolean(env.SMTP_HOST && env.SMTP_FROM);
  const transport = smtp
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 587),
        secure: env.SMTP_SECURE === "true",
        ...(env.SMTP_USER
          ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } }
          : {}),
      })
    : null;
  const send = async (email, subject, url) => {
    if (!transport)
      throw new AppError(503, "邮件服务尚未开放，请使用恢复码找回账号。");
    await transport.sendMail({
      from: env.SMTP_FROM,
      to: email,
      subject,
      text: `职场英语搭子\n\n${subject}：\n${url}\n\n如果不是你本人操作，请忽略本邮件。`,
    });
  };
  const instance = betterAuth({
    appName: "职场英语搭子",
    baseURL: origin,
    basePath: "/api/accounts",
    secret: env.BETTER_AUTH_SECRET,
    database: pool,
    trustedOrigins: [origin],
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 32, usernameValidator: value => /^[a-zA-Z0-9_]+$/.test(value) })],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url, token }) => {
        const recovery = resetContext.getStore();
        if (recovery) {
          recovery.token = token;
          return;
        }
        await send(user.email, "重置密码", url);
      },
    },
    emailVerification: {
      sendOnSignUp: false,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        send(user.email, "验证邮箱", url),
    },
    // Account deletion must go through /api/me so business data is removed too.
    user: { deleteUser: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 12 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-in/username": { window: 60, max: 8 },
        "/sign-up/email": { window: 600, max: 5 },
        "/request-password-reset": { window: 600, max: 4 },
      },
    },
    advanced: {
      useSecureCookies: origin.startsWith("https:"),
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },
    telemetry: { enabled: false },
    logger: { level: "error" },
  });
  const session = async (req) =>
    instance.api.getSession({ headers: fromNodeHeaders(req.headers) });
  const verify = async (req) => {
    const data = await session(req);
    if (!data?.user) throw new AppError(401, "请先登录。");
    return {
      id: data.user.id,
      email: data.user.username ? undefined : data.user.email,
      username: data.user.username || data.user.email,
      user_metadata: { nickname: data.user.name },
      email_confirmed_at: data.user.emailVerified ? data.user.updatedAt : null,
    };
  };
  const nodeHandler = toNodeHandler(instance);
  return {
    instance,
    pool,
    verify,
    config: {
      provider: "better-auth",
      configured: true,
      emailVerification: false,
      emailRecovery: false,
      usernameRegistration: true,
      recoveryCode: true,
    },
    async initialize() {
      await (await instance.$context).runMigrations();
      await pool.query(
        "CREATE TABLE IF NOT EXISTS buddy.recovery_codes(user_id text PRIMARY KEY, code_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())",
      );
      await pool.query(
        "CREATE TABLE IF NOT EXISTS buddy.recovery_limits(key text PRIMARY KEY, count integer NOT NULL, started_at timestamptz NOT NULL)",
      );
    },
    async remove(userId) {
      // Use the library adapter so credential, session and verification cleanup stays consistent.
      await (await instance.$context).internalAdapter.deleteUser(userId);
      await pool.query("DELETE FROM buddy.recovery_codes WHERE user_id=$1", [
        userId,
      ]);
    },
    async handler(req, res) {
      const p = new URL(req.url, origin).pathname;
      const mutation = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (mutation && req.headers.origin !== origin)
        throw new AppError(403, "请求来源无效，请刷新页面后重试。");
      if (p === "/api/accounts/sign-up/username" && req.method === "POST") {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 4096) throw new AppError(413, "请求过大。");
        }
        let body;
        try { body = JSON.parse(raw); } catch { throw new AppError(400, "请求格式无效。"); }
        const login = typeof body?.username === "string" ? body.username.trim() : "";
        if (!/^[a-zA-Z0-9_]{3,32}$/.test(login)) throw new AppError(400, "用户名需为 3–32 位字母、数字或下划线。");
        if (typeof body.password !== "string" || body.password !== body.confirmPassword) throw new AppError(400, "两次输入的密码不一致。");
        // Better Auth requires an internal email field; it is never collected or used for mail.
        const response = await instance.handler(new Request(origin + "/api/accounts/sign-up/email", {
          method: "POST", headers: fromNodeHeaders(req.headers),
          body: JSON.stringify({ username: login, name: login, password: body.password, email: randomBytes(24).toString("hex") + "@accounts.invalid" }),
        }));
        res.statusCode = response.status;
        for (const [key, value] of response.headers) if (key !== "set-cookie") res.setHeader(key, value);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader("Set-Cookie", cookies);
        res.setHeader("Cache-Control", "no-store");
        res.end(await response.text());
        return;
      }
      if (p === "/api/accounts/sign-up/email") throw new AppError(400, "请使用用户名注册。");
      if (p === "/api/accounts/recovery-code" && req.method === "POST") {
        const user = await verify(req);
        const code = randomBytes(24).toString("hex");
        await pool.query(
          "INSERT INTO buddy.recovery_codes(user_id,code_hash) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash,created_at=now()",
          [user.id, digest(code)],
        );
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ code }));
        return;
      }
      if (p === "/api/accounts/recover" && req.method === "POST") {
        const fingerprint = digest(
          String(req.headers["x-real-ip"] || req.socket.remoteAddress),
        );
        const limit = await pool.query(
          `INSERT INTO buddy.recovery_limits(key,count,started_at) VALUES($1,1,now()) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN buddy.recovery_limits.started_at < now()-interval '10 minutes' THEN 1 ELSE buddy.recovery_limits.count+1 END, started_at=CASE WHEN buddy.recovery_limits.started_at < now()-interval '10 minutes' THEN now() ELSE buddy.recovery_limits.started_at END RETURNING count`,
          [fingerprint],
        );
        if (limit.rows[0].count > 5)
          throw new AppError(429, "尝试过于频繁，请十分钟后重试。");
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 4096)
            throw new AppError(413, "请求过大。");
        }
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          throw new AppError(400, "请求格式无效。");
        }
        if (
          typeof body.username !== "string" ||
          body.username.length > 254 ||
          typeof body.code !== "string" ||
          !/^[a-f0-9]{48}$/.test(body.code) ||
          typeof body.password !== "string" ||
          body.password.length < 12 ||
          body.password.length > 128
        )
          throw new AppError(
            400,
            "请填写用户名、48 位恢复码和至少 12 位的新密码。",
          );
        const connection = await pool.connect();
        try {
          await connection.query("BEGIN");
          const row = (
            await connection.query(
              'SELECT r.user_id,r.code_hash,u.email FROM buddy.recovery_codes r JOIN "user" u ON u.id=r.user_id WHERE u.username=$1 OR (u.username IS NULL AND u.email=$1) FOR UPDATE OF r',
              [body.username.toLowerCase().trim()],
            )
          ).rows[0];
          if (
            !row ||
            !timingSafeEqual(
              Buffer.from(row.code_hash),
              Buffer.from(digest(body.code)),
            )
          )
            throw new AppError(400, "用户名或恢复码不正确。");
          const capture = {};
          await resetContext.run(capture, async () => {
            await instance.api.requestPasswordReset({
              body: {
                email: row.email,
                redirectTo: origin + "/reset-password",
              },
            });
          });
          if (!capture.token)
            throw new AppError(503, "账号恢复失败，请稍后重试。");
          await instance.api.resetPassword({
            body: { token: capture.token, newPassword: body.password },
          });
          await connection.query(
            "DELETE FROM buddy.recovery_codes WHERE user_id=$1",
            [row.user_id],
          );
          await connection.query("COMMIT");
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          await connection.query("ROLLBACK");
          throw error;
        } finally {
          connection.release();
        }
        return;
      }
      if (
        [
          "/api/accounts/request-password-reset",
          "/api/accounts/send-verification-email",
        ].includes(p)
      )
        throw new AppError(503, "邮件服务尚未开放，请使用恢复码找回密码。");
      await nodeHandler(req, res);
    },
    close: () => pool.end(),
  };
}
