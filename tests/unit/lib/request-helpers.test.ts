/**
 * 文件名称：request-helpers.test.ts
 * 功能描述：IP 提取、Bearer token、body size limit（P2-010 + P3-005）
 * 所属模块：tests/unit/lib
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  extractClientIp,
  extractBearerToken,
  extractUserAgent,
  parseJsonBody,
} from "@/lib/request-helpers";
import { _resetEnvCache } from "@/config/env";
import { z } from "zod";

// 帮助：构造一个最小 NextRequest 替身
function makeReq(
  headers: Record<string, string> = {},
  socketRemoteAddress?: string
): any {
  return {
    headers: new Headers(headers),
    socket: socketRemoteAddress ? { remoteAddress: socketRemoteAddress } : undefined,
    json: async () => ({}),
    arrayBuffer: async () => {
      // 用于 parseJsonBody 的第二次读取
      const body = JSON.stringify({ a: 1 });
      return new TextEncoder().encode(body).buffer;
    },
  };
}

describe("request-helpers", () => {
  beforeEach(() => {
    _resetEnvCache();
    process.env.TRUST_PROXY = "false";
  });

  describe("extractClientIp（P1-001 + P2-010）", () => {
    it("默认（TRUST_PROXY=false）：忽略 XFF / X-Real-Ip，取 socket.remoteAddress", () => {
      const req = makeReq(
        {
          "x-forwarded-for": "1.2.3.4, 5.6.7.8",
          "x-real-ip": "9.9.9.9",
        },
        "8.8.8.8"
      );
      expect(extractClientIp(req)).toBe("8.8.8.8");
    });

    it("socket.remoteAddress 缺失时，用 remote-addr header", () => {
      const req = makeReq({ "remote-addr": "10.0.0.1" });
      expect(extractClientIp(req)).toBe("10.0.0.1");
    });

    it("无任何可用来源时返回 null", () => {
      const req = makeReq({});
      expect(extractClientIp(req)).toBeNull();
    });

    it("TRUST_PROXY=true 时：取 XFF 右往左第 PROXY_TRUST_HOPS 个", () => {
      process.env.TRUST_PROXY = "true";
      process.env.PROXY_TRUST_HOPS = "1";
      _resetEnvCache();
      const req = makeReq({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }, "10.0.0.1");
      expect(extractClientIp(req)).toBe("5.6.7.8");
    });

    // P2-010：X-Real-Ip 仅在 XFF 缺失 且 socket.remoteAddress 不可读时才兜底
    it("P2-010：TRUST_PROXY=true 时，XFF 存在则忽略 X-Real-Ip", () => {
      process.env.TRUST_PROXY = "true";
      _resetEnvCache();
      const req = makeReq(
        {
          "x-forwarded-for": "1.2.3.4, 5.6.7.8",
          "x-real-ip": "9.9.9.9",
        },
        "10.0.0.1"
      );
      expect(extractClientIp(req)).toBe("5.6.7.8");
    });

    it("P2-010：TRUST_PROXY=true 时，XFF 缺失且 socket 可读 → 用 socket（不用 X-Real-Ip）", () => {
      process.env.TRUST_PROXY = "true";
      _resetEnvCache();
      const req = makeReq({ "x-real-ip": "9.9.9.9" }, "10.0.0.1");
      // 因为 socket 可读，我们不会走 X-Real-Ip 兜底
      expect(extractClientIp(req)).toBe("10.0.0.1");
    });

    it("P2-010：TRUST_PROXY=true 时，XFF/X-Real-Ip 都在 且 socket 不可读 → 才读 X-Real-Ip", () => {
      process.env.TRUST_PROXY = "true";
      _resetEnvCache();
      const req = makeReq({ "x-real-ip": "9.9.9.9" });
      // 无 XFF，无 socket → 走 X-Real-Ip 兜底
      expect(extractClientIp(req)).toBe("9.9.9.9");
    });
  });

  describe("extractBearerToken", () => {
    it("有 Bearer token 时解析", () => {
      const req = makeReq({ authorization: "Bearer abc123" });
      expect(extractBearerToken(req)).toBe("abc123");
    });

    it("无 Authorization header 时返回 null", () => {
      const req = makeReq({});
      expect(extractBearerToken(req)).toBeNull();
    });

    it("非 Bearer 方案返回 null", () => {
      const req = makeReq({ authorization: "Basic abc" });
      expect(extractBearerToken(req)).toBeNull();
    });

    it("大小写不敏感", () => {
      const req = makeReq({ authorization: "bearer abc123" });
      expect(extractBearerToken(req)).toBe("abc123");
    });
  });

  describe("extractUserAgent", () => {
    it("有 UA 时截断到 512 字符", () => {
      const ua = "x".repeat(1000);
      const req = makeReq({ "user-agent": ua });
      const result = extractUserAgent(req);
      expect(result).toHaveLength(512);
    });
  });

  describe("parseJsonBody（P3-005：body size limit）", () => {
    it("合法 JSON 通过", async () => {
      const req = makeReq({});
      const schema = z.object({ a: z.number() });
      const result = await parseJsonBody(req, schema);
      expect(result.ok).toBe(true);
    });

    it("非法 JSON 返回错误", async () => {
      const req = {
        headers: new Headers({}),
        json: async () => { throw new Error("not json"); },
        arrayBuffer: async () => { throw new Error("not json"); },
      } as any;
      const result = await parseJsonBody(req, z.object({ a: z.number() }));
      expect(result.ok).toBe(false);
    });

    it("P3-005：Content-Length 超过限制时返回错误", async () => {
      // 1MB = 1048576
      const req = makeReq({ "content-length": "2000000" });
      const result = await parseJsonBody(req, z.object({ a: z.number() }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("请求体过大");
    });

    it("P3-005：Content-Length 未超限继续走正常流程", async () => {
      const req = makeReq({ "content-length": "100" });
      const result = await parseJsonBody(req, z.object({ a: z.number() }));
      expect(result.ok).toBe(true);
    });
  });
});
