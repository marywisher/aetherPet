/**
 * 文件名称：logger.test.ts
 * 功能描述：logger 模块单测（按日文件、级别过滤、LOG_DIR 覆盖、异常数据序列化）
 * 所属模块：lib
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** 隔离加载 logger（环境变量在模块加载期读取） */
async function loadLogger(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const mod = await import("@/lib/logger");
  return mod;
}

/** 释放环境污染 */
async function cleanupEnv(keys: (keyof NodeJS.ProcessEnv | string)[]) {
  for (const k of keys) delete process.env[k as string];
  vi.resetModules();
}

describe("logger · 按日文件写入", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "logger-test-"));
  });
  afterEach(async () => {
    rmSync(tmp, { recursive: true, force: true });
    await cleanupEnv(["LOG_DIR", "LOG_LEVEL", "LOG_CONSOLE"]);
  });

  it("写入产生 logs/YYYY-MM-DD.log 文件且内容带级别与 scope", async () => {
    const { createLogger } = await loadLogger({ LOG_DIR: tmp, LOG_CONSOLE: "0" });
    const logger = createLogger("auth");
    logger.info("验证码已发送", { email: "a@b.c", codeId: "ulid-1" });

    const files = readdirSync(tmp);
    expect(files).toHaveLength(1);
    const [fname] = files;
    expect(fname).toMatch(/^\d{4}-\d{2}-\d{2}\.log$/);

    const content = readFileSync(path.join(tmp, fname), "utf8");
    expect(content).toContain("[INFO]");
    expect(content).toContain("[auth]");
    expect(content).toContain("验证码已发送");
    // detail JSON 序列化并入
    expect(content).toContain('"email":"a@b.c"');
  });

  it("日期切换：同进程跨日时写入新文件（用假时钟）", async () => {
    const { createLogger } = await loadLogger({ LOG_DIR: tmp, LOG_CONSOLE: "0" });
    const logger = createLogger("packs");

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-09T10:00:00Z"));
      logger.info("day-1");
      vi.setSystemTime(new Date("2026-09-10T10:00:00Z"));
      logger.info("day-2");
    } finally {
      vi.useRealTimers();
    }

    const files = readdirSync(tmp).sort();
    expect(files).toEqual(["2026-09-09.log", "2026-09-10.log"]);
    const d1 = readFileSync(path.join(tmp, "2026-09-09.log"), "utf8");
    const d2 = readFileSync(path.join(tmp, "2026-09-10.log"), "utf8");
    expect(d1).toContain("day-1");
    expect(d1).not.toContain("day-2");
    expect(d2).toContain("day-2");
  });

  it("debug 级默认不写（默认级别 info），error 必写", async () => {
    const { createLogger } = await loadLogger({ LOG_DIR: tmp, LOG_CONSOLE: "0" });
    const logger = createLogger("app");
    logger.debug("hidden");
    logger.error("visible");

    const files = readdirSync(tmp);
    expect(files).toHaveLength(1);
    const content = readFileSync(path.join(tmp, files[0]), "utf8");
    expect(content).toContain("visible");
    expect(content).not.toContain("hidden");
  });

  it("LOG_LEVEL=debug 时 debug 级写入", async () => {
    const { createLogger } = await loadLogger({ LOG_DIR: tmp, LOG_LEVEL: "debug", LOG_CONSOLE: "0" });
    createLogger("t").debug("now-visible");
    const files = readdirSync(tmp);
    const content = readFileSync(path.join(tmp, files[0]), "utf8");
    expect(content).toContain("now-visible");
  });

  it("detail 为对象/异常时序列化不抛错", async () => {
    const { createLogger } = await loadLogger({ LOG_DIR: tmp, LOG_CONSOLE: "0" });
    const logger = createLogger("t");
    logger.error("boom", new Error("炸了"));
    logger.warn("circular", { a: 1 }); // 简单对象

    const files = readdirSync(tmp);
    const content = readFileSync(path.join(tmp, files[0]), "utf8");
    expect(content).toContain("boom");
    expect(content).toContain('"a":1');
  });

  it("LOG_DIR 未设置时使用默认 logs/ 目录（不炸）", async () => {
    const cwd = process.cwd();
    try {
      process.chdir(tmp);
      const { __debugConfig } = await loadLogger({ LOG_CONSOLE: "0" });
      expect(__debugConfig().logDir).toBe("logs");
    } finally {
      process.chdir(cwd);
    }
  });
});