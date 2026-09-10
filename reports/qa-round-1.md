# 质检报告 · Round 1 · 阶段 1（地基 + 认证 + 素材包加载）

> 依据文档：`docs/current-stage.md`、`docs/dev-stage-plan.md §3 阶段 1`、`docs/architecture.md v1.1`、`docs/database-schema.md v1.1`、`docs/requirements.md`、`CONTEXT.md`
> 检查时间：2026-09-09
> 检查人：质检

---

## 1. 基本信息

| 项 | 值 |
|---|---|
| 阶段 | 阶段 1（地基 + 认证 + 素材包加载） |
| 工作目录 | `C:/Python Auto/Python AI/cl/flutter/aetherPet` |
| Node 版本 | ≥ 20 |
| Next.js | 16.3.4（App Router） |
| 数据库驱动 | `mysql2` 3.24.4（异步连接池） |
| 邮件库 | `nodemailer` 10.0.1 |
| 校验/测试 | `zod` 4.5.4 / `vitest` 5.0.0 |

**验证命令与结果**：

```
npx tsc --noEmit       → 通过（0 错误）
npx vitest run         → 76 passed / 9 files
npx next build         → 通过（上一轮反馈）
```

---

## 2. 强制约束核验（4 项硬门）

| # | 约束 | 结果 | 证据 |
|---|------|------|------|
| C1 | 数据库必须 MySQL 8.x（不得是 SQLite） | ✅ 通过 | `docker/docker-compose.dev.yml` 使用 `mysql:8.4`；`package.json` 依赖 `mysql2`；全仓 `grep -rn "sqlite\|better-sqlite" src/` 返回 0 匹配；`src/domain/persistence/db.ts` 使用 `mysql.createPool` |
| C2 | 认证邮件必须带中心身份标识 | ✅ 通过 | `src/domain/auth/email-template.ts` L46/L79-82 输出 `X-Aetherpet-Hub` 与 `X-Aetherpet-Hub-Name` 头；正文抬头 `来自「<hub_display_name>」`；尾部落款 `隐私承诺：<hub_privacy_url>` + `管理员联系：<hub_admin_email>`；单测 `tests/unit/auth/email-template.test.ts` 覆盖 header + 正文 + 主题 + 剩余时间 6 项断言 |
| C3 | 领域层不得 import next/react | ✅ 通过 | `grep -rn "from 'next\|from 'react" src/domain/` 返回 0 匹配（仅 `src/domain/types.ts:6` 是注释）；`src/domain/**` 全部走 `crypto`/`fs`/`path`/`mysql2`/`nodemailer`/`zod`/`ulid` |
| C4 | 单测覆盖认证节流 + 素材包损坏回退 | ✅ 通过 | 节流：`throttle.test.ts` 5 组（IP/email/组合，含 30/3 边界）；magic-link 3 组（throttle/email_send_failed/成功）；素材包：`fallback.test.ts` 8 组覆盖 manifest 缺失、theme.css 缺失、无 default、空包降级；`loader.test.ts` 9 组含路径遍历拒绝；合计 76 tests |

---

## 3. 阶段 1 验收覆盖度对照

| 验收 | 覆盖情况 |
|------|----------|
| #1 注册登录（含安全边界） | ✅ 验证码签发/校验/退出全流程；节流 5min/3 次（email）+ 30 次（IP）；token 30 天有效；退出走 `revokeToken` + `sessions.revoked_at`；验证码 10min 过期；`isPackSchemaVersionSupported` 校验 |
| #8 素材包加载（阶段 1 加载部分） | ✅ manifest zod schema、loader 扫描 + 路径遍历防护、fallback 三级降级（当前包→default→空 manifest）、CSS 变量注入 ThemeProvider |
| #11 账号安全（节流/过期） | ✅ 双维度节流、验证码 10min TTL、token 30 天 TTL、审计日志覆盖 `verification_attempt/failed/throttled` + `login_success` + `token_revoked` + `email_sent` |

---

## 4. 测试汇总

- 发现问题总数：**12**
- P0（阻塞）：**2**
- P1（严重）：**4**
- P2（一般）：**5**
- P3（轻微）：**1**
- **测试通过：否**（P0 阻塞性问题未修复前不通过）

