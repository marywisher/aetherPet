/**
 * 文件名称：sql.ts
 * 功能描述：MySQL 类型安全的 query helper（薄封装）
 * 所属模块：domain/persistence
 * 说明：
 *   - 不做 ORM，避免黑盒；只做参数占位符转换 + 类型断言
 *   - MySQL prepared statement 使用 ? 占位符
 *   - 数组/JSON 参数需先 JSON.stringify，本模块不做自动序列化
 */

import type { Pool, RowDataPacket, ResultSetHeader, PoolConnection, ExecuteValues } from "mysql2/promise";

export type Row<T = any> = T;
export type Rows<T = any> = T[];
export type InsertResult = ResultSetHeader;

/** 参数类型 */
export type Params = ExecuteValues;

/** 执行 SELECT，返回行列表 */
export async function query<T = any>(
  pool: Pool,
  sql: string,
  params: Params = []
): Promise<T[]> {
  const [rows] = await pool.execute(sql, params as ExecuteValues);
  return rows as T[];
}

/** 执行 SELECT 单行 */
export async function queryOne<T = any>(
  pool: Pool,
  sql: string,
  params: Params = []
): Promise<T | null> {
  const [rows] = await pool.execute(sql, params as ExecuteValues);
  const arr = rows as T[];
  return arr.length === 0 ? null : arr[0];
}

/** 执行 INSERT/UPDATE/DELETE，返回结果头 */
export async function execute(
  pool: Pool,
  sql: string,
  params: Params = []
): Promise<InsertResult> {
  const [result] = await pool.execute(sql, params as ExecuteValues);
  return result as InsertResult;
}

/** 开启事务；调用方负责 commit / rollback / release */
export async function getConnection(pool: Pool): Promise<PoolConnection> {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  return conn;
}

/** 事务内查询 */
export async function connQuery<T = any>(
  conn: PoolConnection,
  sql: string,
  params: Params = []
): Promise<T[]> {
  const [rows] = await conn.execute(sql, params as ExecuteValues);
  return rows as T[];
}

export async function connQueryOne<T = any>(
  conn: PoolConnection,
  sql: string,
  params: Params = []
): Promise<T | null> {
  const [rows] = await conn.execute(sql, params as ExecuteValues);
  const arr = rows as T[];
  return arr.length === 0 ? null : arr[0];
}

export async function connExecute(
  conn: PoolConnection,
  sql: string,
  params: Params = []
): Promise<InsertResult> {
  const [result] = await conn.execute(sql, params as ExecuteValues);
  return result as InsertResult;
}
