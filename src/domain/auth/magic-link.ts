/**
 * 文件名称：magic-link.ts
 * 功能描述：邮箱验证码签发/校验（hub-autonomous email）
 * 所属模块：domain/auth
 * 说明：
 *   - 签发：节流 → 生成 code → 落库 → 发邮件（带中心身份标识）→ 审计
 *   - 校验：找有效 code → 标记使用 → 创建/取回用户 → 签发 30 天 token → 审计
 *   - 领域层纯 TS，可独立单测（DB 部分通过 repo mock）
 */

import { getEnv } from "@/config/env";
import { newId } from "../util/ulid";
import { sha256, generateVerificationCode } from "../util/crypto";
import * as vcRepo from "../persistence/repos/verification-codes.repo";
import * as usersRepo from "../persistence/repos/users.repo";
import * as auditRepo from "../persistence/repos/audit.repo";
import { withTransaction } from "../persistence/db";
import { checkThrottle } from "./throttle";
import { issueToken, type IssuedToken } from "./token";
import { getHubIdentity } from "./hub-identity";
import { loadSmtpConfig } from "./smtp-config";
import { buildVerificationEmail } from "./email-template";
import { sendEmail } from "./mail-sender";

/**
 * P3-004：审计写入不阻塞业务。
 * 任何 audit 失败仅 log 警告，不影响主流程。
 */
async function safeAudit(entry: Parameters<typeof auditRepo.insertAuditLog>[0]): Promise<void> {
  try {
    await auditRepo.insertAuditLog(entry);
  } catch (err) {
    console.warn("[audit] write failed:", err);
  }
}

// ============================================================
// 签发
// ============================================================

export type RequestCodeResult =
  | { ok: true; expiresInMin: number; dryRun: boolean }
  | { ok: false; code: ThrottleCode; message: string; retryAfterMs?: number }
  | { ok: false; code: "email_send_failed"; message: string }
  | { ok: false; code: "internal"; message: string };

export type ThrottleCode = "throttled_email" | "throttled_ip";

export interface RequestCodeInput {
  email: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** 签发验证码（含节流 + 发邮件 + 审计） */
export async function requestCode(input: RequestCodeInput): Promise<RequestCodeResult> {
  const env = getEnv();
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, code: "internal", message: "邮箱格式不正确" };
  }
  const emailHash = sha256(email);

  // 1) 节流检查
  const throttle = await checkThrottle(
    input.ip ?? null,
    emailHash,
    (hash, since) => vcRepo.countByEmailHashSince(hash, since)
  );
  if (!throttle.allowed) {
    if (throttle.reason === "email_exceeded") {
      await safeAudit({
        eventType: "verification_throttled",
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        detail: { reason: "email_exceeded", emailHash },
      });
      return {
        ok: false,
        code: "throttled_email",
        message: `发送过于频繁，请 ${Math.ceil((throttle.retryAfterMs ?? 0) / 60_000)} 分钟后再试`,
        retryAfterMs: throttle.retryAfterMs,
      };
    }
    await safeAudit({
      eventType: "verification_throttled",
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      detail: { reason: "ip_exceeded" },
    });
    return {
      ok: false,
      code: "throttled_ip",
      message: `请求过于频繁，请 ${Math.ceil((throttle.retryAfterMs ?? 0) / 60_000)} 分钟后再试`,
      retryAfterMs: throttle.retryAfterMs,
    };
  }

  // 审计：尝试
  await safeAudit({
    eventType: "verification_attempt",
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    detail: { emailHash },
  });

  // 2) 生成 code
  const code = generateVerificationCode();
  const codeHash = sha256(code);
  const now = Date.now();
  const expiresAt = now + env.VERIFICATION_CODE_TTL_MS;

  // 3) 落库（user_id 允许孤儿；用占位 ULID）
  const hub = await getHubIdentity();
  await vcRepo.insert({
    id: newId(),
    userId: newId(), // 占位；verify 时可能更新为真实 user_id
    emailHash,
    codeHash,
    issuedAt: now,
    expiresAt,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    schemaVersion: "1.0.0",
    hubId: hub.hubId,
  });

  // 4) 发邮件
  const smtp = loadSmtpConfig();
  const payload = buildVerificationEmail(
    { code, hub, expiresAt, toEmail: email },
    smtp.from
  );
  const sendResult = await sendEmail(payload);
  if (!sendResult.accepted) {
    return {
      ok: false,
      code: "email_send_failed",
      message: sendResult.error ?? "邮件发送失败，请稍后再试",
    };
  }

  // 5) 返回
  return {
    ok: true,
    expiresInMin: Math.ceil(env.VERIFICATION_CODE_TTL_MS / 60_000),
    dryRun: sendResult.dryRun,
  };
}

