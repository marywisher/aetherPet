# AetherPet MVP · 数据库设计文档

> 状态：定稿，与 `docs/architecture.md` §3 项目结构一致
> 关联文档：`docs/architecture.md`（架构）、`docs/dev-stage-plan.md`（阶段计划）
> 关联表：`docs/architecture.md` §4.3 数据流、§7 可扩展性预留

> **修订版本 v1.1（2026-09-09）**：完整 DDL 重写为 **MySQL 8.x** 方言。要点：
> - 存储引擎 InnoDB，字符集 `utf8mb4`、排序规则 `utf8mb4_unicode_ci`。
> - 时间戳统一存 **BIGINT UNSIGNED UTC 毫秒**（避 MySQL DATETIME 时区坑）。
> - 部分索引（`WHERE` 子句）→ 改写为 `generated column + 普通索引`，或应用层过滤（MySQL 8 不支持部分索引）。
> - 布尔字段（0/1）→ `TINYINT(1)`（应用层约定）。
> - JSON 列（`params_json`、`memory_refs_json`、`audit_log.detail`）→ `JSON` 类型。
> - 自增主键（仅 `audit_log`、`migrations`）→ `BIGINT UNSIGNED AUTO_INCREMENT`。
> - 主键 ULID 仍为 `VARCHAR(32)`（ADR-001 不变）。
> - 事务改为 **async 事务 + 连接池**（驱动 mysql2，见架构 §2.3）。
> - 备份机制：`mysqldump` / 导出 JSON（不再使用 SQLite `.backup` API）。
> - 开发环境：本地 Docker MySQL，与生产同构。

---

## 0. 设计原则

1. **MySQL 8.x + InnoDB**：与用户生产环境（宝塔 Apache + MySQL）同构；事务隔离级别默认 `REPEATABLE_READ`，与补算 async 事务相容。
2. **每表带 `schema_version` + `hub_id`**：为多中心迁移与数据主权打地基（架构 §7.1）。
3. **事件是核心事实表**：所有 pet 活动都产生 event 行，时间线查询走事件表 + 索引。
4. **无外键强约束在补算事务内的行**：为跨中心导入留空间；跨表一致性由领域层事务保证（保留 ADR-005 决策）。
5. **不建 `wallets` / `market` 表**：需求明确 MVP 不做，通过 nullable 字段预留（架构 §7.2）。
6. **ULID 主键**：时序天然、跨中心不冲突、无自增序列泄露风险（仅 `audit_log`、`migrations` 用 `BIGINT AUTO_INCREMENT` 内部主键，不外露）。
7. **时间戳统一存 BIGINT UNSIGNED UTC 毫秒**：MySQL DATETIME 存无时区值，跨时区部署易出坑；统一 BIGINT 毫秒，应用层负责本地化。
8. **JSON 列**：MySQL 8 原生 `JSON` 类型存结构化字段，避免手写 parse；但事件契约中 `params` / `memory_refs` 仍需领域层先做 schema 校验再写入。

---

## 1. ER 图（文字版）

```
                    ┌──────────┐
                    │  users   │ 1
                    └────┬─────┘
                         │ 1
                         │ owns
                         ▼
                    ┌──────────┐ 1        ┌──────────────┐
                    │  pets    │──────────│  sessions    │ N  (通过 user_id)
                    └────┬─────┘          └──────────────┘
                         │
            1 ───────────┼────────── N
            │            │            │
            ▼            ▼            ▼
      ┌──────────┐ ┌──────────┐ ┌──────────────┐
      │ events   │ │ memories │ │ inventory    │
      │ 时间线   │ │ 记忆片段  │ │ 物品栏        │
      └────┬─────┘ └──────────┘ └──────┬───────┘
           │                           │
           │ references                │ references
           ▼                           ▼
      ┌──────────┐                 ┌──────────────┐
      │ items    │ ◄────────────── │ 储物罐（在    │
      │ 物品目录  │                │ events 表内    │
      └──────────┘                 │ 表示，不单建） │
                                   └──────────────┘

      ┌────────────────────────┐   ┌─────────────────────┐
      │  announcements        │   │  audit_log          │
      │  服务中心公告          │   │  审计日志（验证码/    │
      │  (1 → N users_announce │   │  登录/导出/导入)     │
      │   reads)              │   │                      │
      └────────────────────────┘   └─────────────────────┘

      ┌────────────────────────┐
      │  verification_codes    │
      │  邮箱验证码            │
      └────────────────────────┘

      ┌────────────────────────┐
      │  settings              │
      │  用户偏好（含当前素材包）│
      └────────────────────────┘
```

**关键关系**：
- `users 1 → N pets`（MVP 每账号 1 pet，结构支持多）
- `pets 1 → N events`（时间线全部落此）
- `pets 1 → N memories`（记忆片段独立表，便于检索）
- `items 1 → N inventory`（物品目录与用户物品栏分离）
- `announcements 1 → N users_announce_reads`（已读关系）
- `verification_codes` / `sessions` / `audit_log`：账号侧，与 pet 无关联

---

## 2. 完整 DDL（MySQL 8.x）

> 全部脚本按此顺序执行；`001_init.sql` 是初始迁移。DDL 里所有 `BIGINT` 时间戳单位是**毫秒**（UTC）。
> MySQL 8.x · InnoDB · `utf8mb4` / `utf8mb4_unicode_ci`。

