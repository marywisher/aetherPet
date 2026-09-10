# aetherPet 自托管部署指南（SELF-HOST）

> 适用版本：阶段 6（v0.1.0）｜ 部署形态：**路径 a（宝塔 + PM2 + MySQL）** 或 **路径 b（Docker Compose）**，二选一。
> 前置概念：aetherPet 是「去中心化理念」应用——每个自托管实例都是一个独立「服务中心」（hub），
> 有自己的身份（`HUB_ID`）、邮箱（SMTP）与公告渠道。数据归用户，JSON 导出/导入即可换中心。

---

## 0. 架构总览

```
浏览器 ──► 反代（Apache/Nginx，HTTPS）──► Next.js standalone（:3000，PM2 或容器）──► MySQL 8
                                                                    │
                                                                    └─► SMTP（验证码/通知）
```

- 应用 = Next.js `output: "standalone"` 单进程服务（无构建期静态导出依赖）
- 数据库 = MySQL 8.x，表结构由内置 migration 管理（首次启动自动执行，`DB_AUTO_MIGRATE=true`）
- 素材包 = `src/assets/packs/`（standalone 产物已包含）；切换由开发者模式/`PACKS` API 驱动
- 备份 = 用户侧 JSON 导出（应用内）+ 数据库 mysqldump（见 §5）

### 两种路径对比

| 维度 | 路径 a：宝塔面板 | 路径 b：Docker Compose |
|------|------------------|------------------------|
| MySQL | 宝塔面板安装的 MySQL 实例 | 容器内 mysql:8.4 |
| Node 守护 | PM2（本机安装） | 容器 restart 策略 |
| 反代 | 宝塔站点反向代理 → 127.0.0.1:3000 | 自选 Nginx/Caddy/Apache |
| 备份 | 宝塔定时备份（推荐，零代码）或 scripts/backup.ts | scripts/backup.ts 或容器内 mysqldump |
| 适用 | 已有宝塔面板/服务器，习惯面板运维 | 纯容器环境、CI/CD 化 |

---

## 1. 前置要求

- 一台服务器（建议 1C2G 起）；域名一个（可选，但推荐，否则邮箱验证码的 SMTP SPF/DKIM 难配）
- Java 环境：Node.js ≥ 20（路径 a 需本机安装；路径 b 由镜像自带）
- MySQL 8.x（路径 a 由宝塔安装；路径 b 免装）
- 邮箱 SMTP 账号（QQ/163/Gmail/SES/Resend/自建均可），用于验证码与通知（中心自治邮件）
- 素材包：默认 `default` 包开箱即用；开发者备用包 `morning` 已内置

---

## 2. 通用：准备环境变量

复制 `.env.example` 为 `.env`，至少修改以下项：

```ini
# 数据库（路径 a 填宝塔 MySQL 的连接信息；路径 b 由 compose 注入，可留空让 compose 默认）
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=aetherpet
DB_PASS=「强密码」
DB_NAME=aetherpet

# 中心身份（对外展示 + 公告溯源）
HUB_ID=myhub               # 唯一标识，建议小写字母+数字
HUB_DISPLAY_NAME=我的 aetherPet 中心
HUB_ADMIN_EMAIL=admin@your-domain.com
HUB_PRIVACY_URL=https://your-domain.com/privacy
HUB_DOMAIN=your-domain.com

# SMTP（验证码邮件；DRY_RUN=true 时只打日志不真发，用于先跑通）
SMTP_HOST=smtp.your-mail.com
SMTP_PORT=587
SMTP_USER=your-mail-user
SMTP_PASS=your-mail-pass
SMTP_FROM=aetherpet@your-domain.com
SMTP_SECURE=false
SMTP_DRY_RUN=false

# 公告发布密钥（必须设置强随机值，留空则 /api/announcements/admin 返回 501）
HUB_ADMIN_TOKEN=「openssl rand -hex 32 生成」

# 运行
NODE_ENV=production
TRUST_PROXY=true          # 宝塔/Nginx 反代后必开；并确认反代已设置 X-Forwarded-For
PROXY_TRUST_HOPS=1
```

> ⚠️ 安全提醒：`DB_PASS`、`HUB_ADMIN_TOKEN`、`SMTP_PASS` 生产必须改为强随机值。`.env` 已被 .gitignore 排除，切勿提交。

---

