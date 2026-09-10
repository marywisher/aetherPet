/**
 * 文件名称：token.test.ts
 * 功能描述：token 格式校验单测（不查库）
 * 所属模块：tests/unit/auth
 */

import { describe, it, expect } from "vitest";
import { isTokenShapeValid } from "@/domain/auth/token";
import { sha256, generateVerificationCode, generateToken } from "@/domain/util/crypto";

describe("token（30 天签发/校验）", () => {
  it("isTokenShapeValid 校验合法 token", () => {
    const token = generateToken();
    expect(isTokenShapeValid(token)).toBe(true);
    expect(token.length).toBe(64);
  });

  it("isTokenShapeValid 拒绝空 token", () => {
    expect(isTokenShapeValid("")).toBe(false);
  });

  it("isTokenShapeValid 拒绝非 hex", () => {
    expect(isTokenShapeValid("xyz" + "0".repeat(61))).toBe(false);
  });

  it("isTokenShapeValid 拒绝长度不对", () => {
    expect(isTokenShapeValid("0".repeat(32))).toBe(false);
    expect(isTokenShapeValid("0".repeat(128))).toBe(false);
  });

  describe("crypto", () => {
    it("sha256 生成稳定的 64 字符 hex", () => {
      const hash = sha256("hello");
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
      expect(sha256("hello")).toBe(hash);
    });

    it("generateVerificationCode 生成 6 位数字", () => {
      const code = generateVerificationCode();
      expect(code.length).toBe(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });

    it("generateVerificationCode 支持自定义位数", () => {
      const code = generateVerificationCode(4);
      expect(code.length).toBe(4);
      expect(/^\d{4}$/.test(code)).toBe(true);
    });

    it("generateToken 生成 64 字符 hex", () => {
      const token = generateToken();
      expect(token.length).toBe(64);
      expect(/^[0-9a-f]+$/.test(token)).toBe(true);
    });

    it("sha256 大小写敏感", () => {
      expect(sha256("Hello")).not.toBe(sha256("hello"));
    });
  });
});
