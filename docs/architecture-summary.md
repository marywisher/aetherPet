# aetherPet MVP · 架构总结（给编排者读）

> 本文件是**四份文档**的总览与快速导航：
> - `docs/architecture.md` — 架构设计（12 节，约 15k 字）
> - `docs/database-schema.md` — 数据库设计（10 节，含完整 DDL + 索引汇总）
> - `docs/dev-stage-plan.md` — 开发阶段计划（6 阶段，含工时估算 + 验收矩阵）
> - `docs/architecture-summary.md` — **本文件**
>
> 编排者读完本文件即可掌握全局；工程师在具体阶段开工时读前 3 份对应的章节。

> **修订版本 v1.1（2026-09-09）**：两项权威变更（与四份文档同步）
> 1. **数据库：SQLite → MySQL 8.x**（驱动 `mysql2` 异步连接池；DDL 全部 MySQL 方言；时间戳统一 BIGINT UTC ms；备份机制 `mysqldump` 或 JSON 导出；部署改为 Next.js standalone + PM2 + 宝塔 Apache 反代 + MySQL；开发环境本地 Docker MySQL 与生产同构）。
> 2. **中心自治邮件（hub-autonomous email）**：注册/验证码邮件由用户所注册的中心自己配置的 SMTP 发出（配置项而非官方硬编码），邮件模板带中心身份标识字段。
>
> 不变：ULID 主键、事件-素材契约、补算/退避/馈赠机制、hub_id + schema_version 预留、6 阶段划分。

---

## 0. 一句话架构

**一个前后端同栈的 TypeScript Web 应用**：Next.js 提供 UI + API 层，中间是纯 TypeScript 写的领域层（事件引擎 / 补算 / 记忆 / 素材包 / 退避 / 公告 / 导入导出），底层是 **MySQL 8.x** 持久化（`mysql2` 异步连接池 + async 事务）；素材包与事件契约以 JSON 文件形式落在磁盘，运行期动态加载——**表现与逻辑完全解耦**是本项目从类型层到文件层的技术承诺。

---

## 1. 关键决策速览

| # | 决策 | 核心理由（不是"生态成熟"） |
|---|------|--------------------------|
| D1 | **Next.js + TS 全栈** | 事件契约/素材包 manifest/前端类型三方共用一套 TS 定义——"表现与逻辑解耦"从类型层落到文件层的技术前提 |
| D2 | **领域层纯 TS，无框架依赖** | 事件引擎、补算、退避、记忆检索都要能被 Vitest 独立跑，不能被 Next.js runtime 绑死；ESLint rule 强制 domain 目录禁 import next/react |
| D3 | **MySQL 8.x + `mysql2`（异步连接池）** | 与用户生产环境（宝塔 Apache + MySQL）同构；连接池代替 SQLite WAL 单写者，事务内做补算仍成立；JSON 类型原生支持，事件 params 可读 JSON path |
| D4 | **补算在服务端下一次同步请求内做，一个 async 事务内完成** | 上下文一致、无分布式锁、事务失败整体 rollback 保证不出现"半份事件"；async 事务配合 `getConnection/commit/rollback/release`，事务时长 ≤200ms |
| D5 | **素材包 = 磁盘上的 JSON + CSS** | 让"不写代码也能定制表现层"从第一天成立，是共创开发者进入的最低门槛 |
| D6 | **event.schema_version 与 pack_schema_version 分离** | 事件契约升级与素材包升级独立节奏，避免"改一行文案要升级所有事件类型" |
| D7 | **不建 wallets/market 表** | 需求明确 MVP 不做，用 nullable 字段（`pets.wallet_ref`、`items.base_price_cents`、`inventory.purchased_at/paid_cents`）预留，v2 上线时新表 + migration 更清爽 |
| D8 | **多中心预留 = 每表 `hub_id` + `schema_version`** | 跨中心导入时改写 `hub_id`；公告表额外预留 `author_hub_id` + `signature` 为未来联邦广播就位 |
| D9 | **ULID 主键** | 多中心导入不冲突、导出 JSON 可读、时序自然——比自增主键多 20 字节可忽略 |
| D10 | **中心自治邮件（hub-autonomous email）** | 注册/验证码邮件由用户所注册的中心自己配置的 SMTP 发出；官方无法直接触达非本中心用户——符合去中心化本意；邮件模板带中心身份标识（防钓鱼） |

---

## 2. 四层架构一图看懂

