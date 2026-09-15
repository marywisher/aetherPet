/**
 * 文件名称：engine.ts
 * 功能描述：事件引擎主入口（随机触发 + FSM 状态推进）
 * 所属模块：domain/events
 * 验收对齐：
 *   - docs/requirements.md §3.3 事件引擎（灵魂组件）
 *   - docs/dev-stage-plan.md §3 阶段 2 事件引擎
 *
 * 设计要点：
 *   1. 领域层纯 TS，不 import next/react
 *   2. FSM 状态推进通过 fsm.transition() 完成，事件生成器声明触发的 action
 *   3. RNG 可注入，单测可复现
 *   4. 事件结构不含文案；文案由素材包通过 render.ts 渲染
 *
 * 阶段 2 Round 2 修复：
 *   - P1-002: event.fsmState 语义 = 「事件动作应用后 pet 状态快照」
 *     生成器内部可保留 pet.state 作为占位，engine 会用 transition 结果覆盖。
 *   - P2-005: pickRandomTypesByState 返回 EventTypeValue[]；
 *     on_trip 状态不再包含 outing（避免"旅行中又出门散步"语义矛盾）。
 */

import {
  defaultRng, type Event, type EventContext, type EngineOutput,
  type GeneratedEvent, type EventTypeValue,
} from "./types";
import { GENERATORS, RANDOM_TYPES } from "./templates";
import { transition, type FsmAction } from "../fsm/pet-fsm";
import { pickOne } from "./rng";
import type { PetState } from "../types";

/** 根据 pet 状态决定可选的随机事件类型（阶段 2 Round 2 修复 P2-005） */
function pickRandomTypesByState(state: PetState): EventTypeValue[] {
  switch (state) {
    case "out_walking":
      // 出门散步中：继续观察/自言自语；不再重复出门；brought_item 由 route 单独触发
      // （作为散步结束的自然产物，见 generators/brought-item.ts 触发 outing_end）
      return ["watching_water", "counting_leaves", "self_talk", "spontaneous_letter"];
    case "on_trip":
      // 旅行中（MVP 阶段旅行玩法未开放）：只保留与"身处异地"语义相符的事件
      return ["self_talk", "spontaneous_letter"];
    case "at_home":
    default:
      // 在家：全部随机事件可选（含 outing）
      return RANDOM_TYPES;
  }
}

export interface EngineOptions {
  /** 覆盖默认 RNG */
  rng?: () => number;
  /** 覆盖事件时间戳 */
  ts?: number;
  /** 覆盖 hub_id */
  hubId?: string;
  /** 标记为补算生成（阶段 3 使用） */
  byCatchup?: boolean;
  /** 手动指定事件类型（阶段 2 开发模式按钮用；不指定则按 FSM 随机） */
  forceType?: string;
  /** 手动触发某生成器时传入的额外参数（如 reply_letter 的 giftEventId） */
  generatorInput?: Record<string, unknown>;
  /** 初始事件限定类型池（pre-launch：非空时替代 pickRandomTypesByState 结果） */
  typePool?: EventTypeValue[];
  /** 逐条事件 ts 列表（长度 >= count 时第 i 条用此值，缺省沿用 opts.ts） */
  tsPerEvent?: number[];
}

/**
 * 生成下一个事件，返回事件 + pet 新状态。
 *
 * 契约：
 *   - 返回的 event.fsmState 表示「事件动作应用后 pet 的状态快照」
 *   - 与 engine 返回的 nextState 保持一致（同一份 truth）
 *   - 生成器内部初始化的 fsmState 会被 engine 用 transition 结果覆盖
 *
 * @param pet   当前 pet 快照
 * @param memories 记忆池
 * @param opts  可选配置
 * @returns     EngineOutput
 */
export function generateNextEvent(
  pet: EventContext["pet"],
  memories: EventContext["memories"],
  opts: EngineOptions = {}
): EngineOutput {
  const rng = opts.rng ?? defaultRng();
  const ctx: EventContext = {
    pet,
    memories,
    ts: opts.ts ?? Date.now(),
    rng,
    hubId: opts.hubId ?? pet.hubId,
    byCatchup: opts.byCatchup,
  };

  let type: EventTypeValue;
  if (opts.forceType) {
    type = opts.forceType as EventTypeValue;
  } else if (opts.typePool && opts.typePool.length > 0) {
    // pre-launch：初始事件限定类型池（不经过 FSM 状态判断）
    type = (pickOne(rng, opts.typePool) ?? "self_talk") as EventTypeValue;
  } else {
    const candidates = pickRandomTypesByState(pet.state);
    type = (pickOne(rng, candidates) ?? "self_talk") as EventTypeValue;
  }

  const generator = GENERATORS[type];
  if (!generator) {
    throw new Error(`[engine] 未注册的生成器：${type}`);
  }

  // 若调用方传了 generatorInput，与 ctx 合并
  const mergedCtx = opts.generatorInput
    ? ({ ...ctx, ...opts.generatorInput } as EventContext & Record<string, unknown>)
    : ctx;

  // pre-launch：逐条 ts 覆盖（tsPerEvent[i]）由 generateBatchEvents 循环传入，
  // 这里保持 ctx.ts 原样；forceType 单条生成时调用方直接传 ts。

  const { event, fsmAction } = (generator as (c: unknown) => GeneratedEvent)(mergedCtx);

  const { state: nextState, stateSince: nextStateSince } = transition(
    pet.state,
    fsmAction as FsmAction,
    event.ts
  );

  // P1-002 修复：把 event.fsmState 统一为「动作应用后」状态，与 nextState 一致
  // 契约文档见 docs/packs-contract.md §5
  event.fsmState = nextState;

  return { event, nextState, nextStateSince };
}

/**
 * 便捷：一次性生成 N 个事件（阶段 2 首页首屏种子用）。
 * 每条事件后 pet 状态会更新，下一条基于新状态。
 */
export function generateBatchEvents(
  pet: EventContext["pet"],
  memories: EventContext["memories"],
  count: number,
  opts: EngineOptions = {}
): { events: Event[]; finalState: PetState; finalStateSince: number } {
  const events: Event[] = [];
  let state = pet.state;
  let stateSince = pet.stateSince;
  for (let i = 0; i < count; i++) {
    // 更新 pet 快照供下一轮使用（保持 state 变化生效）
    const petNow = { ...pet, state, stateSince };
    // pre-launch：若提供 tsPerEvent 且长度大于 i，覆盖当前 opts 中的 ts
    const tsOverride =
      opts.tsPerEvent && opts.tsPerEvent.length > i
        ? { ...opts, ts: opts.tsPerEvent[i] }
        : opts;
    const out = generateNextEvent(petNow, memories, tsOverride);
    events.push(out.event);
    state = out.nextState;
    stateSince = out.nextStateSince;
  }
  return { events, finalState: state, finalStateSince: stateSince };
}
