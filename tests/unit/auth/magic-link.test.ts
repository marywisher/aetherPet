/**
 * 文件名称：magic-link.test.ts
 * 功能描述：magic-link 签发/校验单测（mock DB + email）
 * 所属模块：tests/unit/auth
 * 验收对齐：docs/requirements.md §6 #1 注册登录（含安全边界）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { requestCode, verifyCode } from "@/domain/auth/magic-link";

// 使用 vi.hoisted 解决 vi.mock 工厂函数的变量提升问题
const mocks = vi.hoisted(() => ({
  vcRepo: {
    insert: vi.fn(),
    findValidByCodeHash: vi.fn(),
    markUsed: vi.fn(),
    countByEmailHashSince: vi.fn(),
  },
  usersRepo: {
    findById: vi.fn(),
    findByEmailHash: vi.fn(),
    insert: vi.fn(),
    markEmailVerified: vi.fn(),
  },
  sessionsRepo: {
    insert: vi.fn(),
    findById: vi.fn(),
    findByIdForUpdate: vi.fn(),
    revoke: vi.fn(),
  },
  auditRepo: {
    insertAuditLog: vi.fn(),
  },
  mailSender: {
    sendEmail: vi.fn(),
  },
  db: {
    withTransaction: vi.fn(),
  },
}));

vi.mock("@/domain/persistence/repos/verification-codes.repo", () => mocks.vcRepo);
vi.mock("@/domain/persistence/repos/users.repo", () => mocks.usersRepo);
vi.mock("@/domain/persistence/repos/sessions.repo", () => mocks.sessionsRepo);
vi.mock("@/domain/persistence/repos/audit.repo", () => mocks.auditRepo);
vi.mock("@/domain/auth/mail-sender", () => mocks.mailSender);
// 单测不连真 DB：withTransaction 直接同步调用回调（conn 用空对象占位）
vi.mock("@/domain/persistence/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domain/persistence/db")>();
  return {
    ...actual,
    withTransaction: mocks.db.withTransaction,
  };
});

const { vcRepo, usersRepo, sessionsRepo, auditRepo, mailSender, db } = mocks;

describe("magic-link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vcRepo.countByEmailHashSince.mockResolvedValue(0);
    vcRepo.insert.mockResolvedValue({ id: "vc123", usedAt: null });
    mailSender.sendEmail.mockResolvedValue({ accepted: true, dryRun: true });
    usersRepo.findByEmailHash.mockResolvedValue(null);
    sessionsRepo.insert.mockResolvedValue({
      id: "session123",
      userId: "user123",
      tokenHash: "hash",
      issuedAt: 0,
      expiresAt: 0,
      lastSeenAt: 0,
      ip: null,
      userAgent: null,
      revokedAt: null,
      schemaVersion: "1.0.0",
      hubId: "local",
    });
    usersRepo.insert.mockResolvedValue({
      id: "user123",
      emailHash: "hash",
      emailPlainEnc: null,
      emailVerifiedAt: 0,
      createdAt: 0,
      updatedAt: 0,
      lastBackupHash: null,
      importedFromHub: null,
      importedAt: null,
      schemaVersion: "1.0.0",
      hubId: "local",
    });
    // withTransaction 直接调用回调（conn 传空对象），不连真 DB
    db.withTransaction.mockImplementation(async (fn: any) => fn({}));
  });

  describe("requestCode", () => {
    it("email 格式错误时返回错误", async () => {
      const result = await requestCode({ email: "not-an-email" });
      expect(result.ok).toBe(false);
    });

    it("同邮箱超限时返回节流错误", async () => {
      vcRepo.countByEmailHashSince.mockResolvedValue(3);
      const result = await requestCode({ email: "a@b.com" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("throttled_email");
        expect(result.message).toContain("过于频繁");
      }
    });

    it("邮件发送失败时返回 email_send_failed", async () => {
      mailSender.sendEmail.mockResolvedValue({ accepted: false, dryRun: false, error: "SMTP refused" });
      const result = await requestCode({ email: "a@b.com" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("email_send_failed");
      }
    });

    it("成功时返回 ok=true + dryRun=true", async () => {
      const result = await requestCode({ email: "a@b.com", ip: "1.2.3.4", userAgent: "test" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.expiresInMin).toBe(10);
        expect(result.dryRun).toBe(true);
      }
    });

    it("成功时写入 verification_codes", async () => {
      await requestCode({ email: "a@b.com" });
      expect(vcRepo.insert).toHaveBeenCalled();
      const call = vcRepo.insert.mock.calls[0][0];
      expect(call.emailHash).toMatch(/^[0-9a-f]{64}$/);
      expect(call.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(call.expiresAt).toBeGreaterThan(Date.now());
    });

    it("成功时发送验证码邮件", async () => {
      await requestCode({ email: "a@b.com" });
      expect(mailSender.sendEmail).toHaveBeenCalled();
      const payload = mailSender.sendEmail.mock.calls[0][0];
      expect(payload.to).toBe("a@b.com");
      expect(payload.headers["X-Aetherpet-Hub"]).toBeDefined();
      expect(payload.text).toMatch(/\d{6}/);
    });

    it("成功时写审计日志 verification_attempt", async () => {
      await requestCode({ email: "a@b.com" });
      expect(auditRepo.insertAuditLog).toHaveBeenCalled();
      const calls = auditRepo.insertAuditLog.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.eventType === "verification_attempt")).toBe(true);
    });
  });

  describe("verifyCode", () => {
    it("email 格式错误时返回 invalid_email", async () => {
      const result = await verifyCode({ email: "not-an-email", code: "123456" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_email");
    });

    it("code 长度错误时返回 invalid_code", async () => {
      const result = await verifyCode({ email: "a@b.com", code: "12345" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_code");
    });

    it("验证码不存在时返回 invalid_code", async () => {
      vcRepo.findValidByCodeHash.mockResolvedValue(null);
      const result = await verifyCode({ email: "a@b.com", code: "123456" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_code");
    });

    it("新用户首次登录：创建 user + 签发 token", async () => {
      vcRepo.findValidByCodeHash.mockResolvedValue({
        id: "vc1",
        emailHash: "hash",
        codeHash: "hash",
        usedAt: null,
        userId: "x",
        issuedAt: 0,
        expiresAt: Date.now() + 600_000,
        ip: null,
        userAgent: null,
        schemaVersion: "1.0.0",
        hubId: "local",
      });
      usersRepo.findByEmailHash.mockResolvedValue(null);
      usersRepo.insert.mockResolvedValue({
        id: "user123",
        emailHash: "hash",
        emailPlainEnc: null,
        emailVerifiedAt: 0,
        createdAt: 0,
        updatedAt: 0,
        lastBackupHash: null,
        importedFromHub: null,
        importedAt: null,
        schemaVersion: "1.0.0",
        hubId: "local",
      });
      const result = await verifyCode({ email: "a@b.com", code: "123456" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.isNewUser).toBe(true);
        expect(result.token.userId).toBe("user123");
        expect(result.token.token.length).toBe(64);
        expect(result.token.expiresAt).toBeGreaterThan(Date.now());
      }
    });

    it("老用户：不重复创建 user", async () => {
      vcRepo.findValidByCodeHash.mockResolvedValue({
        id: "vc1",
        emailHash: "hash",
        codeHash: "hash",
        usedAt: null,
        userId: "x",
        issuedAt: 0,
        expiresAt: Date.now() + 600_000,
        ip: null,
        userAgent: null,
        schemaVersion: "1.0.0",
        hubId: "local",
      });
      usersRepo.findByEmailHash.mockResolvedValue({
        id: "existing_user",
        emailHash: "hash",
        emailPlainEnc: null,
        emailVerifiedAt: Date.now() - 1000,
        createdAt: 0,
        updatedAt: 0,
        lastBackupHash: null,
        importedFromHub: null,
        importedAt: null,
        schemaVersion: "1.0.0",
        hubId: "local",
      });
      const result = await verifyCode({ email: "a@b.com", code: "123456" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.isNewUser).toBe(false);
        expect(result.token.userId).toBe("existing_user");
      }
      expect(usersRepo.insert).not.toHaveBeenCalled();
    });

    // P1-003：atomicity — sessionsRepo.insert 抛错时，user 回滚（不实际写）
    it("P1-003：sessions 写入失败时返回 internal（事务回滚）", async () => {
      vcRepo.findValidByCodeHash.mockResolvedValue({
        id: "vc1",
        emailHash: "hash",
        codeHash: "hash",
        usedAt: null,
        userId: "x",
        issuedAt: 0,
        expiresAt: Date.now() + 600_000,
        ip: null,
        userAgent: null,
        schemaVersion: "1.0.0",
        hubId: "local",
      });
      usersRepo.findByEmailHash.mockResolvedValue(null);
      // 模拟 sessionsRepo.insert 失败
      sessionsRepo.insert.mockRejectedValueOnce(new Error("DB timeout"));
      const result = await verifyCode({ email: "a@b.com", code: "123456" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("internal");
      // 审计写 login_failed
      const calls = auditRepo.insertAuditLog.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.eventType === "login_failed")).toBe(true);
      // 未写 login_success
      expect(calls.some((c) => c.eventType === "login_success")).toBe(false);
    });

    // P1-003：transaction 确保 markUsed 在事务内
    it("P1-003：markUsed / users.insert / sessions.insert 都在同一事务回调内", async () => {
      vcRepo.findValidByCodeHash.mockResolvedValue({
        id: "vc1",
        emailHash: "hash",
        codeHash: "hash",
        usedAt: null,
        userId: "x",
        issuedAt: 0,
        expiresAt: Date.now() + 600_000,
        ip: null,
        userAgent: null,
        schemaVersion: "1.0.0",
        hubId: "local",
      });
      usersRepo.findByEmailHash.mockResolvedValue(null);
      let order: string[] = [];
      const origWithTxn = db.withTransaction;
      db.withTransaction.mockImplementation(async (fn: any) => {
        // 确认 conn 已传入回调
        const fakeConn = { __isTxnConn: true };
        return fn(fakeConn);
      });
      const origMarkUsed = vcRepo.markUsed.mock;
      vcRepo.markUsed.mockImplementation(async () => {
        order.push("markUsed");
      });
      const origInsert = usersRepo.insert.mock;
      usersRepo.insert.mockImplementation(async () => {
        order.push("users.insert");
        return {
          id: "user123",
          emailHash: "hash",
          emailPlainEnc: null,
          emailVerifiedAt: 0,
          createdAt: 0,
          updatedAt: 0,
          lastBackupHash: null,
          importedFromHub: null,
          importedAt: null,
          schemaVersion: "1.0.0",
          hubId: "local",
        };
      });
      const origSessionsInsert = sessionsRepo.insert.mock;
      sessionsRepo.insert.mockImplementation(async () => {
        order.push("sessions.insert");
        return {
          id: "session123",
          userId: "user123",
          tokenHash: "hash",
          issuedAt: 0,
          expiresAt: 0,
          lastSeenAt: 0,
          ip: null,
          userAgent: null,
          revokedAt: null,
          schemaVersion: "1.0.0",
          hubId: "local",
        };
      });
      const result = await verifyCode({ email: "a@b.com", code: "123456" });
      expect(result.ok).toBe(true);
      // 三个操作必须在同一事务内，且 markUsed 在最前
      expect(order).toEqual(["markUsed", "users.insert", "sessions.insert"]);
      // withTransaction 被调一次
      expect(db.withTransaction).toHaveBeenCalledTimes(1);
    });

    it("P1-003：审计写 login_success（事务外的单独写入）", async () => {
      vcRepo.findValidByCodeHash.mockResolvedValue({
        id: "vc1",
        emailHash: "hash",
        codeHash: "hash",
        usedAt: null,
        userId: "x",
        issuedAt: 0,
        expiresAt: Date.now() + 600_000,
        ip: null,
        userAgent: null,
        schemaVersion: "1.0.0",
        hubId: "local",
      });
      usersRepo.findByEmailHash.mockResolvedValue({
        id: "existing_user",
        emailHash: "hash",
        emailPlainEnc: null,
        emailVerifiedAt: Date.now() - 1000,
        createdAt: 0,
        updatedAt: 0,
        lastBackupHash: null,
        importedFromHub: null,
        importedAt: null,
        schemaVersion: "1.0.0",
        hubId: "local",
      });
      await verifyCode({ email: "a@b.com", code: "123456" });
      const calls = auditRepo.insertAuditLog.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.eventType === "login_success")).toBe(true);
      const loginCall = calls.find((c) => c.eventType === "login_success");
      expect(loginCall?.detail?.sessionId).toBeDefined();
    });
  });
});
