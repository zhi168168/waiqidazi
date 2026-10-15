import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  MessageCircle,
  BookOpen,
  History,
  Brain,
  User,
  ArrowUpRight,
  ArrowUp,
  Plus,
  ChevronRight,
  LogOut,
  Search,
  Bookmark,
  Volume2,
  Copy,
  Trash2,
  Square,
  Menu,
  X,
  Mail,
  ArrowLeft,
  Check,
  LoaderCircle,
  Settings,
  Briefcase,
  Users,
  Handshake,
  GraduationCap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getAuth, request, authError } from "./auth";
import "./style.css";
import "./user.css";
const Admin = lazy(() => import("./main"));
const avatar = "/buddy-avatar-v2.png";
const time = (value) =>
  new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
  });
const starters = [
  "什么事情都交给我做，我好欺负吗？",
  "明天要汇报了，我不知道怎么讲怎么办？",
];
const destinations = [
  ["/", "聊一聊", MessageCircle],
  ["/library", "场景语料", BookOpen],
  ["/history", "对话历史", History],
  ["/memory", "我的记忆", Brain],
  ["/profile", "我的", User],
];
function useRoute() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    addEventListener("popstate", update);
    return () => removeEventListener("popstate", update);
  }, []);
  const go = useCallback((path) => {
    history.pushState({}, "", path);
    setPath(path);
  }, []);
  return [path, go];
}
function Markdown({ children }) {
  return (
    <div className="w-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (/^https?:|^mailto:/i.test(url) ? url : "")}
        components={{
          a: (props) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
        }}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
function Spinner() {
  return <LoaderCircle className="w-spin" size={18} />;
}
function Button({ children, ...props }) {
  return (
    <button className="w-primary" {...props}>
      {children}
    </button>
  );
}
function Privacy({ onClose }) {
  const [policy, setPolicy] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/privacy")
      .then(async (r) => {
        if (!r.ok) throw Error("隐私说明加载失败");
        return r.json();
      })
      .then(setPolicy)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="w-overlay">
      <section
        className="w-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="隐私与 AI 使用说明"
      >
        <button
          className="w-icon w-dialog-close"
          onClick={onClose}
          aria-label="关闭"
        >
          <X />
        </button>
        <h2>隐私与 AI 使用说明</h2>
        {policy ? (
          <>
            <p className="w-pre">{policy.text}</p>
            <p>{policy.aiDisclosure}</p>
          </>
        ) : (
          <p>{error || "正在加载…"}</p>
        )}
        <Button onClick={onClose}>我知道了</Button>
      </section>
    </div>
  );
}
function AuthScreen({ go, mode = "login", onReady }) {
  const [step, setStep] = useState(mode),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [nickname, setNickname] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [privacy, setPrivacy] = useState(false),
    [configured, setConfigured] = useState(null),
    [recovery, setRecovery] = useState(false);
  useEffect(() => {
    let active = true;
    let sub;
    getAuth()
      .then(async (client) => {
        if (!active) return;
        setConfigured(Boolean(client));
        if (!client) return;
        sub = client.auth.onAuthStateChange((event) => {
          if (event === "PASSWORD_RECOVERY" && active) setRecovery(true);
        }).data.subscription;
        const result = await client.auth.getSession();
        if (active && mode === "reset" && result.data.session)
          setRecovery(true);
      })
      .catch((e) => setError(authError(e)));
    return () => {
      active = false;
      sub?.unsubscribe();
    };
  }, [mode]);
  useEffect(() => setStep(mode), [mode]);
  const change = (step) => {
    setStep(step);
    setError("");
    setNotice("");
  };
  async function submit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const client = await getAuth();
      if (!client) throw Error("账号服务尚未配置，请联系管理员。");
      let result;
      const callback = location.origin + "/auth/callback";
      if (step === "signup") {
        if (!consent) throw Error("请先同意隐私与 AI 使用说明。");
        result = await client.auth.signUp({
          email,
          password,
          options: { data: { nickname }, emailRedirectTo: callback },
        });
        if (result.error) throw result.error;
        if (result.data.session)
          throw Error("请先在 Supabase 开启邮箱验证，再开放注册。");
        setNotice("验证邮件已发送。请点击邮件中的链接，然后返回登录。");
      }
      if (step === "login") {
        if (!consent) throw Error("请先同意隐私与 AI 使用说明。");
        result = await client.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        await request("/auth/session", "POST", { consent: true });
        await onReady();
        go("/");
      }
      if (step === "forgot") {
        result = await client.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + "/reset-password",
        });
        if (result.error) throw result.error;
        setNotice("如果此邮箱已注册，你将收到密码重置邮件。");
      }
      if (step === "reset") {
        if (!recovery) throw Error("请先从密码重置邮件中的链接进入。");
        result = await client.auth.updateUser({ password });
        if (result.error) throw result.error;
        await client.auth.signOut({ scope: "global" });
        setNotice("密码已更新，请使用新密码登录。");
        setStep("login");
        setPassword("");
      }
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError("");
    try {
      const client = await getAuth();
      if (!client) throw Error("账号服务尚未配置。");
      const { error } = await client.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: location.origin + "/auth/callback" },
      });
      if (error) throw error;
      setNotice("验证邮件已重新发送，请查看收件箱及垃圾邮件。");
    } catch (e) {
      setError(authError(e));
    } finally {
      setBusy(false);
    }
  }
  const title = {
    login: "欢迎回来",
    signup: "认识一下，成为搭子",
    forgot: "找回密码",
    reset: "设置新密码",
  }[step];
  return (
    <div className="user-app w-auth">
      <section className="w-auth-story">
        <a
          className="w-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("/");
          }}
        >
          <img src={avatar} alt="" />
          <span>职场英语搭子</span>
        </a>
        <div className="w-auth-copy">
          <h1>
            工作里的那些事，
            <br />
            都可以跟我说。
          </h1>
          <p>聊聊今天的烦心事，也一起把英文说得更自然。</p>
          <div className="w-sample">
            <img src={avatar} alt="搭子" />
            <div>
              先别急着想怎么开口。
              <br />
              把你想说的话告诉我，我们慢慢来。
            </div>
          </div>
        </div>
        <span className="w-auth-foot">你的职场搭子，也陪你顺手学点英语。</span>
      </section>
      <section className="w-auth-form">
        <a
          className="w-back"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("/");
          }}
        >
          <ArrowLeft size={16} />
          返回首页
        </a>
        <form onSubmit={submit}>
          <h2>{title}</h2>
          <p className="w-muted">
            {step === "signup"
              ? "从一封验证邮件开始。"
              : step === "forgot"
                ? "我们会发送一封密码重置邮件。"
                : step === "reset"
                  ? "为你的账号设置一个新的强密码。"
                  : "登录后，继续我们的对话。"}
          </p>
          {configured === false && (
            <div className="w-notice">
              邮箱登录尚未开放，请联系管理员完成配置。
            </div>
          )}
          {error && (
            <div className="w-error" role="alert">
              {error}
            </div>
          )}
          {notice && (
            <div className="w-notice" role="status">
              {notice}
            </div>
          )}
          {step === "signup" && (
            <label>
              昵称
              <input
                required
                maxLength={32}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                autoComplete="nickname"
                placeholder="希望搭子怎么称呼你"
              />
            </label>
          )}
          {step !== "reset" && (
            <label>
              邮箱
              <input
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
          )}
          {step !== "forgot" && (
            <label>
              密码
              <input
                type="password"
                required
                minLength={step === "login" ? 1 : 12}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  step === "login" ? "current-password" : "new-password"
                }
                placeholder={
                  step === "login"
                    ? "输入你的密码"
                    : "至少 12 位，建议混合字母、数字和符号"
                }
              />
            </label>
          )}
          {["login", "signup"].includes(step) && (
            <label className="w-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                我已阅读并同意
                <button
                  type="button"
                  className="w-text"
                  onClick={() => setPrivacy(true)}
                >
                  隐私与 AI 使用说明
                </button>
              </span>
            </label>
          )}
          <Button
            disabled={
              busy || configured === false || (step === "reset" && !recovery)
            }
          >
            {busy ? <Spinner /> : null}
            {
              {
                login: "登录",
                signup: "注册并验证邮箱",
                forgot: "发送重置邮件",
                reset: "更新密码",
              }[step]
            }
          </Button>
          <div className="w-auth-links">
            {step === "login" ? (
              <>
                <button type="button" onClick={() => change("signup")}>
                  创建账号
                </button>
                <button type="button" onClick={() => change("forgot")}>
                  忘记密码？
                </button>
              </>
            ) : (
              <button type="button" onClick={() => change("login")}>
                已有账号，去登录
              </button>
            )}
            {step === "signup" && (
              <button type="button" disabled={busy || !email} onClick={resend}>
                重新发送验证邮件
              </button>
            )}
          </div>
        </form>
        <p className="w-small">回复由 AI 生成，请注意核实重要信息。</p>
      </section>
      {privacy && <Privacy onClose={() => setPrivacy(false)} />}
    </div>
  );
}
function Callback({ go, onReady }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [privacy, setPrivacy] = useState(false);
  useEffect(() => {
    getAuth()
      .then(async (client) => {
        if (!client) throw Error("账号服务未配置。");
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session)
          throw Error("链接已过期或验证未完成，请返回登录后重新发送邮件。");
      })
      .catch((e) => setError(authError(e)));
  }, []);
  return (
    <div className="user-app w-center">
      <section className="w-dialog">
        <img className="w-round" src={avatar} alt="" />
        <h1>邮箱验证</h1>
        <p>验证完成后，即可开始我们的对话。</p>
        {error && <p className="w-error">{error}</p>}
        <label className="w-consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            我同意
            <button className="w-text" onClick={() => setPrivacy(true)}>
              隐私与 AI 使用说明
            </button>
          </span>
        </label>
        <Button
          disabled={busy || !consent || Boolean(error)}
          onClick={async () => {
            setBusy(true);
            try {
              await request("/auth/session", "POST", { consent: true });
              await onReady();
              go("/");
            } catch (e) {
              setError(authError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          开始聊天
        </Button>
        <button className="w-text" onClick={() => go("/login")}>
          返回登录
        </button>
      </section>
      {privacy && <Privacy onClose={() => setPrivacy(false)} />}
    </div>
  );
}
function App() {
  const [path, go] = useRoute(),
    [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mobile, setMobile] = useState(false),
    [sid, setSid] = useState(""),
    [privacy, setPrivacy] = useState(false);
  const loadUser = useCallback(async () => {
    const u = await request("/me");
    setUser(u);
    return u;
  }, []);
  useEffect(() => {
    if (user) {
      try {
        setSid(localStorage.getItem("buddy-active:" + user.id) || "");
      } catch {}
    }
  }, [user?.id]);
  useEffect(() => {
    if (user) {
      try {
        if (sid) localStorage.setItem("buddy-active:" + user.id, sid);
        else localStorage.removeItem("buddy-active:" + user.id);
      } catch {}
    }
  }, [sid, user?.id]);
  useEffect(() => {
    if (path.startsWith("/admin")) {
      setLoading(false);
      return;
    }
    let active = true,
      sub;
    getAuth()
      .then(async (client) => {
        if (!client) return;
        if (active) {
          sub = client.auth.onAuthStateChange((event) => {
            if (event === "SIGNED_OUT") {
              setUser(null);
              setSid("");
            }
            if (event === "PASSWORD_RECOVERY") go("/reset-password");
          }).data.subscription;
        }
        try {
          const u = await request("/me");
          if (active) setUser(u);
        } catch (e) {
          if (![401, 403].includes(e.status)) throw e;
        }
      })
      .catch((e) => {
        if (active) setError(authError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      sub?.unsubscribe();
    };
  }, []);
  useEffect(() => {
    setMobile(false);
    setError("");
  }, [path]);
  const notify = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(""), 3500);
  };
  const act = async (fn) => {
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError(authError(e));
    }
  };
  const needLogin = () => {
    go("/login");
  };
  async function logout() {
    await act(async () => {
      const client = await getAuth();
      const { error } = await client.auth.signOut({ scope: "global" });
      if (error) throw error;
      setUser(null);
      setSid("");
      go("/");
    });
  }
  if (path.startsWith("/admin"))
    return (
      <Suspense
        fallback={
          <div className="w-center">
            <Spinner />
          </div>
        }
      >
        <Admin />
      </Suspense>
    );
  if (path === "/auth/callback") return <Callback go={go} onReady={loadUser} />;
  if (path === "/login" || path === "/reset-password")
    return (
      <AuthScreen
        key={path}
        mode={path === "/reset-password" ? "reset" : "login"}
        go={go}
        onReady={loadUser}
      />
    );
  const page = destinations.find((x) => x[0] === path)?.[1];
  return (
    <div className="user-app w-layout">
      <div className={"w-rail " + (mobile ? "w-open" : "")}>
        <a
          className="w-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("/");
          }}
        >
          <img src={avatar} alt="" />
          <span>
            职场英语搭子<small>工作里的事，跟我说说。</small>
          </span>
        </a>
        <button
          className="w-new"
          onClick={() => {
            setSid("");
            go("/");
            setMobile(false);
          }}
        >
          <Plus size={18} />
          新的对话
        </button>
        <div className="w-nav">
          {destinations.map(([url, label, Icon]) => (
            <button
              key={url}
              className={path === url ? "active" : ""}
              onClick={() => go(url)}
            >
              <Icon size={19} />
              {label}
              {path === url && <span className="w-active-dot" />}
            </button>
          ))}
        </div>
        <div className="w-rail-foot">
          <button className="w-policy" onClick={() => setPrivacy(true)}>
            隐私与 AI 使用说明
            <ArrowUpRight size={14} />
          </button>
          {user ? (
            <div className="w-person">
              <span className="w-user-avatar">
                {user.avatar ? (
                  <img src={user.avatar} alt="" />
                ) : (
                  (user.nickname || user.email || "我")
                    .slice(0, 1)
                    .toUpperCase()
                )}
              </span>
              <button onClick={() => go("/profile")}>
                <strong>{user.nickname || "我的账号"}</strong>
                <small>{user.email}</small>
              </button>
              <button className="w-icon" aria-label="退出登录" onClick={logout}>
                <LogOut size={17} />
              </button>
            </div>
          ) : (
            <Button onClick={needLogin}>
              登录 / 注册
              <ArrowUpRight size={16} />
            </Button>
          )}
        </div>
      </div>
      {mobile && (
        <button
          className="w-veil"
          aria-label="关闭菜单"
          onClick={() => setMobile(false)}
        />
      )}
      <section className="w-main">
        <div className="w-topbar">
          <button
            className="w-icon w-mobile-menu"
            aria-label="打开菜单"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <span>{page || "页面未找到"}</span>
          <div>
            <span className="w-ai-note">AI 陪伴 · 顺手学英语</span>
            {!user && (
              <button className="w-text" onClick={needLogin}>
                登录 / 注册
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="w-global-error w-error" role="alert">
            {error}
            <button
              className="w-icon"
              aria-label="关闭提示"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {loading ? (
          <div className="w-center">
            <Spinner />
          </div>
        ) : (
          <>
            {path === "/" ? (
              <Chat
                key={user?.id || "guest"}
                user={user}
                sid={sid}
                setSid={setSid}
                act={act}
                notify={notify}
                needLogin={needLogin}
              />
            ) : path === "/library" ? (
              <Library
                user={user}
                act={act}
                notify={notify}
                needLogin={needLogin}
                practice={async (corpusId) => {
                  if (!user) {
                    needLogin();
                    return;
                  }
                  await act(async () => {
                    const s = await request("/conversations", "POST", {
                      corpusId,
                    });
                    setSid(s.id);
                    go("/");
                  });
                }}
              />
            ) : !user ? (
              <div className="w-center">
                <section className="w-empty">
                  <User />
                  <h2>登录后继续</h2>
                  <p>保存你的对话、记忆和收藏。</p>
                  <Button onClick={needLogin}>登录 / 注册</Button>
                </section>
              </div>
            ) : path === "/history" ? (
              <HistoryPage
                act={act}
                open={(id) => {
                  setSid(id);
                  go("/");
                }}
                active={sid}
                setSid={setSid}
              />
            ) : path === "/memory" ? (
              <Memory act={act} notify={notify} />
            ) : path === "/profile" ? (
              <Profile
                user={user}
                loadUser={loadUser}
                act={act}
                notify={notify}
                logout={logout}
                onDeleted={() => {
                  setUser(null);
                  setSid("");
                  go("/");
                }}
              />
            ) : (
              <div className="w-center">
                <section>
                  <h1>页面未找到</h1>
                  <Button onClick={() => go("/")}>回到聊天</Button>
                </section>
              </div>
            )}
          </>
        )}
      </section>
      {notice && (
        <div className="w-toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {privacy && <Privacy onClose={() => setPrivacy(false)} />}
    </div>
  );
}
function Chat({ user, sid, setSid, act, notify, needLogin }) {
  const [messages, setMessages] = useState([]),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState({}),
    [short, setShort] = useState(null),
    [shortText, setShortText] = useState(""),
    [refreshKey, setRefreshKey] = useState(0),
    [context, setContext] = useState(null);
  const bottom = useRef(null),
    current = useRef(sid),
    input = useRef(null),
    requestId = useRef(null);
  const pending = messages.find((m) =>
    ["queued", "generating"].includes(m.status),
  );
  useEffect(() => {
    if (input.current) {
      input.current.style.height = "auto";
      input.current.style.height =
        Math.min(input.current.scrollHeight, 160) + "px";
    }
  }, [text]);
  useEffect(() => {
    current.current = sid;
    setMessages([]);
    setShort(null);
    setContext(null);
    let active = true;
    if (sid)
      request("/conversations")
        .then((items) => {
          if (active) setContext(items.find((item) => item.id === sid) || null);
        })
        .catch((e) => act(() => Promise.reject(e)));
    return () => {
      active = false;
    };
  }, [sid]);
  useEffect(() => {
    let active = true,
      timer;
    async function refresh() {
      try {
        if (!sid) return;
        let data = await request(`/conversations/${sid}/messages`);
        const pending = data.find((m) =>
          ["queued", "generating"].includes(m.status),
        );
        if (pending) {
          const latest = await request("/messages/" + pending.id);
          if (latest.sessionId !== sid) {
            if (active) setSid(latest.sessionId);
            return;
          }
          data = data.map((m) => (m.id === latest.id ? latest : m));
        }
        if (active) {
          setMessages(data);
          if (data.some((m) => ["queued", "generating"].includes(m.status)))
            timer = setTimeout(refresh, 1100);
        }
      } catch (e) {
        if (active) {
          act(() => Promise.reject(e));
          timer = setTimeout(refresh, 4000);
        }
      }
    }
    refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [sid, refreshKey]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, messages.at(-1)?.status]);
  async function send(value = text) {
    if (!user) {
      needLogin();
      return;
    }
    if (!value.trim() || busy || pending) return;
    setBusy(true);
    await act(async () => {
      let id = sid;
      if (!id) {
        const s = await request("/conversations", "POST", {});
        id = s.id;
        current.current = id;
        setSid(id);
      }
      requestId.current ||= crypto.randomUUID();
      const m = await request(`/conversations/${id}/messages`, "POST", {
        text: value,
        requestId: requestId.current,
      });
      requestId.current = null;
      setText("");
      setMessages((old) =>
        old.some((x) => x.id === m.id) ? old : [...old, m],
      );
      setRefreshKey((k) => k + 1);
    });
    setBusy(false);
    input.current?.focus();
  }
  async function translate(m) {
    setOpen((x) => ({
      ...x,
      [m.id]: { ...x[m.id], english: !x[m.id]?.english },
    }));
    if (m.englishReply || open[m.id]?.english) return;
    setOpen((x) => ({ ...x, [m.id]: { ...x[m.id], translating: true } }));
    await act(async () => {
      const result = await request(`/messages/${m.id}/english`, "POST", {});
      setMessages((ms) =>
        ms.map((x) =>
          x.id === m.id ? { ...x, englishReply: result.english } : x,
        ),
      );
    });
    setOpen((x) => ({ ...x, [m.id]: { ...x[m.id], translating: false } }));
  }
  async function retry(m) {
    await act(async () => {
      await request(`/messages/${m.id}/retry`, "POST", {});
      setMessages((ms) =>
        ms.map((x) =>
          x.id === m.id ? { ...x, status: "queued", error: null } : x,
        ),
      );
      setRefreshKey((k) => k + 1);
    });
  }
  return (
    <div className="w-chat">
      <div className="w-chat-scroll">
        {!messages.length ? (
          <div className="w-intro">
            <img src={avatar} alt="你的职场搭子" />
            <h1>
              {context?.practice
                ? context.practice.title
                : "说说，今天又发生了什么？"}
            </h1>
            {context?.practice ? (
              <p>
                {context.practice.situation}
                <br />
                准备好了，就和搭子一起开始练习。
              </p>
            ) : (
              <p>
                工作上的烦心事，或生活里的小开心，都可以聊。
                <br />
                聊完，顺手带走一句英语。
              </p>
            )}
            <div className="w-starters">
              {context?.practice ? (
                <button
                  onClick={() =>
                    send("我们开始练习这个场景吧，请你扮演我的对话对象。")
                  }
                >
                  开始练习
                  <ArrowUpRight size={18} />
                </button>
              ) : (
                starters.map((t) => (
                  <button key={t} onClick={() => send(t)}>
                    {t}
                    <ArrowUpRight size={18} />
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="w-turns">
            {messages.map((m) => (
              <article className="w-turn" key={m.id}>
                <div className="w-human">{m.text}</div>
                <div className="w-buddy-label">
                  <img src={avatar} alt="" />
                  <strong>搭子</strong>
                  <small>AI 生成</small>
                </div>
                {["queued", "generating"].includes(m.status) ? (
                  <div className="w-thinking">
                    <Spinner />
                    搭子正在想怎么说…
                  </div>
                ) : m.status === "complete" ? (
                  <>
                    <Markdown>{m.reply}</Markdown>
                    <div className="w-reply-actions">
                      <button
                        className={open[m.id]?.english ? "selected" : ""}
                        onClick={() => translate(m)}
                        aria-label="查看完整英文版本"
                      >
                        EN
                      </button>
                      <button
                        aria-label="复制回复"
                        onClick={() =>
                          act(async () => {
                            await navigator.clipboard.writeText(m.reply);
                            notify("已复制回复");
                          })
                        }
                      >
                        <Copy size={15} />
                      </button>
                    </div>
                    {open[m.id]?.english && (
                      <div className="w-english">
                        <small>英文版本</small>
                        {open[m.id]?.translating ? (
                          <p>
                            <Spinner />
                            正在翻译…
                          </p>
                        ) : m.englishReply ? (
                          <Markdown>{m.englishReply}</Markdown>
                        ) : (
                          <button
                            className="w-text"
                            onClick={() => {
                              setOpen((x) => ({
                                ...x,
                                [m.id]: { ...x[m.id], english: false },
                              }));
                            }}
                          >
                            翻译未完成，收起后可重新尝试
                          </button>
                        )}
                      </div>
                    )}
                    {m.englishTip && (
                      <div className="w-tip">
                        <div>
                          <strong>英语顺手学</strong>
                          <button
                            onClick={() =>
                              act(async () => {
                                await navigator.clipboard.writeText(
                                  m.englishTip.expression,
                                );
                                notify("已复制英文表达");
                              })
                            }
                          >
                            复制
                          </button>
                        </div>
                        <small>你刚刚这句话，用英文可以这么说</small>
                        <p>{m.englishTip.expression}</p>
                        <button
                          className="w-tip-toggle"
                          onClick={() =>
                            setOpen((x) => ({
                              ...x,
                              [m.id]: { ...x[m.id], tip: !x[m.id]?.tip },
                            }))
                          }
                        >
                          {open[m.id]?.tip ? "收起说明" : "为什么这样说"}
                          <ChevronRight size={15} />
                        </button>
                        {open[m.id]?.tip && (
                          <div className="w-tip-explanation">
                            {m.englishTip.explanation}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-error">
                    {m.error || "生成已取消。"}
                    <button className="w-text" onClick={() => retry(m)}>
                      重试
                    </button>
                  </div>
                )}
              </article>
            ))}
            <button
              className="w-text w-short-link"
              onClick={() =>
                act(async () => {
                  const sh = await request(`/conversations/${sid}/memory`);
                  setShort(sh);
                  setShortText(sh.summary || "");
                })
              }
            >
              查看当前对话记忆
            </button>
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="w-composer-wrap">
        <form
          className="w-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            ref={input}
            rows={1}
            maxLength={6000}
            aria-label="发送给搭子的消息"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              requestId.current = null;
            }}
            placeholder="想说什么，都可以…"
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                send();
              }
            }}
          />
          {pending ? (
            <button
              className="w-send"
              type="button"
              aria-label="停止生成"
              onClick={() =>
                act(async () => {
                  await request(`/messages/${pending.id}/cancel`, "POST", {});
                  setMessages((ms) =>
                    ms.map((m) =>
                      m.id === pending.id
                        ? { ...m, status: "cancelled", error: "已取消生成。" }
                        : m,
                    ),
                  );
                })
              }
            >
              <Square size={17} />
            </button>
          ) : (
            <button
              className="w-send"
              disabled={!text.trim() || busy}
              aria-label="发送消息"
            >
              {busy ? <Spinner /> : <ArrowUp size={21} />}
            </button>
          )}
        </form>
        <p>回复由 AI 生成，请注意核实重要信息。</p>
      </div>
      {short && (
        <div className="w-overlay">
          <section className="w-dialog">
            <h2>当前对话记忆</h2>
            <p className="w-muted">对话较长后会自动整理；你也可以更正。</p>
            <textarea
              aria-label="当前对话记忆"
              rows={8}
              maxLength={6000}
              value={shortText}
              onChange={(e) => setShortText(e.target.value)}
            />
            <div className="w-actions">
              <Button
                onClick={() =>
                  act(async () => {
                    await request(`/conversations/${sid}/memory`, "PATCH", {
                      summary: shortText,
                    });
                    setShort(null);
                    notify("对话记忆已保存");
                  })
                }
              >
                保存
              </Button>
              <button className="w-text" onClick={() => setShort(null)}>
                关闭
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Library({ user, act, notify, needLogin, practice }) {
  const [categories, setCategories] = useState([]),
    [category, setCategory] = useState(""),
    [subcategory, setSubcategory] = useState(""),
    [channel, setChannel] = useState(""),
    [formality, setFormality] = useState(""),
    [query, setQuery] = useState(""),
    [entries, setEntries] = useState([]),
    [detail, setDetail] = useState(null),
    [favorites, setFavorites] = useState([]),
    [onlyFav, setOnlyFav] = useState(false),
    [loading, setLoading] = useState(true),
    [audio, setAudio] = useState("");
  const audioRef = useRef("");
  useEffect(() => {
    act(async () => setCategories(await request("/categories")));
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        category,
        subcategory,
        channel,
        formality,
        q: query,
      });
      request("/corpus?" + params)
        .then((data) => {
          if (active) setEntries(data);
        })
        .catch((e) => {
          if (active) act(() => Promise.reject(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [category, subcategory, channel, formality, query]);
  useEffect(() => {
    if (user)
      act(async () =>
        setFavorites((await request("/favorites")).map((x) => x.id)),
      );
    else {
      setFavorites([]);
      setOnlyFav(false);
    }
  }, [user?.id]);
  useEffect(
    () => () => {
      URL.revokeObjectURL(audioRef.current);
    },
    [],
  );
  async function favorite(entry) {
    if (!user) {
      needLogin();
      return;
    }
    await act(async () => {
      const enabled = !favorites.includes(entry.id);
      await request("/favorites", "POST", { corpusId: entry.id, enabled });
      setFavorites((ids) =>
        enabled ? [...ids, entry.id] : ids.filter((x) => x !== entry.id),
      );
    });
  }
  async function play(entry) {
    if (!user) {
      needLogin();
      return;
    }
    await act(async () => {
      const client = await getAuth();
      const { data } = await client.auth.getSession();
      const response = await fetch(entry.audioUrl, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) throw Error("音频播放失败，请稍后重试。");
      const url = URL.createObjectURL(await response.blob());
      URL.revokeObjectURL(audioRef.current);
      audioRef.current = url;
      setAudio(url);
    });
  }
  const roots = categories.filter((c) => c.parentId === null),
    icons = [Briefcase, Users, Handshake, GraduationCap];
  return (
    <div className="w-content">
      <div className="w-page-heading">
        <div>
          <h1>
            {category
              ? roots.find((c) => c.id === category)?.name
              : "把想说的话，说得更自然。"}
          </h1>
          <p>从熟悉的工作场景开始。</p>
        </div>
        {category && (
          <button
            className="w-text"
            onClick={() => {
              setCategory("");
              setSubcategory("");
            }}
          >
            全部场景
          </button>
        )}
      </div>
      {!category ? (
        <div className="w-scenes">
          {roots.map((c, i) => {
            const Icon = icons[i] || BookOpen;
            return (
              <button
                key={c.id}
                onClick={() => {
                  setCategory(c.id);
                  setSubcategory("");
                }}
              >
                <Icon size={25} />
                <span>{c.name}</span>
                <ArrowUpRight size={19} />
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="w-filters">
        <label className="w-search">
          <Search size={17} />
          <input
            placeholder="搜索中英文、标题或标签"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {category && (
          <select
            aria-label="细分场景"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
          >
            <option value="">全部细分场景</option>
            {categories
              .filter((c) => c.parentId === category)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        )}
        <select
          aria-label="沟通方式"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          <option value="">全部沟通方式</option>
          {["口头", "邮件", "即时消息"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select
          aria-label="正式程度"
          value={formality}
          onChange={(e) => setFormality(e.target.value)}
        >
          <option value="">全部正式程度</option>
          {["自然", "正式", "轻松"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <button
          className={"w-filter-button " + (onlyFav ? "selected" : "")}
          onClick={() => {
            if (!user) {
              needLogin();
              return;
            }
            setOnlyFav(!onlyFav);
          }}
        >
          <Bookmark size={16} />
          我的收藏
        </button>
      </div>
      <div className="w-corpus-list">
        {loading ? (
          <div className="w-empty">
            <Spinner />
          </div>
        ) : (
          entries
            .filter((e) => !onlyFav || favorites.includes(e.id))
            .map((entry) => (
              <article className="w-corpus" key={entry.id}>
                <button
                  className="w-entry-main"
                  onClick={() =>
                    act(async () =>
                      setDetail(await request("/corpus/" + entry.id)),
                    )
                  }
                >
                  <small>
                    {entry.channel} · {entry.formality}
                  </small>
                  <h2>{entry.title}</h2>
                  <p className="w-english-line">{entry.english}</p>
                  <p>{entry.chinese}</p>
                </button>
                <div className="w-actions">
                  <button
                    aria-label={"朗读" + entry.title}
                    onClick={() => play(entry)}
                  >
                    <Volume2 size={17} />
                    朗读
                  </button>
                  <button
                    aria-label={"收藏" + entry.title}
                    className={favorites.includes(entry.id) ? "selected" : ""}
                    onClick={() => favorite(entry)}
                  >
                    <Bookmark size={17} />
                    {favorites.includes(entry.id) ? "已收藏" : "收藏"}
                  </button>
                  <button onClick={() => practice(entry.id)}>
                    跟搭子练习
                    <ArrowUpRight size={16} />
                  </button>
                </div>
              </article>
            ))
        )}
        {!loading &&
          !entries.filter((e) => !onlyFav || favorites.includes(e.id))
            .length && (
            <div className="w-empty">
              <BookOpen />
              <h2>这里还没有语料</h2>
              <p>
                {onlyFav
                  ? "喜欢的表达，收藏后就能在这里找到。"
                  : "试试其他筛选条件，或等待管理员发布语料。"}
              </p>
            </div>
          )}
      </div>
      {audio && (
        <div className="w-audio">
          <small>AI 生成朗读</small>
          <audio controls autoPlay src={audio} />
          <button
            className="w-icon"
            aria-label="关闭音频"
            onClick={() => {
              URL.revokeObjectURL(audioRef.current);
              audioRef.current = "";
              setAudio("");
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {detail && (
        <div className="w-overlay">
          <section className="w-dialog w-detail">
            <button
              className="w-icon w-dialog-close"
              aria-label="关闭详情"
              onClick={() => setDetail(null)}
            >
              <X />
            </button>
            <small>
              {detail.channel} · {detail.formality}
            </small>
            <h2>{detail.title}</h2>
            {[
              ["适用情境", detail.situation],
              ["英文表达", detail.english],
              ["中文释义", detail.chinese],
              ["使用说明", detail.notes],
            ].map(
              ([label, value]) =>
                value && (
                  <div key={label}>
                    <h3>{label}</h3>
                    <Markdown>{value}</Markdown>
                  </div>
                ),
            )}
            <div className="w-actions">
              <Button onClick={() => practice(detail.id)}>跟搭子练习</Button>
              <button onClick={() => play(detail)}>
                <Volume2 size={17} />
                朗读
              </button>
              <button
                onClick={() =>
                  act(async () => {
                    await navigator.clipboard.writeText(detail.english);
                    notify("已复制英文表达");
                  })
                }
              >
                <Copy size={17} />
                复制
              </button>
              <button onClick={() => favorite(detail)}>
                <Bookmark size={17} />
                {favorites.includes(detail.id) ? "已收藏" : "收藏"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function HistoryPage({ act, open, active, setSid }) {
  const [items, setItems] = useState(null);
  const load = async () => setItems(await request("/conversations"));
  useEffect(() => {
    act(load);
  }, []);
  return (
    <div className="w-content">
      <div className="w-page-heading">
        <div>
          <h1>我们的对话</h1>
          <p>上次没说完的，这次接着聊。</p>
        </div>
      </div>
      {items?.map((s) => (
        <article className="w-list-row" key={s.id}>
          <button className="w-row-main" onClick={() => open(s.id)}>
            <MessageCircle size={19} />
            <span>
              <strong>{s.title}</strong>
              <small>{time(s.updatedAt)}</small>
            </span>
            <ChevronRight size={17} />
          </button>
          <button
            className="w-icon"
            aria-label={"删除" + s.title}
            onClick={() => {
              if (confirm("删除这段对话及其来源的长期记忆？此操作无法撤销。"))
                act(async () => {
                  await request(
                    "/conversations/" + s.id + "?deleteMemory=true",
                    "DELETE",
                  );
                  if (active === s.id) setSid("");
                  await load();
                });
            }}
          >
            <Trash2 size={17} />
          </button>
        </article>
      ))}
      {items?.length === 0 && (
        <div className="w-empty">
          <History />
          <h2>还没有对话记录</h2>
          <p>和搭子聊一聊，故事从这里开始。</p>
        </div>
      )}
      {!items && <Spinner />}
    </div>
  );
}
function Memory({ act, notify }) {
  const [items, setItems] = useState(null),
    [editing, setEditing] = useState(null),
    [text, setText] = useState("");
  const load = async () => setItems(await request("/memory"));
  useEffect(() => {
    act(load);
  }, []);
  return (
    <div className="w-content">
      <div className="w-page-heading">
        <div>
          <h1>搭子记得的你</h1>
          <p>你可以随时更正、删除，也可以在「我的」中关闭记忆。</p>
        </div>
        {Boolean(items?.length) && (
          <button
            className="w-text w-danger"
            onClick={() => {
              if (confirm("清空全部长期记忆？聊天原文会保留。"))
                act(async () => {
                  await request("/memory", "DELETE");
                  await load();
                  notify("长期记忆已清空");
                });
            }}
          >
            清空记忆
          </button>
        )}
      </div>
      {items?.map((m) => (
        <article className="w-memory-row" key={m.id}>
          <div>
            <Brain size={18} />
            <p>{m.text}</p>
          </div>
          <small>
            {m.source === "user-correction"
              ? "你更正的记忆"
              : "从我们的对话中记住"}
          </small>
          <div className="w-actions">
            <button
              onClick={() => {
                setEditing(m);
                setText(m.text);
              }}
            >
              更正
            </button>
            <button
              className="w-danger"
              onClick={() => {
                if (confirm("删除这条记忆，并避免再次自动记住相同内容？"))
                  act(async () => {
                    await request("/memory/" + m.id, "DELETE");
                    await load();
                  });
              }}
            >
              删除
            </button>
          </div>
        </article>
      ))}
      {items?.length === 0 && (
        <div className="w-empty">
          <Brain />
          <h2>慢慢聊，慢慢了解你</h2>
          <p>你明确分享的背景和偏好，会出现在这里。</p>
        </div>
      )}
      {!items && <Spinner />}
      {editing && (
        <div className="w-overlay">
          <form
            className="w-dialog"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await request("/memory/" + editing.id, "PATCH", { text });
                setEditing(null);
                await load();
                notify("记忆已更正");
              });
            }}
          >
            <h2>更正这条记忆</h2>
            <textarea
              aria-label="记忆内容"
              required
              rows={5}
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="w-actions">
              <Button>保存</Button>
              <button type="button" onClick={() => setEditing(null)}>
                取消
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function Profile({ user, loadUser, act, notify, logout, onDeleted }) {
  const [nickname, setNickname] = useState(user.nickname || ""),
    [preferences, setPreferences] = useState(user.preferences || {}),
    [memory, setMemory] = useState(user.memoryEnabled),
    [password, setPassword] = useState(""),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    await act(async () => {
      if (nickname.trim()) await request("/me/profile", "PATCH", { nickname });
      await request("/me", "PATCH", { preferences, memoryEnabled: memory });
      await loadUser();
      notify("已保存");
    });
    setBusy(false);
  }
  async function upload(file) {
    if (!file) return;
    await act(async () => {
      if (
        !["image/png", "image/jpeg"].includes(file.type) ||
        file.size > 450000
      )
        throw Error("请选择小于 450 KB 的 PNG 或 JPG 头像。");
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error("读取头像失败。"));
        reader.readAsDataURL(file);
      });
      await request("/me/profile", "PATCH", { avatar: data });
      await loadUser();
      notify("头像已更新");
    });
  }
  return (
    <div className="w-content w-profile">
      <div className="w-page-heading">
        <div>
          <h1>我的</h1>
          <p>更了解你，才能更好地陪着你。</p>
        </div>
      </div>
      <form className="w-profile-section" onSubmit={save}>
        <h2>个人资料</h2>
        <div className="w-profile-avatar">
          {user.avatar ? (
            <img src={user.avatar} alt="头像" />
          ) : (
            <span>{(user.nickname || "我").slice(0, 1)}</span>
          )}
          <label className="w-text">
            更换头像
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => upload(e.target.files[0])}
            />
          </label>
        </div>
        <label>
          昵称
          <input
            maxLength={32}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
        <label>
          邮箱
          <input value={user.email || ""} readOnly />
        </label>
        {[
          ["job", "你的岗位"],
          ["goal", "想练习什么"],
          ["style", "希望搭子怎么跟你说话"],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              maxLength={key === "job" ? 100 : 200}
              value={preferences[key] || ""}
              onChange={(e) =>
                setPreferences({ ...preferences, [key]: e.target.value })
              }
            />
          </label>
        ))}
        <label className="w-consent">
          <input
            type="checkbox"
            checked={memory}
            onChange={(e) => setMemory(e.target.checked)}
          />
          <span>允许搭子记住我明确分享的背景与偏好</span>
        </label>
        <small>
          关闭后不再提取或调用长期记忆；已有记忆可以在「我的记忆」中删除。
        </small>
        <Button disabled={busy}>{busy ? <Spinner /> : null}保存资料</Button>
      </form>
      <form
        className="w-profile-section"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          act(async () => {
            const client = await getAuth();
            const { error } = await client.auth.updateUser({ password });
            if (error) throw error;
            setPassword("");
            notify("密码已更新，请重新登录");
            await logout();
          }).finally(() => setBusy(false));
        }}
      >
        <h2>账号安全</h2>
        <label>
          新密码
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 12 位"
          />
        </label>
        <Button disabled={busy}>更新密码</Button>
      </form>
      <form
        className="w-profile-section"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          act(async () => {
            await request("/feedback", "POST", { text: feedback });
            setFeedback("");
            notify("反馈已收到，谢谢你");
          }).finally(() => setBusy(false));
        }}
      >
        <h2>告诉我们你的想法</h2>
        <label>
          意见与反馈
          <textarea
            required
            rows={4}
            maxLength={2000}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="哪里可以做得更好？"
          />
        </label>
        <Button disabled={busy || !feedback.trim()}>提交反馈</Button>
      </form>
      <section className="w-profile-section">
        <h2>账号管理</h2>
        <button className="w-text" onClick={logout}>
          <LogOut size={16} />
          退出所有登录
        </button>
        <p className="w-muted">
          注销将删除账号、对话、记忆、收藏和反馈，无法恢复。
        </p>
        <button
          className="w-text w-danger"
          disabled={busy}
          onClick={() => {
            if (
              prompt("此操作不可撤销。请输入“注销账号”确认：") === "注销账号"
            ) {
              setBusy(true);
              act(async () => {
                await request("/me", "DELETE");
                const client = await getAuth();
                await client.auth.signOut({ scope: "local" });
                onDeleted();
              }).finally(() => setBusy(false));
            }
          }}
        >
          注销账号
        </button>
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
