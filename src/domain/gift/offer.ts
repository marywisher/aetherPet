/**
 * 文件名称：offer.ts
 * 功能描述：送赠（用户主动把物品放桌上给 pet；日限一次；触发 reply_pending）
 * 所属模块：domain/gift
 * 验收对齐：
 *   - docs/requirements.md §3.7 送赠（每天限一次、错过不惩罚、文案禁止「打卡/签到」）
 *   - docs/dev-stage-plan.md §3 阶段 4 送赠模块
 *   - docs/architecture.md §4.3.2 每日馈赠闭环
 *
 * 事务边界：
 *   - 校验（inventory 存在 + 属于该用户 + 未送出 + 当日未送）→ 写 offer_received 事件
 *     → 更新 inventory（offered_at）→ 更新 pets（offer_last_date + reply_pending=1 + reply_due_at=now+24h）
 *     → 写 memories 表（item_received）
 *   - 任一步失败整体 rollback
 *
 * 硬约束：
 *   - 物品归用户所有、用户主动摆放（非系统自动）——offer 必须由用户 API 触发
 *   - 日限一次：pets.offer_last_date 与今日 UTC+8 比较
 *
 * P1 修复（Round 1）：
 *   - P2-001：pet 不存在时返回 skipReason='pet_not_found'（不再复用 inventory_not_found）
 *   - P1-003 / P2-005：markOfferInTx 与 markOfferedInTx 使用条件 WHERE，
 *             affectedRows=0 时视为并发冲突，rollback 并返回 already_offered_today /
 *             inventory_already_offered
 */

import { withTransaction } from "../persistence/db";
import {
  findById as findInventory,
  findUnofferedByUser,
  markOfferedInTx,
} from "../persistence/repos/inventory.repo";
import { insert as insertEvent } from "../persistence/repos/events.repo";
import { insert as insertMemory } from "../persistence/repos/memories.repo";
import {
  markOfferInTx,
  findById as findPet,
} from "../persistence/repos/pets.repo";
import { generateOfferReceived } from "../events/generators/offer-received";
import { findByPetId as findMemories } from "../persistence/repos/memories.repo";
import { findById as findItemById } from "../persistence/repos/items.repo";
import { newId } from "../util/ulid";
import { toLocalDateStr } from "../util/date";
import type { Event, Inventory, Memory, Pet } from "../types";

/** 回信截止时间 = 送赠 ts + 24h（架构 §4.3.2） */
export const REPLY_DUE_HOURS = 24;
export const REPLY_DUE_MS = REPLY_DUE_HOURS * 60 * 60 * 1000;

export type OfferSkipReason =
  | "pet_not_found"
  | "inventory_not_found"
  | "inventory_not_owned"
  | "inventory_already_offered"
  | "already_offered_today"
  | "item_not_found";

export interface OfferInput {
  /** 目标 inventory 记录 id */
  inventoryId: string;
  /** 目标 pet id（一般等于 inventory.pet_id） */
  petId: string;
  /** 用户 id（用于所有权校验） */
  userId: string;
  /** 覆盖当前时间戳（默认 Date.now()） */
  now?: number;
}

export interface OfferResult {
  offered: boolean;
  skipReason?: OfferSkipReason;
  /** 用户可看到的错误信息（skipReason 非空时非空） */
  message?: string;
  todayStr: string;
  /** 事务成功后返回 */
  event?: Event;
  inventory?: Inventory;
  replyDueAt?: number;
}

/**
 * 判定今日是否已送（纯函数）。
 */
export function hasOfferedToday(pet: Pet, todayStr: string): boolean {
  return pet.offerLastDate === todayStr;
}

/**
 * 校验 inventory 状态（纯函数）。
 * 返回 undefined 表示通过，否则返回错误码。
 */
export function validateInventoryForOffer(
  inventory: Inventory | null,
  opts: { userId: string; petId: string }
): OfferSkipReason | undefined {
  if (!inventory) return "inventory_not_found";
  if (inventory.userId !== opts.userId) return "inventory_not_owned";
  if (inventory.petId !== opts.petId) return "inventory_not_owned";
  if (inventory.offeredAt !== null) return "inventory_already_offered";
  return undefined;
}

/** 并发冲突时的事务内错误（P1-003 / P2-005） */
class IdempotencyError extends Error {
  constructor(
    public readonly skipReason: Extract<OfferSkipReason, "already_offered_today" | "inventory_already_offered">,
    public readonly message: string
  ) {
    super(skipReason);
    this.name = "IdempotencyError";
  }
}

