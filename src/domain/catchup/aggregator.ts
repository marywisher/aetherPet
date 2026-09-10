/**
 * 文件名称：aggregator.ts
 * 功能描述：聚合摘要事件生成器（"过去 30 天，Pet 出门走了 X 次、收过 Y 片枯叶"）
 * 所属模块：domain/catchup
 * 验收对齐：
 *   - docs/requirements.md §3.4 补算（>7 天按聚合摘要）
 *   - docs/dev-stage-plan.md §3 阶段 3 聚合摘要
 *   - docs/architecture.md §5.3 aggregate_summary params schema
 *
 * 输入契约：
 *   - planner 输出的 AggregateSlot（覆盖窗口的起止与天数）
 *   - pet 快照 + memories 池（用于 memoryRefs 强制注入 pet_name）
 *
 * 输出契约：
 *   - 1 条 aggregate_summary 事件（isAggregate=true, generatedByCatchup=true, source='catchup'）
 *   - params 结构严格对齐架构 §5.3：
 *       { span_days, items_collected: [{type, count}], outings, travel_nights }
 *   - 事件的 ts 位于补算窗口末尾（时间线首屏作为"过去 X 天"入口卡片）
 *
 * 合成策略（重要）：
 *   - 补算把 old period 的 N 条常规事件替换为 1 条聚合摘要；因此没有真实事件数据可统计
 *   - outings / items_collected 采用「按天抽样」合成：
 *       - outings = 每天 30%~70% 概率抽一次（用 seededRng，单测可复现）
 *       - items_collected = 每天 35% 概率抽一次，从常见物品池随机选类型
 *       - travel_nights 恒 0（MVP 无旅行玩法，与 requirements §4 一致）
 *   - 合成数量与缺席天数成比例，避免"过去 90 天只有 1 次出门"这种荒谬摘要
 *
 * 约束：领域层纯 TS，不 import next/react/mysql。
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION,
  PACK_SCHEMA_VERSION,
  SCHEMA_VERSION,
  type Event,
  type GeneratedEvent,
} from "../events/types";
import { randInt, seededRng } from "../events/rng";
import type { Rng } from "../events/types";
import { recallForPet } from "../memory";
import type { Memory, Pet } from "../types";
import type { AggregateSlot } from "./planner";

/** 常见物品池（与 items 表 seed 一致的常见项，用于合成 items_collected 类型） */
const ITEM_TYPES = [
  "浆果",
  "枯叶",
  "石子",
  "蒲公英",
  "贝壳",
  "鹅卵石",
  "羽毛",
  "木片",
] as const;

/** 合成参数（内部） */
interface AggregateParams {
  spanDays: number;
  outings: number;
  itemsCollected: { type: string; count: number }[];
  travelNights: number;
}

/**
 * 合成聚合摘要的 params（纯函数）。
 *
 * @param spanDays 覆盖天数（正整数）
 * @param rng      可复现 RNG
 * @returns 合成的 outings / items_collected / travel_nights
 */
export function synthesizeAggregateParams(
  spanDays: number,
  rng: Rng
): AggregateParams {
  const days = Math.max(1, Math.round(spanDays));

  // outings：每天 30%~70% 概率出门一次（平均约 50% × 天数）
  let outings = 0;
  for (let d = 0; d < days; d++) {
    if (rng() < 0.5) outings++;
  }
  // 保底：至少有 1 次（避免"过去 30 天，Pet 出门走了 0 次"的荒谬摘要）
  if (outings === 0 && days > 0) outings = 1;

  // items_collected：每天 35% 概率捡到 1 个物品，从常见池随机挑类型
  const itemBuckets = new Map<string, number>();
  for (let d = 0; d < days; d++) {
    if (rng() < 0.35) {
      const type = ITEM_TYPES[randInt(rng, 0, ITEM_TYPES.length - 1)] ?? "枯叶";
      itemBuckets.set(type, (itemBuckets.get(type) ?? 0) + 1);
    }
  }
  const itemsCollected = Array.from(itemBuckets.entries()).map(([type, count]) => ({
    type,
    count,
  }));

  return { spanDays: days, outings, itemsCollected, travelNights: 0 };
}

export interface GenerateAggregateInput {
  pet: Pet;
  memories: Memory[];
  slot: AggregateSlot;
  /** 事件时间戳（默认 slot.toTs，位于补算窗口末尾） */
  ts?: number;
  /** 可复现 RNG（默认由 pet.id + slot.fromTs + slot.toTs 派生 seed） */
  rng?: Rng;
  hubId?: string;
}

/**
 * 生成聚合摘要事件（不入库；调用方负责 INSERT）。
 *
 * 契约：
 *   - type = 'aggregate_summary'
 *   - isAggregate = true, generatedByCatchup = true, source = 'catchup'
 *   - params.span_days 与 slot.spanDaysInt 一致（架构 §5.3）
 *   - memoryRefs 强制含 pet_name（recall_min_count = 1，见 docs/packs-contract.md §5）
 *   - fsmAction = 'no_op'（聚合摘要不改变 pet 状态）
 *
 * @param input pet + memories + slot + 可选 ts/rng/hubId
 * @returns GeneratedEvent（event + fsmAction）
 */
export function generateAggregateSummaryEvent(
  input: GenerateAggregateInput
): GeneratedEvent {
  const { pet, memories, slot } = input;
  const rng: Rng =
    input.rng ??
    seededRng((pet.id.split("").reduce((h, c) => h * 31 + c.charCodeAt(0), 0) >>> 0) ^
      (slot.fromTs ^ slot.toTs));
  const ts = input.ts ?? slot.toTs;
  const hubId = input.hubId ?? pet.hubId;

  const params = synthesizeAggregateParams(slot.spanDaysInt, rng);

  // 记忆检索：强制注入 pet_name（recall_min_count=1，见契约 §5）
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
      span_days: params.spanDays,
      items_collected: params.itemsCollected,
      outings: params.outings,
      travel_nights: params.travelNights,
    },
    memoryRefs: recall.refs,
    source: "catchup",
    engineVersion: ENGINE_VERSION,
    packSchemaVersion: PACK_SCHEMA_VERSION,
    isAggregate: true,
    aggregateSpanDays: params.spanDays,
    generatedByCatchup: true,
    schemaVersion: SCHEMA_VERSION,
    hubId,
    createdAt: ts,
  };

  return { event, fsmAction: "no_op" };
}

export { ITEM_TYPES };
