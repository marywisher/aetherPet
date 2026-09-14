/**
 * 文件名称：route.ts
 * 功能描述：GET /api/packs — 列出可用素材包 + 当前生效包
 * 所属模块：app/api/packs
 * 验收对齐：docs/dev-stage-plan.md §3 阶段 1 演示步骤 5
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loadPacks } from "@/domain/packs/loader";
import { getEffectivePack } from "@/domain/packs/fallback";
import { getEnv } from "@/config/env";
import { resolveToken } from "@/lib/auth";
import { verifyToken } from "@/domain/auth/token";
import { findLatestActivePackName } from "@/domain/persistence/repos/pets.repo";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const env = getEnv();
  const packs = await loadPacks(env.ASSET_PACKS_DIR);

  // 可选鉴权：登录用户 → 用其 pet 的 active_pack_name（切包后 current 跟随）；
  // 未登录 / 无 pet → DEFAULT_PACK。避免把 /api/packs 变成强制登录端点（登录页也用它渲主题）。
  let requested = env.DEFAULT_PACK;
  const token = resolveToken(req);
  if (token) {
    const session = await verifyToken(token);
    if (session) {
      const active = await findLatestActivePackName(session.userId);
      if (active) requested = active;
    }
  }

  const result = getEffectivePack(requested, env.DEFAULT_PACK, packs);

  const current = result.effectivePack;
  return NextResponse.json({
    ok: true,
    current: current && current.manifest
      ? {
          name: current.name,
          displayName: current.displayName,
          schemaVersion: current.manifest.schema_version,
          theme: current.manifest.theme,
          webPath: current.webPath,
        }
      : null,
    fallbackReason: result.fallbackReason,
    available: packs.map((p) => ({
      name: p.name,
      displayName: p.displayName,
    })),
  });
}
