/**
 * 文件名称：route.ts
 * 功能描述：GET /api/pet/timeline — 拉取 pet 事件时间线（含渲染文本）
 * 所属模块：app/api/pet
 * 验收对齐：docs/dev-stage-plan.md §3 阶段 2 演示步骤 2（首页显示 1-3 条初始事件）
 */

import { NextResponse } from "next/server";
import { verifyToken } from "@/domain/auth/token";
import { extractBearerToken } from "@/lib/request-helpers";
import { findByUserId } from "@/domain/persistence/repos/pets.repo";
import { findByPetId as findEvents } from "@/domain/persistence/repos/events.repo";
import { renderEvent, type TextSlotTemplate } from "@/domain/events/render";
import { loadPackByName } from "@/domain/packs/loader";

export async function GET(req: Request): Promise<NextResponse> {
  const reqWithHeaders = req as unknown as import("next/server").NextRequest;
  const cookies = req.headers.get("cookie") ?? "";
  const match = cookies.match(/(?:^|;\s*)aetherpet_token=([^;]+)/);
  const token = extractBearerToken(reqWithHeaders) ?? (match ? match[1] : null);

  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const session = await verifyToken(token);
  if (!session) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

  const pets = await findByUserId(session.userId);
  if (pets.length === 0) {
    return NextResponse.json({ ok: true, pet: null, events: [] });
  }

  const pet = pets[0];
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 100);

  const events = await findEvents(pet.id, limit);
  const pack = await loadPackByName(pet.activePackName ?? "default");

  const renderedEvents = events.map((e) => {
    const packText = pack?.texts[e.type] as TextSlotTemplate | undefined;
    const rendered = renderEvent(e, packText ?? null, pet.name);
    return { event: e, rendered };
  });

  return NextResponse.json({ ok: true, pet, events: renderedEvents });
}
