/**
 * 文件名称：planner.ts
 * 功能描述：补算计划纯函数（≤20 条硬上限 + >7 天按天聚合）
 * 所属模块：domain/catchup
 * 验收对齐：
 *   - docs/requirements.md §3.4 补算（含极端场景）
 *   - docs/dev-stage-plan.md §3 阶段 3 补算 planner
 *   - docs/architecture.md §4.3.1 补算时序、§9 R3 补算性能风险
 *
 * 核心规则（严格对齐需求 §3.4）：
 *   1. 单次补算生成事件数 **≤ 20**（MAX_EVENTS 硬上限，含聚合摘要）
 *   2. **≤ 7 天**离线：按每天 1 条常规事件上限；不足 20 时不硬凑
 *   3. **> 7 天**离线：超过 7 天的部分（"old period"）**按天聚合**为 1 条聚合摘要
 *      摘要事件；≤ 7 天窗口内仍按常规事件生成
 *   4. planner 是纯函数（无 IO / 无 Date 读取）：给定 (pet, fromTs, toTs, seed) 完全可复现
 *   5. 事件类型仅从 RANDOM_TYPES 中抽取（补算生成引擎自然事件；不注入 gift/system 类）
 *
 * 时间布局：
 *   - [fromTs, toTs] 是补算时间窗
 *   - recentWindow = min(7 天, offlineSpan)，位于窗口末尾 [toTs - recentWindow, toTs]
 *   - oldPeriod = 窗口开头部分 [fromTs, toTs - recentWindow]
 *   - 常规事件在 recentWindow 内均匀分布（首末留 50% spacing 边距，避免贴到边界）
 *   - 聚合摘要事件 ts = oldEnd（旧时段末尾，位于最近 7 天常规事件之前），
 *     在时间线上呈现在更早的位置，作为"过去 X 天"入口卡片
 *
 * 约束：纯函数、纯 TS、不 import next/react/mysql。
 */

import { DAY_MS } from "@/config/backoff-table";
import { seededRng } from "../events/rng";
import type { Rng } from "../events/types";
import type { EventTypeValue, Pet } from "../types";

/** 单次补算硬上限（含聚合摘要） */
export const MAX_EVENTS = 20;
/** 常规事件按天上限（最近 7 天窗口内，每天 1 条） */
export const MAX_EVENTS_PER_DAY = 1;
/** 聚合阈值：离线超过 7 天时，old period 触发聚合摘要 */
export const AGGREGATE_THRESHOLD_DAYS = 7;

/** 单个常规事件 slot（planner 输出，executor 消费） */
export interface NormalSlot {
  /** 事件类型（来自 RANDOM_TYPES） */
  type: EventTypeValue;
  /** 事件时间戳（UTC ms），严格落在 [fromTs, toTs] 内 */
  ts: number;
}

/** 聚合摘要 slot（planner 输出，aggregator 消费） */
export interface AggregateSlot {
  /** 聚合窗口起点 */
  fromTs: number;
  /** 聚合窗口终点 */
  toTs: number;
  /** 覆盖天数（浮点，便于统计） */
  spanDays: number;
  /** 覆盖天数（整数，写入事件 params.span_days） */
  spanDaysInt: number;
}

/** 补算计划（executor 消费） */
export interface CatchUpPlan {
  /** 缺席时长（ms） */
  offlineMs: number;
  /** 缺席天数（浮点） */
  offlineDays: number;
  /** 常规事件 slot 列表（ts 升序） */
  normal: NormalSlot[];
  /** 聚合摘要 slot（无则为 null） */
  aggregate: AggregateSlot | null;
  /** 补算事件总数（= normal.length + (aggregate ? 1 : 0)），恒 ≤ MAX_EVENTS */
  total: number;
  /** 是否触发了聚合（>7 天） */
  aggregated: boolean;
  /** 随机数种子（便于调试与单测复现） */
  seed: number;
}

export interface PlanInput {
  pet: Pet;
  /** 补算窗口起点（pet 上一次活跃的时间戳） */
  fromTs: number;
  /** 补算窗口终点（本次同步的时间戳） */
  toTs: number;
  /** 随机数种子（0..2^32-1）；默认从 pet.id + fromTs + toTs 派生 */
  seed?: number;
}

