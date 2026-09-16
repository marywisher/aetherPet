/**
 * 文件名称：season.test.ts
 * 功能描述：季节修饰件单测（seasonOfTs 边界 / seasonToneFor 确定性 / 排除类型）
 * 所属模块：tests/unit/domain/events
 * 契约对齐：docs/packs-contract.md §6.6（pack_schema 1.2.0）
 */

import { describe, it, expect } from "vitest";
import { seasonOfTs, seasonToneFor, type SeasonModifiers } from "@/domain/events/season";

const dayAt = (y: number, m: number, d: number, h = 12) =>
  Date.UTC(y, m - 1, d, h - 8); // 本地(UTC+8)时刻 → epoch ms

const MODS: SeasonModifiers = {
  spring: ["河边的樱花开了几朵，就那几朵", "菜园的土里顶出几支水仙", "在梅雨里趴了一上午，听雨"],
  summer: ["湖面的睡莲终于开了"],
  autumn: ["河边的桂花开了，风里都是甜的", "菜园的南瓜该摘了"],
  winter: ["第一场雪，我趴了一下午"],
};

const ev = (id: string, type: string, ts: number) => ({ id, ts, type }) as any;

describe("seasonOfTs（UTC+8 月份判季）", () => {
  it("3-5 月 = spring", () => {
    expect(seasonOfTs(dayAt(2026, 3, 1))).toBe("spring");
    expect(seasonOfTs(dayAt(2026, 5, 31))).toBe("spring");
  });
  it("6-8 月 = summer", () => {
    expect(seasonOfTs(dayAt(2026, 6, 15))).toBe("summer");
    expect(seasonOfTs(dayAt(2026, 8, 31))).toBe("summer");
  });
  it("9-11 月 = autumn", () => {
    expect(seasonOfTs(dayAt(2026, 9, 1))).toBe("autumn");
    expect(seasonOfTs(dayAt(2026, 11, 30))).toBe("autumn");
  });
  it("12-2 月 = winter（跨年）", () => {
    expect(seasonOfTs(dayAt(2026, 12, 1))).toBe("winter");
    expect(seasonOfTs(dayAt(2027, 1, 15))).toBe("winter");
    expect(seasonOfTs(dayAt(2027, 2, 28))).toBe("winter");
  });
  it("边界：跨季月份切换（2/28 vs 3/1）", () => {
    expect(seasonOfTs(dayAt(2027, 2, 28))).toBe("winter");
    expect(seasonOfTs(dayAt(2027, 3, 1))).toBe("spring");
  });
});

describe("seasonToneFor", () => {
  it("无 season_modifiers → null（旧包零改动）", () => {
    expect(seasonToneFor(ev("01AZ", "outing", dayAt(2026, 9, 15)), undefined)).toBeNull();
    expect(seasonToneFor(ev("01AZ", "outing", dayAt(2026, 9, 15)), null)).toBeNull();
  });

  it("该季数组为空 → null", () => {
    expect(
      seasonToneFor(ev("01AZ", "outing", dayAt(2026, 9, 15)), { autumn: [] })
    ).toBeNull();
  });

  it("system_announce / aggregate_summary 排除", () => {
    expect(seasonToneFor(ev("01AZ", "system_announce", dayAt(2026, 9, 15)), MODS)).toBeNull();
    expect(seasonToneFor(ev("01AZ", "aggregate_summary", dayAt(2026, 9, 15)), MODS)).toBeNull();
  });

  it("确定性：同一事件恒取同一条（重渲染/补算不漂移）", () => {
    const a = seasonToneFor(ev("01AZ", "outing", dayAt(2026, 9, 15)), MODS);
    const b = seasonToneFor(ev("01AZ", "outing", dayAt(2026, 9, 15)), MODS);
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it("取的是对应季节的条目（秋日事件不抽到雪）", () => {
    const autumnLine = seasonToneFor(ev("01AZ", "outing", dayAt(2026, 9, 15)), MODS);
    expect(MODS.autumn).toContain(autumnLine as string);
    const winterLine = seasonToneFor(ev("01AZ", "self_talk", dayAt(2026, 12, 20)), MODS);
    expect(winterLine).toBe("第一场雪，我趴了一下午");
  });

  it("不同事件 id 分布到不同行（池不塌缩为 1）", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const line = seasonToneFor(ev(`01AZ${i}`, "outing", dayAt(2026, 3, 10)), MODS);
      if (line) seen.add(line);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(seen.size).toBeLessThanOrEqual(MODS.spring!.length);
  });

  it("ts 决定季节：同一事件 11 月是秋、12 月是冬（补算回溯）", () => {
    const autumn = seasonToneFor(ev("01AZ", "counting_leaves", dayAt(2026, 11, 30)), MODS);
    const winter = seasonToneFor(ev("01AZ", "counting_leaves", dayAt(2026, 12, 1)), MODS);
    expect(MODS.autumn).toContain(autumn as string);
    expect(winter).toBe("第一场雪，我趴了一下午");
  });
});
