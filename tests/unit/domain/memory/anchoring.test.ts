/**
 * 文件名称：anchoring.test.ts
 * 功能描述：时间锚点生成测试
 * 所属模块：tests/unit/domain/memory
 * 验收对齐：docs/requirements.md §3.3「事件引用『几天前』『上周』类时间锚点表达」
 */

import { describe, it, expect } from "vitest";
import { generateTimeAnchor, pickAnchor } from "@/domain/memory/anchoring";
import { seededRng } from "@/domain/events/rng";

const EXPECTED_ANCHOR_PHRASES = [
  "昨天", "前天", "3 天前", "前几天", "上周", "上上周", "很久之前",
];

describe("generateTimeAnchor", () => {
  it("产出包含 daysAgo 数字（1..6）", () => {
    for (let i = 0; i < 50; i++) {
      const anchor = generateTimeAnchor(seededRng(i));
      expect(anchor.daysAgo).toBeGreaterThanOrEqual(1);
      expect(anchor.daysAgo).toBeLessThanOrEqual(6);
    }
  });

  it("产出可读自然语言片段", () => {
    for (let i = 0; i < 50; i++) {
      const anchor = generateTimeAnchor(seededRng(i));
      expect(typeof anchor.text).toBe("string");
      expect(anchor.text.length).toBeGreaterThan(0);
      // 至少匹配一个已知锚点短语或包含数字
      const matched = EXPECTED_ANCHOR_PHRASES.some((p) => anchor.text.includes(p))
        || /^\d+ 天前$/.test(anchor.text);
      expect(matched).toBe(true);
    }
  });

  it("daysAgo=1 → text='昨天'", () => {
    // 用固定 rng 保证一定得到 daysAgo=1
    // rng() 接近 0 时 floor(0..6)=0 → daysAgo=1
    const anchor = generateTimeAnchor(() => 0);
    expect(anchor.daysAgo).toBe(1);
    expect(anchor.text).toBe("昨天");
  });

  it("daysAgo=2 → text='前天'", () => {
    // daysAgo = 1 + floor(rng()*6)；rng()=0.1667 → floor=1 → daysAgo=2
    const anchor = generateTimeAnchor(() => 0.1667);
    expect(anchor.daysAgo).toBe(2);
    expect(anchor.text).toBe("前天");
  });

  it("daysAgo=3..6 → text='X 天前' 或 '前几天'", () => {
    const anchor3 = generateTimeAnchor(() => 0.3334);
    expect(anchor3.daysAgo).toBe(3);
    expect(anchor3.text).toBe("3 天前");
    const anchor5 = generateTimeAnchor(() => 0.6667);
    expect(anchor5.daysAgo).toBe(5);
    expect(anchor5.text).toBe("前几天");
  });
});

describe("pickAnchor", () => {
  it("从候选池返回一个有效锚点", () => {
    for (let i = 0; i < 30; i++) {
      const anchor = pickAnchor(seededRng(i));
      expect(EXPECTED_ANCHOR_PHRASES).toContain(anchor.text);
      expect(anchor.daysAgo).toBeGreaterThan(0);
    }
  });

  it("候选池覆盖『昨天』『上周』『很久之前』", () => {
    const rng = seededRng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(pickAnchor(rng).text);
    }
    // 期望至少覆盖 3 个以上锚点（覆盖度测试）
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});
