/**
 * 文件名称：audit.repo.ts
 * 功能描述：audit_log 表写入（仅 append，不做复杂查询）
 * 所属模块：domain/persistence/repos
 * 修订：Round 2 P1-005 — hub_id / schema_version 不再硬编码，改由 env 兜底或调用方显式传入
 */

import { getPool } from "../db";
import { execute } from "../sql";
import { getEnv } from "@/config/env";
import type { AuditEventType } from "../../types";

export interface AuditLogInput {
  userId?: string | null;
  eventType: AuditEventType;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  /** 归属中心；缺省读 env.HUB_ID（MVP 单中心 = "local"） */
  hubId?: string | null;
  /** 事件 schema 版本；缺省 "1.0.0" */
  schemaVersion?: string;
}

/** 写入一条审计日志 */
export async function insertAuditLog(entry: AuditLogInput): Promise<void> {
  const pool = getPool();
  const env = getEnv();
  await execute(
    pool,
    `INSERT INTO audit_log
      (user_id, event_type, detail, ip, user_agent, created_at, schema_version, hub_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.userId ?? null,
      entry.eventType,
      entry.detail ? JSON.stringify(entry.detail) : null,
      entry.ip ?? null,
      entry.userAgent ?? null,
      Date.now(),
      entry.schemaVersion ?? "1.0.0",
      entry.hubId ?? env.HUB_ID,
    ]
  );
}

/** 便捷：验证码尝试（节流前） */
export async function logVerificationAttempt(
  email: string,
  ip: string | null
): Promise<void> {
  await insertAuditLog({
    eventType: "verification_attempt",
    detail: { emailHash: "" }, // 由调用方补 hash
    ip,
  });
}
