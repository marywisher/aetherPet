/**
 * 文件名称：watching-water.ts
 * 功能描述：看水事件生成器
 * 所属模块：domain/events/generators
 * 转换规则：无（no_op）
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";
import { randInt, pickOne } from "../rng";
import { recallForPet } from "../../memory";

const PLACES = [
  "河边", "湖边", "溪边", "水塘", "桥头", "池塘边",
] as const;

export function generateWatchingWater(ctx: EventContext): GeneratedEvent {
  const { pet, memories, rng = Math.random } = ctx;
  const ts = ctx.ts ?? Date.now();
  const hubId = ctx.hubId ?? pet.hubId;
  const place = pickOne(rng, PLACES) ?? "河边";
  const durationMinutes = randInt(rng, 15, 60);

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
    type: "watching_water",
    ts,
    fsmState: pet.state,
    params: { place, duration_minutes: durationMinutes },
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
