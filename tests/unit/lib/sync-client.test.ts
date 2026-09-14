/**
 * 文件名称：sync-client.test.ts
 * 功能描述：lib/sync-client 单测（并发去重 + 失败静默 + dailyGrant 透传）
 * 所属模块：tests/unit/lib
 * 对应校验：
 *   - docs/audit/step2-reverse-verify.md「H2 修复方案」极端场景表
 *   - 模块级 in-flight 去重、非 2xx / 网络异常静默返回 null、响应透传 dailyGrant
 */

import { describe, it, expect, vi, afterEach } from "vitest";

/** 每个用例重新加载模块，隔离模块级 in-flight 状态 */
async function loadModule(): Promise<typeof import("@/lib/sync-client")> {
  return import("@/lib/sync-client");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("runSyncOnce", () => {
  it("成功且 granted 时透传 dailyGrant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          catchup: { ran: true, eventCount: 2, offlineStartTs: 1000, aggregated: false, durationMs: 1, offlineDays: 1 },
          dailyGrant: { ran: true, granted: true, itemId: "it-1", itemDisplayName: "橡果" },
        }),
      })
    );
    const { runSyncOnce } = await loadModule();
    const r = await runSyncOnce();
    expect(r).toEqual({
      catchup: { ran: true, eventCount: 2, offlineStartTs: 1000, aggregated: false, durationMs: 1, offlineDays: 1 },
      dailyGrant: { ran: true, granted: true, itemId: "it-1", itemDisplayName: "橡果" },
    });
    expect(fetch).toHaveBeenCalledWith("/api/sync", { cache: "no-store" });
  });

  it("非 2xx（401）→ null 静默，不抛异常", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const { runSyncOnce } = await loadModule();
    await expect(runSyncOnce()).resolves.toBeNull();
  });

  it("网络异常 → null 静默，不抛异常", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { runSyncOnce } = await loadModule();
    await expect(runSyncOnce()).resolves.toBeNull();
  });

  it("响应缺少 dailyGrant 字段 → { dailyGrant: null }", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    const { runSyncOnce } = await loadModule();
    const r = await runSyncOnce();
    expect(r).toEqual({ catchup: null, dailyGrant: null });
  });

  it("并发调用只发一次请求（in-flight 去重）", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((res) => {
        resolveFetch = res;
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { runSyncOnce } = await loadModule();

    const p1 = runSyncOnce();
    const p2 = runSyncOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true, json: async () => ({ ok: true }) });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ catchup: null, dailyGrant: null });
    expect(r2).toEqual({ catchup: null, dailyGrant: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("上一次请求完成后可再次发起（in-flight 清空）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const { runSyncOnce } = await loadModule();

    await runSyncOnce();
    await runSyncOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});