---

## 5. 详细问题清单

### P0 - 阻塞性问题

#### P0-001 · Migration runner 缺 `multipleStatements`，`001_init.sql` 首次启动必然失败

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/domain/persistence/migrations/runner.ts` L87-97；`src/domain/persistence/db.ts` L29-41 |
| 严重程度 | **阻塞** |
| 验收影响 | 阶段演示步骤 1「打开 http://localhost:3000」无法完成 —— `startup()` 内 `ensureMigrations()` 抛错，整个应用初始化失败 |

**问题描述：**

`runner.ts` 注释写着「MySQL 支持 multiStatements: true」，但 `db.ts` 的 `createPool` 选项里没有配置 `multipleStatements: true`。mysql2 默认 `multipleStatements: false`（见 `node_modules/mysql2/lib/connection_config.js:150`：`this.multipleStatements = options.multipleStatements || false`）。

`001_init.sql` 是 289 行、包含 **37 条 SQL 语句**（1 条 `CREATE DATABASE`、1 条 `USE`、11 张 `CREATE TABLE`、1 条 `ALTER TABLE`、22 条 `CREATE INDEX`）。用 mysql2 的 `pool.execute(sqlText)` 一次性发送会触发 `ER_PARSE_ERROR`（多语句），migration 完全无法执行。

**复现步骤：**

1. `npm run db:up` 起 MySQL 容器
2. `npm run dev` 启动 Next.js
3. `curl http://localhost:3000/api/healthz`
4. 期望：HTTP 200；实际：`_started=false`、`[startup] 初始化失败：...ER_PARSE_ERROR...You have an error in your SQL syntax`

**期望结果：** 001_init.sql 全部语句在连接上执行成功，`migrations` 表写入一行。

**实际结果：** 第一条 `CREATE DATABASE` 后立刻抛错，`users`/`pets`/`verification_codes` 等表未建，`startup()` 内 `try/catch` 吞掉错误仅 console.log，后续所有涉及 DB 的 API 全部 500。

**建议修复（任选其一）：**

- **方案 A（推荐）**：`db.ts` 的 `createPool` 增加 `multipleStatements: true`。风险：`withTransaction` 场景下多语句 SQL 依然安全（业务 SQL 都是单语句），但需要在代码评审时明确不允许 `execute()` 传多语句业务 SQL。
- **方案 B**：`runner.ts` 里把 `sqlText` 按 `;\n`（或专门的 delimiter）拆分成单条语句，逐条 `execute()`；`CREATE DATABASE IF NOT EXISTS` 在连接池未建立前无法执行，需要**先移除 migration 文件里的 `CREATE DATABASE` + `USE`**，让 Docker compose 的 `MYSQL_DATABASE=aetherpet` 负责建库。

---

#### P0-002 · `001_init.sql` 内含 `CREATE DATABASE IF NOT EXISTS aetherpet` 与 `db.ts` 的 `database: env.DB_NAME` 冲突

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/domain/persistence/migrations/001_init.sql` L13-16；`src/domain/persistence/db.ts` L29-41 |
| 严重程度 | **阻塞** |
| 依赖 | 依赖 P0-001 一起修复 |

**问题描述：**

`db.ts` 里连接池已经通过 `database: env.DB_NAME` 绑定目标数据库；若 `aetherpet` 库尚未创建，`initPool()` → `pool.query("SELECT 1")` 就会抛 `ER_BAD_DB_ERROR`，migration 根本跑不到。而 migration 里第一行 `CREATE DATABASE IF NOT EXISTS aetherpet` 又只能在**不指定 database** 的连接上执行 —— 两条路径相互冲突。

**建议修复：**

- 从 `001_init.sql` 中**移除** `CREATE DATABASE ... USE ...` 两行；数据库创建交给 `docker/docker-compose.dev.yml`（`MYSQL_DATABASE: aetherpet`）或独立 `scripts/init-db.sql`。
- 与 P0-001 方案 B 一起处理。

---

### P1 - 严重问题

#### P1-001 · IP 提取直接信任 `X-Forwarded-For`，可被伪造绕过 IP 全局限流

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/lib/request-helpers.ts` L9-17 |
| 严重程度 | 严重 |
| 验收影响 | §6 #11「IP 维度全局限流」名存实亡 |

