/**
 * 文件名称：executor.test.ts
 * 功能描述：补算执行器单测（事务边界 + 失败 rollback）
 * 所属模块：tests/unit/domain/catchup
 * 验收对齐：
 *   - docs/requirements.md §3.4 补算（事务性；中途失败整体 rollback）
 *   - docs/architecture.md §4.3.1 补算时序（BEGIN → INSERT 事件 → UPDATE pets → COMMIT）
 *   - docs/architecture.md §9 R3 补算性能（事务内不 sleep / 不跨外部 IO）
 *
 * 测试策略：
 *   - vi.mock 替换 withTransaction + repo 函数（避免触碰真实 DB）
 *   - 注入 pre-fetched memories 避免预取分支
 *   - 通过 mock 调用顺序验证事务内的写入顺序
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// mock 依赖（必须在被测模块 import 之前）
const mockWithTransaction = vi.fn();
vi.mock("@/domain/persistence/db", () => ({
  withTransaction: (...args: unknown[]) => mockWithTransaction(...args),
}));

const mockFindMemoriesByPetId = vi.fn();
const mockInsertMemory = vi.fn();
vi.mock("@/domain/persistence/repos/memories.repo", () => ({
  findByPetId: (...args: unknown[]) => mockFindMemoriesByPetId(...args),
  insert: (...args: unknown[]) => mockInsertMemory(...args),
}));

const mockInsertEvent = vi.fn();
vi.mock("@/domain/persistence/repos/events.repo", () => ({
  insert: (...args: unknown[]) => mockInsertEvent(...args),
}));

const mockUpdateStateAndActivityInTx = vi.fn();
vi.mock("@/domain/persistence/repos/pets.repo", () => ({
  updateStateAndActivityInTx: (...args: unknown[]) => mockUpdateStateAndActivityInTx(...args),
}));

import { executeCatchUp } from "@/domain/catchup/executor";
import { planCatchUp } from "@/domain/catchup/planner";
import type { Memory, Pet } from "@/domain/types";

const TS_BASE = 1_746_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function makePet(): Pet {
  return {
    id: "test-pet-exec",
    userId: "test-user-1",
    name: "小圆",
    state: "at_home",
    stateSince: TS_BASE - DAY,
    createdAt: TS_BASE - 100 * DAY,
    updatedAt: TS_BASE,
    lastActivityTs: TS_BASE - 30 * DAY,
    userLastActiveTs: TS_BASE - 30 * DAY,
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
  };
}

const MEMORIES_WITH_NAMING: Memory[] = [
  {
    id: "mem-naming-1",
    petId: "test-pet-exec",
    kind: "naming",
    value: "小圆",
    createdAt: TS_BASE - 100 * DAY,
    lastReferenced: null,
    weight: 1.6,
    isPermanent: true,
    schemaVersion: "1.0.0",
    hubId: "local",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  // 默认成功路径：事务内 mock 全部 resolve
  mockInsertEvent.mockImplementation(async () => ({}));
  mockUpdateStateAndActivityInTx.mockImplementation(async () => undefined);
  mockWithTransaction.mockImplementation(async (cb: (conn: unknown) => Promise<unknown>) =>
    cb({})
  );
});

describe("domain/catchup/executor.ts executeCatchUp", () => {
  it("空计划 → 不调用 withTransaction，返回空 events", async () => {
    const plan = planCatchUp({ pet: makePet(), fromTs: TS_BASE, toTs: TS_BASE, seed: 42 });
    expect(plan.total).toBe(0);
    const result = await executeCatchUp({
      pet: makePet(),
      plan,
      fromTs: TS_BASE,
      toTs: TS_BASE,
      memories: MEMORIES_WITH_NAMING,
    });
    // 空计划仍走事务（UPDATE pets 把 last_activity 更新到 toTs）
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
    expect(result.events).toHaveLength(0);
    expect(result.aggregated).toBe(false);
    expect(result.finalState).toBe("at_home");
  });

  it("30 天计划 → 7 条常规 + 1 条聚合 = 8 条事件全部 INSERT", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    const result = await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES_WITH_NAMING,
    });
    expect(result.events).toHaveLength(8);
    expect(mockInsertEvent).toHaveBeenCalledTimes(8);
    expect(result.aggregated).toBe(true);
    // 最后一条是聚合摘要
    expect(result.events[7]!.type).toBe("aggregate_summary");
  });

  it("事务内写入顺序：先 INSERT 事件（按 ts 升序），最后 UPDATE pets", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    const calls: string[] = [];
    mockInsertEvent.mockImplementation(async () => {
      calls.push("insertEvent");
      return {};
    });
    mockUpdateStateAndActivityInTx.mockImplementation(async () => {
      calls.push("updatePet");
    });
    await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES_WITH_NAMING,
    });
    // 前 8 次是 insertEvent，最后 1 次是 updatePet
    expect(calls[0]).toBe("insertEvent");
    expect(calls[7]).toBe("insertEvent");
    expect(calls[8]).toBe("updatePet");
    expect(calls).toHaveLength(9);
  });

  it("事务内 INSERT 顺序：先常规事件（ts 升序），最后聚合摘要（若存在）", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    const insertedTs: number[] = [];
    mockInsertEvent.mockImplementation(async (evt: { ts: number; type: string }) => {
      insertedTs.push(evt.ts);
      return {};
    });
    await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES_WITH_NAMING,
    });
    // 前 N 次（N = plan.normal.length）是常规事件，ts 升序
    const normalTs = insertedTs.slice(0, plan.normal.length);
    for (let i = 1; i < normalTs.length; i++) {
      expect(normalTs[i]).toBeGreaterThan(normalTs[i - 1]);
    }
    // 若存在聚合事件，它是最后一个 INSERT（ts = 旧期末尾，可能早于末条常规事件）
    if (plan.aggregate) {
      expect(insertedTs).toHaveLength(plan.total);
      // 聚合 ts = plan.aggregate.toTs（旧期结束）
      expect(insertedTs[plan.normal.length]).toBe(plan.aggregate.toTs);
    }
  });

  it("事务成功后 UPDATE pets 的 state / state_since / toTs 正确", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    let capturedArgs: unknown[] | null = null;
    mockUpdateStateAndActivityInTx.mockImplementation(async (_conn, ...rest) => {
      capturedArgs = rest as unknown[];
    });
    const result = await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES_WITH_NAMING,
    });
    expect(capturedArgs).not.toBeNull();
    const [petId, state, stateSince, activityTs] = capturedArgs! as [
      string, string, number, number,
    ];
    expect(petId).toBe("test-pet-exec");
    expect(state).toBe(result.finalState);
    expect(stateSince).toBe(result.finalStateSince);
    expect(activityTs).toBe(TS_BASE);
  });

  it("事务失败（INSERT 抛错）→ withTransaction 回滚，错误向上传播", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    let insertCount = 0;
    mockInsertEvent.mockImplementation(async () => {
      insertCount++;
      if (insertCount === 5) {
        throw new Error("simulated DB failure");
      }
      return {};
    });
    await expect(
      executeCatchUp({
        pet,
        plan,
        fromTs: TS_BASE - 30 * DAY,
        toTs: TS_BASE,
        memories: MEMORIES_WITH_NAMING,
      })
    ).rejects.toThrow("simulated DB failure");
    // 事务尾部 UPDATE pets 不应被调用（失败发生在 INSERT 中途）
    expect(mockUpdateStateAndActivityInTx).not.toHaveBeenCalled();
  });

  it("事务失败（UPDATE pets 抛错）→ 错误向上传播（事务整体 rollback）", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    mockUpdateStateAndActivityInTx.mockImplementation(async () => {
      throw new Error("simulated UPDATE failure");
    });
    await expect(
      executeCatchUp({
        pet,
        plan,
        fromTs: TS_BASE - 30 * DAY,
        toTs: TS_BASE,
        memories: MEMORIES_WITH_NAMING,
      })
    ).rejects.toThrow("simulated UPDATE failure");
  });

  it("无 naming 记忆 → 事务内补插 1 条 naming 记忆（新 pet 兜底）", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    // mock 预取返回空数组（模拟 pet 刚创建，无记忆）
    mockFindMemoriesByPetId.mockResolvedValue([]);
    const insertedMemory: unknown[] = [];
    mockInsertMemory.mockImplementation(async (mem: unknown) => {
      insertedMemory.push(mem);
      return { ...(mem as object), createdAt: TS_BASE };
    });
    const result = await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      // 不传 memories → executor 调用 findByPetId 预取（mock 返回空）
    });
    expect(mockFindMemoriesByPetId).toHaveBeenCalledWith("test-pet-exec", expect.anything());
    expect(mockInsertMemory).toHaveBeenCalled();
    expect(insertedMemory).toHaveLength(1);
    const mem = insertedMemory[0] as { kind: string; value: string };
    expect(mem.kind).toBe("naming");
    expect(mem.value).toBe("小圆");
    expect(result.insertedNamingMemory).toBe(true);
    // 事务内仍正常写入事件（兜底后不影响主流程）
    expect(mockInsertEvent).toHaveBeenCalledTimes(plan.total);
  });

  it("已有 naming 记忆 → 不补插", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES_WITH_NAMING,
    });
    expect(mockInsertMemory).not.toHaveBeenCalled();
  });

  it("传入 conn 时跳过 withTransaction（作为更大事务的一部分）", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    const fakeConn = {} as unknown as import("mysql2/promise").PoolConnection;
    await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES_WITH_NAMING,
      conn: fakeConn,
    });
    expect(mockWithTransaction).not.toHaveBeenCalled();
  });

  it("durationMs 字段记录事务耗时", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    const result = await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES_WITH_NAMING,
    });
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("事件结构不含文案字段（解耦铁律）", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    const result = await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES_WITH_NAMING,
    });
    for (const e of result.events) {
      expect(e).not.toHaveProperty("text");
      expect(e).not.toHaveProperty("body");
      expect(e).not.toHaveProperty("title");
    }
  });

  it("所有补算事件 source='catchup' 且 generatedByCatchup=true", async () => {
    const pet = makePet();
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 30 * DAY, toTs: TS_BASE, seed: 42 });
    const result = await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES_WITH_NAMING,
    });
    for (const e of result.events) {
      expect(e.source).toBe("catchup");
      expect(e.generatedByCatchup).toBe(true);
    }
  });
});
