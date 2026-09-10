/**
 * 文件名称：route.ts
 * 功能描述：GET /api/pet — 获取当前登录用户的第一只 pet
 * 所属模块：app/api/pet
 */

import { NextResponse } from "next/server";
import { verifyToken } from "@/domain/auth/token";
import { findByUserId } from "@/domain/persistence/repos/pets.repo";
import { extractBearerToken } from "@/lib/request-helpers";

export async function GET(req: Request): Promise<NextResponse> {
  const cookies = req.headers.get("cookie") ?? "";
  const match = cookies.match(/(?:^|;\s*)aetherpet_token=([^;]+)/);
  const token = extractBearerToken(req as unknown as import("next/server").NextRequest)
    ?? (match ? match[1] : null);

  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const session = await verifyToken(token);
  if (!session) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

  const pets = await findByUserId(session.userId);
  if (pets.length === 0) {
    return NextResponse.json({ ok: true, pet: null });
  }
  return NextResponse.json({ ok: true, pet: pets[0] });
}
