/**
 * 文件名称：crypto.ts
 * 功能描述：加密工具（SHA256、随机数）
 * 所属模块：domain/util
 */
import crypto from "crypto";

/** SHA256 hex */
export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/** 生成 6 位数字验证码 */
export function generateVerificationCode(digits = 6): string {
  // crypto.randomInt 均匀分布
  const max = Math.pow(10, digits);
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(digits, "0");
}

/** 生成 32 字节随机 token，返回 hex */
export function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
