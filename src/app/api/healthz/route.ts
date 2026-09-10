/**
 * 文件名称：route.ts
 * 功能描述：GET /api/healthz — 健康检查（MySQL + SMTP + Hub 身份）
 * 所属模块：app/api
 * 验收对齐：docs/dev-stage-plan.md §3 阶段 1 演示步骤
 *
 * P2-002 修复：
 *   - 早期请求时 await startup（带 STARTUP_TIMEOUT_MS 超时），避免启动中返回不完整状态
 *   - 暴露 startup 状态（started/failed/attempts/lastError）
 *
 * P2-007 修复（Round 2）：
 *   - STARTUP_TIMEOUT_MS 默认 8s（覆盖 3 次退避 × 3 子步骤的最坏耗时）
 *   - startup 失败后支持自愈探测：距上次失败 > 冷却期时触发一次重试
 *   - ok 判定 = dbCheck.ok && hub.hubId.length > 0（不再依赖 startupState.failed），
 *     startup 状态仅在响应体里暴露给运维诊断
 */

import { NextResponse } from "next/server";
import { healthCheck } from "@/domain/persistence/db";
import { getHubIdentity } from "@/domain/auth/hub-identity";
import { loadSmtpConfig, isSmtpConfigured } from "@/domain/auth/smtp-config";
import { getEnv } from "@/config/env";
import { startup, getStartupState, startupReady, shouldProbeRecovery } from "@/lib/startup";

/**
 * 启动就绪等待超时。
 * 3 次退避（300+600+1200ms） × 3 个子步骤（initPool/migration/hub identity）最坏 8400ms，
 * 常规场景 200ms。取 8s 为兜底，env 可覆盖。
 */
const STARTUP_TIMEOUT_MS = Number(process.env.STARTUP_TIMEOUT_MS ?? 8_000);

async function awaitStartupWithTimeout(): Promise<void> {
  // P2-007：如上次失败已超过冷却期，先触发一次自愈探测再等
  if (shouldProbeRecovery()) {
    void startup(); // 触发一次重试，非阻塞
  }
  await Promise.race([
    startupReady,
    new Promise<void>((resolve) => setTimeout(resolve, STARTUP_TIMEOUT_MS)),
  ]);
}

export async function GET(): Promise<NextResponse> {
  const env = getEnv();
  await awaitStartupWithTimeout();

  const dbCheck = await healthCheck();
  const hub = await getHubIdentity();
  const smtp = loadSmtpConfig();
  const smtpConfigured = isSmtpConfigured(smtp);
  const smtpDryRun = smtp.dryRun;
  const startupState = getStartupState();

  // P2-007：ok 只依赖「实时探测」(db) + hub 配置；startupState.failed 单独暴露，
  // 不再否决 ok —— 因为 startup 失败但 MySQL 已恢复时，用户请求仍可服务。
  const ok = dbCheck.ok && hub.hubId.length > 0;

  return NextResponse.json(
    {
      ok,
      nodeEnv: env.NODE_ENV,
      startup: startupState,
      db: dbCheck.ok ? { ok: true, latencyMs: (dbCheck as { ts: number }).ts } : dbCheck,
      hub: {
        hubId: hub.hubId,
        hubDisplayName: hub.hubDisplayName,
        adminEmail: hub.adminEmail,
        privacyUrl: hub.privacyUrl,
        configured: hub.hubId.length > 0,
      },
      smtp: {
        configured: smtpConfigured,
        dryRun: smtpDryRun,
        host: smtp.dryRun ? smtp.host : "<redacted>",
      },
      ts: Date.now(),
    },
    { status: ok ? 200 : 503 }
  );
}
