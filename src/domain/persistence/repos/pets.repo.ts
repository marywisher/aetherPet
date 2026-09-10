/**
 * 文件名称：pets.repo.ts
 * 功能描述：pets 表 CRUD
 * 所属模块：domain/persistence/repos
 */

import { getPool } from "../db";
import { query, queryOne, execute, connExecute } from "../sql";
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
export async function updateStateAndActivityInTx(
  conn: import("mysql2/promise").PoolConnection,
  petId: string,
  state: PetState,
  stateSince: number,
  activityTs: number
): Promise<void> {
  await connExecute(
    conn,
    `UPDATE pets SET state = ?, state_since = ?, last_activity_ts = ?,
      user_last_active_ts = ?, updated_at = ? WHERE id = ?`,
    [state, stateSince, activityTs, activityTs, Date.now(), petId]
  );
}
