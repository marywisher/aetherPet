/**
 * 文件名称：events.repo.ts
 * 功能描述：events 表 CRUD
 * 所属模块：domain/persistence/repos
 * 说明：
 *   - 时间线主查询：SELECT * FROM events WHERE pet_id = ? ORDER BY ts DESC
 *   - params_json / memory_refs_json 用 JSON.stringify 序列化
 */

import { getPool } from "../db";
import { query, queryOne, execute, connExecute } from "../sql";
import type { PoolConnection } from "mysql2/promise";
import type { Event } from "../../types";

interface EventRow {
  id: string;
  pet_id: string;
  user_id: string;
  type: string;
  ts: number;
  fsm_state: string;
  params_json: string | Record<string, unknown> | null;
  engine_version: string;
  pack_schema_version: string;
  source: string;
  memory_refs_json: string | Array<{ kind: string; value: string; weight: number; source_event_id?: string }> | null;
  is_aggregate: number; // TINYINT(1)
  aggregate_span_days: number | null;
  generated_by_catchup: number; // TINYINT(1)
  schema_version: string;
  hub_id: string;
  created_at: number;
}

function rowToEvent(row: EventRow): Event {
  const params = parseJsonField(row.params_json);
  const memoryRefs = parseRefArray(row.memory_refs_json);
  return {
    id: row.id,
    petId: row.pet_id,
    userId: row.user_id,
    type: row.type as Event["type"],
    ts: Number(row.ts),
    fsmState: row.fsm_state as Event["fsmState"],
    params,
    memoryRefs: memoryRefs as Event["memoryRefs"],
    source: row.source as Event["source"],
    engineVersion: row.engine_version,
    packSchemaVersion: row.pack_schema_version,
    isAggregate: row.is_aggregate === 1,
    aggregateSpanDays: row.aggregate_span_days ? Number(row.aggregate_span_days) : null,
    generatedByCatchup: row.generated_by_catchup === 1,
    schemaVersion: row.schema_version,
    hubId: row.hub_id,
    createdAt: Number(row.created_at),
  };
}

function parseJsonField(
  raw: string | Record<string, unknown> | unknown | null
): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
}

function parseRefArray(
  raw: string | Array<{ kind: string; value: string; weight: number; source_event_id?: string }> | null
): Event["memoryRefs"] {
  if (raw === null || raw === undefined) return [];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Event["memoryRefs"]) : [];
    } catch {
      return [];
    }
  }
  return raw as Event["memoryRefs"];
}

export async function insert(event: Event, conn?: PoolConnection): Promise<void> {
  const sqlText = `INSERT INTO events
    (id, pet_id, user_id, type, ts, fsm_state, params_json,
     engine_version, pack_schema_version, source, memory_refs_json,
     is_aggregate, aggregate_span_days, generated_by_catchup,
     schema_version, hub_id, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    event.id,
    event.petId,
    event.userId,
    event.type,
    event.ts,
    event.fsmState,
    JSON.stringify(event.params ?? {}),
    event.engineVersion,
    event.packSchemaVersion,
    event.source,
    JSON.stringify(event.memoryRefs ?? []),
    event.isAggregate ? 1 : 0,
    event.aggregateSpanDays ?? null,
    event.generatedByCatchup ? 1 : 0,
    event.schemaVersion,
    event.hubId,
    event.createdAt,
  ];
  if (conn) {
    await connExecute(conn, sqlText, params);
  } else {
    await execute(getPool(), sqlText, params);
  }
}

export async function insertMany(events: Event[], conn?: PoolConnection): Promise<void> {
  for (const e of events) {
    await insert(e, conn);
  }
}

export async function findById(id: string): Promise<Event | null> {
  const pool = getPool();
  const row = await queryOne<EventRow>(pool, "SELECT * FROM events WHERE id = ?", [id]);
  return row ? rowToEvent(row) : null;
}

/** 时间线主查询：单 pet 事件按 ts 倒序 */
export async function findByPetId(
  petId: string,
  limit = 20,
  offset = 0
): Promise<Event[]> {
  const pool = getPool();
  const rows = await query<EventRow>(
    pool,
    "SELECT * FROM events WHERE pet_id = ? ORDER BY ts DESC LIMIT ? OFFSET ?",
    [petId, limit, offset]
  );
  return rows.map(rowToEvent);
}

export async function findByPetIdRange(
  petId: string,
  fromTs: number,
  toTs: number
): Promise<Event[]> {
  const pool = getPool();
  const rows = await query<EventRow>(
    pool,
    "SELECT * FROM events WHERE pet_id = ? AND ts >= ? AND ts < ? ORDER BY ts DESC",
    [petId, fromTs, toTs]
  );
  return rows.map(rowToEvent);
}

/** 按类型过滤（档案页储物罐、聚合摘要入口卡片） */
export async function findByPetAndType(
  petId: string,
  type: string,
  limit = 50
): Promise<Event[]> {
  const pool = getPool();
  const rows = await query<EventRow>(
    pool,
    "SELECT * FROM events WHERE pet_id = ? AND type = ? ORDER BY ts DESC LIMIT ?",
    [petId, type, limit]
  );
  return rows.map(rowToEvent);
}

/** 只查聚合摘要事件（渐进披露入口卡片） */
export async function findLatestAggregate(petId: string): Promise<Event | null> {
  const pool = getPool();
  const row = await queryOne<EventRow>(
    pool,
    "SELECT * FROM events WHERE pet_id = ? AND is_aggregate = 1 ORDER BY ts DESC LIMIT 1",
    [petId]
  );
  return row ? rowToEvent(row) : null;
}

/** 便捷：事务内批量插入（补算 executor 用） */
export async function insertInTransaction(events: Event[], conn: PoolConnection): Promise<void> {
  for (const e of events) {
    await insert(e, conn);
  }
}
