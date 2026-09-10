/**
 * 文件名称：route.ts
 * 功能描述：GET /api/export — 导出当前用户 pet 全量数据（数据主权）
 * 所属模块：app/api/export
 * 验收对齐：
 *   - docs/requirements.md §3.9 数据导出/导入（一键导出 JSON）
 *   - docs/dev-stage-plan.md 阶段 6 演示步骤 1（含 schema/checksum/exported_from）
 *   - docs/requirements.md §6 验收 #11（导出备份 hash 作身份证明）
 * 说明：
 *   - 鉴权：Bearer 或 cookie（requireAuth）
 *   - 成功后更新 users.last_backup_hash = 本次导出校验和（申诉自证用）
 *   - 审计：eventType="export"
 *   - 前端拿到 JSON 后自行触发浏览器下载（避免 Content-Disposition 复杂度）
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { buildExport, ExportError } from "@/domain/export/exporter";
import { recordBackupHash } from "@/domain/backup/backup";
import { insertAuditLog } from "@/domain/persistence/repos/audit.repo";
import { getEnv } from "@/config/env";

export const runtime = "nodejs";

/** 审计失败不阻断导出（阶段 1 P3-004 约定） */
async function safeAudit(entry: Parameters<typeof insertAuditLog>[0]): Promise<void> {
  try {
    await insertAuditLog(entry);
  } catch (err) {
    console.warn("[export] audit write failed:", err);
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error === "not_logged_in" ? "未登录" : "登录已过期" },
      { status: 401 }
    );
  }

  const env = getEnv();
  try {
    const { payload, checksumHex } = await buildExport(auth.userId);
    // 记录备份 hash（幂等：同一 hash 重复写入无害）
    await recordBackupHash(auth.userId, checksumHex);

    void safeAudit({
      userId: auth.userId,
      eventType: "export",
      detail: {
        checksum: checksumHex,
        exported_at: payload.meta.exported_at,
        exported_from: payload.meta.exported_from,
        schema_version: payload.meta.schema_version,
        events: payload.pet.events.length,
        memories: payload.pet.memories.length,
        inventory: payload.pet.inventory.length,
      },
      hubId: env.HUB_ID,
    });

    return NextResponse.json({
      ok: true,
      // 结构即导出文件本体（前端直接 Blob 下载）
      payload,
      checksum: checksumHex,
    });
  } catch (err) {
    if (err instanceof ExportError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[export] 失败:", err);
    return NextResponse.json({ error: "导出失败，请稍后重试" }, { status: 500 });
  }
}