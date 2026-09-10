/**
 * 文件名称：db-config.test.ts
 * 功能描述：db.ts 连接池配置单测（P0-001, P0-002, P3-001c）
 * 所属模块：tests/unit/persistence
 * 验收对齐：docs/requirements.md §6 #10 数据库配置
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// 在 mock mysql2/promise 之前，避免真实连接
vi.mock("mysql2/promise", () => ({
  createPool: vi.fn(() => ({
    query: vi.fn(),
    execute: vi.fn(),
    getConnection: vi.fn(),
    end: vi.fn(),
  })),
  default: {
    createPool: vi.fn(() => ({
      query: vi.fn(),
      execute: vi.fn(),
      getConnection: vi.fn(),
      end: vi.fn(),
    })),
  },
}));

import mysql from "mysql2/promise";

describe("db.ts 连接池配置（P0/P3）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("P0-001：multipleStatements 必须为 true（多语句 DDL 迁移）", async () => {
    const { _resetPool } = await import("@/domain/persistence/db");
    _resetPool();
    const { getPool } = await import("@/domain/persistence/db");
    getPool();
    const createPoolMock = vi.mocked(mysql.createPool);
    expect(createPoolMock).toHaveBeenCalled();
    const options = createPoolMock.mock.calls[0][0] as any;
    expect(options.multipleStatements).toBe(true);
  });

  it("P0-002：数据库名来自 env.DB_NAME（不在 SQL 里 CREATE DATABASE）", async () => {
    const { _resetPool } = await import("@/domain/persistence/db");
    _resetPool();
    const { getPool } = await import("@/domain/persistence/db");
    getPool();
    const options = vi.mocked(mysql.createPool).mock.calls[0][0] as any;
    expect(options.database).toBeTruthy();
    // 001_init.sql 不应含 CREATE DATABASE / USE（防止与 DB_NAME 冲突）
    const fs = await import("fs/promises");
    const sqlPath = "src/domain/persistence/migrations/001_init.sql";
    const content = await fs.readFile(sqlPath, "utf-8");
    // 去除 -- 注释行后检查实际 SQL
    const sqlOnly = content
      .split("\n")
      .filter((line) => !/^\s*--/.test(line))
      .join("\n");
    expect(sqlOnly).not.toMatch(/CREATE\s+DATABASE/i);
    expect(sqlOnly).not.toMatch(/(^|\n)\s*USE\s+/i);
  });

  it("P3-001c：charset 为 utf8mb4（不是排序规则）", async () => {
    const { _resetPool } = await import("@/domain/persistence/db");
    _resetPool();
    const { getPool } = await import("@/domain/persistence/db");
    getPool();
    const options = vi.mocked(mysql.createPool).mock.calls[0][0] as any;
    expect(options.charset).toBe("utf8mb4");
    // 排序规则不应作为 charset 传入
    expect(options.charset).not.toMatch(/_ci$/);
  });
});
