/**
 * 文件名称：schema.ts
 * 功能描述：导出 JSON 结构定义（数据主权 MVP 版）
 * 所属模块：domain/export
 * 验收对齐：
 *   - docs/requirements.md §3.9 数据导出/导入（导出规范 v1）
 *   - docs/database-schema.md §4.2 导出 JSON 结构
 * 说明：
 *   - 领域层纯 TS，不 import next/react
 *   - 结构与 database-schema.md §4.2 一一对应（snake_case 键名，保持 JSON 原生形态）
 *   - 排除项（需求 §3.9）：sessions / verification_codes / audit_log / email_plain_enc
 *   - 多中心迁移 v2 预留：任何字段不出现在本 schema 中即为「服务端内部元数据」，
 *     目标中心无法依赖；跨中心导入时强制改写 hub_id 与 schema_version
 */

import type { PetState } from "../types";

/** 当前导出 schema 版本（MVP 只接受此版本导入） */
export const EXPORT_SCHEMA_VERSION = "1.0.0";

/** 校验和前缀（需求 §3.9 SHA256 校验和） */
export const CHECKSUM_PREFIX = "SHA256:";

/** meta 块：一次性写入文件头 */
export interface ExportMeta {
  schema_version: string;
  /** 导出时刻（UTC ms） */
  exported_at: number;
  /** 服务中心标识（env.HUB_ID） */
  exported_from: string;
  /** 形如 "SHA256:<64 hex>"；对「不含本字段的 payload」序列化后取 SHA256 */
  checksum: string;
  engine_version: string;
  pack_schema_version: string;
}

/** user 块：只导出邮箱 hash 与创建时间（email_plain_enc 不入导出） */
export interface ExportUser {
  email_hash: string;
  created_at: number;
  /** 上一次导出备份的校验和（申诉自证用） */
  last_backup_hash: string | null;
}

/** pet.base：可恢复的核心状态（含退避/馈赠/回信进度） */
export interface ExportPetBase {
  id: string;
  name: string;
  state: PetState;
  state_since: number;
  created_at: number;
  last_activity_ts: number;
  user_last_active_ts: number;
  next_proactive_ts: number | null;
  daily_grant_last_date: string | null;
  offer_last_date: string | null;
  reply_pending: boolean;
  reply_due_at: number | null;
  last_reply_at: number | null;
  active_pack_name: string;
}

/** 记忆片段（kind/value/权重/时间锚点） */
export interface ExportMemory {
  id: string;
  kind: string;
  value: string;
  created_at: number;
  last_referenced: number | null;
  weight: number;
  is_permanent: boolean;
}

/** 事件时间线：结构 + 参数 + 记忆引用（不含表现文案） */
export interface ExportEvent {
  id: string;
  pet_id: string;
  type: string;
  ts: number;
  fsm_state: PetState;
  params: Record<string, unknown>;
  engine_version: string;
  pack_schema_version: string;
  source: string;
  memory_refs: Array<{ kind: string; value: string; weight: number; source_event_id?: string }>;
  is_aggregate: boolean;
  aggregate_span_days: number | null;
  generated_by_catchup: boolean;
  created_at: number;
}

/** 物品栏实例（引用 items_catalog / items 表） */
export interface ExportInventory {
  id: string;
  item_id: string;
  acquired_at: number;
  acquired_via: string;
  granted_event_id: string | null;
  offered_at: number | null;
  offered_event_id: string | null;
  consumed_at: number | null;
  consumed_event_id: string | null;
}

/** 物品目录快照：避免目标中心缺 item（源自用户已获得的物品） */
export interface ExportItemCatalog {
  id: string;
  display_name: string;
  description: string | null;
  icon_path: string;
  rarity_weight: number;
  category: string | null;
}

/** pending_reply：回信进度（供给/回信闭环恢复） */
export interface ExportPendingReply {
  reply_pending: boolean;
  reply_due_at: number | null;
  last_reply_at: number | null;
}

/** settings：用户偏好（不含 token） */
export interface ExportSettings {
  active_pack_name: string;
  timezone: string;
}

/** announcements_unread：用户视角未读公告的内容快照 */
export interface ExportAnnouncementSnapshot {
  id: string;
  title: string;
  body: string;
  level: string;
  published_at: number;
  expires_at: number | null;
}

/** 导出 payload 顶层结构（对齐 database-schema.md §4.2） */
export interface ExportPayload {
  meta: ExportMeta;
  user: ExportUser;
  pet: {
    base: ExportPetBase;
    memories: ExportMemory[];
    events: ExportEvent[];
    inventory: ExportInventory[];
    items_catalog: ExportItemCatalog[];
    pending_reply: ExportPendingReply;
  };
  settings: ExportSettings;
  announcements_unread: ExportAnnouncementSnapshot[];
}

/** 导入结果摘要 */
export interface ImportSummary {
  petId: string;
  petName: string;
  memories: number;
  events: number;
  inventory: number;
  items_catalog: number;
  announcements: number;
}