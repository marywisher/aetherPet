/**
 * 文件名称：audit.repo.test.ts
 * 功能描述：audit.repo.ts 写入参数校验（P1-005：hub_id 不得硬编码）
 * 所属模块：tests/unit/persistence
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// mock db.getPool：让 repo 只走 execute mock，不真连 MySQL
vi.mock("@/domain/persistence/db", () => ({
  getPool: () => ({ execute: vi.fn().mockResolvedValue({ affectedRows: 1 }) }),
}));
vi.mock("@/domain/persistence/sql", () => ({
  execute: vi.fn().mockResolvedValue({ affectedRows: 1 }),
}));

import { execute } from "@/domain/persistence/sql";
import { insertAuditLog, logVerificationAttempt } from "@/domain/persistence/repos/audit.repo";

describe("audit.repo.ts（P1-005）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hub_id 使用 env.HUB_ID 兜底（不再是硬编码 'local'）", async () => {
    // setup.ts 已把 HUB_ID 设为 "test-hub"
    await insertAuditLog({
      eventType: "verification_attempt",
      detail: { emailHash: "hash" },
    });

    const call = (vi.mocked(execute).mock.calls[0] as unknown as [unknown, string, unknown[]])[2];
    // 参数顺序：user_id, event_type, detail, ip, user_agent, created_at, schema_version, hub_id
    expect(call[7]).toBe("test-hub");
  });

  it("hub_id 可由调用方显式传入，优先级高于 env", async () => {
    await insertAuditLog({
      eventType: "login_success",
      userId: "u1",
      hubId: "custom-hub",
    });
    const call = (vi.mocked(execute).mock.calls[0] as unknown as [unknown, string, unknown[]])[2];
    expect(call[7]).toBe("custom-hub");
  });

  it("schema_version 使用默认 '1.0.0'（不再是 SQL 硬编码）", async () => {
    await insertAuditLog({ eventType: "email_sent" });
    const call = (vi.mocked(execute).mock.calls[0] as unknown as [unknown, string, unknown[]])[2];
    expect(call[6]).toBe("1.0.0");
  });

  it("schema_version 可由调用方显式传入", async () => {
    await insertAuditLog({ eventType: "email_sent", schemaVersion: "2.0.0" });
    const call = (vi.mocked(execute).mock.calls[0] as unknown as [unknown, string, unknown[]])[2];
    expect(call[6]).toBe("2.0.0");
  });

  it("detail 为 null/undefined 时写入 null（不字符串化）", async () => {
    await insertAuditLog({ eventType: "email_sent" });
    const call = (vi.mocked(execute).mock.calls[0] as unknown as [unknown, string, unknown[]])[2];
    expect(call[2]).toBeNull();
  });

  it("detail 有内容时 JSON.stringify", async () => {
    await insertAuditLog({
      eventType: "verification_attempt",
      detail: { emailHash: "abc" },
    });
    const call = (vi.mocked(execute).mock.calls[0] as unknown as [unknown, string, unknown[]])[2];
    expect(call[2]).toBe(JSON.stringify({ emailHash: "abc" }));
  });

  it("SQL 语句使用 8 个占位符（不再硬编码任何值）", async () => {
    await insertAuditLog({ eventType: "email_sent" });
    const sql = (vi.mocked(execute).mock.calls[0] as unknown as [unknown, string, unknown[]])[1];
    // 8 个 ?
    expect((sql.match(/\?/g) || []).length).toBe(8);
    // 不应再出现硬编码 'local' 或 '1.0.0' 在 VALUES 里
    expect(sql).not.toMatch(/VALUES\s*\(\s*[^?]*'local'/);
    expect(sql).not.toMatch(/VALUES\s*\([^)]*'1\.0\.0'/);
  });

  it("logVerificationAttempt 便捷函数走同一写入路径（hub_id 也走 env）", async () => {
    await logVerificationAttempt("user@example.com", "1.2.3.4");
    const call = (vi.mocked(execute).mock.calls[0] as unknown as [unknown, string, unknown[]])[2];
    expect(call[7]).toBe("test-hub");
    expect(call[3]).toBe("1.2.3.4"); // ip
  });
});
