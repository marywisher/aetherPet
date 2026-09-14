/**
 * 文件名称：timeline-split.test.ts
 * 功能描述：lib/timeline-split 单测（新旧分组纯函数）
 * 对应校验：
 *   - “你不在的时候”提示条的前端分组逻辑（阶段 6 收官，用户反馈混排问题）
 *   - 边界：boundary 缺失 / 空数组 / 全部新 / 全部旧 / 混合 / 相等时间戳
 */

import { describe, it, expect } from "vitest";
import { splitEventsByTs } from "@/lib/timeline-split";

interface Item {
  event: { ts: number };
}
const mk = (ts: number): Item => ({ event: { ts } });

describe("splitEventsByTs", () => {
  it("空数组 → 双空", () => {
    expect(splitEventsByTs<Item>([], 1000)).toEqual({ fresh: [], past: [] });
  });

  it("boundary 缺失（null/undefined/NaN）→ 全部归 past，不打扰", () => {
    const items = [mk(100), mk(200)];
    expect(splitEventsByTs(items, null)).toEqual({ fresh: [], past: items });
    expect(splitEventsByTs(items, undefined)).toEqual({ fresh: [], past: items });
    expect(splitEventsByTs(items, Number.NaN)).toEqual({ fresh: [], past: items });
  });

  it("全部事件都在窗口内 → 全部 fresh", () => {
    const items = [mk(300), mk(200), mk(100)];
    const r = splitEventsByTs(items, 100);
    expect(r.fresh).toEqual(items);
    expect(r.past).toEqual([]);
  });

  it("全部事件都早于窗口 → 全部 past", () => {
    const items = [mk(90), mk(50)];
    const r = splitEventsByTs(items, 100);
    expect(r.fresh).toEqual([]);
    expect(r.past).toEqual(items);
  });

  it("混合分组：fresh 保持入参顺序，past 保持入参顺序", () => {
    const items = [
      mk(500), // fresh
      mk(400), // fresh
      mk(300), // fresh（= boundary 边界值）
      mk(200), // past
      mk(100), // past
    ];
    const r = splitEventsByTs(items, 300);
    expect(r.fresh.map((i) => i.event.ts)).toEqual([500, 400, 300]);
    expect(r.past.map((i) => i.event.ts)).toEqual([200, 100]);
  });

  it("ts === boundary 视为 fresh（离线窗口含端点）", () => {
    const items = [mk(100), mk(100)];
    const r = splitEventsByTs(items, 100);
    expect(r.fresh).toHaveLength(2);
    expect(r.past).toHaveLength(0);
  });

  it("负数 / 0 时间戳正常处理", () => {
    const items = [mk(0), mk(-5)];
    const r = splitEventsByTs(items, -1);
    expect(r.fresh.map((i) => i.event.ts)).toEqual([0]);
    expect(r.past.map((i) => i.event.ts)).toEqual([-5]);
  });
});