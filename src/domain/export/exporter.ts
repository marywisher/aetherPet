/**
 * 文件名称：exporter.ts
 * 功能描述：导出器——把用户 pet 全量数据组装为导出 JSON（含 SHA256 校验和）
 * 所属模块：domain/export
 * 验收对齐：
 *   - docs/requirements.md §3.9 数据导出/导入（meta / schema / 校验和 / 排除项）
 *   - docs/database-schema.md §4.2 导出 JSON 结构
 *   - docs/current-stage.md 阶段 6 关键约束 1（schema_version / exported_at /
 *     exported_from / SHA256）
 * 说明：
 *   - 只读组装：不写库（`recordBackupHash` 由 API 层在成功后调用）
 *   - 排除项：sessions / verification_codes / audit_log / email_plain_enc
 *   - 校验和 = SHA256(不含 meta.checksum 字段的 payload JSON 序列化)
 *   - 领域层通过 repo 层做 IO（与 catchup/gift 一致），不直接握连接
 */

import { createHash } from "crypto";
import { getEnv } from "@/config/env";
import {
  findById as findUserById,
} from "../persistence/repos/users.repo";
import { findByUserId as findPetsByUser } from "../persistence/repos/pets.repo";
import { findByPetId as findMemoriesByPet } from "../persistence/repos/memories.repo";
import { findByPetId as findEventsByPet } from "../persistence/repos/events.repo";
import { findAllByUser as findInventoryByUser } from "../persistence/repos/inventory.repo";
import { findBySlugs as findItemsBySlugs } from "../persistence/repos/items.repo";
import { getPool } from "../persistence/db";
import { query as sqlQuery, queryOne as sqlQueryOne } from "../persistence/sql";
import { ENGINE_VERSION, PACK_SCHEMA_VERSION } from "../events/types";
import {
  CHECKSUM_PREFIX,
  EXPORT_SCHEMA_VERSION,
  type ExportItemCatalog,
  type ExportPayload,
} from "./schema";
import type { Memory, Event, Inventory, Item } from "../types";

/**
 * 计算 payload 的规范序列化（不含 meta.checksum）。
 * 导入侧用同一函数重算校验和，确保可复现。
 */
export function canonicalJson(payload: Pick<ExportPayload, "meta"> & Partial<ExportPayload>): string {
  const { meta } = payload;
  // meta.checksum 置 undefined → JSON.stringify 会跳过该键
  return JSON.stringify({ ...payload, meta: { ...meta, checksum: undefined } });
}

/** 对规范序列化取 SHA256，返回 "SHA256:<hex>" */
export function computeChecksum(payload: ExportPayload): string {
  const hex = createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
  return `${CHECKSUM_PREFIX}${hex}`;
}

