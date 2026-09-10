/**
 * 文件名称：types.ts
 * 功能描述：事件引擎契约（EventType 枚举、EventStructure schema、生成器接口）
 * 所属模块：domain/events
 * 说明：
 *   - Event 结构本身不含文案字符串；文案由素材包通过 slots/variants 提供
 *   - 事件契约冻结在 docs/packs-contract.md（v1.0.0）
 *   - 领域层纯 TS，不 import next/react
 */

import type { Event, EventTypeValue, MemoryRef, Pet, Memory } from "../types";
import type { FsmAction } from "../fsm/pet-fsm";

/** 引擎版本（与 pack_schema_version 独立，见架构 §5.5） */
export const ENGINE_VERSION = "1.0.0";
export const SCHEMA_VERSION = "1.0.0";
export const PACK_SCHEMA_VERSION = "1.0.0";

/** 可注入的可复现 RNG（单测用 seeded RNG；默认 Math.random） */
export type Rng = () => number;

export function defaultRng(): Rng {
  return Math.random;
}

/**
 * 引擎上下文：一次事件生成调用所需的最小信息。
 *
 * 契约：
 *   - pet:  当前 pet 快照（含 state / name / hubId / schemaVersion）
 *   - memories: 记忆池（含 pet_name 命名的 kind='naming' 记录）
 *   - ts:   事件时间戳（默认 Date.now()）
 *   - rng:  可注入 RNG（便于单测确定性回放）
 *   - hubId:  当前中心标识（缺省读 pet.hubId）
 */
export interface EventContext {
  pet: Pet;
  memories: Memory[];
  ts?: number;
  rng?: Rng;
  hubId?: string;
  /** 标记为补算生成（阶段 3 使用；本阶段恒 false） */
  byCatchup?: boolean;
}

/**
 * 生成器结果：事件 + 触发 FSM 的动作。
 * 动作交由 engine 通过 fsm.transition() 应用到 pet 上。
 */
export interface GeneratedEvent {
  event: Event;
  fsmAction: FsmAction;
}

export type EventGenerator = (
  ctx: EventContext
) => GeneratedEvent;

/** 事件类型 → 生成器 注册表（由 templates.ts 聚合）
 * 说明：不同生成器对 ctx 有额外字段要求（如 gift_event_id），
 *       为了兼容异类参数，此 registry 接受可变参数函数 */
export type GeneratorRegistry = Partial<
  Record<EventTypeValue, (...args: any[]) => GeneratedEvent>
>;

/** 引擎产出：事件 + 应用后 pet 的新状态 */
export interface EngineOutput {
  event: Event;
  nextState: Pet["state"];
  nextStateSince: number;
}

export type { Event, EventTypeValue, MemoryRef, Pet, Memory };
