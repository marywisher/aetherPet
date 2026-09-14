/**
 * 文件名称：route.ts
 * 功能描述：GET /api/auth/me — 当前登录用户
 * 所属模块：app/api/auth
 */

import { NextResponse } from "next/server";
import { verifyToken } from "@/domain/auth/token";
import { findById } from "@/domain/persistence/repos/users.repo";
import { extractBearerToken } from "@/lib/request-helpers";
import { readTokenCookie } from "@/lib/brand";

export async function GET(req: Request): Promise<NextResponse> {
  const token =
    extractBearerToken(req as unknown as import("next/server").NextRequest)
    ?? readTokenCookie(req.headers.get("cookie"));

  if (!token) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const session = await verifyToken(token);
  if (!session) {
    return NextResponse.json({ error: "登录已过期" }, { status: 401 });
  }

  const user = await findById(session.userId);
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    userId: user.id,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
    hubId: user.hubId,
    schemaVersion: user.schemaVersion,
    lastBackupHash: user.lastBackupHash,
  });
}
