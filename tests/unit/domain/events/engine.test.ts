/**
 * 文件名称：engine.test.ts
 * 功能描述：事件引擎端到端 FSM 状态流转测试（阶段 2 Round 2 修复 P1-001/002/004）
 * 所属模块：tests/unit/domain/events
 *
 * 覆盖：
 *   - P1-002：event.fsmState = 动作应用后的 pet 状态（与 nextState 一致）
 *   - P1-004：brought_item 触发 outing_end（out_walking → at_home）
 *   - P2-005：on_trip 状态候选集不含 outing（不再产生"旅行中又出门"矛盾事件）
 *   - 端到端 FSM 序列：at_home → outing → out_walking → brought_item → at_home
 */

import { describe, it, expect } from "vitest";
import { seededRng } from "@/domain/events/rng";
import { generateNextEvent, generateBatchEvents } from "@/domain/events/engine";
import { transition } from "@/domain/fsm/pet-fsm";
import type { Pet, Memory, PetState } from "@/domain/types";

const TS_BASE = 1_746_000_000_000;

function makePet(state: PetState, stateSince: number = TS_BASE - 1000): Pet {
  return {
    id: "test-pet-1",
    userId: "test-user-1",
    name: "豆豆",
    state,
    stateSince,
    createdAt: TS_BASE - 2000,
    updatedAt: TS_BASE - 1000,
    lastActivityTs: TS_BASE - 1000,
    userLastActiveTs: TS_BASE - 1000,
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

const MEMORIES: Memory[] = [
  {
    id: "mem-naming-1",
    petId: "test-pet-1",
    kind: "naming",
    value: "豆豆",
    createdAt: TS_BASE - 2000,
    lastReferenced: null,
    weight: 1.6,
    isPermanent: true,
    schemaVersion: "1.0.0",
    hubId: "local",
  },
];

describe("engine.ts 端到端 FSM 状态流转（阶段 2 Round 2）", () => {
  it("outing 事件：event.fsmState = 动作应用后（out_walking），与 nextState 一致", () => {
    const pet = makePet("at_home");
    const out = generateNextEvent(pet, MEMORIES, {
      forceType: "outing",
      ts: TS_BASE + 100,
      rng: seededRng(42),
      hubId: "local",
    });
    expect(out.event.type).toBe("outing");
    expect(out.nextState).toBe("out_walking");
    // P1-002 核心断言：event.fsmState 与 nextState 一致，且是转换后的状态
    expect(out.event.fsmState).toBe(out.nextState);
    expect(out.event.fsmState).toBe("out_walking");
  });

  it("brought_item 事件：触发 outing_end，out_walking → at_home（P1-004）", () => {
    const pet = makePet("out_walking");
    const out = generateNextEvent(pet, MEMORIES, {
      forceType: "brought_item",
      ts: TS_BASE + 200,
      rng: seededRng(42),
      hubId: "local",
    });
    expect(out.event.type).toBe("brought_item");
    expect(out.nextState).toBe("at_home");
    expect(out.event.fsmState).toBe("at_home");
  });

  it("brought_item 事件在 at_home 状态下：FSM no-op，事件仍入库", () => {
    const pet = makePet("at_home");
    const out = generateNextEvent(pet, MEMORIES, {
      forceType: "brought_item",
      ts: TS_BASE + 300,
      rng: seededRng(42),
      hubId: "local",
    });
    // 事件仍然生成（不报错）
    expect(out.event.type).toBe("brought_item");
    // FSM 视为 no-op（isLegalAction 校验拒绝），状态保持 at_home
    expect(out.nextState).toBe("at_home");
    expect(out.event.fsmState).toBe("at_home");
  });

  it("端到端 FSM 序列：at_home → outing → out_walking → brought_item → at_home", () => {
    let pet = makePet("at_home");
    const rng = seededRng(2026);

    // Step 1: 出门
    const step1 = generateNextEvent(pet, MEMORIES, {
      forceType: "outing", ts: TS_BASE + 100, rng, hubId: "local",
    });
    expect(step1.nextState).toBe("out_walking");
    pet = { ...pet, state: step1.nextState, stateSince: step1.nextStateSince };

    // Step 2: 回家（带回物品）
    const step2 = generateNextEvent(pet, MEMORIES, {
      forceType: "brought_item", ts: TS_BASE + 200, rng, hubId: "local",
    });
    expect(step2.nextState).toBe("at_home");
    pet = { ...pet, state: step2.nextState, stateSince: step2.nextStateSince };

    // 验证：pet 完成了一轮"出门→回家"循环，回到 at_home
    expect(pet.state).toBe("at_home");
  });

  it("no_op 事件（如 self_talk）：event.fsmState 与 pet 当前状态一致", () => {
    const pet = makePet("out_walking");
    const out = generateNextEvent(pet, MEMORIES, {
      forceType: "self_talk", ts: TS_BASE + 400, rng: seededRng(42), hubId: "local",
    });
    expect(out.nextState).toBe("out_walking");
    expect(out.event.fsmState).toBe("out_walking");
    // stateSince 应等于 event.ts（因为 transition 会重设 stateSince = now）
    expect(out.nextStateSince).toBe(TS_BASE + 400);
  });

  it("on_trip 状态候选集不含 outing（P2-005 修复）", () => {
    // on_trip 状态下随机生成 20 次，不应出现"旅行中又出门"（outing）事件
    const pet = makePet("on_trip");
    const types = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const out = generateNextEvent(pet, MEMORIES, {
        ts: TS_BASE + i * 100,
        rng: seededRng(i),
        hubId: "local",
      });
      types.add(out.event.type);
    }
    expect(types.has("outing")).toBe(false);
    // 应只包含 on_trip 允许的类型
    for (const t of types) {
      expect(["self_talk", "spontaneous_letter"]).toContain(t);
    }
  });

  it("out_walking 状态候选集不含 outing（避免'重复出门'）", () => {
    const pet = makePet("out_walking");
    const types = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const out = generateNextEvent(pet, MEMORIES, {
        ts: TS_BASE + i * 100,
        rng: seededRng(i),
        hubId: "local",
      });
      types.add(out.event.type);
    }
    expect(types.has("outing")).toBe(false);
    // out_walking 不允许 brought_item（brought_item 作为"散步结束"的自然产物，
    // 由 route 单独触发，或阶段 3 补算）
    expect(types.has("brought_item")).toBe(false);
  });

  it("at_home 状态候选集：outing 可被随机选中", () => {
    const pet = makePet("at_home");
    const types = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const out = generateNextEvent(pet, MEMORIES, {
        ts: TS_BASE + i * 100,
        rng: seededRng(i),
        hubId: "local",
      });
      types.add(out.event.type);
    }
    // at_home 状态下 outing 应该在候选集内
    expect(types.has("outing")).toBe(true);
  });

  it("generateBatchEvents：finalState 反映整批事件后的最终 FSM 状态", () => {
    const pet = makePet("at_home");
    const { events, finalState, finalStateSince } = generateBatchEvents(
      pet, MEMORIES, 3, {
        ts: TS_BASE + 100,
        rng: seededRng(7),
        hubId: "local",
      }
    );
    expect(events.length).toBe(3);
    // finalState 是三条事件后 pet 的实际状态
    expect(["at_home", "out_walking", "on_trip"]).toContain(finalState);
    // 最后一条事件的 fsmState 应等于 finalState
    expect(events[events.length - 1].fsmState).toBe(finalState);
    expect(finalStateSince).toBeGreaterThan(0);
  });

  it("FSM 转换一致性：engine.nextState 与直接调用 transition 结果一致", () => {
    // 交叉验证：engine 内部 transition 调用是正确的
    const pet = makePet("at_home");
    const out = generateNextEvent(pet, MEMORIES, {
      forceType: "outing", ts: TS_BASE + 100, rng: seededRng(42), hubId: "local",
    });
    const expected = transition("at_home", "outing_start", TS_BASE + 100);
    expect(out.nextState).toBe(expected.state);
    expect(out.nextStateSince).toBe(expected.stateSince);
    expect(out.event.fsmState).toBe(expected.state);
  });
});
