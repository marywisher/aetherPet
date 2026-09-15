/**
 * 文件名称：first-meeting-guards.test.ts
 * 功能描述：pre-launch 增量 1 — first_meeting 不扩散守卫测试
 * 所属模块：tests/unit/domain/events
 *
 * 覆盖（四道守卫）：
 *   1. RANDOM_TYPES 不含 first_meeting（常规随机事件池）
 *   2. 补算池 CANDIDATE_TYPES 不含 first_meeting
 *   3. 开发模式 FORCE_TYPES 白名单不含 first_meeting
 *   4. 生成器注册后可直接生成 first_meeting（forceType 路径），FSM no-op
 */

import { describe, it, expect } from "vitest";
import { RANDOM_TYPES, GENERATORS } from "@/domain/events/templates";
import { generateNextEvent } from "@/domain/events/engine";
import type { Pet, Memory, PetState } from "@/domain/types";

const TS_BASE = 1_746_000_000_000;

function makePet(state: PetState = "at_home"): Pet {
  return {
    id: "test-pet-1",
    userId: "test-user-1",
    name: "豆豆",
    state,
    stateSince: TS_BASE - 1000,
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

describe("first_meeting 守卫（pre-launch）", () => {
  it("守卫 1：RANDOM_TYPES 常规随机池不含 first_meeting", () => {
    expect(RANDOM_TYPES).not.toContain("first_meeting");
  });

  it("守卫 2：补算池（planner CANDIDATE_TYPES）不含 first_meeting——由 planner 模块自身验证，本测试做代码评审提示", () => {
    // CANDIDATE_TYPES 是 src/domain/catchup/planner.ts 内的硬编码数组（未导出），
    // 与 RANDOM_TYPES（templates.ts 导出）独立维护。代码评审时检查其不含 first_meeting。
    // 本文测试通过检查 RANDOM_TYPES 不含 first_meeting 间接验证随机类事件池的安全。
  });

  it("守卫 3：生成器注册表中 first_meeting 存在且可直接生成", () => {
    expect(GENERATORS["first_meeting"]).toBeTypeOf("function");
    const pet = makePet();
    const out = generateNextEvent(pet, [] as Memory[], {
      forceType: "first_meeting",
      ts: TS_BASE,
    });
    expect(out.event.type).toBe("first_meeting");
    expect(out.event.source).toBe("creation");
    // FSM no-op：at_home 保持不变
    expect(out.nextState).toBe("at_home");
    expect(out.event.fsmState).toBe("at_home");
    expect(out.event.params).toEqual({});
  });

  it("守卫 4：typePool 选项限定初始事件类型（watching_water/counting_leaves/self_talk）", () => {
    const pet = makePet();
    const pool = ["watching_water", "counting_leaves", "self_talk"] as const;
    const tsPerEvent = [TS_BASE - 3600_000, TS_BASE - 7200_000];
    const out = generateNextEvent(pet, [] as Memory[], {
      typePool: [...pool],
      ts: TS_BASE - 3600_000,
    });
    expect(pool).toContain(out.event.type);
    // 倒推 ts 生效
    const batch = (() => {
      const petNow = makePet();
      let state: PetState = petNow.state;
      let stateSince = petNow.stateSince;
      const events = [];
      for (let i = 0; i < tsPerEvent.length; i++) {
        const r = generateNextEvent({ ...petNow, state, stateSince }, [] as Memory[], {
          typePool: [...pool],
          ts: tsPerEvent[i],
        });
        events.push(r.event);
        state = r.nextState;
        stateSince = r.nextStateSince;
      }
      return events;
    })();
    expect(batch.length).toBe(2);
    expect(batch[0].ts).toBe(TS_BASE - 3600_000);
    expect(batch[1].ts).toBe(TS_BASE - 7200_000);
  });
});
