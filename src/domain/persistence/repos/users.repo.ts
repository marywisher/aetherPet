/**
 * 文件名称：users.repo.ts
 * 功能描述：users 表 CRUD
 * 所属模块：domain/persistence/repos
 */

import { getPool } from "../db";
import { query, queryOne, execute, connQueryOne, connExecute } from "../sql";
import type { PoolConnection } from "mysql2/promise";
import type { User } from "../../types";

interface UserRow {
  id: string;
  email_hash: string;
  email_plain_enc: string | null;
  email_verified_at: number | null;
  created_at: number;
  updated_at: number;
  last_backup_hash: string | null;
  imported_from_hub: string | null;
  imported_at: number | null;
  schema_version: string;
  hub_id: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    emailHash: row.email_hash,
    emailPlainEnc: row.email_plain_enc,
    emailVerifiedAt: row.email_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastBackupHash: row.last_backup_hash,
    importedFromHub: row.imported_from_hub,
    importedAt: row.imported_at,
    schemaVersion: row.schema_version,
    hubId: row.hub_id,
  };
}

export async function findById(id: string): Promise<User | null> {
  const pool = getPool();
  const row = await queryOne<UserRow>(pool, "SELECT * FROM users WHERE id = ?", [id]);
  return row ? rowToUser(row) : null;
}

export async function findByEmailHash(emailHash: string, conn?: PoolConnection): Promise<User | null> {
  if (conn) {
    const row = await connQueryOne<UserRow>(
      conn,
      "SELECT * FROM users WHERE email_hash = ?",
      [emailHash]
    );
    return row ? rowToUser(row) : null;
  }
  const pool = getPool();
  const row = await queryOne<UserRow>(
    pool,
    "SELECT * FROM users WHERE email_hash = ?",
    [emailHash]
  );
  return row ? rowToUser(row) : null;
}

export async function insert(
  data: Omit<User, "id" | "createdAt" | "updatedAt"> & { id: string },
  conn?: PoolConnection
): Promise<User> {
  const now = Date.now();
  const sqlText = `INSERT INTO users
      (id, email_hash, email_plain_enc, email_verified_at, created_at, updated_at,
       last_backup_hash, imported_from_hub, imported_at, schema_version, hub_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    data.id,
    data.emailHash,
    data.emailPlainEnc,
    data.emailVerifiedAt,
    now,
    now,
    data.lastBackupHash ?? null,
    data.importedFromHub ?? null,
    data.importedAt ?? null,
    data.schemaVersion,
    data.hubId,
  ];
  if (conn) {
    await connExecute(conn, sqlText, params);
  } else {
    await execute(getPool(), sqlText, params);
  }
  // 直接构造返回，避免事务内再发一次 SELECT
  return { ...data, createdAt: now, updatedAt: now };
}

export async function markEmailVerified(id: string, conn?: PoolConnection): Promise<void> {
  if (conn) {
    await connExecute(
      conn,
      "UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?",
      [Date.now(), Date.now(), id]
    );
    return;
  }
  const pool = getPool();
  await execute(
    pool,
    "UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?",
    [Date.now(), Date.now(), id]
  );
}

export async function updateLastBackupHash(id: string, hash: string): Promise<void> {
  const pool = getPool();
  await execute(
    pool,
    "UPDATE users SET last_backup_hash = ?, updated_at = ? WHERE id = ?",
    [hash, Date.now(), id]
  );
}