/** 从 "SHA256:<hex>" 提取 hex 部分（供 recordBackupHash 使用）；非法输入返回 null */
export function extractChecksumHex(checksum: string): string | null {
  if (!checksum.startsWith(CHECKSUM_PREFIX)) return null;
  const hex = checksum.slice(CHECKSUM_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** 事件分页拉取（最多保护 10 万条，防止异常超大表把进程拖垮） */
const MAX_EVENTS_FOR_EXPORT = 100_000;
const EVENT_PAGE_SIZE = 500;

async function fetchAllEvents(petId: string): Promise<Event[]> {
  const out: Event[] = [];
  let offset = 0;
  for (;;) {
    const page = await findEventsByPet(petId, EVENT_PAGE_SIZE, offset);
    out.push(...page);
    if (page.length < EVENT_PAGE_SIZE || out.length >= MAX_EVENTS_FOR_EXPORT) break;
    offset += page.length;
  }
  return out;
}

/** 拉取用户未读公告快照（published 且未过期，且用户无已读记录） */
async function fetchUnreadAnnouncements(
  userId: string,
  now: number,
  limit = 200
): Promise<Array<{
  id: string; title: string; body: string; level: string;
  published_at: number; expires_at: number | null;
}>> {
  const pool = getPool();
  const rows = await sqlQuery<{
    id: string; title: string; body: string; level: string;
    published_at: number | string; expires_at: number | string | null;
  }>(
    pool,
    `SELECT a.id, a.title, a.body, a.level, a.published_at, a.expires_at
       FROM announcements a
       LEFT JOIN user_announcement_reads r
         ON r.announcement_id = a.id AND r.user_id = ?
      WHERE r.announcement_id IS NULL
        AND a.published_at <= ?
        AND (a.expires_at IS NULL OR a.expires_at > ?)
      ORDER BY a.published_at DESC
      LIMIT ?`,
    [userId, now, now, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    level: r.level,
    published_at: Number(r.published_at),
    expires_at: r.expires_at === null ? null : Number(r.expires_at),
  }));
}

/** 读取用户时区偏好（user_settings 无 repo，直接轻查询；无行时用默认） */
async function fetchUserTimezone(userId: string): Promise<string> {
  const pool = getPool();
  const row = await sqlQueryOne<{ timezone: string }>(
    pool,
    "SELECT timezone FROM user_settings WHERE user_id = ?",
    [userId]
  );
  return row?.timezone ?? "Asia/Shanghai";
}

/** 缺失目标中心时的异常（调用方应确保 user/pet 存在） */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

export interface ExportResult {
  payload: ExportPayload;
  /** 校验和 hex（64 位），供 recordBackupHash 与 API 返回 */
  checksumHex: string;
}

/**
 * 组装导出 payload（不含 last_backup_hash 更新——由 API 层负责）。
 *
 * @param userId 当前登录用户
 * @returns ExportResult；用户/pet 不存在时抛 ExportError
 */
export async function buildExport(userId: string, now = Date.now()): Promise<ExportResult> {
  const env = getEnv();

  const user = await findUserById(userId);
  if (!user) throw new ExportError("用户不存在");

  const pets = await findPetsByUser(userId);
  if (pets.length === 0) throw new ExportError("该账号还没有 pet，无可导出数据");
  const pet = pets[0];

  const memories = await findMemoriesByPet(pet.id);
  const events = await fetchAllEvents(pet.id);
  const inventory = await findInventoryByUser(userId);

  // 物品目录快照：来自物品栏涉及的 item slug（去重保序）
  const itemIds = [...new Set(inventory.map((i) => i.itemId))];
  const itemMap = await findItemsBySlugs(itemIds);
  const itemsCatalog: ExportItemCatalog[] = itemIds
    .map((slug) => itemMap.get(slug))
    .filter((it): it is Item => Boolean(it))
    .map((it) => ({
      id: it.id,
      display_name: it.displayName,
      description: it.description,
      icon_path: it.iconPath,
      rarity_weight: it.rarityWeight,
      category: it.category,
    }));

  const pendingReply = {
    reply_pending: pet.replyPending,
    reply_due_at: pet.replyDueAt,
    last_reply_at: pet.lastReplyAt,
  };

  const unreadAnnouncements = await fetchUnreadAnnouncements(userId, now);

  const payload: ExportPayload = {
    meta: {
      schema_version: EXPORT_SCHEMA_VERSION,
      exported_at: now,
      exported_from: env.HUB_ID,
      checksum: "", // 占位，computeChecksum 时被剥离
      engine_version: ENGINE_VERSION,
      pack_schema_version: PACK_SCHEMA_VERSION,
    },
    user: {
      email_hash: user.emailHash,
      created_at: user.createdAt,
      last_backup_hash: user.lastBackupHash,
    },
    pet: {
      base: {
        id: pet.id,
        name: pet.name,
        state: pet.state,
        state_since: pet.stateSince,
        created_at: pet.createdAt,
        last_activity_ts: pet.lastActivityTs,
        user_last_active_ts: pet.userLastActiveTs,
        next_proactive_ts: pet.nextProactiveTs,
        daily_grant_last_date: pet.dailyGrantLastDate,
        offer_last_date: pet.offerLastDate,
        reply_pending: pet.replyPending,
        reply_due_at: pet.replyDueAt,
        last_reply_at: pet.lastReplyAt,
        active_pack_name: pet.activePackName,
      },
      memories: memories.map(memToExport),
      events: events.map(eventToExport),
      inventory: inventory.map(invToExport),
      items_catalog: itemsCatalog,
      pending_reply: pendingReply,
    },
    settings: {
      active_pack_name: pet.activePackName,
      timezone: await fetchUserTimezone(userId),
    },
    announcements_unread: unreadAnnouncements,
  };

  // 回填校验和
  payload.meta.checksum = computeChecksum(payload);

  const checksumHex = extractChecksumHex(payload.meta.checksum);
  if (!checksumHex) throw new ExportError("校验和生成失败");
  return { payload, checksumHex };
}

// ============================================================
// 行 → 导出结构映射（纯函数）
// ============================================================

function memToExport(m: Memory) {
  return {
    id: m.id,
    kind: m.kind,
    value: m.value,
    created_at: m.createdAt,
    last_referenced: m.lastReferenced,
    weight: m.weight,
    is_permanent: m.isPermanent,
  };
}

function eventToExport(e: Event) {
  return {
    id: e.id,
    pet_id: e.petId,
    type: e.type,
    ts: e.ts,
    fsm_state: e.fsmState,
    params: e.params ?? {},
    engine_version: e.engineVersion,
    pack_schema_version: e.packSchemaVersion,
    source: e.source,
    memory_refs: (e.memoryRefs ?? []).map((r) => ({
      kind: r.kind,
      value: r.value,
      weight: r.weight,
      ...(r.sourceEventId ? { source_event_id: r.sourceEventId } : {}),
    })),
    is_aggregate: e.isAggregate,
    aggregate_span_days: e.aggregateSpanDays,
    generated_by_catchup: e.generatedByCatchup,
    created_at: e.createdAt,
  };
}

function invToExport(i: Inventory) {
  return {
    id: i.id,
    item_id: i.itemId,
    acquired_at: i.acquiredAt,
    acquired_via: i.acquiredVia,
    granted_event_id: i.grantedEventId,
    offered_at: i.offeredAt,
    offered_event_id: i.offeredEventId,
    consumed_at: i.consumedAt,
    consumed_event_id: i.consumedEventId,
  };
}