**问题描述：**

```ts
const forwarded = req.headers.get("x-forwarded-for");
if (forwarded) return forwarded.split(",")[0].trim();
```

Next.js 部署后若上游无反代或反代未配置 `trust proxy`，客户端可以在请求里伪造 `X-Forwarded-For: 1.2.3.4`。攻击者每次请求换个随机 IP，`checkIpThrottle` 里每个 IP 独立计数，30 次/5min 的限流完全失效。

**期望：** 未配置可信反代时，忽略客户端传入的 `X-Forwarded-For`，回退到 `req.socket.remoteAddress`（或 `remote-addr`）。

**建议修复：**

- 若确实部署在反代后：环境变量 `TRUST_PROXY=true`（新增到 `env.ts`），仅在该开关为 true 时读取 `X-Forwarded-For` 右端（不是左端！）可信跳数对应的值。
- 否则：默认丢弃 `X-Forwarded-For`/`X-Real-Ip`，直接读 `req.socket.remoteAddress`。
- 建议同时把「首个 IP」改成「右端未伪造 IP」（业界标准）：`forwarded.split(",").pop().trim()`。

---

#### P1-002 · `/api/auth/verify` 端点无节流，攻击者可以「刷 email」绕开全局限流

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/app/api/auth/verify/route.ts`；`src/domain/auth/magic-link.ts` `verifyCode()` |
| 严重程度 | 严重 |
| 验收影响 | §6 #11「账号安全边界」被绕开 |

**问题描述：**

- `/api/auth/request-code` 有 email + IP 双维度节流。
- `/api/auth/verify` **无任何节流**，只校验 code 长度=6。
- 一个 6 位数字验证码 10min 有效，暴力破解成功率约 `10min / (6^6 * avg_latency)`；单 IP 可以每秒发几十次请求，理论上可枚举。
- 更进一步：单个 IP 可以循环换 email 请求验证码（30 次/5min 上限内），把 email 侧的 5min/3 次节流绕开 —— **IP 侧限流是主防线**，但 P1-001 已经让 IP 限流形同虚设。

**建议修复：**

- 给 `/api/auth/verify` 增加 **IP 5min/30 次**（或更严格）的独立节流。
- 给同一 `email_hash` 的 `verify` 增加 **尝试次数上限**（如 5 次）：写入 `verification_codes` 或独立表计数。
- 校验失败写审计 `verification_failed` 已有，好。

---

#### P1-003 · `verifyCode` 非原子事务：user 创建成功、token 签发失败会留下孤儿 session 或反例

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/domain/auth/magic-link.ts` L199-227 |
| 严重程度 | 严重 |

**问题描述：**

`verifyCode` 的顺序：
1. `vcRepo.markUsed(vc.id)` — 消耗 code
2. `usersRepo.insert(...)` 或复用已有 user
3. `issueToken(...)` → `sessionsRepo.insert(...)`
4. `auditRepo.insertAuditLog({ login_success, ... })`

步骤 3 若抛错（DB 连接抖动/超时）：code 已消耗、user 已建/已标 email_verified，但用户拿不到 token；下次再来需要重新申请验证码（可能触发节流）。若反过来 user insert 失败但 sessions 未写入，也会不一致。

同类问题在 `requestCode` 里也存在：`vcRepo.insert` 后 `sendEmail` 失败，验证码已入库但用户没收到邮件（当前代码是"返回 email_send_failed"，DB 里那行永远 unused 会占用节流额度）。

**建议修复：**

- `verifyCode` 步骤 1-3 包在 `withTransaction` 里，审计日志（步骤 4）单独事务。
- `requestCode` 里 email 发送失败时**立即 `markUsed` 或加 `failed_at` 字段**避免占用节流额度；或改成先 `dry-run`/预校验 SMTP，再入库。

---

#### P1-004 · 前端 ThemeProvider 通过 `<link href="/packs/{name}/theme.css">` 注入，但 `/packs/*` 静态路由不存在，素材包 CSS 永远 404

| 字段 | 内容 |
|------|------|
| 所在文件 | `src/ui/theme-provider.tsx` L75-83；`src/app/api/packs/route.ts` L20-31 |
| 严重程度 | 严重 |
| 验收影响 | 阶段 1 演示步骤 4「使用默认素材包的背景」不成立；§6 #8 素材包加载部分未完整交付 |

