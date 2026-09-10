/**
 * 文件名称：email-template.test.ts
 * 功能描述：验证码邮件模板单测（重点：中心身份标识）
 * 所属模块：tests/unit/auth
 * 验收对齐：docs/requirements.md §6 #1 注册登录 + 中心自治邮件
 */

import { describe, it, expect } from "vitest";
import { buildVerificationEmail } from "@/domain/auth/email-template";
import type { HubIdentity } from "@/domain/types";

const HUB: HubIdentity = {
  hubId: "test-hub.local",
  hubDisplayName: "Test Hub",
  adminEmail: "admin@test.local",
  privacyUrl: "https://test.local/privacy",
  domain: "test.local",
};

describe("buildVerificationEmail（中心自治邮件）", () => {
  it("Header 带 X-Aetherpet-Hub 中心身份标识", () => {
    const email = buildVerificationEmail(
      { code: "123456", hub: HUB, expiresAt: Date.now() + 600_000, toEmail: "user@example.com" },
      "noreply@test.local"
    );
    expect(email.headers["X-Aetherpet-Hub"]).toBe("test-hub.local");
    expect(email.headers["X-Aetherpet-Hub-Name"]).toBe("Test Hub");
  });

  it("正文包含中心名称（抬头）", () => {
    const email = buildVerificationEmail(
      { code: "123456", hub: HUB, expiresAt: Date.now() + 600_000, toEmail: "user@example.com" },
      "noreply@test.local"
    );
    // 纯文本正文包含中心名
    expect(email.text).toContain("Test Hub");
    // HTML 正文也包含中心名
    expect(email.html).toContain("Test Hub");
  });

  it("正文尾部包含隐私承诺页 + 管理员邮箱", () => {
    const email = buildVerificationEmail(
      { code: "123456", hub: HUB, expiresAt: Date.now() + 600_000, toEmail: "user@example.com" },
      "noreply@test.local"
    );
    expect(email.text).toContain(HUB.privacyUrl);
    expect(email.text).toContain(HUB.adminEmail);
    expect(email.html).toContain(HUB.privacyUrl);
    expect(email.html).toContain(HUB.adminEmail);
  });

  it("正文包含验证码", () => {
    const email = buildVerificationEmail(
      { code: "123456", hub: HUB, expiresAt: Date.now() + 600_000, toEmail: "user@example.com" },
      "noreply@test.local"
    );
    expect(email.text).toContain("123456");
    expect(email.html).toContain("123456");
  });

  it("主题包含中心名", () => {
    const email = buildVerificationEmail(
      { code: "123456", hub: HUB, expiresAt: Date.now() + 600_000, toEmail: "user@example.com" },
      "noreply@test.local"
    );
    expect(email.subject).toContain("Test Hub");
  });

  it("From 使用传入的 SMTP_FROM", () => {
    const email = buildVerificationEmail(
      { code: "123456", hub: HUB, expiresAt: Date.now() + 600_000, toEmail: "user@example.com" },
      "noreply@test.local"
    );
    expect(email.from).toBe("noreply@test.local");
    expect(email.to).toBe("user@example.com");
  });

  it("剩余时间计算正确", () => {
    const email = buildVerificationEmail(
      { code: "123456", hub: HUB, expiresAt: Date.now() + 540_000, toEmail: "user@example.com" },
      "noreply@test.local"
    );
    // 9 分钟
    expect(email.text).toMatch(/9\s*分钟/);
    expect(email.html).toMatch(/9\s*分钟/);
  });
});
