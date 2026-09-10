/**
 * 文件名称：planner.test.ts
 * 功能描述：补算 planner 纯函数单测（1/3/30/90 天四场景 + ≤20 硬上限 + 聚合触发）
 * 所属模块：tests/unit/domain/catchup
 * 验收对齐：
 *   - docs/requirements.md §3.4 补算（≤20 条 + >7 天按天聚合）
 *   - docs/dev-stage-plan.md §3 阶段 3 planner 单测覆盖 1/3/30/90 天
 */

import { describe, it, expect } from "vitest";
import {
  planCatchUp,
  MAX_EVENTS,
  AGGREGATE_THRESHOLD_DAYS,
  deriveSeed,
  type CatchUpPlan,
} from "@/domain/catchup/planner";
import { DAY_MS } from "@/config/backoff-table";
import type { Pet, PetState } from "@/domain/types";

const TS_BASE = 1_746_000_000_000;
const DAY = DAY_MS;

function makePet(state: PetState = "at_home"): Pet {
  return {
    id: "test-pet-planner",
    userId: "test-user-1",
    name: "小圆",
    state,
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

describe("domain/catchup/planner.ts planCatchUp", () => {
  it("缺席 0 天（无离线时长）→ 空计划", () => {
    const plan = planCatchUp({ pet: makePet(), fromTs: TS_BASE, toTs: TS_BASE, seed: 42 });
    expect(plan.total).toBe(0);
    expect(plan.normal).toHaveLength(0);
    expect(plan.aggregate).toBeNull();
    expect(plan.aggregated).toBe(false);
  });

  it("缺席 1 小时（远低于 1 天）→ 空计划（不足 1 天不生成常规事件）", () => {
    const plan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 60 * 60 * 1000,
      toTs: TS_BASE,
      seed: 42,
    });
    // floor(1h / 24h) = 0，因此 normalCount = 0
    expect(plan.normal).toHaveLength(0);
    expect(plan.aggregate).toBeNull();
    expect(plan.total).toBe(0);
  });

  it("缺席 1 天 → 1 条常规事件，无聚合", () => {
    const plan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 1 * DAY,
      toTs: TS_BASE,
      seed: 42,
    });
    expect(plan.normal).toHaveLength(1);
    expect(plan.aggregate).toBeNull();
    expect(plan.total).toBe(1);
    expect(plan.offlineDays).toBeCloseTo(1, 5);
  });

  it("缺席 3 天 → 3 条常规事件，无聚合", () => {
    const plan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 3 * DAY,
      toTs: TS_BASE,
      seed: 42,
    });
    expect(plan.normal).toHaveLength(3);
    expect(plan.aggregate).toBeNull();
    expect(plan.total).toBe(3);
    expect(plan.offlineDays).toBeCloseTo(3, 5);
  });

  it("缺席 7 天 → 7 条常规事件，无聚合（阈值边界：不触发聚合）", () => {
    const plan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 7 * DAY,
      toTs: TS_BASE,
      seed: 42,
    });
    expect(plan.normal).toHaveLength(7);
    expect(plan.aggregate).toBeNull();
    expect(plan.total).toBe(7);
  });

  it("缺席 8 天 → 7 条常规 + 1 条聚合摘要（超过 7 天触发聚合）", () => {
    const plan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 8 * DAY,
      toTs: TS_BASE,
      seed: 42,
    });
    expect(plan.normal).toHaveLength(7);
    expect(plan.aggregate).not.toBeNull();
    expect(plan.aggregate!.spanDaysInt).toBe(1); // 8 - 7 = 1 天
    expect(plan.aggregated).toBe(true);
    expect(plan.total).toBe(8);
  });

  it("缺席 30 天 → 7 条常规 + 1 条聚合摘要（覆盖 23 天）", () => {
    const plan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      seed: 42,
    });
    expect(plan.normal).toHaveLength(7);
    expect(plan.aggregate).not.toBeNull();
    expect(plan.aggregate!.spanDaysInt).toBe(23);
    expect(plan.total).toBe(8);
    expect(plan.offlineDays).toBeCloseTo(30, 5);
  });

  it("缺席 90 天（极端场景）→ 7 条常规 + 1 条聚合摘要（覆盖 83 天）", () => {
    const plan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 90 * DAY,
      toTs: TS_BASE,
      seed: 42,
    });
    expect(plan.normal).toHaveLength(7);
    expect(plan.aggregate).not.toBeNull();
    expect(plan.aggregate!.spanDaysInt).toBe(83);
    expect(plan.total).toBe(8);
    expect(plan.offlineDays).toBeCloseTo(90, 5);
  });

  it("缺席 365 天（1 年）→ 7 条常规 + 1 条聚合摘要（覆盖 358 天）", () => {
    const plan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 365 * DAY,
      toTs: TS_BASE,
      seed: 42,
    });
    expect(plan.normal).toHaveLength(7);
    expect(plan.aggregate!.spanDaysInt).toBe(358);
    expect(plan.total).toBe(8);
  });

  it("缺席 10000 天（极端极端）→ total 仍 ≤ 20（硬上限不变）", () => {
    const plan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 10000 * DAY,
      toTs: TS_BASE,
      seed: 42,
    });
    expect(plan.total).toBeLessThanOrEqual(MAX_EVENTS);
    expect(plan.total).toBe(8);
  });

  it("硬上限：total 恒 ≤ MAX_EVENTS（20）", () => {
    for (const days of [1, 3, 7, 8, 14, 30, 60, 90, 180, 365, 3650]) {
      const plan = planCatchUp({
        pet: makePet(),
        fromTs: TS_BASE - days * DAY,
        toTs: TS_BASE,
        seed: 42,
      });
      expect(plan.total).toBeLessThanOrEqual(MAX_EVENTS);
    }
  });

  it("常规事件 ts 严格落在 [fromTs, toTs] 内", () => {
    const fromTs = TS_BASE - 30 * DAY;
    const toTs = TS_BASE;
    const plan = planCatchUp({ pet: makePet(), fromTs, toTs, seed: 42 });
    for (const slot of plan.normal) {
      expect(slot.ts).toBeGreaterThanOrEqual(fromTs);
      expect(slot.ts).toBeLessThanOrEqual(toTs);
    }
  });

  it("常规事件 ts 升序排列（planner 输出顺序 = 时间顺序）", () => {
    const plan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      seed: 42,
    });
    for (let i = 1; i < plan.normal.length; i++) {
      expect(plan.normal[i]!.ts).toBeGreaterThan(plan.normal[i - 1]!.ts);
    }
  });

  it("常规事件 ts 均匀分布（首末留 50% spacing 边距）", () => {
    const fromTs = TS_BASE - 7 * DAY;
    const toTs = TS_BASE;
    const plan = planCatchUp({ pet: makePet(), fromTs, toTs, seed: 42 });
    const span = toTs - fromTs;
    const spacing = span / (plan.normal.length + 1);
    // 首个事件距 fromTs 约 1 * spacing（允许 50% 误差）
    expect(plan.normal[0]!.ts - fromTs).toBeGreaterThan(spacing * 0.4);
    expect(plan.normal[0]!.ts - fromTs).toBeLessThan(spacing * 1.6);
    // 末个事件距 toTs 约 1 * spacing
    expect(toTs - plan.normal[plan.normal.length - 1]!.ts).toBeGreaterThan(spacing * 0.4);
    expect(toTs - plan.normal[plan.normal.length - 1]!.ts).toBeLessThan(spacing * 1.6);
  });

  it("常规事件类型来自 RANDOM_TYPES 白名单（不含 gift/system 类）", () => {
    const allowed = new Set([
      "outing",
      "watching_water",
      "counting_leaves",
      "self_talk",
      "brought_item",
      "spontaneous_letter",
    ]);
    for (let seed = 0; seed < 20; seed++) {
      const plan = planCatchUp({
        pet: makePet(),
        fromTs: TS_BASE - 30 * DAY,
        toTs: TS_BASE,
        seed,
      });
      for (const slot of plan.normal) {
        const isAllowed = allowed.has(slot.type);
        expect(isAllowed).toBe(true);
      }
    }
  });

  it("聚合 slot 的 spanDays 与 spanDaysInt 一致（浮点 vs 整数）", () => {
    const plan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      seed: 42,
    });
    expect(plan.aggregate).not.toBeNull();
    expect(plan.aggregate!.spanDaysInt).toBe(Math.round(plan.aggregate!.spanDays));
  });

  it("聚合 slot 的 fromTs/toTs 严格覆盖 old period", () => {
    const fromTs = TS_BASE - 30 * DAY;
    const toTs = TS_BASE;
    const plan = planCatchUp({ pet: makePet(), fromTs, toTs, seed: 42 });
    expect(plan.aggregate!.fromTs).toBe(fromTs);
    expect(plan.aggregate!.toTs).toBe(toTs - 7 * DAY);
  });

  it("确定性：相同 seed 产生相同计划", () => {
    const a = planCatchUp({ pet: makePet(), fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    const b = planCatchUp({ pet: makePet(), fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    expect(a.normal).toEqual(b.normal);
    expect(a.aggregate).toEqual(b.aggregate);
    expect(a.total).toBe(b.total);
  });

  it("不同 seed 产生不同事件类型序列（非确定性）", () => {
    const a = planCatchUp({ pet: makePet(), fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    const b = planCatchUp({ pet: makePet(), fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 99 });
    // 两次至少有一个 slot 的类型不同
    const sameTypes = a.normal.every((s, i) => s.type === b.normal[i]!.type);
    expect(sameTypes).toBe(false);
  });

  it("deriveSeed: 同 pet + 同窗口 → 同 seed；不同窗口 → 不同 seed", () => {
    const s1 = deriveSeed("pet-1", 1000, 2000);
    const s2 = deriveSeed("pet-1", 1000, 2000);
    const s3 = deriveSeed("pet-1", 1000, 3000);
    const s4 = deriveSeed("pet-2", 1000, 2000);
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(s1).not.toBe(s4);
    // seed 是 32 位无符号整数
    expect(s1).toBeGreaterThanOrEqual(0);
    expect(s1).toBeLessThanOrEqual(0xffffffff);
  });

  it("未传 seed 时自动派生（结果可复现）", () => {
    const a = planCatchUp({ pet: makePet(), fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE });
    const b = planCatchUp({ pet: makePet(), fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE });
    expect(a.normal).toEqual(b.normal);
    expect(a.seed).toBe(b.seed);
  });

  it("AGGREGATE_THRESHOLD_DAYS = 7（与需求 §3.4 一致）", () => {
    expect(AGGREGATE_THRESHOLD_DAYS).toBe(7);
  });

  it("Max 90 天场景性能：<10ms（R3 缓解：planner 纯函数）", () => {
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      planCatchUp({ pet: makePet(), fromTs: TS_BASE - 90 * DAY, toTs: TS_BASE, seed: i });
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10_000); // 1000 次共 10s（平均 10ms/次）
  });
});

describe("CatchUpPlan 结构完整性", () => {
  it("plan 各字段类型正确（30 天场景）", () => {
    const plan: CatchUpPlan = planCatchUp({
      pet: makePet(),
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      seed: 42,
    });
    expect(typeof plan.offlineMs).toBe("number");
    expect(typeof plan.offlineDays).toBe("number");
    expect(Array.isArray(plan.normal)).toBe(true);
    expect(typeof plan.total).toBe("number");
    expect(typeof plan.aggregated).toBe("boolean");
    expect(typeof plan.seed).toBe("number");
  });
});
