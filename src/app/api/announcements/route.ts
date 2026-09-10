/**
 * 文件名称：route.ts
 * 功能描述：POST /api/announcements — 用户标记已读/静音 N 条（阶段 5）
 * 所属模块：app/api/announcements
 * 验收对齐：
 *   - docs/requirements.md §3.8 公告（已读/未读、静音 N 条）
 *   - docs/current-stage.md 阶段 5 关键交付 2（用户端 API）
 *   - docs/pitfalls.md 阶段 4 教训 2：DB 条件更新保证幂等（affectedRows）
 * 说明：
 *   - action="mark_read"：对指定 ids 逐条 markReadInTx（幂等，affectedRows=0 视为已读）
 *   - action="mute"：对最新未读 N 条设置 muted_until_ts=now+muteDurationMs
 *   - action="unmute"：解除指定 id 的静音
 *   - 幂等设计遵循阶段 4 P1-003 教训：全部 UPDATE/INSERT 走 DB 条件或 PRIMARY KEY 保证
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { withTransaction } from "@/domain/persistence/db";
import {
  markReadInTx,
  muteInTx,
  unmuteInTx,
} from "@/domain/persistence/repos/user-announcement-reads.repo";
import { findPublishedSince } from "@/domain/persistence/repos/announcements.repo";
import { findByUser as findReadsByUser } from "@/domain/persistence/repos/user-announcement-reads.repo";
import { buildList, planMute, MUTE_DEFAULT_DURATION_MS } from "@/domain/announce/hub";
import { getEnv } from "@/config/env";
import { insertAuditLog } from "@/domain/persistence/repos/audit.repo";

export const runtime = "nodejs";

interface PostBody {
  action: "mark_read" | "mute" | "unmute";
  /** 目标公告 id 列表（mark_read / unmute 用；mute 时用 count 计算，不用 ids） */
  ids?: string[];
  /** mute 用的条数 */
  count?: number;
  /** mute 时长（默认 7 天） */
  muteDurationMs?: number;
}

/** 校验公告 id 数组（防御脏数据/超长输入） */
function validateIds(ids: unknown): ids is string[] {
  return (
    Array.isArray(ids) &&
    ids.length <= 50 &&
    ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 32)
  );
}

/** 审计写入（失败仅 warn，不阻断业务——阶段 1 P3-004 语义） */
async function safeAudit(entry: Parameters<typeof insertAuditLog>[0]): Promise<void> {
  try {
    await insertAuditLog(entry);
  } catch (err) {
    console.warn("[announcements] audit write failed:", err);
  }
}

