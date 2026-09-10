/**
 * 文件名称：token.ts
 * 功能描述：30 天 token 签发/校验/撤销
 * 所属模块：domain/auth
 * 说明：
 *   - token 明文返回给前端（浏览器存在 cookie 或 localStorage）
 *   - 数据库只存 SHA256(token)
 *   - 30 天有效，退出登录写 revoked_at
 */

import type { PoolConnection } from "mysql2/promise";
import { getEnv } from "@/config/env";
import { newId } from "../util/ulid";
import { sha256, generateToken } from "../util/crypto";
import * as sessionsRepo from "../persistence/repos/sessions.repo";

export interface IssuedToken {
  /** 明文 token（返回给前端） */
  token: string;
  /** 会话 id */
  sessionId: string;
  userId: string;
  expiresAt: number;
}

/** 签发 token。可选 conn：传则写会话到当前事务（verifyCode 使用） */
export async function issueToken(opts: {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  hubId?: string;
  conn?: PoolConnection;
}): Promise<IssuedToken> {
  const env = getEnv();
  const token = generateToken();
  const now = Date.now();
  const sessionId = newId();
  const expiresAt = now + env.TOKEN_TTL_MS;

  await sessionsRepo.insert(
    {
      id: sessionId,
      userId: opts.userId,
      tokenHash: sha256(token),
      issuedAt: now,
      expiresAt,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
      schemaVersion: "1.0.0",
      hubId: opts.hubId ?? "local",
    },
    opts.conn
  );

  return { token, sessionId, userId: opts.userId, expiresAt };
}

/** 校验 token，返回关联的 userId；无效返回 null */
export async function verifyToken(token: string): Promise<{ userId: string; sessionId: string } | null> {
  if (!token || token.length < 32) return null;
  const hash = sha256(token);
  const session = await sessionsRepo.findByTokenHash(hash);
  if (!session) return null;
  // 更新 last_seen
  await sessionsRepo.touch(hash);
  return { userId: session.userId, sessionId: session.id };
}

/** 撤销 token */
export async function revokeToken(token: string): Promise<void> {
  if (!token) return;
  const hash = sha256(token);
  await sessionsRepo.revoke(hash);
}

/** 校验工具函数（不查库，仅长度 + 格式） */
export function isTokenShapeValid(token: string): boolean {
  return typeof token === "string" && token.length === 64 && /^[0-9a-f]+$/.test(token);
}

export { sha256 };
export const TOKEN_LENGTH = 64;
