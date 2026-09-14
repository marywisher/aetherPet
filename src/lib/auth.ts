/**
 * 文件名称：auth.ts
 * 功能描述：Route Handler 认证辅助（Bearer + cookie 双模式；沿用 /api/sync 惯例）
 * 所属模块：lib
 * 说明：
 *   - 抽取自 src/app/api/sync/route.ts 的 resolveToken 逻辑，多处复用
 *   - 失败一律 401；调用方直接 return 即可
 */

import type { NextRequest } from "next/server";
import { verifyToken } from "@/domain/auth/token";
import { extractBearerToken } from "./request-helpers";
import { readTokenCookie } from "./brand";

export interface AuthResult {
  ok: true;
  userId: string;
}

export type AuthError =
  | { ok: false; error: "not_logged_in" }
  | { ok: false; error: "session_expired" };

/** 解析 token（Bearer 优先，回退 cookie） */
export function resolveToken(req: Request): string | null {
  const reqWithHeaders = req as unknown as NextRequest;
  const bearer = extractBearerToken(reqWithHeaders);
  if (bearer) return bearer;
  // cookie 名来自 .env 的 APP_BRAND_KEY（默认 aetherpet_token），服务端统一解析
  return readTokenCookie(req.headers.get("cookie"));
}

export async function requireAuth(req: Request): Promise<AuthResult | AuthError> {
  const token = resolveToken(req);
  if (!token) return { ok: false, error: "not_logged_in" };
  const session = await verifyToken(token);
  if (!session) return { ok: false, error: "session_expired" };
  return { ok: true, userId: session.userId };
}
