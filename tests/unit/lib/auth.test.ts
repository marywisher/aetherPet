/**
 * 文件名称：auth.test.ts
 * 功能描述：lib/auth 单测（requireAuth 双模式 + 失败分支）
 * 所属模块：tests/unit/lib
 * 说明：认证主干由 API 集成测试（真实 MySQL）覆盖，这里补纯分支单测，提升 lib 覆盖
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockVerifyToken = vi.fn();
vi.mock("@/domain/auth/token", () => ({
  verifyToken: (...a: unknown[]) => mockVerifyToken(...a),
}));

import { requireAuth, resolveToken } from "@/lib/auth";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("resolveToken", () => {
  it("Bearer 优先于 cookie", () => {
    const req = new Request("http://test/", {
      headers: {
        authorization: "Bearer bearer-token",
        cookie: "aetherpet_token=cookie-token",
      },
    });
    expect(resolveToken(req)).toBe("bearer-token");
  });

  it("无 Bearer 时回退 cookie", () => {
    const req = new Request("http://test/", {
      headers: { cookie: "other=1; aetherpet_token=cookie-token" },
    });
    expect(resolveToken(req)).toBe("cookie-token");
  });

  it("都没有 → null", () => {
    expect(resolveToken(new Request("http://test/"))).toBeNull();
  });
});

describe("requireAuth", () => {
  it("无 token → not_logged_in", async () => {
    const r = await requireAuth(new Request("http://test/"));
    expect(r).toEqual({ ok: false, error: "not_logged_in" });
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it("token 无效 → session_expired", async () => {
    mockVerifyToken.mockResolvedValue(null);
    const req = new Request("http://test/", {
      headers: { cookie: "aetherpet_token=invalid-token" },
    });
    const r = await requireAuth(req);
    expect(r).toEqual({ ok: false, error: "session_expired" });
  });

  it("token 有效 → 返回 userId", async () => {
    mockVerifyToken.mockResolvedValue({ userId: "u1", sessionId: "s1" });
    const req = new Request("http://test/", {
      headers: { cookie: "aetherpet_token=valid-token" },
    });
    const r = await requireAuth(req);
    expect(r).toEqual({ ok: true, userId: "u1" });
  });
});