## 3. 路径 a：宝塔面板 + PM2 + MySQL（推荐新手）

### 3.1 服务器准备（宝塔面板）

1. 宝塔面板 → 软件商店 → 安装：**MySQL 8.x**、**Nginx 或 Apache**、（Node 按需：宝塔「Node项目」或手动安装 nvm）
2. 创建 MySQL 数据库 `aetherpet`，用户 `aetherpet`，密码自定义；记录到 `.env`
3. 克隆代码到服务器：
   ```bash
   cd /www/wwwroot
   git clone <你的仓库地址> aetherpet
   cd aetherpet
   npm ci
   ```

### 3.2 构建 standalone 产物

```bash
npm run build
# 产物在 .next/standalone/；PM2 直接跑它，不依赖源码目录的运行期编译
```

### 3.3 PM2 守护进程

```bash
npm install -g pm2
pm2 start pm2-ecosystem.config.js
pm2 save
pm2 startup            # 按提示执行输出的命令，实现开机自启
pm2 status             # 应显示 aetherpet-web online
pm2 logs aetherpet-web # 查看启动日志（首次会自动跑 migration）
```

`pm2-ecosystem.config.js` 已配置：`fork` 单实例（MVP 建议单实例，避免进程内缓存竞争）、
自动重启（`max_restarts: 5`）、按日日志、`NODE_ENV=production`、端口 3000。

> 环境变量：PM2 默认从 `cwd/.env` 读取（PM2 内置 dotenv 支持）。若自行用 systemd，注意用 `EnvironmentFile`。

### 3.4 站点 + 反向代理（宝塔）

1. 宝塔「网站 → 添加站点」：填域名（如 `pet.example.com`）、纯静态即可
2. 站点「设置 → 反向代理 → 添加反向代理」：
   - 代理名称：`aetherpet`
   - 目标 URL：`http://127.0.0.1:3000`
   - 开启「发送代理头」：宝塔会自动加 `X-Forwarded-For`、`X-Real-IP`（对应 `TRUST_PROXY=true`）
3. SSL：站点设置 → SSL → Let's Encrypt 免费证书（HTTP 会强制跳转，勿用）
4. 域名 DNS A 记录解析到服务器 IP；确认邮件域名的 SPF/DKIM 记录（§4.2）

### 3.5 验证

```bash
curl -s http://127.0.0.1:3000/api/healthz | jq .          # {"ok":true,...}
curl -s -o /dev/null -w "%{http_code}" https://pet.example.com/api/healthz  # 200
```

浏览器访问 → 注册邮箱验证码（`SMTP_DRY_RUN=false` 会真发邮件）→ 创建 pet → 首页可见事件。

---

## 4. 路径 b：Docker Compose（app + mysql 两容器）

### 4.1 准备与启动

```bash
cd aetherpet
# .env 只需 SMTP/中心身份等业务变量；DB_* 由 compose 注入（默认值即可）
cp .env.example .env
# 编辑 .env：SMTP_*、HUB_*、HUB_ADMIN_TOKEN、TRUST_PROXY

docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml ps   # mysql healthy、app running
docker compose -f docker/docker-compose.yml logs -f app
```

- mysql 容器：MySQL 8.4，数据卷持久化（`aetherpet_mysql_data`），带健康检查
- app 容器：standalone 产物 + 素材包/migration（已打进镜像），`depends_on` mysql healthy 才启动
- 端口：默认暴露 `0.0.0.0:3000`；如需只对反代开放，把 `ports` 改为 `127.0.0.1:3000:3000`

### 4.2 反代（自选 Nginx 示例）