**问题描述：**

`/api/packs` 返回 `webPath: /packs/default` 和 `theme.css`，`ThemeProvider` 直接拼 `${current.webPath}/${current.theme.css}` 作为 `<link href>`。项目里没有任何 `src/app/packs/[name]/[file]/route.ts` 或对应的静态资源目录。

结果：浏览器加载页面时 `<link>` 得到 404，视觉完全靠 `<style>` 内联的 CSS 变量撑起来 —— 但素材包里 `theme.css` 定义的**类选择器**（如 `.paper`、`.event-card`、`.memory-ref`）全部丢失，首页 UI 会大面积走默认样式。

即使当前首页样式主要来自内联 CSS 变量（P3 层），后续阶段的事件卡片、时间线、信件页样式都要靠素材包 theme.css。这是必须提前修好的地基问题。

**建议修复：**

- **方案 A（推荐）**：新增 `src/app/packs/[name]/[file]/route.ts`，调用 `readPackFile(name, category, file)` 返回文件；`/api/packs` 返回的 `webPath` 保持 `/packs/default` 即可。
- **方案 B**：ThemeProvider 直接通过 `<style dangerouslySetInnerHTML={{__html: cssContent}}>` 注入 CSS 文本 —— 需要在 `/api/packs` 里把 `themeCssContent` 一并返回（当前 loader 已经在内存里缓存了，但 API 没吐出来）。

---

### P2 - 一般问题

#### P2-001 · `startup()` 内失败后不重试，`_started` 状态卡死

| 文件 | `src/lib/startup.ts` L19-37 |
|------|------|

**问题描述：** 若 `ensureMigrations` 中途失败，`catch` 只 console 不重抛；下次调用 `startup()` 时 `_started=false`（未标记完成）会再次走 init 流程。行为是「静默重试」，但如果 migration 半成功状态存在（MySQL DDL 隐式提交），重试会撞 checksum/主键冲突。

**建议修复：** 明确失败策略：要么失败阻塞启动（抛错让健康检查显式红），要么记录 `_failed` 状态让 healthz 暴露。

---

#### P2-002 · `/api/healthz` 未 `await startup()`，早期请求可能返回不完整状态

| 文件 | `src/app/api/healthz/route.ts` L15-25 |
|------|------|

**问题描述：** `instrumentation.ts` 里 `void startup()` 是 fire-and-forget；用户或负载均衡器在启动阶段就发起 `GET /api/healthz`，`healthCheck()` 直接调 `getPool().query("SELECT 1")`，此时 pool 可能刚建或 migration 未跑完，返回 `db.ok=false` → 503。

**建议修复：** `healthz` GET 内先 `await startup()` 再检查 DB；或者 `startup()` 暴露一个可 await 的 `startupReady` Promise，healthz `Promise.race([startupReady, 3s 超时])`。

---

#### P2-003 · Migration 应用后无 checksum 落库前置校验，半失败状态不可恢复

| 文件 | `src/domain/persistence/migrations/runner.ts` L92-107 |
|------|------|

**问题描述：** 单条 `execute(pool, sqlText)` 若中途抛错，MySQL DDL 已隐式提交的部分保留；然后 `INSERT INTO migrations` 也不会写入。下次启动 `runMigrations` 会再次尝试整个文件，撞 `ER_TABLE_EXISTS` 或 `ER_DUP_KEY`。**没有幂等性保障**。

**建议修复：** 按 P0-001 方案 B 拆分单语句 + 每条独立 commit + 每条独立记 checksum，或每条 SQL 用 `CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS`（MySQL 8.0 不支持后者，需 `INFORMATION_SCHEMA.STATISTICS` 检查）。

---

#### P2-004 · `POST /api/pet/create` 审计事件类型错用 `login_success`

| 文件 | `src/app/api/pet/create/route.ts` L76-82 |
|------|------|

**问题描述：**

```ts
await insertAuditLog({
  eventType: "login_success",
  ...
  detail: { action: "pet_created", petId: pet.id, petName: pet.name }
});
```

