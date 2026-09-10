/**
 * 文件名称：hub.test.ts
 * 功能描述：公告中心领域层单测（阶段 5）
 * 所属模块：tests/unit/domain/announce
 * 覆盖：
 *   - buildList：已读/未读/静音状态计算
 *   - buildList：未读/静音计数
 *   - buildList：空窗聚合（>7 天）
 *   - planMute：静音 N 条（仅未读、从最新往旧）
 *   - computeStatus：状态优先级（muted > read > unread）
 *   - isCurrentlyMuted：静音过期判定
 */

import { describe, it, expect } from "vitest";
import {
  buildList,
  computeStatus,
  isCurrentlyMuted,
  planMute,
  MUTE_DEFAULT_DURATION_MS,
} from "@/domain/announce/hub";
import { buildAggregation } from "@/domain/announce/backfill";
import type {
  Announcement,
  UserAnnouncementRead,
} from "@/domain/announce/types";

const NOW = 1_746_600_000_000; // 参考时刻（UTC ms）

function makeAnnouncement(
  overrides: Partial<Announcement> = {}
): Announcement {
  return {
    id: `ann-${Math.random().toString(36).slice(2, 8)}`,
    title: "默认公告",
    body: "默认正文",
    level: "info",
    publishedAt: NOW - 1000,
    authorHubId: "local",
    signature: null,
    expiresAt: null,
    schemaVersion: "1.0.0",
    hubId: "local",
    ...overrides,
  };
}

function makeRead(
  overrides: Partial<UserAnnouncementRead> = {}
): UserAnnouncementRead {
  return {
    userId: "user-1",
    announcementId: "ann-default",
    readAt: NOW,
    mutedUntilTs: null,
    schemaVersion: "1.0.0",
    hubId: "local",
    ...overrides,
  };
}

describe("hub.computeStatus / isCurrentlyMuted", () => {
  it("read=null → unread", () => {
    expect(computeStatus(null, NOW)).toBe("unread");
  });

  it("read 有、无静音 → read", () => {
    const read = makeRead();
    expect(computeStatus(read, NOW)).toBe("read");
  });

  it("read 有、静音期未过 → muted", () => {
    const read = makeRead({ mutedUntilTs: NOW + 1000 });
    expect(computeStatus(read, NOW)).toBe("muted");
  });

  it("read 有、静音已过期 → read", () => {
    const read = makeRead({ mutedUntilTs: NOW - 1 });
    expect(computeStatus(read, NOW)).toBe("read");
  });

  it("isCurrentlyMuted: null → false", () => {
    expect(isCurrentlyMuted(null, NOW)).toBe(false);
  });

  it("isCurrentlyMuted: 边界（=now）→ false（严格大于）", () => {
    expect(isCurrentlyMuted(NOW, NOW)).toBe(false);
  });

  it("isCurrentlyMuted: 未来时刻 → true", () => {
    expect(isCurrentlyMuted(NOW + 1, NOW)).toBe(true);
  });
});

