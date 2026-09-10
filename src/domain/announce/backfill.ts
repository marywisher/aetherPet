/**
 * 文件名称：backfill.ts
 * 功能描述：公告空窗期聚合（阶段 5 · 硬需求）
 * 所属模块：domain/announce
 * 验收对齐：
 *   - docs/current-stage.md 关键约束 1：空窗期公告聚合（>7 天走聚合，不逐条轰炸）
 *   - docs/requirements.md §3.8 公告（"空窗期回补的公告走聚合摘要策略"）
 * 说明：
 *   - 纯函数（无 IO），便于单测确定性回放
 *   - 沿用阶段 3 补算策略：以「7 天阈值」切分"近期 vs 空窗期"
 *   - 聚合语义：把「publishedAt 早于 (now - 7d)」的「未读」公告合并为聚合摘要
 *     以 `now` 为锚，不是以最新一条公告的 publishedAt（否则用户回来时只剩 1 条老公告就无法聚合）
 *   - 已读/已静音公告不参与聚合（避免与已读状态相矛盾）
 *   - 空窗未读公告 = 0 → 返回 null；UI 直接列出全部
 *   - 空窗未读公告 ≥ 1 → 返回聚合摘要（保持语义一致，避免分支）
 */

import type {
  AnnouncementAggregation,
  AnnouncementStatus,
  AnnouncementWithStatus,
  Timestamp,
} from "./types";

/** 默认空窗阈值：7 天（与阶段 3 补算保持一致） */
export const BACKFILL_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/** 聚合预览最多展示几条 title */
export const BACKFILL_PREVIEW_LIMIT = 3;

export interface BuildAggregationInput {
  /**
   * 已经带状态的公告列表（由 hub.buildList 生成，通常按 publishedAt 倒序）。
   */
  items: AnnouncementWithStatus[];
  /** 空窗阈值，默认 7 天 */
  thresholdMs?: number;
  /** 预览条数上限，默认 3 */
  previewLimit?: number;
  /**
   * 当前时刻（UTC ms）；用作"锚"。
   * 默认 Date.now()（外部调用者应显式传入以保持单测确定性）。
   */
  now?: Timestamp;
}

/**
 * 构建空窗期聚合摘要。
 *
 * 语义：
 *   - 只聚合「publishedAt < (now - thresholdMs)」的「unread」公告
 *   - 若聚合数 = 0，返回 null（UI 展示全部单条）
 *   - 若聚合数 ≥ 1，返回聚合摘要
 *
 * @returns 聚合摘要，或 null
 */
export function buildAggregation(
  input: BuildAggregationInput
): AnnouncementAggregation | null {
  const thresholdMs = input.thresholdMs ?? BACKFILL_THRESHOLD_MS;
  const previewLimit = input.previewLimit ?? BACKFILL_PREVIEW_LIMIT;
  const now = input.now ?? Date.now();
  if (input.items.length === 0) return null;

  // 锚点：now - thresholdMs（不是最新公告的 publishedAt；避免"只剩 1 条老公告就聚合不出来"）
  const boundary = now - thresholdMs;

  // 只收集「空窗期 + 未读」公告
  const backfilled: AnnouncementWithStatus[] = [];
  for (const it of input.items) {
    if (it.status !== "unread") continue;
    if (it.announcement.publishedAt >= boundary) continue;
    backfilled.push(it);
  }
  if (backfilled.length === 0) return null;

  // backfilled 按 publishedAt 倒序（因为 input.items 已经倒序）
  const first = backfilled[backfilled.length - 1].announcement; // 最早
  const last = backfilled[0].announcement; // 最近

  const spanMs = last.publishedAt - first.publishedAt;
  const spanDays = spanMs > 0
    ? Math.max(1, Math.floor(spanMs / (24 * 60 * 60 * 1000)))
    : 1;

  return {
    count: backfilled.length,
    spanDays,
    firstPublishedAt: first.publishedAt,
    lastPublishedAt: last.publishedAt,
    previewTitles: backfilled
      .slice(0, previewLimit)
      .map((it) => it.announcement.title),
    // P2-002：被合并公告的 id（UI 从主列表隐藏）
    aggregatedIds: backfilled.map((it) => it.announcement.id),
  };
}

/**
 * 便捷函数：判断「某个 publishedAt 是否落入空窗期」。
 * 单测与 UI 均可复用。
 */
export function isBackfillWindow(
  publishedAt: Timestamp,
  now: Timestamp,
  thresholdMs: number = BACKFILL_THRESHOLD_MS
): boolean {
  return publishedAt < now - thresholdMs;
}

/** 导出类型以便外部（测试/UI）复用 */
export type { AnnouncementStatus };
