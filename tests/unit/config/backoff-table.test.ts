/**
 * 文件名称：backoff-table.test.ts
 * 功能描述：退避表常量与查找函数单测（阶段 3 新增）
 * 所属模块：tests/unit/config
 * 验收对齐：docs/requirements.md §3.3 退避间隔；CONTEXT.md 退避间隔表
 */

import { describe, it, expect } from "vitest";
import {
  BACKOFF_BANDS,
  MAX_BACKOFF_INTERVAL_MS,
  DAY_MS,
  findBackoffBand,
} from "@/config/backoff-table";

describe("config/backoff-table.ts", () => {
  it("退避表有 4 条 band，按 minAbsenceHours 升序排列", () => {
    expect(BACKOFF_BANDS).toHaveLength(4);
    for (let i = 1; i < BACKOFF_BANDS.length; i++) {
      expect(BACKOFF_BANDS[i]!.minAbsenceHours).toBeGreaterThan(
        BACKOFF_BANDS[i - 1]!.minAbsenceHours
      );
    }
  });

  it("数值与 CONTEXT.md 退避表严格一致", () => {
    // 每天来 → null（保持正常频率）
    expect(BACKOFF_BANDS[0]).toMatchObject({
      minAbsenceHours: 0,
      intervalMs: null,
    });
    // ≥ 1 天 → 3 天
    expect(BACKOFF_BANDS[1]).toMatchObject({
      minAbsenceHours: 24,
      intervalMs: 3 * DAY_MS,
    });
    // ≥ 3 天 → 7 天
    expect(BACKOFF_BANDS[2]).toMatchObject({
      minAbsenceHours: 72,
      intervalMs: 7 * DAY_MS,
    });
    // ≥ 7 天 → 30 天（上限）
    expect(BACKOFF_BANDS[3]).toMatchObject({
      minAbsenceHours: 168,
      intervalMs: 30 * DAY_MS,
    });
  });

  it("MAX_BACKOFF_INTERVAL_MS = 30 天", () => {
    expect(MAX_BACKOFF_INTERVAL_MS).toBe(30 * DAY_MS);
  });

  it("findBackoffBand: 缺席 0 小时 → 每天来（intervalMs = null）", () => {
    expect(findBackoffBand(0).intervalMs).toBeNull();
    expect(findBackoffBand(0).label).toBe("每天来");
  });

  it("findBackoffBand: 缺席 1 小时 → 每天来（近 24h 内不设具体间隔）", () => {
    expect(findBackoffBand(1).intervalMs).toBeNull();
  });

  it("findBackoffBand: 缺席 23 小时 → 每天来（边界，仍未到 24h）", () => {
    expect(findBackoffBand(23).intervalMs).toBeNull();
  });

  it("findBackoffBand: 缺席 24 小时（=1 天）→ 3 天间隔（CONTEXT.md '≥ 1 天'）", () => {
    expect(findBackoffBand(24).intervalMs).toBe(3 * DAY_MS);
    expect(findBackoffBand(24).label).toBe("≥ 1 天");
  });

  it("findBackoffBand: 缺席 30 小时 → 3 天间隔", () => {
    expect(findBackoffBand(30).intervalMs).toBe(3 * DAY_MS);
  });

  it("findBackoffBand: 缺席 71 小时 → 3 天间隔（未到 72h）", () => {
    expect(findBackoffBand(71).intervalMs).toBe(3 * DAY_MS);
  });

  it("findBackoffBand: 缺席 72 小时（=3 天）→ 7 天间隔", () => {
    expect(findBackoffBand(72).intervalMs).toBe(7 * DAY_MS);
  });

  it("findBackoffBand: 缺席 100 小时 → 7 天间隔", () => {
    expect(findBackoffBand(100).intervalMs).toBe(7 * DAY_MS);
  });

  it("findBackoffBand: 缺席 167 小时 → 7 天间隔（未到 168h）", () => {
    expect(findBackoffBand(167).intervalMs).toBe(7 * DAY_MS);
  });

  it("findBackoffBand: 缺席 168 小时（=7 天）→ 30 天间隔", () => {
    expect(findBackoffBand(168).intervalMs).toBe(30 * DAY_MS);
  });

  it("findBackoffBand: 缺席 1680 小时（=70 天）→ 30 天间隔（上限）", () => {
    expect(findBackoffBand(1680).intervalMs).toBe(30 * DAY_MS);
  });

  it("findBackoffBand: 缺席 8760 小时（=1 年）→ 30 天间隔（永不消失，但极低频）", () => {
    expect(findBackoffBand(8760).intervalMs).toBe(30 * DAY_MS);
  });

  it("findBackoffBand: 负值视作 0（每天来）", () => {
    expect(findBackoffBand(-1).intervalMs).toBeNull();
  });

  it("findBackoffBand: NaN 视作 0（每天来）", () => {
    expect(findBackoffBand(Number.NaN).intervalMs).toBeNull();
  });
});
