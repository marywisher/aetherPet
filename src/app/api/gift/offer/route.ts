/**
 * 文件名称：route.ts
 * 功能描述：POST /api/gift/offer — 送赠（用户主动把物品放桌上给 pet）
 * 所属模块：app/api/gift/offer
 * 验收对齐：
 *   - docs/requirements.md §3.7 送赠（日限一次、错过不惩罚）
 *   - docs/architecture.md §4.3.2 每日馈赠闭环
 *
 * 请求体：
 *   { "inventoryId": "01HZ..." }
 *
 * 响应：
 *   成功 { ok: true, event, replyDueAt, inventory }
 *   失败 { ok: false, error, skipReason, message? }
 *
 * 契约：
 *   - 物品归用户所有，用户主动摆放（非系统自动）
 *   - 日限一次；同日重复送赠返回 already_offered_today
 *   - 事件结构不含文案（domain 层保证）
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request-helpers";
import { findByUserId } from "@/domain/persistence/repos/pets.repo";
import { offerInventoryItem } from "@/domain/gift/offer";

const BodySchema = z.object({
  inventoryId: z.string().min(1).max(64),
});

export async function POST(req: Request): Promise<NextResponse> {
  // 1) 鉴权
  const auth = await requireAuth(req);
  if (!auth.ok) {
    const status = auth.error === "not_logged_in" ? 401 : 401;
    const msg = auth.error === "not_logged_in" ? "未登录" : "登录已过期";
    return NextResponse.json({ error: msg }, { status });
  }
  const userId = auth.userId;

  // 2) 加载 pet
  const pets = await findByUserId(userId);
  if (pets.length === 0) {
    return NextResponse.json({ error: "还没有 pet" }, { status: 404 });
  }
  const pet = pets[0];

  // 3) 解析 body
  const reqWithHeaders = req as unknown as import("next/server").NextRequest;
  const parsed = await parseJsonBody<z.infer<typeof BodySchema>>(reqWithHeaders, BodySchema);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  // 4) 执行送赠（事务）
  try {
    const result = await offerInventoryItem({
      inventoryId: parsed.data.inventoryId,
      petId: pet.id,
      userId,
    });
    if (!result.offered) {
      // 日限一次不算错误，用 409 Conflict 返回，但携带用户可展示的信息
      const isAlreadyToday = result.skipReason === "already_offered_today";
      return NextResponse.json(
        {
          ok: false,
          skipReason: result.skipReason,
          message: result.message ?? "操作失败",
        },
        { status: isAlreadyToday ? 409 : 400 }
      );
    }
    return NextResponse.json({
      ok: true,
      event: result.event,
      replyDueAt: result.replyDueAt,
      inventory: result.inventory,
      todayStr: result.todayStr,
    });
  } catch (err) {
    console.error("[gift/offer] failed:", err);
    return NextResponse.json(
      { ok: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}
