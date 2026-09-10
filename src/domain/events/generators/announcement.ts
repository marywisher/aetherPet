/**
 * 文件名称：announcement.ts
 * 功能描述：系统公告事件生成器
 * 所属模块：domain/events/generators
 * 契约冻结：docs/packs-contract.md §system_announce
 * 说明：
 *   - 阶段 2 保留生成器骨架；公告中心在阶段 5 落地
 *   - 该事件类型 embed 到时间线里，让公告与 pet 行为统一展示
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";

export interface AnnounceContext extends EventContext {
  announcementId: string;
  announcementTitle: string;
  announcementBody: string;
}

// TODO(阶段 6)：接入 system_announce 前必须重构——
// params 只应存 announcement_id（引用），title/body 由 UI 层反查 announcements 表，
// 以符合「事件结构不含文案」硬约束（阶段 5 质检 P2-003）；
// 届时同步评估 packs-contract.md v1.0.1 的 system_announce 插槽描述（可能 bump 到 v1.1.0，需契约评审）。
export function generateSystemAnnounce(ctx: AnnounceContext): GeneratedEvent {
  const { pet } = ctx;
  // Round 2 P3-001 清理：系统公告不需要随机性，不再提取 ctx.rng
  const ts = ctx.ts ?? Date.now();
  const hubId = ctx.hubId ?? pet.hubId;

  const event: Event = {
    id: newUlid(),
    petId: pet.id,
    userId: pet.userId,
    type: "system_announce",
    ts,
    fsmState: pet.state,
    params: {
      announcement_id: ctx.announcementId,
      announcement_title: ctx.announcementTitle,
      announcement_body: ctx.announcementBody,
    },
    memoryRefs: [],
    source: "system",
    engineVersion: ENGINE_VERSION,
    packSchemaVersion: PACK_SCHEMA_VERSION,
    isAggregate: false,
    aggregateSpanDays: null,
    generatedByCatchup: false,
    schemaVersion: SCHEMA_VERSION,
    hubId,
    createdAt: ts,
  };

  return { event, fsmAction: "no_op" };
}
