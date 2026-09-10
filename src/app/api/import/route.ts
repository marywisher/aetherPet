/**
 * 文件名称：route.ts
 * 功能描述：POST /api/import — 导入导出 JSON 恢复 pet 数据（数据主权）
 * 所属模块：app/api/import
 * 验收对齐：
 *   - docs/requirements.md §3.9（三类错误分文案：版本/校验和/字段缺失）
 *   - docs/database-schema.md §4.3 导入流程（校验→单事务→hub/schema 改写）
 *   - docs/dev-stage-plan.md 阶段 6 演示步骤 2/3/4
 *   - docs/current-stage.md 关键约束 2（失败整体 rollback，不得半导入）
 * 说明：
 *   - 请求体 = 导出文件本体（JSON），上限 10MB（导出含全事件历史，放宽默认 1MB）
 *   - 校验顺序：JSON 解析 → 版本 → 校验和 → 字段清单（§4.3）
 *   - 三类校验失败返回 422/400 + code，前端按 code 展示不同文案
 *   - 写库在 withTransaction 内；任何一步失败整体 rollback
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { withTransaction } from "@/domain/persistence/db";
import {
  parseImportBody,
  validateImportPayload,
  importPayloadInTx,
  hasPetData,
} from "@/domain/export/importer";
import {
  IMPORT_ERRORS,
  type ImportErrorInfo,
} from "@/domain/export/error-messages";
import { insertAuditLog } from "@/domain/persistence/repos/audit.repo";
import { getEnv } from "@/config/env";

export const runtime = "nodejs";

/** 导入请求体上限：10MB（events 全量可能超过默认 1MB） */
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

async function safeAudit(entry: Parameters<typeof insertAuditLog>[0]): Promise<void> {
  try {
    await insertAuditLog(entry);
  } catch (err) {
    console.warn("[import] audit write failed:", err);
  }
}

async function readBody(req: NextRequest): Promise<{ ok: true; raw: string } | { ok: false; error: ImportErrorInfo }> {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const size = Number(contentLength);
    if (!Number.isNaN(size) && size > MAX_IMPORT_BYTES) {
      return { ok: false, error: IMPORT_ERRORS.ERR_TOO_LARGE };
    }
  }
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_IMPORT_BYTES) {
    return { ok: false, error: IMPORT_ERRORS.ERR_TOO_LARGE };
  }
  return { ok: true, raw: new TextDecoder().decode(buf) };
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

  // 1) 读体 + JSON 解析
  const body = await readBody(req);
  if (!body.ok) {
    return respondError(body.error);
  }
  const parsed = parseImportBody(body.raw);
  if (!parsed.ok) {
    void failAudit(auth.userId, parsed.error.code, env.HUB_ID);
    return respondError(parsed.error);
  }
  const payload = parsed.payload;

  // 2) 版本 → 校验和 → 字段清单
  const validation = validateImportPayload(payload);
  if (!validation.ok) {
    void failAudit(auth.userId, validation.error.code, env.HUB_ID);
    return respondError(validation.error);
  }

  // 3) pet 数据存在性兜底（正常校验已覆盖；双重防御）
  if (!hasPetData(payload)) {
    void failAudit(auth.userId, IMPORT_ERRORS.ERR_NO_PET.code, env.HUB_ID);
    return respondError(IMPORT_ERRORS.ERR_NO_PET);
  }

  // 4) 单事务导入：失败整体回滚
  try {
    const summary = await withTransaction((conn) =>
      importPayloadInTx(conn, payload, {
        userId: auth.userId,
        hubId: env.HUB_ID,
        schemaVersion: payload.meta.schema_version, // 已校验 = 1.0.0
      })
    );

    void safeAudit({
      userId: auth.userId,
      eventType: "import_success",
      detail: {
        from_hub: payload.meta.exported_from,
        checksum: payload.meta.checksum,
        ...summary,
      },
      hubId: env.HUB_ID,
    });

    return NextResponse.json({ ok: true, imported: summary });
  } catch (err) {
    console.error("[import] 事务失败（已回滚）:", err);
    void failAudit(auth.userId, "IMPORT_DB_ERROR", env.HUB_ID);
    return NextResponse.json(
      { error: "导入失败：服务器处理备份文件时出错，未做任何改动。请稍后重试。" },
      { status: 500 }
    );
  }
}

function failAudit(userId: string, code: string, hubId: string): Promise<void> {
  return safeAudit({
    userId,
    eventType: "import_failed",
    detail: { code },
    hubId,
  });
}

function respondError(info: ImportErrorInfo): NextResponse {
  return NextResponse.json(
    {
      error: info.message,
      code: info.code,
      detail: info.detail,
    },
    { status: info.status }
  );
}