/**
 * 文件名称：pets-backoff.test.ts
 * 功能描述：验证 pets.repo.updateNextProactiveTs 持久化退避时间戳（阶段 4 P1-001 修复）
 * 所属模块：tests/unit/persistence
 * 说明：
 *   - 覆盖 /api/sync 中「计算 backoff → 写回 pets.next_proactive_ts」路径
 *   - 断言 UPDATE SQL 正确包含 next_proactive_ts、updated_at、WHERE id
 *   - 断言参数顺序（nextProactiveTs, ts, petId）
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
import { updateNextProactiveTs } from "@/domain/persistence/repos/pets.repo";

describe("pets.repo.updateNextProactiveTs（阶段 4 P1-001 修复）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("写入 next_proactive_ts 到 pets 表", async () => {
    const petId = "pet-abc-123";
    const nextProactiveTs = 1_746_500_000_000; // 未来某时刻（UTC ms）
    const ts = 1_746_400_000_000;

    await updateNextProactiveTs(petId, nextProactiveTs, ts);

    expect(execute).toHaveBeenCalledTimes(1);
    const [_, sql, params] = (execute as any).mock.calls[0];
    expect(sql).toContain("UPDATE pets");
    expect(sql).toContain("next_proactive_ts = ?");
    expect(sql).toContain("updated_at = ?");
    expect(sql).toContain("WHERE id = ?");
    expect(params).toEqual([nextProactiveTs, ts, petId]);
  });

  it("nextProactiveTs=null（每天来 band）时可写入 null", async () => {
    const petId = "pet-x";
    await updateNextProactiveTs(petId, null, 1000);
    const [, , params] = (execute as any).mock.calls[0];
    expect(params).toEqual([null, 1000, petId]);
  });

  it("使用 Date.now() 默认 ts（未显式传参）", async () => {
    const before = Date.now();
    await updateNextProactiveTs("pet-z", 500);
    const after = Date.now();
    const [, , params] = (execute as any).mock.calls[0];
    expect(params[0]).toBe(500);
    expect(params[1]).toBeGreaterThanOrEqual(before);
    expect(params[1]).toBeLessThanOrEqual(after);
    expect(params[2]).toBe("pet-z");
  });
});
