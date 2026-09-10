/**
 * 文件名称：route.ts
 * 功能描述：GET /api/inventory — 物品栏列表（含未送出 + 储物罐）
 * 所属模块：app/api/inventory
 * 验收对齐：
 *   - docs/dev-stage-plan.md §3 阶段 4 UI（物品栏 inventory）
 *
 * 响应：
 *   {
 *     ok: true,
 *     pet: { id, name },
 *     unoffered: Inventory[],     // 未送出（可送赠）
 *     storage:   Inventory[],     // 储物罐（已送）
 *     itemsCatalog: Item[]       // 物品图鉴（display_name 反查）
 *   }
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { findByUserId } from "@/domain/persistence/repos/pets.repo";
import {
  findUnofferedByUser,
  findOfferedByPet,
} from "@/domain/persistence/repos/inventory.repo";
import { findAll as findItemsAll } from "@/domain/persistence/repos/items.repo";
import { toLocalDateStr } from "@/domain/util/date";

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error === "not_logged_in" ? "未登录" : "登录已过期" },
      { status: 401 }
    );
  }

  const pets = await findByUserId(auth.userId);
  if (pets.length === 0) {
    return NextResponse.json({
      ok: true,
      pet: null,
      unoffered: [],
      storage: [],
      itemsCatalog: [],
    });
  }
  const pet = pets[0];

  const [unoffered, storage, itemsCatalog] = await Promise.all([
    findUnofferedByUser(auth.userId, pet.id),
    findOfferedByPet(pet.id),
    findItemsAll(),
  ]);

  // P3-003 修复：回传 pet.offerLastDate 与 offeredToday，使前端首次加载时
  // 就能正确禁用"今日已送"状态，避免首次点击才遭 409 + 提示。
  const todayStr = toLocalDateStr(Date.now());

  return NextResponse.json({
    ok: true,
    pet: { id: pet.id, name: pet.name },
    offerLastDate: pet.offerLastDate,
    offeredToday: pet.offerLastDate === todayStr,
    unoffered,
    storage,
    itemsCatalog,
  });
}
