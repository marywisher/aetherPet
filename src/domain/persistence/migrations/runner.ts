/**
 * 文件名称：runner.ts
 * 功能描述：Migration 执行器
 * 所属模块：domain/persistence/migrations
 * 说明：
 *   - 按文件名升序执行 .sql 文件
 *   - 每个 migration 应用后写入 migrations 表（版本 + 时间 + SHA256 checksum）
 *   - MySQL DDL 不支持事务回滚；一个 migration 尽量只做一组关联 DDL
 *   - 磁盘文件比 DB 新 → 依次应用；磁盘比 DB 旧 → 拒绝启动
 */

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { getPool } from "../db";
import { execute, query } from "../sql";

const MIGRATIONS_DIR = path.join(process.cwd(), "src/domain/persistence/migrations");

interface MigrationMeta {
  version: string;
  file: string;
  checksum: string;
}

/** 扫描 migrations 目录，返回按顺序排列的 migration 元信息 */
export async function listMigrations(): Promise<MigrationMeta[]> {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort();
  const result: MigrationMeta[] = [];
  for (const name of sqlFiles) {
    const filePath = path.join(MIGRATIONS_DIR, name);
    const content = await fs.readFile(filePath, "utf-8");
    const checksum = crypto.createHash("sha256").update(content).digest("hex");
    const version = name.replace(/\.sql$/, "");
    result.push({ version, file: filePath, checksum });
  }
  return result;
}

/** 查询已应用的 migrations */
async function getAppliedMigrations(): Promise<{ version: string; checksum: string }[]> {
  const pool = getPool();
  try {
    const rows = await query<{ version: string; checksum: string }>(
      pool,
      "SELECT version, checksum FROM migrations ORDER BY id ASC"
    );
    return rows;
  } catch (err) {
    // 表可能还没建（首次启动）
    const code = (err as { code?: string })?.code;
    if (code === "ER_NO_SUCH_TABLE" || code === "42S02") {
      return [];
    }
    throw err;
  }
}

interface ApplyResult {
  applied: string[];
  skipped: string[];
}

/**
 * 执行所有未应用的 migration
 * 返回值：本批次应用了哪些、跳过（已应用）了哪些
 */
export async function runMigrations(): Promise<ApplyResult> {
  const pool = getPool();
  const migrations = await listMigrations();
  const applied = await getAppliedMigrations();
  const appliedMap = new Map(applied.map((m) => [m.version, m.checksum]));

  const result: ApplyResult = { applied: [], skipped: [] };

  for (const mig of migrations) {
    if (appliedMap.has(mig.version)) {
      // 校验 checksum：磁盘版本变化了 → 报错
      if (appliedMap.get(mig.version) !== mig.checksum) {
        throw new Error(
          `[migration] 磁盘文件与已应用版本不一致：${mig.version}`
        );
      }
      result.skipped.push(mig.version);
      continue;
    }

    const sqlText = await fs.readFile(mig.file, "utf-8");
    // 多语句迁移必须用 pool.query()（COM_QUERY），而不是 pool.execute()（COM_STMT_PREPARE）。
    // mysql2 的 execute 走 prepared statement，即使 multipleStatements=true 也不会拆分语句。
    // pool 已在 db.ts 里配 multipleStatements: true，才能一次发多条 DDL。
    // 注意：DDL 不事务，失败时可能残留半成品；migration 脚本应尽量只做一组关联 DDL。
    await pool.query(sqlText);

    await execute(
      pool,
      "INSERT INTO migrations (version, applied_at, checksum) VALUES (?, ?, ?)",
      [mig.version, Date.now(), mig.checksum]
    );

    result.applied.push(mig.version);
  }

  return result;
}

/** 供脚本 / 启动 hook 调用；失败即抛错 */
export async function ensureMigrations(): Promise<ApplyResult> {
  const result = await runMigrations();
  if (result.applied.length > 0) {
    console.log(`[migration] 已应用 ${result.applied.length} 个：${result.applied.join(", ")}`);
  } else {
    console.log("[migration] 无待应用 migration");
  }
  return result;
}
