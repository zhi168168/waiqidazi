# 职场英语搭子 · 网页版

保留职场陪伴聊天、英语顺手学、完整回复英译、话题与记忆、语料库、收藏、朗读和原管理后台，新增邮箱账号体系及 Vercel 部署适配。

- 用户端：`/`
- 内容与运营后台：`/admin`
- 技术：React + Vite、Supabase Auth、PostgreSQL、Supabase 私有存储、Vercel Node.js Functions。
- 登录注册使用 [Supabase 官方 SDK](https://github.com/supabase/supabase-js)，支持邮箱验证、会话自动刷新、密码重置、退出所有登录和注销；不自行存储用户密码。

## 首次准备

1. 创建 Supabase 项目，开启邮箱密码登录及邮箱验证，配置 SMTP、正式域名和邮件回调地址。
2. 参考 [.env.web.example](.env.web.example) 填写新环境变量。已有 `.env` 请先备份，不要覆盖原密钥。正式环境需要 PostgreSQL 事务连接池、私有音频存储、模型/语音/审核服务配置。
3. 使用新环境执行 `pnpm setup:web`，初始化私有表、管理员和音频桶。
4. 在管理后台补全实际隐私说明，确认后设 `PRIVACY_POLICY_CONFIRMED=true`。

完整步骤、GitHub 方案对比、Vercel 配置及验证边界见 [网页版与 Vercel 部署](docs/网页版与Vercel部署.md)。

## 开发与验证

需要 Node.js 24 和 pnpm。

```powershell
pnpm install
pnpm setup:web
pnpm build
pnpm start
# 前端热更新：另开终端 pnpm dev
pnpm test
```

本地业务服务默认 `http://127.0.0.1:8838`，前端开发服务器为 8839。Vercel 使用根目录 `vercel.json`，构建输出 `dist`，API 由 `api/[...path].mjs` 提供。

生产环境不依赖本地磁盘持久化。模型与服务端凭证不会发送给浏览器。后台任务使用 Vercel `waitUntil` 和数据库任务领取，仍受 Function 执行时长限制。

## 旧系统与数据

原小程序、SQLite/MySQL 及其部署脚本保留，旧后端使用 `pnpm start:legacy`。原说明保存在 [小程序旧版说明](docs/小程序旧版说明.md)。本次不会自动修改旧线上服务或迁移历史身份；新邮箱账号与旧 WeChat OpenID 不自动合并。已有语料、音频和用户数据迁移应在独立备份后处理。

## 隔离浏览器验收

`node scripts/preview-web-fixture.mjs` 仅启动独立临时数据库、模拟账号/邮件/模型接口，并提供标注为测试用途的语料和音频。它不读取原生产数据、不调用付费模型，也不进入 Vercel 生产入口。此验证不能替代真实 SMTP、Supabase 云项目及 Vercel 部署验收。

## 网站品牌图标

`icon.png` 为原始素材，网页仅引用 `public/brand/` 下经过裁切、等比缩放的衍生文件。替换原图后，使用安装了 Pillow 的 Python 执行 `python scripts/build-brand-assets.py`，再运行 `pnpm build`。生成 WebP LOGO（96/192）、PNG 图标（32/180/192/512）及包含 16/32/48 像素的 ICO。
