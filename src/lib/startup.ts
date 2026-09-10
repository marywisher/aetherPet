/**
 * 文件名称：startup.ts
 * 功能描述：应用启动初始化（连接池、migration、hub 身份落库、过期数据清理）
 * 所属模块：lib
 * 说明：
 *   - 幂等：可重复调用
 *   - 首次 API 请求触发即可（Next.js 长驻进程）
 *   - P2-001：失败重试（默认 3 次，指数退避），仍失败则抛错给 instrumentation 记录
 *   - P2-002：对外暴露 startupReady Promise + getStartupState，供 healthz 消费
 *   - P2-006：启动时轻量清理过期验证码 / 过期 session
 *   - 失败不阻塞后续请求，但 healthz 会显式红
 *   - P2-007（Round 2）：失败后支持自愈探测——距上次失败 > RECOVERY_COOLDOWN_MS 时，
 *     healthz 触发一次轻量 startup() 重试（幂等），MySQL 恢复后无需重启进程即可恢复。
 */

import { initPool, closePool, getPool } from "@/domain/persistence/db";
import { ensureMigrations } from "@/domain/persistence/migrations/runner";
import { persistHubIdentityToMeta } from "@/domain/auth/hub-identity";
import { getEnv } from "@/config/env";
import { createLogger } from "@/lib/logger";

const slog = createLogger("startup");

let _started = false;
let _failed = false;
let _lastError: string | null = null;
let _starting: Promise<void> | null = null;
let _attempts = 0;
/** 上次 startup 失败的时间戳（用于冷却期判断） */
let _lastFailTs = 0;

/** 默认 30s 冷却期；冷却期外 healthz 才触发重试，避免频繁探测压垮恢复中的 MySQL */
const RECOVERY_COOLDOWN_MS = 30_000;

export interface StartupState {
  started: boolean;
  failed: boolean;
  lastError: string | null;
  attempts: number;
  /** 上次失败时间戳（ms）；用于 healthz 判断是否可自愈 */
  lastFailTs: number;
  /** 距下次可自愈探测的剩余 ms（冷却期内 > 0，冷却期外 0） */
  retryInMs: number;
}

export function getStartupState(): StartupState {
  const retryInMs = _failed && !_started
    ? Math.max(0, RECOVERY_COOLDOWN_MS - (Date.now() - _lastFailTs))
    : 0;
  return {
    started: _started,
    failed: _failed,
    lastError: _lastError,
    attempts: _attempts,
    lastFailTs: _lastFailTs,
    retryInMs,
  };
}

/** 对外暴露的启动就绪 Promise（healthz 可 await） */
export const startupReady: Promise<void> = startup();

/**
 * 启动重试（指数退避：300ms, 600ms, 1200ms）
 * 全部失败后不再重试；healthz 会暴露 _failed 状态
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const backoff = [300, 600, 1200];
  let lastErr: unknown;
  for (let i = 0; i <= backoff.length; i++) {
    _attempts += 1;
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < backoff.length) {
        await new Promise((r) => setTimeout(r, backoff[i]));
      }
    }
  }
  throw new Error(`[startup] ${label} 失败（已重试 ${backoff.length} 次）: ${String(lastErr)}`);
}

/** 过期数据轻量清理（P2-006） */
async function pruneExpiredData(): Promise<void> {
  const pool = getPool();
  const now = Date.now();
  const vcCutoff = now - 30 * 24 * 60 * 60 * 1000;
  const sRevokedCutoff = now - 30 * 24 * 60 * 60 * 1000;
  const sExpiredCutoff = now - 90 * 24 * 60 * 60 * 1000;

  try {
    await pool.query("DELETE FROM verification_codes WHERE expires_at < ?", [vcCutoff]);
    await pool.query(
      "DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR (expires_at < ? AND revoked_at IS NULL)",
      [sRevokedCutoff, sExpiredCutoff]
    );
    slog.info(`prune 完成 (vc<${new Date(vcCutoff).toISOString()}, sessions revoked<${new Date(sRevokedCutoff).toISOString()})`);
  } catch (err) {
    slog.warn("prune 失败（忽略）", err);
  }
}

export async function startup(): Promise<void> {
  if (_started) return;
  if (_starting) return _starting;
  _starting = (async () => {
    const env = getEnv();
    try {
      await withRetry("initPool", initPool);
      if (env.DB_AUTO_MIGRATE) {
        await withRetry("ensureMigrations", ensureMigrations);
      }
      await withRetry("persistHubIdentityToMeta", persistHubIdentityToMeta);
      await pruneExpiredData();
      _started = true;
      _failed = false;
      _lastError = null;
      slog.info("初始化完成");
    } catch (err) {
      _failed = true;
      _lastFailTs = Date.now();
      _lastError = err instanceof Error ? err.message : String(err);
      slog.error("初始化失败", err);
    } finally {
      _starting = null;
    }
  })();
  return _starting;
}

/**
 * P2-007：检查是否可触发自愈探测（冷却期外 + 上次失败过）。
 * 供 healthz 在启动失败后周期性调用。
 * 若返回 true，调用方应紧接着 await startup() 一次。
 */
export function shouldProbeRecovery(): boolean {
  if (_started) return false;
  if (!_failed) return false;
  if (Date.now() - _lastFailTs < RECOVERY_COOLDOWN_MS) return false;
  return true;
}

/** 测试用：重置 */
export async function _resetStartup(): Promise<void> {
  _started = false;
  _failed = false;
  _lastError = null;
  _attempts = 0;
  _lastFailTs = 0;
  await closePool();
}
