/**
 * 文件名称：pets-state.test.ts
 * 功能描述：验证 pets.repo.updateState 持久化 FSM 状态（阶段 2 Round 2 修复 P1-001）
 * 所属模块：tests/unit/persistence
 * 说明：
 *   - 使用 vi.mock 打桩 db 与 sql 层，验证 updateState 发出的 SQL 与参数
 *   - 覆盖：state、state_since、updated_at 均正确落库
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/domain/persistence/db", () => ({
  getPool: () => ({}),
}));
vi.mock("@/domain/persistence/sql", () => ({
  execute: vi.fn().mockResolvedValue({ affectedRows: 1 }),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

import { execute } from "@/domain/persistence/sql";
import { updateState, touchUserActivity } from "@/domain/persistence/repos/pets.repo";

describe("pets.repo.updateState（阶段 2 Round 2 · P1-001）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updateState 调用 UPDATE pets SET state, state_since, updated_at WHERE id", async () => {
    const petId = "pet-abc-123";
    const newState = "out_walking" as const;
    const newStateSince = 1_746_000_000_100;
    const ts = 1_746_000_000_150;

    await updateState(petId, newState, newStateSince, ts);

    expect(execute).toHaveBeenCalledTimes(1);
    const [, sql, params] = (execute as any).mock.calls[0];
    expect(sql).toContain("UPDATE pets");
    expect(sql).toContain("state = ?");
    expect(sql).toContain("state_since = ?");
    expect(sql).toContain("updated_at = ?");
    expect(sql).toContain("WHERE id = ?");
    expect(params).toEqual([newState, newStateSince, ts, petId]);
  });

  it("updateState 支持 from_home → out_walking 转换", async () => {
    await updateState("pet-x", "out_walking", 100, 200);
    const [, , params] = (execute as any).mock.calls[0];
    expect(params[0]).toBe("out_walking");
  });

  it("updateState 支持 out_walking → at_home 转换（P1-004 场景）", async () => {
    await updateState("pet-y", "at_home", 200, 300);
    const [, , params] = (execute as any).mock.calls[0];
    expect(params[0]).toBe("at_home");
  });

  it("updateState 支持 on_trip 状态持久化", async () => {
    await updateState("pet-z", "on_trip", 300, 400);
    const [, , params] = (execute as any).mock.calls[0];
    expect(params[0]).toBe("on_trip");
  });

  it("touchUserActivity 与 updateState 独立：不互相干扰", async () => {
    await touchUserActivity("pet-a", 100);
    await updateState("pet-a", "out_walking", 200, 300);

    expect(execute).toHaveBeenCalledTimes(2);
    const firstSql = (execute as any).mock.calls[0][1];
    const secondSql = (execute as any).mock.calls[1][1];
    expect(firstSql).toContain("user_last_active_ts");
    expect(secondSql).toContain("state = ?");
  });
});
