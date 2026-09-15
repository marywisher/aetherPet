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
import { insertInTx as insertPetInTx, findByUserId } from "@/domain/persistence/repos/pets.repo";
import { insert as insertMemory } from "@/domain/persistence/repos/memories.repo";
import { insertMany } from "@/domain/persistence/repos/events.repo";
import { insertAuditLogInTx } from "@/domain/persistence/repos/audit.repo";
import { withTransaction } from "@/domain/persistence/db";
import { newId } from "@/domain/util/ulid";
import { getHubIdentity } from "@/domain/auth/hub-identity";
import { generateNextEvent, generateBatchEvents } from "@/domain/events";
import { extractClientIp, extractBearerToken, parseJsonBody } from "@/lib/request-helpers";
import { readTokenCookie } from "@/lib/brand";
import type { EventTypeValue, Pet } from "@/domain/types";

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
  const now = Date.now();

  // pre-launch：生成 1–2 条初始事件（在家类型池 + ts 倒推）
  const initialCount = 1 + Math.floor(Math.random() * 2);
  const INITIAL_TYPE_POOL: EventTypeValue[] = [
    "watching_water",
    "counting_leaves",
    "self_talk",
  ];
  // ts 倒推：创建前 6~48h 均匀分布（每个初始事件一个不同 ts）
  const backoffMs = 6 * 3600 * 1000 + Math.random() * (42 * 3600 * 1000); // 6~48h
  const earliestTs = now - backoffMs;
  const tsPerEvent: number[] = [];
  for (let i = 0; i < initialCount; i++) {
    const spacing = backoffMs / (initialCount + 1);
    tsPerEvent.push(Math.round(earliestTs + spacing * (i + 1)));
  }
  const initialEvents = generateBatchEvents(
    { id: petId, userId: session.userId, name: parsed.data.name, state: "at_home", stateSince: now } as Pet,
    [],
    initialCount,
    {
      hubId: hub.hubId,
      ts: now,
      typePool: INITIAL_TYPE_POOL,
      tsPerEvent,
    }
  );

  // 生成初见事件（ts = 创建时刻）
  const firstMeeting = generateNextEvent(
    { id: petId, userId: session.userId, name: parsed.data.name, state: "at_home", stateSince: now } as Pet,
    [],
    { forceType: "first_meeting", ts: now, hubId: hub.hubId }
  );

  // 合并：first_meeting 在最后（ts=now 最新），初始事件在前（倒推 ts 更早）
  const allEvents = [...initialEvents.events, firstMeeting.event];

  // 事件里若含 pet_name 的 memoryRefs，用 pet.name 合成
  for (const e of allEvents) {
    if (!e.memoryRefs.some((r) => r.kind === "pet_name")) {
      e.memoryRefs = [
        { kind: "pet_name", value: parsed.data.name, weight: 1.6, sourceEventId: undefined },
        ...e.memoryRefs,
      ];
    }
  }

  // 事务：写入 pet + 命名记忆 + 事件 + 审计
  // 失败整体 rollback，路由返回 500（重试 Create 不受 409 阻塞）
  try {
    await withTransaction(async (conn) => {
      await insertPetInTx(conn, {
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

      await insertMemory({
        id: newId(),
        petId,
        kind: "naming",
        value: parsed.data.name,
        lastReferenced: null,
        weight: 1.6,
        isPermanent: true,
        schemaVersion: "1.0.0",
        hubId: hub.hubId,
      }, conn);

      await insertMany(allEvents, conn);

      await insertAuditLogInTx(conn, {
        eventType: "pet_created",
        userId: session.userId,
        ip: extractClientIp(reqWithHeaders),
        detail: { petId, petName: parsed.data.name, initialEventCount: allEvents.length },
      });
    });
  } catch (err) {
    console.error("[create-pet] 事务失败：", err);
    return NextResponse.json({ error: "创建失败，请重试" }, { status: 500 });
  }

  // 事务成功后，返回 pet 信息与初始事件（不含细粒度的最后状态——
  // 初始事件全为 at_home 类型 + FSM no-op，state 保持 at_home）
  return NextResponse.json({
    ok: true,
    pet: { id: petId, name: parsed.data.name, state: "at_home" as const },
    initialEvents: allEvents,
  }, { status: 201 });
}