```sql
-- 001_init.sql
-- aetherPet 初始 schema，schema_version = 1.0.0
-- 目标：MySQL 8.0+，InnoDB，utf8mb4_unicode_ci

CREATE DATABASE IF NOT EXISTS aetherpet
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE aetherpet;

-- 说明：
--   1) 所有时间戳字段统一 BIGINT UNSIGNED UTC ms（应用层负责格式化/本地化）
--   2) ULID 主键 = VARCHAR(32)，非自增（ADR-001）
--   3) 布尔语义 = TINYINT(1)，0 = false, 1 = true
--   4) MySQL 8 不支持 partial index，需要时改生成列 + 普通索引（见 §3.1 idx_events_aggregate）
--   5) 事务为 async 事务（mysql2 驱动），业务侧统一封装 BEGIN / COMMIT / ROLLBACK

-- ================================================================
-- 0. 元信息表（版本、中心、迁移记录）
-- ================================================================

CREATE TABLE meta (
  key           VARCHAR(64)   NOT NULL,
  value         TEXT          NOT NULL,
  updated_at    BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (key)
) ENGINE=InnoDB;

-- 预置键（示例，由 scripts/seed-default-pack.ts 或 migration 写入）：
--   schema_version    = '1.0.0'      全局 schema 版本（每次 migration bump）
--   hub_id            = 'local'      当前中心标识（自托管默认 local；官方可配置）
--   hub_display_name  = 'AetherPet Local'   当前中心展示名（邮件 Header/正文用）
--   hub_admin_email   = 'admin@...'  当前中心管理员邮箱（邮件底部联系）
--   hub_privacy_url   = 'https://.../privacy'  当前中心隐私承诺页
--   smtp_host         = 'smtp.example.com'   SMTP 主机（v1.1 hub-autonomous email）
--   engine_version    = '1.0.0'      事件引擎版本
--   pack_schema_ver   = '1.0.0'      素材包契约版本
--   created_at        = <ts>         中心创建时间
--   last_migration_at = <ts>         最近一次 migration 时间

CREATE TABLE migrations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version     VARCHAR(64)     NOT NULL,       -- 例如 '001_init'
  applied_at  BIGINT UNSIGNED NOT NULL,
  checksum    CHAR(64)        NOT NULL,        -- SQL 文件 SHA256（hex，64 字符），防篡改
  PRIMARY KEY (id),
  UNIQUE KEY uk_migrations_version (version)
) ENGINE=InnoDB;

-- ================================================================
-- 1. 账号体系
-- ================================================================

-- 用户表。email_hash 是 email 的 SHA-256；email_plain_enc 仅加密保存（可选）
-- 若服务端无加密能力，email_plain_enc 允许为 NULL，登录时通过 email_hash 匹配
CREATE TABLE users (
  id                VARCHAR(32)     NOT NULL,            -- ULID
  email_hash        CHAR(64)        NOT NULL,            -- SHA256(lower(email))
  email_plain_enc   TEXT            NULL,                -- AES-256-GCM 加密后 base64（可选）
  email_verified_at BIGINT UNSIGNED NULL,                -- 首次验证成功时间
  created_at        BIGINT UNSIGNED NOT NULL,
  updated_at        BIGINT UNSIGNED NOT NULL,

  -- 数据主权：申诉时可核对的备份 hash（需求 §3.1）
  last_backup_hash  CHAR(64)        NULL,                -- 用户最近一次导出的 SHA256
  -- 预留：多中心迁移时用户在本中心的迁移来源
  imported_from_hub VARCHAR(64)     NULL,
  imported_at       BIGINT UNSIGNED NULL,

  -- 通用字段
  schema_version    VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id            VARCHAR(64)     NOT NULL DEFAULT 'local',

  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email_hash (email_hash)
) ENGINE=InnoDB;

-- 邮箱验证码（需求 §3.1）
CREATE TABLE verification_codes (
  id              VARCHAR(32)     NOT NULL,
  user_id         VARCHAR(32)     NOT NULL,              -- 关联用户（可能不存在，允许孤儿）
  email_hash      CHAR(64)        NOT NULL,
  code_hash       CHAR(64)        NOT NULL,              -- SHA256(code)，明文不落库
  issued_at       BIGINT UNSIGNED NOT NULL,
  expires_at      BIGINT UNSIGNED NOT NULL,              -- issued_at + 600_000 (10 min)
  used_at         BIGINT UNSIGNED NULL,                  -- 使用后填
  ip              VARCHAR(45)     NULL,                  -- 审计用（IPv6 兼容）
  user_agent      VARCHAR(512)    NULL,
  schema_version  VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id          VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- 会话 / token（需求 §3.1，30 天有效）
CREATE TABLE sessions (
  id              VARCHAR(32)     NOT NULL,              -- ULID
  user_id         VARCHAR(32)     NOT NULL,
  token_hash      CHAR(64)        NOT NULL,              -- SHA256(token)
  issued_at       BIGINT UNSIGNED NOT NULL,
  expires_at      BIGINT UNSIGNED NOT NULL,              -- issued_at + 30d
  last_seen_at    BIGINT UNSIGNED NOT NULL,
  ip              VARCHAR(45)     NULL,
  user_agent      VARCHAR(512)    NULL,
  revoked_at      BIGINT UNSIGNED NULL,                  -- 用户点"退出登录"填
  schema_version  VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id          VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- 审计日志（需求 §3.13、评审 P1-8、架构 §9 R5）
-- 覆盖：验证码尝试、登录失败、token 撤销、导出、导入、素材包切换、公告发布、邮件推送
CREATE TABLE audit_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         VARCHAR(32)     NULL,                  -- 允许 NULL（未登录场景）
  event_type      VARCHAR(64)     NOT NULL,              -- 'verification_attempt' | 'verification_success'
                                                          -- 'verification_throttled' | 'verification_failed'
                                                          -- 'login_success' | 'login_failed'
                                                          -- 'token_revoked' | 'pet_created'
                                                          -- 'export' | 'import_success' | 'import_failed'
                                                          -- 'pack_switched' | 'announcement_published'
                                                          -- 'pack_load_failed' | 'email_sent'
                                                          -- 'backup_created' | 'backup_failed'
  detail          JSON            NULL,                  -- 具体信息（结构化）
  ip              VARCHAR(45)     NULL,
  user_agent      VARCHAR(512)    NULL,
  created_at      BIGINT UNSIGNED NOT NULL,
  schema_version  VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id          VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- ================================================================
-- 2. Pet 核心
-- ================================================================

-- Pet 主表
CREATE TABLE pets (
  id                      VARCHAR(32)     NOT NULL,      -- ULID
  user_id                 VARCHAR(32)     NOT NULL,
  name                    VARCHAR(64)     NOT NULL,      -- 用户命名（MVP 不允许改）
  state                   VARCHAR(32)     NOT NULL,      -- 'at_home' | 'out_walking' | 'on_trip'
  state_since             BIGINT UNSIGNED NOT NULL,      -- 进入当前状态的时间
  created_at              BIGINT UNSIGNED NOT NULL,
  updated_at              BIGINT UNSIGNED NOT NULL,

  -- 补算触发点：用户上次同步时间
  last_activity_ts        BIGINT UNSIGNED NOT NULL,      -- 用于 /sync 计算流逝时间

  -- 退避调度（架构 §4.1 backoff）
  user_last_active_ts     BIGINT UNSIGNED NOT NULL,      -- 用户最后一次真实活跃（含登录）
  next_proactive_ts       BIGINT UNSIGNED NULL,          -- 下次 pet 主动触达的时间点（受退避表约束）

  -- 每日馈赠 / 回信
  daily_grant_last_date   VARCHAR(10)     NULL,          -- YYYY-MM-DD，UTC+8 由前端传入
  offer_last_date         VARCHAR(10)     NULL,          -- 送赠日限一次
  reply_pending           TINYINT(1)      NOT NULL DEFAULT 0,   -- 0/1，是否有待回信
  reply_due_at            BIGINT UNSIGNED NULL,          -- 回信截止时间（now+24h）
  last_reply_at           BIGINT UNSIGNED NULL,

  -- 素材包（用户偏好；也可由 settings 覆盖）
  active_pack_name        VARCHAR(64)     NOT NULL DEFAULT 'default',

  -- 预留：货币/市场（架构 §7.2，MVP 恒 NULL）
  wallet_ref              VARCHAR(32)     NULL,

  -- 数据主权
  schema_version          VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id                  VARCHAR(64)     NOT NULL DEFAULT 'local',

  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- Pet 记忆片段（需求 §3.2、§3.3 记忆引用）
-- 记忆是"引擎产出/用户输入"的结构化事实，不是文案
CREATE TABLE memories (
  id              VARCHAR(32)     NOT NULL,              -- ULID
  pet_id          VARCHAR(32)     NOT NULL,
  kind            VARCHAR(32)     NOT NULL,              -- 'naming' | 'preference' | 'item_received'
                                                          -- 'place_visited' | 'sentiment' | 'custom'
  value           TEXT            NOT NULL,              -- 结构化值（JSON 字符串或纯文本）
  created_at      BIGINT UNSIGNED NOT NULL,
  last_referenced BIGINT UNSIGNED NULL,                  -- 最近一次被事件引用
  weight          DECIMAL(10,4)   NOT NULL DEFAULT 1.0000,  -- 加权随机的权重
  is_permanent    TINYINT(1)      NOT NULL DEFAULT 0,    -- 1 = 命名/偏好类，不衰减
  schema_version  VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id          VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- ================================================================
-- 3. 物品与物品栏
-- ================================================================

-- 物品目录（全局，MVP 8+ 种）
-- 每行是"物品图鉴"的一条，用户物品栏通过 item_id 引用
CREATE TABLE items (
  id                VARCHAR(64)     NOT NULL,            -- 语义化 slug：'berry', 'dry-leaf', 'stone'...
  display_name      VARCHAR(64)     NOT NULL,            -- '浆果'
  description       TEXT            NULL,
  icon_path         VARCHAR(255)    NOT NULL,            -- 素材包内路径
  rarity_weight     DECIMAL(10,4)   NOT NULL DEFAULT 1.0000,  -- 物品池加权
  category          VARCHAR(32)     NULL,                -- 'fruit' | 'plant' | 'stone' | ...
  -- 预留：货币/市场（架构 §7.2，MVP 恒 NULL）
  base_price_cents  INT UNSIGNED    NULL,
  currency_code     VARCHAR(16)     NULL,
  schema_version    VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id            VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- 用户物品栏（每个用户自己的物品实例）
CREATE TABLE inventory (
  id                VARCHAR(32)     NOT NULL,            -- ULID（一次拥有 = 一行）
  user_id           VARCHAR(32)     NOT NULL,
  pet_id            VARCHAR(32)     NOT NULL,            -- 送赠时归属哪个 pet
  item_id           VARCHAR(64)     NOT NULL,            -- 引用 items.id
  acquired_at       BIGINT UNSIGNED NOT NULL,
  acquired_via      VARCHAR(32)     NOT NULL,            -- 'daily_grant' | 'brought_back' | 'import'
  granted_event_id  VARCHAR(32)     NULL,                -- 引用 events.id（daily_grant 事件）
  offered_at        BIGINT UNSIGNED NULL,                -- 送赠时间，非空表示已送出
  offered_event_id  VARCHAR(32)     NULL,                -- 引用 events.id（offer_received）
  consumed_at       BIGINT UNSIGNED NULL,                -- 送赠后消费时间
  consumed_event_id VARCHAR(32)     NULL,                -- 引用 events.id（如回信引用）
  -- 预留：货币购买（MVP 恒 NULL）
  purchased_at      BIGINT UNSIGNED NULL,
  paid_cents        INT UNSIGNED    NULL,
  schema_version    VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id            VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- ================================================================
-- 4. 事件（核心事实表）
-- ================================================================

-- 事件时间线。所有 pet 活动（包括回信、公告、聚合、每日馈赠）都落此表
CREATE TABLE events (
  id                  VARCHAR(32)     NOT NULL,          -- ULID（时序）
  pet_id              VARCHAR(32)     NOT NULL,
  user_id             VARCHAR(32)     NOT NULL,          -- 冗余，便于导出按用户查
  type                VARCHAR(64)     NOT NULL,          -- 见架构 §5.1 EventType 枚举
  ts                  BIGINT UNSIGNED NOT NULL,          -- 事件发生时间
  fsm_state           VARCHAR(32)     NOT NULL,          -- 事件发生时 pet 状态快照
  params_json         JSON            NOT NULL,          -- 事件类型专属参数（见架构 §5.3）
  engine_version      VARCHAR(16)     NOT NULL,
  pack_schema_version VARCHAR(16)     NOT NULL,          -- 生成时的素材包契约版本
  source              VARCHAR(32)     NOT NULL,          -- 'engine' | 'catchup' | 'gift' | 'system' | 'admin'

  -- 记忆引用（架构 §5.2 MemoryRef 数组的 JSON）
  memory_refs_json    JSON            NOT NULL,          -- 应用层保证写 '[]' 而非 NULL

  -- 聚合摘要（仅 AGGREGATE_SUMMARY 类型非空）
  is_aggregate        TINYINT(1)      NOT NULL DEFAULT 0,
  aggregate_span_days INT UNSIGNED    NULL,              -- 覆盖多少天

  -- 补算标记
  generated_by_catchup TINYINT(1)     NOT NULL DEFAULT 0,

  -- 溯源
  schema_version      VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id              VARCHAR(64)     NOT NULL DEFAULT 'local',
  created_at          BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- 说明：MySQL 8 不支持 partial index。原本 SQLite 中的
--   idx_events_aggregate ON events(pet_id, is_aggregate, ts DESC) WHERE is_aggregate = 1
-- 在 MySQL 8.0 里改写为：加一列 generated column `aggregate_ts`（is_aggregate=1 时等于 ts，否则 NULL）
-- + 普通索引（见 §3.1）。

ALTER TABLE events
  ADD COLUMN aggregate_ts BIGINT UNSIGNED
  GENERATED ALWAYS AS (CASE WHEN is_aggregate = 1 THEN ts ELSE NULL END) STORED;

-- ================================================================
-- 5. 公告
-- ================================================================

-- 服务中心公告（架构 §4.1 announce）
CREATE TABLE announcements (
  id              VARCHAR(32)     NOT NULL,              -- ULID
  title           VARCHAR(128)    NOT NULL,
  body            TEXT            NOT NULL,
  level           VARCHAR(32)     NOT NULL DEFAULT 'info',  -- 'info' | 'important' | 'critical'
  published_at    BIGINT UNSIGNED NOT NULL,
  author_hub_id   VARCHAR(64)     NOT NULL,              -- 发布中心（未来联邦广播用）
  signature       TEXT            NULL,                  -- 未来 Ed25519 签名（MVP 空）
  expires_at      BIGINT UNSIGNED NULL,                  -- 空 = 永不过期
  schema_version  VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id          VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- 用户公告已读/静音状态
CREATE TABLE user_announcement_reads (
  user_id             VARCHAR(32)     NOT NULL,
  announcement_id     VARCHAR(32)     NOT NULL,
  read_at             BIGINT UNSIGNED NOT NULL,
  muted_until_ts      BIGINT UNSIGNED NULL,              -- 用户点"静音 N 条"的截止时间
  schema_version      VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id              VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (user_id, announcement_id)
) ENGINE=InnoDB;

-- ================================================================
-- 6. 用户偏好（素材包、时区等）
-- ================================================================

CREATE TABLE user_settings (
  user_id             VARCHAR(32)     PRIMARY KEY,
  active_pack_name    VARCHAR(64)     NOT NULL DEFAULT 'default',
  timezone            VARCHAR(64)     NOT NULL DEFAULT 'Asia/Shanghai',
  muted_notifications TINYINT(1)      NOT NULL DEFAULT 0,  -- 1 = 全局静音（保留）
  updated_at          BIGINT UNSIGNED NOT NULL,
  schema_version      VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id              VARCHAR(64)     NOT NULL DEFAULT 'local'
) ENGINE=InnoDB;
```