```nginx
server {
  listen 443 ssl;
  server_name pet.example.com;
  ssl_certificate     /etc/nginx/ssl/fullchain.pem;
  ssl_certificate_key /etc/nginx/ssl/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

> 应用在可信反代后 → `.env` 设 `TRUST_PROXY=true`，IP 限流才会读到真实客户端 IP。

### 4.3 更新镜像

```bash
git pull && docker compose -f docker/docker-compose.yml up -d --build
```

### 4.4 邮件域名配置（两条路径通用）

- 添加 SPF 记录：`v=spf1 include:你的邮件服务商 -all`（发件域名）
- 添加 DKIM 记录（按邮件服务商给的公钥）
- 这样验证码邮件才不会被送进垃圾箱；官方中心灰度环境可先用 `SMTP_DRY_RUN=true` 验证整条流程

---

## 5. 备份与恢复

### 5.1 数据库备份（供原样恢复服务器）

- **路径 a（推荐）**：宝塔面板「数据库 → 备份」设置定时备份（每日/每周），产物为 .sql 文件
- **路径 b**：宿主机执行
  ```bash
  node scripts/backup.ts                    # → data/backups/aetherpet-YYYY-MM-DD.sql.gz
  # 或容器内
  docker compose -f docker/docker-compose.yml exec mysql \
    sh -c 'exec mysqldump --single-transaction -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' \
    | gzip > backup.sql.gz
  ```
- 验证备份：`zcat data/backups/aetherpet-<date>.sql.gz | head -5`

### 5.2 用户侧数据备份（数据主权）

应用内「设置 → 导出备份」一键生成含 SHA256 校验和的 JSON；
「设置 → 导入恢复」可整体还原到任意中心（含换中心迁移场景）。

---

## 6. 环境变量全表

| 变量 | 默认 | 说明 |
|------|------|------|
| DB_HOST / DB_PORT / DB_USER / DB_PASS / DB_NAME | 127.0.0.1 / 3306 / aetherpet / aetherpet / aetherpet | 数据库连接 |
| DB_POOL_SIZE | 10 | 连接池大小 |
| DB_AUTO_MIGRATE | true | 启动自动执行 migration（生产可关，单独跑） |
| TOKEN_TTL_MS | 30 天 | 登录 token 有效期 |
| SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM | 空 | 验证码邮件 |
| SMTP_SECURE | false | true=465 TLS / false=587 STARTTLS |
| SMTP_DRY_RUN | true | true 只打日志不发信 |
| HUB_ID | local | 中心标识（导出 exported_from、公告溯源） |
| HUB_DISPLAY_NAME / HUB_ADMIN_EMAIL / HUB_PRIVACY_URL / HUB_DOMAIN | … | 中心身份 |
| HUB_ADMIN_TOKEN | 空 | 公告发布密钥（留空 501） |
| ASSET_PACKS_DIR | ./src/assets/packs | 素材包目录（standalone 产物已含） |
| DEFAULT_PACK | default | 默认素材包 |
| TRUST_PROXY / PROXY_TRUST_HOPS | false / 1 | 可信反代 IP 透传 |
| ENABLE_DEV_ENDPOINTS | false | 生产禁止开启（保留为演示环境用） |

---

## 7. 常见问题（FAQ）

- **healthz 显示 failed**：MySQL 连不上或 migration 失败。看 `logs/` 当日日志与 `pm2 logs`；确认 `.env` 的 `DB_*` 与宝塔数据库一致；`DB_AUTO_MIGRATE=true` 首启会自动建表。
- **验证码邮件收不到**：先 `SMTP_DRY_RUN=true` 看服务端 console 是否生成；再检查 SPF/DKIM、端口（587/465）与 `SMTP_SECURE`。
- **404 /announcements/admin**：`HUB_ADMIN_TOKEN` 未配置（会返回 501 + 明确文案），用 `openssl rand -hex 32` 生成后重启。
- **想换素材包**：开发者页（开发者模式）一键切换；或直接改 `user_settings.active_pack_name`。
- **升级版本**：`git pull && npm ci && npm run build`，PM2 重启；migration 会自动增量应用（新表自动建，老数据不动）。
- **为什么不用 Docker 也要配 standalone？** 宝塔路径直接用 `.next/standalone/server.js` 会比 `next start` 更省内存、更稳（无构建期依赖）。

---

## 8. 安全清单（上线前必查）

- [ ] `.env` 已改全部默认密码/密钥（DB、SMTP、HUB_ADMIN_TOKEN）
- [ ] `SMTP_DRY_RUN=false`（真发邮件）
- [ ] `ENABLE_DEV_ENDPOINTS=false`（禁用开发触发接口）
- [ ] HTTPS 已启用（Let's Encrypt）
- [ ] `TRUST_PROXY=true` 且反代已配置代理头；否则保持 false
- [ ] 数据备份策略已生效（宝塔定时备份或 scripts/backup.ts）
- [ ] 日志目录 `logs/` 权限最小化（含用户 IP 等隐私）
- [ ] 域名 SPF/DKIM 已配置（邮件不进垃圾箱）