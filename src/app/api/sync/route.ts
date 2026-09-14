/**
 * 文件名称：route.ts
 * 功能描述：GET /api/sync — 主同步入口（补算触发 + 退避计算 + 回信/馈赠检查占位）
 * 所属模块：app/api/sync
 * 验收对齐：
 *   - docs/requirements.md §3.4 补算（服务端下次同步请求时触发）
 *   - docs/requirements.md §3.5 事件流（渐进披露入口卡片所需数据）
 *   - docs/dev-stage-plan.md §3 阶段 3 同步 API
 *   - docs/architecture.md §4.3.1 补算时序、§9 R3 补算性能（打点日志 <500ms）
 *
 * 鉴权：Bearer token 或 cookie `${APP_BRAND_KEY}_token`（沿用项目双模式；cookie 名来自 .env）
 *
 * 本阶段（阶段 3）交付范围：
 *   - 补算触发：planCatchUp + executeCatchUp（事务内 INSERT + UPDATE pets）
 *   - 退避计算：computeBackoff → nextProactiveTs（可观测：本次同步返回该字段）
 *   - 回信检查：占位（阶段 4 gift/reply 完整实现）
 *   - 每日馈赠检查：占位（阶段 4 gift/daily-grant 完整实现）
 *
 * 约束：
 *   - 不处理 P2-006（MemoryRef.kind 语义扩展），不 bump 契约版本
 *   - 补算整体在一个事务内完成；失败整体 rollback，用户下次同步重试
 *   - 事件结构不含文案（解耦铁律）；补算生成的事件同样遵守
 */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { findByUserId, findById as findPetById, updateNextProactiveTs } from "@/domain/persistence/repos/pets.repo";
import {
  findByPetId as findEventsByPetId,
  findLatestAggregate,
} from "@/domain/persistence/repos/events.repo";
import { planCatchUp } from "@/domain/catchup/planner";
import { executeCatchUp } from "@/domain/catchup/executor";
import { computeBackoff } from "@/domain/backoff/scheduler";
import { grantDailyItem } from "@/domain/gift/daily-grant";
import { checkAndGenerateReply } from "@/domain/gift/reply";
import { renderEvent, type TextSlotTemplate } from "@/domain/events/render";
import { loadPackByName } from "@/domain/packs/loader";
import { buildAnnouncePlaceholderMap, withAnnouncePlaceholders } from "@/lib/render-announce";

/**
 * 注：P2-004 修复——将本地 resolveToken 副本换成 lib/auth.ts 的 requireAuth，
 * 消除与 /api/pet/* / /api/gift/* / /api/inventory 的认证双源。
 * lib/auth.resolveToken 与旧版 resolveToken 实现完全一致（Bearer 优先、回退 cookie）。
 */

