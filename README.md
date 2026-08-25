# Nuxt Cloudflare Email Demo

一个运行在 Cloudflare Workers 上的邮件发送 Demo：

- Nuxt 4 + Nuxt UI
- D1 管理员账户、登录限流、会话和发送记录
- Cloudflare Email Service `send_email` binding
- HttpOnly / SameSite 会话 Cookie
- PBKDF2-SHA256 盐化密码哈希（仓库不保存明文密码）

## 邮件编辑能力

- 纯文本、GitHub Flavored Markdown 转 HTML、手写 HTML
- 上传 `.html` / `.htm` 文件并作为邮件正文发送（不是附件）
- 隔离式 HTML 实时预览，阻止脚本、表单提交和远程资源
- To / Cc / Bcc 多收件人，合计最多 50 个地址
- Reply-To、发件人显示名、Preheader 和自动/自定义纯文本 fallback
- 优先级、敏感级别、Content-Language、Organization、邮件线程和追踪 ID
- 普通文件附件，最多 32 个；应用限制原始附件合计 3 MiB，为 Cloudflare 5 MiB 整封邮件限制预留 MIME 编码空间
- D1 保存发送状态、收件人、正文格式、优先级和附件数量，但不保存邮件正文或附件内容

## 本地验证

```bash
pnpm install
cp wrangler.example.jsonc wrangler.jsonc
pnpm cf-typegen
pnpm db:migrate:local
pnpm test
pnpm typecheck
pnpm preview
```

`pnpm dev` 使用 Nuxt 开发服务器，无法提供 D1 和 Email Service binding；需要验证完整流程时使用 `pnpm preview`。

## Cloudflare 部署

本仓库只提供不绑定任何 Cloudflare 账户或资源的 `wrangler.example.jsonc`。先创建
本地部署配置；`wrangler.jsonc` 已被 Git 忽略，不会误提交真实资源标识：

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

1. 将示例中的 Worker 名称改为自己的唯一名称。
2. 在 Cloudflare Email Service > Email Sending 中接入自己的发件域。
3. 创建 D1 数据库，将返回的名称和 `database_id` 写入本地 `wrangler.jsonc`。
4. 把 `allowed_sender_addresses` 和 `EMAIL_FROM` 改为已接入域名下的发件地址。
5. 初始化并部署：

```bash
pnpm db:migrate:remote
pnpm db:seed:admin
pnpm exec wrangler d1 execute DB --remote --file .data/admin.sql
pnpm deploy
```

`pnpm db:seed:admin` 会在终端中交互询问管理员邮箱和密码，将盐化后的 PBKDF2 哈希写入被 Git 忽略的 `.data/admin.sql`。源码、迁移和前端构建均不保存管理员邮箱或明文密码。

Cloudflare Email Service 仅适用于事务型邮件。请勿将本项目用于未经同意的营销群发；硬退信或投诉地址会进入 Cloudflare suppression list。

## 相关文档

- [Cloudflare Email Service Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Cloudflare Nuxt Workers 部署](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/nuxt/)
- [Cloudflare D1 Workers Binding API](https://developers.cloudflare.com/d1/worker-api/)