```
[前端]  Next.js App Router + React + Tailwind + Zustand
          账号页 / 档案页 / 时间线 / 公告 / 导出导入 / 开发者模式
                     │ HTTP + bearer token
                     ▼
[API 层]  Next.js Route Handlers + zod
          /auth /sync /pet /gift /announcements /export /import /packs /healthz
                     │ 函数调用（无跨进程）
                     ▼
[领域层]  纯 TS，可独立单测，禁止 import next/react
          事件引擎 · 补算器 · 退避调度 · 记忆检索 · 素材包解析
          馈赠回信 · 公告中心 · 导出导入 · Pet FSM · 认证节流
                     │ SQL (mysql2 异步连接池 + async 事务)
                     ▼
[持久层]  MySQL 8.x + InnoDB + utf8mb4
          开发：本地 Docker MySQL（与生产同构）
          生产：宝塔 MySQL 实例
          备份：mysqldump / JSON 导出（不再用 SQLite .backup）
```

**旁路**：`asset-packs/<pack-name>/{manifest.json, theme.css, text/*.json, images/*.png}`——领域层按契约解析、前端按契约消费，二者不感知彼此。

---

## 3. 数据模型速览（详见 `docs/database-schema.md`）

**核心表（10 张）**：

| 表 | 用途 | 主键 | 关键索引 |
|-----|------|------|----------|
| `users` | 账号（邮箱 hash + 30 天 token 关系） | ULID | `idx_users_hub` |
| `verification_codes` | 邮箱验证码（hub-autonomous SMTP 发送） | ULID | `idx_vc_email_issued`（节流） |
| `sessions` | token（30 天） | ULID | `idx_sessions_token` UNIQUE |
| `audit_log` | 审计（验证码/登录/导出导入/素材包切换/公告发布） | AUTO | `idx_audit_user_ts` |
| `pets` | pet 主表（状态、退避、馈赠状态、素材包偏好） | ULID | `idx_pets_reply_due` |
| `memories` | 记忆片段（命名/偏好/物品/地点/情绪） | ULID | `idx_memories_pet` |
| `items` | 物品目录（≥8 种，加权） | slug | — |
| `inventory` | 用户物品栏 | ULID | `idx_inventory_unoffered` |
| `events` | **核心事实表**（所有 pet 活动，含聚合、回信、公告、馈赠） | ULID | `idx_events_pet_ts`（时间线主查询） |
| `announcements` | 服务中心公告（含未来联邦广播签名位） | ULID | `idx_announcements_published` |
| `user_announcement_reads` | 已读/静音 | (user_id, ann_id) | `idx_ua_reads_user` |
| `user_settings` | 用户偏好（时区、素材包） | user_id | — |
| `meta`, `migrations` | 元信息、迁移记录 | — | — |

**每表通用字段**：`schema_version` + `hub_id`（数据主权/多中心预留）。

**MVP 不建**：`wallets`, `currencies`, `market_orders`, `transactions`, `market_listings`——用 nullable 字段预留。

---

## 4. 事件-素材契约速览（详见 `docs/architecture.md` §5）

**事件类型（11 种）**：`outing` / `watching_water` / `counting_leaves` / `self_talk` / `brought_item` / `reply_letter` / `spontaneous_letter` / `aggregate_summary` / `system_announce` / `daily_grant` / `offer_received`

**Event 结构（引擎产出，不含文案）**：
```typescript
{
  id, pet_id, type, ts, fsm_state,
  params: { 事件类型专属字段，永远不含文案 },
  memory_refs: [ {kind, value, weight, source_event_id?} ],
  source, engine_version, pack_schema_version,
  schema_version: '1.0.0', hub_id
}
```

**素材包 JSON 插槽（每种事件类型一个文件）**：
```json
{
  "type": "reply_letter",
  "slots": {
    "body": {
      "mode": "template",
      "variants": { "daily": [...], "poetic": [...] },
      "poetic_ratio": 0.10
    }
  },
  "assets": { "letter_bg": "images/letter-bg.png" },
  "highlight": { "memory_refs": true },
  "recall_required": ["item_name", "pet_name", "time_anchor"],
  "recall_min_count": 1
}
```

**契约冻结点**：阶段 2 结束。冻结后变更 = bump `pack_schema_version`，向后兼容。

---

## 5. 6 个开发阶段速览（详见 `docs/dev-stage-plan.md`）

