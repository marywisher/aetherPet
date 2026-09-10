/**
 * 文件名称：aggregator.test.ts
 * 功能描述：聚合摘要事件生成器单测（阶段 3 新增）
 * 所属模块：tests/unit/domain/catchup
 * 验收对齐：
 *   - docs/requirements.md §3.4 补算（"过去 30 天，Pet 出门走了 X 次、收过 Y 片枯叶"）
 *   - docs/architecture.md §5.3 aggregate_summary params schema
 *   - docs/packs-contract.md §5 aggregate_summary 契约（recall_min_count=1）
 */

import { describe, it, expect } from "vitest";
import {
  generateAggregateSummaryEvent,
  synthesizeAggregateParams,
  ITEM_TYPES,
} from "@/domain/catchup/aggregator";
import { seededRng } from "@/domain/events/rng";
import type { AggregateSlot } from "@/domain/catchup/planner";
import type { Memory, Pet } from "@/domain/types";

const TS_BASE = 1_746_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function makePet(): Pet {
  return {
    id: "test-pet-agg",
    userId: "test-user-1",
    name: "小圆",
    state: "at_home",
    stateSince: TS_BASE - DAY,
    createdAt: TS_BASE - 100 * DAY,
    updatedAt: TS_BASE,
    lastActivityTs: TS_BASE - 30 * DAY,
    userLastActiveTs: TS_BASE - 30 * DAY,
    nextProactiveTs: null,
    dailyGrantLastDate: null,
    offerLastDate: null,
    replyPending: false,
    replyDueAt: null,
    lastReplyAt: null,
    activePackName: "default",
    walletRef: null,
    schemaVersion: "1.0.0",
    hubId: "local",
  };
}

const MEMORIES: Memory[] = [
  {
    id: "mem-naming-1",
    petId: "test-pet-agg",
    kind: "naming",
    value: "小圆",
    createdAt: TS_BASE - 100 * DAY,
    lastReferenced: null,
    weight: 1.6,
    isPermanent: true,
    schemaVersion: "1.0.0",
    hubId: "local",
  },
];

function makeSlot(spanDays: number, fromTs = TS_BASE - spanDays * DAY, toTs = TS_BASE): AggregateSlot {
  return {
    fromTs,
    toTs,
    spanDays,
    spanDaysInt: Math.round(spanDays),
  };
}

describe("domain/catchup/aggregator.ts synthesizeAggregateParams", () => {
  it("30 天 → outings 在 [1, 30] 范围内（每天 50% 概率，最少 1 次）", () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = synthesizeAggregateParams(30, seededRng(seed));
      expect(p.outings).toBeGreaterThanOrEqual(1);
      expect(p.outings).toBeLessThanOrEqual(30);
      expect(p.travelNights).toBe(0);
    }
  });

  it("1 天 → outings 在 [1, 1] 范围内（1 天最多 1 次，保底 1 次）", () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = synthesizeAggregateParams(1, seededRng(seed));
      expect(p.outings).toBeGreaterThanOrEqual(1);
      expect(p.outings).toBeLessThanOrEqual(1);
    }
  });

  it("90 天 → outings 在 [1, 90] 范围内", () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = synthesizeAggregateParams(90, seededRng(seed));
      expect(p.outings).toBeGreaterThanOrEqual(1);
      expect(p.outings).toBeLessThanOrEqual(90);
    }
  });

  it("items_collected 的 type 全部来自 ITEM_TYPES 池", () => {
    const allowed = new Set<string>(ITEM_TYPES);
    for (let seed = 0; seed < 20; seed++) {
      const p = synthesizeAggregateParams(30, seededRng(seed));
      for (const item of p.itemsCollected) {
        const isAllowed = allowed.has(item.type);
        expect(isAllowed).toBe(true);
      }
    }
  });

  it("items_collected 的 count 为正整数", () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = synthesizeAggregateParams(30, seededRng(seed));
      for (const item of p.itemsCollected) {
        expect(item.count).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(item.count)).toBe(true);
      }
    }
  });

  it("确定性：同 spanDays + 同 seed → 相同 params", () => {
    const a = synthesizeAggregateParams(30, seededRng(42));
    const b = synthesizeAggregateParams(30, seededRng(42));
    expect(a).toEqual(b);
  });

  it("spanDays 与输入一致（写入 params.span_days）", () => {
    expect(synthesizeAggregateParams(30, seededRng(42)).spanDays).toBe(30);
    expect(synthesizeAggregateParams(1, seededRng(42)).spanDays).toBe(1);
    expect(synthesizeAggregateParams(90, seededRng(42)).spanDays).toBe(90);
  });

  it("travel_nights 恒 0（MVP 无旅行玩法）", () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(synthesizeAggregateParams(30, seededRng(seed)).travelNights).toBe(0);
    }
  });
});

