/**
 * 文件名称：route.ts
 * 功能描述：POST /api/pet/create — 创建 pet（含命名 UI + 初始记忆 + 初始事件）
 * 所属模块：app/api/pet
 * 验收对齐：
 *   - docs/requirements.md §6 #1 创建第一只 pet 并命名
 *   - docs/dev-stage-plan.md §3 阶段 2「首次登录时，引擎预生成 1–3 条初始事件」
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { verifyToken } from "@/domain/auth/token";
import { insert as insertPet, findByUserId, touchUserActivity, updateState as updatePetState } from "@/domain/persistence/repos/pets.repo";
import { insert as insertMemory } from "@/domain/persistence/repos/memories.repo";
import { insertMany } from "@/domain/persistence/repos/events.repo";
import { newId } from "@/domain/util/ulid";
import { insertAuditLog } from "@/domain/persistence/repos/audit.repo";
import { getHubIdentity } from "@/domain/auth/hub-identity";
import { generateBatchEvents } from "@/domain/events";
import { extractClientIp, extractBearerToken, parseJsonBody } from "@/lib/request-helpers";
import { readTokenCookie } from "@/lib/brand";

const BodySchema = z.object({
  name: z
    .string()
    .min(1, "名字不能为空")
    .max(32, "名字最长 32 字")
    .regex(
      /^[\p{L}\p{N}_\-· ]+$/u,
      "名字只能包含字母、数字、下划线、中点、连字符和空格"
    ),
});

// 首次登录预生成的初始事件条数采用运行时随机（1–3 条），
// 参见下方 initialCount = 1 + Math.floor(Math.random() * 3)（Round 2 P2-008 修复）。
// Round 2 P3-N001：删除了旧版固定常量 INITIAL_EVENT_COUNT = 2（已不再使用）。

export async function POST(req: Request): Promise<NextResponse> {
  const reqWithHeaders = req as unknown as import("next/server").NextRequest;
  const token = extractBearerToken(reqWithHeaders) ?? readTokenCookie(req.headers.get("cookie"));

  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const session = await verifyToken(token);
  if (!session) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

  const parsed = await parseJsonBody(reqWithHeaders, BodySchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const existingPets = await findByUserId(session.userId);
  if (existingPets.length > 0) {
    return NextResponse.json(
      { error: "该账号已拥有 pet（MVP 阶段每账号仅支持 1 只）", existing: existingPets[0].id },
      { status: 409 }
    );
  }

  const hub = await getHubIdentity();
  const petId = newId();

  const pet = await insertPet({
    id: petId,
    userId: session.userId,
    name: parsed.data.name,
    state: "at_home",
    nextProactiveTs: null,
    dailyGrantLastDate: null,
    offerLastDate: null,
    replyDueAt: null,
    lastReplyAt: null,
    walletRef: null,
    schemaVersion: "1.0.0",
    hubId: hub.hubId,
  });

  // 写入命名记忆（永久、高权重）——供后续事件引擎 recall 使用
  await insertMemory({
    id: newId(),
    petId: pet.id,
    kind: "naming",
    value: pet.name,
    lastReferenced: null,
    weight: 1.6,
    isPermanent: true,
    schemaVersion: "1.0.0",
    hubId: hub.hubId,
  });

  // 预生成 1-3 条初始事件（阶段 2 演示首屏不为空）
  // P2-008 修复：从固定的 2 条改为 1–3 条随机，与注释/契约演示步骤一致
  const initialCount = 1 + Math.floor(Math.random() * 3);
  const { events, finalState, finalStateSince } = generateBatchEvents(pet, [], initialCount, {
    hubId: hub.hubId,
    // 初始事件不需要引用记忆（memories 池只有刚写入的命名，还没查询回来）
  });
  // 事件里若含 pet_name 的 memoryRefs，用 pet.name 合成
  for (const e of events) {
    if (!e.memoryRefs.some((r) => r.kind === "pet_name")) {
      e.memoryRefs = [
        { kind: "pet_name", value: pet.name, weight: 1.6, sourceEventId: undefined },
        ...e.memoryRefs,
      ];
    }
  }
  await insertMany(events);

  // P1-001 修复：批量生成结束后把 pet.state 落库，
  // 避免初始事件触发 FSM 转换后状态只活在内存里（前端刷新即回滚）
  if (finalState !== pet.state) {
    await updatePetState(pet.id, finalState, finalStateSince);
  }

  await touchUserActivity(pet.id);

  await insertAuditLog({
    eventType: "pet_created",
    userId: session.userId,
    ip: extractClientIp(reqWithHeaders),
    detail: { petId: pet.id, petName: pet.name, initialEventCount: events.length },
  });

  return NextResponse.json({ ok: true, pet, initialEvents: events }, { status: 201 });
}
