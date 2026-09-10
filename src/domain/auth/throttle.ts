/**
 * 文件名称：throttle.ts
 * 功能描述：验证码节流（同邮箱 + IP 双维度）
 * 所属模块：domain/auth
 * 说明：
 *   - 同 email_hash 5min 窗口内最多 3 次（requestCode 侧）
 *   - 同 IP 5min 窗口内最多 30 次（requestCode 侧）
 *   - /verify 端点独立 IP 桶（防 6 位验证码枚举）+ email 失败次数上限
 *   - IP 限流数据暂存内存（MVP 简化，未来可换 Redis）
 *   - P2-012（Round 2）：三个 Map 加入 LRU FIFO 淘汰上限（默认 5000 条目），
 *     防止攻击者用 IP 池/随机 email 无限增长 Map 造成 OOM。
 *   - 领域层纯 TS，可独立单测
 */

import { getEnv } from "@/config/env";

export interface ThrottleResult {
  allowed: boolean;
  reason?: "email_exceeded" | "ip_exceeded";
  /** 触发限流时的剩余时间（毫秒） */
  retryAfterMs?: number;
}

/**
 * 桶上限（P2-012）：超出后按 FIFO 淘汰最老的 key。
 * 5000 条目 × ~30B/条 ≈ 150KB，长期驻留可控。
 * 自托管单中心足够，官方中心若被大规模攻击可在接入 Redis 前临时调大此值。
 */
export const BUCKET_MAX_ENTRIES = 5_000;

/** IP 限流内存存储（requestCode）：key=ip, value=窗口内请求时间戳数组 */
const _ipBucket = new Map<string, number[]>();
/** /verify 端点独立 IP 节流桶（防 6 位验证码枚举） */
const _verifyIpBucket = new Map<string, number[]>();
/** /verify 端点 email 侧失败计数：key=email_hash, value=失败时间戳数组 */
const _verifyEmailFails = new Map<string, number[]>();

/**
 * 写入 Map 前的上限检查：若 Map 达到 BUCKET_MAX_ENTRIES，
 * 删除最老的 key（Map 迭代顺序即插入顺序）直到剩一半。
 * 淘汰后新 key 再插入。
 */
function _evictIfFull<K, V>(bucket: Map<K, V>): void {
  if (bucket.size < BUCKET_MAX_ENTRIES) return;
  // 迭代前半部分（Map 按插入顺序迭代，前面的是最老的）
  let i = 0;
  const half = Math.floor(BUCKET_MAX_ENTRIES / 2);
  for (const key of bucket.keys()) {
    bucket.delete(key);
    i += 1;
    if (i >= half) break;
  }
}

/**
 * 写入桶（带淘汰）。返回 true 表示成功写入，false 表示被淘汰。
 */
function _setWithEviction<K, V>(bucket: Map<K, V>, key: K, value: V): void {
  if (!bucket.has(key)) {
    _evictIfFull(bucket);
  }
  bucket.set(key, value);
}

/** 单测用：重置内存状态 */
export function _resetThrottleState(): void {
  _ipBucket.clear();
  _verifyIpBucket.clear();
  _verifyEmailFails.clear();
}

/** 测试用：暴露内部 Map 供断言（不鼓励业务代码调用） */
export function _getBucketSizes(): { ip: number; verifyIp: number; verifyEmailFails: number } {
  return {
    ip: _ipBucket.size,
    verifyIp: _verifyIpBucket.size,
    verifyEmailFails: _verifyEmailFails.size,
  };
}

/** 检查同邮箱节流 */
export async function checkEmailThrottle(
  emailHash: string,
  countFn: (emailHash: string, sinceTs: number) => Promise<number>
): Promise<ThrottleResult> {
  const env = getEnv();
  const since = Date.now() - env.VERIFICATION_WINDOW_MS;
  const count = await countFn(emailHash, since);
  if (count >= env.VERIFICATION_MAX_PER_WINDOW) {
    return {
      allowed: false,
      reason: "email_exceeded",
      retryAfterMs: env.VERIFICATION_WINDOW_MS,
    };
  }
  return { allowed: true };
}

/** 检查 IP 节流（requestCode 端点） */
export function checkIpThrottle(ip: string | null): ThrottleResult {
  const env = getEnv();
  return _checkIpBucket(ip, _ipBucket, env.IP_RATE_WINDOW_MS, env.IP_RATE_MAX_PER_WINDOW);
}

/** 检查 /verify 端点 IP 节流（独立桶，防 6 位码枚举） */
export function checkVerifyIpThrottle(ip: string | null): ThrottleResult {
  const env = getEnv();
  return _checkIpBucket(
    ip,
    _verifyIpBucket,
    env.VERIFY_IP_RATE_WINDOW_MS,
    env.VERIFY_IP_RATE_MAX_PER_WINDOW
  );
}

/** 通用 IP 桶检查 */
function _checkIpBucket(
  ip: string | null,
  bucket: Map<string, number[]>,
  windowMs: number,
  maxPerWindow: number
): ThrottleResult {
  if (!ip) return { allowed: true };
  const now = Date.now();
  const windowStart = now - windowMs;
  const timestamps = bucket.get(ip) ?? [];
  const active = timestamps.filter((t) => t >= windowStart);
  if (active.length >= maxPerWindow) {
    return {
      allowed: false,
      reason: "ip_exceeded",
      retryAfterMs: windowMs,
    };
  }
  active.push(now);
  _setWithEviction(bucket, ip, active);
  return { allowed: true };
}

/** 记录一次 /verify 失败（仅在校验失败后调用，不占用 IP 桶） */
export function recordVerifyFailure(
  emailHash: string,
  windowMs?: number
): { fails: number; blocked: boolean } {
  const env = getEnv();
  const since = windowMs ?? env.VERIFY_IP_RATE_WINDOW_MS;
  const now = Date.now();
  const windowStart = now - since;
  const fails = (_verifyEmailFails.get(emailHash) ?? []).filter((t) => t >= windowStart);
  fails.push(now);
  _setWithEviction(_verifyEmailFails, emailHash, fails);
  return { fails: fails.length, blocked: fails.length >= env.VERIFY_MAX_ATTEMPTS_PER_EMAIL };
}

/** 校验 /verify email 侧失败次数是否超限 */
export function checkVerifyEmailFailCount(
  emailHash: string,
  windowMs?: number
): { fails: number; blocked: boolean } {
  const env = getEnv();
  const since = windowMs ?? env.VERIFY_IP_RATE_WINDOW_MS;
  const now = Date.now();
  const windowStart = now - since;
  const fails = (_verifyEmailFails.get(emailHash) ?? []).filter((t) => t >= windowStart);
  return { fails: fails.length, blocked: fails.length >= env.VERIFY_MAX_ATTEMPTS_PER_EMAIL };
}

/** 组合节流检查（先 IP 后 email） */
export async function checkThrottle(
  ip: string | null,
  emailHash: string,
  countFn: (emailHash: string, sinceTs: number) => Promise<number>
): Promise<ThrottleResult> {
  const ipResult = checkIpThrottle(ip);
  if (!ipResult.allowed) return ipResult;
  return checkEmailThrottle(emailHash, countFn);
}
