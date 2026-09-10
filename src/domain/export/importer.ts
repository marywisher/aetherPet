/**
 * 文件名称：importer.ts
 * 功能描述：导入器——校验导出 JSON + 单事务恢复（失败整体 rollback）
 * 所属模块：domain/export
 * 验收对齐：
 *   - docs/requirements.md §3.9 数据导出/导入（三类错误分文案；恢复后逐字段比对一致）
 *   - docs/database-schema.md §4.3 导入流程的数据主权保障
 *   - docs/current-stage.md 阶段 6 关键约束 2（单一事务，失败整体 rollback）
 * 说明：
 *   - 校验（parse/version/checksum/fields）为纯函数，便于单测
 *   - 写库只在事务内发生；任何一步抛错 → withTransaction rollback
 *   - 每行强制改写 hub_id = 当前中心、schema_version = 当前版本（§4.3 第 4 步）
 *   - 导入语义 = 「恢复」：先清空该用户当前数据，再按导出内容重建（演示步骤 2）
 */

import type { PoolConnection } from "mysql2/promise";
import { getEnv } from "@/config/env";
import { connQueryOne, connExecute } from "../persistence/sql";
import { insert as insertMemory } from "../persistence/repos/memories.repo";
import { insert as insertInventory } from "../persistence/repos/inventory.repo";
import { insert as insertEvent } from "../persistence/repos/events.repo";
import { insertIgnore as insertItemIgnore } from "../persistence/repos/items.repo";
import { EXPORT_SCHEMA_VERSION, type ExportPayload, type ImportSummary } from "./schema";
import {
  computeChecksum,
  extractChecksumHex,
} from "./exporter";
import {
  fieldMissingError,
  versionMismatchError,
  type ImportErrorInfo,
} from "./error-messages";
import type { Event, Inventory, Memory, MemoryKind, PetState, EventSource } from "../types";

/** 记忆引用的 kind 枚举（与 Event.memoryRefs 对齐） */
type MemoryRefKind = "pet_name" | "item_name" | "time_anchor" | "place";

// ============================================================
// 纯校验层（可单测）
// ============================================================

export type ParseResult =
  | { ok: true; payload: ExportPayload }
  | { ok: false; error: ImportErrorInfo };

/** 步骤 0：JSON 解析（body 为原始文本） */
export function parseImportBody(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: { kind: "ERR_NOT_JSON", code: "ERR_NOT_JSON", message: "导入失败：文件不是合法的 JSON。请确认选择的是导出的备份文件。", status: 400 } };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: fieldMissingError("meta") };
  }
  return { ok: true, payload: parsed as ExportPayload };
}

/** 步骤 1：schema 版本校验（MVP 只接受 1.0.0） */
export function validateVersion(payload: ExportPayload) {
  const got = payload?.meta?.schema_version;
  if (got !== EXPORT_SCHEMA_VERSION) {
    return { ok: false as const, error: versionMismatchError(String(got ?? "(缺失)"), EXPORT_SCHEMA_VERSION) };
  }
  return { ok: true as const };
}

