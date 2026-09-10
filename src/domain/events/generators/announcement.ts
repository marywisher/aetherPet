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
