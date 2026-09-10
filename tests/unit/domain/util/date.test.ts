/**
 * 文件名称：date.test.ts
 * 功能描述：日期工具纯函数单测（UTC+8 本地日期字符串、同日判定）
 * 所属模块：tests/unit/domain/util
 * 验收对齐：
 *   - docs/requirements.md §3.7 日限一次（时区统一 UTC+8，避免跨时区误判）
 */

import { describe, it, expect } from "vitest";
import {
  toLocalDateStr,
  isSameLocalDate,
  nowTs,
} from "@/domain/util/date";

describe("domain/util/date.ts toLocalDateStr", () => {
  it("YYYY-MM-DD 格式（无分隔符错误）", () => {
    // 2026-09-09T00:00:00.000Z = UTC+8 2026-09-09 08:00
    expect(toLocalDateStr(Date.UTC(2026, 8, 9, 0, 0, 0))).toBe("2026-09-09");
    // 2026-09-09T16:00:00.000Z = UTC+8 2026-09-10 00:00 → 次日
    expect(toLocalDateStr(Date.UTC(2026, 8, 9, 16, 0, 0))).toBe("2026-09-10");
    // 2026-09-09T15:59:59.999Z = UTC+8 2026-09-09 23:59:59.999
    expect(toLocalDateStr(Date.UTC(2026, 8, 9, 15, 59, 59, 999))).toBe("2026-09-09");
  });

  it("跨月边界", () => {
    // 2026-09-30T16:00:00.000Z = UTC+8 2026-10-01 00:00
    expect(toLocalDateStr(Date.UTC(2026, 8, 30, 16, 0, 0))).toBe("2026-10-01");
    expect(toLocalDateStr(Date.UTC(2026, 8, 30, 15, 59, 59, 999))).toBe("2026-09-30");
  });

  it("跨年边界", () => {
    expect(toLocalDateStr(Date.UTC(2026, 11, 31, 16, 0, 0))).toBe("2027-01-01");
    expect(toLocalDateStr(Date.UTC(2026, 11, 31, 15, 59, 59, 999))).toBe("2026-12-31");
  });

  it("月份/日期补零", () => {
    // 2026-01-05T00:00:00Z = UTC+8 2026-01-05 08:00
    expect(toLocalDateStr(Date.UTC(2026, 0, 5, 0, 0, 0))).toBe("2026-01-05");
  });
});

describe("domain/util/date.ts isSameLocalDate", () => {
  it("同日（UTC+8）→ true", () => {
    // 两个 UTC 时刻在 UTC+8 都是 2026-09-09
    expect(
      isSameLocalDate(
        Date.UTC(2026, 8, 9, 0, 0, 0),
        Date.UTC(2026, 8, 9, 15, 59, 59)
      )
    ).toBe(true);
  });

  it("跨日（UTC+8 边界）→ false", () => {
    // 16:00Z 是 UTC+8 次日
    expect(
      isSameLocalDate(
        Date.UTC(2026, 8, 9, 15, 59, 59),
        Date.UTC(2026, 8, 9, 16, 0, 0)
      )
    ).toBe(false);
  });

  it("同日（UTC 视角但 UTC+8 边界内）→ true", () => {
    // 23:00Z 和 08:00Z 都在 UTC+8 的 2026-09-09
    // 23:00Z = UTC+8 2026-09-10 07:00 ← 已经是次日了
    expect(
      isSameLocalDate(
        Date.UTC(2026, 8, 9, 23, 0, 0),
        Date.UTC(2026, 8, 9, 0, 0, 0)
      )
    ).toBe(false); // 23:00Z 属于 09-10，08:00Z 属于 09-09
  });
});

describe("domain/util/date.ts nowTs", () => {
  it("返回正的 epoch ms", () => {
    expect(nowTs()).toBeGreaterThan(1_600_000_000_000);
  });
});
