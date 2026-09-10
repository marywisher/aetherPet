/**
 * 文件名称：route.ts
 * 功能描述：POST /api/announcements/admin — 服务中心管理员发布公告（阶段 5）
 * 所属模块：app/api/announcements/admin
 * 验收对齐：
 *   - docs/current-stage.md 阶段 5 关键交付 2（POST /api/announcements/admin）
 *   - docs/requirements.md §3.8 公告（发布→同步可见）
 *   - docs/current-stage.md 关键约束 5：MVP 仅本地管理，无联邦广播
 * 说明：
 *   - 鉴权方式（择一）：
 *     A) 请求头 X-Admin-Token = env.HUB_ADMIN_TOKEN（推荐；解耦用户体系）
 *     B) Bearer token + 用户 email 与 HUB_ADMIN_EMAIL 匹配（回退；需登录）
 *   - 无联邦广播：signature 恒 null，author_hub_id = HUB_ID
 *   - 幂等：id 由 ULID 生成，天然唯一；同内容多次发布会产生多条（MVP 语义）
 *   - 输入校验：title 长度 ≤ 128；body 非空且 ≤ 2000；level 白名单
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { insert as insertAnnouncement } from "@/domain/persistence/repos/announcements.repo";
import { insertAuditLog } from "@/domain/persistence/repos/audit.repo";
import { newId } from "@/domain/util/ulid";
import { getEnv } from "@/config/env";
import { withTransaction } from "@/domain/persistence/db";
import { connQuery } from "@/domain/persistence/sql";
import { generateSystemAnnounce } from "@/domain/events/generators/announcement";
import { insert as insertEvent } from "@/domain/persistence/repos/events.repo";
import type { Pet } from "@/domain/types";

export const runtime = "nodejs";

const ALLOWED_LEVELS = ["info", "important", "critical"] as const;
const TITLE_MAX_LEN = 128;
const BODY_MAX_LEN = 2000;

interface AdminPostBody {
  title: string;
  body: string;
  level?: "info" | "important" | "critical";
  expiresAt?: number | null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const env = getEnv();

  // 鉴权：仅支持 X-Admin-Token 路径（运维需在 .env 配置 HUB_ADMIN_TOKEN）
  // 阶段 5 Round1 P1-001：原先的「登录用户 + HUB_ADMIN_EMAIL 匹配」回退路径
  // 因 magic-link 注册恒写 email_plain_enc=null 而永远 403，属误导性陷阱，已移除。
  // 中期（阶段 6）：新增独立 admin 角色表/字段。
  let adminUserId: string | null = null;
  const adminToken = req.headers.get("x-admin-token");
  if (adminToken && env.HUB_ADMIN_TOKEN && adminToken === env.HUB_ADMIN_TOKEN) {
    // X-Admin-Token 路径：无需登录用户；审计日志的 userId 记为 null
    adminUserId = null;
  } else if (env.HUB_ADMIN_TOKEN) {
    return NextResponse.json({ error: "X-Admin-Token 无效" }, { status: 401 });
  } else {
    return NextResponse.json(
      { error: "需配置 HUB_ADMIN_TOKEN 环境变量才能发布公告（自托管管理员）" },
      { status: 501 }
    );
  }

  // 2) 解析 body
  let body: AdminPostBody;
  try {
    body = (await req.json()) as AdminPostBody;
  } catch {
    return NextResponse.json({ error: "无效的 JSON 请求体" }, { status: 400 });
  }

  // 3) 校验
  const validation = validateBody(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  // 4) 写入 announcements + 阶段 6（P2-001）：为所有 pet 生成 system_announce 事件（同一事务，
  //    失败整体回滚）——让公告在时间线可见（“同步可见”广义闭环）。
  //    事件 params 只存 announcement_id（P2-003），文案渲染时反查 announcements 表。
  const now = Date.now();
  const announcementId = newId();
  let affectedPets = 0;
  try {
    affectedPets = await withTransaction(async (conn) => {
      await insertAnnouncement(
        {
          id: announcementId,
          title: body.title.trim(),
          body: body.body.trim(),
          level: body.level ?? "info",
          publishedAt: now,
          authorHubId: env.HUB_ID,
          signature: null, // MVP 无联邦广播
          expiresAt: body.expiresAt ?? null,
          schemaVersion: "1.0.0",
          hubId: env.HUB_ID,
        },
        conn
      );

      // 全量 pet 快照（MVP 规模；仅取生成器需要的字段）
      const petRows = await connQuery<{
        id: string;
        user_id: string;
        name: string;
        state: string;
        hub_id: string;
      }>(conn, "SELECT id, user_id, name, state, hub_id FROM pets", []);

      for (const row of petRows) {
        const petLike = {
          id: row.id,
          userId: row.user_id,
          name: row.name,
          state: row.state,
          hubId: row.hub_id,
        } as unknown as Pet;
        const { event } = generateSystemAnnounce({
          pet: petLike,
          announcementId,
          memories: [],
          ts: now,
          hubId: env.HUB_ID,
        });
        await insertEvent(event, conn);
      }
      return petRows.length;
    });
  } catch (err) {
    console.error(`[announcements/admin] insert failed（已回滚）:`, err);
    return NextResponse.json({ error: "公告发布失败" }, { status: 500 });
  }

  // 5) 审计日志（失败不阻断，仅记录）
  try {
    await insertAuditLog({
      userId: adminUserId,
      eventType: "announcement_published",
      detail: {
        announcement_id: announcementId,
        title: body.title,
        level: body.level ?? "info",
      },
      ip: extractIp(req),
      userAgent: req.headers.get("user-agent") ?? null,
      schemaVersion: "1.0.0",
      hubId: env.HUB_ID,
    });
  } catch (err) {
    console.warn("[announcements/admin] audit log failed:", err);
  }

  return NextResponse.json({
    ok: true,
    id: announcementId,
    publishedAt: now,
    affectedPets,
  });
}

function validateBody(body: AdminPostBody): { ok: true } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "请求体无效" };
  }
  if (typeof body.title !== "string" || body.title.trim().length === 0) {
    return { ok: false, error: "title 必填" };
  }
  if (body.title.length > TITLE_MAX_LEN) {
    return { ok: false, error: `title 长度超过 ${TITLE_MAX_LEN}` };
  }
  if (typeof body.body !== "string" || body.body.trim().length === 0) {
    return { ok: false, error: "body 必填" };
  }
  if (body.body.length > BODY_MAX_LEN) {
    return { ok: false, error: `body 长度超过 ${BODY_MAX_LEN}` };
  }
  if (body.level !== undefined && !ALLOWED_LEVELS.includes(body.level)) {
    return { ok: false, error: `level 必须是 ${ALLOWED_LEVELS.join("/")}` };
  }
  if (body.expiresAt !== undefined && body.expiresAt !== null) {
    if (typeof body.expiresAt !== "number" || !Number.isFinite(body.expiresAt)) {
      return { ok: false, error: "expiresAt 必须是合法时间戳" };
    }
  }
  return { ok: true };
}

function extractIp(req: NextRequest): string | null {
  const header = req.headers.get("x-forwarded-for");
  if (header) return header.split(",")[0].trim();
  return null;
}
