/**
 * 文件名称：ulid.ts
 * 功能描述：ULID 生成工具（薄封装 ulid 库）
 * 所属模块：domain/util
 */
import { ulid } from "ulid";

export function newId(): string {
  return ulid();
}