---

## 3. 索引设计

> v1.1 修订：MySQL 8 不支持 partial index（SQLite 的 `WHERE` 子句形式）。
> 对应方案：
> - 若过滤条件命中行数占比小 → 直接建普通索引，应用层 WHERE 过滤（MVP 数据量下开销可接受）
> - 若需要强优化 → 加一列 `GENERATED ALWAYS AS ... STORED` 的生成列 + 普通索引
> - `DESC` 索引：MySQL 8.0 支持；但 B-Tree 默认升序扫描反方向同样高效，DESC 仅作表达。

### 3.1 事件时间线查询（核心）

```sql
-- 单个 pet 的事件按时间倒序（时间线主查询、分页）
CREATE INDEX idx_events_pet_ts ON events(pet_id, ts);
-- 查询模板：SELECT * FROM events WHERE pet_id = ? ORDER BY ts DESC LIMIT ? OFFSET ?;
-- InnoDB 的 B-Tree 支持反向扫描，DESC 排序无额外开销。

-- 按类型过滤（档案页"储物罐"要按 brought_item 类型查）
CREATE INDEX idx_events_pet_type ON events(pet_id, type, ts);

-- 补算扫描（找该 pet 上次活动后的所有事件——通常不需要，因为补算写入而非扫描）
-- 但导出/导入、未来 v2 迁移会用到
CREATE INDEX idx_events_user_ts ON events(user_id, ts);

-- 聚合摘要专用索引（渐进披露入口）
-- v1.0 原 SQLite 使用 partial index (WHERE is_aggregate = 1)
-- v1.1 改写为：在 DDL 里加了 generated column aggregate_ts（is_aggregate=1 时等于 ts，否则 NULL）
--   普通索引只命中聚合行的非 NULL 值（B-Tree 不建 NULL），等效于 partial index
CREATE INDEX idx_events_aggregate ON events(pet_id, aggregate_ts);
```

