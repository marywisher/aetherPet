/**
 * 文件名称：outing.ts
 * 功能描述：外出散步事件生成器
 * 所属模块：domain/events/generators
 * 契约冻结：docs/packs-contract.md §outing
 * 转换规则：at_home ──outing_start──► out_walking
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";
import { randInt, pickOne } from "../rng";
import { recallForPet } from "../../memory";

const DESTINATIONS = [
  "河边", "公园", "山脚", "老屋后", "小径", "码头", "菜园", "山坡",
  "老街", "湖岸",
] as const;

export function generateOuting(ctx: EventContext): GeneratedEvent {
  const { pet, memories, rng = Math.random } = ctx;
  const ts = ctx.ts ?? Date.now();
  const hubId = ctx.hubId ?? pet.hubId;
  const destination = pickOne(rng, DESTINATIONS) ?? "河边";
  const durationHours = randInt(rng, 1, 3);

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
    type: "outing",
    ts,
    fsmState: pet.state, // 引擎先产出，engine 会用 FSM 更新
    params: { destination, duration_hours: durationHours },
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

  return { event, fsmAction: "outing_start" };
}