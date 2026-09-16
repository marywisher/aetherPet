/**
 * 文件名称：season.ts
 * 功能描述：季节修饰件（复合生成层：事件 + 目的地 + 季节件）
 * 所属模块：domain/events
 * 契约对齐：docs/packs-contract.md §季节修饰件（pack_schema 1.2.0）
 *
 * 设计原则（产品决策，详见 CONTEXT.md「内容节奏」）：
 *   - 季节 >> 时段：季节是内容节奏的长线骨架（每季 10~15 条高辨识短标记），
 *     时段辨识度低，留在文案细节里，不升维成随机参数。
 *   - 复合生成：事件文案池不动，季节修饰件按「事件 + 目的地 + 季节件」拼接，
 *     文案工作量 40~60 条而非 160+ 条全组合。
 *   - 确定性：同一事件（同 event.id / 同 ts）永远拿到同一条修饰件——
 *     补算回溯、重渲染、导出后再渲染都不漂移。
 *   - 松耦合：本模块不改动 renderEvent 核心签名，路由层将 seasonTone
 *     附加进 rendered 输出即可；旧素材包（无 season_modifiers 键）零改动可用。
 */

import type { Event } from "./types";

export type Season = "spring" | "summer" | "autumn" | "winter";

export type SeasonModifiers = Partial<Record<Season, string[]>>;

/**
 * 由事件时间戳（UTC+8）判定季节。
 * 补算场景 ts 可回溯数月，必须用 ts 判定（而非当前时间）。
 * 月份：3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬。
 */
export function seasonOfTs(ts: number): Season {
  const d = new Date(ts + 8 * 3600 * 1000); // UTC+8（避开本地时区歧义，用 UTC getter）
  const m = d.getUTCMonth() + 1; // 1-12
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  return "winter"; // 12 / 1 / 2
}

/** 系统/聚合类事件不挂季节件（无语义），其余自然事件都挂 */
const EXCLUDED_TYPES: ReadonlySet<string> = new Set([
  "system_announce",
  "aggregate_summary",
]);

function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * 为事件取一条季节修饰件（确定性：由 event.id + ts 决定，不消费 rng）。
 * 包无 season_modifiers 键、或该季节数组为空时返回 null（UI 不显示）。
 */
export function seasonToneFor(
  event: Pick<Event, "id" | "ts" | "type">,
  seasonModifiers: SeasonModifiers | undefined | null
): string | null {
  if (EXCLUDED_TYPES.has(event.type)) return null;
  if (!seasonModifiers) return null;
  const lines = seasonModifiers[seasonOfTs(event.ts)];
  if (!lines || lines.length === 0) return null;
  return lines[stableHash(event.id) % lines.length];
}
