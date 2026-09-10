/**
 * 文件名称：route.ts
 * 功能描述：POST /api/auth/verify — 校验验证码 + 签发 token
 * 所属模块：app/api/auth/verify
 * 验收对齐：docs/requirements.md §6 #11 账号安全（节流）
 *
 * P1-002 修复：
 *   - IP 侧：checkVerifyIpThrottle 独立桶（默认 5min/30 次），防 6 位码枚举
 *   - email 侧：checkVerifyEmailFailCount（窗口内失败次数上限），防单 IP 循环换 email
 *   - 两个维度都独立于 requestCode 的节流桶
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyCode } from "@/domain/auth/magic-link";
import {
  checkVerifyIpThrottle,
  checkVerifyEmailFailCount,
  recordVerifyFailure,
} from "@/domain/auth/throttle";
import { insertAuditLog } from "@/domain/persistence/repos/audit.repo";
import { sha256 } from "@/domain/util/crypto";
import { extractClientIp, extractUserAgent, parseJsonBody } from "@/lib/request-helpers";

const BodySchema = z.object({
  email: z.string().email("邮箱格式不正确").max(254),
  code: z.string().length(6, "验证码必须为 6 位"),
});

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = await parseJsonBody(req as unknown as NextRequest, BodySchema);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const reqWithHeaders = req as NextRequest;
  const ip = extractClientIp(reqWithHeaders);
  const userAgent = extractUserAgent(reqWithHeaders);
  const emailHash = sha256(parsed.data.email.toLowerCase());

  // 1) IP 侧节流（独立桶）
  const ipThrottle = checkVerifyIpThrottle(ip);
  if (!ipThrottle.allowed) {
    await insertAuditLog({
      eventType: "verification_throttled",
      ip,
      userAgent,
      detail: { reason: "verify_ip_exceeded", endpoint: "/api/auth/verify" },
    });
    return NextResponse.json(
      { error: `请求过于频繁，请 ${Math.ceil((ipThrottle.retryAfterMs ?? 0) / 60_000)} 分钟后再试`, code: "throttled_ip" },
      { status: 429 }
    );
  }

  // 2) email 侧失败次数（窗口内累计）
  const failCheck = checkVerifyEmailFailCount(emailHash);
  if (failCheck.blocked) {
    await insertAuditLog({
      eventType: "verification_throttled",
      ip,
      userAgent,
      detail: { reason: "verify_email_fails_exceeded", emailHash, fails: failCheck.fails },
    });
    return NextResponse.json(
      { error: `尝试次数过多，请重新获取验证码`, code: "throttled_email" },
      { status: 429 }
    );
  }

  const result = await verifyCode({
    email: parsed.data.email,
    code: parsed.data.code,
    ip,
    userAgent,
  });

  if (!result.ok) {
    // 记录 email 侧失败（IP 桶已通过，此路径只覆盖验证码错/过期）
    if (result.code === "invalid_code" || result.code === "code_expired" || result.code === "code_used") {
      recordVerifyFailure(emailHash);
    }
    const status =
      result.code === "invalid_email" || result.code === "invalid_code"
        ? 400
        : 401;
    return NextResponse.json({ error: result.message, code: result.code }, { status });
  }

  // token 通过 cookie 存储（HttpOnly 更安全）
  const res = NextResponse.json({
    ok: true,
    isNewUser: result.isNewUser,
    userId: result.token.userId,
    expiresAt: result.token.expiresAt,
  });
  res.cookies.set("aetherpet_token", result.token.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor((result.token.expiresAt - Date.now()) / 1000),
  });
  return res;
}
