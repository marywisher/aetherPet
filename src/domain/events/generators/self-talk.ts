/**
 * 文件名称：self-talk.ts
 * 功能描述：自言自语事件生成器
 * 所属模块：domain/events/generators
 * 转换规则：无（no_op）
 * 契约冻结：docs/packs-contract.md §self_talk
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";
import { pickOne } from "../rng";
import { recallForPet } from "../../memory";

const MOODS = ["calm", "curious", "nostalgic"] as const;
type Mood = (typeof MOODS)[number];

export function generateSelfTalk(ctx: EventContext): GeneratedEvent {
  const { pet, memories, rng = Math.random } = ctx;
  const ts = ctx.ts ?? Date.now();
  const hubId = ctx.hubId ?? pet.hubId;
  const mood = pickOne(rng, MOODS) ?? "calm";

  const recall = recallForPet({
    memories,
    petName: pet.name,
    rng,
    opts: { maxRefs: 4 },
  });

  const event: Event = {
    id: newUlid(),
    petId: pet.id,
    userId: pet.userId,
    type: "self_talk",
    ts,
    fsmState: pet.state,
    params: { mood: mood as Mood },
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
