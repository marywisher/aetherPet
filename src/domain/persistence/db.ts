/**
 * 文件名称：db.ts
 * 功能描述：MySQL 连接池 + async 事务工具
 * 所属模块：domain/persistence
 * 说明：
 *   - 单例 pool：Next.js 是长驻进程，pool 只需创建一次
 *   - 事务统一模式：withTransaction(fn) 自动 commit/rollback/release
 *   - 所有时间戳统一 BIGINT UNSIGNED UTC 毫秒（应用层负责格式化）
 *   - 领域层可独立测试：mock pool 或 mock getConnection 即可
 */

import mysql from "mysql2/promise";
import type { Pool, PoolConnection } from "mysql2/promise";
import { getEnv } from "@/config/env";
import * as sql from "./sql";

let _pool: Pool | null = null;

/**
 * mysql2 在 Node.js 侧的严格模式通过 init SQL 设置（在连接建立后执行）
 * 由于 PoolOptions 不直接支持 sessionVariables，这里用 connectionAttributes
 * + 首次连接后手工 SET 全局变量。
 */

/** 获取连接池（惰性初始化） */
export function getPool(): Pool {
  if (_pool) return _pool;
  const env = getEnv();
  _pool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASS,
    database: env.DB_NAME,
    connectionLimit: env.DB_POOL_SIZE,
    waitForConnections: true,
    queueLimit: 0,
    // charset 语义上应为字符集（不是排序规则），排序规则由 DDL/compose 决定
    charset: "utf8mb4",
    decimalNumbers: false,
    // 允许 migration runner 用 pool.query() 一次执行多条 DDL 语句。
    // 业务侧仍必须遵守「单语句」约定（见 sql.ts 的 execute 说明）。
    multipleStatements: true,
    // 默认 8s 超时，避免半死连接拖住 pool
    connectTimeout: 8_000,
  });
  return _pool;
}

/** 显式初始化（在应用启动脚本 / 测试 setup 中使用） */
export async function initPool(): Promise<Pool> {
  const pool = getPool();
  // 冒一次连接，验证连通性
  await pool.query("SELECT 1");
  return pool;
}

/** 释放连接池（用于优雅退出 / 测试收尾） */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/** 测试用：重置单例（不关连接） */
export function _resetPool(): void {
  _pool = null;
}

/** 事务包装器：自动 commit / rollback / release */
export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error("[db] rollback failed:", rollbackErr);
    }
    throw err;
  } finally {
    conn.release();
  }
}

/** 简化 SELECT 单行 */
export async function findOne<T = any>(
  sqlText: string,
  params: sql.Params = []
): Promise<T | null> {
  return sql.queryOne<T>(getPool(), sqlText, params);
}

/** 简化 SELECT 多行 */
export async function findMany<T = any>(
  sqlText: string,
  params: sql.Params = []
): Promise<T[]> {
  return sql.query<T>(getPool(), sqlText, params);
}

/** 简化 INSERT/UPDATE/DELETE */
export async function execute(
  sqlText: string,
  params: sql.Params = []
): Promise<sql.InsertResult> {
  return sql.execute(getPool(), sqlText, params);
}

/** 健康检查：SELECT 1 */
export async function healthCheck(): Promise<{ ok: true; ts: number } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    await getPool().query("SELECT 1");
    return { ok: true, ts: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
