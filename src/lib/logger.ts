/**
 * 文件名称：logger.ts
 * 功能描述：按日轮转的文件日志器（server-only），以日为单位生成日志文件（logs/YYYY-MM-DD.log）
 * 所属模块：lib
 * 说明：
 *   - 通过环境变量配置：LOG_DIR（默认 logs/）、LOG_LEVEL（默认 info）、LOG_CONSOLE（默认 1=同时输出控制台）
 *   - 级别：debug < info < warn < error；低于配置级别的不记录
 *   - 时间戳：本地时区 ISO 格式带偏移（如 2026-09-11T15:39:09.065+08:00），文件与控制台一致
 *   - 日期切换：每次写入时检查日期，跨日自动切换文件句柄
 *   - 同步写 + try/catch：日志失败绝不影响业务逻辑
 *   - 用法：`import { log } from "@/lib/logger"` 或 `createLogger("模块名")` 得到命名空间实例
 */

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LOG_DIR = process.env.LOG_DIR ?? "logs";
const LOG_LEVEL: LogLevel =
  process.env.LOG_LEVEL === "debug" || process.env.LOG_LEVEL === "warn" || process.env.LOG_LEVEL === "error"
    ? process.env.LOG_LEVEL
    : "info";
const LOG_CONSOLE = (process.env.LOG_CONSOLE ?? "1") !== "0";

/** 当前日志文件对应的日期（YYYY-MM-DD） */
let _currentDay = todayStr();
let _filePath = path.join(LOG_DIR, `${_currentDay}.log`);

function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 检查是否跨日，跨日则切换目标文件 */
function ensureCurrentFile(d: Date = new Date()): string {
  const day = todayStr(d);
  if (day !== _currentDay) {
    _currentDay = day;
    _filePath = path.join(LOG_DIR, `${day}.log`);
  }
  return _filePath;
}

/** 本地时区 ISO 时间戳（含毫秒与时区偏移），如 2026-09-11T15:39:09.065+08:00 */
function localIso(d: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(offMin) / 60));
  const om = pad(Math.abs(offMin) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${oh}:${om}`
  );
}

function formatDetail(detail: unknown): string {
  if (detail === undefined || detail === null) return "";
  if (typeof detail === "string") return ` ${detail}`;
  try {
    return ` ${JSON.stringify(detail)}`;
  } catch {
    return ` ${String(detail)}`;
  }
}

function write(level: LogLevel, scope: string, message: string, detail?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[LOG_LEVEL]) return;

  const now = new Date();
  const ts = localIso(now);
  const lineText = `[${ts}] [${level.toUpperCase()}] [${scope}] ${message}${formatDetail(detail)}\n`;

  if (LOG_CONSOLE) {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[${ts}] [${level.toUpperCase()}] [${scope}] ${message}`, detail ?? "");
  }

  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(ensureCurrentFile(now), lineText, "utf8");
  } catch (err) {
    // 日志写失败绝不能影响业务：仅控制台提示
    console.error("[logger] write failed:", err);
  }
}

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

/** 创建带命名空间的日志实例；scope 建议使用模块名（如 "auth"、"packs"、"startup"） */
export function createLogger(scope: string): Logger {
  return {
    debug: (m, d) => write("debug", scope, m, d),
    info: (m, d) => write("info", scope, m, d),
    warn: (m, d) => write("warn", scope, m, d),
    error: (m, d) => write("error", scope, m, d),
  };
}

/** 全局默认实例（scope: app） */
export const log = createLogger("app");

/** 测试辅助：查看解析后的配置（用于断言环境变量生效） */
export const __debugConfig = (): { logDir: string; logLevel: LogLevel; logConsole: boolean } => ({
  logDir: LOG_DIR,
  logLevel: LOG_LEVEL,
  logConsole: LOG_CONSOLE,
});