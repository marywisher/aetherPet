/**
 * 文件名称：daily-grant.ts
 * 功能描述：每日馈赠（首次登录领取物品；事务内写 inventory + event + pets.daily_grant_last_date）
 * 所属模块：domain/gift
 * 验收对齐：
 *   - docs/requirements.md §3.7 每日馈赠（物品池随机奖励；日限一次；错过不惩罚）
 *   - docs/dev-stage-plan.md §3 阶段 4 每日馈赠模块
 *   - docs/architecture.md §4.3.2 每日馈赠闭环
 *
 * 事务边界：
 *   - 抽物品 + 写 inventory + 写 daily_grant 事件 + 更新 pets.daily_grant_last_date 在同一事务
 *   - 中途失败整体 rollback（下次登录重试）
 *
 * 日限一次判断：
 *   - pets.daily_grant_last_date 与今日（UTC+8 YYYY-MM-DD）比较
 *   - 已领 → skipped='already_granted_today'，不生成事件
 *
 * P1 修复（Round 1）：
 *   - P1-002：inventoryId 在生成 event 前生成并传入 ctx，避免 DB 中 inventory_id 永远 null
 *   - P1-003：updateDailyGrantDateInTx 使用条件 WHERE（affectedRows 判定），
 *              并发下若另一请求已处理今日，本事务 rollback 并返回 already_granted_today
 */

import { withTransaction } from "../persistence/db";
import {
  insert as insertInventory,
  findRecentGrantItemIds,
} from "../persistence/repos/inventory.repo";
import { insert as insertEvent } from "../persistence/repos/events.repo";
import {
  updateDailyGrantDate,
  updateDailyGrantDateInTx,
} from "../persistence/repos/pets.repo";
import { generateDailyGrant } from "../events/generators/daily-grant";
import { newId } from "../util/ulid";
import { toLocalDateStr } from "../util/date";
import { SEED_ITEMS, pickWithExclusion, type PickResult, type ItemSeed } from "./item-pool";
import type { Event, Inventory, Pet } from "../types";
import type { Rng } from "../events/types";
import { findByPetId as findMemories } from "../persistence/repos/memories.repo";

export interface DailyGrantInput {
  pet: Pet;
  /** 注入 RNG（默认 Math.random；单测注入 seededRng） */
  rng?: Rng;
  /** 覆盖物品池（默认 SEED_ITEMS；单测可传入更小/更奇怪的池） */
  pool?: readonly ItemSeed[];
  /** 覆盖当前时间戳（默认 Date.now()） */
  now?: number;
  /** 是否允许 fallback（pool 为空时返回 fallback；默认 true） */
  allowFallback?: boolean;
}

export type DailyGrantSkipReason =
  | "already_granted_today"
  | "no_pet"
  | "empty_pool";

export interface DailyGrantResult {
  granted: boolean;
  /** 未生成时的原因（granted=false 时非空） */
  skipReason?: DailyGrantSkipReason;
  /** 用户可看到的兜底文案（pool 空 / 生成 fallback 时非空） */
  fallbackMessage?: string;
  /** 今日本地日期字符串（UTC+8） */
  todayStr: string;
  /** 事务成功后返回（未持久化时为空） */
  itemId?: string;
  itemDisplayName?: string;
  inventory?: Inventory;
  event?: Event;
  /** 抽取时被排除的最近 item_id 列表（观测用） */
  excludedItemIds?: string[];
  /** 抽取时是否因排除后池空回退到完整池 */
  fellBackToUnrestricted?: boolean;
}

/**
 * 判定今日是否已领（纯函数）。
 */
export function hasGrantedToday(pet: Pet, todayStr: string): boolean {
  return pet.dailyGrantLastDate === todayStr;
}

/**
 * 事务内并发幂等失败时抛出的内部错误（P1-003）。
 * 事务 rollback 后由调用方捕获并转为 already_granted_today 结果。
 * 不对外暴露：类型上仅 domain/gift 内部使用。
 */
class IdempotencyError extends Error {
  constructor(public readonly skipReason: string) {
    super(skipReason);
    this.name = "IdempotencyError";
  }
}

/**
 * 事务内执行每日馈赠。
 *
 * 失败整体 rollback，用户下次登录重试。
 *
 * @param input pet + 可选 RNG/池
 * @returns 结果（含 skipReason / fallbackMessage）
 */
