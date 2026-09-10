/**
 * 文件名称：reply.ts
 * 功能描述：回信调度（reply_pending 到期检测 + 生成 reply_letter 事件 + 退避联动）
 * 所属模块：domain/gift
 * 验收对齐：
 *   - docs/requirements.md §3.7 回信（馈赠后 24h 内生成；含 ≥1 条记忆引用；信纸背景）
 *   - docs/dev-stage-plan.md §3 阶段 4 回信调度模块
 *   - docs/architecture.md §4.3.2 每日馈赠闭环
 *
 * 触发路径：
 *   - /api/sync 在 catchup 完成后调用 checkAndGenerateReply
 *   - 也可单独触发（供测试）
 *
 * 退避表联动：
 *   - 若 pet.next_proactive_ts > now，说明用户在退避期（长期缺席）
 *     → 回信被推迟到 next_proactive_ts 之后再发送
 *   - 若 next_proactive_ts <= now 或 null → 正常发送
 *
 * 记忆引用保证：
 *   - 复用阶段 2 reply-letter 生成器，其内部 recallForPet({ nameForceProb: 1, maxRefs: 5 })
 *     并强制注入 item_name → 满足契约 recall_min_count=1
 */

import { withTransaction } from "../persistence/db";
import {
  insert as insertEvent,
  findByPetAndType,
} from "../persistence/repos/events.repo";
import {
  findById as findPet,
  markReplyClearedInTx,
} from "../persistence/repos/pets.repo";
import {
  findByPetId as findMemories,
  findByPetAndKind,
} from "../persistence/repos/memories.repo";
import { generateReplyLetter } from "../events/generators/reply-letter";
import type { Event, Memory, Pet } from "../types";

export interface ReplyCheckInput {
  pet: Pet;
  now?: number;
  rng?: () => number;
}

export interface ReplyCheckResult {
  /** 是否生成了回信 */
  generated: boolean;
  /** 未生成时的原因 */
  skipReason?:
    | "no_pet"
    | "not_pending"
    | "not_due_yet"
    | "backoff_active"
    | "no_offer_event"
    | "no_item_name"
    | "generation_failed";
  /** 事件（事务成功后返回） */
  event?: Event;
  /** 观测字段 */
  pet?: Pet;
  replyDueAt?: number | null;
  nextProactiveTs?: number | null;
}

/**
 * 检查回信是否可生成（纯函数判定）。
 */
export function isReplyDue(
  pet: Pet,
  now: number
): { due: boolean; reason?: "not_pending" | "not_due_yet" | "backoff_active" } {
  if (!pet.replyPending) return { due: false, reason: "not_pending" };
  if (pet.replyDueAt === null) return { due: false, reason: "not_pending" };
  if (pet.replyDueAt > now) return { due: false, reason: "not_due_yet" };
  // 退避期：next_proactive_ts > now 表示用户在退避期，回信被推迟
  if (pet.nextProactiveTs !== null && pet.nextProactiveTs > now) {
    return { due: false, reason: "backoff_active" };
  }
  return { due: true };
}

/**
 * 检查并（可能）生成回信。
 *
 * 流程：
 *   1. 检查 reply_pending / reply_due_at / next_proactive_ts（退避联动）
 *   2. 查最近一次 offer_received 事件（获取 gift_event_id + item_id）
 *   3. 从 pet 记忆加载 item_received 条目（供 recall 命中）
 *   4. 调用 generateReplyLetter 生成事件
 *   5. 事务内：写 event + 更新 pets（reply_pending=0, last_reply_at=now）
 *
 * @param petId 目标 pet
 * @param now 覆盖当前时间戳
 */
export async function checkAndGenerateReply(
  petId: string,
  now?: number
): Promise<ReplyCheckResult> {
  const ts = now ?? Date.now();

  const pet = await findPet(petId);
  if (!pet) {
    return { generated: false, skipReason: "no_pet" };
  }

  const check = isReplyDue(pet, ts);
  if (!check.due) {
    return {
      generated: false,
      skipReason: check.reason,
      pet,
      replyDueAt: pet.replyDueAt,
      nextProactiveTs: pet.nextProactiveTs,
    };
  }

  // 查最近的 offer_received 事件（拿到 item_id + event id）
  const offerEvent = await findLatestOfferEvent(petId);
  if (!offerEvent) {
    return {
      generated: false,
      skipReason: "no_offer_event",
      pet,
      replyDueAt: pet.replyDueAt,
    };
  }

  const itemId = typeof offerEvent.params.item_id === "string" ? offerEvent.params.item_id : null;
  let itemDisplayName =
    typeof offerEvent.params.item_display_name === "string"
      ? offerEvent.params.item_display_name
      : null;

  // 若 offer 事件里没带 display_name（老数据），从 memories 表拿 item_received 值兜底
  if (!itemDisplayName) {
    const itemMemories = await findMemoriesOfKind(petId, "item_received");
    const latest = itemMemories[itemMemories.length - 1];
    itemDisplayName = latest?.value ?? null;
  }

  if (!itemDisplayName) {
    return {
      generated: false,
      skipReason: "no_item_name",
      pet,
      replyDueAt: pet.replyDueAt,
    };
  }

  // 加载所有记忆（供 recallForPet）
  const memories = await findMemories(petId);

  // 生成事件
  let event: Event;
  try {
    const ctx = {
      pet,
      memories,
      ts,
      rng: Math.random,
      giftEventId: offerEvent.id,
      itemDisplayName,
      itemId: itemId ?? undefined,
    };
    const gen = generateReplyLetter(ctx);
    event = gen.event;
  } catch (err) {
    console.error(`[reply] generate failed pet=${pet.id}:`, err);
    return {
      generated: false,
      skipReason: "generation_failed",
      pet,
      replyDueAt: pet.replyDueAt,
    };
  }

  // 事务：写 event + 更新 pets（reply_pending=0, last_reply_at=now）
  await withTransaction(async (conn) => {
    await insertEvent(event, conn);
    await markReplyClearedInTx(conn, pet.id, ts);
  });

  return {
    generated: true,
    event,
    pet,
    replyDueAt: pet.replyDueAt,
  };
}

/**
 * 查最近的 offer_received 事件。
 */
async function findLatestOfferEvent(petId: string): Promise<Event | null> {
  const rows = await findByPetAndType(petId, "offer_received", 1);
  return rows[0] ?? null;
}

/**
 * 按 kind 查 memories（供回信兜底 item_display_name 用）。
 */
async function findMemoriesOfKind(
  petId: string,
  kind: "item_received"
): Promise<Memory[]> {
  return findByPetAndKind(petId, kind);
}
