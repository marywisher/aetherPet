/**
 * 文件名称：pets.repo.ts
 * 功能描述：pets 表 CRUD
 * 所属模块：domain/persistence/repos
 */

import { getPool } from "../db";
import { query, queryOne, execute, connExecute, connQuery } from "../sql";
import { getEnv } from "@/config/env";
import type { Pet, PetState } from "../../types";

interface PetRow {
  id: string;
  user_id: string;
  name: string;
  state: PetState;
  state_since: number;
  created_at: number;
  updated_at: number;
  last_activity_ts: number;
  offline_start_ts: number | null;
  user_last_active_ts: number;
  next_proactive_ts: number | null;
  daily_grant_last_date: string | null;
  offer_last_date: string | null;
  reply_pending: number; // TINYINT(1)
  reply_due_at: number | null;
  last_reply_at: number | null;
  active_pack_name: string;
  wallet_ref: string | null;
  schema_version: string;
  hub_id: string;
}

function rowToPet(row: PetRow): Pet {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    state: row.state,
    stateSince: row.state_since,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityTs: row.last_activity_ts,
    offlineStartTs: row.offline_start_ts,
    userLastActiveTs: row.user_last_active_ts,
    nextProactiveTs: row.next_proactive_ts,
    dailyGrantLastDate: row.daily_grant_last_date,
    offerLastDate: row.offer_last_date,
    replyPending: row.reply_pending === 1,
    replyDueAt: row.reply_due_at,
    lastReplyAt: row.last_reply_at,
    activePackName: row.active_pack_name,
    walletRef: row.wallet_ref,
    schemaVersion: row.schema_version,
    hubId: row.hub_id,
  };
}

export async function insert(data: Omit<Pet, "id" | "createdAt" | "updatedAt" | "stateSince" | "lastActivityTs" | "userLastActiveTs" | "replyPending" | "activePackName"> & { id: string }): Promise<Pet> {
  const pool = getPool();
  const env = getEnv();
  // P2-009：不再硬编码 "default"，从 env.DEFAULT_PACK 读（自托管可自定义默认包名）
  const defaultPackName = env.DEFAULT_PACK;
  const now = Date.now();
  await execute(
    pool,
    `INSERT INTO pets
      (id, user_id, name, state, state_since, created_at, updated_at,
       last_activity_ts, user_last_active_ts, next_proactive_ts,
       daily_grant_last_date, offer_last_date,
       reply_pending, reply_due_at, last_reply_at,
       active_pack_name, wallet_ref, schema_version, hub_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.userId,
      data.name,
      data.state,
      now,
      now,
      now,
      now,
      now,
      data.nextProactiveTs ?? null,
      data.dailyGrantLastDate ?? null,
      data.offerLastDate ?? null,
      0,
      data.replyDueAt ?? null,
      data.lastReplyAt ?? null,
      defaultPackName,
      data.walletRef ?? null,
      data.schemaVersion,
      data.hubId,
    ]
  );
  const created = await findById(data.id);
  return created!;
}

/**
 * 事务内插入 pet（供 pre-launch 创建事务使用）
 */
export async function insertInTx(
  conn: import("mysql2/promise").PoolConnection,
  data: Omit<Pet, "id" | "createdAt" | "updatedAt" | "stateSince" | "lastActivityTs" | "userLastActiveTs" | "replyPending" | "activePackName"> & { id: string }
): Promise<void> {
  const env = getEnv();
  const defaultPackName = env.DEFAULT_PACK;
  const now = Date.now();
  await connExecute(
    conn,
    `INSERT INTO pets
      (id, user_id, name, state, state_since, created_at, updated_at,
       last_activity_ts, user_last_active_ts, next_proactive_ts,
       daily_grant_last_date, offer_last_date,
       reply_pending, reply_due_at, last_reply_at,
       active_pack_name, wallet_ref, schema_version, hub_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.id,
      data.userId,
      data.name,
      data.state,
      now,
      now,
      now,
      now,
      now,
      data.nextProactiveTs ?? null,
      data.dailyGrantLastDate ?? null,
      data.offerLastDate ?? null,
      0,
      data.replyDueAt ?? null,
      data.lastReplyAt ?? null,
      defaultPackName,
      data.walletRef ?? null,
      data.schemaVersion,
      data.hubId,
    ]
  );
}
export async function findById(id: string): Promise<Pet | null> {
  const pool = getPool();
  const row = await queryOne<PetRow>(pool, "SELECT * FROM pets WHERE id = ?", [id]);
  return row ? rowToPet(row) : null;
}

export async function findByUserId(userId: string): Promise<Pet[]> {
  const pool = getPool();
  const rows = await query<PetRow>(pool, "SELECT * FROM pets WHERE user_id = ?", [userId]);
  return rows.map(rowToPet);
}

