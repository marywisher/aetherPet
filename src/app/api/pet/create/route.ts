/**
 * 文件名称：route.ts
 * 功能描述：POST /api/pet/create — 创建 pet（含命名 UI）
 * 所属模块：app/api/pet
 * 验收对齐：docs/requirements.md §6 #1 创建第一只 pet 并命名
 */

import { z } from "zod";
import { NextResponse } from "next/server";
import { verifyToken } from "@/domain/auth/token";
import { findById } from "@/domain/persistence/repos/users.repo";
import { insert, findByUserId, touchUserActivity } from "@/domain/persistence/repos/pets.repo";
import { newId } from "@/domain/util/ulid";
import { insertAuditLog } from "@/domain/persistence/repos/audit.repo";
import { getHubIdentity } from "@/domain/auth/hub-identity";
import { extractClientIp, extractBearerToken, parseJsonBody } from "@/lib/request-helpers";

const BodySchema = z.object({
  // P2-005：白名单字符集（Unicode 字母/数字 + 下划线 + 中点 + 连字符 + 空格）
  // 支持中文、日文、韩文、英文、数字，与前端 hint 保持一致
  name: z
    .string()
    .min(1, "名字不能为空")
    .max(32, "名字最长 32 字")
    .regex(
      /^[\p{L}\p{N}_\-· ]+$/u,
      "名字只能包含字母、数字、下划线、中点、连字符和空格"
    ),
});

export async function POST(req: Request): Promise<NextResponse> {
  const cookies = req.headers.get("cookie") ?? "";
  const match = cookies.match(/(?:^|;\s*)aetherpet_token=([^;]+)/);
  const token = extractBearerToken(req as unknown as import("next/server").NextRequest)
    ?? (match ? match[1] : null);

  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const session = await verifyToken(token);
  if (!session) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

  const parsed = await parseJsonBody(req as unknown as import("next/server").NextRequest, BodySchema);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // 检查是否已有 pet（MVP 每账号 1 pet）
  const existingPets = await findByUserId(session.userId);
  if (existingPets.length > 0) {
    return NextResponse.json(
      { error: "该账号已拥有 pet（MVP 阶段每账号仅支持 1 只）", existing: existingPets[0].id },
      { status: 409 }
    );
  }

  const hub = await getHubIdentity();
  const pet = await insert({
    id: newId(),
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

  await touchUserActivity(pet.id);

  await insertAuditLog({
    eventType: "pet_created",
    userId: session.userId,
    ip: extractClientIp(req as unknown as import("next/server").NextRequest),
    detail: { petId: pet.id, petName: pet.name },
  });

  return NextResponse.json({ ok: true, pet }, { status: 201 });
}
