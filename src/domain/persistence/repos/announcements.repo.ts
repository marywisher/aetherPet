/**
 * 文件名称：announcements.repo.ts
 * 功能描述：announcements 表 CRUD（阶段 5）
 * 所属模块：domain/persistence/repos
 * 说明：
 *   - 服务中心公告表；MVP 仅支持本中心本地发布
 *   - 排序约定：published_at DESC（倒序）
 *   - 事件结构不含文案：body/title 存在 announcements 表，不写入 events
 */

import { getPool } from "../db";
import { query, queryOne, execute, connQuery, connQueryOne, connExecute } from "../sql";
import type { PoolConnection } from "mysql2/promise";
import type { Announcement, AnnouncementLevel } from "../../announce/types";

interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  level: string;
  published_at: number;
  author_hub_id: string;
  signature: string | null;
  expires_at: number | null;
  schema_version: string;
  hub_id: string;
}

function rowToAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    level: row.level as AnnouncementLevel,
    publishedAt: Number(row.published_at),
    authorHubId: row.author_hub_id,
    signature: row.signature,
    expiresAt: row.expires_at ? Number(row.expires_at) : null,
    schemaVersion: row.schema_version,
    hubId: row.hub_id,
  };
}

/**
 * 插入一条公告（管理员发布）。
 *
 * 事务支持：conn 参数（供未来事务包装器使用；MVP 直接插入）。
 */
export async function insert(
  data: Omit<Announcement, "publishedAt" | "schemaVersion" | "hubId"> & {
    publishedAt: number;
    schemaVersion: string;
    hubId: string;
  },
  conn?: PoolConnection
): Promise<Announcement> {
  const sqlText = `INSERT INTO announcements
    (id, title, body, level, published_at, author_hub_id, signature, expires_at,
     schema_version, hub_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    data.id,
    data.title,
    data.body,
    data.level,
    data.publishedAt,
    data.authorHubId,
    data.signature,
    data.expiresAt,
    data.schemaVersion,
    data.hubId,
  ];
  if (conn) {
    await connExecute(conn, sqlText, params);
  } else {
    await execute(getPool(), sqlText, params);
  }
  return data;
}

/** 单条查询（按 id） */
export async function findById(
  id: string,
  conn?: PoolConnection
): Promise<Announcement | null> {
  const sqlText = "SELECT * FROM announcements WHERE id = ?";
  const row = conn
    ? await connQueryOne<AnnouncementRow>(conn, sqlText, [id])
    : await queryOne<AnnouncementRow>(getPool(), sqlText, [id]);
  return row ? rowToAnnouncement(row) : null;
}

/**
 * 倒序列出公告（按 published_at DESC）。
 *
 * - limit：返回条数上限（默认 100）
 * - sinceTs：仅返回 published_at >= sinceTs 的公告（用于增量拉取；null 表示全部）
 */
export async function findPublishedSince(
  sinceTs: number | null,
  limit = 100,
  conn?: PoolConnection
): Promise<Announcement[]> {
  const sqlText = sinceTs === null
    ? "SELECT * FROM announcements ORDER BY published_at DESC LIMIT ?"
    : "SELECT * FROM announcements WHERE published_at >= ? ORDER BY published_at DESC LIMIT ?";
  const params = sinceTs === null ? [limit] : [sinceTs, limit];
  const rows = conn
    ? await connQuery<AnnouncementRow>(conn, sqlText, params)
    : await query<AnnouncementRow>(getPool(), sqlText, params);
  return rows.map(rowToAnnouncement);
}

/** 全部公告（倒序；用于管理员列表 / 导出） */
export async function findAll(limit = 200, conn?: PoolConnection): Promise<Announcement[]> {
  return findPublishedSince(null, limit, conn);
}
