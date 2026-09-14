/**
 * 文件名称：route.ts
 * 功能描述：GET /api/pet/timeline — 拉取 pet 事件时间线（含渲染文本 + 分页）
 * 所属模块：app/api/pet
 * 验收对齐：
 *   - docs/dev-stage-plan.md §3 阶段 2 演示步骤 2（首页显示 1-3 条初始事件）
 *   - docs/dev-stage-plan.md §3 阶段 3 时间线分页（每页 20 条）
 *   - docs/requirements.md §3.5 事件流（渐进披露 + 类型标签 + 记忆高亮）
 *
 * 查询参数（阶段 3 新增，全部可选，默认值向后兼容阶段 2 行为）：
 *   - `limit`  每页条数（默认 20，最大 100）
 *   - `offset` 偏移量（默认 0，最大 1000）
 *   - `page`   页码（1-based；与 limit 一起时优先于 offset）
 *   - `total`  是否返回总条数（默认 false；开启时多一次 COUNT 查询）
 *
 * 响应（阶段 3 扩展，向后兼容）：
 *   - `{ ok, pet, events: [{ event, rendered }], total?, hasMore?, latestAggregate? }`
 *   - `events` 结构与阶段 2 一致（前端不感知分页差异）
 *   - `latestAggregate`：最新的聚合摘要事件（供时间线页渐进披露入口卡片使用）
 */

import { NextResponse } from "next/server";
import { verifyToken } from "@/domain/auth/token";
import { extractBearerToken } from "@/lib/request-helpers";
import { readTokenCookie } from "@/lib/brand";
import { findByUserId } from "@/domain/persistence/repos/pets.repo";
import {
  findByPetId as findEvents,
  findLatestAggregate,
} from "@/domain/persistence/repos/events.repo";
import { renderEvent, type TextSlotTemplate } from "@/domain/events/render";
import { loadPackByName } from "@/domain/packs/loader";
import { getPool } from "@/domain/persistence/db";
import { queryOne } from "@/domain/persistence/sql";
import { buildAnnouncePlaceholderMap, withAnnouncePlaceholders } from "@/lib/render-announce";

export async function GET(req: Request): Promise<NextResponse> {
  // 1) 鉴权（Bearer + cookie 双模式，沿用项目惯例）
  const reqWithHeaders = req as unknown as import("next/server").NextRequest;
  const token = extractBearerToken(reqWithHeaders) ?? readTokenCookie(req.headers.get("cookie"));

  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const session = await verifyToken(token);
  if (!session) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

  // 2) 加载 pet
  const pets = await findByUserId(session.userId);
  if (pets.length === 0) {
    return NextResponse.json({
      ok: true,
      pet: null,
      events: [],
      total: 0,
      hasMore: false,
      latestAggregate: null,
    });
  }
  const pet = pets[0];

  // 3) 解析分页参数（stage 3 新增；默认值向后兼容阶段 2 行为）
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20), 100);
  const pageParam = url.searchParams.get("page");
  const offsetParam = url.searchParams.get("offset");
  let offset = 0;
  if (pageParam) {
    const page = Math.max(1, Math.floor(Number(pageParam) || 1));
    offset = (page - 1) * limit;
  } else if (offsetParam) {
    offset = Math.max(0, Math.floor(Number(offsetParam) || 0));
  }
  offset = Math.min(offset, 1000);
  const wantTotal = url.searchParams.get("total") === "1";

  // 4) 拉取本页事件
  const events = await findEvents(pet.id, limit, offset);
  const pack = await loadPackByName(pet.activePackName ?? "default");

  // 4.1) 阶段 6（P2-001）：system_announce 事件渲染前反查公告（params 只存 id）
  const announcePlaceholders = await buildAnnouncePlaceholderMap(events);

  const renderedEvents = events.map((e) => {
    const packText = pack?.texts[e.type] as TextSlotTemplate | undefined;
    const eForRender =
      e.type === "system_announce"
        ? withAnnouncePlaceholders(e, announcePlaceholders.get(String(e.params.announcement_id ?? "")))
        : e;
    const rendered = renderEvent(eForRender, packText ?? null, pet.name);
    return { event: e, rendered };
  });

  // 5) 总条数（可选；开启时多一次 COUNT 查询）
  let total: number | undefined;
  if (wantTotal) {
    const row = await queryOne<{ c: number | string }>(
      getPool(),
      "SELECT COUNT(*) AS c FROM events WHERE pet_id = ?",
      [pet.id]
    );
    total = row ? Number(row.c) : 0;
  }

  // 6) 最新聚合摘要（供渐进披露入口卡片使用；阶段 3 新增）
  const latestAggregateEvent = await findLatestAggregate(pet.id);
  let latestAggregate = null;
  if (latestAggregateEvent) {
    const packText = pack?.texts[latestAggregateEvent.type] as TextSlotTemplate | undefined;
    const aggForRender =
      latestAggregateEvent.type === "system_announce"
        ? withAnnouncePlaceholders(
            latestAggregateEvent,
            announcePlaceholders.get(String(latestAggregateEvent.params.announcement_id ?? ""))
          )
        : latestAggregateEvent;
    latestAggregate = {
      event: latestAggregateEvent,
      rendered: renderEvent(aggForRender, packText ?? null, pet.name),
    };
  }

  return NextResponse.json({
    ok: true,
    pet,
    events: renderedEvents,
    ...(total !== undefined ? { total, hasMore: offset + events.length < total } : {}),
    latestAggregate,
  });
}