按 `docs/database-schema.md` §1 audit_log 的注释枚举，`pet_created` 应独立成 `pet_created` 类型；混到 `login_success` 里会让后续 §6 #11 的审计统计失真（每次登录会连带一次 pet 创建？）。

**建议修复：** 在 `docs/database-schema.md` 里正式补一条 `pet_created` 到 audit_log.event_type 枚举，改此调用为 `pet_created`。

---

#### P2-005 · pet 名称无字符白名单，前端渲染路径潜在 XSS / UI 破坏

| 文件 | `src/app/api/pet/create/route.ts` L17；`src/app/page.tsx` L131 |
|------|------|

**问题描述：**

```ts
const BodySchema = z.object({ name: z.string().min(1).max(32) });
```

`create-pet/page.tsx` 的 hint 写着「支持中文、英文、数字、下划线」，但后端 schema 允许 emoji、HTML、控制字符。虽然 React 默认 escape 输出，但 pet 名字会流转到：
- 素材包文案 placeholder `{pet_name}` → JSON 文件字符串化，未来可能被拼进 HTML template；
- 邮件正文（`email-template.ts` 有 `escapeHtml`，但只覆盖邮件模板，未覆盖 pet 名字）；
- 未来导出 JSON / 事件 time line。

**建议修复：** 后端 zod 加 `.regex(/^[\p{L}\p{N}_\-· ]+$/u)` 或明确枚举允许字符；`create-pet/page.tsx` 里同步 hint。

---

#### P2-006 · 缺少过期数据清理任务

| 文件 | `src/domain/persistence/repos/{verification-codes,sessions}.repo.ts` |
|------|------|

**问题描述：** `verification_codes.expires_at > now` 与 `sessions.expires_at > now` 只在查询时过滤，表内过期记录永久积累。MVP 用户量小可接受，但每 5min/3 次节流意味着 1 个 email 每天最多 144 条记录；官方中心规模下几个月就百万级。

**建议修复：** 增加 `scripts/prune.ts`（每日定时清 expired + revoked 数据），或 `startup()` 时执行一次轻量清理。文档 §6 阶段 6 的 backup 机制也需要考虑。

---

### P3 - 轻微问题

#### P3-001 · 代码小瑕疵（可延后处理）

| 编号 | 位置 | 问题 |
|------|------|------|
| P3-001a | `src/domain/auth/magic-link.ts` L218, L230 | `verifyCode` 内调 `getHubIdentity()` 两次（L218 建 user 时 + L230 issueToken 时），可以合并一次 |
| P3-001b | `src/domain/packs/fallback.ts` L75-83 | `getEffectivePack` 内 `requestedPack` 与 `defaultPack` 是同一查找结果，参数设计冗余 |
| P3-001c | `src/domain/persistence/db.ts` L36 | `charset: "utf8mb4_unicode_ci"` 传的是排序规则，`mysql2` 能识别但语义上不精确；应改为 `charset: "utf8mb4"`（MySQL 8 默认 `utf8mb4_0900_ai_ci`，与 docker-compose 的 `utf8mb4_unicode_ci` 一致即可） |
| P3-001d | `src/app/api/auth/me/route.ts` L4, L5；`src/app/api/pet/route.ts` L4 | `extractClientIp` 等 import 未使用 |
| P3-001e | `src/config/env.ts` L53-55 | email 格式正则 `^[^@\s]+@[^@\s]+\.[^@\s]+$` 允许子域内带 `\r\n` 等（虽 `[^@\s]` 排除 whitespace，但 `\.` 允许非 ascii 点号）；建议改 RFC 5321 简化版或使用 `z.string().email()` |

---

## 6. 代码审查亮点

以下方面表现良好，值得肯定：