**为什么这样切**：
- `idx_events_pet_ts`：`SELECT * FROM events WHERE pet_id = ? ORDER BY ts DESC LIMIT ? OFFSET ?`——时间线分页主查询，覆盖 90% 事件访问。
- `idx_events_pet_type`：档案页按类型筛选，事件流按类型标签分组。
- `idx_events_aggregate`：**generated column 等效 partial index**，只索引聚合行——渐进披露首屏入口卡片查询 `WHERE pet_id=? AND is_aggregate=1`。

### 3.2 补算

```sql
-- 补算执行时：查该 pet 待处理状态（pets 表 1 行），主键 id 即可
-- 需要检查 reply_pending + reply_due_at：
-- MVP 每账号 1 pet，单行足够；多 pet 场景下此索引生效
CREATE INDEX idx_pets_reply_due ON pets(reply_pending, reply_due_at);
-- 应用层 WHERE reply_pending = 1 过滤；MVP 数据量下开销可接受。
-- 若未来多 pet 场景下未命中行很多，可加 generated column：
--   reply_due_active_ts BIGINT GENERATED ALWAYS AS
--     (CASE WHEN reply_pending = 1 THEN reply_due_at ELSE NULL END) STORED
--   然后用该列建普通索引（同 idx_events_aggregate 思路）。
```

