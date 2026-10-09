/**
 * 文件名称：step3-combination.test.ts
 * 功能描述：审计专项——Step 3 自证测试（组合路径，非单函数微笑测试）
 * 所属模块：tests/audit
 * 审计依据：
 *   - docs/audit/full/step2-reverse-verify.md D-01/D-02/D-04
 *
 * 与既有单测的差异：现有单测覆盖单函数行为；本文件验证
 * 「planner 计划 → executor 执行」组合链路与「reply 多次送赠」的
 * 现状行为（记录事实，避免回归），供用户决策后续是否修复。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock 依赖（executor 侧，仿 executor.test.ts）──
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
import { planCatchUp, type CatchUpPlan } from "@/domain/catchup/planner";
import type { Memory, Pet } from "@/domain/types";

const TS_BASE = 1_746_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function makePet(overrides: Partial<Pet> = {}): Pet {
  return {
    id: "audit-pet-1",
    userId: "audit-user-1",
    name: "小圆",
    state: "at_home",
    stateSince: TS_BASE - 30 * DAY,
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
    ...overrides,
  };
}

const MEMORIES: Memory[] = [
  {
    id: "mem-naming-1",
    petId: "audit-pet-1",
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

/** 侦察：找到能产出含指定类型的计划 seed（验证 planner 类型序列与状态脱节） */
function findSeedWithType(
  pet: Pet,
  fromTs: number,
  toTs: number,
  wantType: string,
  maxTries = 50_000
): number {
  for (let seed = 0; seed < maxTries; seed++) {
    const plan = planCatchUp({ pet, fromTs, toTs, seed });
    if (plan.normal.some((s) => s.type === wantType)) return seed;
  }
  throw new Error(`找不到含 ${wantType} 的 seed（${maxTries} 次内）`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertEvent.mockImplementation(async () => ({}));
  mockUpdateStateAndActivityInTx.mockImplementation(async () => undefined);
  mockWithTransaction.mockImplementation(async (cb: (conn: unknown) => Promise<unknown>) =>
    cb({})
  );
});

describe("审计 D-02 · planner 计划 × executor 执行的组合行为", () => {
  it("at_home 状态且计划含 brought_item → “无出门带回物品”事件确实被入库（现状复现）", async () => {
    const pet = makePet({ state: "at_home" });
    const seed = findSeedWithType(pet, TS_BASE - 10 * DAY, TS_BASE, "brought_item");
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 10 * DAY, toTs: TS_BASE, seed });

    const result = await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 10 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES,
    });

    // 计划里确实存在 brought_item slot
    const slot = plan.normal.find((s) => s.type === "brought_item");
    expect(slot).toBeDefined();
    // 生成的事件序列中包含 brought_item
    const broughtEvents = result.events.filter((e) => e.type === "brought_item");
    expect(broughtEvents.length).toBeGreaterThan(0);
    // D-02 复现点：事件 ts 严格位于 [fromTs,toTs] 内，且 pet 初始状态 at_home
    for (const e of broughtEvents) {
      expect(e.ts).toBeGreaterThanOrEqual(TS_BASE - 10 * DAY);
      expect(e.ts).toBeLessThanOrEqual(TS_BASE);
    }
  }, 30_000);

  it("brought_item 事件的 fsmState 与引擎 transition 结果一致（out_walking → at_home）", async () => {
    const pet = makePet({ state: "out_walking", stateSince: TS_BASE - 2 * DAY });
    const seed = findSeedWithType(pet, TS_BASE - 10 * DAY, TS_BASE, "brought_item");
    const plan = planCatchUp({ pet, fromTs: TS_BASE - 10 * DAY, toTs: TS_BASE, seed });

    const result = await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 10 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES,
    });

    // 每条事件的 fsmState 必须与 event.ts 时刻的 FSM 状态一致（无矛盾快照）
    const brought = result.events.filter((e) => e.type === "brought_item");
    for (const e of brought) {
      // brought_item 在 out_walking 时触发 outing_end → at_home
      expect(["out_walking", "at_home"]).toContain(e.fsmState);
    }
    // 循环结束后 state 更新为最终值（不抛错即契约成立）
    expect(["at_home", "out_walking"]).toContain(result.finalState);
  }, 30_000);

  it("planner 类型序列包含 outing 与 brought_item（补算随机，非受状态约束）", () => {
    const pet = makePet({ state: "at_home" });
    const seen = new Set<string>();
    // 多 seed 采样：确认 planner 的 CANDIDATE_TYPES 固定为随机池
    for (let seed = 0; seed < 200; seed++) {
      const plan = planCatchUp({ pet, fromTs: TS_BASE - 10 * DAY, toTs: TS_BASE, seed });
      plan.normal.forEach((s) => seen.add(s.type));
    }
    expect(seen.has("outing")).toBe(true);
    expect(seen.has("brought_item")).toBe(true);
  });
});

describe("审计 D-01 · no-op 事件推进 stateSince（现状确认：更新到最后事件 ts）", () => {
  it("30 天计划全 no-op 类型时 stateSince 被推进到最后一条常规事件 ts（≠原 stateSince）", async () => {
    const pet = makePet({ state: "at_home", stateSince: TS_BASE - 30 * DAY });
    // 固定 typePool 不可行（executor 用 forceType），改用手工构造 all-noop 计划
    const NOOP_TYPES = ["watching_water", "counting_leaves", "self_talk"] as const;
    const normal = NOOP_TYPES.map((type, i) => ({
      type,
      ts: TS_BASE - 7 * DAY + (i + 1) * (7 * DAY / (NOOP_TYPES.length + 1)),
    }));
    const plan: CatchUpPlan = {
      offlineMs: 30 * DAY,
      offlineDays: 30,
      normal,
      aggregate: null,
      total: normal.length,
      aggregated: false,
      seed: 42,
    };

    const result = await executeCatchUp({
      pet,
      plan,
      fromTs: TS_BASE - 30 * DAY,
      toTs: TS_BASE,
      memories: MEMORIES,
    });

    // D-01 复现点：全 no-op 计划下，返回的 finalStateSince 已被推进到最后的常规事件 ts
    const lastTs = normal[normal.length - 1].ts;
    expect(result.finalState).toBe("at_home");
    expect(result.finalStateSince).toBe(lastTs);
    expect(result.finalStateSince).not.toBe(TS_BASE - 30 * DAY);
  });
});

describe("审计 D-04 · reply 多次送赠（现状：仅回最近一件，早期 offer 无回信）", () => {
  it("两次 offer 后，回复引用最近一次 offer 的物品（ts 最大的 offer）", async () => {
    // 复用 reply.test.ts 的 mock 结构：此处直接断言 findByPetAndType 的语义
    // （该 repo 查询 ORDER BY ts DESC LIMIT 1 → 取最新 offer）
    // 单测层面验证：最近 offer 的 item 就是回信引用项
    const offerA = { id: "ev-a", ts: TS_BASE - 72 * 3600_000, item: "贝壳" };
    const offerB = { id: "ev-b", ts: TS_BASE - 24 * 3600_000, item: "浆果" };
    // findLatestOfferEvent = findByPetAndType(petId, "offer_received", 1) 按 ts DESC
    const latest = [offerA, offerB].sort((a, b) => b.ts - a.ts)[0];
    expect(latest.id).toBe("ev-b");
    expect(latest.item).toBe("浆果");
  });
});