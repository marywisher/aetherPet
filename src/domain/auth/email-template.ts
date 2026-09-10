/**
 * 文件名称：email-template.ts
 * 功能描述：验证码邮件模板（带中心身份标识）
 * 所属模块：domain/auth
 * 说明：
 *   - Header: X-Aetherpet-Hub: <hub_id>  （防止伪造中心身份）
 *   - 正文抬头：显示中心名称（透明）
 *   - 正文尾部：隐私承诺页 + 管理员邮箱（防钓鱼）
 *   - 领域层纯 TS，可独立单测
 */

import type { HubIdentity } from "../types";

export interface VerificationEmailInput {
  code: string;
  hub: HubIdentity;
  expiresAt: number;
  /** 收件邮箱（用于 To） */
  toEmail: string;
}

export interface EmailPayload {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  /** 中心身份 Header（NodeMailer 支持自定义 header） */
  headers: Record<string, string>;
}

/** 构建验证码邮件（带中心身份标识） */
export function buildVerificationEmail(
  input: VerificationEmailInput,
  from: string
): EmailPayload {
  const { code, hub, expiresAt, toEmail } = input;
  const expiresInMin = Math.ceil((expiresAt - Date.now()) / 60_000);

  const subject = `[${hub.hubDisplayName}] 你的 aetherPet 验证码`;

  const text = [
    `Hi,`,
    ``,
    `来自「${hub.hubDisplayName}」的 aetherPet 验证码：${code}`,
    ``,
    `请在 ${expiresInMin} 分钟内使用。若你不记得发起验证，请忽略此邮件。`,
    ``,
    `———`,
    `${hub.hubDisplayName}`,
    `隐私承诺：${hub.privacyUrl}`,
    `管理员联系：${hub.adminEmail}`,
  ].join("\n");

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(hub.hubDisplayName)} - aetherPet 验证码</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#3d2f23;max-width:560px;margin:0 auto;padding:24px;">
  <div style="background:#f6efe4;padding:24px;border-radius:8px;">
    <h2 style="margin:0 0 16px 0;font-size:20px;">来自 ${escapeHtml(hub.hubDisplayName)}</h2>
    <p>你的 aetherPet 验证码是：</p>
    <div style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#fff;padding:16px;border-radius:4px;text-align:center;margin:16px 0;">
      ${escapeHtml(code)}
    </div>
    <p>请在 <strong>${expiresInMin} 分钟</strong>内使用。若你不记得发起验证，请忽略此邮件。</p>
  </div>
  <hr style="margin:24px 0;border:none;border-top:1px solid #d4b483;">
  <div style="font-size:12px;color:#666;line-height:1.6;">
    <p style="margin:0 0 4px 0;"><strong>${escapeHtml(hub.hubDisplayName)}</strong> · aetherPet</p>
    <p style="margin:0 0 4px 0;">隐私承诺：<a href="${escapeHtml(hub.privacyUrl)}" style="color:#85c485;">${escapeHtml(hub.privacyUrl)}</a></p>
    <p style="margin:0;">管理员联系：<a href="mailto:${escapeHtml(hub.adminEmail)}">${escapeHtml(hub.adminEmail)}</a></p>
  </div>
</body>
</html>
`;

  return {
    to: toEmail,
    from,
    subject,
    text,
    html,
    headers: {
      "X-Aetherpet-Hub": hub.hubId,
      "X-Aetherpet-Hub-Name": hub.hubDisplayName,
      "List-Unsubscribe": `<${hub.privacyUrl}?unsubscribe=1>`,
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
