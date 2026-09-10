/**
 * 文件名称：hub.ts
 * 功能描述：公告中心领域层（阶段 5）
 * 所属模块：domain/announce
 * 验收对齐：
 *   - docs/requirements.md §3.8 公告（发布 / 倒序列出 / 已读未读 / 静音）
 *   - docs/current-stage.md 阶段 5 关键交付 1（hub.ts）
 *   - docs/current-stage.md 关键约束 3：领域层纯 TS，事件结构不含文案
 *   - docs/pitfalls.md 阶段 4 教训：跨阶段字段写入方必须明确 + DB 条件更新保证幂等
 * 说明：
 *   - 纯 TS（无 IO、无 next/react）；所有 IO 由 repo 层承担
 *   - "静音 N 条"语义：把 N 条公告从最新往旧静音，每条设置 mutedUntilTs
 *     = now + muteDurationMs（默认 7 天）；静音期结束后自动恢复
 *   - buildList 是纯函数：读取 repo 层的公告 + 已读状态后合并，返回给 API 层
 *   - 幂等约束：markRead 用 INSERT IGNORE（affectedRows=0 表示已存在，视为成功）
 *   - 本文件**不**修改 event 表——公告是用户级触达通道，与 pet 事件流解耦
 *   - 事件"system_announce"生成器（domain/events/generators/announcement.ts）由外部
 *     （未来联邦广播或运营工具）主动调用；本文件不提供该集成，避免"事件结构含文案"
 */

import type {
  Announcement,
  AnnouncementAggregation,
  AnnouncementStatus,
  AnnouncementWithStatus,
  ListInput,
  ListOutput,
  UserAnnouncementRead,
  Timestamp,
  Ulid,
} from "./types";
import {
  BACKFILL_THRESHOLD_MS,
  buildAggregation,
} from "./backfill";

// ============================================================
// 静音默认时长
// ============================================================

/**
 * "静音 N 条"默认时长：7 天。
 * 超过 7 天用户仍不来看，说明这条信息已不重要（与阶段 3 退避策略呼应）。
 */
export const MUTE_DEFAULT_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// ============================================================
// 已读状态查询（供 buildList 使用）
// ============================================================

/**
 * 判断一条已读记录是否"当前处于静音期"。
 * 纯函数（供 UI 与列表 API 复用）。
 */
export function isCurrentlyMuted(
  mutedUntilTs: Timestamp | null,
  now: Timestamp
): boolean {
  return mutedUntilTs !== null && mutedUntilTs > now;
}

/**
 * 计算单条公告在用户视角下的状态。
 *
 * 优先级：muted > read > unread
 * （已静音的公告即使是"已读"也标为 muted，UI 展示灰色标记）
 */
export function computeStatus(
  read: UserAnnouncementRead | null,
  now: Timestamp
): AnnouncementStatus {
  if (read === null) return "unread";
  if (isCurrentlyMuted(read.mutedUntilTs, now)) return "muted";
  return "read";
}

// ============================================================
// 列表构建（纯函数）
// ============================================================

/**
 * 构建公告列表输出。
 *
 * 契约：
 *   - 输入 announcements 已按 publishedAt 倒序（repo 层保证）
 *   - 已读记录按任意顺序传入，内部按 announcementId 建索引
 *   - 输出 items 保持倒序，aggregation 若存在则展示已静音前的"空窗聚合"
 *
 * 副作用：无（纯计算）
 */
export function buildList(input: ListInput): ListOutput {
  const { announcements, reads, now } = input;
  const threshold = input.backfillThresholdMs ?? BACKFILL_THRESHOLD_MS;

  // 建立 announcementId → read 索引，避免 O(N*M) 嵌套扫描
  const readMap = new Map<Ulid, UserAnnouncementRead>();
  for (const r of reads) {
    readMap.set(r.announcementId, r);
  }

  const items: AnnouncementWithStatus[] = announcements.map((a) => {
    const read = readMap.get(a.id) ?? null;
    return {
      announcement: a,
      status: computeStatus(read, now),
      readAt: read?.readAt ?? null,
      mutedUntilTs: read?.mutedUntilTs ?? null,
    };
  });

  let unreadCount = 0;
  let mutedCount = 0;
  for (const it of items) {
    if (it.status === "unread") unreadCount += 1;
    else if (it.status === "muted") mutedCount += 1;
  }

  // 空窗聚合：以 now 为锚，回溯 threshold 之前的未读部分
  const aggregation: AnnouncementAggregation | null = buildAggregation({
    items,
    thresholdMs: threshold,
    now,
  });

  // P2-002：主列表隐藏已聚合项（仅暴露到聚合卡片下的次级列表）
  const aggregatedIds = aggregation?.aggregatedIds ?? [];
  const visibleItems = items.filter((it) => !aggregatedIds.includes(it.announcement.id));
  const aggregatedItems = aggregation
    ? items.filter((it) => aggregatedIds.includes(it.announcement.id))
    : [];

  return { items: visibleItems, unreadCount, mutedCount, aggregation, aggregatedIds, aggregatedItems };
}

// ============================================================
// 静音计划（纯函数，供 API 层调用后再逐条 UPDATE）
// ============================================================

/**
 * 计算"静音 N 条"要静默哪 N 条公告（从最新往旧，且当前处于"未读"状态）。
 *
 * 设计约束：
 *   - 只静音"未读"公告：避免覆盖用户已有阅读/静音记录
 *   - N <= 0 或列表为空时返回空数组（防御式）
 *   - 若 N 大于未读条数，返回全部未读（不报错）
 *
 * 副作用：无（纯计算）；实际 UPDATE 由 repo 层承担。
 */
export function planMute(
  items: AnnouncementWithStatus[],
  count: number,
  now: Timestamp,
  muteDurationMs: number = MUTE_DEFAULT_DURATION_MS
): { ids: Ulid[]; mutedUntilTs: Timestamp } {
  // 无论 count 是否为 0，都返回 mutedUntilTs（便于日志与观测一致性）
  const mutedUntilTs = now + muteDurationMs;
  if (count <= 0) {
    return { ids: [], mutedUntilTs };
  }
  const unreadItems = items.filter((it) => it.status === "unread");
  const selected = unreadItems.slice(0, count);
  return {
    ids: selected.map((it) => it.announcement.id),
    mutedUntilTs,
  };
}

// ============================================================
// 导出（便于外部引用类型）
// ============================================================

export type {
  Announcement,
  AnnouncementAggregation,
  AnnouncementStatus,
  AnnouncementWithStatus,
  ListInput,
  ListOutput,
  UserAnnouncementRead,
};
