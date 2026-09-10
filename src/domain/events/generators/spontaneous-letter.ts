/**
 * 文件名称：spontaneous-letter.ts
 * 功能描述：自主冒信事件生成器（"昨晚梦见你了" 类）
 * 所属模块：domain/events/generators
 * 契约冻结：docs/packs-contract.md §spontaneous_letter
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";
import { pickOne } from "../rng";
import { recallForPet } from "../../memory";

const TRIGGERS = ["dream", "moonlight", "silence"] as const;

export function generateSpontaneousLetter(ctx: EventContext): GeneratedEvent {
  const { pet, memories, rng = Math.random } = ctx;
  const ts = ctx.ts ?? Date.now();
  const hubId = ctx.hubId ?? pet.hubId;
  const trigger = pickOne(rng, TRIGGERS) ?? "moonlight";

  const recall = recallForPet({
    memories,
    petName: pet.name,
    rng,
    opts: { maxRefs: 4, nameForceProb: 0.7 },
  });

  const event: Event = {
    id: newUlid(),
    petId: pet.id,
    userId: pet.userId,
    type: "spontaneous_letter",
    ts,
    fsmState: pet.state,
    params: { trigger: trigger as (typeof TRIGGERS)[number] },
    memoryRefs: recall.refs,
    source: ctx.byCatchup ? "catchup" : "engine",
    engineVersion: ENGINE_VERSION,
    packSchemaVersion: PACK_SCHEMA_VERSION,
    isAggregate: false,
    aggregateSpanDays: null,
    generatedByCatchup: ctx.byCatchup ?? false,
    schemaVersion: SCHEMA_VERSION,
    hubId,
    createdAt: ts,
  };

  return { event, fsmAction: "no_op" };
}
