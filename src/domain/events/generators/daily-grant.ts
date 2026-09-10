/**
 * 文件名称：daily-grant.ts
 * 功能描述：每日馈赠事件生成器（阶段 4 会接入物品池抽取）
 * 所属模块：domain/events/generators
 * 契约冻结：docs/packs-contract.md §daily_grant
 * 说明：
 *   - 阶段 2 骨架：允许外部传入 itemId / itemDisplayName
 *   - 阶段 4 与 domain/gift 集成（daily_grant_last_date 日限一次）
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";
import { recallForPet } from "../../memory";

export interface DailyGrantContext extends EventContext {
  itemId: string;
  itemDisplayName: string;
  /** inventory 表插入后的 inventory_id（可选） */
  inventoryId?: string;
}

export function generateDailyGrant(ctx: DailyGrantContext): GeneratedEvent {
  const { pet, memories, rng = Math.random } = ctx;
  const ts = ctx.ts ?? Date.now();
  const hubId = ctx.hubId ?? pet.hubId;

  const recall = recallForPet({
    memories,
    petName: pet.name,
    rng,
    opts: { maxRefs: 3, nameForceProb: 0.6 },
  });

  // 强制注入 item_name（契约 recall_required）
  const itemRef = {
    kind: "item_name" as const,
    value: ctx.itemDisplayName,
    weight: 1,
    sourceEventId: undefined,
  };
  const hasItem = recall.refs.some((r) => r.kind === "item_name");
  const memoryRefs = hasItem
    ? recall.refs
    : [itemRef, ...recall.refs].slice(0, 3);

  const event: Event = {
    id: newUlid(),
    petId: pet.id,
    userId: pet.userId,
    type: "daily_grant",
    ts,
    fsmState: pet.state,
    params: {
      item_id: ctx.itemId,
      item_display_name: ctx.itemDisplayName,
      inventory_id: ctx.inventoryId ?? null,
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
