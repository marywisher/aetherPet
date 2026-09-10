/**
 * 文件名称：request-helpers.ts
 * 功能描述：Next.js Route Handler 辅助函数（IP、UserAgent、响应、JSON 解析）
 * 所属模块：lib
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { ZodSchema } from "zod";
import { getEnv } from "@/config/env";

/**
 * 提取客户端 IP。
 *
 * 安全约定（P1-001 + P2-010）：
 *   - 默认（TRUST_PROXY=false）：不信任客户端传入的 X-Forwarded-For / X-Real-Ip，
 *     直接读 req.socket.remoteAddress。这样攻击者伪造 header 无法绕过 IP 限流。
 *   - TRUST_PROXY=true（必须确认部署在可信反代后，且反代已设置
 *     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for）：
 *     取 X-Forwarded-For 右往左第 N 个（N=PROXY_TRUST_HOPS），跳过后面的伪造值。
 *   - X-Real-Ip 仅在 XFF 完全缺失时作为兜底（P2-010 修复）：攻击者若绕过反代直接
 *     打应用，即使带 X-Real-Ip 也无法伪造 IP，因为此时 remoteAddress 就是客户端 IP，
 *     XFF 也不会存在，我们仍会以 remoteAddress 为准；只有 socket.remoteAddress 不可
 *     读且 XFF 也缺失时，才尝试 X-Real-Ip。
 *   - 回退：如果读不到 socket.remoteAddress，再尝试 Next.js 的 remote-addr header。
 */
export function extractClientIp(req: NextRequest): string | null {
  const env = getEnv();

  if (env.TRUST_PROXY) {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
      // 取右往左第 N 个：数组倒数第 (PROXY_TRUST_HOPS) 个
      const idx = parts.length - env.PROXY_TRUST_HOPS;
      if (idx >= 0 && parts[idx]) return parts[idx];
    }
    // X-Real-Ip 仅在 XFF 缺失时尝试（P2-010：不再无条件信任）
    const socket = (req as unknown as { socket?: { remoteAddress?: string } }).socket;
    if (!socket?.remoteAddress) {
      const real = req.headers.get("x-real-ip");
      if (real) return real.trim();
    }
  }

  // socket.remoteAddress 在 Next.js 中通常可读到；IPv6 会带 ::ffff:
  const socket = (req as unknown as { socket?: { remoteAddress?: string } }).socket;
  if (socket?.remoteAddress) return socket.remoteAddress;

  // Next.js 部分环境会注入 remote-addr header
  return req.headers.get("remote-addr") ?? null;
}

/** 提取 User-Agent */
export function extractUserAgent(req: NextRequest): string | null {
  const ua = req.headers.get("user-agent");
  return ua ? ua.slice(0, 512) : null;
}

/** 提取 Bearer token */
export function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * 解析 JSON body 并用 zod schema 校验。
 * P3-005（Round 2）：限制请求体大小（默认 1MB），防止大 body OOM。
 * 超限返回 { ok: false, error: "请求体过大" }，不抛错。
 */
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 1_048_576); // 默认 1MB

export async function parseJsonBody<T>(
  req: NextRequest,
  schema: ZodSchema<T>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  // P3-005：Content-Length 快速拒绝
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const size = Number(contentLength);
    if (!isNaN(size) && size > MAX_BODY_BYTES) {
      return { ok: false, error: "请求体过大" };
    }
  }

  try {
    // 二次保险：先读 ArrayBuffer 检查实际大小，再 JSON.parse
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) {
      return { ok: false, error: "请求体过大" };
    }
    const raw = JSON.parse(new TextDecoder().decode(buf));
    const result = schema.safeParse(raw);
    if (!result.success) {
      const msg = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      return { ok: false, error: msg };
    }
    return { ok: true, data: result.data };
  } catch {
    return { ok: false, error: "请求体不是合法 JSON" };
  }
}

/** JSON 响应 */
export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

export function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error, ...extra }, { status });
}
