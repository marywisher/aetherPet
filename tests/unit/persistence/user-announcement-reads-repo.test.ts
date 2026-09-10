/**
 * 文件名称：user-announcement-reads-repo.test.ts
 * 功能描述：user_announcement_reads.repo 单测（阶段 5）
 * 所属模块：tests/unit/persistence
 * 覆盖：
 *   - markReadInTx：INSERT IGNORE 参数、affectedRows 返回
 *   - muteInTx：ON DUPLICATE KEY UPDATE 参数
 *   - unmuteInTx：UPDATE SET muted_until_ts=NULL
 *   - findByUser：SELECT WHERE user_id=?
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnExecute = vi.fn();
const mockConnQuery = vi.fn();
const mockQuery = vi.fn();
const mockQueryOne = vi.fn();

vi.mock("@/domain/persistence/sql", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  execute: () => { throw new Error("should not be called"); },
  connQuery: (...args: unknown[]) => mockConnQuery(...args),
  connQueryOne: (...args: unknown[]) => mockConnQueryOne(...args),
  connExecute: (...args: unknown[]) => mockConnExecute(...args),
}));

vi.mock("@/domain/persistence/db", () => ({
  getPool: () => ({}),
}));

const mockConnQueryOne = vi.fn();

import * as repo from "@/domain/persistence/repos/user-announcement-reads.repo";

beforeEach(() => {
  mockConnExecute.mockReset();
  mockConnQuery.mockReset();
  mockQuery.mockReset();
  mockQueryOne.mockReset();
  mockConnQueryOne.mockReset();
});

const fakeConn = {} as any;

describe("user-announcement-reads.repo.markReadInTx", () => {
  it("调用 connExecute 一次，SQL 含 INSERT IGNORE", async () => {
    mockConnExecute.mockResolvedValue({ affectedRows: 1 });
    const affected = await repo.markReadInTx(
      fakeConn,
      "user-1",
      "ann-1",
      1_700_000_000_000
    );
    expect(affected).toBe(1);
    expect(mockConnExecute).toHaveBeenCalledTimes(1);
    const [, sqlText, params] = mockConnExecute.mock.calls[0];
    expect(sqlText).toContain("INSERT IGNORE");
    expect(sqlText).toContain("user_announcement_reads");
    expect(params).toEqual(["user-1", "ann-1", 1_700_000_000_000, "1.0.0", "local"]);
  });

  it("affectedRows=0（已存在）→ 返回 0，不抛错（幂等）", async () => {
    mockConnExecute.mockResolvedValue({ affectedRows: 0 });
    const affected = await repo.markReadInTx(
      fakeConn,
      "user-1",
      "ann-1",
      1_700_000_000_000
    );
    expect(affected).toBe(0);
  });
});

describe("user-announcement-reads.repo.muteInTx", () => {
  it("SQL 含 ON DUPLICATE KEY UPDATE", async () => {
    mockConnExecute.mockResolvedValue({ affectedRows: 1 });
    await repo.muteInTx(
      fakeConn,
      "user-1",
      "ann-1",
      1_700_000_000_000,
      1_710_000_000_000
    );
    const [, sqlText, params] = mockConnExecute.mock.calls[0];
    expect(sqlText).toContain("ON DUPLICATE KEY UPDATE");
    expect(params).toEqual([
      "user-1",
      "ann-1",
      1_700_000_000_000,
      1_710_000_000_000,
      "1.0.0",
      "local",
    ]);
  });
});

describe("user-announcement-reads.repo.unmuteInTx", () => {
  it("SQL UPDATE SET muted_until_ts = NULL", async () => {
    mockConnExecute.mockResolvedValue({ affectedRows: 1 });
    const affected = await repo.unmuteInTx(fakeConn, "user-1", "ann-1");
    expect(affected).toBe(1);
    const [, sqlText, params] = mockConnExecute.mock.calls[0];
    expect(sqlText).toContain("muted_until_ts = NULL");
    expect(params).toEqual(["user-1", "ann-1"]);
  });
});

describe("user-announcement-reads.repo.findByUser", () => {
  it("查询带 user_id 与 limit，返回映射后的对象", async () => {
    mockQuery.mockResolvedValue([
      {
        user_id: "user-1",
        announcement_id: "ann-1",
        read_at: 100,
        muted_until_ts: null,
        schema_version: "1.0.0",
        hub_id: "local",
      },
      {
        user_id: "user-1",
        announcement_id: "ann-2",
        read_at: 200,
        muted_until_ts: 500,
        schema_version: "1.0.0",
        hub_id: "local",
      },
    ]);
    const result = await repo.findByUser("user-1");
    expect(result).toHaveLength(2);
    expect(result[0].readAt).toBe(100);
    expect(result[1].mutedUntilTs).toBe(500);
    expect(result[1].userId).toBe("user-1");
  });
});

describe("user-announcement-reads.repo.findByUserAndAnnouncement", () => {
  it("命中 → 返回对象", async () => {
    mockQueryOne.mockResolvedValue({
      user_id: "user-1",
      announcement_id: "ann-1",
      read_at: 100,
      muted_until_ts: null,
      schema_version: "1.0.0",
      hub_id: "local",
    });
    const result = await repo.findByUserAndAnnouncement("user-1", "ann-1");
    expect(result).not.toBeNull();
    expect(result!.announcementId).toBe("ann-1");
  });

  it("未命中 → null", async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await repo.findByUserAndAnnouncement("u", "a")).toBeNull();
  });
});
