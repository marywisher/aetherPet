/**
 * 文件名称：offer.test.ts
 * 功能描述：送赠单测（日限一次、事务写入、库存标记、所有权校验）
 * 所属模块：tests/unit/domain/gift
 * 验收对齐：
 *   - docs/requirements.md §3.7 送赠（用户主动摆放；日限一次；错过不惩罚）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWithTransaction = vi.fn();
vi.mock("@/domain/persistence/db", () => ({
  withTransaction: (...args: unknown[]) => mockWithTransaction(...args),
}));

const mockFindInventoryById = vi.fn();
const mockMarkOfferedInTx = vi.fn();
vi.mock("@/domain/persistence/repos/inventory.repo", () => ({
  findById: (...args: unknown[]) => mockFindInventoryById(...args),
  findUnofferedByUser: () => vi.fn().mockResolvedValue([]),
  markOfferedInTx: (...args: unknown[]) => mockMarkOfferedInTx(...args),
}));

const mockInsertEvent = vi.fn();
vi.mock("@/domain/persistence/repos/events.repo", () => ({
  insert: (...args: unknown[]) => mockInsertEvent(...args),
}));

const mockInsertMemory = vi.fn();
const mockFindMemoriesByPetId = vi.fn();
vi.mock("@/domain/persistence/repos/memories.repo", () => ({
  insert: (...args: unknown[]) => mockInsertMemory(...args),
  findByPetId: (...args: unknown[]) => mockFindMemoriesByPetId(...args),
}));

const mockMarkOfferInTx = vi.fn();
const mockFindPetById = vi.fn();
vi.mock("@/domain/persistence/repos/pets.repo", () => ({
  markOfferInTx: (...args: unknown[]) => mockMarkOfferInTx(...args),
  findById: (...args: unknown[]) => mockFindPetById(...args),
}));

const mockFindItemById = vi.fn();
vi.mock("@/domain/persistence/repos/items.repo", () => ({
  findById: (...args: unknown[]) => mockFindItemById(...args),
}));

import { offerInventoryItem, hasOfferedToday, validateInventoryForOffer, REPLY_DUE_MS } from "@/domain/gift/offer";
import { toLocalDateStr } from "@/domain/util/date";
import type { Inventory, Item, Pet } from "@/domain/types";

const TS_BASE = 1_746_000_000_000;
const PET_ID = "test-pet-offer";
const USER_ID = "test-user-1";

function makePet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: PET_ID,
    userId: USER_ID,
    name: "小圆",
    state: "at_home",
    stateSince: TS_BASE,
    createdAt: TS_BASE - 1000,
    updatedAt: TS_BASE,
    lastActivityTs: TS_BASE,
    userLastActiveTs: TS_BASE,
    nextProactiveTs: null,
    dailyGrantLastDate: "2026-09-08",
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

function makeInventory(overrides: Partial<Inventory> = {}): Inventory {
  return {
    id: "inv-001",
    userId: USER_ID,
    petId: PET_ID,
    itemId: "berry",
    acquiredAt: TS_BASE - 3600_000,
    offeredAt: null,
    consumedAt: null,
    grantedEventId: null,
    offeredEventId: null,
    consumedEventId: null,
    purchasedAt: null,
    paidCents: null,
    acquiredVia: "daily_grant",
    schemaVersion: "1.0.0",
    hubId: "local",
    ...overrides,
  };
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "berry",
    displayName: "浆果",
    description: null,
    iconPath: "icons/items/berry.png",
    rarityWeight: 1.2,
    category: "fruit",
    basePriceCents: null,
    currencyCode: null,
    schemaVersion: "1.0.0",
    hubId: "local",
    ...overrides,
  };
}

describe("domain/gift/offer.ts hasOfferedToday", () => {
  it("offerLastDate 等于今日 → true", () => {
    expect(hasOfferedToday(makePet({ offerLastDate: "2026-09-09" }), "2026-09-09")).toBe(true);
  });

  it("offerLastDate 不等于今日 → false", () => {
    expect(hasOfferedToday(makePet({ offerLastDate: "2026-09-08" }), "2026-09-09")).toBe(false);
  });

  it("offerLastDate=null → false", () => {
    expect(hasOfferedToday(makePet({ offerLastDate: null }), "2026-09-09")).toBe(false);
  });
});

describe("domain/gift/offer.ts validateInventoryForOffer", () => {
  it("inventory=null → inventory_not_found", () => {
    expect(
      validateInventoryForOffer(null, { userId: USER_ID, petId: PET_ID })
    ).toBe("inventory_not_found");
  });

  it("inventory.userId 不匹配 → inventory_not_owned", () => {
    expect(
      validateInventoryForOffer(
        makeInventory({ userId: "other" }),
        { userId: USER_ID, petId: PET_ID }
      )
    ).toBe("inventory_not_owned");
  });

  it("inventory.petId 不匹配 → inventory_not_owned", () => {
    expect(
      validateInventoryForOffer(
        makeInventory({ petId: "other-pet" }),
        { userId: USER_ID, petId: PET_ID }
      )
    ).toBe("inventory_not_owned");
  });

  it("inventory.offeredAt!=null → inventory_already_offered", () => {
    expect(
      validateInventoryForOffer(
        makeInventory({ offeredAt: TS_BASE - 1000, offeredEventId: "ev-x" }),
        { userId: USER_ID, petId: PET_ID }
      )
    ).toBe("inventory_already_offered");
  });

  it("正常情况 → undefined", () => {
    expect(
      validateInventoryForOffer(makeInventory(), { userId: USER_ID, petId: PET_ID })
    ).toBeUndefined();
  });
});

describe("domain/gift/offer.ts offerInventoryItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (fn: (conn: unknown) => Promise<unknown>) => {
      return fn({});
    });
    mockInsertEvent.mockResolvedValue(undefined);
    // P1-003 / P2-005：markOfferedInTx / markOfferInTx 默认返回 1（命中一行）
    mockMarkOfferedInTx.mockResolvedValue(1);
    mockMarkOfferInTx.mockResolvedValue(1);
    mockInsertMemory.mockResolvedValue(undefined);
    mockFindMemoriesByPetId.mockResolvedValue([]);
    mockFindPetById.mockResolvedValue(makePet());
    mockFindInventoryById.mockResolvedValue(makeInventory());
    mockFindItemById.mockResolvedValue(makeItem());
  });

  it("今日首次送赠 → 事务写入 event + inventory + pets + memory，返回 offered=true", async () => {
    const result = await offerInventoryItem({
      inventoryId: "inv-001",
      petId: PET_ID,
      userId: USER_ID,
      now: TS_BASE,
    });

    expect(result.offered).toBe(true);
    expect(result.event).toBeDefined();
    expect(result.event?.type).toBe("offer_received");
    expect(result.event?.source).toBe("gift");

    // inventory 更新
    expect(result.inventory?.offeredAt).toBe(TS_BASE);
    expect(result.inventory?.offeredEventId).toBe(result.event?.id);
    expect(result.inventory?.offeredEventId).not.toBeNull();

    // event 携带 item_id
    expect(result.event?.params.item_id).toBe("berry");
    expect(result.event?.params.item_display_name).toBe("浆果");

    // 事务内调用
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockMarkOfferedInTx).toHaveBeenCalledTimes(1);
    expect(mockMarkOfferInTx).toHaveBeenCalledTimes(1);
    expect(mockInsertMemory).toHaveBeenCalledTimes(1);

    // replyDueAt = now + 24h
    expect(result.replyDueAt).toBe(TS_BASE + REPLY_DUE_MS);
  });

  it("今日已送（skipReason='already_offered_today'）→ 无事务写入", async () => {
    const today = toLocalDateStr(TS_BASE);
    mockFindPetById.mockResolvedValue(makePet({ offerLastDate: today }));

    const result = await offerInventoryItem({
      inventoryId: "inv-001",
      petId: PET_ID,
      userId: USER_ID,
      now: TS_BASE,
    });

    expect(result.offered).toBe(false);
    expect(result.skipReason).toBe("already_offered_today");
    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockInsertEvent).not.toHaveBeenCalled();
  });

  it("inventory 不存在 → skipReason='inventory_not_found'", async () => {
    mockFindInventoryById.mockResolvedValue(null);
    const result = await offerInventoryItem({
      inventoryId: "missing",
      petId: PET_ID,
      userId: USER_ID,
      now: TS_BASE,
    });

    expect(result.offered).toBe(false);
    expect(result.skipReason).toBe("inventory_not_found");
  });

  it("inventory.userId 与 userId 不匹配 → skipReason='inventory_not_owned'", async () => {
    mockFindInventoryById.mockResolvedValue(makeInventory({ userId: "someone-else" }));
    const result = await offerInventoryItem({
      inventoryId: "inv-001",
      petId: PET_ID,
      userId: USER_ID,
      now: TS_BASE,
    });

    expect(result.offered).toBe(false);
    expect(result.skipReason).toBe("inventory_not_owned");
  });

  it("inventory 已送出（offeredAt!=null）→ skipReason='inventory_already_offered'", async () => {
    mockFindInventoryById.mockResolvedValue(
      makeInventory({ offeredAt: TS_BASE - 60_000, offeredEventId: "ev-x" })
    );
    const result = await offerInventoryItem({
      inventoryId: "inv-001",
      petId: PET_ID,
      userId: USER_ID,
      now: TS_BASE,
    });

    expect(result.offered).toBe(false);
    expect(result.skipReason).toBe("inventory_already_offered");
  });

  it("item 目录缺失（itemId 找不到）→ skipReason='item_not_found'", async () => {
    mockFindItemById.mockResolvedValue(null);
    const result = await offerInventoryItem({
      inventoryId: "inv-001",
      petId: PET_ID,
      userId: USER_ID,
      now: TS_BASE,
    });

    expect(result.offered).toBe(false);
    expect(result.skipReason).toBe("item_not_found");
  });

  it("pet 不存在 → 提前返回 skipReason='pet_not_found'（P2-001 修复）", async () => {
    mockFindPetById.mockResolvedValue(null);
    const result = await offerInventoryItem({
      inventoryId: "inv-001",
      petId: PET_ID,
      userId: USER_ID,
      now: TS_BASE,
    });

    expect(result.offered).toBe(false);
    expect(result.skipReason).toBe("pet_not_found");
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("事务失败 → 抛错（上层负责 rollback）", async () => {
    mockWithTransaction.mockRejectedValueOnce(new Error("db down"));

    await expect(
      offerInventoryItem({
        inventoryId: "inv-001",
        petId: PET_ID,
        userId: USER_ID,
        now: TS_BASE,
      })
    ).rejects.toThrow("db down");
  });

  it("写入 memory 时 kind='item_received' value=display_name", async () => {
    const result = await offerInventoryItem({
      inventoryId: "inv-001",
      petId: PET_ID,
      userId: USER_ID,
      now: TS_BASE,
    });

    expect(result.offered).toBe(true);
    const memArg = mockInsertMemory.mock.calls[0]?.[0];
    expect(memArg?.kind).toBe("item_received");
    expect(memArg?.value).toBe("浆果");
    expect(memArg?.petId).toBe(PET_ID);
  });

  // P1-003 并发幂等测试：条件 UPDATE affectedRows 判定
  describe("P1-003 并发幂等（markOfferInTx / markOfferedInTx）", () => {
    it("markOfferInTx affectedRows=0 → already_offered_today（并发另一请求已写 offer_last_date）", async () => {
      mockMarkOfferInTx.mockResolvedValueOnce(0);

      const result = await offerInventoryItem({
        inventoryId: "inv-001",
        petId: PET_ID,
        userId: USER_ID,
        now: TS_BASE,
      });

      expect(result.offered).toBe(false);
      expect(result.skipReason).toBe("already_offered_today");
      // 事务内 markOffer 已调用（第一道门），因返回 0 抛错 rollback
      expect(mockMarkOfferInTx).toHaveBeenCalledTimes(1);
      // markOffered 不该被调用（markOffer 早退）
      expect(mockMarkOfferedInTx).not.toHaveBeenCalled();
      expect(mockInsertEvent).not.toHaveBeenCalled();
      expect(mockInsertMemory).not.toHaveBeenCalled();
    });

    it("markOfferInTx 成功但 markOfferedInTx affectedRows=0 → inventory_already_offered", async () => {
      mockMarkOfferInTx.mockResolvedValue(1);
      mockMarkOfferedInTx.mockResolvedValueOnce(0);

      const result = await offerInventoryItem({
        inventoryId: "inv-001",
        petId: PET_ID,
        userId: USER_ID,
        now: TS_BASE,
      });

      expect(result.offered).toBe(false);
      expect(result.skipReason).toBe("inventory_already_offered");
      expect(mockMarkOfferInTx).toHaveBeenCalledTimes(1);
      expect(mockMarkOfferedInTx).toHaveBeenCalledTimes(1);
      // insertEvent / insertMemory 未写入（rollback）
      expect(mockInsertEvent).not.toHaveBeenCalled();
      expect(mockInsertMemory).not.toHaveBeenCalled();
    });

    it("正常写入（两个 markAffected=1）→ 事件写入 + memory 写入", async () => {
      mockMarkOfferInTx.mockResolvedValue(1);
      mockMarkOfferedInTx.mockResolvedValue(1);

      const result = await offerInventoryItem({
        inventoryId: "inv-001",
        petId: PET_ID,
        userId: USER_ID,
        now: TS_BASE,
      });

      expect(result.offered).toBe(true);
      expect(mockInsertEvent).toHaveBeenCalledTimes(1);
      expect(mockInsertMemory).toHaveBeenCalledTimes(1);
    });
  });
});
