/**
 * 文件名称：types.ts
 * 功能描述：公告领域实体与状态类型（阶段 5）
 * 所属模块：domain/announce
 * 验收对齐：
 *   - docs/requirements.md §3.8 公告（已读/未读、静音、倒序、空窗聚合）
 *   - docs/database-schema.md §5 announcements / user_announcement_reads
 * 说明：
 *   - 领域层纯 TS，不 import next/react
 *   - 时间戳统一 UTC 毫秒
 *   - 事件结构不含文案：announcement.body / title 属于公告实体，不塞进 event.params
 */

import type { Timestamp, Ulid } from "../types";

/** 转发时间戳与 ULID 类型，便于外部（backfill/hub）单点引用 */
export type { Timestamp, Ulid };

/** 公告级别 */
export type AnnouncementLevel = "info" | "important" | "critical";

/** 服务中心公告（架构 §4.1 announce） */
export interface Announcement {
  id: Ulid;
  title: string;
  body: string;
  level: AnnouncementLevel;
  /** 发布时刻（UTC ms） */
  publishedAt: Timestamp;
  /** 发布方中心 id（MVP 恒等于 hub_id；未来联邦广播使用） */
  authorHubId: string;
  /** Ed25519 签名（MVP 恒 null；未来联邦广播用） */
  signature: string | null;
  /** 过期时刻（null = 永不过期） */
  expiresAt: Timestamp | null;
  schemaVersion: string;
  hubId: string;
}

/** 用户公告已读/静音状态 */
export interface UserAnnouncementRead {
  userId: Ulid;
  announcementId: Ulid;
  /** 首次标记已读的 UTC ms */
  readAt: Timestamp;
  /**
   * 用户点"静音 N 条"后的静音截止时间。
   * null = 未静音；非 null 且 > now = 当前处于静音期。
   */
  mutedUntilTs: Timestamp | null;
  schemaVersion: string;
  hubId: string;
}

/**
 * 单条公告在用户视角下的状态（列表返回项）。
 */
export type AnnouncementStatus = "unread" | "read" | "muted";

export interface AnnouncementWithStatus {
  announcement: Announcement;
  status: AnnouncementStatus;
  readAt: Timestamp | null;
  mutedUntilTs: Timestamp | null;
}

/**
 * 空窗期聚合摘要（阶段 5 硬需求：>7 天未读走聚合，不逐条轰炸）。
 * 沿用阶段 3 补算的策略，仅用于公告列表的"最顶部"呈现。
 */
export interface AnnouncementAggregation {
  /** 覆盖的公告数 */
  count: number;
  /** 覆盖天数（向下取整） */
  spanDays: number;
  /** 最早一条的时间戳 */
  firstPublishedAt: Timestamp;
  /** 最新一条的时间戳 */
  lastPublishedAt: Timestamp;
  /**
   * 展示级 titles 快照（不超过 3 条，从最新到最旧）。
   * 快照仅用于列表 UI 展示“这些标题都被合并了”，不替代原始 announcement。
   */
  previewTitles: string[];
  /**
   * 被合并进聚合的公告 id（阶段 6 P2-002）：UI 据此从主列表隐藏这些条目，
   * 只在聚合卡片下提供“已合并 N 条”的可展开次级列表，避免“轰炸”感。
   */
  aggregatedIds: string[];
}

/** buildList 输入：从 repo 层拿到的原始两表数据 */
export interface ListInput {
  announcements: Announcement[];
  reads: UserAnnouncementRead[];
  /** 当前时刻（UTC ms；单测可注入） */
  now: Timestamp;
  /** 聚合阈值：多少毫秒以上视为"空窗期"（默认 7 天） */
  backfillThresholdMs?: number;
}

/** buildList 输出 */
export interface ListOutput {
  /** 主列表条目（已隐藏被聚合项——P2-002） */
  items: AnnouncementWithStatus[];
  /** 未读数（不含 muted） */
  unreadCount: number;
  /** 静音数（当前处于静音期的公告数） */
  mutedCount: number;
  /** 空窗聚合（null 表示无聚合） */
  aggregation: AnnouncementAggregation | null;
  /** 被聚合进摘要、从主列表隐藏的公告 id（UI 次级展开用） */
  aggregatedIds: string[];
  /** 被聚合的公告完整条目（供聚合卡片下“展开已合并 N 条”次级列表渲染） */
  aggregatedItems: AnnouncementWithStatus[];
}
