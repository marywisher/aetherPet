/**
 * 文件名称：items.repo.ts
 * 功能描述：items 表 CRUD（全局物品目录）
 * 所属模块：domain/persistence/repos
 * 说明：
 *   - items 表是全局目录，不由用户拥有
 *   - 阶段 4 通过 002_seed_items.sql 插入 ≥8 条 seed 数据
 *   - findBySlugs 用于把 event.params.item_id 反查 display_name（回信/送赠时注入 {item}）
 */

import { getPool } from "../db";
import { query, queryOne, connQuery, connExecute, execute } from "../sql";
import type { PoolConnection } from "mysql2/promise";
import type { Item } from "../../types";

interface ItemRow {
  id: string;
  display_name: string;
  description: string | null;
  icon_path: string;
  rarity_weight: number | string;
  category: string | null;
  base_price_cents: number | null;
  currency_code: string | null;
  schema_version: string;
  hub_id: string;
}

function rowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    displayName: row.display_name,
    description: row.description,
    iconPath: row.icon_path,
    rarityWeight:
      typeof row.rarity_weight === "string"
        ? parseFloat(row.rarity_weight)
        : Number(row.rarity_weight),
    category: row.category,
    basePriceCents: row.base_price_cents,
    currencyCode: row.currency_code,
    schemaVersion: row.schema_version,
    hubId: row.hub_id,
  };
}

export async function findById(id: string): Promise<Item | null> {
  const pool = getPool();
  const row = await queryOne<ItemRow>(pool, "SELECT * FROM items WHERE id = ?", [id]);
  return row ? rowToItem(row) : null;
}

export async function findBySlugs(
  slugs: readonly string[],
  conn?: PoolConnection
): Promise<Map<string, Item>> {
  if (slugs.length === 0) return new Map();
  const placeholders = slugs.map(() => "?").join(",");
  const sqlText = `SELECT * FROM items WHERE id IN (${placeholders})`;
  let rows: ItemRow[];
  if (conn) {
    rows = await connQuery<ItemRow>(conn, sqlText, [...slugs]);
  } else {
    rows = await query<ItemRow>(getPool(), sqlText, [...slugs]);
  }
  const map = new Map<string, Item>();
  for (const r of rows) map.set(r.id, rowToItem(r));
  return map;
}

/** 列出所有 items（供前端 / API 调试用） */
export async function findAll(): Promise<Item[]> {
  const pool = getPool();
  const rows = await query<ItemRow>(
    pool,
    "SELECT * FROM items ORDER BY id ASC"
  );
  return rows.map(rowToItem);
}

/**
 * 导入用：INSERT IGNORE 写入一条 item 目录（同 id 已存在则跳过，不覆盖中心既有目录）。
 * 返回 true 表示新插入，false 表示已存在被忽略。
 */
export async function insertIgnore(
  data: Pick<
    Item,
    "id" | "displayName" | "description" | "iconPath" | "rarityWeight" | "category" | "schemaVersion" | "hubId"
  >,
  conn?: PoolConnection
): Promise<boolean> {
  const sqlText = `INSERT IGNORE INTO items
    (id, display_name, description, icon_path, rarity_weight, category,
     base_price_cents, currency_code, schema_version, hub_id)
   VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`;
  const params = [
    data.id,
    data.displayName,
    data.description,
    data.iconPath,
    data.rarityWeight,
    data.category,
    data.schemaVersion,
    data.hubId,
  ];
  if (conn) {
    const r = await connExecute(conn, sqlText, params);
    return r.affectedRows > 0;
  }
  const r = await execute(getPool(), sqlText, params);
  return r.affectedRows > 0;
}
