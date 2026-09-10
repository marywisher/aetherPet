/**
 * 文件名称：offer-received.ts
 * 功能描述：送赠接收事件生成器（"你把 X 放在桌上"）
 * 所属模块：domain/events/generators
 * 契约冻结：docs/packs-contract.md §offer_received
 * 说明：
 *   - 阶段 2 骨架；阶段 4 与 /api/gift/offer 集成
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";
import { recallForPet } from "../../memory";

export interface OfferReceivedContext extends EventContext {
  itemId: string;
  itemDisplayName: string;
  /** 关联 inventory 的 granted_event_id */
  grantedEventId: string;
  /** 可选：inventory_id */
  inventoryId?: string;
}

export function generateOfferReceived(ctx: OfferReceivedContext): GeneratedEvent {
  const { pet, memories, rng = Math.random } = ctx;
  const ts = ctx.ts ?? Date.now();
  const hubId = ctx.hubId ?? pet.hubId;

  const recall = recallForPet({
    memories,
    petName: pet.name,
    rng,
    opts: { maxRefs: 4, nameForceProb: 0.9 },
  });

  // 强制注入 item_name + pet_name
  const itemRef = {
    kind: "item_name" as const,
    value: ctx.itemDisplayName,
    weight: 1,
    sourceEventId: undefined,
  };
  const hasItem = recall.refs.some((r) => r.kind === "item_name");
  const hasPetName = recall.refs.some((r) => r.kind === "pet_name");
  let refs = recall.refs;
  if (!hasItem) refs = [itemRef, ...refs];
  if (!hasPetName) {
    const petRef = {
      kind: "pet_name" as const,
      value: pet.name,
      weight: 1.6,
      sourceEventId: undefined,
    };
    refs = [petRef, ...refs];
  }
  const memoryRefs = refs.slice(0, 5);

  const event: Event = {
    id: newUlid(),
    petId: pet.id,
    userId: pet.userId,
    type: "offer_received",
    ts,
    fsmState: pet.state,
    params: {
      item_id: ctx.itemId,
      item_display_name: ctx.itemDisplayName,
      offer_event_id: ctx.grantedEventId,
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
