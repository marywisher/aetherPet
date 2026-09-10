/**
 * 文件名称：user-announcement-reads.repo.ts
 * 功能描述：user_announcement_reads 表 CRUD（阶段 5）
 * 所属模块：domain/persistence/repos
 * 验收对齐：
 *   - docs/current-stage.md 阶段 5 关键交付（已读/未读、静音 N 条）
 *   - docs/pitfalls.md 阶段 4 教训 2：「限一次/去重/状态转换」必须由 DB 条件更新保证
 * 说明：
 *   - 主键 (user_id, announcement_id)，天然唯一
 *   - markReadInTx 使用 INSERT IGNORE + affectedRows 判定：
 *       - affectedRows=1 → 首次写入（"首次已读"）
 *       - affectedRows=0 → 行已存在（视为幂等成功，不覆盖首次 read_at）
 *     该语义与阶段 4 「日限一次」条件 UPDATE 一脉相承，避免覆盖已有静音记录
 *   - muteInTx 使用 INSERT ... ON DUPLICATE KEY UPDATE：
 *       - 已存在 → UPDATE muted_until_ts
 *       - 不存在 → INSERT 一条记录（read_at=now, muted_until_ts=目标时间）
 *     返回 affectedRows（调用方可观测是否发生实际变更；MVP 仅作为信息，不阻断）
 *   - 事务参数 conn 是必需的（业务侧通过 withTransaction 包裹）
 */

import { query, queryOne, execute, connQuery, connQueryOne, connExecute } from "../sql";
import type { PoolConnection } from "mysql2/promise";
import type { UserAnnouncementRead } from "../../announce/types";
import { getPool } from "../db";

interface ReadRow {
  user_id: string;
  announcement_id: string;
  read_at: number;
  muted_until_ts: number | null;
  schema_version: string;
  hub_id: string;
}

function rowToRead(row: ReadRow): UserAnnouncementRead {
  return {
    userId: row.user_id,
    announcementId: row.announcement_id,
    readAt: Number(row.read_at),
    mutedUntilTs: row.muted_until_ts ? Number(row.muted_until_ts) : null,
    schemaVersion: row.schema_version,
    hubId: row.hub_id,
  };
}

/**
 * 事务内：为 (user_id, announcement_id) 写入首次已读记录。
 *
 * 幂等语义（阶段 4 P1-003 教训）：
 *   - INSERT IGNORE 命中主键冲突 → 行已存在，返回 affectedRows=0
 *   - 首次写入 → 返回 affectedRows=1
 *
 * @returns affectedRows（1=首次；0=已存在，视为幂等成功）
 */
export async function markReadInTx(
  conn: PoolConnection,
  userId: string,
  announcementId: string,
  now: number,
  schemaVersion: string = "1.0.0",
  hubId: string = "local"
): Promise<number> {
  const result = await connExecute(
    conn,
    `INSERT IGNORE INTO user_announcement_reads
       (user_id, announcement_id, read_at, muted_until_ts, schema_version, hub_id)
     VALUES (?, ?, ?, NULL, ?, ?)`,
    [userId, announcementId, now, schemaVersion, hubId]
  );
  return result.affectedRows;
}

/**
 * 事务内：为 (user_id, announcement_id) 设置静音截止时间。
 *
 * 语义：
 *   - 若行不存在：INSERT 一条，read_at=now（用户点了"静音"即视为读过）
 *   - 若行已存在：UPDATE muted_until_ts=目标时间（不修改 read_at）
 *
 * 返回 affectedRows 便于观测：
 *   - 1 = INSERT 或 UPDATE 到不同值（CLIENT_FOUND_ROWS=false 语义）
 *   - 0 = UPDATE 到相同值（未变更）
 *
 * MVP 不阻断此值；调用方仅需知道写入成功（若失败则抛异常）。
 */
export async function muteInTx(
  conn: PoolConnection,
  userId: string,
  announcementId: string,
  now: number,
  mutedUntilTs: number,
  schemaVersion: string = "1.0.0",
  hubId: string = "local"
): Promise<number> {
  const result = await connExecute(
    conn,
    `INSERT INTO user_announcement_reads
       (user_id, announcement_id, read_at, muted_until_ts, schema_version, hub_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE muted_until_ts = VALUES(muted_until_ts)`,
    [userId, announcementId, now, mutedUntilTs, schemaVersion, hubId]
  );
  return result.affectedRows;
}

/** 事务内：解除静音（把 muted_until_ts 置回 null）。 */
export async function unmuteInTx(
  conn: PoolConnection,
  userId: string,
  announcementId: string
): Promise<number> {
  const result = await connExecute(
    conn,
    "UPDATE user_announcement_reads SET muted_until_ts = NULL WHERE user_id = ? AND announcement_id = ?",
    [userId, announcementId]
  );
  return result.affectedRows;
}

/** 读取用户的全部已读记录（无 conn 参数；供列表构建使用） */
export async function findByUser(
  userId: string,
  limit = 500
): Promise<UserAnnouncementRead[]> {
  const pool = getPool();
  const rows = await query<ReadRow>(
    pool,
    "SELECT * FROM user_announcement_reads WHERE user_id = ? ORDER BY read_at DESC LIMIT ?",
    [userId, limit]
  );
  return rows.map(rowToRead);
}

/** 事务内读取用户已读记录（供未来列表构建在事务内使用） */
export async function findByUserInTx(
  conn: PoolConnection,
  userId: string,
  limit = 500
): Promise<UserAnnouncementRead[]> {
  const rows = await connQuery<ReadRow>(
    conn,
    "SELECT * FROM user_announcement_reads WHERE user_id = ? ORDER BY read_at DESC LIMIT ?",
    [userId, limit]
  );
  return rows.map(rowToRead);
}

/** 单条查询（用户 + 公告） */
export async function findByUserAndAnnouncement(
  userId: string,
  announcementId: string,
  conn?: PoolConnection
): Promise<UserAnnouncementRead | null> {
  const sqlText =
    "SELECT * FROM user_announcement_reads WHERE user_id = ? AND announcement_id = ?";
  const row = conn
    ? await connQueryOne<ReadRow>(conn, sqlText, [userId, announcementId])
    : await queryOne<ReadRow>(getPool(), sqlText, [userId, announcementId]);
  return row ? rowToRead(row) : null;
}