### 3.3 同步 / 用户维度

```sql
-- 用户的所有 pet（多 pet 场景预留）
CREATE INDEX idx_pets_user ON pets(user_id);

-- 用户的所有 memory（导出、记忆检索）
CREATE INDEX idx_memories_pet ON memories(pet_id, kind);
CREATE INDEX idx_memories_lastref ON memories(pet_id, last_referenced);

-- 用户物品栏
CREATE INDEX idx_inventory_user ON inventory(user_id, acquired_at);
-- 可送赠物品（未送出）
-- v1.0 原 SQLite 使用 partial index (WHERE offered_at IS NULL)
-- v1.1 改写为：普通索引 + 应用层过滤，MVP 数据量下开销可接受
CREATE INDEX idx_inventory_offered_at ON inventory(user_id, offered_at);

-- 公告查询（倒序）
CREATE INDEX idx_announcements_published ON announcements(published_at);

-- 用户已读状态（前端判断未读角标）
CREATE INDEX idx_ua_reads_user ON user_announcement_reads(user_id, read_at);
```

### 3.4 账号体系

```sql
-- 验证码节流：查同邮箱近 5 分钟内的记录数
CREATE INDEX idx_vc_email_issued ON verification_codes(email_hash, issued_at);

-- 验证码过期清理
-- v1.0 原 SQLite 使用 partial index (WHERE used_at IS NULL)
-- v1.1 改写为：普通索引 + 应用层过滤
CREATE INDEX idx_vc_expires ON verification_codes(expires_at);

-- 会话查询（token 校验）
CREATE UNIQUE INDEX idx_sessions_token ON sessions(token_hash);

-- 会话过期清理
-- v1.0 原 SQLite 使用 partial index (WHERE revoked_at IS NULL)
-- v1.1 改写为：普通索引 + 应用层过滤
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- 审计日志查询
CREATE INDEX idx_audit_user_ts ON audit_log(user_id, created_at);
CREATE INDEX idx_audit_type_ts ON audit_log(event_type, created_at);
```