describe("domain/catchup/aggregator.ts generateAggregateSummaryEvent", () => {
  it("生成 aggregate_summary 事件（type 正确）", () => {
    const { event, fsmAction } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot: makeSlot(30),
      rng: seededRng(42),
    });
    expect(event.type).toBe("aggregate_summary");
    expect(fsmAction).toBe("no_op");
  });

  it("isAggregate = true, generatedByCatchup = true, source = 'catchup'", () => {
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot: makeSlot(30),
      rng: seededRng(42),
    });
    expect(event.isAggregate).toBe(true);
    expect(event.generatedByCatchup).toBe(true);
    expect(event.source).toBe("catchup");
  });

  it("params 结构对齐架构 §5.3（span_days, items_collected, outings, travel_nights）", () => {
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot: makeSlot(30),
      rng: seededRng(42),
    });
    expect(event.params).toHaveProperty("span_days");
    expect(event.params).toHaveProperty("items_collected");
    expect(event.params).toHaveProperty("outings");
    expect(event.params).toHaveProperty("travel_nights");
    expect(typeof event.params.span_days).toBe("number");
    expect(Array.isArray(event.params.items_collected)).toBe(true);
    expect(typeof event.params.outings).toBe("number");
    expect(typeof event.params.travel_nights).toBe("number");
  });

  it("params.span_days 与 slot.spanDaysInt 一致", () => {
    const slot = makeSlot(23);
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot,
      rng: seededRng(42),
    });
    expect(event.params.span_days).toBe(23);
  });

  it("aggregateSpanDays 字段与 params.span_days 一致", () => {
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot: makeSlot(30),
      rng: seededRng(42),
    });
    expect(event.aggregateSpanDays).toBe(30);
    expect(event.params.span_days).toBe(30);
  });

  it("ts 默认为 slot.toTs（位于补算窗口末尾，时间线首屏入口卡片）", () => {
    const slot = makeSlot(30);
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot,
      rng: seededRng(42),
    });
    expect(event.ts).toBe(slot.toTs);
  });

  it("ts 可被 input.ts 覆盖", () => {
    const slot = makeSlot(30);
    const customTs = TS_BASE + 12345;
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot,
      ts: customTs,
      rng: seededRng(42),
    });
    expect(event.ts).toBe(customTs);
  });

  it("memoryRefs 强制含 pet_name（recall_min_count=1，契约 §5）", () => {
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot: makeSlot(30),
      rng: seededRng(42),
    });
    const hasPetName = event.memoryRefs.some((r) => r.kind === "pet_name" && r.value === "小圆");
    expect(hasPetName).toBe(true);
  });

  it("无 naming 记忆时也强制注入 pet_name（新 pet 兜底）", () => {
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: [],
      slot: makeSlot(30),
      rng: seededRng(42),
    });
    const hasPetName = event.memoryRefs.some((r) => r.kind === "pet_name" && r.value === "小圆");
    expect(hasPetName).toBe(true);
  });

  it("petId / userId / hubId 与 pet 一致", () => {
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot: makeSlot(30),
      rng: seededRng(42),
    });
    expect(event.petId).toBe("test-pet-agg");
    expect(event.userId).toBe("test-user-1");
    expect(event.hubId).toBe("local");
  });

  it("hubId 可被 input.hubId 覆盖", () => {
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot: makeSlot(30),
      hubId: "custom-hub",
      rng: seededRng(42),
    });
    expect(event.hubId).toBe("custom-hub");
  });

  it("engineVersion / packSchemaVersion / schemaVersion 均为 1.0.0（阶段 3 不 bump）", () => {
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot: makeSlot(30),
      rng: seededRng(42),
    });
    expect(event.engineVersion).toBe("1.0.0");
    expect(event.packSchemaVersion).toBe("1.0.0");
    expect(event.schemaVersion).toBe("1.0.0");
  });

  it("事件 id 为 ULID 格式（26 字符）", () => {
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot: makeSlot(30),
      rng: seededRng(42),
    });
    expect(event.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("确定性：同 slot + 同 rng → 相同 params", () => {
    const a = generateAggregateSummaryEvent({
      pet: makePet(), memories: MEMORIES, slot: makeSlot(30), rng: seededRng(42),
    }).event;
    const b = generateAggregateSummaryEvent({
      pet: makePet(), memories: MEMORIES, slot: makeSlot(30), rng: seededRng(42),
    }).event;
    expect(a.params).toEqual(b.params);
    // 事件 id 不同（ulid 每次生成新 id）
    expect(a.id).not.toBe(b.id);
  });

  it("spanDays=1 场景：outings 至少 1 次（避免荒谬摘要）", () => {
    const { event } = generateAggregateSummaryEvent({
      pet: makePet(),
      memories: MEMORIES,
      slot: makeSlot(1),
      rng: seededRng(42),
    });
    expect(event.params.outings).toBeGreaterThanOrEqual(1);
  });

  it("未传 rng 时自动派生 seed（结果可复现 params）", () => {
    const a = generateAggregateSummaryEvent({
      pet: makePet(), memories: MEMORIES, slot: makeSlot(30),
    }).event;
    const b = generateAggregateSummaryEvent({
      pet: makePet(), memories: MEMORIES, slot: makeSlot(30),
    }).event;
    expect(a.params).toEqual(b.params);
  });
});
