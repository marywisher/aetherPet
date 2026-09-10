/**
 * 文件名称：route.ts
 * 功能描述：POST /api/auth/request-code — 签发邮箱验证码
 * 所属模块：app/api/auth
 * 验收对齐：docs/requirements.md §6 #1 注册登录（含安全边界）
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requestCode } from "@/domain/auth/magic-link";
import { extractClientIp, extractUserAgent, parseJsonBody } from "@/lib/request-helpers";

const BodySchema = z.object({
  email: z.string().email("邮箱格式不正确").max(254),
});

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = await parseJsonBody(req as unknown as NextRequest, BodySchema);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const reqWithHeaders = req as NextRequest;
  const result = await requestCode({
    email: parsed.data.email,
    ip: extractClientIp(reqWithHeaders),
    userAgent: extractUserAgent(reqWithHeaders),
  });

  if (!result.ok) {
    if (result.code === "throttled_email" || result.code === "throttled_ip") {
      return NextResponse.json(
        { error: result.message, code: result.code, retryAfterMs: result.retryAfterMs },
        { status: 429 }
      );
    }
    if (result.code === "email_send_failed") {
      return NextResponse.json({ error: result.message, code: result.code }, { status: 502 });
    }
    return NextResponse.json({ error: result.message, code: result.code }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    expiresInMin: result.expiresInMin,
    dryRun: result.dryRun,
  });
}