export async function GET(req: Request): Promise<NextResponse> {
  // 1) 鉴权
  const auth = await requireAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error === "not_logged_in" ? "未登录" : "登录已过期" },
      { status: 401 }
    );
  }
  const session = { userId: auth.userId };

  // 2) 加载 pet
  const pets = await findByUserId(session.userId);
  if (pets.length === 0) {
    return NextResponse.json({
      ok: true,
      pet: null,
      catchup: { ran: false, skipped: "no_pet", durationMs: 0, eventCount: 0, aggregated: false },
      backoff: { absenceMs: 0, absenceHours: 0, intervalMs: null, nextProactiveTs: null, isActive: true },
      latestAggregate: null,
      events: [],
      replyCheck: { ran: false, skipped: "no_pet" },
      dailyGrant: { ran: false, skipped: "no_pet" },
    });
  }
  const pet = pets[0];

  // 3) 退避计算（纯函数；无论是否补算都要给出结果，供前端"下次主动触达"提示）
  const now = Date.now();
  const backoff = computeBackoff({ userLastActiveTs: pet.userLastActiveTs, now });
  const fromTs = pet.lastActivityTs;
  const toTs = now;
  const plan = planCatchUp({ pet, fromTs, toTs });
  const catchupStartedAt = Date.now();

  let catchupRan = false;
  let catchupEventCount = 0;
  let catchupAggregated = false;
  let catchupDurationMs = 0;
  let catchupSkipped: string | undefined;

  if (plan.total > 0) {
    try {
      const result = await executeCatchUp({ pet, plan, fromTs, toTs });
      catchupRan = true;
      catchupEventCount = result.events.length;
      catchupAggregated = result.aggregated;
      catchupDurationMs = result.durationMs;
      // 性能观测（R3 缓解）：>500ms 报警打点
      if (catchupDurationMs > 500) {
        console.warn(
          `[sync] catchup 耗时 ${catchupDurationMs}ms 超过 500ms 目标，pet=${pet.id}, events=${catchupEventCount}`
        );
      }
    } catch (err) {
      // 补算失败：整体 rollback 已在 withTransaction 内完成，本次同步继续返回时间线
      console.error(`[sync] catchup failed pet=${pet.id}:`, err);
      catchupSkipped = "catchup_error";
    }
  } else {
    catchupSkipped = plan.total === 0 ? "no_offline_span" : "empty_plan";
    catchupDurationMs = Date.now() - catchupStartedAt;
  }

  // 4b) P1-001 修复：将 backoff.nextProactiveTs 写回 pets 表。
  //     旧实现仅将 nextProactiveTs 返回给客户端，DB 中字段恒为 null，
  //     导致"离开 3 天 → 退避 7 天"的回信延迟机制形同虚设。
  // 阶段 6 收官（P1-001 遗留修复）：改为「始终写回」——
  //     用户已恢复正常活跃（absence < 24h）时，nextProactiveTs 为 null，
  //     同样写回（SET NULL）以清除陈旧值，避免导入/历史遗留的退避时间戳
  //     长期压制 isReplyDue（回信被无限推迟到过期）。
  try {
    await updateNextProactiveTs(pet.id, backoff.nextProactiveTs);
  } catch (err) {
    // 写失败不阻断同步：只影响退避联动，不影响本次 catchup / reply / grant
    console.error(`[sync] persist next_proactive_ts failed pet=${pet.id}:`, err);
  }

  // 4c) P2-002 修复：catchup 已写入 last_activity_ts / state / user_last_active_ts，
  //     此处重读 pet 以获取新状态，避免后续时间线/回信/馈赠基于陈旧对象。
  {
    const fresh = await findPetById(pet.id);
    if (fresh) {
      // 合并新字段到当前 pet 引用（保持后续代码不需要改动变量名）
      Object.assign(pet, fresh);
    }
  }

  // 5) 时间线（渲染后返回，前端直接使用）
  const recentEvents = await findEventsByPetId(pet.id, 20);
  const pack = await loadPackByName(pet.activePackName ?? "default");
  // 阶段 6（P2-001）：system_announce 渲染前反查公告
  const announcePlaceholders = await buildAnnouncePlaceholderMap(recentEvents);
  const renderedEvents = recentEvents.map((e) => {
    const packText = pack?.texts[e.type] as TextSlotTemplate | undefined;
    const eForRender =
      e.type === "system_announce"
        ? withAnnouncePlaceholders(e, announcePlaceholders.get(String(e.params.announcement_id ?? "")))
        : e;
    const rendered = renderEvent(eForRender, packText ?? null, pet.name);
    return { event: e, rendered };
  });

  // 6) 渐进披露入口卡片：最新的聚合摘要事件
  const latestAggregate = await findLatestAggregate(pet.id);
  let latestAggregateRendered = null;
  if (latestAggregate) {
    const packText = pack?.texts[latestAggregate.type] as TextSlotTemplate | undefined;
    const aggForRender =
      latestAggregate.type === "system_announce"
        ? withAnnouncePlaceholders(
            latestAggregate,
            announcePlaceholders.get(String(latestAggregate.params.announcement_id ?? ""))
          )
        : latestAggregate;
    latestAggregateRendered = {
      event: latestAggregate,
      rendered: renderEvent(aggForRender, packText ?? null, pet.name),
    };
  }

  // 7) 回信检查（阶段 4）：reply_pending=1 且已到期 → 生成回信（含退避联动）
  //    失败时不阻断同步，仅记录 skipReason
  let replyCheckResult: {
    ran: boolean;
    generated: boolean;
    skipped?: string;
  } = { ran: false, generated: false, skipped: "no_pet" };
  if (pet.id) {
    try {
      const r = await checkAndGenerateReply(pet.id, now);
      replyCheckResult = {
        ran: true,
        generated: r.generated,
        ...(r.skipReason ? { skipped: r.skipReason } : {}),
      };
    } catch (err) {
      console.error(`[sync] reply check failed pet=${pet.id}:`, err);
      replyCheckResult = { ran: true, generated: false, skipped: "error" };
    }
  }

  // 8) 每日馈赠检查（阶段 4）：今日首次登录自动领取
  //    失败时不阻断同步，仅记录 skipReason
  let dailyGrantResult: {
    ran: boolean;
    granted: boolean;
    skipped?: string;
    fallbackMessage?: string;
    itemId?: string;
    itemDisplayName?: string;
  } = { ran: false, granted: false, skipped: "no_pet" };
  if (pet.id) {
    // 回信处理可能已更新 reply_pending / last_reply_at，此处重新读一次 pet，
    // 避免 grantDailyItem 基于陈旧对象（虽然当前 daily_grant 逻辑只用 dailyGrantLastDate，
    // 但后续若依赖 pet.state / pet.userLastActiveTs 会产生副作用）
    const freshForGrant = await findPetById(pet.id);
    const grantPet = freshForGrant ?? pet;
    try {
      const r = await grantDailyItem({ pet: grantPet, now });
      dailyGrantResult = {
        ran: true,
        granted: r.granted,
        ...(r.skipReason ? { skipped: r.skipReason } : {}),
        ...(r.fallbackMessage ? { fallbackMessage: r.fallbackMessage } : {}),
        ...(r.itemId ? { itemId: r.itemId, itemDisplayName: r.itemDisplayName } : {}),
      };
    } catch (err) {
      console.error(`[sync] daily grant failed pet=${pet.id}:`, err);
      dailyGrantResult = { ran: true, granted: false, skipped: "error" };
    }
  }

  // 9) 响应前再次重读 pet，使返回给客户端的 pet 字段包含本次同步中所有写入
  //    （catchup / reply / grant 修改的字段），避免 P2-002 陈旧对象。
  const freshForResponse = await findPetById(pet.id);
  const responsePet = freshForResponse ?? pet;

  return NextResponse.json({
    ok: true,
    pet: responsePet,
    catchup: {
      ran: catchupRan,
      durationMs: catchupDurationMs,
      eventCount: catchupEventCount,
      aggregated: catchupAggregated,
      offlineDays: plan.offlineDays,
      // 本次离线窗口起点（= pet 上次活跃时间）：前端用它把时间线上
      // ts >= offlineStartTs 的事件识别为“你不在的时候发生的”（新旧分隔）
      offlineStartTs: fromTs,
      ...(catchupSkipped ? { skipped: catchupSkipped } : {}),
    },
    backoff: {
      absenceMs: backoff.absenceMs,
      absenceHours: backoff.absenceHours,
      band: backoff.band.label,
      intervalMs: backoff.intervalMs,
      nextProactiveTs: backoff.nextProactiveTs,
      isActive: backoff.isActive,
    },
    latestAggregate: latestAggregateRendered,
    events: renderedEvents,
    replyCheck: replyCheckResult,
    dailyGrant: dailyGrantResult,
  });
}
