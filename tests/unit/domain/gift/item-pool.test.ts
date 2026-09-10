/**
 * 文件名称：item-pool.test.ts
 * 功能描述：物品池纯函数单测（≥8 种 seed、加权抽取、排除最近 3 次、空池兜底）
 * 所属模块：tests/unit/domain/gift
 * 验收对齐：
 *   - docs/requirements.md §3.7 物品池 ≥8 种、加权随机、排除最近 3 次重复、空池兜底文案
 */

import { describe, it, expect } from "vitest";
import {
  SEED_ITEMS,
  REPEAT_WINDOW,
  EMPTY_POOL_FALLBACK_MESSAGE,
  pickWeightedFromPool,
  pickWithExclusion,
  toItemsRow,
  type ItemSeed,
} from "@/domain/gift/item-pool";
import { seededRng } from "@/domain/events/rng";

describe("domain/gift/item-pool.ts SEED_ITEMS", () => {
  it("至少 8 种 seed 物品", () => {
    expect(SEED_ITEMS.length).toBeGreaterThanOrEqual(8);
  });

  it("每种物品都有 id / displayName / iconPath / rarityWeight / category", () => {
    for (const it of SEED_ITEMS) {
      expect(it.id).toMatch(/^[a-z0-9-]+$/);
      expect(it.displayName.length).toBeGreaterThan(0);
      expect(it.iconPath).toMatch(/^icons\//);
      expect(it.rarityWeight).toBeGreaterThan(0);
      expect(["fruit", "plant", "stone", "misc"]).toContain(it.category);
    }
  });

  it("id 唯一（无重复）", () => {
    const ids = new Set(SEED_ITEMS.map((i) => i.id));
    expect(ids.size).toBe(SEED_ITEMS.length);
  });

  it("REPEAT_WINDOW = 3（对齐需求「排除最近 3 次重复」）", () => {
    expect(REPEAT_WINDOW).toBe(3);
  });
});

describe("domain/gift/item-pool.ts pickWeightedFromPool", () => {
  it("空池返回 undefined", () => {
    expect(pickWeightedFromPool([], () => 0.5)).toBeUndefined();
  });

  it("单元素池 100% 返回该元素", () => {
    const item: ItemSeed = {
      id: "x",
      displayName: "X",
      description: null,
      iconPath: "icons/x.png",
      rarityWeight: 1,
      category: "misc",
    };
    for (let i = 0; i < 20; i++) {
      expect(pickWeightedFromPool([item], () => 0.5)?.id).toBe("x");
    }
  });

  it("权重越高的物品越常被抽到（1000 次采样，权重 10:1 时高频物品占比 ≥ 70%）", () => {
    const rng = seededRng(42);
    const heavy: ItemSeed = {
      id: "heavy",
      displayName: "重",
      description: null,
      iconPath: "icons/h.png",
      rarityWeight: 10,
      category: "misc",
    };
    const light: ItemSeed = {
      id: "light",
      displayName: "轻",
      description: null,
      iconPath: "icons/l.png",
      rarityWeight: 1,
      category: "misc",
    };
    let heavyCount = 0;
    for (let i = 0; i < 1000; i++) {
      const r = pickWeightedFromPool([heavy, light], rng);
      if (r?.id === "heavy") heavyCount++;
    }
    // 期望 heavy 占约 91%（10/11）；70% 是宽松下限
    expect(heavyCount / 1000).toBeGreaterThan(0.7);
  });
});

describe("domain/gift/item-pool.ts pickWithExclusion", () => {
  const pool = SEED_ITEMS;

  it("不排除时正常返回 picked", () => {
    const r = pickWithExclusion(pool, [], seededRng(1));
    expect(r.kind).toBe("picked");
    if (r.kind === "picked") {
      expect(r.fellBackToUnrestricted).toBe(false);
      expect(r.item).toBeDefined();
    }
  });

  it("排除 3 个 item 后仍从剩余池抽取", () => {
    const excludeIds = [SEED_ITEMS[0].id, SEED_ITEMS[1].id, SEED_ITEMS[2].id];
    for (let i = 0; i < 200; i++) {
      const r = pickWithExclusion(pool, excludeIds, seededRng(i));
      if (r.kind === "picked") {
        expect(r.fellBackToUnrestricted).toBe(false);
        expect(excludeIds).not.toContain(r.item.id);
      }
    }
  });

  it("排除长度 > REPEAT_WINDOW 时按最近 3 个截断", () => {
    // 提供 5 个 excludeIds，只有最近 3 个应生效
    const allButThree = SEED_ITEMS.map((i) => i.id).slice(0, 5);
    // 使用确定性 RNG 保证稳定
    const r = pickWithExclusion(pool, allButThree, seededRng(7));
    // 结果不应出现在 allButThree 的最后 3 个里
    if (r.kind === "picked") {
      const lastThree = allButThree.slice(-REPEAT_WINDOW);
      expect(lastThree).not.toContain(r.item.id);
    }
  });

  it("排除后池空（seed 数量 ≤ excludeIds 长度）→ 回退到完整池（fellBackToUnrestricted=true）", () => {
    const tinyPool: ItemSeed[] = [
      SEED_ITEMS[0],
      SEED_ITEMS[1],
      SEED_ITEMS[2],
    ];
    // 排除全部 3 个
    const excludeIds = tinyPool.map((i) => i.id);
    const r = pickWithExclusion(tinyPool, excludeIds, seededRng(3));
    expect(r.kind).toBe("picked");
    if (r.kind === "picked") {
      expect(r.fellBackToUnrestricted).toBe(true);
    }
  });

  it("空池返回 fallback 消息", () => {
    const r = pickWithExclusion([], [], seededRng(1));
    expect(r.kind).toBe("fallback");
    if (r.kind === "fallback") {
      expect(r.message).toBe(EMPTY_POOL_FALLBACK_MESSAGE);
      expect(r.reason).toBe("empty_pool");
    }
  });

  it("确定性 RNG 下 100 次抽样分布可复现", () => {
    const results1 = Array.from({ length: 100 }, (_, i) =>
      pickWithExclusion(pool, [], seededRng(i)).kind === "picked"
        ? (pickWithExclusion(pool, [], seededRng(i)) as { item: ItemSeed }).item.id
        : null
    );
    const results2 = Array.from({ length: 100 }, (_, i) =>
      pickWithExclusion(pool, [], seededRng(i)).kind === "picked"
        ? (pickWithExclusion(pool, [], seededRng(i)) as { item: ItemSeed }).item.id
        : null
    );
    expect(results1).toEqual(results2);
  });
});

describe("domain/gift/item-pool.ts toItemsRow", () => {
  it("字段映射正确", () => {
    const row = toItemsRow(SEED_ITEMS[0]);
    expect(row.id).toBe(SEED_ITEMS[0].id);
    expect(row.display_name).toBe(SEED_ITEMS[0].displayName);
    expect(row.description).toBe(SEED_ITEMS[0].description);
    expect(row.icon_path).toBe(SEED_ITEMS[0].iconPath);
    expect(row.rarity_weight).toBe(SEED_ITEMS[0].rarityWeight);
    expect(row.category).toBe(SEED_ITEMS[0].category);
  });
});
