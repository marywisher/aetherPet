/**
 * 文件名称：backup.test.ts
 * 功能描述：备份 hash 校验与记录（阶段 5）
 * 所属模块：tests/unit/domain/backup
 * 说明：
 *   - isValidSha256Hex 是纯函数，直接单测
 *   - recordBackupHash 会调用 repo；单测仅覆盖校验前置（invalid 直接抛，不进 DB）
 */

import { describe, it, expect } from "vitest";
import { isValidSha256Hex, recordBackupHash, InvalidBackupHashError } from "@/domain/backup/backup";

describe("backup.isValidSha256Hex", () => {
  it("64 位小写 hex → true", () => {
    const hash = "a".repeat(64);
    expect(isValidSha256Hex(hash)).toBe(true);
  });

  it("全 0 → true", () => {
    expect(isValidSha256Hex("0".repeat(64))).toBe(true);
  });

  it("含 f-a 混合 → true", () => {
    expect(isValidSha256Hex("0123456789abcdef".repeat(4))).toBe(true);
  });

  it("63 字符 → false", () => {
    expect(isValidSha256Hex("a".repeat(63))).toBe(false);
  });

  it("65 字符 → false", () => {
    expect(isValidSha256Hex("a".repeat(65))).toBe(false);
  });

  it("大写 hex → false（严格小写）", () => {
    expect(isValidSha256Hex("A".repeat(64))).toBe(false);
  });

  it("含非 hex 字符 → false", () => {
    expect(isValidSha256Hex("g".repeat(64))).toBe(false);
  });

  it("空字符串 → false", () => {
    expect(isValidSha256Hex("")).toBe(false);
  });

  it("含空白 → false", () => {
    expect(isValidSha256Hex(" a".repeat(32))).toBe(false);
  });
});

describe("backup.recordBackupHash", () => {
  it("非法 hash → 抛 InvalidBackupHashError（不进 DB）", async () => {
    await expect(
      recordBackupHash("user-1", "not-a-hash")
    ).rejects.toThrow(InvalidBackupHashError);
  });

  it("hash 类型正确但非 hex → 抛错", async () => {
    await expect(
      recordBackupHash("user-1", "XYZ".repeat(21) + "X")
    ).rejects.toThrow(InvalidBackupHashError);
  });
});