### 3.5 数据主权 / 导出

```sql
-- 导出不需要索引（全表扫描单用户数据），但保留以便未来跨中心查询
CREATE INDEX idx_events_hub ON events(hub_id);
CREATE INDEX idx_users_hub ON users(hub_id);
```

### 3.6 索引汇总表

| 索引名 | 表 | 字段 | 类型 | 用途 |
|--------|-----|------|------|------|
| idx_events_pet_ts | events | (pet_id, ts) | B-Tree | 时间线主查询 |
| idx_events_pet_type | events | (pet_id, type, ts) | B-Tree | 按类型筛选 |
| idx_events_user_ts | events | (user_id, ts) | B-Tree | 导出 |
| idx_events_aggregate | events | (pet_id, aggregate_ts) | B-Tree（generated column 等效 partial） | 渐进披露 |
| idx_events_hub | events | (hub_id) | B-Tree | 跨中心查询 |
| idx_pets_reply_due | pets | (reply_pending, reply_due_at) | B-Tree + 应用层过滤 | 补算检查回信 |
| idx_pets_user | pets | (user_id) | B-Tree | 用户 → pet |
| idx_memories_pet | memories | (pet_id, kind) | B-Tree | 记忆检索 |
| idx_memories_lastref | memories | (pet_id, last_referenced) | B-Tree | 检索排序 |
| idx_inventory_user | inventory | (user_id, acquired_at) | B-Tree | 物品栏 |
| idx_inventory_offered_at | inventory | (user_id, offered_at) | B-Tree + 应用层过滤 | 可送赠物品 |
| idx_announcements_published | announcements | (published_at) | B-Tree | 倒序列表 |
| idx_ua_reads_user | user_announcement_reads | (user_id, read_at) | B-Tree | 未读角标 |
| idx_vc_email_issued | verification_codes | (email_hash, issued_at) | B-Tree | 节流 |
| idx_vc_expires | verification_codes | (expires_at) | B-Tree + 应用层过滤 | 清理 |
| idx_sessions_token | sessions | (token_hash) | UNIQUE | token 校验 |
| idx_sessions_expires | sessions | (expires_at) | B-Tree + 应用层过滤 | 清理 |
| idx_audit_user_ts | audit_log | (user_id, created_at) | B-Tree | 审计 |
| idx_audit_type_ts | audit_log | (event_type, created_at) | B-Tree | 按类型审计 |

**部分索引改写策略**：
- MySQL 8.0 不支持 `WHERE` 子句的部分索引。
- MVP 下，部分索引只作为"优化器提示"（过滤命中率低 → 全表扫描反而更快）；数据量小，直接应用层 WHERE 过滤即可。
- 若未来命中行数多、需要强优化 → 用 `GENERATED ALWAYS AS ... STORED` 生成列 + 普通索引（参考 `aggregate_ts`）。

**参考实现**：`aggregate_ts` 生成列 = `CASE WHEN is_aggregate = 1 THEN ts ELSE NULL END`；B-Tree 不索引 NULL，因此只命中聚合行。

---

## 4. 数据主权 / 多中心迁移预留

### 4.1 每表的通用字段（架构 §7.1）

所有业务表（非 meta/migrations）都有：
- `schema_version TEXT NOT NULL DEFAULT '1.0.0'`——该行数据遵循的 schema 版本。
- `hub_id TEXT NOT NULL DEFAULT 'local'`——数据归属的中心标识。

### 4.2 导出 JSON 结构（对齐需求 §3.9）

```json
{
  "meta": {
    "schema_version": "1.0.0",
    "exported_at": 1725900000000,
    "exported_from": "local",
    "checksum": "SHA256:...",
    "engine_version": "1.0.0",
    "pack_schema_version": "1.0.0"
  },
  "user": { ... },                // 邮箱 hash、创建时间、last_backup_hash
  "pet": {
    "base": { ... },              // 名字/状态/创建时间
    "memories": [ ... ],
    "events": [ ... ],            // 结构 + memory_refs + params（不含表现）
    "inventory": [ ... ],
    "items_catalog": [ ... ],     // 用户已获取过的物品目录快照（避免目标中心缺 item）
    "pending_reply": { ... }      // reply_pending + reply_due_at
  },
  "settings": { ... },            // 时区、active_pack_name（不含 token）
  "announcements_unread": [ ... ] // 该用户未读公告（含 announcement 内容快照）
}
```

**排除项**（需求 §3.9）：
- 会话 token（sessions 表整表不入导出）
- 验证码记录（verification_codes 整表不入）
- 审计日志（audit_log 不入——那是中心侧的运营数据）
- 邮箱明文加密串（email_plain_enc 不入——目标中心不共享密钥）

### 4.3 导入流程的数据主权保障

1. 校验 `meta.schema_version` 与当前引擎支持范围（MVP 只接受 1.0.0）。
2. 校验 `meta.checksum`。
3. 校验必填字段清单。
4. `BEGIN TRANSACTION` → 逐表插入，**每行强制改写 `hub_id = current_hub`**、`schema_version = current`。
5. `COMMIT`。

失败时事务回滚，数据库无副作用。三类错误文案在 `src/domain/export/error-messages.ts` 集中定义（架构 §4.3.3）。

### 4.4 未来多中心迁移的兼容承诺

