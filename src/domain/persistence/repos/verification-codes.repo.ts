/**
 * 文件名称：verification-codes.repo.ts
 * 功能描述：verification_codes 表 CRUD
 * 所属模块：domain/persistence/repos
 */

import { getPool } from "../db";
import { query, queryOne, execute, connExecute } from "../sql";
import type { PoolConnection } from "mysql2/promise";
import type { VerificationCode } from "../../types";

interface VCRow {
  id: string;
  user_id: string;
  email_hash: string;
  code_hash: string;
  issued_at: number;
  expires_at: number;
  used_at: number | null;
  ip: string | null;
  user_agent: string | null;
  schema_version: string;
  hub_id: string;
}

function rowToVC(row: VCRow): VerificationCode {
  return {
    id: row.id,
    userId: row.user_id,
    emailHash: row.email_hash,
    codeHash: row.code_hash,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    ip: row.ip,
    userAgent: row.user_agent,
    schemaVersion: row.schema_version,
    hubId: row.hub_id,
  };
}

export async function insert(data: Omit<VerificationCode, "usedAt" | "createdAt"> & { id: string }): Promise<VerificationCode> {
  const pool = getPool();
  await execute(
    pool,
    `INSERT INTO verification_codes
      (id, user_id, email_hash, code_hash, issued_at, expires_at, ip, user_agent, schema_version, hub_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.userId,
      data.emailHash,
      data.codeHash,
      data.issuedAt,
      data.expiresAt,
      data.ip ?? null,
      data.userAgent ?? null,
      data.schemaVersion,
      data.hubId,
    ]
  );
  return { ...data, usedAt: null };
}

/** 按 email_hash + code_hash 查找未使用且未过期的验证码 */
export async function findValidByCodeHash(
  emailHash: string,
  codeHash: string
): Promise<VerificationCode | null> {
  const pool = getPool();
  const now = Date.now();
  const row = await queryOne<VCRow>(
    pool,
    `SELECT * FROM verification_codes
     WHERE email_hash = ? AND code_hash = ? AND used_at IS NULL AND expires_at > ?
     ORDER BY issued_at DESC LIMIT 1`,
    [emailHash, codeHash, now]
  );
  return row ? rowToVC(row) : null;
}

/** 标记验证码已使用；传 conn 时走事务连接 */
export async function markUsed(id: string, conn?: PoolConnection): Promise<void> {
  if (conn) {
    await connExecute(
      conn,
      "UPDATE verification_codes SET used_at = ? WHERE id = ? AND used_at IS NULL",
      [Date.now(), id]
    );
    return;
  }
  const pool = getPool();
  await execute(
    pool,
    "UPDATE verification_codes SET used_at = ? WHERE id = ? AND used_at IS NULL",
    [Date.now(), id]
  );
}

/** 统计同 email_hash 在 [sinceTs, +∞) 内的发送次数（节流用） */
export async function countByEmailHashSince(emailHash: string, sinceTs: number): Promise<number> {
  const pool = getPool();
  const rows = await query<{ cnt: number }>(
    pool,
    "SELECT COUNT(*) AS cnt FROM verification_codes WHERE email_hash = ? AND issued_at >= ?",
    [emailHash, sinceTs]
  );
  return rows[0]?.cnt ?? 0;
}