/**
 * 查询用户最新 pet 的当前生效素材包名
 * 供 /api/packs 按用户返回 current（切包后列表/主题/“使用中”判定跟随）；无 pet 返回 null
 */
export async function findLatestActivePackName(userId: string): Promise<string | null> {
  const pool = getPool();
  const row = await queryOne<{ active_pack_name: string }>(
    pool,
    "SELECT active_pack_name FROM pets WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  return row ? row.active_pack_name : null;
}

/** 更新用户活跃度（登录/任意操作） */
export async function touchUserActivity(petId: string, ts: number = Date.now()): Promise<void> {
  const pool = getPool();
  await execute(
    pool,
    "UPDATE pets SET user_last_active_ts = ?, last_activity_ts = ?, updated_at = ? WHERE id = ?",
    [ts, ts, Date.now(), petId]
  );
}

/**
 * 持久化 pet 的 FSM 状态（阶段 2 P1-001 修复）
 *
 * 语义：
 *   - 事件生成器把 FSM 动作应用到 pet 后，engine 返回 nextState；
 *   - route 层调用本函数把新状态落库，避免 FSM 转换只活一次 HTTP 调用；
 *   - state_since 记录状态最近一次变更的时间（UTC ms）。
 *
 * 说明：
 *   - 本函数不做合法性校验；调用方（engine/route）应先用 isLegalAction 判定。
 *   - 若 state 未变（no_op 或非法动作），调用方可以选择跳过本调用以节省一次写库。
 */
export async function updateState(
  petId: string,
  state: PetState,
  stateSince: number,
  ts: number = Date.now()
): Promise<void> {
  const pool = getPool();
  await execute(
    pool,
    "UPDATE pets SET state = ?, state_since = ?, updated_at = ? WHERE id = ?",
    [state, stateSince, ts, petId]
  );
}

/**
 * 事务内更新 pet：state + state_since + last_activity_ts + user_last_active_ts + updated_at。
 *
 * 语义（补算 executor 在事务尾部调用）：
 *   - state / state_since：补算期间 FSM 推进后的最终状态
 *   - last_activity_ts = activityTs：补算把"缺席期"补齐，pet 的 last_activity 更新到同步时间
 *   - user_last_active_ts = activityTs：本次同步即用户活跃（配合 backoff 计算缺席时长）
 *   - updated_at = Date.now()：审计字段
 *
 * 事务性（P1 修复不变式）：
 *   - 补算的整体 INSERT 事件 + 本 UPDATE 必须在同一事务内，中途失败整体 rollback
 *   - 严禁"先 UPDATE pets 再 INSERT 事件"的顺序：否则若 INSERT 失败会留下半份状态
 *
 * @param conn 事务连接（必填；本函数不做独立事务）
 * @param petId 目标 pet
 * @param state 补算后的 FSM 状态
 * @param stateSince 状态最近一次变更的时间（UTC ms）
 * @param activityTs 同步时间戳（同时写入 last_activity_ts 与 user_last_active_ts）
 */
/**
 * 阶段 4：更新每日馈赠日（daily_grant_last_date）
 * 语义：完成一次 daily_grant 后调用，同一 UTC+8 日期不会再触发领取
 */
export async function updateDailyGrantDate(
  petId: string,
  date: string,
  ts: number = Date.now()
): Promise<void> {
  const pool = getPool();
  await execute(
    pool,
    "UPDATE pets SET daily_grant_last_date = ?, updated_at = ? WHERE id = ?",
    [date, ts, petId]
  );
}

// 说明：updateDailyGrantDate 是非事务版便捷入口，语义与 updateDailyGrantDateInTx 一致。
// 生产路径使用 InTx 版本；本函数仅用于测试 / 后台任务。

/**
 * 事务内：送赠完成后一次性更新 offer 相关字段（阶段 4）。
 *   - offer_last_date = 今日（日限一次校验）
 *   - reply_pending = 1
 *   - reply_due_at = 送赠 ts + 24h（架构 §4.3.2）
 *
 * P1-003 修复：条件 WHERE 保证并发幂等——
 *   WHERE id = ? AND (offer_last_date IS NULL OR offer_last_date < ?)
 * 返回 affectedRows；为 0 时调用方视为已被并发请求处理，rollback 并返回
 * already_offered_today。
 */
export async function markOfferInTx(
  conn: import("mysql2/promise").PoolConnection,
  petId: string,
  offerDate: string,
  replyDueAt: number
): Promise<number> {
  const result = await connExecute(
    conn,
    `UPDATE pets SET offer_last_date = ?, reply_pending = 1, reply_due_at = ?, updated_at = ?
     WHERE id = ? AND (offer_last_date IS NULL OR offer_last_date < ?)`,
    [offerDate, replyDueAt, Date.now(), petId, offerDate]
  );
  return result.affectedRows;
}

/**
 * 事务内：回信生成完成后清除 pending 并记录 last_reply_at（阶段 4）。
 */
export async function markReplyClearedInTx(
  conn: import("mysql2/promise").PoolConnection,
  petId: string,
  lastReplyAt: number
): Promise<void> {
  await connExecute(
    conn,
    "UPDATE pets SET reply_pending = 0, last_reply_at = ?, updated_at = ? WHERE id = ?",
    [lastReplyAt, Date.now(), petId]
  );
}

/**
 * 事务内更新 daily_grant_last_date（供 daily-grant 模块使用）。
 *
 * P1-003 修复：条件 WHERE 保证并发幂等——
 *   WHERE id = ? AND (daily_grant_last_date IS NULL OR daily_grant_last_date < ?)
 * 返回 affectedRows；为 0 时调用方视为已被并发请求处理，rollback 并返回
 * already_granted_today。
 */
export async function updateDailyGrantDateInTx(
  conn: import("mysql2/promise").PoolConnection,
  petId: string,
  date: string
): Promise<number> {
  const result = await connExecute(
    conn,
    "UPDATE pets SET daily_grant_last_date = ?, updated_at = ? " +
      "WHERE id = ? AND (daily_grant_last_date IS NULL OR daily_grant_last_date < ?)",
    [date, Date.now(), petId, date]
  );
  return result.affectedRows;
}

/**
 * 更新 pet.next_proactive_ts（阶段 4 P1-001 修复）。
 *
 * 语义：
 *   - /api/sync 计算 backoff 后写回 DB，使 reply.ts::isReplyDue 的 backoff_active
 *     分支在生产环境生效（此前 next_proactive_ts 从未写入 → 死代码）
 *   - 仅在 backoff.nextProactiveTs 非 null 时调用（缺席 < 24h 时 nextProactiveTs=null，
 *     无实际语义，跳过写库节省一次 UPDATE）
 *
 * @param petId 目标 pet
 * @param nextProactiveTs 下次主动触达的绝对时间戳（UTC ms）；null 表示"保持正常频率"
 */
export async function updateNextProactiveTs(
  petId: string,
  nextProactiveTs: number | null,
  ts: number = Date.now()
): Promise<void> {
  const pool = getPool();
  await execute(
    pool,
    "UPDATE pets SET next_proactive_ts = ?, updated_at = ? WHERE id = ?",
    [nextProactiveTs, ts, petId]
  );
}

/** 非事务版 markReplyCleared（供单测与降级路径） */
export async function markReplyCleared(
  petId: string,
  lastReplyAt: number
): Promise<void> {
  const pool = getPool();
  await execute(
    pool,
    "UPDATE pets SET reply_pending = 0, last_reply_at = ?, updated_at = ? WHERE id = ?",
    [lastReplyAt, Date.now(), petId]
  );
}

export async function updateStateAndActivityInTx(
  conn: import("mysql2/promise").PoolConnection,
  petId: string,
  state: PetState,
  stateSince: number,
  activityTs: number,
  offlineStartTs: number | null = null
): Promise<void> {
  await connExecute(
    conn,
    `UPDATE pets SET state = ?, state_since = ?, last_activity_ts = ?,
      user_last_active_ts = ?, offline_start_ts = COALESCE(?, offline_start_ts),
      updated_at = ? WHERE id = ?`,
    [state, stateSince, activityTs, activityTs, offlineStartTs, Date.now(), petId]
  );
}

/**
 * 阶段 6：切换 pet 生效素材包（事务内，供 POST /api/packs/activate）。
 * 返回受影响的 pet 行数；幂等（同一包重复切换无副作用）。
 */
export async function updateActivePackInTx(
  conn: import("mysql2/promise").PoolConnection,
  userId: string,
  packName: string
): Promise<number> {
  const r = await connExecute(
    conn,
    "UPDATE pets SET active_pack_name = ?, updated_at = ? WHERE user_id = ?",
    [packName, Date.now(), userId]
  );
  return r.affectedRows;
}

/** 查询用户已有 pet 的当前生效包（供激活接口确认一致性） */
export async function findActivePackNames(
  conn: import("mysql2/promise").PoolConnection,
  userId: string
): Promise<string[]> {
  const rows = await connQuery<{ active_pack_name: string }>(
    conn,
    "SELECT active_pack_name FROM pets WHERE user_id = ?",
    [userId]
  );
  return rows.map((r) => r.active_pack_name);
}
