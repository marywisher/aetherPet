/**
 * 文件名称：packs-refresh-route.test.ts
 * 功能描述：POST /api/packs/refresh 端点测试（P2-011）
 * 所属模块：tests/unit/app
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/domain/packs/loader", () => ({
  refreshPacks: vi.fn(),
  loadPacks: vi.fn(),
}));
vi.mock("@/domain/auth/token", () => ({
  verifyToken: vi.fn(),
}));

import { refreshPacks, loadPacks } from "@/domain/packs/loader";
import { verifyToken } from "@/domain/auth/token";
import { POST } from "@/app/api/packs/refresh/route";
import { _resetEnvCache } from "@/config/env";

const mockedRefresh = vi.mocked(refreshPacks);
const mockedLoad = vi.mocked(loadPacks);
const mockedVerify = vi.mocked(verifyToken);

describe("POST /api/packs/refresh (P2-011)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetEnvCache();
    (process.env as Record<string, string>).NODE_ENV = "development";
  });

  it("开发模式：无 token 也可调用，清除缓存并返回包列表", async () => {
    mockedRefresh.mockImplementation(() => {});
    mockedLoad.mockResolvedValue([
      { name: "default", displayName: "默认包" } as any,
    ]);
    const req = new Request("http://localhost/api/packs/refresh", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(mockedRefresh).toHaveBeenCalled();
    expect(mockedLoad).toHaveBeenCalled();
  });

  it("生产模式：无 token 返回 401", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    _resetEnvCache();
    const req = new Request("http://localhost/api/packs/refresh", { method: "POST" });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it("生产模式：有有效 Bearer token 允许", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    _resetEnvCache();
    mockedVerify.mockResolvedValue({ sessionId: "s1", userId: "u1" } as any);
    mockedLoad.mockResolvedValue([]);
    const req = new Request("http://localhost/api/packs/refresh", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockedRefresh).toHaveBeenCalled();
  });

  it("生产模式：无效 token 返回 401", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    _resetEnvCache();
    mockedVerify.mockResolvedValue(null);
    const req = new Request("http://localhost/api/packs/refresh", {
      method: "POST",
      headers: { Authorization: "Bearer expired-token" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