| 阶段 | 名称 | 关键交付 | 工时 | 验收覆盖 |
|------|------|----------|------|----------|
| 1 | 地基 + 认证 + 素材包加载 | Next.js 项目、**Docker MySQL + mysql2 连接池**、MySQL migration、邮箱验证码 + 30 天 token（**含 hub-autonomous SMTP + 中心身份邮件模板**）、素材包加载器 | 7.0d | 1, 8(加载), 11(节流) |
| 2 | pet 状态机 + 事件引擎 + **契约定稿** | 事件引擎、9+2 生成器、记忆检索、`docs/packs-contract.md` | 7.5d | 3, 8(契约) |
| 3 | 补算 + 退避 + 时间线 UI | 补算 ≤20+聚合（async 事务）、退避表、渐进披露时间线 | 5.5d | 4, 5, 10(退避表) |
| 4 | 每日馈赠 + 回信 | 物品池 ≥8 种、送赠日限一次、24h 回信含记忆引用 | 4.5d | 10 |
| 5 | 公告 + 档案页 | 公告中心 + 静音 + 空窗聚合、档案页 | 3.2d | 2, 6, 11(备份 hash) |
| 6 | 导出/导入 + 部署 + 性能冒烟 | JSON 导出/导入 + 三类报错、**宝塔 Apache + PM2 + MySQL 部署（或 Docker Compose）**、CI/CD、11 项 E2E、mysqldump 备份 | 6.8d | 7, 8(切换), 9, 11(申诉) |

**总计：34.5 人日**（单人约 35 天；双人并行可压到 22–25 天，阶段 4/5 并行）。

**关键路径**：阶段 2 是全部项目的关键路径——契约冻结后不能改。阶段 2 结束必须开"契约评审会"。

**11 项验收追踪矩阵**（详见 dev-stage-plan.md §7）：每项验收都分配到具体阶段完成，无遗漏。

---

## 6. 技术风险 Top 5（详见 `docs/architecture.md` §9）

| # | 风险 | 缓解 |
|---|------|------|
| R1 | 事件契约/素材包契约演进失控 | 独立版本化（`pack_schema_version` + `event.schema_version` 分离）+ 契约变更走 `docs/packs-contract.md` |
| R2 | MySQL 连接池耗尽 / 事务内长持连接 | 单中心小数据量假设（<10k 用户）+ 连接池 `poolSize=10`、`connectionLimit=20`、`queueLimit=100` + 补算事务短（≤200ms）+ 事务内不 sleep 不跨外部 await + `innodb_lock_wait_timeout=5s` |
| R3 | 补算 30 天场景性能不达标 | planCatchUp 纯函数、async 事务内不 sleep、记忆检索批量预取、单测固化 ≤100ms |
| R4 | 素材包损坏导致全站崩 | 三层回退：损坏包跳过 → 强制回退 default → 纯文本降级 |
| R7 | 记忆引用达不到 30% 名字概率 | 加权随机是纯函数，Vitest 用固定 seed 采样 1000 次验证达标；权重可配置 |
| R8 | 自托管部署链路长（Next.js standalone + MySQL + SMTP + Apache + PM2） | `SELF_HOST.md` 覆盖两条路径（宝塔面板 / Docker Compose）；zod 校验环境变量；README 覆盖从 0 到 1；`smoke-test.ts` 冒烟 MySQL 连通性 |

---

## 7. 未来扩展预留清单

| 扩展方向 | MVP 预留方式 | 上线时机 |
|----------|-------------|----------|
| **多中心迁移** | 每表 `hub_id` + `schema_version`；`announcements.author_hub_id + signature`；导出 JSON 带 `meta.exported_from` | v2 |
| **货币/市场** | `pets.wallet_ref`、`items.base_price_cents/currency_code`、`inventory.purchased_at/paid_cents` 全 nullable | v2 |
| **插件市场** | `asset-packs/local/` + `asset-packs/market/` 双路径；`manifest.license` 允许任意字符串 | v2/v3 |
| **Live2D 表现** | 插件 manifest 新增 `plugin.kind = 'live2d'`，暴露 `pet_avatar` 插槽 | v2+ |
| **AI 对话** | `plugin.kind = 'ai_chat'`，暴露 `dialogue_generate` 钩子 | v2+ |
| **明信片生成** | `plugin.kind = 'postcard'`，暴露 `image_generate` 钩子 | v2+ |
| **P2P 组网** | `hub_id` 与 Mastodon `domain` 同构；公告表预留 Ed25519 签名 | 远期 |
| **联邦广播** | `announcements.author_hub_id + signature` 已就位 | v3 |

---

## 8. 文档地图（谁能读什么）

