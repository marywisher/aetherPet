-- 001_init.sql
-- aetherPet 初始 schema，schema_version = 1.0.0
-- 目标：MySQL 8.0+，InnoDB，utf8mb4_unicode_ci
-- 关联文档：docs/database-schema.md §2 完整 DDL

-- 说明：
--   1) 所有时间戳字段统一 BIGINT UNSIGNED UTC ms（应用层负责格式化/本地化）
--   2) ULID 主键 = VARCHAR(32)，非自增（ADR-001）
--   3) 布尔语义 = TINYINT(1)，0 = false, 1 = true
--   4) MySQL 8 不支持 partial index，需要时改生成列 + 普通索引
--   5) 事务为 async 事务（mysql2 驱动），业务侧统一封装 BEGIN / COMMIT / ROLLBACK

-- 说明：CREATE DATABASE / USE 已移除。
--   连接池已按 env.DB_NAME（docker-compose 的 MYSQL_DATABASE）指向目标库；
--   多语句迁移用 pool.query() 一次性发送（见 runner.ts），不再在 SQL 里切换 schema。
--
-- ================================================================
-- 0. 元信息表（版本、中心、迁移记录）
-- ================================================================

CREATE TABLE meta (
  key           VARCHAR(64)      NOT NULL,
  value         TEXT             NOT NULL,
  updated_at    BIGINT UNSIGNED  NOT NULL,
  PRIMARY KEY (key)
) ENGINE=InnoDB;

CREATE TABLE migrations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  version     VARCHAR(64)     NOT NULL,
  applied_at  BIGINT UNSIGNED NOT NULL,
  checksum    CHAR(64)        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_migrations_version (version)
) ENGINE=InnoDB;

-- ================================================================
-- 1. 账号体系
-- ================================================================

CREATE TABLE users (
  id                VARCHAR(32)     NOT NULL,
  email_hash        CHAR(64)        NOT NULL,
  email_plain_enc   TEXT            NULL,
  email_verified_at BIGINT UNSIGNED NULL,
  created_at        BIGINT UNSIGNED NOT NULL,
  updated_at        BIGINT UNSIGNED NOT NULL,
  last_backup_hash  CHAR(64)        NULL,
  imported_from_hub VARCHAR(64)     NULL,
  imported_at       BIGINT UNSIGNED NULL,
  schema_version    VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id            VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email_hash (email_hash)
) ENGINE=InnoDB;

