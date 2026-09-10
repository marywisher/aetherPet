/**
 * 文件名称：date.ts
 * 功能描述：日期工具（UTC+8 本地日期字符串）
 * 所属模块：domain/util
 * 说明：
 *   - pets.daily_grant_last_date / pets.offer_last_date 用 VARCHAR(10) 存 YYYY-MM-DD
 *   - schema 文档明确「UTC+8 由前端传入」，但为保证服务端判断一致，
 *     我们在服务端统一使用 Asia/Shanghai 时区（+08:00）计算
 *   - 纯 TS，不依赖 next/react
 */

/** 时区偏移：UTC+8 相对 UTC 的毫秒差 */
const UTC_PLUS_8_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * UTC 毫秒 → UTC+8 YYYY-MM-DD 字符串。
 *
 * @param tsUtcMs UTC 毫秒时间戳（Date.now()）
 * @returns 'YYYY-MM-DD'，例如 '2026-09-09'
 */
export function toLocalDateStr(tsUtcMs: number): string {
  const shifted = new Date(tsUtcMs + UTC_PLUS_8_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 判断两个 UTC 毫秒时间戳是否处于同一个 UTC+8 日期。
 */
export function isSameLocalDate(ts1: number, ts2: number): boolean {
  return toLocalDateStr(ts1) === toLocalDateStr(ts2);
}

/** 当前 UTC 毫秒时间戳（封装以便单测注入） */
export function nowTs(): number {
  return Date.now();
}
