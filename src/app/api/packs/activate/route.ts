/**
 * 文件名称：route.ts
 * 功能描述：POST /api/packs/activate — 开发者模式切换当前用户生效素材包
 * 所属模块：app/api/packs/activate
 * 验收对齐：
 *   - docs/requirements.md §3.10 素材包可配置性（开发者模式加载另一套包，视觉/文案变化可见）
 *   - docs/dev-stage-plan.md 阶段 6 演示步骤 5（切换到备用素材包）
 *   - docs/current-stage.md 阶段 6 关键交付 4（POST /api/packs/activate）
 * 说明：
 *   - 切换写入 pets.active_pack_name + user_settings.active_pack_name（同一事务）
 *   - 目标包必须存在于 ASSET_PACKS_DIR；不存在返回 404（不静默回退）
 *   - 审计：eventType="pack_switched"
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { withTransaction } from "@/domain/persistence/db";
import { loadPacks } from "@/domain/packs/loader";
import { updateActivePackInTx } from "@/domain/persistence/repos/pets.repo";
import { insertAuditLog } from "@/domain/persistence/repos/audit.repo";
import { getEnv } from "@/config/env";
import { connExecute } from "@/domain/persistence/sql";

export const runtime = "nodejs";

interface ActivateBody {
  packName: string;
}

async function safeAudit(entry: Parameters<typeof insertAuditLog>[0]): Promise<void> {
  try {
    await insertAuditLog(entry);
  } catch (err) {
    console.warn("[packs/activate] audit write failed:", err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error === "not_logged_in" ? "未登录" : "登录已过期" },
      { status: 401 }
    );
  }

  const env = getEnv();

  // 1) 解析 body
  let body: ActivateBody;
  try {
    body = (await req.json()) as ActivateBody;
  } catch {
    return NextResponse.json({ error: "无效的 JSON 请求体" }, { status: 400 });
  }
  const packName = typeof body?.packName === "string" ? body.packName.trim() : "";
  if (!packName) {
    return NextResponse.json({ error: "缺少 packName 参数" }, { status: 400 });
  }
  if (packName.length > 64) {
    return NextResponse.json({ error: "packName 过长" }, { status: 400 });
  }

  // 2) 目标包必须真实存在（不静默回退——回退只用于加载失败兜底）
  const packs = await loadPacks(env.ASSET_PACKS_DIR);
  const target = packs.find((p) => p.name === packName);
  if (!target) {
    return NextResponse.json(
      {
        error: `素材包「${packName}」不存在`,
        available: packs.map((p) => ({ name: p.name, displayName: p.displayName })),
      },
      { status: 404 }
    );
  }

  // 3) 事务内改写 pets + user_settings
  const now = Date.now();
  try {
    const affected = await withTransaction(async (conn) => {
      const petRows = await updateActivePackInTx(conn, auth.userId, packName);
      // 幂等 upsert（阶段 4 P1-003 教训：DB 条件写入保证）
      await connExecute(
        conn,
        `INSERT INTO user_settings
           (user_id, active_pack_name, timezone, muted_notifications, updated_at, schema_version, hub_id)
         VALUES (?, ?, 'Asia/Shanghai', 0, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           active_pack_name = VALUES(active_pack_name),
           updated_at = VALUES(updated_at)`,
        [auth.userId, packName, now, "1.0.0", env.HUB_ID]
      );
      return petRows;
    });

    void safeAudit({
      userId: auth.userId,
      eventType: "pack_switched",
      detail: { pack_name: packName, affected_pets: affected },
      hubId: env.HUB_ID,
    });

    return NextResponse.json({
      ok: true,
      current: {
        name: target.name,
        displayName: target.displayName,
        webPath: target.webPath,
      },
      affectedPets: affected,
    });
  } catch (err) {
    console.error("[packs/activate] 事务失败（已回滚）:", err);
    return NextResponse.json({ error: "切换素材包失败，请稍后重试" }, { status: 500 });
  }
}