/**
 * 文件名称：executor.ts
 * 功能描述：补算执行器（async 事务，失败整体 rollback）
 * 所属模块：domain/catchup
 * 验收对齐：
 *   - docs/requirements.md §3.4 补算（事务性）
 *   - docs/architecture.md §4.3.1 补算时序（BEGIN → 逐条 INSERT → UPDATE pets → COMMIT）
 *   - docs/architecture.md §9 R3 补算性能（事务 ≤200ms，纯 IO；记忆检索一次预取）
 *
 * 事务边界（严格不变式）：
 *   - 补算整体在单个 DB 事务内完成；中途失败整体 rollback，用户下次同步重试
 *   - 事务内写入顺序：先 INSERT 事件（按 ts 升序），最后 UPDATE pets
 *     （state / state_since / last_activity_ts）——保证"半份事件"永远不会落库
 *   - 事务内不 sleep / 不跨外部 IO（R3 缓解措施）
 *
 * 记忆检索策略（R3 缓解）：
 *   - 批量预取：一次 SELECT * FROM memories WHERE pet_id = ?，而非每事件 N 次查询
 *   - 若 pet 无 naming 记忆，事务内补插 1 条（阶段 2 generate-event 的同款兜底）
 *
 * 领域层依赖：
 *   - 依赖 domain/persistence（repo + withTransaction）；不依赖 next/react
 *   - 单测通过 mock withTransaction + repo 函数验证事务边界
 */

import type { PoolConnection } from "mysql2/promise";
import { withTransaction } from "../persistence/db";
import {
  findByPetId as findMemoriesByPetId,
  insert as insertMemory,
} from "../persistence/repos/memories.repo";
import {
  insert as insertEvent,
} from "../persistence/repos/events.repo";
import {
  updateStateAndActivityInTx,
} from "../persistence/repos/pets.repo";
import { generateNextEvent } from "../events";
import { newId } from "../util/ulid";
import type { Event, Memory, Pet } from "../types";
import type { CatchUpPlan } from "./planner";
import { generateAggregateSummaryEvent } from "./aggregator";

export interface ExecuteCatchUpInput {
  pet: Pet;
  plan: CatchUpPlan;
  /** 补算窗口起点（写入 pets.last_activity_ts 参考） */
  fromTs: number;
  /** 补算窗口终点（同步时间戳，通常 = Date.now()） */
  toTs: number;
  /** 记忆池预取（缺省时 executor 在事务内一次预取） */
  memories?: Memory[];
  /** 传入则走调用方事务（补算作为更大事务的一部分）；缺省时 executor 自建事务 */
  conn?: PoolConnection;
  /** 覆盖 hub_id（缺省读 pet.hubId） */
  hubId?: string;
}

export interface ExecuteCatchUpResult {
  events: Event[];
  finalState: Pet["state"];
  finalStateSince: number;
  /** 是否生成了聚合摘要事件 */
  aggregated: boolean;
  /** 事务实际耗时（ms） */
  durationMs: number;
  /** 是否在事务内补插了 naming 记忆（新 pet 兜底） */
  insertedNamingMemory: boolean;
}

/**
 * 事务内更新 pet：state + state_since + last_activity_ts + user_last_active_ts + updated_at。
 *
 * 语义（补算结束时调用）：
 *   - state / state_since：补算期间 FSM 推进后的最终状态
 *   - last_activity_ts = toTs：补算把"缺席期"补齐，pet 的 last_activity 更新到同步时间
 *   - user_last_active_ts = toTs：本次同步即用户活跃
 *   - updated_at = Date.now()：审计字段
 *
 * @param petId 目标 pet
 * @param state 补算后的 FSM 状态
 * @param stateSince 状态最近一次变更的时间（UTC ms）
 * @param toTs 同步时间戳（同时写入 last_activity_ts 与 user_last_active_ts）
 * @param conn 事务连接
 */
