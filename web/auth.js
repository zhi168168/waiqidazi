import { createClient } from "@supabase/supabase-js";
import { selfAuth } from "./self-auth";
let loading;
export function getAuth() {
  return (loading ||= fetch("/api/auth/config")
    .then(async (response) => {
      if (!response.ok) throw Error("账号服务暂不可用，请稍后重试。");
      const config = await response.json();
      if (!config.configured) return null;
      if (config.provider === "better-auth") return selfAuth(config);
      return createClient(config.url, config.anonKey, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    })
    .catch((error) => {
      loading = null;
      throw error;
    }));
}
export async function request(path, method = "GET", body) {
  const auth = await getAuth();
  const { data } = auth
    ? await auth.auth.getSession()
    : { data: { session: null } };
  const response = await fetch("/api" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(data.session
        && data.session.access_token ? { Authorization: `Bearer ${data.session.access_token}` }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = Error(result.error || "操作失败，请重试。");
    error.status = response.status;
    throw error;
  }
  return result;
}
export function authError(error) {
  const text = error?.message || "";
  if (/invalid.*username|username.*password/i.test(text)) return "用户名或密码不正确。";
  if (/username.*(taken|exists)/i.test(text)) return "该用户名已被使用，请换一个。";
  if (/invalid login credentials/i.test(text)) return "账号或密码不正确。";
  if (/email not confirmed/i.test(text))
    return "请先点击邮件中的链接验证邮箱。";
  if (/rate|too many|after .*seconds/i.test(text))
    return "操作过于频繁，请稍后再试。";
  if (/already registered/i.test(text))
    return "该邮箱已注册，请登录或找回密码。";
  if (/password.*(short|least|weak)/i.test(text))
    return "请使用至少 8 位的强密码。";
  if (/expired|invalid.*(token|code)|code.*invalid/i.test(text))
    return "链接已失效，请重新发送邮件。";
  if (/fetch|network/i.test(text)) return "网络连接失败，请稍后重试。";
  return text || "操作失败，请重试。";
}