- 所有表的 `hub_id` 是**该数据的当前归属**，跨中心导入时改写为本中心。
- 事件表保留 `source_hub_id` 隐含在 `hub_id` 里——如需保留原始出生中心，未来在 v2 migration 中新增 `birth_hub_id` 字段（可空，v2 上线时填）。
- 公告表 `author_hub_id` + `signature` 字段已就位，未来联邦广播直接生效。

---

## 5. 货币/市场预留（架构 §7.2）

### 5.1 不建的表

- ❌ `wallets`（用户账户）
- ❌ `currencies`（货币目录）
- ❌ `market_orders`（订单）
- ❌ `transactions`（流水）
- ❌ `market_listings`（物品上架）

### 5.2 已预留的字段

| 表 | 字段 | 类型 | MVP 默认 | v2 用途 |
|-----|------|------|----------|---------|
| pets | wallet_ref | TEXT | NULL | 关联 wallets.id |
| items | base_price_cents | INTEGER | NULL | 物品原价 |
| items | currency_code | TEXT | NULL | 'AETH' 等货币代码 |
| inventory | purchased_at | INTEGER | NULL | 购买时间（区分馈赠/购买） |
| inventory | paid_cents | INTEGER | NULL | 实际支付 |

### 5.3 未来迁移策略

v2 上线时：
1. 新增 `wallets` / `currencies` / `transactions` 表（migration `00X_market.sql`）。
2. `pets.wallet_ref` 回填指向默认钱包（用户创建时自动开）。
3. `items.base_price_cents` / `currency_code` 按运营者配置填充。
4. 事件类型新增 `market_purchase`，与 `daily_grant` 平行。
5. 数据导出 schema_version bump 到 `1.1.0`（含 wallet 字段）。

MVP 阶段**不建空表**的理由：空表会让未来开发者以为可以往里塞数据、绕过 migration；用 nullable 字段做预留，v2 时明确新建表反而更清爽。

---

## 6. 迁移策略

### 6.1 迁移文件规范

```
src/domain/persistence/migrations/
├── 001_init.sql                     # 本文件
├── 002_add_pet_tags.sql             # 示例：v2 加字段
└── ...
```

规则：
- 文件名 `{NNN}_{short_desc}.sql`，NNN 三位递增。
- 每个 migration 必须**幂等**：
  - `CREATE TABLE IF NOT EXISTS`
  - `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`（MySQL 8.0.16+ 支持）或先 `INFORMATION_SCHEMA.COLUMNS` 检查
  - `CREATE INDEX IF NOT EXISTS`（MySQL 8.0 不直接支持；改用 `INFORMATION_SCHEMA.STATISTICS` 检查）
- 每个 migration 应用后写入 `migrations` 表（版本 + 应用时间 + SQL 文件 SHA256）。
- 启动时检查 `migrations` 表 vs 磁盘文件，缺的应用，多的报错。
- **事务包络**：MySQL DDL 不支持事务回滚（隐式 commit）；migration 脚本需自己保证失败时不留下半成品（建议一个 migration 里尽量只做一组关联 DDL）。
- **开发环境**：本地 Docker MySQL，与生产同构（架构 §10.1）。

### 6.2 版本递增规则

- **兼容变更**（新增 nullable 列、新增表、新增索引）：`schema_version` patch 位 +1（1.0.0 → 1.0.1）。
- **破坏变更**（新增必填列、列类型变更、删除列）：`schema_version` minor 位 +1（1.0.0 → 1.1.0），必须同步更新导出/导入逻辑。
- **不兼容变更**（列删除、语义变更）：major 位 +1，必须写数据迁移脚本 + 用户通知。

### 6.3 首次启动

- 若 `meta.schema_version` 为空 → 应用全部 migration 到当前代码版本。
- 若已存在 → 只应用未应用的 migration。
- 若磁盘 migration 文件比 DB 新 → 依次应用。
- 若磁盘 migration 文件比 DB 旧 → 拒绝启动（防止降级），错误提示。

---

## 7. 备份策略

> v1.1 修订：不再依赖 SQLite `.backup` API。改走两条通道：
> - **自动全量备份**：`mysqldump` 或宝塔面板自带 MySQL 备份任务
> - **用户主权导出**：`/api/export` 输出 JSON（不变）

### 7.1 自动备份

- **频率**：每日 03:00 UTC+8（自托管可配置；官方托管建议由宝塔面板定时任务跑）。
- **保留**：最近 7 天全量 + 最近 8–30 天每日保留（滚动删除）。
- **方式**（二选一）：
  1. **宝塔面板方案**（推荐，生产默认）：宝塔后台 → 数据库 → 备份 → 定时 mysqldump，产物 `data/backups/aetherpet-YYYY-MM-DD.sql.gz`。零代码，面板直接可视化恢复。
  2. **脚本方案**（不依赖面板，自托管/CI）：`scripts/backup.ts` 调用系统 `mysqldump`：
     ```bash
     mysqldump --single-transaction --routines --triggers \
       --databases aetherpet | gzip > data/backups/aetherpet-YYYY-MM-DD.sql.gz
     ```
     `--single-transaction` 保证 InnoDB 一致性快照（不锁表），与补算 async 事务相容。
- **告警**：备份失败写 `audit_log`（`event_type='backup_failed'`）。

### 7.2 用户侧手动导出

