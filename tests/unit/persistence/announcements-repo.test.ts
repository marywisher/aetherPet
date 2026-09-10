/**
 * 文件名称：announcements-repo.test.ts
 * 功能描述：announcements.repo 单测（阶段 5）
 * 所属模块：tests/unit/persistence
 * 说明：
 *   - 通过 vi.mock("../db") 和 "../sql" 避免真实连接
 *   - 覆盖：insert 参数正确、findById 命中/未命中、findPublishedSince 有/无 sinceTs
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks 必须在 import repo 前设置
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockExecute = vi.fn();
const mockConnQuery = vi.fn();
const mockConnQueryOne = vi.fn();
const mockConnExecute = vi.fn();

vi.mock("@/domain/persistence/sql", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  execute: (...args: unknown[]) => mockExecute(...args),
  connQuery: (...args: unknown[]) => mockConnQuery(...args),
  connQueryOne: (...args: unknown[]) => mockConnQueryOne(...args),
  connExecute: (...args: unknown[]) => mockConnExecute(...args),
}));

vi.mock("@/domain/persistence/db", () => ({
  getPool: () => ({}),
}));

// 现在可以 import 目标模块
import * as repo from "@/domain/persistence/repos/announcements.repo";

beforeEach(() => {
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockExecute.mockReset();
  mockConnQuery.mockReset();
  mockConnQueryOne.mockReset();
  mockConnExecute.mockReset();
});

describe("announcements.repo.insert", () => {
  it("调用 execute 一次，参数顺序正确", async () => {
    mockExecute.mockResolvedValue({ affectedRows: 1 });
    const input = {
      id: "ann-1",
      title: "公告标题",
      body: "公告正文",
      level: "important" as const,
      publishedAt: 1_746_600_000_000,
      authorHubId: "local",
      signature: null,
      expiresAt: null,
      schemaVersion: "1.0.0",
      hubId: "local",
    };
    await repo.insert(input);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const [, sqlText, params] = mockExecute.mock.calls[0];
    expect(sqlText).toContain("INSERT INTO announcements");
    expect(params).toEqual([
      "ann-1",
      "公告标题",
      "公告正文",
      "important",
      1_746_600_000_000,
      "local",
      null,
      null,
      "1.0.0",
      "local",
    ]);
  });

  it("支持 conn 参数（走 connExecute）", async () => {
    mockConnExecute.mockResolvedValue({ affectedRows: 1 });
    const fakeConn = {} as any;
    const input = {
      id: "ann-2",
      title: "T",
      body: "B",
      level: "info" as const,
      publishedAt: 0,
      authorHubId: "local",
      signature: null,
      expiresAt: null,
      schemaVersion: "1.0.0",
      hubId: "local",
    };
    await repo.insert(input, fakeConn);
    expect(mockConnExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("announcements.repo.findById", () => {
  it("命中 → 返回 Announcement", async () => {
    mockQueryOne.mockResolvedValue({
      id: "ann-1",
      title: "T",
      body: "B",
      level: "info",
      published_at: 123,
      author_hub_id: "local",
      signature: null,
      expires_at: null,
      schema_version: "1.0.0",
      hub_id: "local",
    });
    const result = await repo.findById("ann-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("ann-1");
    expect(result!.publishedAt).toBe(123);
  });

  it("未命中 → null", async () => {
    mockQueryOne.mockResolvedValue(null);
    const result = await repo.findById("missing");
    expect(result).toBeNull();
  });
});

describe("announcements.repo.findPublishedSince", () => {
  it("sinceTs=null → SQL 不含 WHERE published_at，只有 LIMIT", async () => {
    mockQuery.mockResolvedValue([]);
    await repo.findPublishedSince(null, 20);
    const [, sqlText, params] = mockQuery.mock.calls[0];
    expect(sqlText).not.toContain("WHERE");
    expect(sqlText).toContain("ORDER BY published_at DESC");
    expect(params).toEqual([20]);
  });

  it("sinceTs 数字 → SQL 含 WHERE published_at >= ?", async () => {
    mockQuery.mockResolvedValue([]);
    await repo.findPublishedSince(1_700_000_000_000, 20);
    const [, sqlText, params] = mockQuery.mock.calls[0];
    expect(sqlText).toContain("WHERE published_at >= ?");
    expect(params).toEqual([1_700_000_000_000, 20]);
  });

  it("行数据正确映射到 Announcement", async () => {
    mockQuery.mockResolvedValue([
      {
        id: "ann-1",
        title: "T1",
        body: "B1",
        level: "critical",
        published_at: 200,
        author_hub_id: "local",
        signature: null,
        expires_at: null,
        schema_version: "1.0.0",
        hub_id: "local",
      },
      {
        id: "ann-2",
        title: "T2",
        body: "B2",
        level: "info",
        published_at: 100,
        author_hub_id: "local",
        signature: null,
        expires_at: null,
        schema_version: "1.0.0",
        hub_id: "local",
      },
    ]);
    const result = await repo.findPublishedSince(null);
    expect(result).toHaveLength(2);
    // 数据库层已经按 DESC 排序；repo 不做二次排序
    expect(result[0].id).toBe("ann-1");
    expect(result[0].level).toBe("critical");
    expect(result[1].publishedAt).toBe(100);
  });
});

describe("announcements.repo.findAll", () => {
  it("等同 findPublishedSince(null, limit)", async () => {
    mockQuery.mockResolvedValue([]);
    await repo.findAll(50);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, sqlText, params] = mockQuery.mock.calls[0];
    expect(sqlText).toContain("ORDER BY published_at DESC LIMIT ?");
    expect(params).toEqual([50]);
  });
});
