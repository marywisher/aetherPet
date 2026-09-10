/**
 * 文件名称：pet-fsm.ts
 * 功能描述：Pet 三态状态机（在家/出门散步/旅行中）
 * 所属模块：domain/fsm
 * 验收对齐：docs/requirements.md §3.2 角色状态机；docs/dev-stage-plan.md §3 阶段 2
 * 说明：
 *   - 纯函数：`transition(from, action, now)` 返回新状态与 stateSince
 *   - 不 import next/react；单测可独立跑
 *   - 转换规则：
 *       at_home ──outing──► out_walking
 *       out_walking ──return──► at_home
 *       out_walking/at_home ──trip_start──► on_trip
 *       on_trip ──trip_end──► at_home
 *     其它组合为 no-op（MVP 无旅行玩法时保持原状态）
 */

import type { PetState } from "../types";

export type FsmAction =
  | "outing_start"      // 出门散步事件生成时触发
  | "outing_end"        // 散步结束事件生成时触发
  | "trip_start"        // 未来旅行玩法；MVP 引擎不会主动触发
  | "trip_end"          // 未来旅行玩法
  | "no_op";            // 显式无操作（生成器用于声明"不改变状态"）

export interface FsmTransition {
  state: PetState;
  stateSince: number;
  changed: boolean;
}

const ACTIONS_BY_STATE: Record<PetState, Set<FsmAction>> = {
  at_home: new Set(["outing_start", "trip_start", "no_op"]),
  out_walking: new Set(["outing_end", "no_op"]),
  on_trip: new Set(["trip_end", "no_op"]),
};

/** 校验某状态下的合法动作（no-op 恒合法） */
export function isLegalAction(from: PetState, action: FsmAction): boolean {
  if (action === "no_op") return true;
  return ACTIONS_BY_STATE[from].has(action);
}

/**
 * 应用一次转换。非法动作视为 no-op，但调用方应通过 `isLegalAction` 预先检查。
 *
 * @param from      当前状态
 * @param action    触发动作
 * @param now       时间戳（UTC ms）；用于更新 stateSince
 * @returns         { state, stateSince, changed }
 */
export function transition(from: PetState, action: FsmAction, now: number): FsmTransition {
  if (action === "no_op" || !isLegalAction(from, action)) {
    return { state: from, stateSince: now, changed: false };
  }

  let nextState: PetState = from;
  switch (action) {
    case "outing_start":
      nextState = "out_walking";
      break;
    case "outing_end":
      nextState = "at_home";
      break;
    case "trip_start":
      nextState = "on_trip";
      break;
    case "trip_end":
      nextState = "at_home";
      break;
    default:
      return { state: from, stateSince: now, changed: false };
  }

  return { state: nextState, stateSince: now, changed: true };
}

/**
 * 列出某状态下所有合法动作（含 no_op），供 UI/开发模式使用。
 */
export function listLegalActions(from: PetState): FsmAction[] {
  return [...ACTIONS_BY_STATE[from]];
}
