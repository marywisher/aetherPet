/**
 * 文件名称：first-meeting.ts
 * 功能描述：初见事件生成器（pre-launch 增量 1）
 * 所属模块：domain/events/generators
 * 转换规则：无（no_op）
 * 说明：
 *   - 仅由创建流程（POST /api/pet/create）显式触发，一次且仅一次；
 *     不进 RANDOM_TYPES、不进补算池、不进 dev FORCE_TYPES（见守卫单测）。
 *   - ts 由调用方传入（创建时刻），保证在时间线倒序中位于最新（第一条）。
 *   - memoryRefs 允许为空：初见时刻 pet 尚无记忆，命名 ref 由 create 路由合成。
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";

export function generateFirstMeeting(ctx: EventContext): GeneratedEvent {
  const { pet } = ctx;
  const ts = ctx.ts ?? Date.now();
  const hubId = ctx.hubId ?? pet.hubId;

  const event: Event = {
    id: newUlid(),
    petId: pet.id,
    userId: pet.userId,
    type: "first_meeting",
    ts,
    fsmState: pet.state,
    params: {},
    memoryRefs: [],
    source: "creation",
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
