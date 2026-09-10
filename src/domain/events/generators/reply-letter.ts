/**
 * 文件名称：reply-letter.ts
 * 功能描述：馈赠回信事件生成器
 * 所属模块：domain/events/generators
 * 契约冻结：docs/packs-contract.md §reply_letter
 * 说明：
 *   - 阶段 2 骨架：允许通过 ctx 传入 giftEventId 与 itemDisplayName
 *   - 阶段 4 会与 gift 模块集成，reply_pending 到期调用本生成器
 *   - 契约要求 recall_min_count=1（至少 1 条记忆引用）
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";
import { recallForPet } from "../../memory";

export interface ReplyLetterContext extends EventContext {
  /** 关联哪次送赠 */
  giftEventId: string;
  /** 收到的物品名（用于 text 里的 {item} 占位符） */
  itemDisplayName: string;
  /** 收到的物品 id（可选） */
  itemId?: string;
}

export function generateReplyLetter(ctx: ReplyLetterContext): GeneratedEvent {
  const { pet, memories, rng = Math.random } = ctx;
  const ts = ctx.ts ?? Date.now();
  const hubId = ctx.hubId ?? pet.hubId;
  const itemDisplayName = ctx.itemDisplayName;
  const itemId = ctx.itemId;

  // 强制 recall_min_count=1：至少 1 条记忆引用
  const recall = recallForPet({
    memories,
    petName: pet.name,
    rng,
    opts: { maxRefs: 5, nameForceProb: 1 },
  });

  // 强制注入 item_name（契约 recall_required）
  const itemRef = {
    kind: "item_name" as const,
    value: itemDisplayName,
    weight: 1,
    sourceEventId: undefined,
  };
  const hasItem = recall.refs.some((r) => r.kind === "item_name");
  const memoryRefs = hasItem
    ? recall.refs
    : [itemRef, ...recall.refs].slice(0, 5);

  const event: Event = {
    id: newUlid(),
    petId: pet.id,
    userId: pet.userId,
    type: "reply_letter",
    ts,
    fsmState: pet.state,
    params: {
      gift_event_id: ctx.giftEventId,
      item_id: itemId ?? null,
      item_display_name: itemDisplayName,
    },
    memoryRefs,
    source: "gift",
    engineVersion: ENGINE_VERSION,
    packSchemaVersion: PACK_SCHEMA_VERSION,
    isAggregate: false,
    aggregateSpanDays: null,
    generatedByCatchup: false,
    schemaVersion: SCHEMA_VERSION,
    hubId,
    createdAt: ts,
  };

  return { event, fsmAction: "no_op" };
}
