/**
 * 文件名称：route.ts
 * 功能描述：POST /api/pet/generate-event — 手动触发生成事件（仅开发模式开放）
 * 所属模块：app/api/pet
 * 验收对齐：docs/dev-stage-plan.md §3 阶段 2 演示步骤 3（开发工具按钮）
 * 说明：
 *   - 生产模式默认禁止（P2-011 修复）：NODE_ENV=production 或未设置且非显式启用 → 403
 *   - 需要 Bearer token
 *   - Body 可选：{ type?: string } 强制指定类型
 *   - 返回：{ event, rendered, nextPet }
 *
 * 阶段 2 Round 2 修复：
 *   - P1-001: 事件入库后同步 updateState 落库 pet.state，避免 FSM 转换只活一次调用
 *   - P2-009: 删除动态 import，改为顶部静态导入
 *   - P2-011: 生产保护加白名单开关，NODE_ENV 未定义时默认拒绝
 */

import { NextResponse } from "next/server";
import { getEnv } from "@/config/env";
import { verifyToken } from "@/domain/auth/token";
import { extractBearerToken } from "@/lib/request-helpers";
import { getHubIdentity } from "@/domain/auth/hub-identity";
import {
  findByUserId,
  touchUserActivity,
  updateState as updatePetState,
} from "@/domain/persistence/repos/pets.repo";
import {
  findByPetId as findMemoriesByPetId,
  insert as insertMemory,
} from "@/domain/persistence/repos/memories.repo";
import { insert as insertEvent } from "@/domain/persistence/repos/events.repo";
import { newId } from "@/domain/util/ulid";
import { generateNextEvent } from "@/domain/events";
import { renderEvent, type TextSlotTemplate } from "@/domain/events/render";
import { loadPackByName } from "@/domain/packs/loader";

/**
 * P2-011 修复 + P2-013 补全：生产环境保护判定。
 *
 * 判定规则：
 *   - NODE_ENV === "production" 且 ENABLE_DEV_ENDPOINTS !== true → 拒绝
 *   - NODE_ENV === "production" 且 ENABLE_DEV_ENDPOINTS === true → 允许（白名单）
 *   - NODE_ENV !== "production"（development / test / 未设置） → 允许
 *
 * 白名单方式：在 `.env` 中显式设置 `ENABLE_DEV_ENDPOINTS=true`
 * 已在 `src/config/env.ts` zod schema 中注册为 boolean（Round 2 修复 P2-013，
 * 早期实现使用字符串比较 `=== "true"` 但因为未注册字段，白名单永远返回 false）。
 *
 * 类型说明：参数类型收窄为 `{ NODE_ENV?: string; ENABLE_DEV_ENDPOINTS?: boolean }`，
 * 与 getEnv() 返回的 Env 类型严格匹配（Env.ENABLE_DEV_ENDPOINTS 已由 zod `bool.default(false)` 推断为 boolean）。
 */
function isDevEndpointEnabled(env: { NODE_ENV?: string; ENABLE_DEV_ENDPOINTS?: boolean }): boolean {
  const isProd = env.NODE_ENV === "production";
  if (!isProd) return true;
  return env.ENABLE_DEV_ENDPOINTS === true;
}

type NextJson = (body: unknown, init?: ResponseInit) => NextResponse;

export async function POST(req: Request): Promise<NextResponse> {
  const env = getEnv();

  // P2-011：生产模式禁止（保守默认，需白名单显式开启）
  if (!isDevEndpointEnabled(env)) {
    return NextResponse.json(
      { error: "开发端点在生产模式禁用（需 ENABLE_DEV_ENDPOINTS=true 显式开启）" },
      { status: 403 }
    );
  }

  const reqWithHeaders = req as unknown as import("next/server").NextRequest;
  const token = extractBearerToken(reqWithHeaders);
  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const session = await verifyToken(token);
  if (!session) return NextResponse.json({ error: "登录已过期" }, { status: 401 });

  // 解析 body（可空）
  let forceType: string | undefined;
  try {
    const raw = await req.json();
    if (raw && typeof raw.type === "string") forceType = raw.type;
  } catch {
    // 忽略 body 解析失败
  }

  const pets = await findByUserId(session.userId);
  if (pets.length === 0) {
    return NextResponse.json({ error: "无 pet" }, { status: 404 });
  }
  const pet = pets[0];
  const memories = await findMemoriesByPetId(pet.id);

  // 若 pet_name memory 缺失（老账号未迁移），先补一条 naming 记忆
  const hasNaming = memories.some((m) => m.kind === "naming" && m.value === pet.name);
  if (!hasNaming) {
    const hub = await getHubIdentity();
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
  }

  const output = generateNextEvent(pet, memories, {
    forceType,
    hubId: pet.hubId,
  });

  // 持久化事件
  await insertEvent(output.event);

  // P1-001 修复：把 FSM 转换后的新状态落库，避免状态只活一次 HTTP 调用
  // 只有当状态实际变化时才写库（no_op / 非法动作跳过）
  if (output.nextState !== pet.state) {
    await updatePetState(pet.id, output.nextState, output.nextStateSince);
  }

  await touchUserActivity(pet.id);

  // 渲染文本
  const pack = await loadPackByName(pet.activePackName ?? "default");
  const packText = pack?.texts[output.event.type] as TextSlotTemplate | undefined;
  const rendered = renderEvent(output.event, packText ?? null, pet.name);

  return NextResponse.json({
    ok: true,
    event: output.event,
    rendered,
    nextPet: { state: output.nextState, stateSince: output.nextStateSince },
  });
}
