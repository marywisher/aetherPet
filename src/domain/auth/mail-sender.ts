/**
 * 文件名称：mail-sender.ts
 * 功能描述：邮件发送器（Nodemailer 封装）
 * 所属模块：domain/auth
 * 说明：
 *   - dry run 模式：仅 console.log，用于本地开发
 *   - 真实模式：使用 Nodemailer 走 SMTP
 *   - 每次发送写审计日志
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { loadSmtpConfig } from "./smtp-config";
import { insertAuditLog } from "../persistence/repos/audit.repo";
import type { EmailPayload } from "./email-template";

let _transporter: Transporter | null = null;

export interface SendResult {
  accepted: boolean;
  messageId?: string;
  dryRun: boolean;
  error?: string;
}

/** 懒加载 transporter */
function getTransporter() {
  if (_transporter) return _transporter;
  const cfg = loadSmtpConfig();
  _transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    pool: true,
    maxConnections: 2,
  });
  return _transporter;
}

export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  const cfg = loadSmtpConfig();

  if (cfg.dryRun) {
    // dry run：仅 console.log，写审计（P3-004：audit 写不阻塞业务）
    console.log(`[mail:dry-run] to=${payload.to} subject=${payload.subject}`);
    console.log(`[mail:dry-run] body:\n${payload.text}`);
    try {
      await insertAuditLog({
        eventType: "email_sent",
        detail: {
          to: payload.to,
          subject: payload.subject,
          dryRun: true,
          hubId: payload.headers["X-Aetherpet-Hub"],
        },
      });
    } catch (err) {
      console.warn("[audit] email_sent write failed:", err);
    }
    return { accepted: true, dryRun: true };
  }

  try {
    const transporter = getTransporter();
    const result = await transporter.sendMail({
      to: payload.to,
      from: payload.from,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      headers: payload.headers,
    });
    try {
      await insertAuditLog({
        eventType: "email_sent",
        detail: {
          to: payload.to,
          subject: payload.subject,
          dryRun: false,
          hubId: payload.headers["X-Aetherpet-Hub"],
          messageId: result.messageId,
        },
      });
    } catch (err) {
      console.warn("[audit] email_sent write failed:", err);
    }
    return { accepted: true, messageId: result.messageId, dryRun: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await insertAuditLog({
        eventType: "email_sent",
        detail: {
          to: payload.to,
          subject: payload.subject,
          dryRun: false,
          hubId: payload.headers["X-Aetherpet-Hub"],
          error: message,
        },
      });
    } catch (auditErr) {
      console.warn("[audit] email_sent error write failed:", auditErr);
    }
    return { accepted: false, dryRun: false, error: message };
  }
}

/** 测试用：重置 transporter */
export function _resetTransporter(): void {
  _transporter = null;
}