export async function grantDailyItem(
  input: DailyGrantInput
): Promise<DailyGrantResult> {
  const { pet, rng = Math.random, pool = SEED_ITEMS, allowFallback = true } = input;
  const now = input.now ?? Date.now();
  const todayStr = toLocalDateStr(now);

  if (!pet || !pet.id) {
    return { granted: false, skipReason: "no_pet", todayStr };
  }

  if (hasGrantedToday(pet, todayStr)) {
    return { granted: false, skipReason: "already_granted_today", todayStr };
  }

  if (pool.length === 0 && !allowFallback) {
    return { granted: false, skipReason: "empty_pool", todayStr };
  }

  // 读取最近 3 次的 daily_grant item_id（用于排除重复）
  const recent = await findRecentGrantItemIds(pet.id, 3);

  // 抽取（含排除 + 空池兜底）
  const pick: PickResult = pickWithExclusion(pool, recent, rng);

  if (pick.kind === "fallback") {
    return {
      granted: false,
      skipReason: "empty_pool",
      fallbackMessage: pick.message,
      todayStr,
      excludedItemIds: recent,
    };
  }

  // 加载记忆（供生成器 recallForPet）
  const memories = await findMemories(pet.id);

  // P1-002 修复：先生成 inventory id，再把它传给生成器 ctx，
  // 避免旧实现中"生成事件 → 生成 id → 事务后回填 event.params.inventory_id"
  // 导致 DB 里 inventory_id 永远为 null。
  const inventoryId = newId();

  // 生成事件（不持久化；后续事务内持久化）
  const ctx = {
    pet,
    memories,
    ts: now,
    rng,
    itemId: pick.item.id,
    itemDisplayName: pick.item.displayName,
    inventoryId,
  };
  const gen = generateDailyGrant(ctx);
  const event = gen.event;

  // 事务：写 inventory → 写 event → 更新 pets.daily_grant_last_date
  // 事务内以 updateDailyGrantDateInTx 的 affectedRows 作为并发幂等的判定
  // （P1-003）：affectedRows=0 代表另一并发请求已写入今日日期，
  // 本事务 rollback 并返回 already_granted_today。
  try {
    await withTransaction(async (conn) => {
      const inventory: Inventory = {
        id: inventoryId,
        userId: pet.userId,
        petId: pet.id,
        itemId: pick.item.id,
        acquiredAt: now,
        acquiredVia: "daily_grant",
        grantedEventId: event.id,
        offeredAt: null,
        offeredEventId: null,
        consumedAt: null,
        consumedEventId: null,
        purchasedAt: null,
        paidCents: null,
        schemaVersion: pet.schemaVersion,
        hubId: pet.hubId,
      };
      await insertInventory(inventory, conn);
      await insertEvent(event, conn);
      const affected = await updateDailyGrantDateInTx(conn, pet.id, todayStr);
      if (affected === 0) {
        // 并发请求已处理今日：抛错 → withTransaction 整体 rollback
        throw new IdempotencyError("already_granted_today");
      }
    });
  } catch (err) {
    if (err instanceof IdempotencyError) {
      return {
        granted: false,
        skipReason: "already_granted_today",
        todayStr,
        excludedItemIds: recent,
      };
    }
    throw err;
  }

  return {
    granted: true,
    todayStr,
    itemId: pick.item.id,
    itemDisplayName: pick.item.displayName,
    inventory: {
      id: inventoryId,
      userId: pet.userId,
      petId: pet.id,
      itemId: pick.item.id,
      acquiredAt: now,
      acquiredVia: "daily_grant",
      grantedEventId: event.id,
      offeredAt: null,
      offeredEventId: null,
      consumedAt: null,
      consumedEventId: null,
      purchasedAt: null,
      paidCents: null,
      schemaVersion: pet.schemaVersion,
      hubId: pet.hubId,
    },
    event,
    excludedItemIds: recent,
    fellBackToUnrestricted: pick.fellBackToUnrestricted,
  };
}

/**
 * 便捷入口：非事务版（仅用于单测兜底路径；正常流程用 grantDailyItem）。
 */
export async function updateDailyGrantDateOnly(
  petId: string,
  date: string
): Promise<void> {
  await updateDailyGrantDate(petId, date);
}
