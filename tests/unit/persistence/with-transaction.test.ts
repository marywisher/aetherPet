/**
 * 文件名称：with-transaction.test.ts
 * 功能描述：withTransaction 回滚/提交/释放 端到端测试（P3-007）
 * 所属模块：tests/unit/persistence
 * 说明：
 *   - 通过可选 pool 参数注入假池（无需 mock 模块，直接走真实现）
 *   - 验证：成功→commit、失败→rollback、finally→release
 *   - 阶段 6 导入「失败整体回滚，不得半导入」依赖此基座
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "mysql2/promise";
import { withTransaction } from "@/domain/persistence/db";

function fakePool(): Pool {
  const conn = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
  const pool = {
    getConnection: vi.fn(async () => conn),
  } as unknown as Pool;
  return pool;
}

describe("withTransaction", () => {
  let pool: Pool;

  beforeEach(() => {
    pool = fakePool();
  });

  it("成功分支：begin → fn → commit → release（不 rollback）", async () => {
    const result = await withTransaction(async (conn) => {
      expect(conn).toBeTruthy();
      return "done";
    }, pool);
    expect(result).toBe("done");
    const conn = await (pool as any).getConnection();
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("失败分支：fn 抛错 → rollback → 错误继续上抛 → release", async () => {
    await expect(
      withTransaction(async () => {
        throw new Error("boom");
      }, pool)
    ).rejects.toThrow("boom");
    const conn = await (pool as any).getConnection();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("半途写入后失败：先写再抛，验证整体回滚语义（导入不得半导入）", async () => {
    const writes: string[] = [];
    await expect(
      withTransaction(async () => {
        writes.push("insert_a");
        writes.push("insert_b");
        throw new Error("mid-failure");
      }, pool)
    ).rejects.toThrow("mid-failure");
    expect(writes).toEqual(["insert_a", "insert_b"]); // 写入确实发生了
    const conn = await (pool as any).getConnection();
    expect(conn.rollback).toHaveBeenCalledTimes(1); // 但整体回滚
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("rollback 自身失败时不阻断原错误上抛", async () => {
    const conn = await (pool as any).getConnection();
    conn.rollback.mockImplementationOnce(() => {
      throw new Error("rollback failed");
    });
    const consoleErrs: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleErrs.push(args[0]);
    });
    await expect(
      withTransaction(async () => {
        throw new Error("original");
      }, pool)
    ).rejects.toThrow("original");
    // rollback 失败被记录但不替换原错误
    expect(consoleErrs.some((e) => String(e).includes("rollback failed"))).toBe(true);
    spy.mockRestore();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });
});