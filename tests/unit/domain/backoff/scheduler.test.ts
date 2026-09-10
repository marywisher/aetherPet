/**
 * 文件名称：scheduler.test.ts
 * 功能描述：退避调度器单测（阶段 3 新增；覆盖完整退避表）
 * 所属模块：tests/unit/domain/backoff
 * 验收对齐：
 *   - docs/requirements.md §3.3 退避间隔
 *   - docs/dev-stage-plan.md §3 阶段 3 退避调度（1→3→7→30 天）
 *   - CONTEXT.md 退避间隔表
 */

import { describe, it, expect } from "vitest";
import { computeBackoff, intervalForAbsenceHours } from "@/domain/backoff/scheduler";
import { DAY_MS } from "@/config/backoff-table";

const NOW = 1_746_000_000_000;

describe("domain/backoff/scheduler.ts computeBackoff", () => {
  it("缺席 0ms → 每天来（intervalMs = null, nextProactiveTs = null）", () => {
    const r = computeBackoff({ userLastActiveTs: NOW, now: NOW });
    expect(r.absenceMs).toBe(0);
    expect(r.absenceHours).toBe(0);
    expect(r.intervalMs).toBeNull();
    expect(r.nextProactiveTs).toBeNull();
    expect(r.isActive).toBe(true);
    expect(r.band.label).toBe("每天来");
  });

  it("缺席 1 小时 → 每天来（近 24h 内不设具体间隔）", () => {
    const r = computeBackoff({ userLastActiveTs: NOW - 60 * 60 * 1000, now: NOW });
    expect(r.intervalMs).toBeNull();
    expect(r.isActive).toBe(true);
  });

  it("缺席 23 小时 59 分 → 每天来（边界内）", () => {
    const r = computeBackoff({ userLastActiveTs: NOW - (23 * 60 + 59) * 60 * 1000, now: NOW });
    expect(r.intervalMs).toBeNull();
    expect(r.isActive).toBe(true);
  });

  it("缺席 1 天（24h）→ 3 天间隔（CONTEXT.md '≥ 1 天'）", () => {
    const r = computeBackoff({ userLastActiveTs: NOW - DAY_MS, now: NOW });
    expect(r.intervalMs).toBe(3 * DAY_MS);
    expect(r.nextProactiveTs).toBe(NOW + 3 * DAY_MS);
    expect(r.isActive).toBe(false);
    expect(r.band.label).toBe("≥ 1 天");
  });

  it("缺席 2 天 → 3 天间隔", () => {
    const r = computeBackoff({ userLastActiveTs: NOW - 2 * DAY_MS, now: NOW });
    expect(r.intervalMs).toBe(3 * DAY_MS);
  });

  it("缺席 3 天 → 7 天间隔（CONTEXT.md '≥ 3 天'）", () => {
    const r = computeBackoff({ userLastActiveTs: NOW - 3 * DAY_MS, now: NOW });
    expect(r.intervalMs).toBe(7 * DAY_MS);
    expect(r.nextProactiveTs).toBe(NOW + 7 * DAY_MS);
    expect(r.band.label).toBe("≥ 3 天");
  });

  it("缺席 6 天 23 小时 → 7 天间隔（未到 7 天）", () => {
    const r = computeBackoff({ userLastActiveTs: NOW - (6 * 24 + 23) * 60 * 60 * 1000, now: NOW });
    expect(r.intervalMs).toBe(7 * DAY_MS);
  });

  it("缺席 7 天 → 30 天间隔（CONTEXT.md '≥ 7 天'）", () => {
    const r = computeBackoff({ userLastActiveTs: NOW - 7 * DAY_MS, now: NOW });
    expect(r.intervalMs).toBe(30 * DAY_MS);
    expect(r.nextProactiveTs).toBe(NOW + 30 * DAY_MS);
    expect(r.band.label).toBe("≥ 7 天");
  });

  it("缺席 30 天 → 30 天间隔（上限，永不消失但极低频）", () => {
    const r = computeBackoff({ userLastActiveTs: NOW - 30 * DAY_MS, now: NOW });
    expect(r.intervalMs).toBe(30 * DAY_MS);
  });

  it("缺席 90 天 → 30 天间隔（上限不变）", () => {
    const r = computeBackoff({ userLastActiveTs: NOW - 90 * DAY_MS, now: NOW });
    expect(r.intervalMs).toBe(30 * DAY_MS);
  });

  it("缺席 365 天 → 30 天间隔（永不消失）", () => {
    const r = computeBackoff({ userLastActiveTs: NOW - 365 * DAY_MS, now: NOW });
    expect(r.intervalMs).toBe(30 * DAY_MS);
  });

  it("userLastActiveTs 未来于 now（异常输入）→ 视作每天来", () => {
    const r = computeBackoff({ userLastActiveTs: NOW + DAY_MS, now: NOW });
    expect(r.absenceMs).toBe(0);
    expect(r.intervalMs).toBeNull();
    expect(r.isActive).toBe(true);
  });

  it("返回的 band 对象与 BACKOFF_BANDS 中对应项引用一致", () => {
    const r = computeBackoff({ userLastActiveTs: NOW - 3 * DAY_MS, now: NOW });
    expect(r.band.minAbsenceHours).toBe(72);
    expect(r.band.intervalMs).toBe(7 * DAY_MS);
  });
});

describe("domain/backoff/scheduler.ts intervalForAbsenceHours", () => {
  it("0 → null", () => {
    expect(intervalForAbsenceHours(0)).toBeNull();
  });
  it("24 → 3 天", () => {
    expect(intervalForAbsenceHours(24)).toBe(3 * DAY_MS);
  });
  it("72 → 7 天", () => {
    expect(intervalForAbsenceHours(72)).toBe(7 * DAY_MS);
  });
  it("168 → 30 天", () => {
    expect(intervalForAbsenceHours(168)).toBe(30 * DAY_MS);
  });
  it("1680 → 30 天", () => {
    expect(intervalForAbsenceHours(1680)).toBe(30 * DAY_MS);
  });
});
