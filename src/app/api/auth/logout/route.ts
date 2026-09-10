/**
 * 文件名称：route.ts
 * 功能描述：POST /api/auth/logout — 退出登录（撤销 token）
 * 所属模块：app/api/auth
 * 验收对齐：docs/requirements.md §6 #1 注册登录（含安全边界）
 * 修订：Round 2 P3-003 — 与 /api/auth/me 等路由保持一致，Bearer token 优先 + cookie 兜底
 */

import { NextResponse } from "next/server";
import { verifyToken, revokeToken } from "@/domain/auth/token";
import { insertAuditLog } from "@/domain/persistence/repos/audit.repo";
import { extractClientIp, extractBearerToken } from "@/lib/request-helpers";

export async function POST(req: Request): Promise<NextResponse> {
  // P3-003：Bearer 优先，cookie 兜底（与 me/pet/pet/create 一致）
  const cookies = req.headers.get("cookie") ?? "";
  const cookieMatch = cookies.match(/(?:^|;\s*)aetherpet_token=([^;]+)/);
  const reqWithHeaders = req as unknown as import("next/server").NextRequest;
  const token = extractBearerToken(reqWithHeaders) ?? (cookieMatch ? cookieMatch[1] : null);

  if (!token) {
    // 直接返回 200，同时清 cookie
    const res = NextResponse.json({ ok: true });
    res.cookies.set("aetherpet_token", "", { maxAge: 0, path: "/" });
    return res;
  }

  // 验证 token 有效 → 撤销 → 审计（P3-004：audit 写失败不阻塞业务）
  const session = await verifyToken(token);
  if (session) {
    await revokeToken(token);
    try {
      await insertAuditLog({
        eventType: "token_revoked",
        userId: session.userId,
        ip: extractClientIp(reqWithHeaders),
        detail: { sessionId: session.sessionId },
      });
    } catch (err) {
      console.warn("[audit] token_revoked write failed:", err);
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("aetherpet_token", "", { maxAge: 0, path: "/" });
  return res;
}
