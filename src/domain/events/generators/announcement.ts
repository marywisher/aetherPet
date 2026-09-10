/**
 * 文件名称：announcement.ts
 * 功能描述：系统公告事件生成器
 * 所属模块：domain/events/generators
 * 契约冻结：docs/packs-contract.md §system_announce
 * 说明：
 *   - 阶段 2 保留生成器骨架；阶段 5 落地公告中心；阶段 6 接入 events 表（P2-001）
 *   - P2-003 修复（阶段 6）：params 只存 announcement_id 引用，title/body 由 UI 层
 *     在渲染时通过 announcements 表反查（事件结构不含文案硬约束）
 *   - 生成器本身无 IO：调用方（admin 发布流程）负责把产物写入 events 表
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";

export interface AnnounceContext extends EventContext {
  /** 公告 id（渲染时反查 announcements 表补 title/body） */
  announcementId: string;
}

export function generateSystemAnnounce(ctx: AnnounceContext): GeneratedEvent {
  const { pet } = ctx;
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