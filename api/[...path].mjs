import { waitUntil } from "@vercel/functions";
import { createWebApp } from "../server/web-app.mjs";

let app;
export default async function handler(req, res) {
  try {
    if (
      process.env.DB_DRIVER !== "postgres" ||
      process.env.AUDIO_STORAGE !== "supabase" ||
      process.env.ALLOW_DEV_LOGIN === "true"
    ) {
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error: "请完成 Vercel 的 PostgreSQL、Supabase 存储及正式登录配置。",
        }),
      );
      return;
    }
    app ||= createWebApp({ directory: "/tmp/buddy", defer: waitUntil });
    await app.handler(req, res);
  } catch {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "服务配置尚未完成，请联系管理员。" }));
  }
}
