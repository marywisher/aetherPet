/**
 * 文件名称：route.ts
 * 功能描述：GET /api/letters — 回信列表（reply_letter + spontaneous_letter）
 * 所属模块：app/api/letters
 * 验收对齐：
 *   - docs/dev-stage-plan.md §3 阶段 4 UI（回信展示，信纸背景）
 *
 * 响应：
 *   {
 *     ok: true,
 *     pet: { id, name },
 *     letters: [ { event, rendered } ],   // 按 ts 倒序
 *     pendingReply: { due: boolean, replyDueAt, lastReplyAt }
 *   }
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { findByUserId } from "@/domain/persistence/repos/pets.repo";
import {
  findByPetAndType,
} from "@/domain/persistence/repos/events.repo";
import { renderEvent, type TextSlotTemplate } from "@/domain/events/render";
import { loadPackByName } from "@/domain/packs/loader";
import { isReplyDue } from "@/domain/gift/reply";

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
      letters: [],
      pendingReply: null,
    });
  }
  const pet = pets[0];

  const now = Date.now();
  // 拉取两类信：reply_letter（馈赠回信）+ spontaneous_letter（自主冒信）
  const [replies, spontaneous] = await Promise.all([
    findByPetAndType(pet.id, "reply_letter", 50),
    findByPetAndType(pet.id, "spontaneous_letter", 50),
  ]);
  const allLetters = [...replies, ...spontaneous].sort((a, b) => b.ts - a.ts);

  const pack = await loadPackByName(pet.activePackName ?? "default");

  const letters = allLetters.map((e) => {
    const packText = pack?.texts[e.type] as TextSlotTemplate | undefined;
    return {
      event: e,
      rendered: renderEvent(e, packText ?? null, pet.name),
    };
  });

  // P1-004 修复：复用领域层 isReplyDue 判定，与 reply.ts::checkAndGenerateReply
  // 保持完全一致（包含 nextProactiveTs 退避检查）。
  // 旧实现仅检查 replyPending && replyDueAt <= now，在退避期会错误返回 due=true，
  // 导致 UI 展示"已写好回信"但 sync 后实际不生成，文案承诺与实际行为不一致。
  const dueCheck = isReplyDue(pet, now);

  const pendingReply = {
    due: dueCheck.due,
    replyPending: pet.replyPending,
    replyDueAt: pet.replyDueAt,
    lastReplyAt: pet.lastReplyAt,
    nextProactiveTs: pet.nextProactiveTs,
    // 暴露领域判定 reason（观测/调试用）
    skipReason: dueCheck.due ? undefined : dueCheck.reason,
  };

  return NextResponse.json({
    ok: true,
    pet: { id: pet.id, name: pet.name },
    letters,
    pendingReply,
  });
}
