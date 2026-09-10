/**
 * 文件名称：startup.test.ts
 * 功能描述：startup 状态机 + 自愈探测（P2-007）
 * 所属模块：tests/unit/lib
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// 在 mock 之前避免真实副作用
vi.mock("@/domain/persistence/db", () => ({
  initPool: vi.fn().mockResolvedValue(undefined as any),
  closePool: vi.fn().mockResolvedValue(undefined),
  getPool: () => ({ query: vi.fn(), execute: vi.fn() }),
  healthCheck: vi.fn(),
  withTransaction: vi.fn(),
  _resetPool: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("@/domain/persistence/migrations/runner", () => ({
  ensureMigrations: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/domain/auth/hub-identity", () => ({
  persistHubIdentityToMeta: vi.fn().mockResolvedValue(undefined),
}));

import { _resetStartup, getStartupState, shouldProbeRecovery } from "@/lib/startup";
import { initPool } from "@/domain/persistence/db";

describe("startup（P2-007）", () => {
  beforeEach(async () => {
    await _resetStartup();
    vi.clearAllMocks();
    vi.mocked(initPool).mockResolvedValue(undefined as any);
  });

  it("默认状态：未 started、未 failed", async () => {
    const state = getStartupState();
    expect(state.started).toBe(false);
    expect(state.failed).toBe(false);
    expect(state.retryInMs).toBe(0);
  });

  it("成功启动后 started=true", async () => {
    const { startup } = await import("@/lib/startup");
    await startup();
    const state = getStartupState();
    expect(state.started).toBe(true);
    expect(state.failed).toBe(false);
  });

  it("initPool 失败时 failed=true 且 lastFailTs 记录时间", async () => {
    vi.mocked(initPool).mockRejectedValue(new Error("db down"));
    const { startup } = await import("@/lib/startup");
    await startup();
    const state = getStartupState();
    expect(state.started).toBe(false);
    expect(state.failed).toBe(true);
    expect(state.lastError).toContain("db down");
    expect(state.lastFailTs).toBeGreaterThan(0);
  });

  it("P2-007：失败后冷却期内 shouldProbeRecovery=false", async () => {
    vi.mocked(initPool).mockRejectedValue(new Error("db down"));
    const { startup } = await import("@/lib/startup");
    await startup();
    expect(shouldProbeRecovery()).toBe(false); // 刚失败，仍在冷却期
    const state = getStartupState();
    expect(state.retryInMs).toBeGreaterThan(0);
    expect(state.retryInMs).toBeLessThanOrEqual(30_000);
  });

  it("P2-007：started=true 时 shouldProbeRecovery=false", async () => {
    const { startup } = await import("@/lib/startup");
    await startup();
    expect(shouldProbeRecovery()).toBe(false);
  });

  it("P2-007：failed=false 时 shouldProbeRecovery=false（未失败过）", async () => {
    expect(shouldProbeRecovery()).toBe(false);
  });
});
