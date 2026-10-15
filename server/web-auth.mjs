import { createClient } from "@supabase/supabase-js";
import { AppError } from "./providers.mjs";

export function publicAuthConfig(env = process.env) {
  return {
    configured: Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY),
    url: env.SUPABASE_URL || "",
    anonKey: env.SUPABASE_ANON_KEY || "",
  };
}
export function createWebAuth({ client } = {}) {
  const config = publicAuthConfig();
  config.configured = Boolean(
    client || (config.configured && process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
  const supabase =
    client ||
    (config.configured && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(config.url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        })
      : null);
  return {
    config,
    async verify(req) {
      if (!supabase)
        throw new AppError(503, "邮箱登录尚未配置，请联系管理员。");
      const token = (req.headers.authorization || "").match(
        /^Bearer (\S+)$/,
      )?.[1];
      if (!token) throw new AppError(401, "请先登录。");
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user)
        throw new AppError(401, "登录已过期，请重新登录。");
      if (!data.user.email_confirmed_at)
        throw new AppError(403, "请先验证邮箱。");
      return data.user;
    },
    async remove(userId) {
      if (!supabase) throw new AppError(503, "账号服务尚未配置。");
      const { error } = await supabase.auth.admin.deleteUser(userId);
      if (error) throw new AppError(503, "账号注销暂未完成，请重试。");
    },
  };
}
