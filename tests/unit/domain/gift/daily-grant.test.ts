/**
 * 文件名称：daily-grant.test.ts
 * 功能描述：每日馈赠单测（日限一次、事务边界、fallback）
 * 所属模块：tests/unit/domain/gift
 * 验收对齐：
 *   - docs/requirements.md §3.7 每日馈赠（日限一次；错过不惩罚；事件不空）
 *   - docs/architecture.md §4.3.2 每日馈赠闭环
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWithTransaction = vi.fn();
vi.mock("@/domain/persistence/db", () => ({
  withTransaction: (...args: unknown[]) => mockWithTransaction(...args),
}));

const mockInsertInventory = vi.fn();
const mockFindRecentGrantItemIds = vi.fn();
vi.mock("@/domain/persistence/repos/inventory.repo", () => ({
  insert: (...args: unknown[]) => mockInsertInventory(...args),
  findRecentGrantItemIds: (...args: unknown[]) => mockFindRecentGrantItemIds(...args),
}));

const mockInsertEvent = vi.fn();
vi.mock("@/domain/persistence/repos/events.repo", () => ({
  insert: (...args: unknown[]) => mockInsertEvent(...args),
}));

const mockUpdateDailyGrantDateInTx = vi.fn();
const mockUpdateDailyGrantDate = vi.fn();
vi.mock("@/domain/persistence/repos/pets.repo", () => ({
  updateDailyGrantDateInTx: (...args: unknown[]) => mockUpdateDailyGrantDateInTx(...args),
  updateDailyGrantDate: (...args: unknown[]) => mockUpdateDailyGrantDate(...args),
}));

const mockFindMemories = vi.fn();
vi.mock("@/domain/persistence/repos/memories.repo", () => ({
  findByPetId: (...args: unknown[]) => mockFindMemories(...args),
}));

import { grantDailyItem, hasGrantedToday } from "@/domain/gift/daily-grant";
import { SEED_ITEMS } from "@/domain/gift/item-pool";
import { seededRng } from "@/domain/events/rng";
import { toLocalDateStr } from "@/domain/util/date";
import type { Memory, Pet } from "@/domain/types";

const TS_BASE = 1_746_000_000_000;

function makePet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: "test-pet-daily",
    userId: "test-user-1",
    name: "小圆",
    state: "at_home",
    stateSince: TS_BASE,
    createdAt: TS_BASE - 1000,
    updatedAt: TS_BASE,
    lastActivityTs: TS_BASE,
    userLastActiveTs: TS_BASE,
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
    ...overrides,
  };
}

const MEMORIES: Memory[] = [];

describe("domain/gift/daily-grant.ts hasGrantedToday", () => {
  it("dailyGrantLastDate 等于今日 → true", () => {
    expect(hasGrantedToday(makePet({ dailyGrantLastDate: "2026-09-09" }), "2026-09-09")).toBe(true);
  });

  it("dailyGrantLastDate 不等于今日 → false", () => {
    expect(hasGrantedToday(makePet({ dailyGrantLastDate: "2026-09-08" }), "2026-09-09")).toBe(false);
  });

  it("dailyGrantLastDate 为 null → false（首次登录）", () => {
    expect(hasGrantedToday(makePet({ dailyGrantLastDate: null }), "2026-09-09")).toBe(false);
  });
});

describe("domain/gift/daily-grant.ts grantDailyItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 mock：最近 3 次为空、事务内所有函数成功、找到 0 条记忆
    mockFindRecentGrantItemIds.mockResolvedValue([]);
    mockFindMemories.mockResolvedValue(MEMORIES);
    mockInsertInventory.mockResolvedValue(undefined);
    mockInsertEvent.mockResolvedValue(undefined);
    // P1-003：updateDailyGrantDateInTx 默认返回 1（正常命中一行）
    mockUpdateDailyGrantDateInTx.mockResolvedValue(1);
    // withTransaction 直接执行回调并传一个假 conn
    mockWithTransaction.mockImplementation(async (fn: (conn: unknown) => Promise<unknown>) => {
      return fn({});
    });
  });

  it("首次登录（dailyGrantLastDate=null）→ 生成事件 + 写 inventory + 更新 pets", async () => {
    const result = await grantDailyItem({
      pet: makePet(),
      rng: seededRng(42),
      now: TS_BASE,
    });

    expect(result.granted).toBe(true);
    expect(result.itemId).toBeDefined();
    expect(result.itemDisplayName).toBeDefined();
    expect(result.inventory).toBeDefined();
    expect(result.event).toBeDefined();
    expect(result.event?.type).toBe("daily_grant");
    expect(result.event?.source).toBe("gift");

    // 事务内调用顺序验证
    expect(mockInsertInventory).toHaveBeenCalledTimes(1);
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockUpdateDailyGrantDateInTx).toHaveBeenCalledTimes(1);

    // event 携带 item_id / item_display_name / inventory_id（P1-002 + P2-006 修复）
    expect(result.event?.params.item_id).toBe(result.itemId);
    expect(result.event?.params.item_display_name).toBe(result.itemDisplayName);
    // 关键断言：event.params.inventory_id 必须等于 result.inventory.id
    // 旧实现中 inventory_id 在事务后回填，DB 里永远为 null；本断言直接拦截 P1-002
    expect(result.event?.params.inventory_id).toBe(result.inventory?.id);
    expect(result.event?.params.inventory_id).not.toBeNull();

    // memoryRefs 至少含 item_name（契约 recall_required）
    const itemRef = result.event?.memoryRefs.find((r) => r.kind === "item_name");
    expect(itemRef?.value).toBe(result.itemDisplayName);
  });

  it("今日已领（dailyGrantLastDate=today）→ skipReason='already_granted_today'，无事务写入", async () => {
    const today = toLocalDateStr(TS_BASE);
    const result = await grantDailyItem({
      pet: makePet({ dailyGrantLastDate: today }),
      rng: seededRng(42),
      now: TS_BASE,
    });

    expect(result.granted).toBe(false);
    expect(result.skipReason).toBe("already_granted_today");
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockInsertEvent).not.toHaveBeenCalled();
  });

  it("排除最近 3 次重复：mock 返回 3 个最近 item_id，抽取结果不在其中", async () => {
    const excluded = [SEED_ITEMS[0].id, SEED_ITEMS[1].id, SEED_ITEMS[2].id];
    mockFindRecentGrantItemIds.mockResolvedValue(excluded);

    for (let seed = 0; seed < 20; seed++) {
      const result = await grantDailyItem({
        pet: makePet(),
        rng: seededRng(seed),
        now: TS_BASE,
      });
      expect(result.granted).toBe(true);
      expect(excluded).not.toContain(result.itemId ?? "");
    }
  });

  it("小池（3 项）+ 排除全部 → 回退到完整池（fellBackToUnrestricted=true）", async () => {
    const tinyPool = [SEED_ITEMS[0], SEED_ITEMS[1], SEED_ITEMS[2]];
    mockFindRecentGrantItemIds.mockResolvedValue(tinyPool.map((i) => i.id));

    const result = await grantDailyItem({
      pet: makePet(),
      rng: seededRng(3),
      now: TS_BASE,
      pool: tinyPool,
    });

    expect(result.granted).toBe(true);
    expect(result.fellBackToUnrestricted).toBe(true);
    // 结果在 tinyPool 中
    expect(tinyPool.some((i) => i.id === result.itemId)).toBe(true);
  });

  it("空池（pool=[]）→ skipReason='empty_pool' + fallbackMessage", async () => {
    const result = await grantDailyItem({
      pet: makePet(),
      rng: seededRng(1),
      now: TS_BASE,
      pool: [],
    });

    expect(result.granted).toBe(false);
    expect(result.skipReason).toBe("empty_pool");
    expect(result.fallbackMessage).toContain("小礼物");
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("事务失败 → 抛错（供上层 rollback）", async () => {
    mockWithTransaction.mockRejectedValueOnce(new Error("db down"));

    await expect(
      grantDailyItem({ pet: makePet(), rng: seededRng(1), now: TS_BASE })
    ).rejects.toThrow("db down");
  });

  it("excludedItemIds 反映最近的抽取历史", async () => {
    mockFindRecentGrantItemIds.mockResolvedValue(["berry", "stone"]);
    const result = await grantDailyItem({
      pet: makePet(),
      rng: seededRng(5),
      now: TS_BASE,
    });
    expect(result.excludedItemIds).toEqual(["berry", "stone"]);
  });

  // P1-003 并发幂等测试：条件 UPDATE affectedRows=0 → 事务 rollback → already_granted_today
  describe("P1-003 并发幂等（updateDailyGrantDateInTx affectedRows 判定）", () => {
    it("affectedRows=0 → 返回 already_granted_today（并发请求已处理今日）", async () => {
      mockUpdateDailyGrantDateInTx.mockResolvedValueOnce(0);

      const result = await grantDailyItem({
        pet: makePet(),
        rng: seededRng(1),
        now: TS_BASE,
      });

      expect(result.granted).toBe(false);
      expect(result.skipReason).toBe("already_granted_today");
      expect(result.inventory).toBeUndefined();
      expect(result.event).toBeUndefined();
      // 事务内仍调用了 insertInventory 和 insertEvent（在 update 之前），
      // 但因 affectedRows=0 抛错 → withTransaction rollback（真实环境）
      expect(mockInsertInventory).toHaveBeenCalledTimes(1);
      expect(mockInsertEvent).toHaveBeenCalledTimes(1);
      expect(mockUpdateDailyGrantDateInTx).toHaveBeenCalledTimes(1);
    });

    it("正常写入（affectedRows=1）→ granted=true 且 inventory_id 写入事件", async () => {
      // 默认 mock 已为 1，此处显式确认
      mockUpdateDailyGrantDateInTx.mockResolvedValue(1);

      const result = await grantDailyItem({
        pet: makePet(),
        rng: seededRng(7),
        now: TS_BASE,
      });

      expect(result.granted).toBe(true);
      expect(result.event?.params.inventory_id).toBe(result.inventory?.id);
    });
  });
});