CREATE TABLE verification_codes (
  id              VARCHAR(32)     NOT NULL,
  user_id         VARCHAR(32)     NOT NULL,
  email_hash      CHAR(64)        NOT NULL,
  code_hash       CHAR(64)        NOT NULL,
  issued_at       BIGINT UNSIGNED NOT NULL,
  expires_at      BIGINT UNSIGNED NOT NULL,
  used_at         BIGINT UNSIGNED NULL,
  ip              VARCHAR(45)     NULL,
  user_agent      VARCHAR(512)    NULL,
  schema_version  VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id          VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE sessions (
  id              VARCHAR(32)     NOT NULL,
  user_id         VARCHAR(32)     NOT NULL,
  token_hash      CHAR(64)        NOT NULL,
  issued_at       BIGINT UNSIGNED NOT NULL,
  expires_at      BIGINT UNSIGNED NOT NULL,
  last_seen_at    BIGINT UNSIGNED NOT NULL,
  ip              VARCHAR(45)     NULL,
  user_agent      VARCHAR(512)    NULL,
  revoked_at      BIGINT UNSIGNED NULL,
  schema_version  VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id          VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE audit_log (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         VARCHAR(32)     NULL,
  event_type      VARCHAR(64)     NOT NULL,
  detail          JSON            NULL,
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

CREATE TABLE pets (
  id                      VARCHAR(32)     NOT NULL,
  user_id                 VARCHAR(32)     NOT NULL,
  name                    VARCHAR(64)     NOT NULL,
  state                   VARCHAR(32)     NOT NULL,
  state_since             BIGINT UNSIGNED NOT NULL,
  created_at              BIGINT UNSIGNED NOT NULL,
  updated_at              BIGINT UNSIGNED NOT NULL,
  last_activity_ts        BIGINT UNSIGNED NOT NULL,
  user_last_active_ts     BIGINT UNSIGNED NOT NULL,
  next_proactive_ts       BIGINT UNSIGNED NULL,
  daily_grant_last_date   VARCHAR(10)     NULL,
  offer_last_date         VARCHAR(10)     NULL,
  reply_pending           TINYINT(1)      NOT NULL DEFAULT 0,
  reply_due_at            BIGINT UNSIGNED NULL,
  last_reply_at           BIGINT UNSIGNED NULL,
  active_pack_name        VARCHAR(64)     NOT NULL DEFAULT 'default',
  wallet_ref              VARCHAR(32)     NULL,
  schema_version          VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id                  VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE memories (
  id              VARCHAR(32)     NOT NULL,
  pet_id          VARCHAR(32)     NOT NULL,
  kind            VARCHAR(32)     NOT NULL,
  value           TEXT            NOT NULL,
  created_at      BIGINT UNSIGNED NOT NULL,
  last_referenced BIGINT UNSIGNED NULL,
  weight          DECIMAL(10,4)   NOT NULL DEFAULT 1.0000,
  is_permanent    TINYINT(1)      NOT NULL DEFAULT 0,
  schema_version  VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id          VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- ================================================================
-- 3. 物品与物品栏
-- ================================================================

CREATE TABLE items (
  id                VARCHAR(64)     NOT NULL,
  display_name      VARCHAR(64)     NOT NULL,
  description       TEXT            NULL,
  icon_path         VARCHAR(255)    NOT NULL,
  rarity_weight     DECIMAL(10,4)   NOT NULL DEFAULT 1.0000,
  category          VARCHAR(32)     NULL,
  base_price_cents  INT UNSIGNED    NULL,
  currency_code     VARCHAR(16)     NULL,
  schema_version    VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id            VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE inventory (
  id                VARCHAR(32)     NOT NULL,
  user_id           VARCHAR(32)     NOT NULL,
  pet_id            VARCHAR(32)     NOT NULL,
  item_id           VARCHAR(64)     NOT NULL,
  acquired_at       BIGINT UNSIGNED NOT NULL,
  acquired_via      VARCHAR(32)     NOT NULL,
  granted_event_id  VARCHAR(32)     NULL,
  offered_at        BIGINT UNSIGNED NULL,
  offered_event_id  VARCHAR(32)     NULL,
  consumed_at       BIGINT UNSIGNED NULL,
  consumed_event_id VARCHAR(32)     NULL,
  purchased_at      BIGINT UNSIGNED NULL,
  paid_cents        INT UNSIGNED    NULL,
  schema_version    VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id            VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- ================================================================
-- 4. 事件（核心事实表）
-- ================================================================

CREATE TABLE events (
  id                  VARCHAR(32)     NOT NULL,
  pet_id              VARCHAR(32)     NOT NULL,
  user_id             VARCHAR(32)     NOT NULL,
  type                VARCHAR(64)     NOT NULL,
  ts                  BIGINT UNSIGNED NOT NULL,
  fsm_state           VARCHAR(32)     NOT NULL,
  params_json         JSON            NOT NULL,
  engine_version      VARCHAR(16)     NOT NULL,
  pack_schema_version VARCHAR(16)     NOT NULL,
  source              VARCHAR(32)     NOT NULL,
  memory_refs_json    JSON            NOT NULL,
  is_aggregate        TINYINT(1)      NOT NULL DEFAULT 0,
  aggregate_span_days INT UNSIGNED    NULL,
  generated_by_catchup TINYINT(1)     NOT NULL DEFAULT 0,
  schema_version      VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id              VARCHAR(64)     NOT NULL DEFAULT 'local',
  created_at          BIGINT UNSIGNED NOT NULL,

  PRIMARY KEY (id)
) ENGINE=InnoDB;

-- 聚合摘要专用生成列（B-Tree 不索引 NULL，等效 partial index）
ALTER TABLE events
  ADD COLUMN aggregate_ts BIGINT UNSIGNED
  GENERATED ALWAYS AS (CASE WHEN is_aggregate = 1 THEN ts ELSE NULL END) STORED;

-- ================================================================
-- 5. 公告
-- ================================================================

CREATE TABLE announcements (
  id              VARCHAR(32)     NOT NULL,
  title           VARCHAR(128)    NOT NULL,
  body            TEXT            NOT NULL,
  level           VARCHAR(32)     NOT NULL DEFAULT 'info',
  published_at    BIGINT UNSIGNED NOT NULL,
  author_hub_id   VARCHAR(64)     NOT NULL,
  signature       TEXT            NULL,
  expires_at      BIGINT UNSIGNED NULL,
  schema_version  VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id          VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE user_announcement_reads (
  user_id             VARCHAR(32)     NOT NULL,
  announcement_id     VARCHAR(32)     NOT NULL,
  read_at             BIGINT UNSIGNED NOT NULL,
  muted_until_ts      BIGINT UNSIGNED NULL,
  schema_version      VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id              VARCHAR(64)     NOT NULL DEFAULT 'local',
  PRIMARY KEY (user_id, announcement_id)
) ENGINE=InnoDB;

-- ================================================================
-- 6. 用户偏好
-- ================================================================

CREATE TABLE user_settings (
  user_id             VARCHAR(32)     PRIMARY KEY,
  active_pack_name    VARCHAR(64)     NOT NULL DEFAULT 'default',
  timezone            VARCHAR(64)     NOT NULL DEFAULT 'Asia/Shanghai',
  muted_notifications TINYINT(1)      NOT NULL DEFAULT 0,
  updated_at          BIGINT UNSIGNED NOT NULL,
  schema_version      VARCHAR(16)     NOT NULL DEFAULT '1.0.0',
  hub_id              VARCHAR(64)     NOT NULL DEFAULT 'local'
) ENGINE=InnoDB;

-- ================================================================
-- 索引（见 docs/database-schema.md §3）
-- ================================================================

-- 事件时间线
CREATE INDEX idx_events_pet_ts ON events(pet_id, ts);
CREATE INDEX idx_events_pet_type ON events(pet_id, type, ts);
CREATE INDEX idx_events_user_ts ON events(user_id, ts);
CREATE INDEX idx_events_aggregate ON events(pet_id, aggregate_ts);
CREATE INDEX idx_events_hub ON events(hub_id);

-- 补算
CREATE INDEX idx_pets_reply_due ON pets(reply_pending, reply_due_at);
CREATE INDEX idx_pets_user ON pets(user_id);

-- 记忆
CREATE INDEX idx_memories_pet ON memories(pet_id, kind);
CREATE INDEX idx_memories_lastref ON memories(pet_id, last_referenced);

-- 物品
CREATE INDEX idx_inventory_user ON inventory(user_id, acquired_at);
CREATE INDEX idx_inventory_offered_at ON inventory(user_id, offered_at);

-- 公告
CREATE INDEX idx_announcements_published ON announcements(published_at);
CREATE INDEX idx_ua_reads_user ON user_announcement_reads(user_id, read_at);

-- 账号
CREATE INDEX idx_vc_email_issued ON verification_codes(email_hash, issued_at);
CREATE INDEX idx_vc_expires ON verification_codes(expires_at);
CREATE UNIQUE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_audit_user_ts ON audit_log(user_id, created_at);
CREATE INDEX idx_audit_type_ts ON audit_log(event_type, created_at);

-- 数据主权
CREATE INDEX idx_users_hub ON users(hub_id);