- 通过 `/api/export` 输出 JSON（架构 §4.3.3），与自动备份**并存**——JSON 用于跨中心迁移与用户主权自证，mysqldump 备份用于本机快速恢复（不依赖应用层）。

### 7.3 恢复流程

- **mysqldump 备份恢复**：停服务 → `gunzip < backup.sql.gz | mysql -u <user> -p aetherpet` → 启动 → 迁移检查 → 就绪。
- **JSON 导出恢复**：走 `/api/import`（走事务 + 校验），不影响其它用户数据。

---

## 8. 与需求/架构的映射

| 需求 / 架构项 | 表 / 字段 |
|--------------|-----------|
| 需求 §3.1 邮箱验证码 | `users`, `verification_codes`, `sessions`, `audit_log` |
| 需求 §3.1 账号申诉（备份 hash） | `users.last_backup_hash` |
| 需求 §3.2 pet 状态机 | `pets.state`, `pets.state_since`, `memories` |
| 需求 §3.3 事件引擎 | `events`（核心事实表） |
| 需求 §3.3 退避间隔 | `pets.user_last_active_ts`, `pets.next_proactive_ts` |
| 需求 §3.4 补算 | `pets.last_activity_ts`, `events.is_aggregate`, `events.aggregate_span_days` |
| 需求 §3.5 事件流 | `events`（时间线） |
| 需求 §3.6 档案页 | `pets`, `memories`, `events`, `inventory` |
| 需求 §3.7 每日馈赠 | `items`, `inventory`, `pets.daily_grant_last_date`, `pets.offer_last_date` |
| 需求 §3.7 回信 | `pets.reply_pending`, `pets.reply_due_at`, `pets.last_reply_at` |
| 需求 §3.8 公告 | `announcements`, `user_announcement_reads` |
| 需求 §3.9 导出/导入 | 导出结构见 §4.2；`meta.schema_version`, `hub_id` |
| 需求 §3.10 素材包 | `pets.active_pack_name`, `user_settings.active_pack_name` |
| 需求 §3.11 事件契约 | `events.type`, `events.params_json`, `events.memory_refs_json`, `events.pack_schema_version` |
| 需求 §3.13 邮件审计 | `audit_log` |
| 架构 §7.1 多中心 | 每表 `hub_id` + `schema_version`；`announcements.author_hub_id` + `signature` |
| 架构 §7.2 货币预留 | `pets.wallet_ref`, `items.base_price_cents`, `inventory.purchased_at/paid_cents` |

---

## 9. 设计决策记录（ADR 精简版）

### ADR-001：为什么用 ULID 而不是自增主键

- **上下文**：多中心导入时不能主键冲突；导出 JSON 需保留原 id 便于人读。
- **决策**：所有表主键用 ULID（32 字符，时序自然递增）。
- **代价**：比 INTEGER 主键多 20 字节/行，MVP 数据量下可忽略。

### ADR-002：为什么 memories 独立表而不是 events 里的 JSON

- **上下文**：记忆检索要按 kind 加权随机、要能被多次引用、要独立于事件时间线演化。
- **决策**：独立表，`events.memory_refs_json` 里存的是**引用（id 或值快照）**，不是完整记忆副本。
- **代价**：导出时要在事务内 JOIN 一次；但只发生在导出（低频）。

### ADR-003：为什么 events 单表承载所有类型

- **上下文**：事件流是"单一时间线"（需求 §3.5），不同类型事件混排展示。
- **决策**：单表 `events` + `type` 字段区分，不做事件子表拆分。
- **代价**：未来若有"高频写入的特殊事件类型"（如未来 P2P 消息），再考虑分表。MVP 不需要。

### ADR-004：为什么 audit_log 单独一张大表

- **上下文**：需求 §3.13、评审 P1-8 要求邮件推送留审计；架构 R5 要求账号安全留审计。
- **决策**：一张 `audit_log` 表承载所有审计事件，用 `event_type` 区分。
- **代价**：表会持续增长；通过定期归档（保留 90 天，超过的转 cold storage）控制体积。MVP 阶段不实现归档。

### ADR-005：为什么不做外键 ON DELETE CASCADE

- **上下文**：跨中心导入时，如果目标中心缺某 item_id，cascade 会误删 pet 数据。
- **决策**：不做 cascade；跨表一致性由领域层事务保证；导入时先插入 items（若缺），再插 inventory。
- **代价**：孤立行可能出现；由 `scripts/orphan-cleanup.ts`（可选）定期检查。

---

## 10. 与 dev-stage-plan 的对齐

数据库 schema 在 `001_init.sql` 一次建齐（所有 MVP 需要的表 + 索引），不做分阶段加表。理由：

- 表结构的完整定义能避免"阶段 5 才发现阶段 2 的表少了字段"这种返工。
- SQLite migration 便宜，未来加字段容易，加字段前建表更容易出问题。（v1.1：MySQL 的 `ALTER TABLE` 对大表会 lock schema，但 MVP 单中心小数据量下开销可接受；新增字段前建表更容易出问题 依旧成立。）
- 空表不会拖慢启动性能（MySQL InnoDB 元数据按需加载）。

**阶段 1 交付**：`001_init.sql` + 全部 repo + `meta` 表初始化。
**后续阶段**：只在需要新业务表时新增 migration，MVP 期内预计无新增表。

---

*本文档定稿于 2026-09-09。schema_version 首次上线为 1.0.0，未来变更必须 bump 版本并更新导出/导入契约。*