| 读者 | 优先读 | 参考 |
|------|--------|------|
| **编排者 / PM** | `docs/architecture-summary.md`（本文件） | `docs/dev-stage-plan.md` §1 |
| **软件工程师（阶段 1）** | `docs/architecture.md` §3（项目结构）+ §4.1 auth + `docs/database-schema.md` §2 完整 DDL | `docs/dev-stage-plan.md` §3 阶段 1 |
| **软件工程师（阶段 2）** | `docs/architecture.md` §5（事件-素材契约）+ §6（素材包机制） | `docs/dev-stage-plan.md` §3 阶段 2 |
| **软件工程师（阶段 3）** | `docs/architecture.md` §4.3.1（补算时序）+ §9 R3 | `docs/dev-stage-plan.md` §3 阶段 3 |
| **软件工程师（阶段 4/5）** | `docs/architecture.md` §4.3.2（馈赠时序）+ §4.1 各模块 | `docs/dev-stage-plan.md` §3 阶段 4/5 |
| **软件工程师（阶段 6）** | `docs/architecture.md` §4.3.3（导出导入）+ `docs/database-schema.md` §4.2（导出结构） | `docs/dev-stage-plan.md` §3 阶段 6 |
| **插件作者（未来）** | 阶段 2 产出的 `docs/packs-contract.md` | `docs/architecture.md` §5, §6 |
| **自托管用户** | 阶段 6 产出的 `SELF_HOST.md` + `README.md` | — |
| **产品/需求方** | `docs/architecture-summary.md` §0–§7 | `docs/requirements.md`（权威需求） |

---

## 9. 交付状态

- ✅ `docs/architecture.md`（约 15k 字，12 节）
- ✅ `docs/database-schema.md`（约 10k 字，10 节，含完整 DDL + 索引汇总表 + ADR 精简版）
- ✅ `docs/dev-stage-plan.md`（约 8k 字，7 节，6 阶段 + 11 项验收矩阵 + 工时估算）
- ✅ `docs/architecture-summary.md`（本文件）

**未产出但需阶段 2 交付**：
- `docs/packs-contract.md` — 事件-素材契约的详细规范（本架构文档 §5, §6 是骨架）

**未产出但需阶段 6 交付**：
- `SELF_HOST.md` — 自托管部署完整指南（覆盖宝塔 + Docker 两条路径）
- `README.md` — 用户视角说明
- `docker/Dockerfile` + `docker/docker-compose.yml` + `pm2-ecosystem.config.js`
- `.github/workflows/*.yml`（CI/CD，E2E 需临时 MySQL 容器）
- `scripts/backup.ts`（mysqldump 包装） + `scripts/smoke-test.ts`（含 MySQL 连接池预热）

---

## 10. 与需求文档的一致性核对

需求 §6 的 11 项验收在架构/数据库/阶段计划三份文档中**全部有明确落地位置**：

| 验收 # | 架构落地位置 | 数据库表 | 阶段 |
|--------|-------------|----------|------|
| 1 注册登录 | architecture §4.1 auth, §9 R5 | users, verification_codes, sessions, audit_log | 1 |
| 2 档案页 | architecture §4.3 数据流 | pets, memories, events, inventory | 5 |
| 3 随机事件引擎 | architecture §4.1 event-engine, §5 | events | 2 |
| 4 补算 | architecture §4.3.1, §9 R3 | pets.last_activity_ts, events.is_aggregate | 3 |
| 5 事件流 | architecture §5.4 highlight | events（索引 idx_events_pet_ts） | 3 |
| 6 公告 | architecture §4.1 announce | announcements, user_announcement_reads | 5 |
| 7 导出/导入 | architecture §4.3.3 | 全表（导出结构见 database-schema §4.2） | 6 |
| 8 素材包可配置 | architecture §6 | pets.active_pack_name, user_settings | 1+2+6 |
| 9 部署+性能 | architecture §10, §9 R9 | — | 6 |
| 10 每日馈赠+退避 | architecture §4.3.2 | pets.daily_grant_last_date, offer_last_date, reply_pending | 4（退避表在 3） |
| 11 账号安全+恢复 | architecture §4.1 auth, §9 R5 | users.last_backup_hash, sessions.revoked_at, audit_log | 1+6 |

**无遗漏**。

---

## 11. 给编排者的执行建议

1. **阶段 2 前**：把本文件 + `docs/architecture.md` §5, §6 给产品/需求方过一遍，确认事件契约与素材包机制无歧义。
2. **阶段 2 结束时**：必须开"契约评审会"——事件类型枚举、插槽契约、`docs/packs-contract.md` 定稿冻结。之后变更只允许 bump 版本号。
3. **阶段 4/5 可并行**：若有多人执行，两人分头做。
4. **阶段 6 前**：确认官方托管服务器（宝塔面板）、MySQL 实例、域名、邮箱 SPF/DKIM 配置、PM2 全局安装、Apache 反向代理配置就绪；SMTP 服务商（SES / Resend / Gmail / QQ / 自建）在阶段 1 前完成（写入 `.env` 的 `SMTP_*`、`HUB_ADMIN_EMAIL`、`HUB_PRIVACY_URL`）。否则部署会阻塞。
5. **阶段 6 完成时**：跑一次 `scripts/smoke-test.ts` + 全套 E2E，通过即发布 v1.0.0。

---

*本文件为四份架构文档的总览，随其它文档同步更新。定稿于 2026-09-09。*
