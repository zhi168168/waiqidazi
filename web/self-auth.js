// Adapter keeps existing UI flows while all sessions remain in HttpOnly cookies.
export function selfAuth(config) {
  const listeners = new Set();
  const emit = (event) => listeners.forEach((fn) => fn(event));
  const call = async (path, body) => {
    const response = await fetch("/api/accounts" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw Error(data.error || data.message || "账号操作失败，请重试。");
    return data;
  };
  const wrap = async (fn) => {
    try {
      return { data: await fn(), error: null };
    } catch (error) {
      return { data: {}, error };
    }
  };
  const session = async () => {
    const data = await call("/get-session");
    return { session: data?.user ? { user: data.user } : null };
  };
  return {
    config,
    auth: {
      getSession: () => wrap(session),
      onAuthStateChange(fn) {
        listeners.add(fn);
        return {
          data: { subscription: { unsubscribe: () => listeners.delete(fn) } },
        };
      },
      signUp: ({ email, password, options }) =>
        wrap(async () => {
          await call("/sign-up/email", {
            email,
            password,
            name: options?.data?.nickname || email.split("@")[0],
            callbackURL: options?.emailRedirectTo,
          });
          return session();
        }),
      signInWithPassword: ({ email, password }) =>
        wrap(async () => {
          await call("/sign-in/email", { email, password });
          emit("SIGNED_IN");
          return session();
        }),
      signOut: ({ scope } = {}) =>
        wrap(async () => {
          if (scope === "global" && (await session()).session)
            await call("/revoke-sessions", {});
          await call("/sign-out", {});
          emit("SIGNED_OUT");
          return {};
        }),
      resend: ({ email, options }) =>
        wrap(() =>
          call("/send-verification-email", {
            email,
            callbackURL: options?.emailRedirectTo,
          }),
        ),
      resetPasswordForEmail: (email, options) =>
        wrap(() =>
          call("/request-password-reset", {
            email,
            redirectTo: options?.redirectTo,
          }),
        ),
      updateUser: ({ password, currentPassword }) =>
        wrap(async () => {
          const token =
            location.pathname === "/reset-password"
              ? new URLSearchParams(location.search).get("token")
              : null;
          if (token)
            return call("/reset-password", { token, newPassword: password });
          return call("/change-password", {
            currentPassword,
            newPassword: password,
            revokeOtherSessions: true,
          });
        }),
    },
    issueRecoveryCode: async () => (await call("/recovery-code", {})).code,
    recover: (email, code, password) =>
      call("/recover", { email, code: code.trim().toLowerCase(), password }),
  };
}
