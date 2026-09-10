/**
 * 文件名称：render-announce.test.ts
 * 功能描述：render-announce（system_announce 渲染辅助）单测
 * 所属模块：tests/unit/lib
 * 说明：覆盖公告占位符批量反查 + 事件副本注入；渲染主干由 timeline/sync API 集成测试覆盖
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindById = vi.fn();
vi.mock("@/domain/persistence/repos/announcements.repo", () => ({
  findById: (...a: unknown[]) => mockFindById(...a),
}));

import { buildAnnouncePlaceholderMap, withAnnouncePlaceholders } from "@/lib/render-announce";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("buildAnnouncePlaceholderMap", () => {
  it("只解析 system_announce 事件引用的公告", async () => {
    mockFindById.mockImplementation(async (id: string) =>
      id === "ann-1"
        ? { id: "ann-1", title: "迁移通知", body: "我们要搬家啦" }
        : null
    );
    const events = [
      { type: "system_announce", params: { announcement_id: "ann-1" } },
      { type: "self_talk", params: {} },
      { type: "system_announce", params: { announcement_id: "deleted-ann" } },
    ];
    const map = await buildAnnouncePlaceholderMap(events);
    expect(map.size).toBe(2);
    expect(map.get("ann-1")).toEqual({ announcement_title: "迁移通知", announcement_body: "我们要搬家啦" });
    // 已归档 → 降级占位文案（UI 不白屏）
    expect(map.get("deleted-ann")?.announcement_title).toContain("已归档");
    expect(mockFindById).toHaveBeenCalledTimes(2);
  });

  it("无 system_announce 事件 → 空 Map、不查库", async () => {
    const map = await buildAnnouncePlaceholderMap([{ type: "outing", params: {} }]);
    expect(map.size).toBe(0);
    expect(mockFindById).not.toHaveBeenCalled();
  });
});

describe("withAnnouncePlaceholders", () => {
  it("注入占位符到 params 副本，不修改原对象", () => {
    const e = { id: "e1", type: "system_announce", params: { announcement_id: "ann-1" } };
    const out = withAnnouncePlaceholders(e, {
      announcement_title: "T",
      announcement_body: "B",
    });
    expect(out.params).toEqual({ announcement_id: "ann-1", announcement_title: "T", announcement_body: "B" });
    expect(e.params).toEqual({ announcement_id: "ann-1" }); // 原对象未被污染
  });

  it("无占位符 → 原样返回", () => {
    const e = { type: "outing", params: { place: "溪边" } };
    expect(withAnnouncePlaceholders(e, undefined)).toBe(e);
  });
});