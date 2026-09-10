/**
 * 文件名称：meta.repo.ts
 * 功能描述：meta 表 CRUD（中心元信息：hub_id、schema_version、engine_version 等）
 * 所属模块：domain/persistence/repos
 */

import { getPool } from "../db";
import { queryOne, query, execute } from "../sql";

export interface MetaRow {
  key: string;
  value: string;
  updated_at: number;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const pool = getPool();
  await execute(
    pool,
    `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
    [key, value, Date.now()]
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const pool = getPool();
  const row = await queryOne<MetaRow>(pool, "SELECT value FROM meta WHERE key = ?", [key]);
  return row ? row.value : null;
}

export async function setManyMeta(pairs: Record<string, string>): Promise<void> {
  const pool = getPool();
  const now = Date.now();
  const keys = Object.keys(pairs);
  if (keys.length === 0) return;
  const values = keys.map((k) => pairs[k]);
  const placeholders = keys.map(() => "(?, ?, ?)").join(", ");
  const params = keys.flatMap((k, i) => [k, values[i], now]);
  await execute(
    pool,
    `INSERT INTO meta (key, value, updated_at) VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
    params
  );
}

export async function getAllMeta(): Promise<Record<string, string>> {
  const pool = getPool();
  const rows = await query<MetaRow>(pool, "SELECT key, value FROM meta");
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}
