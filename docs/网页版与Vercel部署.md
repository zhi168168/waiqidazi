# 职场英语搭子 · 网页版

## 架构与功能

用户端 `/`，管理后台 `/admin`。用户端保留陪伴聊天、独立英语便签、完整回复英译、自动话题切换、历史、短期及长期记忆、记忆更正删除、四个场景的语料搜索筛选、收藏、AI 朗读、基于语料的练习、头像昵称、个人偏好、反馈和账号注销。后台保留语料版本、试听审核发布、分类、任务、全局人设、配置版本回退、管理员角色及操作审计。

- Vite + React：桌面和手机网页，Vercel 静态分发。
- Vercel Node.js 24 Function：`api/[...path].mjs`，复用既有业务策略的异步 PostgreSQL 路由 `server/web-app.mjs`。
- Supabase Auth：邮箱密码注册、邮箱验证、登录、刷新会话、密码重置、退出与注销。使用官方 SDK，无自制用户密码库。
- Supabase PostgreSQL：`buddy` 私有 schema 保存业务数据，仅服务端数据库连接可访问；不向浏览器开放业务表。
- Supabase Storage：私有音频桶，经业务接口鉴权后读取。头像保存为经大小和文件头校验的图片数据。
- 音频通过业务接口鉴权后重定向到短期签名地址，避免大段 WAV 超过 Vercel Function 的响应体大小限制；管理员同样可以试听已发布语料。
- 模型、TTS、内容审核凭证只在服务端使用。

原小程序和原 `server/app.mjs` 保留，旧启动命令改为 `pnpm start:legacy`。不会自动改动原 SQLite/MySQL、音频或线上部署。旧 WeChat OpenID 与新邮箱身份不自动合并，避免串号。

## GitHub 方案调研（2026-10-15）

已通过 GitHub API 读取以下仓库元数据，并读取 Supabase JS 官方 README，核实其 Auth 和 Storage SDK：

| 项目 | 地址 | 适配判断 |
| --- | --- | --- |
| Supabase | https://github.com/supabase/supabase | 本项目采用。Auth、PostgreSQL、私有存储一起提供，适合 Vercel 多实例和现有 React 应用。 |
| Supabase JS | https://github.com/supabase/supabase-js | 接入官方 `@supabase/supabase-js`，支持浏览器和服务端；PKCE 回调、自动刷新会话、Auth 与 Storage。 |
| Better Auth | https://github.com/better-auth/better-auth | 维护活跃，适合自主管理认证服务器；本项目还需持久化数据库和对象存储，采用 Supabase 可减少独立组件。 |
| Auth.js | https://github.com/nextauthjs/next-auth | 成熟认证方案；本项目是 Vite + Node，现阶段不额外迁到 Next.js，也无需只为登录引入框架。 |

这是代码接入选择，不表示通过任何部署或服务商审核。

## 首次配置

1. 创建 Supabase 项目，记录项目 URL、公开 anon key、**服务端** service role key。
2. 在 Authentication 中启用 Email/Password，并开启 **Confirm email**。设置密码最小长度为 12。配置你自己的 SMTP 邮件服务；Supabase 默认邮件服务有收件人和频率限制，不适合直接向公众开放。
3. Authentication → URL Configuration：Site URL 设置为正式域名（例如 `https://your-app.vercel.app`）；Redirect URLs 精确加入 `https://your-app.vercel.app/auth/callback` 和 `https://your-app.vercel.app/reset-password`。本地联调可加入相应 `http://127.0.0.1:8838/...`。每个预览域名单独添加，不给不可信域名通配授权。
4. 取得 PostgreSQL **事务连接池**连接串（通常端口 6543），作为 `DATABASE_URL`；代码禁用 prepared statements，支持事务池。用单独测试数据库联调，不指向旧生产库。
5. 参考根目录 `.env.web.example` 配置本地环境或 Vercel 环境变量。不要覆盖原有 `.env`，先备份或使用 `node --env-file=你的新配置文件 ...`。新环境必须 `DB_DRIVER=postgres`、`AUDIO_STORAGE=supabase`、`ALLOW_DEV_LOGIN=false`。填写至少 12 位管理员密码。
6. 在本地使用新环境运行 `pnpm setup:web`，初始化私有业务表、初始管理员、四个场景和私有音频桶。脚本可重跑，不覆盖现有内容及管理员密码；不在 Vercel build 中执行，不需要把生产密钥暴露给前端构建。
7. 保留原来的 DeepSeek、阿里 TTS 等供应商配置。新项目不调用微信内网审核服务；配置 `CONTENT_SAFETY_PROVIDER=http` 及独立 `CONTENT_SAFETY_URL`，协议仍为 POST `{text}` → `{allowed:true}`。未配置时聊天与语料发布会明确拒绝，不能静默跳过。
8. 进入 `/admin` 配置隐私说明，写清实际运营方、联系方式、模型/语音服务商、发送的数据、保留删除规则。确认后设 `PRIVACY_POLICY_CONFIRMED=true` 才开放用户业务登录。

服务端凭证：`DATABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`ADMIN_PASSWORD`、模型/TTS/审核密钥。所有凭证都不能使用 `VITE_` 前缀。`/api/auth/config` 仅返回项目 URL 和公开 anon key。

## 部署到 Vercel

1. 将本项目上传到自己的 GitHub 私有仓库，再在 Vercel Import Project（当前目录尚未关联 Git 仓库）。
2. Node 版本使用 24；Build 为 `pnpm build`，Output 为 `dist`，根目录已有 `vercel.json`。Function 时长配置 300 秒，需确认所用套餐及 Fluid Compute 支持该时长；若不支持，不能将配置调短后直接当作已验证。
3. 在 Vercel 配置以上服务端环境变量；生产与 Preview 建议用不同 Supabase 项目，避免测试写入生产数据。
4. 首次数据库初始化完成后部署。打开 `/` 和 `/admin`。刷新 `/library` 等页面应仍由 SPA 接管；`/api/*` 进入 Function，`/audio/*` 经 Function 鉴权读取。
5. 完成真实邮箱注册验证、登录、刷新、跨设备登录、忘记密码、密码重置、退出，以及账号注销验收。验证手机浏览器聊天、中文输入法 Enter、英语便签、英译、语料收藏和朗读，再发布。

## 后台任务与限制

回复生成、语音与记忆处理使用 Vercel `waitUntil` 延长请求后的任务执行。数据库事务及 PostgreSQL advisory locks 用于跨实例领取消息和任务、串行提交同一用户的消息和复用音频，避免把内存 Map 当成跨实例队列。冷启动不会把其他实例正在执行的任务全部改成失败。

页面轮询恢复已排队的消息，超出执行窗口的回复显示可重试失败；中断的任务必须检查供应商费用后手动重试。`waitUntil` 仍受 Function 最大执行时长约束，不是无限可靠的队列。大量并发、长音频或长任务应进一步使用持久化队列/独立 worker；本版没有声称已经验证大规模负载。

现有数据结构仍以实体 JSON 为主，部分查询会按类型读取后筛选。适合首版和小规模部署；用户量增长时应按 userId/sessionId 索引改为分页查询。

## 本地命令

```powershell
pnpm install
pnpm setup:web
pnpm build
pnpm start
# 或 pnpm dev，前端 8839，API 代理到 8838
pnpm test
pnpm test:web
```

浏览器/API 的测试桩验证不等于真实 SMTP、Supabase 云连接或 Vercel 线上验收。真实服务未配置前保持明确未配置状态。