// ============================================================
// 校验
// ============================================================

export type VerifyCodeResult =
  | { ok: true; token: IssuedToken; isNewUser: boolean }
  | { ok: false; code: VerifyFailCode; message: string };

export type VerifyFailCode =
  | "invalid_email"
  | "invalid_code"
  | "code_expired"
  | "code_used"
  | "internal";

export interface VerifyCodeInput {
  email: string;
  code: string;
  ip?: string | null;
  userAgent?: string | null;
}

/** 校验验证码 + 签发 token。
 *  P1-003：markUsed / user 创建或验证 / issueToken 三步包在单一事务内，
 *  确保 sessions 失败时 user 回滚、code 不消耗，下次还能重试。
 *  审计日志（login_success）单独写，不因审计失败而回滚业务。
 */
export async function verifyCode(input: VerifyCodeInput): Promise<VerifyCodeResult> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, code: "invalid_email", message: "邮箱格式不正确" };
  }
  if (!input.code || input.code.length !== 6) {
    return { ok: false, code: "invalid_code", message: "验证码格式不正确" };
  }

  const emailHash = sha256(email);
  const codeHash = sha256(input.code);

  const vc = await vcRepo.findValidByCodeHash(emailHash, codeHash);
  if (!vc) {
    await safeAudit({
      eventType: "verification_failed",
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      detail: { emailHash, reason: "not_found_or_expired" },
    });
    return {
      ok: false,
      code: "invalid_code",
      message: "验证码错误或已过期，请重新获取",
    };
  }

  // 一次拿中心身份（P3-001a：之前重复调两次）
  const hub = await getHubIdentity();

  let token: IssuedToken;
  let isNewUser = false;
  try {
    ({ token, isNewUser } = await withTransaction(async (conn) => {
      // 1. 先消耗 code
      await vcRepo.markUsed(vc.id, conn);

      // 2. 创建或复用 user
      const existing = await usersRepo.findByEmailHash(emailHash, conn);
      let user;
      if (existing) {
        user = existing;
        if (!user.emailVerifiedAt) {
          await usersRepo.markEmailVerified(user.id, conn);
        }
      } else {
        user = await usersRepo.insert(
          {
            id: newId(),
            emailHash,
            emailPlainEnc: null,
            emailVerifiedAt: Date.now(),
            lastBackupHash: null,
            importedFromHub: null,
            importedAt: null,
            schemaVersion: "1.0.0",
            hubId: hub.hubId,
          },
          conn
        );
        isNewUser = true;
      }

      // 3. 签发 token（sessionsRepo.insert 在同一事务内）
      const t = await issueToken({
        userId: user.id,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        hubId: hub.hubId,
        conn,
      });
      return { token: t, isNewUser };
    }));
  } catch (err) {
    await safeAudit({
      eventType: "login_failed",
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      detail: { reason: "transaction_failed", error: String(err) },
    });
    return {
      ok: false,
      code: "internal",
      message: "登录处理失败，请重新获取验证码",
    };
  }

  // 4. 审计（单独事务，不因审计失败而回滚业务）
  await safeAudit({
    eventType: "login_success",
    userId: token.userId,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    detail: { isNewUser, sessionId: token.sessionId },
  });

  return { ok: true, token, isNewUser };
}

// ============================================================
// 退出登录
// ============================================================

export type LogoutResult =
  | { ok: true }
  | { ok: false; code: "no_token"; message: string };

/** 退出登录（撤销 token） */
export async function logout(
  token: string | null | undefined
): Promise<LogoutResult> {
  if (!token) return { ok: false, code: "no_token", message: "未登录" };
  // 复用 token 模块
  const { revokeToken } = await import("./token");
  await revokeToken(token);
  return { ok: true };
}
