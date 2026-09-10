/**
 * 文件名称：route.ts
 * 功能描述：GET /api/packs — 列出可用素材包 + 当前生效包
 * 所属模块：app/api/packs
 * 验收对齐：docs/dev-stage-plan.md §3 阶段 1 演示步骤 5
 */

import { NextResponse } from "next/server";
import { loadPacks } from "@/domain/packs/loader";
import { getEffectivePack } from "@/domain/packs/fallback";
import { getEnv } from "@/config/env";

export async function GET(): Promise<NextResponse> {
  const env = getEnv();
  const packs = await loadPacks(env.ASSET_PACKS_DIR);
  const result = getEffectivePack(env.DEFAULT_PACK, env.DEFAULT_PACK, packs);

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
