/**
 * 文件名称：route.ts
 * 功能描述：POST /api/packs/refresh — 开发模式刷新素材包缓存
 * 所属模块：app/api/packs
 * 修订：Round 2 P2-011 —— 长驻进程下热加新素材包立即生效
 *
 * 使用约束：
 *   - NODE_ENV=development 时无需 token（开发便利）
 *   - NODE_ENV=production 需 Bearer token（阶段 4/6 接入管理员后细化）
 *   - 仅清 loader 缓存，不影响已缓存的响应
 */

import { NextResponse } from "next/server";
import { refreshPacks, loadPacks } from "@/domain/packs/loader";
import { getEnv } from "@/config/env";
import { extractBearerToken, extractClientIp } from "@/lib/request-helpers";
import { verifyToken } from "@/domain/auth/token";

export async function POST(req: Request): Promise<NextResponse> {
  const env = getEnv();

  // 生产模式需 token；开发模式放行
  if (env.NODE_ENV !== "development") {
    const token = extractBearerToken(req as unknown as import("next/server").NextRequest);
    if (!token) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }
    const session = await verifyToken(token);
    if (!session) {
      return NextResponse.json({ error: "token 无效" }, { status: 401 });
    }
  }

  const ip = extractClientIp(req as unknown as import("next/server").NextRequest);

  refreshPacks();
  const packs = await loadPacks();
  console.log(
    `[packs-refresh] cache cleared, ${packs.length} packs loaded (ip=${ip ?? "<unknown>"})`
  );

  return NextResponse.json({
    ok: true,
    count: packs.length,
    packs: packs.map((p) => ({ name: p.name, displayName: p.displayName })),
    ts: Date.now(),
  });
}