1. **领域层零框架依赖**：`src/domain/**` 完全不 import `next`/`react`，符合架构 §3.1 硬约束。
2. **中心自治邮件实现完整**：Header（`X-Aetherpet-Hub` + `X-Aetherpet-Hub-Name`）、正文抬头（`hub_display_name`）、正文尾部（`privacy_url` + `admin_email`）三处都覆盖到；单测 6 项断言精准。
3. **素材包路径遍历防护**：`loader.ts` 里 `readPackFile` 拒绝 `..` 与绝对路径，且有 `abs.startsWith(packDir)` 双保险；单测覆盖。
4. **fallback 三级降级逻辑清晰**：当前包 → default → 空 manifest（前端降级纯文本），`fallback.test.ts` 8 组覆盖完整。
5. **审计日志覆盖全面**：`verification_attempt/failed/throttled`、`login_success`、`token_revoked`、`email_sent` 都写入 `audit_log`，覆盖需求 §3.13。
6. **测试基础设施干净**：`vi.hoisted` 解决 mock 提升问题，`beforeEach` reset 干净，无跨用例污染。
7. **MySQL 8.x 完全落地**：DDL 用 `BIGINT UNSIGNED UTC ms`、`utf8mb4_unicode_ci`、`GENERATED ALWAYS AS ... STORED` 生成列（`aggregate_ts` 等效 partial index），与 `database-schema.md v1.1` 完全对齐。

---

## 7. 测试覆盖评估

### 覆盖到位（无需补测）

- 认证节流边界：3/30 次、IP 通过 email 失败、IP 失败短路（`throttle.test.ts`）
- 邮件模板中心身份三处标识（`email-template.test.ts`）
- 素材包路径遍历拒绝、manifest schema 大版本兼容、fallback 三级降级（`loader.test.ts` + `fallback.test.ts` + `manifest-schema.test.ts`）
- token SHA256、验证码 6 位（`token.test.ts`）

### 建议补充测试（阶段 1 收尾前）

- **P0 修复后必补**：`runner.test.ts`（用 in-memory SQLite 或 mock pool）验证 37 条 SQL 按顺序执行 + checksum 落库 + 幂等性
- **P1-002 修复后必补**：`verify-rate-limit.test.ts` 覆盖 verify 端点节流边界
- **P1-003 修复后必补**：`magic-link-atomicity.test.ts` 模拟 sessionsRepo.insert 抛错，验证 user 回滚或 code 状态一致性
- **前端**：`playwright.config.ts` 尚不存在（架构 §3 目录列出但阶段 6 才建）；阶段 1 演示路径（登录→起 pet→首页）建议至少加一个 e2e smoke（不阻塞 P0/P1）

---

## 8. 质量评估

| 维度 | 评级 | 说明 |
|------|------|------|
| 代码质量 | 良 | 领域层干净、命名清晰、注释充分；小瑕疵在 P3 |
| 功能完整性 | **中** | 认证 + 素材包加载逻辑正确，但 **迁移启动 P0 阻断**导致阶段 1 无法演示；theme.css 静态路由 P1 阻断 UI 完整性 |
| 安全性 | 中 | 密码学选择正确（SHA256、随机 token、`code` 哈希落库）；但 IP 限流可绕过 + verify 无节流是两处硬伤 |
| 可维护性 | 优 | 分层清晰、单测好跑、mock 干净；migration 幂等性有欠 |
| 可交付性 | **否（阻塞）** | P0-001 + P0-002 不修无法跑通阶段演示 |

---

## 9. 是否建议提交

**否。** 建议按以下顺序修复后重新提交：

1. **本轮必修（P0）**：
   - P0-001 + P0-002：`db.ts` 加 `multipleStatements: true` **或** 拆分 migration 单语句；同时移除 `001_init.sql` 的 `CREATE DATABASE/USE`
   - 修复后：`docker compose up mysql && npm run dev && curl /api/healthz` 应返回 200
2. **本轮强烈建议修（P1）**：
   - P1-001：改 `extractClientIp` 只在可信反代下读取 `X-Forwarded-For`
   - P1-002：给 `/api/auth/verify` 加 IP 节流
   - P1-003：`verifyCode` 关键 3 步包 `withTransaction`
   - P1-004：加 `/api/packs/[name]/[file]` route handler 让 theme.css 可加载
3. **P2 可选择性修复**：不影响本轮通过，但建议本轮一起处理，避免阶段 2 返工。
4. **P3 可以留到阶段 2**：不影响功能。

---

## 10. 签名

- 质检：2026-09-09
- 报告文件：`reports/qa-round-1.md`
- 后续动作：把本报告交回软件工程师 → 修复 P0/P1 → 提交 `reports/qa-round-1-fixed.md` 回归报告 → 质检复审