describe("hub.buildList", () => {
  it("空列表 → items=[], unreadCount=0, mutedCount=0, aggregation=null", () => {
    const result = buildList({ announcements: [], reads: [], now: NOW });
    expect(result.items).toEqual([]);
    expect(result.unreadCount).toBe(0);
    expect(result.mutedCount).toBe(0);
    expect(result.aggregation).toBeNull();
  });

  it("3 条全部未读（无 reads）→ 全部 status=unread，unreadCount=3", () => {
    const a1 = makeAnnouncement({ id: "a1", publishedAt: NOW - 3 * 60_000 });
    const a2 = makeAnnouncement({ id: "a2", publishedAt: NOW - 2 * 60_000 });
    const a3 = makeAnnouncement({ id: "a3", publishedAt: NOW - 1 * 60_000 });
    const result = buildList({
      announcements: [a1, a2, a3],
      reads: [],
      now: NOW,
    });
    expect(result.unreadCount).toBe(3);
    expect(result.mutedCount).toBe(0);
    for (const it of result.items) {
      expect(it.status).toBe("unread");
      expect(it.readAt).toBeNull();
      expect(it.mutedUntilTs).toBeNull();
    }
  });

  it("部分已读、部分静音 → 分别计数", () => {
    const a1 = makeAnnouncement({ id: "a1", publishedAt: NOW - 3 * 60_000 });
    const a2 = makeAnnouncement({ id: "a2", publishedAt: NOW - 2 * 60_000 });
    const a3 = makeAnnouncement({ id: "a3", publishedAt: NOW - 1 * 60_000 });
    const reads = [
      makeRead({ announcementId: "a1", readAt: NOW - 60_000 }), // read
      makeRead({ announcementId: "a2", mutedUntilTs: NOW + 3600_000 }), // muted
    ];
    const result = buildList({
      announcements: [a1, a2, a3],
      reads,
      now: NOW,
    });
    expect(result.unreadCount).toBe(1);
    expect(result.mutedCount).toBe(1);
    const statuses = result.items.map((it) => it.status);
    expect(statuses).toEqual(["read", "muted", "unread"]);
  });

  it("静音已过期 → 视为 read（不计入 mutedCount）", () => {
    const a1 = makeAnnouncement({ id: "a1", publishedAt: NOW - 60_000 });
    const reads = [
      makeRead({ announcementId: "a1", mutedUntilTs: NOW - 1 }), // 静音已过期
    ];
    const result = buildList({
      announcements: [a1],
      reads,
      now: NOW,
    });
    expect(result.items[0].status).toBe("read");
    expect(result.mutedCount).toBe(0);
    expect(result.unreadCount).toBe(0);
  });

  it("空窗期（>7 天未读）→ aggregation 非 null", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const a1 = makeAnnouncement({ id: "a1", publishedAt: NOW - 30 * dayMs, title: "旧公告 1" });
    const a2 = makeAnnouncement({ id: "a2", publishedAt: NOW - 20 * dayMs, title: "旧公告 2" });
    const a3 = makeAnnouncement({ id: "a3", publishedAt: NOW - 1 * dayMs, title: "近期公告" });
    const result = buildList({
      announcements: [a1, a2, a3],
      reads: [],
      now: NOW,
    });
    expect(result.aggregation).not.toBeNull();
    // 空窗期（>7 天前）的公告只有 a1 和 a2
    expect(result.aggregation!.count).toBe(2);
    expect(result.aggregation!.previewTitles).toEqual(["旧公告 1", "旧公告 2"]);
  });

  it("全部公告在 7 天内 → aggregation=null", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const a1 = makeAnnouncement({ id: "a1", publishedAt: NOW - 1 * dayMs });
    const a2 = makeAnnouncement({ id: "a2", publishedAt: NOW - 3 * dayMs });
    const result = buildList({
      announcements: [a1, a2],
      reads: [],
      now: NOW,
    });
    expect(result.aggregation).toBeNull();
  });
});

