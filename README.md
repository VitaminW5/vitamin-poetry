# 维生素 · Cloudflare 免费公网版 V1.4

本版本用于 Cloudflare Pages + Pages Functions + D1。

## 部署设置

Cloudflare Pages 创建项目时：

- Git 仓库：`VitaminW5/vitamin-poetry`
- Framework preset：`None`
- Build command：`exit 0`
- Build output directory：`public`
- Root directory：留空（仓库根目录）

项目第一次部署后会获得 `https://<项目名>.pages.dev`。

## 绑定 D1

1. Cloudflare Dashboard → Workers & Pages → D1 SQL Database → Create database。
2. 数据库名建议：`vitamin-poetry-db`。
3. 回到 Pages 项目 → Settings → Bindings → Add → D1 database bindings。
4. Variable name 必须填写：`DB`。
5. 选择刚创建的 `vitamin-poetry-db`。
6. 保存后 Redeploy。

无需手工导入 SQL。第一次访问 API 时，Functions 会自动建表并把 97 篇初始作品写入空数据库。

## 配置后台密钥

Pages 项目 → Settings → Variables and Secrets → Add：

- `VITAMIN_ADMIN_PASSWORD`：后台登录密码，选择 Encrypt。
- `VITAMIN_SESSION_SECRET`：至少 64 位随机字符串，选择 Encrypt。

设置完成后重新部署。

后台地址：`https://<项目名>.pages.dev/studio`

## 数据策略

- 前台静态资源：Cloudflare Pages。
- 公共与后台 API：Pages Functions。
- 在线修改后的诗歌：D1 数据库。
- 如果 D1 尚未绑定，前台仍会用内置 97 篇初始数据只读运行；后台编辑会禁用。
- `data/poems.json` 是源数据参考，线上权威数据绑定 D1 后以 D1 为准。

## 免费额度适配

静态资源请求不计 Pages Functions 请求；本项目只有 `/api/*` 会调用 Functions。对个人诗歌站流量而言，免费额度非常宽裕。