/**
 * 执行送赠（事务）。
 *
 * 语义：
 *   - 用户主动把 inventory 中的一件物品放到桌上给 pet
 *   - 日限一次；同日重复送赠返回 already_offered_today
 *   - 事务内：写 offer_received 事件 → 更新 inventory.offered_at
 *     → 更新 pets（offer_last_date, reply_pending=1, reply_due_at=now+24h）
 *     → 写 memories（item_received，供回信引用）
 *   - P1-003：markOfferInTx 与 markOfferedInTx 均使用条件 WHERE；affectedRows=0 时
 *     视为已被并发请求处理，rollback 并返回对应 already_* 结果
 */
export async function offerInventoryItem(
  input: OfferInput
): Promise<OfferResult> {
  const { inventoryId, petId, userId } = input;
  const now = input.now ?? Date.now();
  const todayStr = toLocalDateStr(now);

  // 1) 加载 pet（日限一次校验）
  const pet = await findPet(petId);
  if (!pet) {
    return {
      offered: false,
      skipReason: "pet_not_found",
      message: "pet 不存在",
      todayStr,
    };
  }

  if (hasOfferedToday(pet, todayStr)) {
    return {
      offered: false,
      skipReason: "already_offered_today",
      message: "今天已经送给小圆一件礼物了，明天再来看看。",
      todayStr,
    };
  }

  // 2) 加载 inventory 并校验
  const inventory = await findInventory(inventoryId);
  const invalidReason = validateInventoryForOffer(inventory, { userId, petId });
  if (invalidReason) {
    const msgMap: Record<string, string> = {
      inventory_not_found: "这件物品不存在或已被清理。",
      inventory_not_owned: "这件物品不属于你。",
      inventory_already_offered: "这件物品已经送出去了。",
    };
    return {
      offered: false,
      skipReason: invalidReason,
      message: msgMap[invalidReason] ?? "操作失败",
      todayStr,
    };
  }

  // 3) 加载 item（用于 display_name）
  const item = await findItemById(inventory!.itemId);
  if (!item) {
    return {
      offered: false,
      skipReason: "item_not_found",
      message: "物品目录缺失，无法生成事件。",
      todayStr,
    };
  }

  // 4) 加载记忆（供生成器 recall）
  const memories = await findMemories(petId);

  // 5) 生成事件（先构造，事务内持久化）
  const ctx = {
    pet,
    memories,
    ts: now,
    rng: Math.random,
    itemId: item.id,
    itemDisplayName: item.displayName,
    grantedEventId: inventory!.grantedEventId ?? newId(),
    inventoryId: inventory!.id,
  };
  const gen = generateOfferReceived(ctx);
  const event = gen.event;

  const replyDueAt = now + REPLY_DUE_MS;

  // 6) 事务：更新 pets → 更新 inventory → 写 event → 写 memory
  //    markOfferInTx 放在最前面作为日限一次的第一道门（P1-003）；
  //    markOfferedInTx 检查 inventory 未被其他请求同时标记送出（P2-005）。
  try {
    await withTransaction(async (conn) => {
      // 日限一次：条件 UPDATE，affectedRows=0 代表已被并发请求处理
      const petAffected = await markOfferInTx(conn, pet.id, todayStr, replyDueAt);
      if (petAffected === 0) {
        throw new IdempotencyError(
          "already_offered_today",
          "今天已经送给小圆一件礼物了，明早再来看看。"
        );
      }

      // inventory 标记：条件 UPDATE，affectedRows=0 代表已被并发请求送出
      const invAffected = await markOfferedInTx(conn, inventory!.id, event.id, now);
      if (invAffected === 0) {
        throw new IdempotencyError(
          "inventory_already_offered",
          "这件物品已经送出去了。"
        );
      }

      await insertEvent(event, conn);

      // 写 memories（item_received）：让回信生成器能找到这条记忆
      const memory: Memory = {
        id: newId(),
        petId: pet.id,
        kind: "item_received",
        value: item.displayName,
        createdAt: now,
        lastReferenced: null,
        weight: 1.2,
        isPermanent: false,
        schemaVersion: pet.schemaVersion,
        hubId: pet.hubId,
      };
      await insertMemory(memory, conn);
    });
  } catch (err) {
    if (err instanceof IdempotencyError) {
      return {
        offered: false,
        skipReason: err.skipReason,
        message: err.message,
        todayStr,
      };
    }
    throw err;
  }

  return {
    offered: true,
    todayStr,
    event,
    inventory: {
      ...inventory!,
      offeredAt: now,
      offeredEventId: event.id,
      consumedAt: now,
      consumedEventId: event.id,
    },
    replyDueAt,
  };
}

/**
 * 便捷查询：用户当前可送的物品列表（供送赠 UI 用）。
 */
export async function listOfferable(userId: string, petId: string): Promise<Inventory[]> {
  return findUnofferedByUser(userId, petId);
}