describe("hub.planMute", () => {
  it("count=0 → 返回空 ids", () => {
    const plan = planMute([], 0, NOW);
    expect(plan.ids).toEqual([]);
    expect(plan.mutedUntilTs).toBe(NOW + MUTE_DEFAULT_DURATION_MS);
  });

  it("只静音未读公告（已读/已静音跳过）", () => {
    const a1 = makeAnnouncement({ id: "a1", publishedAt: NOW - 3 * 60_000 });
    const a2 = makeAnnouncement({ id: "a2", publishedAt: NOW - 2 * 60_000 });
    const a3 = makeAnnouncement({ id: "a3", publishedAt: NOW - 1 * 60_000 });
    const reads = [
      makeRead({ announcementId: "a3", readAt: NOW }),
      makeRead({ announcementId: "a2", mutedUntilTs: NOW + 1000 }),
    ];
    const listResult = buildList({
      announcements: [a1, a2, a3],
      reads,
      now: NOW,
    });
    // 只剩 a1 是未读
    const plan = planMute(listResult.items, 5, NOW);
    expect(plan.ids).toEqual(["a1"]);
  });

  it("count 大于未读条数 → 返回全部未读（不报错）", () => {
    const a1 = makeAnnouncement({ id: "a1", publishedAt: NOW - 3 * 60_000 });
    const a2 = makeAnnouncement({ id: "a2", publishedAt: NOW - 1 * 60_000 });
    const listResult = buildList({
      announcements: [a1, a2],
      reads: [],
      now: NOW,
    });
    const plan = planMute(listResult.items, 100, NOW);
    expect(plan.ids).toEqual(["a1", "a2"]); // 按倒序：a1 更早，a2 更新
  });

  it("muteDurationMs 自定义生效", () => {
    const a1 = makeAnnouncement({ id: "a1" });
    const listResult = buildList({
      announcements: [a1],
      reads: [],
      now: NOW,
    });
    const customDuration = 60 * 60 * 1000; // 1 小时
    const plan = planMute(listResult.items, 1, NOW, customDuration);
    expect(plan.mutedUntilTs).toBe(NOW + customDuration);
  });
});

describe("backfill.buildAggregation", () => {
  it("全部近期 → null", () => {
    const a1 = makeAnnouncement({ id: "a1", publishedAt: NOW - 1000 });
    expect(
      buildAggregation({
        items: [{ announcement: a1, status: "unread", readAt: null, mutedUntilTs: null }],
        now: NOW,
      })
    ).toBeNull();
  });

  it("空窗未读 1 条 → 仍产生聚合（保持语义一致）", () => {
    const a1 = makeAnnouncement({ id: "a1", publishedAt: NOW - 10 * 24 * 60 * 60 * 1000 });
    const items = [
      { announcement: a1, status: "unread" as const, readAt: null, mutedUntilTs: null },
    ];
    const agg = buildAggregation({ items, now: NOW });
    expect(agg).not.toBeNull();
    expect(agg!.count).toBe(1);
    expect(agg!.spanDays).toBeGreaterThanOrEqual(1);
  });

  it("已读空窗公告不参与聚合", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const a1 = makeAnnouncement({ id: "a1", publishedAt: NOW - 30 * dayMs });
    const a2 = makeAnnouncement({ id: "a2", publishedAt: NOW - 1 * dayMs });
    const items = [
      { announcement: a1, status: "read" as const, readAt: NOW - dayMs, mutedUntilTs: null },
      { announcement: a2, status: "unread" as const, readAt: null, mutedUntilTs: null },
    ];
    const agg = buildAggregation({ items, now: NOW });
    expect(agg).toBeNull(); // a1 已读、a2 在 7 天内，都不参与
  });

  it("自定义 thresholdMs 生效", () => {
    const a1 = makeAnnouncement({ id: "a1", publishedAt: NOW - 5 * 60 * 60 * 1000 }); // 5 小时前
    const items = [
      { announcement: a1, status: "unread" as const, readAt: null, mutedUntilTs: null },
    ];
    // 用 3 小时的 threshold → a1 被聚合
    const agg = buildAggregation({ items, thresholdMs: 3 * 60 * 60 * 1000, now: NOW });
    expect(agg).not.toBeNull();
    expect(agg!.count).toBe(1);
  });

  it("默认 now=Date.now() 可正常运行（不断言具体值）", () => {
    // 5 分钟前发布的公告不应被视为空窗（默认阈值 7 天）
    const a1 = makeAnnouncement({ id: "a1", publishedAt: Date.now() - 5 * 60 * 1000 });
    const items = [
      { announcement: a1, status: "unread" as const, readAt: null, mutedUntilTs: null },
    ];
    const agg = buildAggregation({ items });
    expect(agg).toBeNull();
  });
});
