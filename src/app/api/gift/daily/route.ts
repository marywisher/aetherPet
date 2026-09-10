/**
 * 文件名称：route.ts
 * 功能描述：POST /api/gift/daily — 手动领取每日奖励（/api/sync 内也会自动触发）
 * 所属模块：app/api/gift/daily
 * 验收对齐：
 *   - docs/requirements.md §3.7 每日馈赠（首次登录奖励物品；日限一次）
 *   - docs/dev-stage-plan.md §3 阶段 4 每日馈赠模块
 *
 * 说明：
 *   - 一般由 /api/sync 自动触发（用户当天首次登录）
 *   - 本路由作为手动兜底：若 sync 未自动触发（例如刚部署、数据异常），用户可主动点击"领取"
 *   - 文案禁止「打卡/签到」（需求 §3.7）
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { findByUserId } from "@/domain/persistence/repos/pets.repo";
import { grantDailyItem } from "@/domain/gift/daily-grant";

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error === "not_logged_in" ? "未登录" : "登录已过期" },
      { status: 401 }
    );
  }

  const pets = await findByUserId(auth.userId);
  if (pets.length === 0) {
    return NextResponse.json({ error: "还没有 pet" }, { status: 404 });
  }
  const pet = pets[0];

  try {
    const result = await grantDailyItem({ pet });
    if (!result.granted) {
      // already_granted_today 不算错误，返回 200 携带 skipReason
      if (result.skipReason === "already_granted_today") {
        return NextResponse.json({
          ok: true,
          granted: false,
          skipReason: "already_granted_today",
          todayStr: result.todayStr,
        });
      }
      // P2-003 修复：empty_pool 是需求中的"空池兜底文案"场景，
      // 与真正内部错误区分：本处返回 200 + fallbackMessage，用户可看到兜底内容；
      // 真正意外错误才 500。
      if (result.skipReason === "empty_pool") {
        return NextResponse.json({
          ok: true,
          granted: false,
          skipReason: "empty_pool",
          fallbackMessage: result.fallbackMessage ?? "今天没有新的小礼物，但小圆还是小圆。",
          todayStr: result.todayStr,
        });
      }
      return NextResponse.json(
        {
          ok: false,
          skipReason: result.skipReason,
          message: result.fallbackMessage ?? "暂时无法领取",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      granted: true,
      itemId: result.itemId,
      itemDisplayName: result.itemDisplayName,
      inventory: result.inventory,
      event: result.event,
      todayStr: result.todayStr,
      excludedItemIds: result.excludedItemIds,
      fellBackToUnrestricted: result.fellBackToUnrestricted,
    });
  } catch (err) {
    console.error("[gift/daily] failed:", err);
    return NextResponse.json(
      { ok: false, error: "服务器内部错误" },
      { status: 500 }
    );
  }
}
