/**
 * 文件名称：inventory.repo.ts
 * 功能描述：inventory 表 CRUD（用户物品栏）
 * 所属模块：domain/persistence/repos
 * 说明：
 *   - 每条记录 = 用户拥有一件物品的实例（daily_grant / brought_back / import）
 *   - offered_at 非空 = 已送出（进储物罐）
 *   - 支持事务内写（conn 参数）
 */

import { getPool } from "../db";
import { query, queryOne, execute, connQuery, connQueryOne, connExecute } from "../sql";
import type { PoolConnection } from "mysql2/promise";
import type { Inventory, InventoryAcquiredVia } from "../../types";

interface InventoryRow {
  id: string;
  user_id: string;
  pet_id: string;
  item_id: string;
  acquired_at: number;
  acquired_via: InventoryAcquiredVia;
  granted_event_id: string | null;
  offered_at: number | null;
  offered_event_id: string | null;
  consumed_at: number | null;
  consumed_event_id: string | null;
  purchased_at: number | null;
  paid_cents: number | null;
  schema_version: string;
  hub_id: string;
}

function rowToInventory(row: InventoryRow): Inventory {
  return {
    id: row.id,
    userId: row.user_id,
    petId: row.pet_id,
    itemId: row.item_id,
    acquiredAt: Number(row.acquired_at),
    acquiredVia: row.acquired_via,
    grantedEventId: row.granted_event_id,
    offeredAt: row.offered_at ? Number(row.offered_at) : null,
    offeredEventId: row.offered_event_id,
    consumedAt: row.consumed_at ? Number(row.consumed_at) : null,
    consumedEventId: row.consumed_event_id,
    purchasedAt: row.purchased_at ? Number(row.purchased_at) : null,
    paidCents: row.paid_cents,
    schemaVersion: row.schema_version,
    hubId: row.hub_id,
  };
}

export async function insert(
  data: Omit<Inventory, "id" | "acquiredAt" | "schemaVersion" | "hubId"> & { id: string; schemaVersion: string; hubId: string },
  conn?: PoolConnection
): Promise<Inventory> {
  const now = Date.now();
  const sqlText = `INSERT INTO inventory
    (id, user_id, pet_id, item_id, acquired_at, acquired_via,
     granted_event_id, offered_at, offered_event_id,
     consumed_at, consumed_event_id, purchased_at, paid_cents,
     schema_version, hub_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    data.id,
    data.userId,
    data.petId,
    data.itemId,
    now,
    data.acquiredVia,
    data.grantedEventId ?? null,
    data.offeredAt ?? null,
    data.offeredEventId ?? null,
    data.consumedAt ?? null,
    data.consumedEventId ?? null,
    data.purchasedAt ?? null,
    data.paidCents ?? null,
    data.schemaVersion,
    data.hubId,
  ];
  if (conn) {
    await connExecute(conn, sqlText, params);
  } else {
    await execute(getPool(), sqlText, params);
  }
  return { ...data, acquiredAt: now };
}

export async function findById(
  id: string,
  conn?: PoolConnection
): Promise<Inventory | null> {
  const sqlText = "SELECT * FROM inventory WHERE id = ?";
  const row = conn
    ? await connQueryOne<InventoryRow>(conn, sqlText, [id])
    : await queryOne<InventoryRow>(getPool(), sqlText, [id]);
  return row ? rowToInventory(row) : null;
}

/**
 * 用户未送出的物品栏（供 /api/inventory 与送赠 UI 使用）。
 *
 * 排序：按 acquired_at 倒序（最新获得的最显眼）。
 */
export async function findUnofferedByUser(
  userId: string,
  petId: string,
  limit = 100,
  conn?: PoolConnection
): Promise<Inventory[]> {
  const sqlText =
    "SELECT * FROM inventory WHERE user_id = ? AND pet_id = ? AND offered_at IS NULL ORDER BY acquired_at DESC LIMIT ?";
  const rows = conn
    ? await connQuery<InventoryRow>(conn, sqlText, [userId, petId, limit])
    : await query<InventoryRow>(getPool(), sqlText, [userId, petId, limit]);
  return rows.map(rowToInventory);
}

/** 储物罐：已送出的物品 */
export async function findOfferedByPet(
  petId: string,
  limit = 100
): Promise<Inventory[]> {
  const pool = getPool();
  const rows = await query<InventoryRow>(
    pool,
    "SELECT * FROM inventory WHERE pet_id = ? AND offered_at IS NOT NULL ORDER BY offered_at DESC LIMIT ?",
    [petId, limit]
  );
  return rows.map(rowToInventory);
}

/** 全部物品（含已送；档案页/导出用） */
export async function findAllByUser(
  userId: string,
  limit = 500
): Promise<Inventory[]> {
  const pool = getPool();
  const rows = await query<InventoryRow>(
    pool,
    "SELECT * FROM inventory WHERE user_id = ? ORDER BY acquired_at DESC LIMIT ?",
    [userId, limit]
  );
  return rows.map(rowToInventory);
}

/**
 * 事务内标记送赠：
 *   - offered_at = ts
 *   - offered_event_id = offerEventId
 *   - consumed_at = ts（送出即视为"消费"，与 events 时间线对齐）
 *
 * P1-003 / P2-005 修复：条件 WHERE 保证并发幂等——
 *   WHERE id = ? AND offered_at IS NULL
 * 返回 affectedRows；为 0 时调用方视为已被并发请求标记，rollback 并返回
 * inventory_already_offered。
 */
export async function markOfferedInTx(
  conn: PoolConnection,
  inventoryId: string,
  offerEventId: string,
  ts: number
): Promise<number> {
  const result = await connExecute(
    conn,
    `UPDATE inventory SET offered_at = ?, offered_event_id = ?, consumed_at = ?, consumed_event_id = ?
     WHERE id = ? AND offered_at IS NULL`,
    [ts, offerEventId, ts, offerEventId, inventoryId]
  );
  return result.affectedRows;
}

/** 事务内查询最近 N 次 daily_grant 的 item_id（供 item-pool 排除重复） */
export async function findRecentGrantItemIds(
  petId: string,
  limit: number,
  conn?: PoolConnection
): Promise<string[]> {
  const sqlText =
    "SELECT item_id FROM inventory WHERE pet_id = ? AND acquired_via = 'daily_grant' ORDER BY acquired_at DESC LIMIT ?";
  const rows = conn
    ? await connQuery<{ item_id: string }>(conn, sqlText, [petId, limit])
    : await query<{ item_id: string }>(getPool(), sqlText, [petId, limit]);
  return rows.map((r) => r.item_id);
}