/** 参与补算的引擎自然事件类型（与 engine 的 RANDOM_TYPES 一致） */
const CANDIDATE_TYPES: EventTypeValue[] = [
  "outing",
  "watching_water",
  "counting_leaves",
  "self_talk",
  "brought_item",
  "spontaneous_letter",
];

/**
 * 从字符串派生 32 位 seed（FNV-1a 变体）。
 * 用于保证同 pet + 同窗口补算结果可复现。
 */
export function deriveSeed(petId: string, fromTs: number, toTs: number): number {
  const input = `${petId}|${fromTs}|${toTs}`;
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * 均匀分布 n 个 ts 到 [start, end]，首末各留 50% spacing 边距。
 * spacing = (end - start) / (n + 1)，ts[i] = start + spacing * (i + 1)。
 * n = 0 时返回空数组。
 */
function distributeTs(start: number, end: number, n: number): number[] {
  if (n <= 0 || end <= start) return [];
  const spacing = (end - start) / (n + 1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.round(start + spacing * (i + 1));
    out.push(t < start ? start : t > end ? end : t);
  }
  return out;
}

/**
 * 生成补算计划。
 *
 * @param input pet + 时间窗 + 种子
 * @returns CatchUpPlan（planner 纯输出，不含 Event 实例）
 *
 * 使用示例：
 * ```ts
 * const plan = planCatchUp({ pet, fromTs: pet.lastActivityTs, toTs: Date.now() });
 * // plan.normal.length + (plan.aggregate ? 1 : 0) === plan.total，恒 ≤ 20
 * ```
 */
export function planCatchUp(input: PlanInput): CatchUpPlan {
  const { pet, fromTs, toTs } = input;
  const seed = input.seed ?? deriveSeed(pet.id, fromTs, toTs);
  const rng: Rng = seededRng(seed);

  const offlineMs = Math.max(0, toTs - fromTs);
  const offlineDays = offlineMs / DAY_MS;

  // 边界：无离线时长 → 空计划
  if (offlineMs <= 0) {
    return {
      offlineMs,
      offlineDays,
      normal: [],
      aggregate: null,
      total: 0,
      aggregated: false,
      seed,
    };
  }

  // 最近 7 天窗口：靠近 toTs 的一段（用于生成常规事件）
  const recentWindow = Math.min(AGGREGATE_THRESHOLD_DAYS * DAY_MS, offlineMs);
  const recentStart = toTs - recentWindow;
  const oldEnd = recentStart; // = recentStart（同一时刻）
  const oldSpanMs = Math.max(0, oldEnd - fromTs);

  // 常规事件数：min(MAX_EVENTS_PER_DAY * recentDays, MAX_EVENTS - (aggregate ? 1 : 0))
  const recentDays = Math.min(
    AGGREGATE_THRESHOLD_DAYS,
    Math.max(0, Math.floor(offlineMs / DAY_MS))
  );
  const normalBudget = MAX_EVENTS - (oldSpanMs > 0 ? 1 : 0);
  const normalCount = Math.max(0, Math.min(recentDays * MAX_EVENTS_PER_DAY, normalBudget));

  // 生成常规事件
  const tsList = distributeTs(recentStart, toTs, normalCount);
  const normal: NormalSlot[] = tsList.map((ts) => ({
    type: CANDIDATE_TYPES[Math.floor(rng() * CANDIDATE_TYPES.length)]!,
    ts,
  }));

  // 聚合摘要：仅当 old period > 0（即离线超过 7 天）
  const aggregate: AggregateSlot | null =
    oldSpanMs > 0
      ? {
          fromTs,
          toTs: oldEnd,
          spanDays: oldSpanMs / DAY_MS,
          spanDaysInt: Math.max(1, Math.round(oldSpanMs / DAY_MS)),
        }
      : null;

  const total = normal.length + (aggregate ? 1 : 0);

  // 硬上限保险（理论上已被 normalBudget 保证，此处防御性 assert）
  if (total > MAX_EVENTS) {
    throw new Error(
      `[catchup/planner] 补算事件数超过上限：${total} > ${MAX_EVENTS}`
    );
  }

  return {
    offlineMs,
    offlineDays,
    normal,
    aggregate,
    total,
    aggregated: aggregate !== null,
    seed,
  };
}
