/**
 * 文件名称：types.ts
 * 功能描述：领域实体统一类型（前端可复用）
 * 所属模块：domain
 * 说明：
 *   - 领域层纯 TS，不 import next/react
 *   - 前端可通过 import type 复用这些类型
 *   - 所有时间戳统一 UTC 毫秒
 */

// ============================================================
// 通用
// ============================================================

/** UTC 毫秒时间戳 */
export type Timestamp = number;

/** ULID 字符串（32 字符） */
export type Ulid = string;

// ============================================================
// User
// ============================================================

export interface User {
  id: Ulid;
  emailHash: string;
  emailPlainEnc: string | null;
  emailVerifiedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastBackupHash: string | null;
  importedFromHub: string | null;
  importedAt: Timestamp | null;
  schemaVersion: string;
  hubId: string;
}

// ============================================================
// Pet
// ============================================================

export type PetState = "at_home" | "out_walking" | "on_trip";

export interface Pet {
  id: Ulid;
  userId: Ulid;
  name: string;
  state: PetState;
  stateSince: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastActivityTs: Timestamp;
  userLastActiveTs: Timestamp;
  nextProactiveTs: Timestamp | null;
  dailyGrantLastDate: string | null; // YYYY-MM-DD
  offerLastDate: string | null;
  replyPending: boolean;
  replyDueAt: Timestamp | null;
  lastReplyAt: Timestamp | null;
  activePackName: string;
  walletRef: string | null;
  schemaVersion: string;
  hubId: string;
}

// ============================================================
// Session
// ============================================================

export interface Session {
  id: Ulid;
  userId: Ulid;
  tokenHash: string;
  issuedAt: Timestamp;
  expiresAt: Timestamp;
  lastSeenAt: Timestamp;
  ip: string | null;
  userAgent: string | null;
  revokedAt: Timestamp | null;
  schemaVersion: string;
  hubId: string;
}

// ============================================================
// Verification Code
// ============================================================

export interface VerificationCode {
  id: Ulid;
  userId: Ulid;
  emailHash: string;
  codeHash: string;
  issuedAt: Timestamp;
  expiresAt: Timestamp;
  usedAt: Timestamp | null;
  ip: string | null;
  userAgent: string | null;
  schemaVersion: string;
  hubId: string;
}

// ============================================================
// Memory
// ============================================================

export type MemoryKind =
  | "naming"
  | "preference"
  | "item_received"
  | "place_visited"
  | "sentiment"
  | "custom";

export interface Memory {
  id: Ulid;
  petId: Ulid;
  kind: MemoryKind;
  value: string;
  createdAt: Timestamp;
  lastReferenced: Timestamp | null;
  weight: number;
  isPermanent: boolean;
  schemaVersion: string;
  hubId: string;
}

// ============================================================
// Item & Inventory
// ============================================================

export interface Item {
  id: string; // slug，如 'berry'
  displayName: string;
  description: string | null;
  iconPath: string;
  rarityWeight: number;
  category: string | null;
  basePriceCents: number | null;
  currencyCode: string | null;
  schemaVersion: string;
  hubId: string;
}

export type InventoryAcquiredVia = "daily_grant" | "brought_back" | "import";

export interface Inventory {
  id: Ulid;
  userId: Ulid;
  petId: Ulid;
  itemId: string;
  acquiredAt: Timestamp;
  acquiredVia: InventoryAcquiredVia;
  grantedEventId: Ulid | null;
  offeredAt: Timestamp | null;
  offeredEventId: Ulid | null;
  consumedAt: Timestamp | null;
  consumedEventId: Ulid | null;
  purchasedAt: Timestamp | null;
  paidCents: number | null;
  schemaVersion: string;
  hubId: string;
}

// ============================================================
// Event
// ============================================================

export const EventType = {
  OUTING: "outing",
  WATCHING_WATER: "watching_water",
  COUNTING_LEAVES: "counting_leaves",
  SELF_TALK: "self_talk",
  BROUGHT_ITEM: "brought_item",
  REPLY_LETTER: "reply_letter",
  SPONTANEOUS_LETTER: "spontaneous_letter",
  AGGREGATE_SUMMARY: "aggregate_summary",
  SYSTEM_ANNOUNCE: "system_announce",
  DAILY_GRANT: "daily_grant",
  OFFER_RECEIVED: "offer_received",
} as const;

export type EventTypeValue = typeof EventType[keyof typeof EventType];

export type EventSource = "engine" | "catchup" | "gift" | "system" | "admin";

export interface MemoryRef {
  kind: "pet_name" | "item_name" | "time_anchor" | "place";
  value: string;
  weight: number;
  sourceEventId?: Ulid;
}

export interface Event {
  id: Ulid;
  petId: Ulid;
  userId: Ulid;
  type: EventTypeValue;
  ts: Timestamp;
  fsmState: PetState;
  params: Record<string, unknown>;
  engineVersion: string;
  packSchemaVersion: string;
  source: EventSource;
  memoryRefs: MemoryRef[];
  isAggregate: boolean;
  aggregateSpanDays: number | null;
  generatedByCatchup: boolean;
  schemaVersion: string;
  hubId: string;
  createdAt: Timestamp;
}

// ============================================================
// Audit Log
// ============================================================

export type AuditEventType =
  | "verification_attempt"
  | "verification_success"
  | "verification_throttled"
  | "verification_failed"
  | "login_success"
  | "login_failed"
  | "token_revoked"
  | "pet_created"
  | "export"
  | "import_success"
  | "import_failed"
  | "pack_switched"
  | "announcement_published"
  | "pack_load_failed"
  | "email_sent"
  | "backup_created"
  | "backup_failed";

export interface AuditEntry {
  id: number;
  userId: Ulid | null;
  eventType: AuditEventType;
  detail: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Timestamp;
  schemaVersion: string;
  hubId: string;
}

// ============================================================
// Asset Pack
// ============================================================

export interface PackPalette {
  primary: string;
  accent: string;
  memoryRef: string;
  paper: string;
  ink: string;
}

/**
 * 素材包 manifest.json 类型（对应 manifest-schema.ts 的 zod schema）
 * 说明：使用 snake_case 键名（与 JSON 文件保持一致）
 */
export interface PackManifest {
  name: string;
  display_name: string;
  version: string;
  pack_schema_version: string;
  min_engine_version: string;
  author: string;
  license: string;
  theme: {
    css: string;
    palette: {
      primary: string;
      accent: string;
      memory_ref: string;
      paper: string;
      ink: string;
    };
  };
  assets: Record<string, string>;
  texts: Record<string, string>;
  fallback: string | null;
  [key: string]: unknown;
}

/** 已加载到内存的素材包（供 API + 前端消费） */
export interface LoadedPack {
  name: string;
  displayName: string;
  manifest: PackManifest | null;
  path: string;
  webPath: string;
  themeCssContent: string | null;
  images: Record<string, { content: Buffer; contentType: string }>;
  texts: Record<string, unknown>;
  audio: Record<string, { content: Buffer; contentType: string }>;
}

/** 素材包加载失败原因 */
export type FallbackReason = "manifest_missing" | "manifest_invalid" | "theme_css_missing";

// ============================================================
// Hub Identity (中心身份)
// ============================================================

export interface HubIdentity {
  hubId: string;
  hubDisplayName: string;
  adminEmail: string;
  privacyUrl: string;
  domain: string;
}

// ============================================================
// SMTP Config
// ============================================================

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
  dryRun: boolean;
}
