/**
 * 文件名称：sessions.repo.ts
 * 功能描述：sessions 表 CRUD
 * 所属模块：domain/persistence/repos
 */

import { getPool } from "../db";
import { queryOne, execute, connExecute } from "../sql";
import type { PoolConnection } from "mysql2/promise";
import type { Session } from "../../types";

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  issued_at: number;
  expires_at: number;
  last_seen_at: number;
  ip: string | null;
  user_agent: string | null;
  revoked_at: number | null;
  schema_version: string;
  hub_id: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    ip: row.ip,
    userAgent: row.user_agent,
    revokedAt: row.revoked_at,
    schemaVersion: row.schema_version,
    hubId: row.hub_id,
  };
}

export async function insert(
  data: Omit<Session, "id" | "lastSeenAt" | "revokedAt"> & { id: string },
  conn?: PoolConnection
): Promise<Session> {
  const now = Date.now();
  if (conn) {
    await connExecute(
      conn,
      `INSERT INTO sessions
      (id, user_id, token_hash, issued_at, expires_at, last_seen_at, ip, user_agent, schema_version, hub_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.id,
        data.userId,
        data.tokenHash,
        data.issuedAt,
        data.expiresAt,
        now,
        data.ip ?? null,
        data.userAgent ?? null,
        data.schemaVersion,
        data.hubId,
      ]
    );
  } else {
    await execute(
      getPool(),
      `INSERT INTO sessions
      (id, user_id, token_hash, issued_at, expires_at, last_seen_at, ip, user_agent, schema_version, hub_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.id,
        data.userId,
        data.tokenHash,
        data.issuedAt,
        data.expiresAt,
        now,
        data.ip ?? null,
        data.userAgent ?? null,
        data.schemaVersion,
        data.hubId,
      ]
    );
  }
  return { ...data, lastSeenAt: now, revokedAt: null };
}

export async function findByTokenHash(tokenHash: string): Promise<Session | null> {
  const pool = getPool();
  const now = Date.now();
  const row = await queryOne<SessionRow>(
    pool,
    `SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
    [tokenHash, now]
  );
  return row ? rowToSession(row) : null;
}

export async function revoke(tokenHash: string): Promise<void> {
  const pool = getPool();
  await execute(
    pool,
    "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
    [Date.now(), tokenHash]
  );
}

export async function touch(tokenHash: string): Promise<void> {
  const pool = getPool();
  await execute(
    pool,
    "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
    [Date.now(), tokenHash]
  );
}