/**
 * GET /api/announcements — 拉取公告列表 + 已读/未读/静音状态 + 空窗聚合
 * 请求参数：?limit=（默认 50，最大 200）、?since=（增量起点，UTC ms）
 * 返回：{ ok, items, unreadCount, mutedCount, aggregation }
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error === "not_logged_in" ? "未登录" : "登录已过期" },
      { status: 401 }
    );
  }

  const sp = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? "50") || 50, 1), 200);
  const sinceRaw = sp.get("since");
  const sinceTs = sinceRaw ? Number(sinceRaw) : null;
  const now = Date.now();

  const announcements = await findPublishedSince(sinceTs, limit);
  const reads = await findReadsByUser(auth.userId, 500);
  const list = buildList({ announcements, reads, now });

  return NextResponse.json({ ok: true, ...list });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1) 鉴权
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error === "not_logged_in" ? "未登录" : "登录已过期" },
      { status: 401 }
    );
  }

  // 2) 解析 body
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "无效的 JSON 请求体" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !body.action) {
    return NextResponse.json({ error: "缺少 action 字段" }, { status: 400 });
  }

  const now = Date.now();
  const hubId = getEnv().HUB_ID;

  // 3) 分派 action
  switch (body.action) {
    case "mark_read": {
      return handleMarkRead(auth.userId, body.ids ?? [], now, hubId);
    }
    case "mute": {
      return handleMute(auth.userId, body.count ?? 0, body.muteDurationMs, now, hubId);
    }
    case "unmute": {
      return handleUnmute(auth.userId, body.ids ?? []);
    }
    default:
      return NextResponse.json(
        { error: `未知 action: ${String(body.action)}` },
        { status: 400 }
      );
  }
}

async function handleMarkRead(
  userId: string,
  ids: unknown,
  now: number,
  hubId: string
): Promise<NextResponse> {
  if (!validateIds(ids) || ids.length === 0) {
    return NextResponse.json({ ok: true, action: "mark_read", marked: 0 });
  }
  // 单次上限已由 validateIds 控制（≤50）
  const capped = ids.slice(0, 50);
  let marked = 0;
  try {
    await withTransaction(async (conn) => {
      for (const id of capped) {
        const affected = await markReadInTx(conn, userId, id, now, "1.0.0", hubId);
        // affectedRows=0 视为已读（幂等成功）；仅首次写入计入 marked
        marked += affected;
      }
    });
    await safeAudit({
      userId,
      eventType: "announcement_mark_read",
      detail: { announcement_ids: capped, count: marked },
      hubId,
    });
  } catch (err) {
    console.error(`[announcements] mark_read failed user=${userId}:`, err);
    return NextResponse.json({ error: "操作失败，请稍后再试" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, action: "mark_read", marked });
}

async function handleMute(
  userId: string,
  count: number,
  muteDurationMs: number | undefined,
  now: number,
  hubId: string
): Promise<NextResponse> {
  if (count <= 0 || !Number.isFinite(count)) {
    return NextResponse.json({ ok: true, action: "mute", muted: 0 });
  }
  const capped = Math.min(Math.floor(count), 50);
  const duration = muteDurationMs ?? MUTE_DEFAULT_DURATION_MS;

  // 1) 拉取列表 + 已读，构建状态
  const announcements = await findPublishedSince(null, 100);
  const reads = await findReadsByUser(userId, 500);
  const listResult = buildList({ announcements, reads, now });

  // 2) 计算要静音哪几条（从最新往旧、仅未读）
  const plan = planMute(listResult.items, capped, now, duration);

  // 3) 事务内逐条 muteInTx
  try {
    await withTransaction(async (conn) => {
      for (const id of plan.ids) {
        await muteInTx(conn, userId, id, now, plan.mutedUntilTs, "1.0.0", hubId);
      }
    });
    await safeAudit({
      userId,
      eventType: "announcement_muted",
      detail: { announcement_ids: plan.ids, count: plan.ids.length, muted_until_ts: plan.mutedUntilTs },
      hubId,
    });
  } catch (err) {
    console.error(`[announcements] mute failed user=${userId} count=${capped}:`, err);
    return NextResponse.json({ error: "操作失败，请稍后再试" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    action: "mute",
    muted: plan.ids.length,
    mutedUntilTs: plan.mutedUntilTs,
    skipped: capped - plan.ids.length, // 若未读条数少于 count，剩余记为 skipped
  });
}

async function handleUnmute(
  userId: string,
  ids: unknown
): Promise<NextResponse> {
  if (!validateIds(ids) || ids.length === 0) {
    return NextResponse.json({ ok: true, action: "unmute", unmuted: 0 });
  }
  const capped = ids.slice(0, 50);
  let unmuted = 0;
  try {
    await withTransaction(async (conn) => {
      for (const id of capped) {
        const affected = await unmuteInTx(conn, userId, id);
        // 只有 affectedRows=1 表示该行有静音状态被清除
        if (affected > 0) unmuted += 1;
      }
    });
    await safeAudit({
      userId,
      eventType: "announcement_unmuted",
      detail: { announcement_ids: capped, count: unmuted },
    });
  } catch (err) {
    console.error(`[announcements] unmute failed user=${userId}:`, err);
    return NextResponse.json({ error: "操作失败，请稍后再试" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, action: "unmute", unmuted });
}
