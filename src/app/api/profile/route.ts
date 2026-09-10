/**
 * 文件名称：route.ts
 * 功能描述：GET /api/profile — 档案页数据聚合（阶段 5）
 * 所属模块：app/api/profile
 * 验收对齐：
 *   - docs/requirements.md §3.6 档案页（当前状态、记忆片段、事件历史入口、储物罐）
 *   - docs/current-stage.md 阶段 5 关键交付 4（档案页）
 * 说明：
 *   - 单接口返回 pet + memories + storage + eventStats，前端一次加载
 *   - eventStats 由 events 表计数得出（MVP 数据量下可接受）
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { findByUserId } from "@/domain/persistence/repos/pets.repo";
import { findById as findUserById } from "@/domain/persistence/repos/users.repo";
import { findByPetId as findMemoriesByPetId } from "@/domain/persistence/repos/memories.repo";
import { findOfferedByPet } from "@/domain/persistence/repos/inventory.repo";
import { getPool } from "@/domain/persistence/db";
import { query } from "@/domain/persistence/sql";

export const runtime = "nodejs";

interface EventCountsRow {
  type: string;
  cnt: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // 1) 鉴权
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error === "not_logged_in" ? "未登录" : "登录已过期" },
      { status: 401 }
    );
  }

  // 2) 加载 pet + 账号元数据（阶段 6：申诉展示用）
  const [pets, user] = await Promise.all([
    findByUserId(auth.userId),
    findUserById(auth.userId),
  ]);
  if (pets.length === 0) {
    return NextResponse.json({
      ok: true,
      pet: null,
      emailHash: user?.emailHash ?? null,
      lastBackupHash: user?.lastBackupHash ?? null,
      createdAt: user?.createdAt ?? null,
    });
  }
  const pet = pets[0];

  // 3) 记忆片段（前 12 条，按创建倒序）
  const allMemories = await findMemoriesByPetId(pet.id);
  // 领域层排序：MVP 数据量小，直接 sort
  allMemories.sort((a, b) => b.createdAt - a.createdAt);
  const recentMemories = allMemories.slice(0, 12);

  // 4) 储物罐（inventory where offered_at IS NOT NULL）
  const storage = await findOfferedByPet(pet.id, 30);

  // 5) 事件计数（按 type 分组，供档案页摘要）
  const eventCountsByType: Record<string, number> = {};
  let totalEvents = 0;
  try {
    const rows = await query<EventCountsRow>(
      getPool(),
      "SELECT type, COUNT(*) AS cnt FROM events WHERE pet_id = ? GROUP BY type",
      [pet.id]
    );
    for (const r of rows) {
      eventCountsByType[r.type] = Number(r.cnt);
      totalEvents += Number(r.cnt);
    }
  } catch (err) {
    console.warn("[profile] event counts failed:", err);
  }

  return NextResponse.json({
    ok: true,
    // 阶段 6（验收 #11 申诉）：暴露账号级元数据（邮箱 hash / 最近备份 hash / 创建时间）
    emailHash: user?.emailHash ?? null,
    lastBackupHash: user?.lastBackupHash ?? null,
    createdAt: user?.createdAt ?? null,
    pet: {
      id: pet.id,
      name: pet.name,
      state: pet.state,
      stateSince: pet.stateSince,
      createdAt: pet.createdAt,
      activePackName: pet.activePackName,
      userLastActiveTs: pet.userLastActiveTs,
      lastActivityTs: pet.lastActivityTs,
    },
    memories: recentMemories,
    memoriesTotal: allMemories.length,
    storage,
    eventStats: {
      total: totalEvents,
      countsByType: eventCountsByType,
    },
  });
}
