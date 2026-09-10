/**
 * 文件名称：pet-fsm.test.ts
 * 功能描述：Pet FSM 转换规则全覆盖测试
 * 所属模块：tests/unit/domain/fsm
 * 验收对齐：docs/dev-stage-plan.md §3 阶段 2 单测覆盖 FSM 转换
 */

import { describe, it, expect } from "vitest";
import { transition, isLegalAction, listLegalActions } from "@/domain/fsm/pet-fsm";

describe("Pet FSM 转换规则", () => {
  it("at_home ──outing_start──► out_walking", () => {
    const result = transition("at_home", "outing_start", 1000);
    expect(result.state).toBe("out_walking");
    expect(result.changed).toBe(true);
    expect(result.stateSince).toBe(1000);
  });

  it("out_walking ──outing_end──► at_home", () => {
    const result = transition("out_walking", "outing_end", 2000);
    expect(result.state).toBe("at_home");
    expect(result.changed).toBe(true);
  });

  it("at_home ──trip_start──► on_trip（未来旅行玩法）", () => {
    const result = transition("at_home", "trip_start", 3000);
    expect(result.state).toBe("on_trip");
    expect(result.changed).toBe(true);
  });

  it("on_trip ──trip_end──► at_home", () => {
    const result = transition("on_trip", "trip_end", 4000);
    expect(result.state).toBe("at_home");
    expect(result.changed).toBe(true);
  });

  it("非法动作视为 no-op（on_trip + outing_start）", () => {
    const result = transition("on_trip", "outing_start", 5000);
    expect(result.state).toBe("on_trip");
    expect(result.changed).toBe(false);
  });

  it("非法动作视为 no-op（out_walking + trip_start）", () => {
    const result = transition("out_walking", "trip_start", 6000);
    expect(result.state).toBe("out_walking");
    expect(result.changed).toBe(false);
  });

  it("非法动作视为 no-op（at_home + outing_end，未出门不能结束）", () => {
    const result = transition("at_home", "outing_end", 7000);
    expect(result.state).toBe("at_home");
    expect(result.changed).toBe(false);
  });

  it("no_op 恒合法且不改变状态", () => {
    for (const state of ["at_home", "out_walking", "on_trip"] as const) {
      const result = transition(state, "no_op", 8000);
      expect(result.state).toBe(state);
      expect(result.changed).toBe(false);
    }
  });

  it("isLegalAction 校验：at_home 下 outing_start 合法", () => {
    expect(isLegalAction("at_home", "outing_start")).toBe(true);
  });

  it("isLegalAction 校验：out_walking 下 outing_end 合法", () => {
    expect(isLegalAction("out_walking", "outing_end")).toBe(true);
  });

  it("isLegalAction 校验：at_home 下 outing_end 非法", () => {
    expect(isLegalAction("at_home", "outing_end")).toBe(false);
  });

  it("isLegalAction 校验：no_op 恒合法", () => {
    expect(isLegalAction("at_home", "no_op")).toBe(true);
    expect(isLegalAction("out_walking", "no_op")).toBe(true);
    expect(isLegalAction("on_trip", "no_op")).toBe(true);
  });

  it("listLegalActions：at_home 允许 outing_start / trip_start / no_op", () => {
    const actions = listLegalActions("at_home");
    expect(actions).toContain("outing_start");
    expect(actions).toContain("trip_start");
    expect(actions).toContain("no_op");
    expect(actions).not.toContain("outing_end");
  });

  it("listLegalActions：on_trip 只允许 trip_end / no_op", () => {
    const actions = listLegalActions("on_trip");
    expect(actions).toContain("trip_end");
    expect(actions).toContain("no_op");
    expect(actions).not.toContain("outing_start");
  });

  it("转换 stateSince 更新为传入的 now", () => {
    const t0 = 1_000_000;
    const t1 = 2_000_000;
    const r0 = transition("at_home", "no_op", t0);
    const r1 = transition("at_home", "outing_start", t1);
    expect(r0.stateSince).toBe(t0);
    expect(r1.stateSince).toBe(t1);
  });
});
