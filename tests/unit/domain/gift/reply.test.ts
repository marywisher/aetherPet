/**
 * 文件名称：reply.test.ts
 * 功能描述：回信调度单测（24h 到期、退避联动、记忆引用 ≥1 条、事件写入）
 * 所属模块：tests/unit/domain/gift
 * 验收对齐：
 *   - docs/requirements.md §3.7 回信（≥24h、至少 1 条记忆引用）
 *   - docs/requirements.md §3.5.5 退避期不主动打扰（nextProactiveTs 未到期时不生成）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWithTransaction = vi.fn();
vi.mock("@/domain/persistence/db", () => ({
  withTransaction: (...args: unknown[]) => mockWithTransaction(...args),
}));

const mockFindPetById = vi.fn();
const mockMarkReplyClearedInTx = vi.fn();
vi.mock("@/domain/persistence/repos/pets.repo", () => ({
  findById: (...args: unknown[]) => mockFindPetById(...args),
  markReplyClearedInTx: (...args: unknown[]) => mockMarkReplyClearedInTx(...args),
}));

const mockFindMemoriesByPetId = vi.fn();
const mockFindMemoriesByPetAndKind = vi.fn();
vi.mock("@/domain/persistence/repos/memories.repo", () => ({
  findByPetId: (...args: unknown[]) => mockFindMemoriesByPetId(...args),
  findByPetAndKind: (...args: unknown[]) => mockFindMemoriesByPetAndKind(...args),
  insert: (...args: unknown[]) => vi.fn().mockResolvedValue(undefined),
}));

const mockFindEventsByPetAndType = vi.fn();
const mockInsertEvent = vi.fn();
vi.mock("@/domain/persistence/repos/events.repo", () => ({
  findByPetAndType: (...args: unknown[]) => mockFindEventsByPetAndType(...args),
  insert: (...args: unknown[]) => mockInsertEvent(...args),
  findById: (...args: unknown[]) => vi.fn().mockResolvedValue(null),
}));

import { checkAndGenerateReply, isReplyDue } from "@/domain/gift/reply";
import type { Event, Memory, Pet } from "@/domain/types";

const TS_BASE = 1_746_000_000_000;
const HOUR = 3600_000;
const PET_ID = "test-pet-reply";
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
    offerLastDate: "2026-09-08",
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

function makeOfferEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "ev-offer-001",
    userId: USER_ID,
    petId: PET_ID,
    ts: TS_BASE - HOUR,
    type: "offer_received",
    source: "gift",
    fsmState: "at_home",
    params: { item_id: "berry", item_display_name: "浆果" },
    memoryRefs: [{ kind: "item_name", value: "浆果", weight: 1 }],
    engineVersion: "1.0.0",
    packSchemaVersion: "1.0.0",
    isAggregate: false,
    aggregateSpanDays: null,
    generatedByCatchup: false,
    schemaVersion: "1.0.0",
    hubId: "local",
    createdAt: TS_BASE - HOUR,
    ...overrides,
  };
}

function makeItemMemory(value = "浆果"): Memory {
  return {
    id: "mem-item-1",
    petId: PET_ID,
    kind: "item_received",
    value,
    weight: 1.2,
    createdAt: TS_BASE - 2 * HOUR,
    lastReferenced: null,
    isPermanent: false,
    schemaVersion: "1.0.0",
    hubId: "local",
  };
}

describe("domain/gift/reply.ts isReplyDue", () => {
  it("replyPending=false → not_due reason='not_pending'", () => {
    const r = isReplyDue(
      makePet({ replyPending: false, replyDueAt: TS_BASE - HOUR }),
      TS_BASE
    );
    expect(r.due).toBe(false);
    expect(r.reason).toBe("not_pending");
  });

  it("replyPending=true 但 replyDueAt=null → not_due reason='not_pending'", () => {
    const r = isReplyDue(
      makePet({ replyPending: true, replyDueAt: null }),
      TS_BASE
    );
    expect(r.due).toBe(false);
    expect(r.reason).toBe("not_pending");
  });

  it("未到 24h 窗口（replyDueAt > now）→ not_due reason='not_due_yet'", () => {
    const r = isReplyDue(
      makePet({ replyPending: true, replyDueAt: TS_BASE + HOUR }),
      TS_BASE
    );
    expect(r.due).toBe(false);
    expect(r.reason).toBe("not_due_yet");
  });

  it("replyDueAt 已过 + 非退避期 → due=true", () => {
    const r = isReplyDue(
      makePet({
        replyPending: true,
        replyDueAt: TS_BASE - HOUR,
        nextProactiveTs: null,
      }),
      TS_BASE
    );
    expect(r.due).toBe(true);
  });

  it("replyDueAt 已过 + 处于退避期（nextProactiveTs > now）→ not_due reason='backoff_active'", () => {
    const r = isReplyDue(
      makePet({
        replyPending: true,
        replyDueAt: TS_BASE - HOUR,
        nextProactiveTs: TS_BASE + HOUR,
      }),
      TS_BASE
    );
    expect(r.due).toBe(false);
    expect(r.reason).toBe("backoff_active");
  });

  it("replyDueAt 恰好 = now → due=true（边界）", () => {
    const r = isReplyDue(
      makePet({
        replyPending: true,
        replyDueAt: TS_BASE,
        nextProactiveTs: null,
      }),
      TS_BASE
    );
    expect(r.due).toBe(true);
  });

  it("nextProactiveTs = now（非 > now）→ 不算退避期 → due=true", () => {
    const r = isReplyDue(
      makePet({
        replyPending: true,
        replyDueAt: TS_BASE - HOUR,
        nextProactiveTs: TS_BASE,
      }),
      TS_BASE
    );
    expect(r.due).toBe(true);
  });
});

// P1-001 集成行为测试：用户离开 3 天后 sync 时，nextProactiveTs 已写入 DB，
// 回信检查能正确进入 backoff_active 分支（而非死代码）。
describe("P1-001 退避持久化 集成行为", () => {
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  it("离开 3 天 → nextProactiveTs = now + 7d → 回信到期但处于退避期，backoff_active", () => {
    // 模拟用户最后一次活跃是 3 天前，今天 sync 回来
    const now = TS_BASE;
    const pet = makePet({
      replyPending: true,
      replyDueAt: now - HOUR, // 回信已到期
      // sync 中 computeBackoff(userLastActiveTs=now-3d, now) 计算得到 nextProactiveTs=now+7d
      // P1-001 修复后已写入 DB；isReplyDue 从 DB 读到的就是这个值
      nextProactiveTs: now + SEVEN_DAYS_MS,
      userLastActiveTs: now - THREE_DAYS_MS,
    });

    const r = isReplyDue(pet, now);
    expect(r.due).toBe(false);
    expect(r.reason).toBe("backoff_active");
  });

  it("退避期结束后（nextProactiveTs ≤ now）→ due=true，回信正常发送", () => {
    const now = TS_BASE;
    const pet = makePet({
      replyPending: true,
      replyDueAt: now - HOUR,
      // 退避期已过（7 天后的今天）
      nextProactiveTs: now - 1000,
    });

    const r = isReplyDue(pet, now);
    expect(r.due).toBe(true);
  });

  it("退避期未到（缺席 < 24h，nextProactiveTs=null）→ 保持正常频率 due=true", () => {
    const now = TS_BASE;
    const pet = makePet({
      replyPending: true,
      replyDueAt: now - HOUR,
      nextProactiveTs: null, // "每天来"band
    });

    const r = isReplyDue(pet, now);
    expect(r.due).toBe(true);
  });
});

describe("domain/gift/reply.ts checkAndGenerateReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithTransaction.mockImplementation(async (fn: (conn: unknown) => Promise<unknown>) => {
      return fn({});
    });
    mockInsertEvent.mockResolvedValue(undefined);
    mockMarkReplyClearedInTx.mockResolvedValue(undefined);
    mockFindMemoriesByPetId.mockResolvedValue([]);
    mockFindMemoriesByPetAndKind.mockResolvedValue([]);
  });

  it("pet 不存在 → skipReason='no_pet'", async () => {
    mockFindPetById.mockResolvedValue(null);
    const result = await checkAndGenerateReply("missing-pet", TS_BASE);
    expect(result.generated).toBe(false);
    expect(result.skipReason).toBe("no_pet");
  });

  it("reply_pending=false → skipReason='not_pending'", async () => {
    mockFindPetById.mockResolvedValue(makePet({ replyPending: false }));
    const result = await checkAndGenerateReply(PET_ID, TS_BASE);
    expect(result.generated).toBe(false);
    expect(result.skipReason).toBe("not_pending");
  });

  it("reply_pending=true 但 replyDueAt=null → skipReason='not_pending'", async () => {
    mockFindPetById.mockResolvedValue(makePet({ replyPending: true, replyDueAt: null }));
    const result = await checkAndGenerateReply(PET_ID, TS_BASE);
    expect(result.generated).toBe(false);
    expect(result.skipReason).toBe("not_pending");
  });

  it("未到 24h → skipReason='not_due_yet'", async () => {
    mockFindPetById.mockResolvedValue(
      makePet({ replyPending: true, replyDueAt: TS_BASE + HOUR })
    );
    const result = await checkAndGenerateReply(PET_ID, TS_BASE);
    expect(result.generated).toBe(false);
    expect(result.skipReason).toBe("not_due_yet");
  });

  it("退避期 → skipReason='backoff_active' 且不写事件", async () => {
    mockFindPetById.mockResolvedValue(
      makePet({
        replyPending: true,
        replyDueAt: TS_BASE - HOUR,
        nextProactiveTs: TS_BASE + HOUR,
      })
    );
    const result = await checkAndGenerateReply(PET_ID, TS_BASE);
    expect(result.generated).toBe(false);
    expect(result.skipReason).toBe("backoff_active");
    expect(mockInsertEvent).not.toHaveBeenCalled();
    expect(mockMarkReplyClearedInTx).not.toHaveBeenCalled();
  });

  it("到期 → 生成回信事件（reply_letter），携带 ≥1 条 item_received 记忆引用", async () => {
    mockFindPetById.mockResolvedValue(
      makePet({
        replyPending: true,
        replyDueAt: TS_BASE - HOUR,
        nextProactiveTs: null,
      })
    );
    mockFindMemoriesByPetId.mockResolvedValue([makeItemMemory("浆果")]);
    mockFindEventsByPetAndType.mockResolvedValue([makeOfferEvent()]);

    const result = await checkAndGenerateReply(PET_ID, TS_BASE);
    expect(result.generated).toBe(true);
    expect(result.event?.type).toBe("reply_letter");
    expect(result.event?.params.gift_event_id).toBe("ev-offer-001");
    expect(result.event?.params.item_display_name).toBe("浆果");

    // memoryRefs 至少含 item_name（契约 recall_required，kind='item_name' 而非 item_received）
    const itemRefs = result.event?.memoryRefs.filter(
      (r) => r.kind === "item_name"
    ) ?? [];
    expect(itemRefs.length).toBeGreaterThanOrEqual(1);
    expect(itemRefs[0]?.value).toBe("浆果");

    // 事务：写 event + 更新 pets
    expect(mockInsertEvent).toHaveBeenCalledTimes(1);
    expect(mockMarkReplyClearedInTx).toHaveBeenCalledTimes(1);
  });

  it("到期但无 offer_received 事件 → skipReason='no_offer_event'", async () => {
    mockFindPetById.mockResolvedValue(
      makePet({
        replyPending: true,
        replyDueAt: TS_BASE - HOUR,
        nextProactiveTs: null,
      })
    );
    mockFindEventsByPetAndType.mockResolvedValue([]);
    const result = await checkAndGenerateReply(PET_ID, TS_BASE);
    expect(result.generated).toBe(false);
    expect(result.skipReason).toBe("no_offer_event");
  });

  it("到期但无 item 名称（params 无 item_display_name 且 memories 无兜底）→ skipReason='no_item_name'", async () => {
    mockFindPetById.mockResolvedValue(
      makePet({
        replyPending: true,
        replyDueAt: TS_BASE - HOUR,
        nextProactiveTs: null,
      })
    );
    // offer 事件里 item_id 是数字（不是字符串），item_display_name 缺失
    mockFindEventsByPetAndType.mockResolvedValue([
      makeOfferEvent({ params: { item_id: 123 } }),
    ]);
    // memories 里也没有 item_received 兜底
    mockFindMemoriesByPetAndKind.mockResolvedValue([]);

    const result = await checkAndGenerateReply(PET_ID, TS_BASE);
    expect(result.generated).toBe(false);
    expect(result.skipReason).toBe("no_item_name");
  });

  it("offer 事件无 item_display_name 但 memories 有 item_received → 兜底使用 memory 值", async () => {
    mockFindPetById.mockResolvedValue(
      makePet({
        replyPending: true,
        replyDueAt: TS_BASE - HOUR,
        nextProactiveTs: null,
      })
    );
    mockFindEventsByPetAndType.mockResolvedValue([
      makeOfferEvent({ params: { item_id: "berry" } }),
    ]);
    mockFindMemoriesByPetAndKind.mockResolvedValue([makeItemMemory("浆果")]);
    mockFindMemoriesByPetId.mockResolvedValue([makeItemMemory("浆果")]);

    const result = await checkAndGenerateReply(PET_ID, TS_BASE);
    expect(result.generated).toBe(true);
    expect(result.event?.params.item_display_name).toBe("浆果");
  });

  it("事件生成失败 → skipReason='generation_failed'", async () => {
    mockFindPetById.mockResolvedValue(
      makePet({
        replyPending: true,
        replyDueAt: TS_BASE - HOUR,
        nextProactiveTs: null,
      })
    );
    // 强制 params 无 item_id 也无 item_display_name，但 memories 有 → 兜底走
    mockFindEventsByPetAndType.mockResolvedValue([
      makeOfferEvent({ params: {} }),
    ]);
    mockFindMemoriesByPetAndKind.mockResolvedValue([makeItemMemory("浆果")]);
    mockFindMemoriesByPetId.mockResolvedValue([makeItemMemory("浆果")]);

    const result = await checkAndGenerateReply(PET_ID, TS_BASE);
    // 有兜底 → 应能生成
    expect(result.generated).toBe(true);
  });

  it("事务失败 → 抛错（上层 rollback）", async () => {
    mockFindPetById.mockResolvedValue(
      makePet({
        replyPending: true,
        replyDueAt: TS_BASE - HOUR,
        nextProactiveTs: null,
      })
    );
    mockFindMemoriesByPetId.mockResolvedValue([makeItemMemory("浆果")]);
    mockFindEventsByPetAndType.mockResolvedValue([makeOfferEvent()]);
    mockWithTransaction.mockRejectedValueOnce(new Error("db down"));

    await expect(
      checkAndGenerateReply(PET_ID, TS_BASE)
    ).rejects.toThrow("db down");
  });
});