async function updatePetInTransaction(
  conn: PoolConnection,
  petId: string,
  state: Pet["state"],
  stateSince: number,
  toTs: number,
  offlineStartTs: number | null
): Promise<void> {
  await updateStateAndActivityInTx(conn, petId, state, stateSince, toTs, offlineStartTs);
}

/**
 * 执行补算计划：单个事务内 INSERT 事件 + UPDATE pet 状态与活跃时间。
 *
 * 契约：
 *   - 事务失败（任一 INSERT 或 UPDATE 抛错）→ 整体 rollback，抛错由调用方处理
 *   - 事务成功 → 返回 { events, finalState, finalStateSince, aggregated, durationMs }
 *   - events 按 ts 升序（与 plan.normal 生成顺序一致；聚合事件位于末尾）
 *
 * @param input pet + plan + 时间窗 + 可选 memories/conn
 * @returns 执行结果
 */
export async function executeCatchUp(
  input: ExecuteCatchUpInput
): Promise<ExecuteCatchUpResult> {
  const startedAt = Date.now();
  const { pet, plan, toTs, fromTs } = input;

  const runInTransaction = async (conn: PoolConnection): Promise<ExecuteCatchUpResult> => {
    // 1) 记忆池：预取一次（R3：避免每事件 N 次查询）
    let memories: Memory[] = input.memories ?? [];
    if (memories.length === 0) {
      memories = await findMemoriesByPetId(pet.id, conn);
    }

    // 2) 兜底：若缺 naming 记忆，先补插一条（阶段 2 generate-event 同款兜底）
    let insertedNamingMemory = false;
    const hasNaming = memories.some((m) => m.kind === "naming" && m.value === pet.name);
    if (!hasNaming) {
      const inserted = await insertMemory(
        {
          id: newId(),
          petId: pet.id,
          kind: "naming",
          value: pet.name,
          lastReferenced: null,
          weight: 1.6,
          isPermanent: true,
          schemaVersion: "1.0.0",
          hubId: input.hubId ?? pet.hubId,
        },
        conn
      );
      memories = [inserted, ...memories];
      insertedNamingMemory = true;
    }

    // 3) 逐条生成 + INSERT（事件按 ts 升序；FSM 状态在同一事务内逐步推进）
    const generated: Event[] = [];
    let state: Pet["state"] = pet.state;
    let stateSince: number = pet.stateSince;

    for (const slot of plan.normal) {
      const petSnapshot: Pet = { ...pet, state, stateSince };
      const out = generateNextEvent(petSnapshot, memories, {
        forceType: slot.type,
        ts: slot.ts,
        byCatchup: true,
        hubId: input.hubId ?? pet.hubId,
      });
      generated.push(out.event);
      state = out.nextState;
      stateSince = out.nextStateSince;
      await insertEvent(out.event, conn);
    }

    // 4) 聚合摘要事件（若有）：位于所有常规事件之后，ts = plan.aggregate.toTs
    let aggregated = false;
    if (plan.aggregate) {
      const petSnapshot: Pet = { ...pet, state, stateSince };
      const agg = generateAggregateSummaryEvent({
        pet: petSnapshot,
        memories,
        slot: plan.aggregate,
        ts: plan.aggregate.toTs,
        hubId: input.hubId ?? pet.hubId,
      });
      generated.push(agg.event);
      await insertEvent(agg.event, conn);
      aggregated = true;
    }

    // 5) 事务尾部：UPDATE pets（state + state_since + last_activity_ts + user_last_active_ts）
    await updatePetInTransaction(conn, pet.id, state, stateSince, toTs, fromTs);

    return {
      events: generated,
      finalState: state,
      finalStateSince: stateSince,
      aggregated,
      durationMs: Date.now() - startedAt,
      insertedNamingMemory,
    };
  };

  if (input.conn) {
    return runInTransaction(input.conn);
  }
  return withTransaction(runInTransaction);
}