/** 步骤 2：校验和校验（对「不含 meta.checksum 的 payload」重算 SHA256 比较） */
export function validateChecksum(payload: ExportPayload) {
  const provided = payload?.meta?.checksum;
  if (typeof provided !== "string" || !provided.startsWith("SHA256:")) {
    return { ok: false as const, error: { kind: "ERR_CHECKSUM_MISMATCH" as const, code: "ERR_CHECKSUM_MISMATCH", message: "导入失败：校验和验证不通过，文件可能已被改动或损坏。请重新导出后导入。", detail: "meta.checksum 缺失或格式非法", status: 422 } };
  }
  const recomputed = computeChecksum(payload);
  // 恒定时间比较，避免时序侧信道（虽为本地导入，仍保持习惯）
  if (recomputed.length !== provided.length || !timingSafeEqual(recomputed, provided)) {
    return { ok: false as const, error: { kind: "ERR_CHECKSUM_MISMATCH" as const, code: "ERR_CHECKSUM_MISMATCH", message: "导入失败：校验和验证不通过，文件可能已被改动或损坏。请重新导出后导入。", detail: "SHA256 校验和不一致", status: 422 } };
  }
  return { ok: true as const };
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const PET_STATES = new Set<string>(["at_home", "out_walking", "on_trip"]);

const REQUIRED = [
  ["meta.schema_version", (p: ExportPayload) => typeof p?.meta?.schema_version === "string"],
  ["meta.exported_at", (p: ExportPayload) => typeof p?.meta?.exported_at === "number"],
  ["meta.exported_from", (p: ExportPayload) => typeof p?.meta?.exported_from === "string"],
  ["user.email_hash", (p: ExportPayload) => typeof p?.user?.email_hash === "string"],
  ["user.created_at", (p: ExportPayload) => typeof p?.user?.created_at === "number"],
  ["pet.base.name", (p: ExportPayload) => typeof p?.pet?.base?.name === "string" && p.pet.base.name.length > 0],
  ["pet.base.state", (p: ExportPayload) => typeof p?.pet?.base?.state === "string" && PET_STATES.has(p.pet.base.state)],
  ["pet.base.created_at", (p: ExportPayload) => typeof p?.pet?.base?.created_at === "number"],
  ["pet.memories", (p: ExportPayload) => Array.isArray(p?.pet?.memories)],
  ["pet.events", (p: ExportPayload) => Array.isArray(p?.pet?.events)],
  ["pet.inventory", (p: ExportPayload) => Array.isArray(p?.pet?.inventory)],
  ["pet.items_catalog", (p: ExportPayload) => Array.isArray(p?.pet?.items_catalog)],
  ["pet.pending_reply", (p: ExportPayload) => typeof p?.pet?.pending_reply === "object" && p.pet.pending_reply !== null],
  ["settings.active_pack_name", (p: ExportPayload) => typeof p?.settings?.active_pack_name === "string"],
  ["settings.timezone", (p: ExportPayload) => typeof p?.settings?.timezone === "string"],
  ["announcements_unread", (p: ExportPayload) => Array.isArray(p?.announcements_unread)],
] as const;

/** 步骤 3：必填字段清单校验 */
export function validateFields(payload: ExportPayload) {
  for (const [path, check] of REQUIRED) {
    if (!check(payload)) {
      return { ok: false as const, error: fieldMissingError(path) };
    }
  }
  return { ok: true as const };
}

/** 一键校验（version → checksum → fields，顺序对齐 §4.3） */
export function validateImportPayload(
  payload: ExportPayload
): { ok: true } | { ok: false; error: ImportErrorInfo } {
  const v = validateVersion(payload);
  if (!v.ok) return v;
  const c = validateChecksum(payload);
  if (!c.ok) return c;
  const f = validateFields(payload);
  if (!f.ok) return f;
  return { ok: true };
}

/** 没有任何 pet.base 时的专门错误（演示/API 语义更清晰） */
export function hasPetData(payload: ExportPayload): boolean {
  return Boolean(payload?.pet?.base);
}

// ============================================================
// 事务写库层（由 API 层在 withTransaction 内调用）
// ============================================================

export interface ImportContext {
  userId: string;
  /** 目标中心 hub_id（强制改写） */
  hubId: string;
  /** 目标 schema 版本（强制改写） */
  schemaVersion: string;
  now?: number;
}

/** 事务内执行导入（调用方已开启事务；本函数抛错即触发整体 rollback） */
export async function importPayloadInTx(
  conn: PoolConnection,
  payload: ExportPayload,
  ctx: ImportContext
): Promise<ImportSummary> {
  const now = ctx.now ?? Date.now();
  const env = getEnv();
  const hubId = ctx.hubId ?? env.HUB_ID;
  const schemaVersion = ctx.schemaVersion ?? EXPORT_SCHEMA_VERSION;

  // 0) 目标用户必须存在（导入是「登录用户的数据恢复」，不新建账号）
  const userRow = await connQueryOne<{ id: string }>(
    conn,
    "SELECT id FROM users WHERE id = ?",
    [ctx.userId]
  );
  if (!userRow) {
    throw new Error("目标账号不存在，无法导入");
  }

  // 1) 清空该用户当前业务数据（先子后父，避免残留引用）
  await connExecute(conn, "DELETE FROM user_announcement_reads WHERE user_id = ?", [ctx.userId]);
  await connExecute(conn, "DELETE FROM inventory WHERE user_id = ?", [ctx.userId]);
  await connExecute(conn, "DELETE FROM events WHERE user_id = ?", [ctx.userId]);
  await connExecute(conn, "DELETE FROM user_settings WHERE user_id = ?", [ctx.userId]);
  const petIds = await connQueryOne<{ ids: string }>(
    conn,
    `SELECT GROUP_CONCAT(id) AS ids FROM pets WHERE user_id = ?`,
    [ctx.userId]
  );
  if (petIds?.ids) {
    const ids = petIds.ids.split(",");
    for (const pid of ids) {
      await connExecute(conn, "DELETE FROM memories WHERE pet_id = ?", [pid]);
    }
  }
  await connExecute(conn, "DELETE FROM pets WHERE user_id = ?", [ctx.userId]);

  // 2) 物品目录快照：INSERT IGNORE（不覆盖既有目录）
  let itemsInserted = 0;
  for (const it of payload.pet.items_catalog) {
    const inserted = await insertItemIgnore(
      {
        id: it.id,
        displayName: it.display_name,
        description: it.description,
        iconPath: it.icon_path,
        rarityWeight: it.rarity_weight,
        category: it.category,
        schemaVersion,
        hubId,
      },
      conn
    );
    if (inserted) itemsInserted += 1;
  }

  // 3) pet 基础行（恢复原始时间戳；hub_id/schema_version 强制改写）
  const base = payload.pet.base;
  const activePack = payload.settings.active_pack_name || base.active_pack_name || env.DEFAULT_PACK;
  await connExecute(
    conn,
    `INSERT INTO pets
      (id, user_id, name, state, state_since, created_at, updated_at,
       last_activity_ts, user_last_active_ts, next_proactive_ts,
       daily_grant_last_date, offer_last_date,
       reply_pending, reply_due_at, last_reply_at,
       active_pack_name, wallet_ref, schema_version, hub_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      base.id,
      ctx.userId,
      base.name,
      base.state,
      base.state_since ?? base.created_at,
      base.created_at,
      now,
      base.last_activity_ts ?? base.created_at,
      base.user_last_active_ts ?? base.created_at,
      base.next_proactive_ts ?? null,
      base.daily_grant_last_date ?? null,
      base.offer_last_date ?? null,
      base.reply_pending ? 1 : 0,
      base.reply_due_at ?? null,
      base.last_reply_at ?? null,
      activePack,
      schemaVersion,
      hubId,
    ]
  );

  // 4) 记忆
  for (const m of payload.pet.memories) {
    const memory: Memory = {
      id: m.id,
      petId: base.id,
      kind: m.kind as MemoryKind,
      value: m.value,
      createdAt: m.created_at,
      lastReferenced: m.last_referenced,
      weight: m.weight,
      isPermanent: Boolean(m.is_permanent),
      schemaVersion,
      hubId,
    };
    await insertMemory(
      {
        id: memory.id,
        petId: memory.petId,
        kind: memory.kind,
        value: memory.value,
        lastReferenced: memory.lastReferenced,
        weight: memory.weight,
        isPermanent: memory.isPermanent,
        schemaVersion: memory.schemaVersion,
        hubId: memory.hubId,
        createdAt: memory.createdAt,
      },
      conn
    );
  }

  // 5) 事件时间线（结构 + 引用；不渲染文案）
  for (const e of payload.pet.events) {
    const event: Event = {
      id: e.id,
      petId: e.pet_id,
      userId: ctx.userId,
      type: e.type as Event["type"],
      ts: e.ts,
      fsmState: e.fsm_state,
      params: e.params ?? {},
      engineVersion: e.engine_version,
      packSchemaVersion: e.pack_schema_version,
      source: e.source as EventSource,
      memoryRefs: (e.memory_refs ?? []).map((r) => ({
        kind: r.kind as MemoryRefKind,
        value: r.value,
        weight: r.weight,
        ...(r.source_event_id ? { sourceEventId: r.source_event_id } : {}),
      })),
      isAggregate: Boolean(e.is_aggregate),
      aggregateSpanDays: e.aggregate_span_days ?? null,
      generatedByCatchup: Boolean(e.generated_by_catchup),
      schemaVersion,
      hubId,
      createdAt: e.created_at ?? e.ts,
    };
    await insertEvent(event, conn);
  }

  // 6) 物品栏
  for (const inv of payload.pet.inventory) {
    const inventory: Inventory = {
      id: inv.id,
      userId: ctx.userId,
      petId: base.id,
      itemId: inv.item_id,
      acquiredAt: inv.acquired_at,
      acquiredVia: inv.acquired_via as Inventory["acquiredVia"],
      grantedEventId: inv.granted_event_id,
      offeredAt: inv.offered_at,
      offeredEventId: inv.offered_event_id,
      consumedAt: inv.consumed_at,
      consumedEventId: inv.consumed_event_id,
      purchasedAt: null,
      paidCents: null,
      schemaVersion,
      hubId,
    };
    await insertInventory(
      {
        id: inventory.id,
        userId: inventory.userId,
        petId: inventory.petId,
        itemId: inventory.itemId,
        acquiredVia: inventory.acquiredVia,
        grantedEventId: inventory.grantedEventId,
        offeredAt: inventory.offeredAt,
        offeredEventId: inventory.offeredEventId,
        consumedAt: inventory.consumedAt,
        consumedEventId: inventory.consumedEventId,
        purchasedAt: inventory.purchasedAt,
        paidCents: inventory.paidCents,
        schemaVersion: inventory.schemaVersion,
        hubId: inventory.hubId,
        acquiredAt: inventory.acquiredAt,
      },
      conn
    );
  }

  // 7) 未读公告快照：INSERT IGNORE（存在即保留中心既有内容；不写已读行 → 导入后仍未读）
  let announcementsInserted = 0;
  for (const a of payload.announcements_unread) {
    const r = await connExecute(
      conn,
      `INSERT IGNORE INTO announcements
        (id, title, body, level, published_at, author_hub_id, signature, expires_at,
         schema_version, hub_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        a.id,
        a.title,
        a.body,
        a.level,
        a.published_at,
        hubId,
        a.expires_at ?? null,
        schemaVersion,
        hubId,
      ]
    );
    if (r.affectedRows > 0) announcementsInserted += 1;
  }

  // 8) 用户偏好 upsert
  await connExecute(
    conn,
    `INSERT INTO user_settings
       (user_id, active_pack_name, timezone, muted_notifications, updated_at, schema_version, hub_id)
     VALUES (?, ?, ?, 0, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       active_pack_name = VALUES(active_pack_name),
       timezone = VALUES(timezone),
       updated_at = VALUES(updated_at)`,
    [ctx.userId, activePack, payload.settings.timezone || "Asia/Shanghai", now, schemaVersion, hubId]
  );

  // 9) 用户元数据：备份 hash = 本次导入文件的校验和（申诉自证）；记录来源中心
  const checksumHex = extractChecksumHex(payload.meta.checksum) ?? "";
  await connExecute(
    conn,
    "UPDATE users SET last_backup_hash = ?, imported_from_hub = ?, imported_at = ?, updated_at = ? WHERE id = ?",
    [checksumHex, payload.meta.exported_from || null, now, now, ctx.userId]
  );

  return {
    petId: base.id,
    petName: base.name,
    memories: payload.pet.memories.length,
    events: payload.pet.events.length,
    inventory: payload.pet.inventory.length,
    items_catalog: itemsInserted,
    announcements: announcementsInserted,
  };
}

/** 便捷：判断 payload 是否有可导入的 pet 数据（用于 ERR_NO_PET 语义） */
export function normalizePetState(raw: unknown): PetState {
  return raw === "at_home" || raw === "out_walking" || raw === "on_trip" ? raw : "at_home";
}