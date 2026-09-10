/**
 * 文件名称：aggregate-summary.ts
 * 功能描述：聚合摘要事件生成器（阶段 3 补算会调用；阶段 2 只留生成器骨架）
 * 所属模块：domain/events/generators
 * 契约冻结：docs/packs-contract.md §aggregate_summary
 * 说明：
 *   - 阶段 2 保留生成器骨架；实际补算集成在阶段 3 的 catchup/aggregator
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";
import { recallForPet } from "../../memory";

export interface AggregateSummaryInput {
  spanDays: number;
  itemsCollected: { type: string; count: number }[];
  outings: number;
  travelNights: number;
}

export interface AggregateContext extends EventContext {
  aggregate: AggregateSummaryInput;
}

export function generateAggregateSummary(ctx: AggregateContext): GeneratedEvent {
  const { pet, memories, rng = Math.random } = ctx;
  const ts = ctx.ts ?? Date.now();
  const hubId = ctx.hubId ?? pet.hubId;

  const recall = recallForPet({
    memories,
    petName: pet.name,
    rng,
    opts: { maxRefs: 4, nameForceProb: 1 },
  });

  const event: Event = {
    id: newUlid(),
    petId: pet.id,
    userId: pet.userId,
    type: "aggregate_summary",
    ts,
    fsmState: pet.state,
    params: {
      span_days: ctx.aggregate.spanDays,
      items_collected: ctx.aggregate.itemsCollected,
      outings: ctx.aggregate.outings,
      travel_nights: ctx.aggregate.travelNights,
    },
    memoryRefs: recall.refs,
    source: "catchup",
    engineVersion: ENGINE_VERSION,
    packSchemaVersion: PACK_SCHEMA_VERSION,
    isAggregate: true,
    aggregateSpanDays: ctx.aggregate.spanDays,
    generatedByCatchup: true,
    schemaVersion: SCHEMA_VERSION,
    hubId,
    createdAt: ts,
  };

  return { event, fsmAction: "no_op" };
}
