/**
 * 文件名称：memories.repo.ts
 * 功能描述：memories 表 CRUD
 * 所属模块：domain/persistence/repos
 * 说明：
 *   - 记忆是引擎/用户输入的结构化事实，非文案
 *   - 加权随机抽取由 domain/memory 负责；本 repo 只做存取
 */

import { getPool } from "../db";
import { query, queryOne, execute, connExecute, connQuery } from "../sql";
import type { PoolConnection } from "mysql2/promise";
import type { Memory, MemoryKind } from "../../types";

interface MemoryRow {
  id: string;
  pet_id: string;
  kind: MemoryKind;
  value: string;
  created_at: number;
  last_referenced: number | null;
  weight: number | string; // DECIMAL 可能被 mysql2 返回为 string
  is_permanent: number;
  schema_version: string;
  hub_id: string;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    petId: row.pet_id,
    kind: row.kind,
    value: row.value,
    createdAt: Number(row.created_at),
    lastReferenced: row.last_referenced ? Number(row.last_referenced) : null,
    weight: typeof row.weight === "string" ? parseFloat(row.weight) : Number(row.weight),
    isPermanent: row.is_permanent === 1,
    schemaVersion: row.schema_version,
    hubId: row.hub_id,
  };
}

export async function insert(
  data: Omit<Memory, "id" | "createdAt"> & { id: string },
  conn?: PoolConnection
): Promise<Memory> {
  const now = Date.now();
  const sqlText = `INSERT INTO memories
    (id, pet_id, kind, value, created_at, last_referenced, weight, is_permanent, schema_version, hub_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    data.id,
    data.petId,
    data.kind,
    data.value,
    now,
    data.lastReferenced ?? null,
    data.weight ?? 1.0,
    data.isPermanent ? 1 : 0,
    data.schemaVersion,
    data.hubId,
  ];
  if (conn) {
    await connExecute(conn, sqlText, params);
  } else {
    await execute(getPool(), sqlText, params);
  }
  return { ...data, createdAt: now };
}

export async function findById(id: string): Promise<Memory | null> {
  const pool = getPool();
  const row = await queryOne<MemoryRow>(pool, "SELECT * FROM memories WHERE id = ?", [id]);
  return row ? rowToMemory(row) : null;
}

/** 检索某 pet 的所有记忆（按 kind 分组，供 recall-strategy 消费） */
export async function findByPetId(petId: string, conn?: PoolConnection): Promise<Memory[]> {
  if (conn) {
    const rows = await connQuery<MemoryRow>(conn, "SELECT * FROM memories WHERE pet_id = ?", [petId]);
    return rows.map(rowToMemory);
  }
  const pool = getPool();
  const rows = await query<MemoryRow>(pool, "SELECT * FROM memories WHERE pet_id = ?", [petId]);
  return rows.map(rowToMemory);
}

export async function findByPetAndKind(
  petId: string,
  kind: MemoryKind
): Promise<Memory[]> {
  const pool = getPool();
  const rows = await query<MemoryRow>(
    pool,
    "SELECT * FROM memories WHERE pet_id = ? AND kind = ? ORDER BY created_at DESC",
    [petId, kind]
  );
  return rows.map(rowToMemory);
}

/** 更新记忆的最近引用时间（recall 命中后调用） */
export async function touchReferenced(
  memoryIds: string[],
  ts: number = Date.now()
): Promise<void> {
  if (memoryIds.length === 0) return;
  const pool = getPool();
  const placeholders = memoryIds.map(() => "?").join(",");
  await execute(
    pool,
    `UPDATE memories SET last_referenced = ? WHERE id IN (${placeholders})`,
    [ts, ...memoryIds]
  );
}
