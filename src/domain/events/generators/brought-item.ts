/**
 * 文件名称：brought-item.ts
 * 功能描述：带回物品事件生成器
 * 所属模块：domain/events/generators
 * 契约冻结：docs/packs-contract.md §brought_item
 * 说明：
 *   - item_id 引用 items 表；MVP 阶段物品池未 seed 完整（阶段 4 补齐），
 *     这里使用一个内置的候选列表保证生成器可跑通；未来从 items 表查。
 *   - FSM 动作：outing_end（阶段 2 Round 2 修复 P1-004）
 *     「带回物品」是「散步归来」的自然产物，触发 out_walking → at_home。
 *     若 pet 当前不在 out_walking，FSM 会把它当 no-op（isLegalAction 校验），
 *     但事件仍会被入库，用于 UI 展示与后续 stats 聚合。
 */

import { ulid as newUlid } from "ulid";
import {
  ENGINE_VERSION, SCHEMA_VERSION, PACK_SCHEMA_VERSION,
  type Event, type EventContext, type GeneratedEvent,
} from "../types";
import { pickOne } from "../rng";
import { recallForPet } from "../../memory";

/** 内置物品候选（阶段 4 会与 items 表 seed 数据对齐） */
const ITEM_CANDIDATES = [
  { id: "berry", displayName: "浆果" },
  { id: "dry-leaf", displayName: "枯叶" },
  { id: "stone", displayName: "小石子" },
  { id: "dandelion", displayName: "蒲公英" },
  { id: "shell", displayName: "贝壳" },
  { id: "pebble", displayName: "鹅卵石" },
  { id: "feather", displayName: "羽毛" },
  { id: "wood-slip", displayName: "木片" },
] as const;

export function generateBroughtItem(ctx: EventContext): GeneratedEvent {
  const { pet, memories, rng = Math.random } = ctx;
  const ts = ctx.ts ?? Date.now();
  const hubId = ctx.hubId ?? pet.hubId;
  const item = pickOne(rng, ITEM_CANDIDATES) ?? ITEM_CANDIDATES[0];

  const recall = recallForPet({
    memories,
    petName: pet.name,
    rng,
    opts: { maxRefs: 4 },
  });

  // 保证 item_name 引用入 memoryRefs（契约 recall_required）
  const itemNameRef = {
    kind: "item_name" as const,
    value: item.displayName,
    weight: 1,
    sourceEventId: undefined,
  };
  const hasItem = recall.refs.some((r) => r.kind === "item_name");
  const memoryRefs = hasItem
    ? recall.refs
    : [itemNameRef, ...recall.refs].slice(0, 5);

  const event: Event = {
    id: newUlid(),
    petId: pet.id,
    userId: pet.userId,
    type: "brought_item",
    ts,
    fsmState: pet.state,
    params: { item_id: item.id, item_display_name: item.displayName },
    memoryRefs,
    source: ctx.byCatchup ? "catchup" : "engine",
    engineVersion: ENGINE_VERSION,
    packSchemaVersion: PACK_SCHEMA_VERSION,
    isAggregate: false,
    aggregateSpanDays: null,
    generatedByCatchup: ctx.byCatchup ?? false,
    schemaVersion: SCHEMA_VERSION,
    hubId,
    createdAt: ts,
  };

  // 阶段 2 Round 2 修复 P1-004：brought_item 触发 outing_end，
  // 与契约 §5 对齐（「带回物品」= 散步归来）
  return { event, fsmAction: "outing_end" };
}
